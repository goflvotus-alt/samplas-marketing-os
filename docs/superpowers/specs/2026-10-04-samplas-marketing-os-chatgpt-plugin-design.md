# SAMPLAS Marketing OS — ChatGPT Private Plugin (MCP) Design

- Date: 2026-10-04
- Status: Design approved for review. Nothing in this document is implemented.
- Basis: Production code at `origin/main` `c090864`; read-only inspection of routes, auth helpers and live GET responses (rechecked 2026-10-06).

## Decision Summary

| | Decision | Section |
|---|---|---|
| A. Architecture | Separate stateless MCP Tool Gateway on Render. It calls Production over HTTPS. Proposals and the audit log live in Production. | §4 |
| B. Tool set | Phase 1: 10 read tools. Phase 2: `propose_change`, `apply_proposal`, `get_change_history`. Total 13. | §6, §13 |
| C. Read/write boundary | Reads run immediately. Writes are limited to commercial policy discount and pending-brand review. There is no direct mutation tool. | §7, §9, §20 |
| D. Approval model | Approval applies only to the exact proposal shown just before it. The server enforces proposalId, expiry, staleness and idempotency. | §7.3, §8 |
| E. Auth | OAuth 2.1 with scopes `samplas.read`, `samplas.propose`, `samplas.apply`. Gateway uses separate Production agent tokens. Existing auth is unchanged. | §5 |
| F. Audit | Append-only JSONL in Production, read through `get_change_history`. | §10 |
| G. Existing API reuse | All read tools wrap existing GET APIs. Writes call the existing `reviewPendingBrand` and the commercial-policy file under the existing lock. | §6.2, §14 |
| H. Missing backend pieces | Agent token check, `/api/agent/health`, the proposal module, the audit log, `/api/agent/changes`, and a commercial-policy write path. Production has no 2025 offline sales data, so a year-over-year foreign comparison reports `COVERAGE_INCOMPLETE`. | §14 |
| I. Phases | 1: read-only. 2: proposal writes (kill switch off by default). 3: local ECOUNT bridge as a separate spec. | §15–§17 |
| J. Risks | Unauthenticated GET APIs, connector requirements, Render limits, health check cost, prompt injection, IdP, audit durability. | §21 |

---

## 1. Purpose

Let the operator ask ChatGPT about SAMPLAS directly ("9월 매출 어때?", "RECORDS INC 상태 알려줘") and, after an explicit approval of one exact proposal, make a small set of safe changes, without copying prompts between ChatGPT, Claude/Codex and terminals.

Marketing OS stays the single source of truth. The plugin is a thin integration layer: it calls existing canonical APIs, composes their answers, and never re-implements sales, inventory, brand or policy logic.

## 2. Scope

| In scope | Notes |
|---|---|
| Read tools over Production (sales, monthly report, clients, inventory, brand, pending brands, NEW brands, advertising, commercial policy) | Phase 1 |
| Proposal-based writes: commercial policy discount, pending-brand review (NEW / IGNORE / HOLD / REASSIGN_INACTIVE_CODE) | Phase 2 |
| Append-only audit log and change-history read tool | Phase 2 |
| Local ECOUNT refresh through the office Mac | Phase 3 (separate subsystem) |

Out of scope: see §20.

## 3. Current System

- **Marketing OS Production** (`https://samplas-marketing-os.onrender.com`, Render free web service, single Node process, persistent `WORK_DIR` disk). It serves the UI and the JSON APIs; the `intelligence-service.mjs` routes are mounted inside `server.mjs`.
- **Data on the Render disk**: brand master, pending-brand queue, commercial policy, sourcing master, ECOUNT inventory and product master, monthly ECOUNT sales snapshots, Cafe24 caches and token store, NAVER and Meta credentials (env).
- **Existing auth patterns** (all stay as they are):
  - `isAuthorizedInternalRequest`: `x-samplas-internal-token` = `CAFE24_PROXY_SECRET`, or Basic `CAFE24_PROXY_BASIC_AUTH`. Production currently uses Basic.
  - `isAiAuditAuthorized`: `x-samplas-internal-token` = `AI_AUDIT_SECRET`, falling back to `CAFE24_PROXY_SECRET`. Guards `/api/ai-audit/*`.
  - Operator session cookie for the ECOUNT XLSX import.
  - `isLocalRequest`: loopback `Host`, used by local-only routes.
- **Observed constraints**:
  - Heavy requests can block the event loop. Inventory overview used to restart the instance; it is fixed in `c090864`, but memory metrics are unverified.
  - The Render health check is `/api/status`, which now performs Dropbox and Instagram calls (VEIL FOUND).
  - Most GET APIs are unauthenticated today (see §21).
