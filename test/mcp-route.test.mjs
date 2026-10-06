import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpRoute } from "../scripts/mcp/mcp-route.mjs";

const ISSUER = "https://samplas-test.auth0.example/";
const SUBJECT = "auth0|operator";

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

// Fake Marketing OS upstream: 2025 foreign missing, 2026 partial; inventory can be slowed or hung.
function fakeUpstream(state) {
  return (req, res) => {
    const u = new URL(req.url, "http://x");
    state.seen.push({ method: req.method, path: u.pathname });
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    const done = (body) => { state.active -= 1; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (u.pathname === "/api/intelligence/clients") {
      const is2025 = u.searchParams.get("since").startsWith("2025");
      return done({ ok: true, periodStart: u.searchParams.get("since"), periodEnd: u.searchParams.get("until"),
        typeBreakdown: [{ type: "foreign", label: "외국인", clientCount: 1, purchaseCount: is2025 ? 0 : 546, salesAmount: is2025 ? 0 : 133480850, ratioPct: 1 }],
        coverage: { online: { available: true }, offline: is2025 ? { includedMonths: [], partialMonths: [], missingMonths: ["2025-01"] } : { includedMonths: ["2026-01"], partialMonths: ["2026-01"], missingMonths: [] }, complete: false } });
    }
    if (u.pathname === "/api/inventory/overview") {
      if (state.hang) { state.active -= 1; return; }
      return setTimeout(() => done({ ok: true, generatedAt: "t", coverage: { totalItems: 14746 }, summary: {}, operations: {}, itemsTotal: 14746, items: [] }), state.delayMs || 0);
    }
    state.active -= 1;
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  };
}

async function setup({ authMode = "oauth", isRender = false, configured = true, timeoutMs = 2000 } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const jwks = await listen((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ keys: [jwk] })); });
  const state = { seen: [], active: 0, maxActive: 0 };
  const upstream = await listen(fakeUpstream(state));
  let resourceUrl;
  const handler = { fn: null };
  const app = await listen(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await handler.fn(req, res, url))) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Not Found" })); }
  });
  resourceUrl = `${app.base}/mcp`;
  handler.fn = createMcpRoute({
    upstreamBaseUrl: upstream.base,
    timeoutMs,
    auth: configured
      ? { resourceUrl, issuer: ISSUER, audience: resourceUrl, jwksUrl: `${jwks.base}/jwks.json`, allowedSubjects: [SUBJECT], mode: authMode, isRender }
      : { mode: authMode, isRender, allowedSubjects: [] }
  });
  const sign = (claims = {}, { iss = ISSUER, aud = resourceUrl, exp = "5m", key = privateKey } = {}) =>
    new SignJWT({ scope: "openid samplas.read", ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(iss).setAudience(aud).setSubject(claims.sub || SUBJECT).setIssuedAt().setExpirationTime(exp).sign(key);
  const close = () => Promise.all([jwks.close(), upstream.close(), app.close()]);
  return { app, state, sign, resourceUrl, close };
}

async function connect(resourceUrl, token) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(resourceUrl), { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }));
  return client;
}
const initBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } });
const post = (url, { token, body = initBody, method = "POST" } = {}) => fetch(url, {
  method, body: method === "POST" ? body : undefined,
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
});

test("auth: every invalid credential gets 401 + WWW-Authenticate; valid read token works", async () => {
  const t = await setup();
  try {
    const { generateKeyPair: gen } = await import("jose");
    const other = await gen("RS256");
    const cases = {
      "no token": null,
      malformed: "not-a-jwt",
      expired: await t.sign({}, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      "wrong issuer": await t.sign({}, { iss: "https://evil.example/" }),
      "wrong audience": await t.sign({}, { aud: "https://other.example/mcp" }),
      "wrong signing key": await t.sign({}, { key: other.privateKey }),
      "missing scope": await t.sign({ scope: "openid" }),
      "apply scope only": await t.sign({ scope: "samplas.apply samplas.propose" }),
      "unauthorized subject": await t.sign({ sub: "auth0|someone-else" })
    };
    for (const [label, token] of Object.entries(cases)) {
      const res = await post(t.resourceUrl, { token });
      assert.equal(res.status, 401, label);
      const header = res.headers.get("www-authenticate");
      assert.match(header, /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource", scope="samplas\.read"/, label);
      assert.equal((await res.json()).error.code, -32001, label);
    }
    const permissionsOnly = await t.sign({ scope: "openid", permissions: ["samplas.read"] });
    assert.equal((await post(t.resourceUrl, { token: permissionsOnly })).status, 200, "Auth0 RBAC permissions claim");
    assert.equal((await post(t.resourceUrl, { token: await t.sign() })).status, 200);
    assert.equal(t.state.seen.length, 0, "auth failures never reach upstream");
  } finally { await t.close(); }
});

test("protected resource metadata advertises only samplas.read", async () => {
  const t = await setup();
  try {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(`${t.app.base}${path}`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { resource: t.resourceUrl, authorization_servers: [ISSUER], scopes_supported: ["samplas.read"], bearer_methods_supported: ["header"], resource_name: "SAMPLAS Marketing OS" });
    }
  } finally { await t.close(); }
});

test("MCP initialize, exactly 10 read-only tools with samplas.read security, tool execution", async () => {
  const t = await setup();
  try {
    const client = await connect(t.resourceUrl, await t.sign());
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true, tool.name);
      assert.equal(tool.inputSchema.type, "object", tool.name);
    }
    const raw = await (await post(t.resourceUrl, { token: await t.sign(), body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) })).json();
    for (const tool of raw.result.tools) assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: ["samplas.read"] }], tool.name);
    assert.doesNotMatch(JSON.stringify(raw), /samplas\.(propose|apply)/);

    const result = await client.callTool({ name: "get_foreign_sales", arguments: { since: "2026-01-01", until: "2026-09-30", compareSince: "2025-01-01", compareUntil: "2025-09-30" } });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.data.current.foreign.salesAmount, 133480850);
    assert.equal(result.structuredContent.data.comparison.foreign.salesAmount, null);
    assert.equal(result.structuredContent.data.growth.growthRate, null);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);

    const invalid = await client.callTool({ name: "get_inventory", arguments: { limit: 14746 } });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent.error.code, "VALIDATION_FAILED");
    await client.close();
    assert.ok(t.state.seen.every((s) => s.method === "GET"));
  } finally { await t.close(); }
});

