# SAMPLAS Popup Projects — private ChatGPT connector (Sites worker)

`worker/index.mjs` replaces the hand-written tool code of the existing Sites app `samplas-popup-project`
(`https://samplas-popup-project.goflvotus.chatgpt.site/mcp`, project `appgprj_6ac2168504c08191804152e7cbab5c68`).
It forwards MCP JSON-RPC to Marketing OS `POST /api/ai-audit/popup/mcp` (`scripts/popup-mcp.mjs`).

- **Tools** come from Marketing OS `tools/list`. Adding or changing a tool needs a Render deploy only, not a Sites redeploy.
- **Compatible:** `listPopupProjects`, `getPopupProject` and `updatePopupProject` keep their names. `updatePopupProject` still accepts the old `{name, body: {project, expectedVersion}}` form.
- **Secret:** the site's existing `SAMPLAS_INTERNAL_TOKEN`, sent as `x-samplas-internal-token`. It is never logged or returned.
- **Auth:** the site is private, so the Sites OAuth gate answers every unauthenticated request with a plain-text 401 before the worker runs.
- **Handshake:** the worker answers `initialize` and `ping` itself, so ChatGPT does not wait for Render to wake up.
- **Tool list:** `tools/list` is answered without a user id, as in the original bridge.
- **Tool calls:** `tools/call` and every other method need `oai-authenticated-user-id`. When `POPUP_PLUGIN_OWNER_IDS` is set, only those ids are allowed.
- **Errors:** an unreachable, non-2xx or malformed upstream reply becomes a JSON-RPC error. It is never reported as success.

Environment: `SAMPLAS_INTERNAL_TOKEN` (already set), optional `POPUP_MCP_ENDPOINT`, optional `POPUP_PLUGIN_OWNER_IDS`.

## Redeploy (Codex, Sites tools)

Order: deploy Marketing OS first, check that `POST /api/ai-audit/popup/mcp` answers `tools/list`, then redeploy the site.

1. Open the existing Sites project `samplas-popup-project` (do not create a new one).
2. Replace `worker/index.js` with the content of `popup-plugin/worker/index.mjs`. The default export is unchanged in shape: `{ fetch(request, env) }`.
3. Keep every environment variable and secret as it is.
4. Build, validate and deploy to production.
5. An unauthenticated direct request must get the gate's plain-text 401 with `www-authenticate: Bearer resource_metadata=...`. A JSON body here means the gate is open: roll back. A direct request cannot test the worker itself.
6. In ChatGPT, refresh the "SAMPLAS Popup Projects" connector. It must show 7 tools, and `listPopupProjects` must answer. If either fails, deploy the previous version again.