- **ECOUNT** accepts calls only from the registered office IP, so ECOUNT refresh runs locally (`run-ecount-product-sync-and-publish.mjs`, local helper on `127.0.0.1:8787`).

## 4. Architecture

### 4.1 Options

| | A. MCP endpoint inside Marketing OS | **B. Separate Tool Gateway (recommended)** | C. Local MCP on the Mac |
|---|---|---|---|
| Shape | `/mcp` route in `server.mjs` | Small Node service on Render that speaks MCP and calls the Production API | MCP server on the office Mac, exposed through a tunnel |
| Pros | One deploy; no extra hop | Isolates the MCP SDK, OAuth, rate limiting and tool schemas from the memory-tight Production process; independent deploys and rollbacks; Production keeps a small, explicit agent API | Can reach ECOUNT and the local helper |
| Cons | More memory and attack surface in the process that already restarted under load; MCP and OAuth churn forces Production redeploys | One more service; one more hop | Only works when the Mac is on; needs a public tunnel to localhost; ChatGPT cannot reach `127.0.0.1` |
| Verdict | Not for V1 | **V1** | Phase 3 only |

### 4.2 Recommended topology

```text
ChatGPT (Developer mode custom connector)
   │  HTTPS, MCP Streamable HTTP, OAuth 2.1 bearer
   ▼
SAMPLAS Tool Gateway  (Render web service "samplas-chatgpt-gateway")
   - MCP server: tool schemas, input validation, size limits
   - OAuth resource server: scopes samplas.read / samplas.propose / samplas.apply
   - rate limiting, response trimming, structured errors
   - stateless (no business data, no proposals)
   │  HTTPS, x-samplas-agent-token (read token or write token)
   ▼
Marketing OS Production  (existing service)
   - existing canonical GET APIs (reused as-is)
   - NEW small agent module /api/agent/* (Phase 2):
       proposals (create / get / apply), audit log, change history
   ▼
Render disk + Cafe24 / NAVER / Meta APIs + ECOUNT snapshots
```

Proposals and the audit log live in **Production**, not in the gateway. The stale check and the apply must run in the same process that owns the files and their locks (`withPendingBrandWrite`, atomic writes). A gateway-side proposal store could not guarantee an atomic compare-and-apply.

### 4.3 Connectivity (ChatGPT side)

- ChatGPT Developer mode lets a user add a custom connector with a public HTTPS MCP URL. Transports: Streamable HTTP or SSE. Auth: OAuth (with dynamic client registration) or none. Write tools are allowed and ChatGPT shows a confirmation modal before executing them.
- Plan: **Streamable HTTP** at `https://<gateway>/mcp` with **OAuth 2.1** (authorization code + PKCE, dynamic client registration, protected-resource metadata at `/.well-known/oauth-protected-resource`).
- Lifecycle:
  1. The operator adds the connector once.
  2. ChatGPT discovers the OAuth metadata, registers itself and sends the operator to the login page.
  3. The access token carries the granted scopes.
  4. ChatGPT refreshes it with the refresh token.
  5. Revocation happens at the authorization server.
- Feature availability changes. Re-verify the current ChatGPT connector requirements (transport, auth options, plan, whether a static-token option exists) at the start of Phase 1 before building auth. If the connector cannot be added, Phase 1 stops; there is no fallback to a public unauthenticated endpoint.
- Cold start: a free Render service sleeps after inactivity, and ChatGPT tool calls may time out on the first request. Run the gateway on the smallest paid always-on instance, or accept and document the cold-start retry (§21).

## 5. Authentication

### 5.1 ChatGPT → Gateway

- OAuth 2.1 resource server. The authorization server is a managed IdP (e.g. Auth0 or Clerk) configured for a single operator account, so no login system is built in-house.
- Scopes:
  - `samplas.read`: all read tools, including `get_change_history`.
  - `samplas.propose`: `propose_change`. It creates proposals only and never mutates.
  - `samplas.apply`: `apply_proposal`.
  - A token without the required scope gets `AUTH_REQUIRED` with `requiredScope`. The operator can grant read and propose only, which keeps ChatGPT unable to apply anything.
- Tokens are short-lived (≤ 1 h) and refresh tokens rotate. Revoking the operator's grant at the IdP disconnects ChatGPT immediately.
- The gateway validates the JWT issuer, audience (`samplas-chatgpt-gateway`), expiry and scope on every call. Gateway env holds only the IdP issuer/audience and the Production agent tokens.

### 5.2 Gateway → Production

- Two new Render env secrets on both services: `AGENT_READ_TOKEN` and `AGENT_WRITE_TOKEN` (random, ≥ 32 bytes), sent as `x-samplas-agent-token`.
- Production checks the token per route:
  - read token: the GET APIs listed in §14 (through an allowlist on the agent auth check);
  - write token: `/api/agent/proposals*` and `/api/agent/changes`.
  - The write token also passes read checks; the read token never passes write checks.
