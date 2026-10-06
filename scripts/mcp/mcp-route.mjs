// Read-only MCP endpoint colocated in Marketing OS (spec §4.1a). server.mjs imports this module
// only when MCP_ENABLED=on. Minimal stateless Streamable HTTP: one JSON-RPC 2.0 message per POST,
// application/json responses, no sessions, no SSE stream. Supported methods: initialize, ping,
// tools/list, tools/call; notifications are acknowledged with 202. The MCP SDK is not loaded at
// runtime (it cost 25-35 MB RSS); tests drive this handler with the real SDK client instead.
import { READ_TOOLS, runReadTool } from "./read-tools.mjs";
import { createUpstream } from "./upstream.mjs";
import { READ_SCOPE, createMcpAuth } from "./mcp-auth.mjs";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_CONCURRENT = 2;
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_QUEUED = 10;
const SECURITY = [{ type: "oauth2", scopes: [READ_SCOPE] }];
const SERVER_INFO = { name: "samplas-marketing-os", title: "SAMPLAS Marketing OS", version: "1.0.0" };
const INSTRUCTIONS = "Read-only SAMPLAS Marketing OS data. Always report meta.completeness and meta.notes; never present partial or unavailable data as complete, and never treat a null amount as 0.";

export const TOOL_DESCRIPTORS = READ_TOOLS.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.input,
  annotations: { title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: SECURITY,
  _meta: { securitySchemes: SECURITY }
}));

// JSON-RPC error codes (JSON-RPC 2.0 spec).
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function createGate(limit) {
  let active = 0;
  const waiting = [];
  return async function run(fn) {
    if (active >= limit) {
      if (waiting.length >= MAX_QUEUED) return { busy: true };
      await new Promise((resolve) => waiting.push(resolve));
    }
    active += 1;
    try { return { value: await fn() }; } finally { active -= 1; waiting.shift()?.(); }
  };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const validId = (id) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));

async function readBody(req) {
  if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) return { tooLarge: true };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  try { return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; } catch { return { invalid: true }; }
}

// Returns { status, body } for one JSON-RPC message. body === null means 202 with no content.
export async function handleRpcMessage(message, upstream) {
  if (Array.isArray(message)) return { status: 400, body: rpcError(null, INVALID_REQUEST, "Batch requests are not supported") };
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return { status: 400, body: rpcError(null, INVALID_REQUEST, "Invalid JSON-RPC 2.0 message") };
  const isNotification = !("id" in message);
  if (typeof message.method !== "string") {
    // A JSON-RPC response from the client: this server never sends requests, so just acknowledge.
    if (!isNotification && ("result" in message || "error" in message)) return { status: 202, body: null };
    return { status: 400, body: rpcError(validId(message.id) ? message.id : null, INVALID_REQUEST, "Missing method") };
  }
  if (isNotification) return { status: 202, body: null };
  if (!validId(message.id)) return { status: 400, body: rpcError(null, INVALID_REQUEST, "id must be a string or number") };

  const { id, method } = message;
  const params = message.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) return { status: 200, body: rpcError(id, INVALID_PARAMS, "params must be an object") };

  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return { status: 200, body: rpcResult(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }) };
    }
    case "ping":
      return { status: 200, body: rpcResult(id, {}) };
    case "tools/list":
      return { status: 200, body: rpcResult(id, { tools: TOOL_DESCRIPTORS }) };
    case "tools/call": {
      if (typeof params.name !== "string") return { status: 200, body: rpcError(id, INVALID_PARAMS, "params.name must be a string") };
      if (!READ_TOOLS.some((t) => t.name === params.name)) return { status: 200, body: rpcError(id, INVALID_PARAMS, `Unknown tool: ${params.name.slice(0, 60)}`) };
      const result = await runReadTool(params.name, params.arguments, upstream);
      return { status: 200, body: rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok }) };
    }
    default:
      return { status: 200, body: rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method.slice(0, 60)}`) };
  }
}

export function mcpConfigFromEnv(env, port) {
  return {
    upstreamBaseUrl: env.MCP_UPSTREAM_BASE_URL || `http://127.0.0.1:${port}`,
    auth: {
      resourceUrl: env.MCP_RESOURCE_URL,
      issuer: env.OAUTH_ISSUER,
      audience: env.OAUTH_AUDIENCE || env.MCP_RESOURCE_URL,
      jwksUrl: env.OAUTH_JWKS_URL,
      allowedSubjects: String(env.MCP_ALLOWED_SUBJECTS || "").split(",").map((s) => s.trim()).filter(Boolean),
      mode: env.MCP_AUTH_MODE || "oauth",
      isRender: Boolean(env.RENDER)
    }
  };
}

// Returns (req, res, url) => Promise<boolean>; false means "not an MCP path, keep routing".
export function createMcpRoute({ upstreamBaseUrl, auth: authConfig, timeoutMs = 20_000 }) {
  const upstream = createUpstream({ baseUrl: upstreamBaseUrl, timeoutMs });
  const auth = createMcpAuth(authConfig);
  const gate = createGate(MAX_CONCURRENT);

  return async function handleMcp(req, res, url) {
    if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method Not Allowed" }, { Allow: "GET" }), true;
      if (!auth.configured) return sendJson(res, 503, { ok: false, error: "MCP OAuth is not configured" }), true;
      return sendJson(res, 200, auth.protectedResourceMetadata()), true;
    }
    if (url.pathname !== "/mcp") return false;

    // Unauthenticated local development must not be reachable from a browser page (DNS rebinding).
    if (auth.devNoAuth && req.headers.origin) return sendJson(res, 403, rpcError(null, INVALID_REQUEST, "Origin not allowed")), true;
    const who = await auth.authenticate(req);
    if (!who.ok) {
      if (who.status === 503) return sendJson(res, 503, rpcError(null, -32000, "MCP OAuth is not configured")), true;
      return sendJson(res, 401, rpcError(null, -32001, `AUTH_REQUIRED: ${who.error}`), { "WWW-Authenticate": who.wwwAuthenticate }), true;
    }
    if (req.method !== "POST") return sendJson(res, 405, rpcError(null, -32000, "Method not allowed: stateless MCP accepts POST only"), { Allow: "POST" }), true;
    const version = req.headers["mcp-protocol-version"];
    if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return sendJson(res, 400, rpcError(null, INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${String(version).slice(0, 20)}`)), true;

    const parsed = await readBody(req);
    if (parsed.tooLarge) return sendJson(res, 413, rpcError(null, INVALID_REQUEST, `Request body exceeds ${MAX_BODY_BYTES} bytes`)), true;
    if (parsed.invalid) return sendJson(res, 400, rpcError(null, PARSE_ERROR, "Parse error")), true;

    const outcome = await gate(() => handleRpcMessage(parsed.body, upstream));
    if (outcome.busy) return sendJson(res, 503, rpcError(parsed.body?.id, -32000, "MCP is busy; retry shortly"), { "Retry-After": "5" }), true;
    const { status, body } = outcome.value;
    if (body === null) {
      res.writeHead(202, { "Cache-Control": "no-store" });
      res.end();
    } else {
      sendJson(res, status, body);
    }
    return true;
  };
}
