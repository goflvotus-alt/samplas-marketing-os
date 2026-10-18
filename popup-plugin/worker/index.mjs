// SAMPLAS Popup Projects — private ChatGPT connector (ChatGPT Sites worker, slug samplas-popup-project).
// Forwards MCP JSON-RPC to Marketing OS POST /api/ai-audit/popup/mcp. Tool list, validation, versions,
// write switch and read-back all live on Marketing OS, so adding a tool needs a Render deploy only.
//   env.SAMPLAS_INTERNAL_TOKEN   the secret this site already holds (sent as x-samplas-internal-token)
//   env.POPUP_MCP_ENDPOINT       optional; defaults to the production Render endpoint below
//   env.POPUP_PLUGIN_OWNER_IDS   optional comma list of allowed ChatGPT user ids; when set, everyone else is refused
// A failed or ambiguous upstream call is reported as an error, never as success.
const DEFAULT_ENDPOINT = "https://samplas-marketing-os.onrender.com/api/ai-audit/popup/mcp";
const MAX_BYTES = 1_000_000;
const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const rpcError = (id, code, message, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
// The Sites OAuth gate admits only signed-in, allowed users. The worker answers the handshake itself (Render's free plan
// can take a minute to wake up) and, like the original bridge, lists tools without a user id. Every tool call needs one.
// Keep PROTOCOLS, SERVER_INFO and INSTRUCTIONS in step with scripts/popup-mcp.mjs (test/popup-plugin-worker.test.mjs checks it).
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "samplas-popup-director", version: "2.0.0" };
const INSTRUCTIONS = "Private SAMPLAS POPUP DIRECTOR. Read (getPopupProject) before editing and send only the change with expectedVersion. Write only what the user asked; never invent budget, venue or brand. Delete only after explicit confirmation. Never retry a conflict or an unconfirmed write automatically; only verified:true means saved.";
const OPEN_METHODS = new Set(["tools/list"]);
const OWNER_ID = /^[A-Za-z0-9_.:@-]{1,120}$/;

// undefined when not configured (no owner filter), null when malformed (refuse everyone), else the set.
export function pluginOwners(value) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") return null;
  const ids = value.split(",").map((s) => s.trim());
  return ids.length && ids.every((id) => OWNER_ID.test(id)) ? new Set(ids) : null;
}

export function createWorker({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === "/") return new Response("SAMPLAS Popup Projects · private ChatGPT connector", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404);
      if (request.method !== "POST") return json({ error: "POST required" }, 405);
      if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return json({ error: "request_too_large" }, 413);
      let text, rpc;
      try {
        text = await request.text();
        if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: "request_too_large" }, 413);
        rpc = JSON.parse(text);
      } catch { return rpcError(null, -32700, "Parse error", 400); }
      if (!rpc || Array.isArray(rpc) || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return rpcError(rpc?.id, -32600, "Invalid Request", 400);
      if (rpc.method === "notifications/initialized" && !Object.hasOwn(rpc, "id")) return json(null, 202);
      if (rpc.method === "initialize" || rpc.method === "ping") {
        if (!(typeof rpc.id === "string" || (typeof rpc.id === "number" && Number.isFinite(rpc.id)))) return rpcError(null, -32600, "Invalid id", 400);
        const version = rpc.params?.protocolVersion;
        return json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "ping" ? {} : {
          protocolVersion: PROTOCOLS.includes(version) ? version : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } });
      }

      const user = request.headers.get("oai-authenticated-user-id") || "";
      if (!OPEN_METHODS.has(rpc.method)) {
        if (!user) return rpcError(rpc.id, -32001, "Authentication required", 401);
        const owners = pluginOwners(env.POPUP_PLUGIN_OWNER_IDS);
        if (owners === null) return rpcError(rpc.id, -32003, "This connector has an invalid owner setting", 403);
        if (owners && !owners.has(user)) return rpcError(rpc.id, -32003, "This connector is limited to its owner", 403);
      }
      if (!env.SAMPLAS_INTERNAL_TOKEN) return rpcError(rpc.id, -32002, "Setup incomplete: production API secret is not configured.");

      let response;
      try {
        response = await fetchImpl(env.POPUP_MCP_ENDPOINT || DEFAULT_ENDPOINT, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(55000),
          headers: { "Content-Type": "application/json", Accept: "application/json", "x-samplas-internal-token": env.SAMPLAS_INTERNAL_TOKEN,
            "x-popup-mcp-user": user.replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, 120) },
          body: text
        });
      } catch {
        return rpcError(rpc.id, -32000, "POPUP DIRECTOR did not answer in time. A write may or may not have been saved: read the project (getPopupProject) and check its changeLog before retrying with the same opId.");
      }
      if (response.status === 202) return json(null, 202);
      if (!response.ok) return rpcError(rpc.id, -32000, `POPUP DIRECTOR request failed (HTTP ${response.status}). Read the current state before retrying an update.`);
      let result;
      try { result = await response.json(); } catch { return rpcError(rpc.id, -32000, "POPUP DIRECTOR returned an invalid response. Read the current state before retrying an update."); }
      if (result?.jsonrpc !== "2.0" || result.id !== rpc.id) return rpcError(rpc.id, -32000, "POPUP DIRECTOR returned an invalid response.");
      return json(result);
    }
  };
}

export default createWorker();
