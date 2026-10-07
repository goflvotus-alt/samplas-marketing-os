# Production REST read auth hardening (2026-10-07)

Local implementation, tests and commit only. Not pushed or deployed; no Render env change.

## A. REST route inventory

105 `/api/` routes: 71 in `server.mjs`, the rest in `intelligence-service.mjs`, which is reached through the `/api/intelligence/` and `/api/inventory/` handlers.

| Class | Routes | Before | After |
|---|---|---|---|
| PUBLIC | `/healthz` (not under /api), static UI (`/`, `/outputs/`), `/api/operator/session` (login), `/api/cafe24/oauth/callback`, `/api/meta/oauth/callback` | anonymous | anonymous (explicit allowlist) |
| OWN AUTH | `/api/ai-audit/` prefix | `AI_AUDIT_SECRET` | unchanged (passes the gate, keeps its own check) |
| INTERNAL_READ | sales/total, reports/monthly (+archive, comparison-cutoff), products/dashboard, diagnostics/*, intelligence/* (clients, brands, resolve, commercial-policy, product-registry, price-audit, missions, brief, decisions, timeline, learning, naver, store, category/color master…), inventory/*, advertising/overview, meta-ads/*, instagram/*, cafe24 brands/orders/products/categories/benefits/health/brand-products/full-catalog, brand-master GET, brands/new, pending-brands GET, ecount-sales/monthly, status, contents/cardnews-status, veil-found/publisher/status, promotion/* | **anonymous** | session, Basic or loopback |
| OPERATOR_WRITE | pending refresh/review/split/split-restore, rekey, brand-attribution-rebuild, ecount-sales/import, cafe24/csv/import, work-data/upload, brand-master POST, category-review PATCH, cafe24 refresh-token, ecount sync, veil-found run, weekly run, OAuth start | route-level internal/operator checks; some (OAuth start, refresh-token) had none | gate plus unchanged route-level checks |
| MCP_INTERNAL | the 10 MCP upstream GETs (sales/total, reports/monthly, intelligence/clients, brands/resolve, brand-master, commercial-policy, brands/new, pending-brands, inventory/overview, advertising/overview) | anonymous | loopback (the MCP upstream calls `127.0.0.1`) |

## B. Current anonymous exposure (Production, before this change)

Shape only; no values recorded:

| Route | Status | What is exposed |
|---|---|---|
| `/api/intelligence/clients` | 200 | summary plus `stylistTop10` / `pressTop10` with `clientId`, `name`, `products`, `purchaseDateCounts`, `salesAmount`. **Named individuals with purchase history.** |
| `/api/sales/total` | 200 | online, offline (by store) and total sales |
| `/api/inventory/overview` | 200 | stock summary and a brand rollup (35 brands) |
| `/api/advertising/overview` | 200 | channel spend, CPC/CPM/CTR, ROAS |
| policy, brand-master, pending, brands/new, resolve, monthly | 200 | (confirmed earlier today) |

## C. Browser UI dependencies

- The UI is `outputs/samplas-marketing-os.html` plus `.js`.
- Every API call goes through `fetchJson` (GET), `postJson` or `patchJson`, plus the dedicated ECOUNT upload and the OAuth-start navigations.
- The operator login already exists: `POST /api/operator/session` with `SAMPLAS_OPERATOR_BASIC_AUTH` typed in by the operator. It sets an HttpOnly, SameSite=Strict, 8-hour cookie, and the session is held in server memory.
- **Change:** all three helpers go through `fetchWithOperatorSession`. On the first 401 under `/api/` (except the AI audit prefix) it runs one shared login prompt for all concurrent requests, then retries once with a fresh timeout, because `window.prompt` blocks the page.
- No credential is placed in the bundle. A test asserts this.
- OAuth start links are same-site navigations, so the cookie is sent.
- Locally (127.0.0.1) the server allows loopback, so no prompt appears.

## D. Internal callers

| Caller | Auth |
|---|---|
| Local scripts → Render (price audit, probes, CSV and snapshot upload, deploy check, alias apply) | `CAFE24_PROXY_BASIC_AUTH`, unchanged |
| Local server → Render proxy | Basic |
| Launcher / autostart health (`127.0.0.1:8787/api/status`) | loopback |
| In-process jobs (weekly reports, ECOUNT auto-sync, schedulers) | no HTTP |
| ECOUNT one-click | local loopback, then Basic upload |

## E. MCP dependencies

- The MCP upstream client calls `http://127.0.0.1:${PORT}` with no credentials.
- Under the gate these requests are local by socket and Host, so they are allowed.
- No MCP token is reused for REST.
- When MCP moves to OAuth, the flow is ChatGPT → OAuth-checked `/mcp` → loopback upstream, and needs no change.
- Verified locally: `tools/call get_brand` with a non-local Host returned 200 and the data, while anonymous REST on the same server returned 401.

## F. Recommended auth model

**Option C**, built from existing credentials only; no new secret:
- browser = same-origin operator session (HttpOnly cookie)
- services and scripts = `CAFE24_PROXY_BASIC_AUTH`
- in-process MCP upstream = loopback
- AI audit = its own secret
- MCP = (future) OAuth

Implemented as a default-deny gate on every `/api/` path, placed right after `/healthz` and `/mcp` in the handler.

Hardening of `isLocalRequest`: "local" now needs **both** a local Host header and a loopback socket (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). Before, a client could claim locality by sending `Host: localhost`. This affected the existing write routes too.

## G. Public allowlist

`PUBLIC_API_PATHS` contains exact paths only:
- `/api/operator/session`
- `/api/cafe24/oauth/callback`
- `/api/meta/oauth/callback`

The `/api/ai-audit/` prefix is passed through to its own check. `/healthz`, `/mcp`, `/.well-known/…` and static files are outside `/api/`. Everything else under `/api/` is denied by default.

Rollback switch: `API_READ_AUTH=off` disables the gate. Route-level checks remain.

## H. Implementation

- `server.mjs`: gate, `isApiRequestAllowed` (exported for tests), `hasOperatorSession` (shared with `isAuthorizedOperatorAction`), stricter `isLocalRequest`.
- `outputs/samplas-marketing-os.js`: `ensureOperatorSession` / `fetchWithOperatorSession` used by `fetchJson`, `postJson` and `patchJson`.

## I. Tests

- `test/api-read-auth.test.mjs`:
  - Decision tests: allowlist; AI audit prefix; forged `Host: localhost` from a remote socket is not local; legacy token not accepted; rollback switch.
  - Spawned server: `/healthz` 200. Anonymous `/api/brand-master`, clients, status and sales return 401. Wrong Basic and a forged cookie return 401. Correct Basic returns 200. The proxy Basic credential cannot log in as operator (401). The operator login returns 200 with an HttpOnly, SameSite=Strict cookie, and the session reads 200. The AI audit route rejects both the session and Basic.
  - Bundle: all three helpers use the retry, and no credential names appear.
- Updated tests: pending HTTP tests now assert anonymous read 401 and authenticated read 200; the split-runner source check follows the shared `hasOperatorSession`.
- The `jose` dependency (declared in package.json, missing locally) was restored with `npm install --no-save`, so `mcp-route` / `mcp-read-tools` now run: 33/33.
- Full suite: all pass.

## Rollout prerequisites (before deploy)

1. `SAMPLAS_OPERATOR_BASIC_AUTH` must be set on Render. Otherwise browser users cannot log in, and the UI would show 401s until `API_READ_AUTH=off` is set.
2. Operator sessions live in memory: every deploy or restart requires the operator to log in again (one prompt).
3. After deploy, check:
   - anonymous GETs on the routes in B return 401
   - Basic GET returns 200
   - UI login, then the main screens load
   - MCP `tools/list` and one `tools/call` still work (loopback)
   - AI audit secret returns 200
   - `/healthz` returns 200

## Out of scope / remaining

- MCP itself is still `none` mode (separate OAuth track).
- `/outputs/` serves documentation and `.command` files publicly; no credentials were found there, but they could be reviewed separately.