- Rotation: Production accepts `AGENT_*_TOKEN` and `AGENT_*_TOKEN_NEXT` at the same time. Deploy the new value as `_NEXT`, switch the gateway, then promote and remove the old value.
- Existing auth (`CAFE24_PROXY_*`, `AI_AUDIT_SECRET`, operator session, local helper rules) is not removed or reused. The agent tokens are separate so they can be rotated or revoked without breaking the uploader, proxy or AI audit.

## 6. Read Tool Contract

### 6.1 Common response envelope (gateway → ChatGPT)

```json
{
  "ok": true,
  "tool": "get_sales_summary",
  "data": { "...": "trimmed canonical payload" },
  "freshness": { "dataAsOf": "2026-10-04T09:45:14Z", "source": "/api/sales/total", "coverage": { "complete": false, "missingMonths": [], "partialMonths": ["2026-10"] } },
  "notes": ["2026-10 is partial: offline data through 2026-09-30 only"]
}
```

Rules:
- `freshness` is always present. When the upstream gives no timestamp or coverage, the field is `null` and `notes` says so. Missing data is never presented as complete.
- The gateway trims (drops large arrays, caps lists) but never recomputes. Every number comes from the upstream response.
- Inputs: dates `YYYY-MM-DD`, months `YYYY-MM`, store ∈ `APGUJEONG|VAIL`, brand as code or name. Invalid input returns `VALIDATION_FAILED` before any upstream call.

### 6.2 V1 read tools

| # | Tool | Inputs | Upstream (existing) | Returned (trimmed) |
|---|---|---|---|---|
| 1 | `get_sales_summary` | since, until, store? | `GET /api/sales/total` | online / offline (by store) / total, coverage (complete, partialMonths, missingMonths, storesMissing) |
| 2 | `get_monthly_report` | month | `GET /api/reports/monthly?month=` | status, archiveStatus, sales, commerce headline, marketing headline, provenance |
| 3 | `get_clients_summary` | since, until, store?, includeClients? (default false, max 50) | `GET /api/intelligence/clients` | summary, typeBreakdown, top-10 lists, coverage; client rows only on request |
| 4 | `get_inventory` | brand?, status?, search?, sort?, limit (≤ 100, default 20), offset | `GET /api/inventory/overview` (optimized path, `c090864`) | summary, coverage, generatedAt, page of items; brandRollup only when no brand filter (top 30) |
| 5 | `get_brand` | brand (code or name), since?, until? | `GET /api/intelligence/brands/resolve`, `GET /api/brand-master` (one entry), `GET /api/intelligence/commercial-policy?brand_code=`, `GET /api/brands/new` (entry if present), `GET /api/pending-brands` (related candidates), optional `GET /api/intelligence/brand/{id}?since&until` | identity, active, aliases, sourcing, effective policy (source + %), NEW status with Cafe24/NAVER coverage, pending candidates, optional period performance |
| 6 | `get_pending_brands` | status? (default PENDING), reason? | `GET /api/pending-brands` | candidates grouped like the dry-run report: AUTO_SAFE-eligible NEW, inactive-code reassignment, blocked by reason, with ids |
| 7 | `get_new_brands` | — | `GET /api/brands/new` | count, statusCounts, rows (brand, approvedAt, D+, sourcing, policy, Cafe24 counts, NAVER match, operation label) |
| 8 | `get_advertising_summary` | since, until | `GET /api/advertising/overview` | per channel (meta, naver) availability and canonical metrics, notes; `actualCommerce` stays null as the API returns it |
| 9 | `get_commercial_policy` | status? (EXPLICIT_POLICY / SOURCING_DEFAULT / REVIEW_REQUIRED), discount?, query? | `GET /api/intelligence/commercial-policy` (list) | matching policies (brand, sourcing, stylist %, discount_status, note), count |
| 10 | `get_foreign_sales` | since, until, compareSince?, compareUntil?, store? | `GET /api/intelligence/clients` (one call per period) | the `typeBreakdown` row with `type: "foreign"` (외국인: salesAmount, purchaseCount, clientCount, ratioPct) plus `coverage` per period. If the offline coverage lists the period's months as missing, the amount is reported as unavailable (`null` with `COVERAGE_INCOMPLETE`), never as 0. |
| 11 | `get_change_history` (Phase 2) | since?, target?, limit (≤ 50) | `GET /api/agent/changes` (new) | audit entries (§10) |

