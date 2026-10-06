# SAMPLAS Marketing OS Plugin — Phase 1 Read-only Implementation Plan

- Date: 2026-10-06 (file name keeps the spec date 2026-10-04)
- Spec: `docs/superpowers/specs/2026-10-04-samplas-marketing-os-chatgpt-plugin-design.md` (`e4aec67`, approved)
- Basis: `origin/main` `c090864`. Response shapes were checked read-only against Production on 2026-10-06.
- Scope: Phase 1 only. It covers 10 read tools and the `samplas.read` scope, and makes no Production mutation of any kind.

---

## 0. Verified platform facts (2026-10-06)

| Fact | Source |
|---|---|
| ChatGPT "apps" were renamed "plugins" in July 2026. A plugin is a folder with a `plugin.json` manifest that bundles an MCP server, skills, or both. | OpenAI "Package your plugin"; MCPJam, harness.institute |
| Portable layout: `plugin.json` (`$schema`, `name`, `version`, `description`), optional root `mcp.json` with `mcpServers.<name> = { "type": "streamable-http", "url": "https://…/mcp" }`, and optional `skills/`. Skills are optional. | developers.openai.com/plugins/build/plugins |
| Private distribution: a personal marketplace (`~/.agents/plugins/marketplace.json`), a repo marketplace, or ChatGPT **Plugins → Personal → Publish** for a workspace-only plugin. `@plugin-creator` (ChatGPT) and `$plugin-creator` (Codex) scaffold the package. | developers.openai.com/plugins/build/plugins |
| Plugin MCP auth is **OAuth 2.1 only**; static bearer tokens and API keys are not supported. | developers.openai.com/plugins/build/auth |
| The server must serve `/.well-known/oauth-protected-resource`. The authorization server must publish `/.well-known/oauth-authorization-server`, support PKCE S256, and use client registration by CIMD (preferred), DCR, or a predefined client. The `resource` parameter is echoed into the token. The server verifies signature (JWKS), issuer, audience, expiry and scopes. | developers.openai.com/plugins/build/auth |
| Each tool declares `securitySchemes` (`oauth2` with scopes). ChatGPT shows its login UI only when resource metadata exists **and** the tool error carries `_meta["mcp/www_authenticate"]`. | developers.openai.com/plugins/build/auth |
| Developer mode can also add a custom MCP URL directly. Feature level varies by plan; one third-party source says Pro gets read/fetch only. Read-only Phase 1 fits either way. | help.openai.com 12584461; coworker.ai |

Task 0 re-checks these items on the operator's actual account before any code is written.

## 1. Implementation approach

- **Gateway placement: an in-process module inside Marketing OS.** It is mounted at `/mcp` and sits behind `MCP_ENABLED=on` (default off). There is no new Render service.
  - The approved spec §4.2 recommends a separate gateway service. This plan deliberately changes that for Phase 1 (see §2), and the change needs operator approval.
- The module calls the existing canonical GET routes over **loopback HTTP** (`http://127.0.0.1:$PORT`).
  - Every number comes from the same route handler the UI uses.
  - No route handler is imported, refactored or duplicated.
- The gateway code is **GET-only with a path allowlist**. It cannot reach any POST, PATCH or local-only route.
- Responses are trimmed and wrapped in the spec §6.1 envelope. The module recalculates nothing.
- Phase 1 adds **no** Production agent tokens. Every upstream route used is an existing public GET. Agent tokens (spec §5.2) arrive in Phase 2 together with the write routes.

## 2. Gateway placement decision

| Option | Cost | Safety | Verdict |
|---|---|---|---|
| **In-process `/mcp` module in Marketing OS** | No new service, no new deploy pipeline, one cold start | GET-only allowlist, env-gated, isolated in `scripts/mcp/` | **Chosen** |
| Separate gateway service (spec §4.2) | A new Render service. On the free plan both services sleep, so the first ChatGPT call pays two cold starts (gateway + Production); avoiding that needs a paid always-on instance | Strongest isolation | Deferred. Revisit at Phase 2 if the in-process module's memory or coupling becomes a problem. |
| Plugin talks to Production endpoints directly | — | Impossible: the plugin needs an MCP server, and the existing routes are REST without OAuth | Rejected |

Why the spec's two objections are acceptable for Phase 1:
1. **Memory and restarts.** The old restarts came from the inventory hot path, which `c090864` fixed (Production 1.88 s, no restart). The new code adds the MCP SDK and `jose` only. Task 7 measures RSS before and after; the gate is an increase below 40 MB.
2. **Redeploy coupling.** `MCP_ENABLED=off` makes the module inert, and the code lives in its own folder. Moving it to a separate service later only changes `MCP_UPSTREAM_BASE_URL`.

