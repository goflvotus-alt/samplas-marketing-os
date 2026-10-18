import test from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../popup-plugin/worker/index.mjs";
import { popupRpc } from "../scripts/popup-mcp.mjs";

const rpc = (body, user = "user-1") => new Request("https://x.chatgpt.site/mcp", { method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...(user ? { "oai-authenticated-user-id": user } : {}) } });
const call = { jsonrpc: "2.0", id: 7, method: "tools/list" };

test("forwards to Marketing OS with the secret and returns the reply unchanged", async () => {
  let seen;
  const worker = createWorker({ fetchImpl: async (url, init) => { seen = { url, init }; return Response.json({ jsonrpc: "2.0", id: 7, result: { tools: [] } }); } });
  const res = await worker.fetch(rpc(call), { SAMPLAS_INTERNAL_TOKEN: "secret" });
  assert.deepEqual(await res.json(), { jsonrpc: "2.0", id: 7, result: { tools: [] } });
  assert.equal(seen.url, "https://samplas-marketing-os.onrender.com/api/ai-audit/popup/mcp");
  assert.equal(seen.init.headers["x-samplas-internal-token"], "secret");
  assert.equal(seen.init.headers["x-popup-mcp-user"], "user-1");
});

test("refuses unauthenticated users, non-owners and missing setup; upstream failure is an error", async () => {
  const worker = createWorker({ fetchImpl: async () => { throw new Error("timeout"); } });
  const toolCall = { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "listPopupProjects", arguments: {} } };
  const anonymous = await worker.fetch(rpc(toolCall, ""), { SAMPLAS_INTERNAL_TOKEN: "s" });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, -32001);
  assert.equal((await (await worker.fetch(rpc(toolCall), { SAMPLAS_INTERNAL_TOKEN: "s", POPUP_PLUGIN_OWNER_IDS: "other" })).json()).error.code, -32003);
  assert.equal((await (await worker.fetch(rpc(call), {})).json()).error.code, -32002);
  const failed = await (await worker.fetch(rpc(call), { SAMPLAS_INTERNAL_TOKEN: "s" })).json();
  assert.equal(failed.error.code, -32000);
  assert.equal(failed.result, undefined);
});

test("answers initialize and ping locally, like Render, without a user, secret or upstream call", async () => {
  const worker = createWorker({ fetchImpl: async () => { throw new Error("must not call upstream"); } });
  for (const version of ["2025-06-18", "1999-01-01"]) {
    const message = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } } };
    const res = await worker.fetch(rpc(message, ""), {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), await popupRpc(message, {}));
  }
  assert.deepEqual(await (await worker.fetch(rpc({ jsonrpc: "2.0", id: "p", method: "ping" }, ""), {})).json(), { jsonrpc: "2.0", id: "p", result: {} });
  assert.equal((await worker.fetch(rpc({ jsonrpc: "2.0", id: null, method: "initialize" }, ""), {})).status, 400);
});

test("lists tools without a user id, forwarding with the secret and an empty user header", async () => {
  let seen;
  const worker = createWorker({ fetchImpl: async (url, init) => { seen = init; return Response.json({ jsonrpc: "2.0", id: 7, result: { tools: [{ name: "listPopupProjects" }] } }); } });
  const res = await worker.fetch(rpc(call, ""), { SAMPLAS_INTERNAL_TOKEN: "secret", POPUP_PLUGIN_OWNER_IDS: "owner" });
  assert.deepEqual((await res.json()).result.tools.map((t) => t.name), ["listPopupProjects"]);
  assert.equal(seen.headers["x-samplas-internal-token"], "secret");
  assert.equal(seen.headers["x-popup-mcp-user"], "");
});