Granularity decisions:
- Sales comparison ("9월 온라인 vs 오프라인", "8월 vs 9월") is not a separate tool: ChatGPT calls `get_sales_summary` once per period and compares. This keeps one canonical number source.
- `get_brand` composes five or six existing reads into one answer, because users ask about one brand at a time. It is a composition, not a calculation. Period sales are optional because they are the slow part.
- `get_commercial_policy` stays separate from `get_brand` because list questions ("할인 10% 브랜드 목록") span many brands.
- `get_foreign_sales` reuses the canonical client classification in `/api/intelligence/clients`: `classifyClientType` marks TAXFREE and the explicit foreign rules as `foreign`. The tool only selects that row; it does not classify anything. The separate local script `scripts/report-foreign-sales-comparison.mjs` is untracked and not used.
- Known data gap (checked 2026-10-06): for 2025-01-01..2025-09-30, Production reports offline `missingMonths` for all nine months and foreign `salesAmount` 0. For 2026-01-01..2026-09-30 it reports 133,480,850 with partial months 2026-01 and 2026-09. "올해 외국인 매출 작년이랑 비교" therefore returns the 2026 figure plus `COVERAGE_INCOMPLETE` for 2025 until 2025 ECOUNT sales snapshots are uploaded. Uploading them is a data task outside this plugin.

### 6.3 Payload limits

- The gateway caps each tool result at about 200 KB of JSON. It trims lists first and adds `notes: ["truncated: N of M rows"]` with the offset to continue.
- The gateway never requests `/api/inventory/overview` without `limit` and never asks for more than 100 items.

## 7. Write Proposal Contract (Phase 2)

There is no direct mutation tool. The gateway exposes only:

| Tool | Scope | Effect |
|---|---|---|
| `propose_change` | propose | Inputs: `action` (one of §7.2) and its target fields. Creates a proposal and returns it; changes nothing. |
| `apply_proposal` | apply | Inputs: `proposalId`, `approvalNote`. Applies exactly one stored proposal after server-side checks. |

The proposal state (`PENDING`, `APPLIED`, `STALE`…) comes back in the `propose_change` and `apply_proposal` responses and in `get_change_history`, so no separate proposal-read tool is needed.

### 7.1 Proposal object (stored in Production)

```json
{
  "proposalId": "prp_01J9...",
  "action": "COMMERCIAL_POLICY_SET_DISCOUNT",
  "target": { "type": "brand", "brandCode": "<brand_code>", "brandName": "RECORDS INC" },
  "before": { "policyStatus": "SOURCING_DEFAULT", "stylistDiscountPercent": 20, "policySource": "brand-sourcing-master" },
  "after":  { "policyStatus": "EXPLICIT_POLICY", "stylistDiscountPercent": 10, "policySource": "brand-commercial-policy" },
  "userVisibleSummary": "RECORDS INC 스타일리스트 할인 20% (SOURCING_DEFAULT) → 10% (EXPLICIT_POLICY)",
  "riskLevel": "LOW",
  "sourceRevision": "sha256:…",
  "createdAt": "2026-10-04T11:00:00Z",
  "expiresAt": "2026-10-04T11:15:00Z",
  "state": "PENDING",
  "createdBy": "chatgpt:<oauth subject>"
}
```

- `sourceRevision` is the SHA-256 of the exact bytes of every file the apply will touch. For a policy change: `brand-commercial-policy.json` plus the brand's current resolved policy. For a pending decision: `pending-brand-queue.json` and `brand-master.json`.
- Proposals expire after 15 minutes. States: `PENDING`, `APPLIED`, `APPLIED_UNVERIFIED`, `EXPIRED`, `STALE`.
- Proposal storage: `WORK_DIR/agent/proposals.json`, written atomically. Expired entries older than 7 days are pruned on write.

### 7.2 Supported actions (V1)

| Action | Validation at propose time | Apply implementation |
|---|---|---|
| `COMMERCIAL_POLICY_SET_DISCOUNT` | Brand resolves to exactly one active canonical brand; percent is an integer in 0–50; reads current effective policy through the existing commercial-policy logic; refuses if the brand already has the same explicit value | Upsert one explicit policy entry (`stylist_discount_percent`, `discount_status`, `note`, `source: {type: "chatgpt-proposal", proposalId}`) into `brand-commercial-policy.json` with an atomic write. Explicit policy keeps its precedence over the sourcing fallback; no other entry changes. |
| `PENDING_BRAND_NEW` | Candidate is PENDING and the existing decision code accepts NEW (no CODE_NAME_CONFLICT etc.) | `reviewPendingBrand(workDir, {id, action: "NEW", brandName}, …)`, the existing function and its alias/conflict checks |
| `PENDING_BRAND_IGNORE` / `PENDING_BRAND_HOLD` | Candidate is PENDING | `reviewPendingBrand` with IGNORE / HOLD |
| `PENDING_BRAND_REASSIGN_INACTIVE_CODE` | Candidate reviewReason is INACTIVE_CODE_REUSED and `isAutoSafePendingDecision` (fresh sources) returns REASSIGN_INACTIVE_CODE | `reviewPendingBrand` with REASSIGN_INACTIVE_CODE and freshly loaded sources (the existing latest-evidence recheck runs again at apply) |