test("timeout and concurrency: upstream hang is UPSTREAM_UNAVAILABLE; at most 2 concurrent", async () => {
  const t = await setup({ timeoutMs: 300 });
  try {
    const token = await t.sign();
    const client = await connect(t.resourceUrl, token);
    t.state.delayMs = 150;
    const calls = Array.from({ length: 5 }, () => client.callTool({ name: "get_inventory", arguments: {} }));
    const results = await Promise.all(calls);
    assert.ok(results.every((r) => r.isError === false));
    assert.ok(t.state.maxActive <= 2, `max upstream concurrency ${t.state.maxActive}`);
    t.state.hang = true;
    const hung = await client.callTool({ name: "get_inventory", arguments: {} });
    assert.equal(hung.structuredContent.error.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(hung.structuredContent.error.retryable, true);
    await client.close();
  } finally { await t.close(); }
});

test("request guards: body size, method, other paths", async () => {
  const t = await setup();
  try {
    const token = await t.sign();
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(70 * 1024) } });
    assert.equal((await post(t.resourceUrl, { token, body: big })).status, 413);
    assert.equal((await post(t.resourceUrl, { token, method: "GET" })).status, 405);
    assert.equal((await post(t.resourceUrl, { token, body: "{not json" })).status, 400);
    assert.equal((await fetch(`${t.app.base}/api/sales/total`)).status, 404, "non-MCP paths fall through");
  } finally { await t.close(); }
});

test("misconfiguration fails closed; dev-noauth only off Render and on loopback", async () => {
  const unconfigured = await setup({ configured: false });
  try {
    assert.equal((await post(unconfigured.resourceUrl)).status, 503);
    assert.equal((await fetch(`${unconfigured.app.base}/.well-known/oauth-protected-resource`)).status, 503);
  } finally { await unconfigured.close(); }

  const dev = await setup({ configured: false, authMode: "dev-noauth" });
  try {
    const client = await connect(dev.resourceUrl, null);
    assert.equal((await client.listTools()).tools.length, 10);
    await client.close();
  } finally { await dev.close(); }

  const onRender = await setup({ configured: false, authMode: "dev-noauth", isRender: true });
  try {
    assert.equal((await post(onRender.resourceUrl)).status, 503, "dev-noauth ignored on Render");
  } finally { await onRender.close(); }

  const renderConfigured = await setup({ authMode: "dev-noauth", isRender: true });
  try {
    assert.equal((await post(renderConfigured.resourceUrl)).status, 401, "Render with config still requires a token");
  } finally { await renderConfigured.close(); }
});

const rpc = (t, token, message, headers = {}) => fetch(t.resourceUrl, {
  method: "POST", body: typeof message === "string" ? message : JSON.stringify(message),
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, ...headers }
});

