import test from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../popup-plugin/worker/index.mjs";

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
  assert.equal((await worker.fetch(rpc(call, ""), { SAMPLAS_INTERNAL_TOKEN: "s" })).status, 401);
  assert.equal((await (await worker.fetch(rpc(call), { SAMPLAS_INTERNAL_TOKEN: "s", POPUP_PLUGIN_OWNER_IDS: "other" })).json()).error.code, -32003);
  assert.equal((await (await worker.fetch(rpc(call), {})).json()).error.code, -32002);
  const failed = await (await worker.fetch(rpc(call), { SAMPLAS_INTERNAL_TOKEN: "s" })).json();
  assert.equal(failed.error.code, -32000);
  assert.equal(failed.result, undefined);
});