LINK and CONFIRM_EXISTING are not offered in V1. Brand Master edits (name, aliases, instagram tag, active) are excluded: the existing `POST /api/brand-master` replaces several identity fields at once, and aliases and `active` drive attribution, NEW status and sourcing. A narrow `instagram_tag`-only action can be a later addition.

### 7.3 Apply algorithm (server-side, inside the existing write lock)

1. Authenticate the write token; load the proposal. Unknown id → `NOT_FOUND`. State APPLIED → `ALREADY_APPLIED` (returns the stored result; no second mutation). Past `expiresAt` → `EXPIRED`.
2. Recompute `sourceRevision` from current disk bytes. Mismatch → mark the proposal `STALE`, return `STALE_PROPOSAL` with the current before-values.
3. Re-run the action's validation against current data (same functions as at propose time). Failure → `VALIDATION_FAILED` / `REVIEW_REQUIRED`.
4. Append an audit entry `{phase: "APPLY_STARTED"}`.
5. Execute through the existing mutation function (atomic writes).
6. Read back through the same read path the read tools use: policy via commercial-policy resolution; pending decision via queue and brand master. Compare with `after`.
7. Mark `APPLIED` (or `APPLIED_UNVERIFIED` if the read-back differs) and append the final audit entry with `verified`.
8. Return `{ ok, proposalId, before, after, readBack, verified }`.

The proposal is marked APPLIED before the response leaves the lock, so concurrent or retried applies hit `ALREADY_APPLIED`.

## 8. Approval Model

Two independent layers:

1. **Conversation layer (ChatGPT).**
   - The tool descriptions instruct ChatGPT to show the proposal `userVisibleSummary`, `before → after` and `riskLevel`, and to call `apply_proposal` only after the user's next message explicitly approves that proposal ("고고", "적용해", "승인").
   - An approval refers only to the proposal shown immediately before it. A general intent stated earlier in the conversation is not an approval.
   - ChatGPT's own write confirmation modal adds a second click.
