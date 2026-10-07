# SEEDING Production API
Render is the sole application writer. SEEDING storage is separate from POPUP:
`/SAMPLAS WORK/병구 작업/시딩 관련 자동화/SEEDING_DIRECTOR_LITE/seeding.json`.
Existing Dropbox OAuth helpers are reused; POPUP handlers and data are unchanged.
All three routes require existing `AI_AUDIT_SECRET` in `x-samplas-internal-token`.
GETs never write. PUT validates the whole batch before modifying a clone and uploads once with Dropbox `mode:update` and the read `rev`. Project version and `updatedAt` are server-controlled.
`version` is required; mismatch or concurrent Dropbox revision change returns 409 with currentVersion. Malformed/unknown operations and disallowed fields return 400; absent project returns 404. No full-document HTTP replacement is supported.
Operations: update_seeding, add_seeding, remove_seeding, update_project, add_creator_to_project; update_creator permits Creator memo only to preserve existing UI.
Handles: trim, remove leading @, lowercase; duplicate project members rejected. Removed records do not delete reusable creators. Project rename checks uniqueness.
Tracking registration marks shipped and fills only an absent shippedAt. deliveredAt takes deadline priority (+7); shipping and upload fields are never changed by a form-only patch. Explicit postUrl/completion is manual confirmation. Automatic upload statuses use Seoul dates; manual states are retained.
List responses contain counts only, no recipient phone/address. Detail is authenticated and contains recipient information. Responses use Cache-Control:no-store; detail/PUT ETag is the project version, while Dropbox rev is the stronger storage CAS guard.
## Migration / rollback
Operator command: `node scripts/migrate-seeding.mjs <private-prepared-json> <private-env>`.
Only actual MEANTIME is accepted by the initial import. Existing destination is not overwritten; add-mode storage conflict aborts. Private recipient data and credentials are not committed.
The local app keeps the original localStorage document under `samplas-seeding-lite-v1-production-migration-backup`; the private extracted source stays in `.runtime/migration-source.json`. No original record is deleted.
Rolling back code does not roll back operational data. Before any deliberate data rollback, export the current Dropbox rev document; never restore a stale local cache over production.
## Frontend
Loopback Python proxy attaches token server-side. Production GET success replaces browser cache. Offline data is read-only; failed writes and 409 never retry a cache/document overwrite. Refresh explicitly fetches latest server data. Existing Sheet/tracking transports stay local; their validated changes go through operation PUT. New project creation is outside the initial three-route contract and is disabled in production mode.