**Spec amendments this plan carries (Phase 1 only):**
- §4.2 / §19: the gateway runs in-process instead of as a separate service.
- §5.2 / §15: no `AGENT_READ_TOKEN` and no `/api/agent/health` in Phase 1.
- §6.2 `get_brand`: the optional period performance is deferred.

All other parts of the spec stand.

## 3. Authentication plan

| Item | Plan |
|---|---|
| ChatGPT → `/mcp` | OAuth 2.1 bearer access token (JWT). It is required on every MCP request in Production. |
| Authorization server | Auth0 tenant (managed; no in-house login code). Configuration: one API (resource), identifier `https://samplas-marketing-os.onrender.com/mcp`, RS256, **one permission only: `samplas.read`**, RBAC with permissions added to the access token, DCR enabled for ChatGPT, public sign-up disabled, the single operator account assigned `samplas.read`. Exact Auth0 setting names are confirmed against Auth0 docs during Task 11; this plan does not guess them. |
| Why `samplas.propose` / `samplas.apply` cannot leak | They are not created in Auth0 in Phase 1, so no token can carry them. The server also declares only `samplas.read` in metadata and tool `securitySchemes`. |
| Token verification | `jose` `createRemoteJWKSet(OAUTH_ISSUER/.well-known/jwks.json)` + `jwtVerify` with `issuer`, `audience = MCP_RESOURCE_URL`, `algorithms: ["RS256"]`, 60 s clock tolerance. The `scope` (or `permissions`) claim must contain `samplas.read`. `sub` must appear in `MCP_ALLOWED_SUBJECTS`, a second lock so that an extra Auth0 user still cannot read. |
| Invalid or missing token | HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="<MCP_RESOURCE_URL origin>/.well-known/oauth-protected-resource", scope="samplas.read"`. A tool-level error returns `AUTH_REQUIRED` with `_meta["mcp/www_authenticate"]`. A valid token without the scope or with a subject not on the allowlist also returns `AUTH_REQUIRED`, with `error="insufficient_scope"`. |
| Secret storage | Render env, `sync: false`: `MCP_ENABLED`, `MCP_RESOURCE_URL`, `OAUTH_ISSUER`, `MCP_ALLOWED_SUBJECTS`. The JWKS is public, so there is **no shared secret** in Phase 1. Local `.env` holds the same keys for local runs. |
| Rotation | Signing keys rotate in Auth0; JWKS caching in `jose` picks them up. Revoking access means removing the user's grant in Auth0, or removing `sub` from `MCP_ALLOWED_SUBJECTS` and redeploying. |
| Local development | `MCP_AUTH_MODE=dev-noauth` is honored only when `process.env.RENDER` is unset **and** the request comes from loopback (`isLocalRequest`). Production always verifies tokens. |
| Existing auth | It is unchanged. `CAFE24_PROXY_*`, `AI_AUDIT_SECRET`, the operator session and the local helper are not touched or reused. |

## 4. Tool contract (10 read tools)

Common to all tools:
- **Authentication:** OAuth `samplas.read`.
- **Upstream:** loopback GET, 20 s timeout, at most **2 upstream calls in flight** (one semaphore), no retries inside the tool.
- **Envelope:** spec §6.1: `{ ok, tool, data, freshness: { dataAsOf, source, requestedPeriod?, coverage }, notes }`.
- **Coverage:** a `COVERAGE_INCOMPLETE` warning is added to `notes` (not an error) whenever the upstream coverage says incomplete.

### 4.1 Per-tool table

| Tool | Arguments | Backing endpoint(s) | Response transformation | Freshness | Coverage | Error mapping (beyond §5) | Tests |
|---|---|---|---|---|---|---|---|
| `get_sales_summary` | `since`, `until` (YYYY-MM-DD, required); `store?` (`APGUJEONG`/`VAIL`) | `GET /api/sales/total` | Pass through `onlineSales.paidAmount`, `offlineSales.offlineSalesAmount`, `offlineSales.byStore`, `totalSales.amount` | `dataAsOf: null` with the note "source has no timestamp"; `requestedPeriod` = args; `availablePeriod` = `periodStart..periodEnd` | `coverage` verbatim | `since > until` → `VALIDATION_FAILED` | fixture complete / partial / missing; numbers equal the fixture |
| `get_monthly_report` | `month` (YYYY-MM) | `GET /api/reports/monthly?month=` | Keep `status`, `archiveStatus`, `sales`, `commerce` (`brandSales` and `productSales` capped at 10), `marketing` (`attentionCampaigns` capped at 10), `content` (`topContent` capped at 5, `aboveAverageSaveRatePosts` dropped); drop `provenance` detail except `ecount`/`cafe24` timestamps | `dataAsOf = generatedAt` | `sales.coverage`, `status` (`draft` is noted) | upstream 400 `Invalid month` → `VALIDATION_FAILED` | trimming caps; draft note |
| `get_clients_summary` | `since`, `until`, `store?`, `includeClients?` (default false), `limit?` (≤ 50, default 20) | `GET /api/intelligence/clients` | Keep `summary`, `typeBreakdown`, `stylistTop10`, `pressTop10`, `ffTop10`, `accounting`; `clients` only when `includeClients`, sliced to `limit` in upstream order | `dataAsOf: null` + note; `availablePeriod` from `periodStart/periodEnd` | `coverage`, `storeCoverage` | — | client rows absent by default; cap |
| `get_foreign_sales` | `since`, `until`; `compareSince?`, `compareUntil?` (both or neither); `store?` | `GET /api/intelligence/clients` (one call per period, run sequentially) | Per period: the `typeBreakdown` row with `type === "foreign"` (`salesAmount`, `purchaseCount`, `clientCount`, `ratioPct`, `label`) **as is**. See §6 for the missing-data rule. | per period: `requestedPeriod`, `availablePeriod`, `dataAsOf: null` + note | per period: `includedMonths`, `partialMonths`, `missingMonths`, `completeness` (`COMPLETE` / `PARTIAL` / `UNAVAILABLE`) | `foreign` row absent → `UPSTREAM_UNAVAILABLE` (contract break, never 0) | §8 foreign cases |
| `get_inventory` | `view?` (`summary` default / `items` / `brands`); `status?` (`in_stock`, `depleted_candidate`, `negative_review`, `unknown`, `qqq_estimated_sale`, `location_unknown`); `brandKey?`; `search?`; `sort?` (`stock-asc`, `stock-desc`, `recent-sales-desc`); `limit?` (≤ 100, default 20); `offset?` | `GET /api/inventory/overview` with `status`, `brand=brandKey`, `search`, `sort`, `limit`, `offset` passed through. The upstream filters; the gateway does not. | `summary`: `summary` + `coverage` + `operations.negativeInventory` (`topByUnits` capped at 10). `items`: `itemsTotal`, `offset`, `limit` + items reduced to 10 fields (`brandKey`, `brandName`, `productName`, `prodCd`, `stockQuantity`, `status`, `recentSalesQty`, `lastSaleDate`, `salesPrice`, `daysOfSupply`). `brands`: `brandRollup` entries; if `status=negative_review`, keep entries with `negativeReviewCount > 0`, ordered by `negativeUnits` desc; top `limit` | `dataAsOf = generatedAt`; `salesDataAsOf` | `coverage` (stock known / unknown, location unknown); note when `stockUnknownItems > 0` | — | default call never asks for more than 20 items; the upstream URL always has `limit`; negative view; pagination `offset` |
| `get_brand` | `brand` (name or code) | `GET /api/intelligence/brands/resolve?name=` → `brandId`; then `GET /api/brand-master` (entry with `brand_code === brandId`), `GET /api/intelligence/commercial-policy?brand_code=`, `GET /api/brands/new` (entry with `brandCode === brandId`, if any), `GET /api/pending-brands` (candidates with `sourceBrandCode === brandId`) | Compose: identity (`brand_code`, `brand_name`, `name_aliases`, `active`, `sourcing_type`); policy (`policy_status`, `stylist_discount_percent`, `discount_status`, `effective_policy`); NEW status (the `/api/brands/new` row verbatim: Cafe24, NAVER, `operationStatusLabel`), or `isNew: false`; pending candidates (`id`, `status`, `reviewReason`). Only equality joins on a brand code; no matching logic. | `brandMaster.updatedAt`, `newBrands.asOf`, `newBrands.coverage.naverCheckedAt`, `pending.updatedAt` | NAVER `naverError` → note | `brand: null` from resolve → `NOT_FOUND` (with the hint "see get_pending_brands") | RECORDS INC fixture (NAVER 미등록, 18/18/16); not-found |
| `get_pending_brands` | `status?` (`PENDING` default, `APPROVED`, `all`); `reviewReason?` | `GET /api/pending-brands` | Rows: `id`, `rawBrandName`, `sourceBrandCode`, `status`, `reviewReason`, `uiReview.operationalClass`, `uiReview.recommendedUiAction`, `relatedProductCount`; plus counts per `reviewReason`. Selection by equality only. | `updatedAt`, `provenance.ecountProductsAt`, `provenance.cafe24BrandsFetchedAt` | `provenance.ecountAvailable` false → note | — | PERSONSOUL / UNDER THE SIGN / PRAYING appear as `INACTIVE_CODE_REUSED` |
| `get_new_brands` | `operationStatus?` (`NEW_BRAND_ARRIVED`/`NAVER_MISSING`/`COMPLETE`) | `GET /api/brands/new` | `count`, `statusCounts`, rows verbatim (Korean label included), optional equality filter on `operationStatus` | `asOf`, `coverage.naverCheckedAt` | `coverage.naverError` → note "NAVER 확인 불가"; `cafe24.checked === false` rows are noted | — | `NAVER_MISSING` filter returns RECORDS INC only; labels unchanged |
| `get_advertising_summary` | `since`, `until` | `GET /api/advertising/overview` | Per channel (`meta`, `naver`): `status`, `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm`, `platformConversions`, `platformConversionValue`, `platformRoas`, `platformCpa`, `issues`; `actualCommerce` kept as returned (null); `notes` | `period` per channel | `status !== "available"` or non-empty `issues` → `COVERAGE_INCOMPLETE` note per channel | — | both channels; one channel unavailable; fields pass through unchanged |
| `get_commercial_policy` | `brand?` (name) **or** `brandCode?`; neither → list mode with `status?` (`EXPLICIT_POLICY`/`SOURCING_DEFAULT`/`REVIEW_REQUIRED`), `discountPercent?`, `limit?` (≤ 100) | `GET /api/intelligence/commercial-policy` (`?name=` / `?brand_code=` / list) | Single: `found`, `policy_status`, `policy` (without `product_rules` beyond 10), `effective_policy`, `fallback`. List: equality filter on existing fields, rows `brand_code`, `canonical_brand_name`, `sourcing_type`, `stylist_discount_percent`, `discount_status`, `policy_status` | `policy.source` | — | `found: false` → `NOT_FOUND` | AE SYNCTX → `EXPLICIT_POLICY` 10 |

`get_change_history` is Phase 2 and is **not** registered in Phase 1. The tool count stays at 10.

### 4.2 What counts as "composition" and what is forbidden

- **Allowed:** trimming, capping, equality selection on fields the upstream already returns, ordering by an upstream numeric field for display, and joining on `brand_code`.
- **Forbidden** (blocked in code review and by tests that pin outputs to fixtures):
  - summing amounts across types, stores or months;
  - re-deriving status, coverage, sellable, NAVER match or discount;
  - name matching other than through `/api/intelligence/brands/resolve`;
  - reclassifying clients.

## 5. Error mapping

| Situation | Tool error code | `retryable` | Notes |
|---|---|---|---|
| Missing, invalid or expired token; wrong audience; missing `samplas.read`; `sub` not allowed | `AUTH_REQUIRED` | no | HTTP 401 at the transport, plus `_meta["mcp/www_authenticate"]` on tool results |
| Argument schema failure (zod), bad date or month, `since > until`, both brand args given | `VALIDATION_FAILED` | no | Raised before any upstream call |
| Upstream 400 | `VALIDATION_FAILED` | no | `message` = upstream `error` string, at most 200 chars |
| Upstream 401 / 403 | `UPSTREAM_UNAVAILABLE` | no | Unexpected for public GETs; logged |
| Upstream 404, resolve `brand: null`, policy `found: false` | `NOT_FOUND` | no | |
| Upstream 5xx, timeout (20 s), connection error, non-JSON or HTML body, JSON without the expected top-level keys | `UPSTREAM_UNAVAILABLE` | yes (except contract breaks) | Body is never forwarded; `details.status` only |
| Coverage incomplete | not an error | — | `ok: true` + `notes: ["COVERAGE_INCOMPLETE: …"]` |

Phase 2 codes (`READ_ONLY`, `STALE_PROPOSAL`, `ALREADY_APPLIED`, `REVIEW_REQUIRED`, `EXPIRED`) are not implemented. `RATE_LIMITED` is not needed: the concurrency cap queues requests instead of rejecting them.

Error shape (spec §11): `{ ok: false, error: { code, message, retryable, details } }`, returned as MCP `isError: true` content with the same JSON in `structuredContent`.

## 6. Coverage handling and the foreign sales rule

`get_foreign_sales` reads only `typeBreakdown[type === "foreign"]` from `/api/intelligence/clients`. The gateway does no TAXFREE logic, no ECOUNT recomputation, no summing of other types and no foreign classification of its own.

For each period, the per-period result is:

```json
{
  "requestedPeriod": { "since": "2025-01-01", "until": "2025-09-30" },
  "availablePeriod": { "since": "2025-01-01", "until": "2025-09-30" },
  "dataAsOf": null,
  "completeness": "UNAVAILABLE",
  "includedMonths": [],
  "partialMonths": [],
  "missingMonths": ["2025-01", "…", "2025-09"],
  "foreign": { "salesAmount": null, "purchaseCount": null, "clientCount": null, "ratioPct": null, "label": "외국인" },
  "notes": ["COVERAGE_INCOMPLETE: offline sales data missing for 2025-01..2025-09 in Production; amount is unavailable, not 0"]
}
```

Rules:
- Read `coverage.offline.includedMonths`, `partialMonths` and `missingMonths` verbatim.
  - Do **not** decide from `coverage.offline.available`. On 2026-10-06 it read `false` for 2026-09 while `includedMonths` held `2026-09` and foreign sales were 15,212,100.
- `includedMonths` empty → `completeness: "UNAVAILABLE"` and every foreign field is `null`, never `0`.
- `includedMonths` non-empty and (`partialMonths` or `missingMonths` non-empty) → `PARTIAL`. The upstream values are shown, with a note listing the months.
- Otherwise → `COMPLETE`.
- `dataAsOf` is `null` because `/api/intelligence/clients` returns no timestamp. The tool description tells ChatGPT to state "as of the latest ECOUNT import".
- With a comparison period, the tool returns both periods side by side and does **not** compute growth or difference when either side is `UNAVAILABLE`. When both sides are available, ChatGPT may compare them in prose; the tool still returns no derived number.

Values observed on 2026-10-06 (used as acceptance expectations, re-read at run time, never hard-coded):
- 2026-01-01..2026-09-30: foreign `salesAmount` 133,480,850, partial `2026-01`, `2026-09`.
- 2025-01-01..2025-09-30: nine missing months.

The same `completeness` derivation (from upstream `complete`, `partialMonths` and `missingMonths` only) is reused for `get_sales_summary` and `get_clients_summary`.

## 7. Payload discipline

| Tool | Default | Hard cap | Mechanism |
|---|---|---|---|
| `get_inventory` | `view=summary`, `limit=20` | 100 items, 100 brand rows | Upstream `limit`/`offset`/`status`/`brand`/`search`/`sort` (existing filters); the URL always carries `limit` |
| `get_clients_summary` | no client rows | 50 rows | `includeClients` flag + slice |
| `get_monthly_report` | headline sections | lists ≤ 10 | Field drop and cap |
| `get_commercial_policy` | single brand | 100 rows | Equality filter + slice |
| `get_pending_brands` | `PENDING` only | 50 rows | Equality filter + slice |
| all | — | 200 KB serialized | Final guard: trims the largest array and adds `notes: ["truncated: N of M"]` |

"음수 재고 브랜드 보여줘" → `get_inventory({ view: "brands", status: "negative_review", limit: 20 })`. The upstream call is `?status=negative_review&limit=1`; the brand list comes from `brandRollup`, filtered on `negativeReviewCount > 0`. No 14,746-row payload reaches ChatGPT.

## 8. Test plan

All tests run offline with `node --test`, following the existing `test/*.test.mjs` style.
- Fixtures: trimmed real Production responses captured on 2026-10-06 into `test/fixtures/mcp/*.json`. No customer names are kept: client rows are anonymized.
- Upstream: served by a local `http.createServer`. Requests go through `http.request`, because Node `fetch` overrides the `Host` header.

| Area | Cases |
|---|---|
| Tool contract | `tools/list` returns exactly the 10 names; each has `inputSchema`, `annotations.readOnlyHint: true` and `securitySchemes: [{ type: "oauth2", scopes: ["samplas.read"] }]`; a snapshot of names, descriptions and schemas in `test/fixtures/mcp/tool-schemas.json` |
| Auth | valid `samplas.read` token (test RSA key + local JWKS server) → OK; bad signature, wrong audience, expired, missing scope, `sub` not allowed → 401 + `WWW-Authenticate` with `resource_metadata`; token with `samplas.apply` only → rejected; no tool advertises `samplas.propose` or `samplas.apply`; `dev-noauth` ignored when `RENDER` is set or the request is not loopback |
| Coverage | complete / partial / missing for sales and clients → `COMPLETE` / `PARTIAL` / `UNAVAILABLE` + notes |
| Foreign | 2025 all-missing → `salesAmount: null`, `UNAVAILABLE`, never `0`; 2026 partial → `PARTIAL` with `2026-01`, `2026-09`; `available:false` with `includedMonths` filled → still `PARTIAL`; missing `foreign` row → `UPSTREAM_UNAVAILABLE` |
| Inventory | default call → upstream URL has `limit=20`; `limit=500` → `VALIDATION_FAILED`; `offset` pass-through; `brands` + `negative_review` → only rows with `negativeReviewCount > 0`, sorted by `negativeUnits`; serialized result < 200 KB with a 14,746-item fixture upstream |
| Brands | resolve → brand master entry by code; policy; NEW row (RECORDS INC `NAVER_MISSING`, 18/18/16); pending by `sourceBrandCode`; unknown name → `NOT_FOUND` |
| Advertising | both channels available; NAVER `status: "unavailable"` → note, Meta still returned; values equal the fixture |
| Errors | upstream 500 HTML body → `UPSTREAM_UNAVAILABLE` and no `<html` in the output; timeout; 400 → `VALIDATION_FAILED`; 404 → `NOT_FOUND` |
| Safety | the upstream client rejects any non-GET method and any path outside the allowlist (unit test); `grep` test: `scripts/mcp/` contains no `method: "POST"`/`PUT`/`PATCH`/`DELETE` |
| Regression | with `MCP_ENABLED` unset, `/mcp` and `/.well-known/oauth-protected-resource` return the existing 404 JSON; the full existing suite has no new failures (known pre-existing: `brand-master-integrity-audit` 1, `store-performance` 5, `production-ecount-import` 1 in a clean worktree) |

## 9. Task breakdown (each task = one commit)

Common rules:
- Work in a clean `origin/main` worktree in the scratchpad.
- Stage exact files only, never `git add .`.
- No push or deploy until Task 12, which needs its own approval.
- Verification in every task: `node --test test/<new>.test.mjs` plus `npm run check`.

| # | Task | Files | Exact responsibility | Tests | Verification command | Depends | Expected output |
|---|---|---|---|---|---|---|---|
| 0 | Account check (operator, no code) | — | Confirm the account can add a custom MCP server in Developer mode and see **Plugins → Personal**; confirm `@plugin-creator` is available | — | manual | — | A yes or no, recorded in the Task 0 note of the report. On no, stop and re-plan. |
| 1 | Upstream client + envelope + errors | `scripts/mcp/upstream.mjs`, `test/mcp-upstream.test.mjs` | `createUpstream({ baseUrl, timeoutMs, maxConcurrent })` → `getJson(path, params)`: GET only, path allowlist (the 10 endpoints in §4), `http.request`, 20 s timeout, semaphore of 2, status and body mapping per §5. `envelope()`, `toolError()`, `completenessOf(coverage)`, `capPayload()` | Errors table, allowlist, non-GET rejection, HTML body, timeout, 200 KB cap | `node --test test/mcp-upstream.test.mjs` | — | all pass; no dependency added |
| 2 | Fixtures | `test/fixtures/mcp/*.json`, `scripts/mcp/capture-fixtures.mjs` | Read-only GET capture from Production with trimming and anonymization; the script never writes outside `test/fixtures/mcp/` | — | `node scripts/mcp/capture-fixtures.mjs` then `git diff --stat` | 1 | ~12 fixture files, no client names |
| 3 | Sales tools | `scripts/mcp/read-tools.mjs` (create), `test/mcp-read-tools.test.mjs` | `get_sales_summary`, `get_monthly_report` definitions: zod input schema, upstream call, transform | sales coverage, monthly caps, validation | `node --test test/mcp-read-tools.test.mjs` | 1, 2 | pass |
| 4 | Clients + foreign | same two files | `get_clients_summary`, `get_foreign_sales` per §6 | §8 Coverage + Foreign | same | 3 | pass; 2025 → null, never 0 |
| 5 | Brand tools | same | `get_brand`, `get_pending_brands`, `get_new_brands` | §8 Brands | same | 3 | pass |
| 6 | Inventory | same | `get_inventory` per §4 and §7 | §8 Inventory | same | 3 | pass; default URL has `limit=20` |
| 7 | Advertising + policy | same | `get_advertising_summary`, `get_commercial_policy` | §8 Advertising, policy | same | 3 | 10 tools registered |
| 8 | MCP transport | `scripts/mcp/mcp-route.mjs`, `package.json`, `package-lock.json`, `test/mcp-route.test.mjs` | Add `@modelcontextprotocol/sdk` (+ `zod`). Stateless `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, JSON responses), one `McpServer` per request, tools from `read-tools.mjs` with `annotations.readOnlyHint` and `securitySchemes`. `createMcpRoute({ auth, upstream })` → `(req, res, url) => handled` | `initialize` → `tools/list` (10) → `tools/call` round trip over a local server in `dev-noauth`; schema snapshot | `node --test test/mcp-route.test.mjs`; RSS check: `node -e` boot with and without the route, recording `process.memoryUsage().rss` | 3–7 | pass; RSS increase recorded (gate < 40 MB) |
| 9 | OAuth resource server | `scripts/mcp/mcp-auth.mjs`, `package.json`, `package-lock.json`, `test/mcp-auth.test.mjs` | Add `jose`. `verifyBearer(req)` per §3; `/.well-known/oauth-protected-resource` JSON (`resource`, `authorization_servers: [OAUTH_ISSUER]`, `scopes_supported: ["samplas.read"]`, `bearer_methods_supported: ["header"]`); 401 + `WWW-Authenticate`; tool-level `_meta["mcp/www_authenticate"]`; `dev-noauth` double gate | §8 Auth | `node --test test/mcp-auth.test.mjs` | 8 | pass |
| 10 | Mount in server (inert) | `server.mjs` (one `if` block before the existing route chain), `render.yaml` (4 env keys, `sync: false`, `MCP_ENABLED` absent so off), `test/mcp-mount.test.mjs` | When `MCP_ENABLED === "on"`, route `/mcp` and `/.well-known/oauth-protected-resource` to the module; otherwise fall through unchanged. Upstream base `http://127.0.0.1:${PORT}` unless `MCP_UPSTREAM_BASE_URL` is set. | §8 Regression; full suite | `node --test test/mcp-*.test.mjs` then `node --test` (full) | 9 | new tests pass; only known pre-existing failures |
| 11 | Plugin package + local E2E | `plugins/samplas-marketing-os/plugin.json`, `plugins/samplas-marketing-os/mcp.json` (scaffolded by `@plugin-creator` / `$plugin-creator`, then committed), `scripts/mcp/smoke.mjs` | Package points to `https://samplas-marketing-os.onrender.com/mcp` (`streamable-http`), no skill. `smoke.mjs`: an MCP client (SDK) calls all 10 tools against the **local** server with `MCP_UPSTREAM_BASE_URL=https://samplas-marketing-os.onrender.com` (Production GETs only) in `dev-noauth` and prints a compact table | — | `MCP_ENABLED=on MCP_AUTH_MODE=dev-noauth MCP_UPSTREAM_BASE_URL=https://samplas-marketing-os.onrender.com node server.mjs` + `node scripts/mcp/smoke.mjs`; optional `npx @modelcontextprotocol/inspector` | 10 | 10/10 tools OK; foreign 2025 `UNAVAILABLE`; no inventory call above `limit=100` |
| 12 | Production enable + install (**needs separate approval**) | none in the repo (Render env + Auth0 + ChatGPT) | Auth0 tenant/API per §3; set Render env (`MCP_ENABLED=on`, `MCP_RESOURCE_URL`, `OAUTH_ISSUER`, `MCP_ALLOWED_SUBJECTS`); push Tasks 1–11 and deploy; check `/.well-known/oauth-protected-resource`; connect via Developer mode or the published Personal plugin; run §10 | — | `curl -s …/.well-known/oauth-protected-resource`; `curl -si -X POST …/mcp` → 401 + `WWW-Authenticate`; boot marker (`instagramSync.lastAttemptAt`) unchanged during the acceptance run | 11 | §10 passes |

Commit messages:
- Task 1: `feat(mcp): add read-only upstream client`
- Tasks 3–7: `feat(mcp): add <area> read tools`
- Task 8: `feat(mcp): serve read tools over streamable http`
- Task 9: `feat(mcp): verify oauth read scope`
- Task 10: `feat(mcp): mount read-only mcp behind flag`
- Task 11: `feat(plugin): add Marketing OS plugin package`

## 10. Phase 1 acceptance (real ChatGPT, after Task 12)

| # | Question | Expected tool call | Pass condition |
|---|---|---|---|
| 1 | 이번 달 총매출 얼마야? | `get_sales_summary(2026-10-01, today)` | Equals `/api/sales/total`; says the month is partial |
| 2 | 9월 온라인이랑 오프라인 매출 비교해줘. | `get_sales_summary(2026-09-01, 2026-09-30)` | Online and offline values equal the source; coverage stated |
| 3 | 올해 외국인 매출 얼마야? | `get_foreign_sales(2026-01-01, today)` | Equals the clients `foreign` row; partial months named |
| 4 | 작년이랑 비교해줘. | `get_foreign_sales` with a 2025 comparison period | Says 2025 offline data is missing in Production; no 0, no growth % |
| 5 | 음수 재고 브랜드 보여줘. | `get_inventory(view: brands, status: negative_review)` | Brands with negative SKUs; totals match `operations.negativeInventory`; no full payload |
| 6 | RECORDS INC 상태 알려줘. | `get_brand("RECORDS INC")` | NAVER 미등록, Cafe24 18/18/16 (or the current live values), policy equals `/api/intelligence/commercial-policy` |
| 7 | 최근 신규 브랜드 중 NAVER 빠진 거 있어? | `get_new_brands(operationStatus: NAVER_MISSING)` | RECORDS INC (as of the run) |
| 8 | Pending 브랜드 뭐 있어? | `get_pending_brands()` | PENDING list incl. PERSONSOUL, UNDER THE SIGN, PRAYING as `INACTIVE_CODE_REUSED` |
| 9 | 이번 달 NAVER랑 Meta 성과 비교해줘. | `get_advertising_summary(2026-10-01, today)` | Spend/clicks/ROAS equal the source per channel; unavailable channel stated |
| 10 | AE SYNCTX commercial policy 뭐야? | `get_commercial_policy(brand: "AE SYNCTX")` | `EXPLICIT_POLICY`, 10% |

Also required:
- no write tool is visible;
- a disconnected or invalid token produces the ChatGPT login prompt;
- Production does not restart during the run.

## 11. Non-goals (Phase 1)

- Proposal, apply or audit writes; `get_change_history`; the `samplas.propose` and `samplas.apply` scopes; Production agent tokens.
- The ECOUNT local bridge.
- Cafe24, NAVER or Meta writes; GitHub; shell; autonomous changes.
- New canonical endpoints (a foreign sales API, an annual report API).
- Uploading 2025 ECOUNT sales snapshots. That is a separate data task.
- Changing the Render health check or the auth of existing GET routes.

## 12. Risks

1. **Spec deviation (in-process gateway).** It needs approval. Mitigation: env flag, isolated folder, RSS gate in Task 8, and a move-out path through `MCP_UPSTREAM_BASE_URL`.
2. **Account or plan availability** of Developer mode and plugins. Task 0 gates the work.
3. **Auth0 compatibility** with ChatGPT's OAuth flow (DCR, `resource` parameter, audience). Mitigation: verify the settings against Auth0 docs in Task 12. If Auth0 cannot meet the requirements, choose another managed IdP; the server side (`jose` + metadata) is unchanged.
4. **Render free plan cold start.** The first call after idle can exceed ChatGPT's tool timeout. Mitigation: retry wording in tool descriptions; an always-on instance is a cost decision for the operator.
5. **Event-loop load.** Heavy upstream routes (monthly report, clients for long ranges) share the process with the UI. Mitigation: concurrency cap 2, a 20 s timeout, and no loops. The boot marker is checked during acceptance.
6. **Upstream shape drift.** Contract tests against fixtures and the `UPSTREAM_UNAVAILABLE` contract-break mapping catch it.
7. **Existing unauthenticated GET routes** (spec §21.1) are unchanged by this plan.
8. **`coverage.offline.available` inconsistency** (false while months are included). The plan does not rely on that flag. Fixing it upstream is a separate task.

## 13. Self-review

- **Spec consistency:** the tool set, envelope, error codes, scope model, foreign rule and non-goals all match. The deviations (in-process gateway, no agent tokens in Phase 1, `get_brand` performance deferred) are listed in §2 and need approval.
- **No Phase 2 content:** there are no proposal, apply or audit tools, no write scope, no write token and no `/api/agent/*` routes.
- **Tool range:** exactly 10 read tools.
- **No canonical duplication:** every number passes through from an existing GET. §4.2 lists the allowed operations, and tests pin outputs to fixtures.
- **2025 foreign:** `UNAVAILABLE` with `null` values, never 0, and no growth figure.
- **Task size:** Tasks 1–11 each touch 1–4 files and have their own test and command.
- **Production:** no mutation in Tasks 1–11. Task 12 changes only Render env and the deploy, under separate approval.