2. **Server layer (enforced).**
   - No endpoint mutates without a valid, unexpired, non-stale `proposalId` created by the write scope.
   - Inputs to `apply_proposal` are only `proposalId` and `approvalNote` (the user's approval message, stored in the audit log). The apply never accepts new values; the values come from the stored proposal.
   - Therefore a prompt-injected or hallucinated "apply" can at most apply something the user was already shown, and only within 15 minutes.

`propose_change` calls are harmless (no mutation) and may be made without asking.

## 9. Safety Rules

1. Marketing OS is the source of truth; the gateway holds no business state and no copies of data.
2. No tool exposes Cafe24, NAVER or Meta write APIs, ECOUNT ledger writes, snapshot uploads, Git, deployment, shell or file access.
3. Pending brands:
   - automatic onboarding remains NEW-only inside Marketing OS;
   - REASSIGN_INACTIVE_CODE only via an approved proposal, one candidate per proposal;
   - collaboration, alias conflict, unresolved, ambiguous and code conflicts are never offered as AUTO actions. The plugin reuses `isAutoSafePendingDecision` and `planPendingBrandDecision`; it does not decide on its own.
4. Commercial policy:
   - precedence stays explicit policy > sourcing fallback;
   - a change creates or updates an explicit entry only;
   - sourcing defaults and the sourcing master are never edited by the plugin.
5. The heavy endpoints are called only with limits (inventory) and never in loops; the gateway caches nothing that could hide stale data.
6. Every write is recorded (§10), and verification is mandatory before the result is reported as done.

## 10. Audit Log

- Storage: `WORK_DIR/agent/audit.jsonl`, append-only (one JSON object per line, `fs.appendFile` with `O_APPEND`). There is no update or delete endpoint. Rotation: monthly file name `audit-YYYY-MM.jsonl`.
- Entry schema:

```json
{
  "timestamp": "2026-10-04T11:02:10.512Z",
  "requestId": "req_…",
  "actor": "chatgpt",
  "subject": "<oauth subject>",
  "operation": "COMMERCIAL_POLICY_SET_DISCOUNT",
  "phase": "APPLIED",
  "proposalId": "prp_…",
  "target": { "brandCode": "<brand_code>", "brandName": "RECORDS INC" },
  "before": { "policyStatus": "SOURCING_DEFAULT", "stylistDiscountPercent": 20 },
  "after": { "policyStatus": "EXPLICIT_POLICY", "stylistDiscountPercent": 10 },
  "sourceRevision": "sha256:…",
  "proposedAt": "2026-10-04T11:00:00Z",
  "approvedAt": "2026-10-04T11:02:09Z",
  "approvalNote": "고고",
  "verified": true,
  "failureReason": null
}
```

- Phases logged: `PROPOSED`, `APPLY_STARTED`, `APPLIED`, `APPLIED_UNVERIFIED`, `STALE`, `EXPIRED`, `FAILED`.
- `get_change_history` ("어제 ChatGPT가 뭐 바꿨어?") reads it through `GET /api/agent/changes` (read scope), newest first, capped at 50.

## 11. Error Contract

Every tool error, including any upstream failure, is returned as JSON. HTML (e.g. a Render 502 page) is never passed through; the gateway maps the status and drops the body.

```json
{ "ok": false, "error": { "code": "STALE_PROPOSAL", "message": "RECORDS INC policy changed after the proposal was created.", "retryable": false, "details": { "current": { "stylistDiscountPercent": 15 } } } }
```

| Code | When | retryable |
|---|---|---|
| `AUTH_REQUIRED` | missing or invalid OAuth token, or missing scope (`details.requiredScope`) | no |
| `READ_ONLY` | write tool called while writes are disabled (Phase 1, or the `AGENT_WRITES_ENABLED=false` kill switch) | no |
| `VALIDATION_FAILED` | bad input, unknown brand, percent out of range | no |
| `NOT_FOUND` | unknown brand, candidate or proposal | no |
| `REVIEW_REQUIRED` | the action needs a human review path the plugin does not offer (e.g. CODE_NAME_CONFLICT, LINK) | no |
| `STALE_PROPOSAL` | source revision changed since the proposal | no (create a new proposal) |
| `EXPIRED` | proposal older than 15 minutes | no |
| `ALREADY_APPLIED` | second apply of the same proposal (`details.result` = first result) | no |
| `RATE_LIMITED` | over limit (`details.retryAfterSeconds`) | yes |
| `UPSTREAM_UNAVAILABLE` | Production 5xx, timeout or network error (`details.status`) | yes |
| `COVERAGE_INCOMPLETE` | not an error: added as a warning in `notes` and `freshness` when data is partial | n/a |

## 12. Freshness / Coverage

| Tool | dataAsOf source | Coverage source |
|---|---|---|
| sales | request period end plus the ECOUNT snapshot import time where the response carries it | `coverage.complete / partialMonths / missingMonths / storesMissing` (already in `/api/sales/total`) |
| monthly report | `generatedAt`, `archiveStatus` | `status`, `provenance` |
| clients | request period end | `coverage`, `storeCoverage` |
| inventory | `generatedAt` (ECOUNT sync time) | `coverage` (stock known, location unavailable) |
| new brands | `asOf`, `coverage.naverCheckedAt` | Cafe24 `checked`, NAVER `checked` per brand |
| advertising | `since/until` | channel availability flags |

Rule: when `complete` is false or a channel or store is missing, the gateway adds `COVERAGE_INCOMPLETE` to `notes`. Tool descriptions tell ChatGPT to state the gap in its answer.

## 13. Tool Inventory (V1 total)

- Phase 1 (read, 10): `get_sales_summary`, `get_monthly_report`, `get_clients_summary`, `get_foreign_sales`, `get_inventory`, `get_brand`, `get_pending_brands`, `get_new_brands`, `get_advertising_summary`, `get_commercial_policy`.
- Phase 2 (+3): `propose_change`, `apply_proposal`, `get_change_history`.
- Total after Phase 2: 13.

## 14. Existing API Mapping

| Area | Existing endpoint | Auth today | R/W | Prod | Reusable as-is | Wrapper (gateway) | Missing |
|---|---|---|---|---|---|---|---|
| Sales total | `GET /api/sales/total?since&until&store` | none | R | yes | yes | trim, freshness | — |
| Monthly | `GET /api/reports/monthly?month` | none | R | yes | yes (heavy for the current month) | trim headline sections | — |
| Annual / Today | UI composes monthly archives and today views; no single annual API | — | R | partly | — | ChatGPT calls `get_monthly_report` per month | annual canonical endpoint (not in V1) |
| Foreign sales | `GET /api/intelligence/clients` → `typeBreakdown[type=foreign]` | none | R | yes | yes | select row, per-period coverage | 2025 offline sales snapshots in Production (data, not API) |
| Clients | `GET /api/intelligence/clients`, `GET /api/ai-audit/clients` | none / AI audit token | R | yes | yes | trim client rows | — |
| Inventory | `GET /api/inventory/overview` (optimized `c090864`), `GET /api/ai-audit/inventory` | none / AI audit token | R | yes | yes, with limit | enforce limit ≤ 100 | result cache (separate perf task) |
| Brand master | `GET /api/brand-master`; `POST /api/brand-master` | none / internal | R / W | yes | read yes; write no (multi-field replace) | filter one brand | narrow write (later) |
| Brand resolve | `GET /api/intelligence/brands/resolve` | none | R | yes | yes | — | — |
| Brand performance | `GET /api/intelligence/brand/{id}?since&until` | none | R | yes | yes | optional in `get_brand` | — |
| Pending brands | `GET /api/pending-brands`; `POST /api/pending-brands/refresh`, `POST /api/pending-brands/review` | none / internal | R / W | yes | read yes; writes through the proposal module only | grouping | proposal module calls `reviewPendingBrand` in-process |
| NEW brands | `GET /api/brands/new` | none | R | yes | yes | — | — |
| Cafe24 | `/api/cafe24/*`, `/api/diagnostics/cafe24-*` | mixed | R / W | yes | not exposed (covered via brands/new, sales) | — | — |
| NAVER | `GET /api/intelligence/naver/ads/(health|campaigns|performance)` | none | R | yes | via advertising overview | — | — |
| Meta / Advertising | `GET /api/advertising/overview`, `/api/meta-ads/*` | none | R | yes | overview yes | trim | — |
| Commercial policy | `GET /api/intelligence/commercial-policy` (list, `?brand_code`, `?name`) | none | R | yes | yes | filter list | write path (Phase 2) |
| Audit / change history | `GET /api/diagnostics/logs` (error log only) | — | R | yes | no | — | `/api/agent/changes` (Phase 2) |
| Agent auth | — | — | — | — | — | — | `x-samplas-agent-token` check (Phase 1) |

New Production code is limited to: the agent token check (Phase 1), and `/api/agent/proposals`, `/api/agent/proposals/{id}/apply`, `/api/agent/changes` (Phase 2).

## 15. Phase 1 — Read-only plugin

- **Production**:
  - add `AGENT_READ_TOKEN` and `AGENT_WRITE_TOKEN` checks (accepted on the §14 GET allowlist; existing behaviour unchanged for every other caller);
  - add a lightweight health endpoint for the gateway (`/api/agent/health`: no external calls).
- **Gateway**: new repository folder or service (`gateway/`), Node, the official MCP TypeScript SDK (Streamable HTTP), OAuth resource-server validation, the 10 read tools, the response envelope, error mapping, rate limits.
- **Release**: deploy the gateway, add the connector in ChatGPT Developer mode, run the acceptance checks in §22.
- Independent rollback: remove the connector or stop the gateway; Production is unaffected.

## 16. Phase 2 — Proposal-based writes

- **Production**: `scripts/agent-proposals.mjs` (pure: create, validate, revision hash, apply orchestration) plus routes under `/api/agent/*`, `WORK_DIR/agent/` storage, audit log, `AGENT_WRITES_ENABLED` kill switch (default `false` until acceptance passes).
- **Gateway**: 3 tools (`propose_change`, `apply_proposal`, `get_change_history`); descriptions carry the approval rules from §8.
- Each action ships behind its own allowlist entry, so commercial policy and pending-brand review can be enabled separately.

## 17. Phase 3 — Local bridge (ECOUNT refresh)

- Separate subsystem, not part of V1.
- Candidate design: a small outbound-only agent on the office Mac polls the gateway for an approved "ECOUNT refresh" job and runs `runEcountProductSyncFromEnv()` locally. No inbound tunnel; ChatGPT never reaches `127.0.0.1`. Jobs are proposal-approved like writes and report the one-click summary back.
- Preconditions: the Mac is online, the ECOUNT IP is registered, a job-queue model is designed, and authentication for the Mac agent is designed. It is designed and accepted separately.

## 18. Testing Strategy

- **Gateway unit tests** (offline, mocked Production):
  - each tool's input validation, trimming and envelope;
  - the error mapping for 4xx, 5xx, HTML bodies and timeouts;
  - scope enforcement (read token cannot call write tools);
  - payload cap;
  - rate limiter.
- **Production unit tests**:
  - proposal create/apply with the stale check (mutate the file between propose and apply → `STALE_PROPOSAL`);
  - double apply → `ALREADY_APPLIED` with no second write;
  - expiry;
  - `REVIEW_REQUIRED` for blocked pending reasons;
  - REASSIGN apply re-runs `isAutoSafePendingDecision`;
  - commercial policy upsert keeps every other entry byte-identical and explicit precedence;
  - read-back verification;
  - audit append-only (no rewrite of earlier lines);
  - agent token allowlist (read token rejected on writes; existing auth paths unchanged).
- **Contract tests**: snapshot of each tool's JSON schema and description, so changes are reviewed.
- **End-to-end (staging or a local server with copied data)**: the full READ, WRITE and STALE conversations from §22 driven through the MCP client SDK.
- **Production acceptance**: read tools only in Phase 1. In Phase 2, one real policy proposal applied and reverted through a second proposal, with the audit entries checked.

## 19. Deployment Strategy

- The gateway is a separate Render service with its own env (`OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `PRODUCTION_BASE_URL`, `AGENT_READ_TOKEN`, `AGENT_WRITE_TOKEN`), health check `/healthz` (no upstream calls), and an always-on instance recommended.
- Production changes ship as small commits through the existing clean-worktree flow; each phase is deployable and verifiable on its own; writes stay disabled by the kill switch until acceptance passes.
- Secrets live only in Render env, never in the repo, tool output or audit log.

## 20. Non-goals

- A general agent that edits server files, runs terminal or shell commands, deploys, or writes to GitHub.
- Cafe24 product editing; NAVER, Meta or other advertising mutation; ECOUNT ledger writes; snapshot overwrite or upload.
- Autonomous policy changes, autonomous inactive-code reassignment, or any write without an approved proposal.
- New calculations in the plugin (foreign sales, annual totals, margins).
- Replacing the Marketing OS UI.

## 21. Open Risks

1. **Unauthenticated GET APIs in Production** (sales, clients, brand master, policy, inventory). They are reachable today without a token. The plugin does not make this worse, but restricting them is a separate decision with UI impact.
2. **ChatGPT connector requirements may change** (transport, auth options, plan availability). Re-verify at the start of Phase 1; if OAuth with dynamic client registration is unavailable, re-plan auth (no unauthenticated fallback).
3. **Render free-plan behaviour**: Production sleeps and has limited memory (restarts observed before `c090864`; memory metrics unverified). Read tools add load: inventory is capped and monthly report requests are not looped. The gateway cold start needs an always-on instance or a documented retry.
4. **Health check cost**: `/api/status` performs Dropbox and Instagram calls on every health check (VEIL FOUND). The gateway must not call `/api/status`; use `/api/agent/health`. Splitting Render's health check is a separate task.
5. **Prompt injection through data** (brand names, notes, client names): tool results are data. Writes still require a proposal shown to the user and the server-side checks in §7.3.
6. **IdP dependency**: an outage blocks the plugin but not Marketing OS.
7. **Audit log on the Render disk**: it survives restarts but not disk loss. Optional periodic export (e.g. to Dropbox) is a later decision.

## 22. Acceptance Criteria

### Phase 1
- The connector is added in ChatGPT Developer mode with OAuth; a token without `samplas.read` gets `AUTH_REQUIRED`.
- "올해 외국인 매출 작년이랑 비교해줘" → `get_foreign_sales` for 2026-01-01..today and 2025-01-01..same day. The 2026 figure equals the `/api/intelligence/clients` foreign row, and 2025 is reported as unavailable with `COVERAGE_INCOMPLETE`, not as 0.
- "9월 매출 어때?" → `get_sales_summary(2026-09-01, 2026-09-30)`. The answer quotes the same totals as `/api/sales/total` and states coverage.
- "RECORDS INC 상태 알려줘" → `get_brand`. The answer shows NAVER 미등록 and Cafe24 16 sellable of 18, and its sourcing type and effective discount equal `/api/intelligence/commercial-policy?brand_code=` for that brand.
- `get_inventory` never requests more than 100 items; Production boot time is unchanged across the acceptance run.
- An upstream 502 surfaces as `UPSTREAM_UNAVAILABLE` with no HTML.
- No write tool is listed or callable.

### Phase 2
- "RECORDS INC 할인 10%로 바꿔줘" → `propose_change(action: COMMERCIAL_POLICY_SET_DISCOUNT)`. ChatGPT shows the current effective policy → 10% (EXPLICIT_POLICY) and asks. After "고고", `apply_proposal` runs, the read-back shows EXPLICIT_POLICY 10%, and the audit entry has `verified: true`.
- Stale: changing the policy file between propose and apply → `STALE_PROPOSAL`; ChatGPT re-reads and proposes again.
- A second apply of the same id → `ALREADY_APPLIED`; the policy file is written once.
- A proposal older than 15 minutes → `EXPIRED`.
- REASSIGN for PERSONSOUL is applied only through its own approved proposal; AUTO approval never reassigns; blocked reasons return `REVIEW_REQUIRED`.
- There is no route that mutates without a `proposalId`. Verified by test and by route review.
- With `AGENT_WRITES_ENABLED=false`, write tools return `READ_ONLY`.
- A token with `samplas.propose` but without `samplas.apply` can create proposals, and `apply_proposal` returns `AUTH_REQUIRED`.

### Phase 3
Defined in its own spec.

---

Verdict: **SAMPLAS MARKETING OS CHATGPT PLUGIN — DESIGN READY**
