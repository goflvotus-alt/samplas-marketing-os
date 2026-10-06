// Read-only MCP endpoint colocated in Marketing OS (spec §4.1a). server.mjs imports this module
// only when MCP_ENABLED=on. Stateless Streamable HTTP with JSON responses: one MCP server per
// request, no sessions, no SSE stream. Tools call existing GET routes through upstream.mjs.
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { READ_TOOLS, runReadTool } from "./read-tools.mjs";
import { createUpstream } from "./upstream.mjs";
import { READ_SCOPE, createMcpAuth } from "./mcp-auth.mjs";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_CONCURRENT = 2;
const MAX_QUEUED = 10;
const SECURITY = [{ type: "oauth2", scopes: [READ_SCOPE] }];

export const TOOL_DESCRIPTORS = READ_TOOLS.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
  annotations: { title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: SECURITY,
  _meta: { securitySchemes: SECURITY }
}));

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
const rpcError = (code, message) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

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

function buildServer(upstream) {
  const server = new Server({ name: "samplas-marketing-os", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DESCRIPTORS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await runReadTool(request.params.name, request.params.arguments, upstream);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok };
  });
  return server;
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

    const who = await auth.authenticate(req);
    if (!who.ok) {
      if (who.status === 503) return sendJson(res, 503, rpcError(-32000, "MCP OAuth is not configured")), true;
      return sendJson(res, 401, rpcError(-32001, `AUTH_REQUIRED: ${who.error}`), { "WWW-Authenticate": who.wwwAuthenticate }), true;
    }
    if (req.method !== "POST") return sendJson(res, 405, rpcError(-32000, "Method not allowed: stateless MCP accepts POST only"), { Allow: "POST" }), true;

    const parsed = await readBody(req);
    if (parsed.tooLarge) return sendJson(res, 413, rpcError(-32600, `Request body exceeds ${MAX_BODY_BYTES} bytes`)), true;
    if (parsed.invalid) return sendJson(res, 400, rpcError(-32700, "Parse error")), true;

    const outcome = await gate(async () => {
      const server = buildServer(upstream);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed.body);
    });
    if (outcome.busy) sendJson(res, 503, rpcError(-32000, "MCP is busy; retry shortly"), { "Retry-After": "5" });
    return true;
  };
}