test("wire format: initialize, id preservation, notifications, unknown method, malformed JSON-RPC", async () => {
  const t = await setup();
  try {
    const token = await t.sign();
    const init = await rpc(t, token, { jsonrpc: "2.0", id: "init-7", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } });
    assert.equal(init.status, 200);
    assert.match(init.headers.get("content-type"), /^application\/json/);
    assert.deepEqual(await init.json(), { jsonrpc: "2.0", id: "init-7", result: {
      protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "samplas-marketing-os", title: "SAMPLAS Marketing OS", version: "1.0.0" },
      instructions: "Read-only SAMPLAS Marketing OS data. Always report meta.completeness and meta.notes; never present partial or unavailable data as complete, and never treat a null amount as 0."
    } });
    const future = await (await rpc(t, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } })).json();
    assert.equal(future.result.protocolVersion, "2025-11-25", "unknown version negotiates to latest supported");

    const note = await rpc(t, token, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(note.status, 202);
    assert.equal(await note.text(), "");
    assert.deepEqual(await (await rpc(t, token, { jsonrpc: "2.0", id: 0, method: "ping" })).json(), { jsonrpc: "2.0", id: 0, result: {} });

    const list = await (await rpc(t, token, { jsonrpc: "2.0", id: 42, method: "tools/list", params: {} })).json();
    assert.equal(list.id, 42);
    assert.equal(list.result.tools.length, 10);
    for (const tool of list.result.tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    }

    assert.deepEqual(await (await rpc(t, token, { jsonrpc: "2.0", id: 5, method: "resources/list" })).json(), { jsonrpc: "2.0", id: 5, error: { code: -32601, message: "Method not found: resources/list" } });
    assert.deepEqual(await (await rpc(t, token, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "set_discount", arguments: {} } })).json(), { jsonrpc: "2.0", id: 6, error: { code: -32602, message: "Unknown tool: set_discount" } });
    assert.equal((await (await rpc(t, token, { jsonrpc: "2.0", id: 7, method: "tools/call", params: {} })).json()).error.code, -32602);

    for (const [label, message, code] of [
      ["missing jsonrpc", { id: 1, method: "ping" }, -32600],
      ["batch", [{ jsonrpc: "2.0", id: 1, method: "ping" }], -32600],
      ["null id", { jsonrpc: "2.0", id: null, method: "ping" }, -32600],
      ["missing method", { jsonrpc: "2.0", id: 9 }, -32600],
      ["parse error", "{\"jsonrpc\":", -32700]
    ]) {
      const res = await rpc(t, token, message);
      assert.equal(res.status, 400, label);
      assert.equal((await res.json()).error.code, code, label);
    }
    const badVersion = await rpc(t, token, { jsonrpc: "2.0", id: 1, method: "ping" }, { "MCP-Protocol-Version": "1999-01-01" });
    assert.equal(badVersion.status, 400);
    assert.equal((await rpc(t, token, { jsonrpc: "2.0", id: 1, method: "ping" }, { "MCP-Protocol-Version": "2025-06-18" })).status, 200);
  } finally { await t.close(); }
});

test("dev-noauth rejects browser Origin (DNS rebinding guard)", async () => {
  const dev = await setup({ configured: false, authMode: "dev-noauth" });
  try {
    const res = await fetch(dev.resourceUrl, { method: "POST", body: initBody, headers: { "Content-Type": "application/json", Origin: "http://evil.example" } });
    assert.equal(res.status, 403);
  } finally { await dev.close(); }
});

test("MCP_AUTH_MODE=none: no token needed; no OAuth config or metadata; tools stay read-only", async () => {
  const t = await setup({ configured: false, authMode: "none", isRender: true });
  try {
    const client = await connect(t.resourceUrl, null);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);
    const result = await client.callTool({ name: "get_foreign_sales", arguments: { since: "2026-01-01", until: "2026-09-30", compareSince: "2025-01-01", compareUntil: "2025-09-30" } });
    assert.equal(result.structuredContent.data.current.foreign.salesAmount, 133480850);
    assert.equal(result.structuredContent.data.comparison.foreign.salesAmount, null);
    await client.close();

    const raw = await (await post(t.resourceUrl, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) })).json();
    for (const tool of raw.result.tools) {
      assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }], tool.name);
      assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    }
    const res = await post(t.resourceUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("www-authenticate"), null);
    assert.equal((await fetch(`${t.app.base}/.well-known/oauth-protected-resource`)).status, 404, "no OAuth discovery in none mode");
    assert.equal((await post(t.resourceUrl, { body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "set_discount", arguments: {} } }) })).status, 200);
    assert.ok(t.state.seen.every((s) => s.method === "GET"));
  } finally { await t.close(); }
});

test("invalid or empty MCP_AUTH_MODE fails closed even with OAuth configured", async () => {
  for (const mode of ["None", "off", "noauth", "", " none"]) {
    const t = await setup({ authMode: mode });
    try {
      const res = await post(t.resourceUrl, { token: await t.sign() });
      assert.equal(res.status, 503, `mode ${JSON.stringify(mode)}`);
      assert.equal((await fetch(`${t.app.base}/.well-known/oauth-protected-resource`)).status, 503, `metadata ${JSON.stringify(mode)}`);
    } finally { await t.close(); }
  }
});

test("mcpConfigFromEnv: unset mode means oauth; value passes through unmodified", async () => {
  const { mcpConfigFromEnv } = await import("../scripts/mcp/mcp-route.mjs");
  assert.equal(mcpConfigFromEnv({}, 1).auth.mode, "oauth");
  assert.equal(mcpConfigFromEnv({ MCP_AUTH_MODE: "none" }, 1).auth.mode, "none");
  assert.equal(mcpConfigFromEnv({ MCP_AUTH_MODE: "None" }, 1).auth.mode, "None");
});
