# Private SEEDING MCP

Endpoint: `https://samplas-marketing-os.onrender.com/api/ai-audit/seeding/mcp`

Stateless Streamable HTTP, POST JSON-RPC 2.0, JSON responses (no SSE/session). GET returns 405. Supports initialize, initialized notification, ping, tools/list, tools/call. Separate serverInfo `samplas-seeding-projects`; no changes to Popup MCP or the existing read-only `/mcp`.

Every request requires existing `x-samplas-internal-token` matching Render `AI_AUDIT_SECRET`. An authenticated plugin's server must inject its server-side `SAMPLAS_INTERNAL_TOKEN` as that header. Never put the value in source, manifests, tool arguments, or frontend code. This endpoint does not provide an OAuth authorization server; a ChatGPT connection that supports only OAuth needs its own private server-side OAuth bridge, like the existing Popup Sites plugin. Do not enter an internal token into chat or invent OAuth metadata to bypass authentication.

Tools (exactly three):
- `listSeedingProjects({})`: GET projects, metadata/counts only.
- `getSeedingProject({name})`: GET project; private recipient detail only on explicit detail calls.
- `updateSeedingProject({name,version,operations})`: exact existing PUT body `{version,operations}` and query `name`. Operations/patch validation reuses `validatePayload`, not a second contract. Name is URL encoded.

Update reads latest before PUT, returns conflict without PUT when supplied version is stale; on PUT 409, reads again and returns conflict/latest. No retry. After PUT 200, GET verifies the result. Rename uses returned name. Failed or different readback does not claim verified success. Ambiguous PUT network failures require GET before another attempt.

REST owns all storage writes, project validation/version, Dropbox rev CAS and allowlists. The MCP upstream has only two fixed SEEDING REST paths and rejects redirects. No data/headers/secret/exception contents are logged. Authenticated list fails closed on unexpected top-level project fields.

Validation: `node --test test/seeding-mcp.test.mjs test/seeding-store.test.mjs test/mcp-*.test.mjs`.
Production smoke: use the server-held credential; GET before/after a same-value `update_project` operation. Only version/updatedAt may change. Verify stale 409 and invalid 400 and leave no fabricated recipient/memo/check-in data.
