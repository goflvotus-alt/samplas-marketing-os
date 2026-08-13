# STORE-BATCH-A — ECOUNT Warehouse Audit + Store Architecture

Investigation and architecture-design only. **No source code was changed.** Read-only
scripts were used where needed, isolated to the session scratchpad, never writing into the
tracked `work/` directory.

## Part 1 — Pre-Flight

```
branch: main
HEAD:   0216e905abe02173d07cff9e3f96e956efe65cda  (feat(brand-intelligence): complete category score and actions)

git status --short:
?? docs/reports/BI-BATCH-A-customer-purchase-detail.md
?? docs/reports/BI-BATCH-B-sku-sales-stock-drilldown.md
?? docs/reports/BI-BATCH-B2-product-registry-match-coverage.md
?? docs/reports/BI-BATCH-C-category-intelligence.md
?? docs/reports/BI-BATCH-D-brand-score-ai-intelligence.md
?? docs/reports/BI-BATCH-E-single-brand-completion-sweep.md
?? docs/reports/BI-BATCH-F-sell-through-canonical-foundation.md
?? docs/reports/BI-BATCH-G-compare-mode-completion.md
?? docs/reports/BI-BATCH-H-brand-intelligence-ux-reorganization.md
?? docs/reports/BI-BATCH-I-complete-business-rules.md
?? docs/reports/BI-CORE-1-core-metrics-data-flow-diagnosis.md
?? docs/reports/BI-CORE-2-live-browser-zero-mismatch-diagnosis.md
?? docs/reports/BI-CORE-3-live-fetch-capture-and-minimum-fix.md
?? docs/reports/BI-CORE-4-null-zero-error-state-guard.md
?? docs/reports/BI-GAP-1-brand-intelligence-data-connection-inventory.md

git diff --stat:            (empty — no unstaged changes)
git diff --cached --name-only:  (empty — nothing staged)
```

Only known BI-BATCH untracked reports present (all pre-existing from prior batches, all
report-only, never staged). No unrelated in-progress work found. Safe to proceed.

---

## Part 2 — ECOUNT Sales Warehouse Audit (real data)

### How offline sales actually enter this system

Offline sales are **not** pulled live from an ECOUNT API. They come from a **manually
uploaded Excel export** (판매현황 = "Sales Status" sheet) via the "ECOUNT Offline Refresh
Wizard" in the sidebar, once per month. The upload flow
(`server.mjs:importEcountOfflineSalesUpload`, `POST` handler) writes the uploaded `.xlsx` to
a **temp directory that is deleted immediately after processing** (`finally { rm(tempDir,
{recursive:true, force:true}) }`, `server.mjs:1505-1507`). This means:

- **The raw original Excel file is never retained anywhere in this repository or its working
  directories.** Only the *parsed subset* survives, as JSON, in `work/ecount-sales/{month}.json`.
- I cannot inspect the full original column list of the source Excel from local artifacts
  alone — only what the parser chose to extract.

### Parser: `scripts/load-ecount-offline-sales.mjs`

`findHeader()` (lines 179-195) looks for exactly these Korean column headers by name, and
**ignores every other column in the sheet, whatever it contains**:

```
일자No (date/slip no) → dateNo
품목명 (product name) → productName
규격 (spec)            → specification
수량 (quantity)        → quantity
품목그룹1명 (item group 1 name) → brandGroup
거래처명 (customer name) → customerName
PONO                   → poNo
합계 (total)            → salesAmount
```

**There is no `창고`/warehouse column name in this list.** No warehouse field is extracted,
by design of the current parser — not because warehouse data was checked and found absent
from the *source* Excel, but because the parser was never written to look for it.

### Real parsed output — confirmed empirically, all 9 monthly snapshots

Checked `work/ecount-sales/2026-{01..08}.json` (+ one `2026-07.before-2026-07-27.json`
backup) directly. The **union of every field ever present on a `salesLines[]` line, across
all 9 files**, is exactly:

```
brandGroup, customerName, date, documentNo, isOfflineRevenue, isPersonalPayment,
personalPaymentReason, poNo, productName, quantity, salesAmount, slipNo, specification
```

**No warehouse field, in any form, in any month, ever.** This is consistent and stable
across the entire available history (2026-01 through 2026-08-11, the latest snapshot).

Sample line (2026-08, most recent):
```json
{
  "date": "2026-08-01", "slipNo": "1", "documentNo": "1",
  "productName": "NAMILIA / Pleated Mini Skirt Black", "specification": "XS",
  "quantity": 1, "brandGroup": "NAM", "customerName": "매장방문고객",
  "poNo": "2026062601", "salesAmount": 158000,
  "isPersonalPayment": false, "personalPaymentReason": null, "isOfflineRevenue": true
}
```

### Distinct sales warehouses

```
DISTINCT SALES WAREHOUSES FOUND: NONE — the field does not exist in parsed data.
```

**This is genuinely unknown, not "confirmed absent from ECOUNT."** The distinction matters:
I can only say the *current parser output* has no warehouse field. Whether the *source
Excel* actually contains a 창고 (or similarly named) column that is silently being dropped
is **unverified** — see "What I could not verify" below.

### APGUJEONG / VAIL raw values

```
APGUJEONG RAW VALUE: NOT FOUND (no warehouse field exists in parsed sales data at all —
                       cannot identify which value, if any, would mean "the existing store")
VAIL RAW VALUE:      NOT FOUND
VAIL DATA ALREADY EXISTS IN SALES: NO
```

A repo-wide case-insensitive search for `vail`/`veil` found **zero genuine matches** —
every hit was a false-positive substring match (e.g. "available", "detail", "prevailing").
This is expected and consistent with the facts: SAMPLAS VAIL soft-opens 2026-08-14, and the
latest sales snapshot's data ends 2026-08-11 (`periodEnd: "2026-08-11"`, per
`work/ecount-sales/2026-08.json`) — three days *before* the store even opens. No VAIL
transactions could exist yet regardless of warehouse-field support.

### Per-warehouse transaction count / sales amount / date range

**Not computable** — there is no warehouse dimension in the data to group by. What I *can*
report (not warehouse-split, but real, for context):

| Month | Line count | Offline revenue lines (`isOfflineRevenue===true`) | Total offline sales |
|---|---|---|---|
| 2026-08 (partial, through 08-11) | 446 | — | 79,144,800원 |

(Full per-month table available on request; all 9 files follow the identical schema.)

### What I could not verify, and why

I attempted to get a **live, fresh** read of ECOUNT data to settle the "does the raw sales
export actually have a warehouse column" question, using the exact same OAPI credentials
this project already uses (`.env`: `ECOUNT_COM_CODE`, `ECOUNT_USER_ID`,
`ECOUNT_API_CERT_KEY`, `ECOUNT_ZONE`). I copied `scripts/sync-ecount-inventory.mjs` into an
isolated scratchpad location (never touching `work/ecount-inventory/`) and ran it read-only.
The login call failed:

```
[218.145.205.177] 허용되지 않은 IP입니다. ERP > API인증키발급 > IP등록을 진행하시기 바랍니다.
("Not an allowed IP. Please register it under ERP > API Certification Key Issuance > IP Registration.")
```

This confirms the same IP-allowlist constraint already known to affect Cafe24 direct API
access from this environment (`server.mjs:4449-4452`) also applies to ECOUNT — **this
investigation environment cannot reach ECOUNT's live API at all**, for sales *or* inventory.
The only ECOUNT data available to inspect is whatever was already synced/uploaded from a
whitelisted environment and committed to `work/`.

**Recommended concrete next step before STORE-BATCH-B**: from the actual production
environment (where the ECOUNT Offline Refresh Wizard and `sync-ecount-inventory.mjs` already
run successfully), either (a) open the next monthly 판매현황 Excel export before uploading
it and read its full header row directly, or (b) temporarily extend
`load-ecount-offline-sales.mjs`'s `findHeader()` to also capture a `창고`/`매장` column *if
present* (additively, never removing existing columns) and re-upload one already-known month
to see what appears. Either would give a definitive, no-guessing answer. I did not do this
myself — it would touch the tracked pipeline, and this batch is investigation-only.

---

## Part 3 — Inventory Warehouse Audit

Unlike sales, inventory **is** pulled live via ECOUNT's OAPI (`scripts/sync-ecount-inventory.mjs`),
calling exactly two endpoints — no others have ever been called by this integration:

- `InventoryBasic/GetBasicProductsList` (품목조회 — product master)
- `InventoryBalance/GetListInventoryBalanceStatus` (재고조회 — inventory balance)

This question was **already investigated and documented** in this codebase (Phase 1/Phase 2,
referenced in `scripts/inventory-overview-lib.mjs:18-28` and
`config/inventory-intelligence-schema.json:134-136`). I independently re-verified the claims
against the actual cached payloads still on disk:

### Product master (`work/ecount-inventory/raw-products.json`, snapshot 2026-07-18)

```
Rows: 10,000
Field present: WH_CD (창고코드/warehouse code) — confirmed present in every row's schema.
Distinct WH_CD values across all 10,000 rows: {''}  (a single value: empty string)
Rows with non-empty WH_CD: 0
```

Verified independently, matches the prior documented finding exactly: this ECOUNT account
does not assign a warehouse at the product-master level for any product.

### Inventory balance (`work/ecount-inventory/raw-inventory.json`, snapshot 2026-07-18)

```
Rows: 3,209
Fields: exactly {PROD_CD, BAL_QTY} — nothing else, no warehouse field of any kind.
Rows per PROD_CD: exactly 1 (no duplicates) — confirms this endpoint already returns a
  single, warehouse-collapsed, company-wide total per product, not a per-warehouse breakdown.
```

The `GetListInventoryBalanceStatus` request body
(`SESSION_ID, BASE_DATE, COM_CODE, USER_ID, ZONE`) passes no `WH_CD` filter parameter — this
is consistent with it returning an already-aggregated, warehouse-collapsed total.

### Answers to Part 3's specific questions

```
현재 Inventory API가 warehouse별 stock을 제공하는가?
  NO — GetListInventoryBalanceStatus already returns a single warehouse-collapsed total
  per PROD_CD. There is no warehouse-split data to preserve or discard at this stage —
  it was never separated to begin with.

현재 Marketing OS는 warehouse 정보를 버리고 합산하고 있는가?
  NO (more precisely: not applicable) — Marketing OS is not the one discarding it; the
  ECOUNT response itself never carried a warehouse split for this account/endpoint
  combination. Nothing is being "dropped" downstream because nothing warehouse-shaped
  ever arrives.

warehouse code/name은 sales와 동일한 identifier를 사용하는가?
  UNKNOWN / NOT APPLICABLE — sales has no warehouse field at all (Part 2), and inventory's
  only warehouse-shaped field (WH_CD) is universally blank. There is no live identifier on
  either side to compare.
```

```
INVENTORY WAREHOUSE SUPPORT: NO
```

This was independently corroborated by two separate prior diagnostic passes
("Phase 1" and "Phase 2", both referenced in code comments) plus my own fresh read of the
still-present raw JSON payloads in this batch — three independent confirmations of the same
result.

**Per the batch's own scope**: this is architecture/data-availability confirmation only.
Inventory Store Filter is explicitly out of scope for STORE-BATCH-A and is not designed here
beyond noting that it is currently blocked on the same root cause as the sales side — no
warehouse-scoped ECOUNT endpoint has ever been called by this integration. A warehouse-scoped
variant of `GetListInventoryBalanceStatus` (passing `WH_CD` per warehouse, if ECOUNT's OAPI
supports it) or a warehouse master list endpoint would need to be identified and called —
this has never been attempted and its existence/behavior is unverified.

---

## Part 4 — Current Pipeline Trace (real function/file names)

Offline sales flow through **two independent read paths** from the same underlying snapshot
files, then fan out to **six independent aggregation call sites** — there is no single
canonical "offline sales" in-memory object that all consumers share; each one re-reads and
re-sums from the raw JSON on every request.

```
ECOUNT 판매현황 Excel (monthly, manual upload, source file discarded after parsing)
  │
  ▼
scripts/load-ecount-offline-sales.mjs :: loadEcountOfflineSalesExcel()
  → parses only the 8 named columns (Part 2) into salesLines[]
  → NO warehouse field ever enters memory from here
  │
  ▼
scripts/import-ecount-offline-sales.mjs :: buildEcountSalesSnapshot()
  → wraps salesLines[] + dailySales[] + totals into a snapshot object
  │
  ▼
work/ecount-sales/{YYYY-MM}.json   ◄── PERSISTED SNAPSHOT (the one durable artifact)
  │
  ├──[read path A]── scripts/read-ecount-offline-sales-snapshot.mjs :: readEcountOfflineSalesSnapshot(month)
  │     Used independently by, each re-reading + re-summing salesLines[] on every call:
  │     • server.mjs :: buildCanonicalTotalSales()          → GET /api/sales/total (Today / ad-hoc range)
  │     • server.mjs :: buildMonthlyArchiveSales()           → Monthly/Annual archive's sales.offlineSales
  │     • server.mjs :: buildMonthlyArchiveBrandSales()      → per-brand offline breakdown (feeds Commerce,
  │                                                              Brand Intelligence KPIs via the archive)
  │     • server.mjs :: enrichMonthlyArchiveBrandSales()     → lazy re-merge when a cached archive is stale
  │     • server.mjs :: buildBrandCustomerComposition()      → Brand Intelligence Customer Composition/
  │                                                              Customer Momentum (BI-BATCH-I)
  │
  └──[read path B]── intelligence-service.mjs :: loadEcountClientLines()
        Bypasses readEcountOfflineSalesSnapshot() entirely — does its own raw
        `readdir(work/ecount-sales/)` + JSON.parse per file. Feeds:
        • intelligence-service.mjs :: buildClientsOverview()  → Clients screen, and (via the same
                                                                  function) Brand Intelligence's
                                                                  Recent Orders / Client Workspace
                                                                  (BI-BATCH-A/BI-BATCH-I)

Aggregation math (identical pattern at every call site):
  for each line: if line.isOfflineRevenue === true AND date is in range:
    offlineSalesAmount += line.salesAmount
  (buildMonthlyArchiveBrandSales/enrichMonthlyArchiveBrandSales additionally call
   scripts/monthly-brand-sales.mjs :: mergeOfflineBrandSales(), which resolves each line's
   brand via scripts/unified-identity-resolver.mjs :: resolveIdentity() before bucketing —
   this is the ONLY place brand identity is derived from an offline line; it never looks at
   a warehouse field because none exists on the line object.)

Downstream consumption (all inherit from the above, no further independent ECOUNT reads):
  work/monthly/{month}.json (cached Monthly Archive, written by buildMonthlyArchive())
    → Monthly screen (reads the cached archive directly)
    → Annual screen (client-side loops the Monthly endpoint across 12 months — no server-side
       Annual aggregator function exists; confirmed by absence of any "annual" route in server.mjs)
    → Commerce screen (reads archive.commerce.brandSales / productSales)
    → Brand Intelligence core KPIs — 매출/판매수량/주문수/객단가 (entityTrendMonths, via
       /api/reports/monthly) — all downstream of buildMonthlyArchiveBrandSales/
       enrichMonthlyArchiveBrandSales, i.e. downstream of the SAME offline lines as Monthly/Commerce.
       (Brand Intelligence's Customer Composition/Momentum piece is the one exception — it
       re-reads the raw snapshot independently via buildBrandCustomerComposition(), not via
       the cached archive.)
```

### Warehouse currently:

```
WAREHOUSE CURRENTLY: NOT FETCHED
```

Precisely: not "dropped after being fetched" — it is never captured at the very first parsing
step (`load-ecount-offline-sales.mjs`'s `findHeader()`), so there is nothing to drop later.
Every downstream consumer, all the way from the parser to Today/Monthly/Annual/Commerce/
Clients/Brand Intelligence, operates on line objects that structurally cannot carry a
warehouse value today.

### An important structural note for Part 6

There is currently **no explicit `channel` field** anywhere in this codebase's canonical
transaction shapes. "Online" vs. "offline" is expressed *structurally* — which source array
or object property a number came from (`onlineSales.paidAmount` vs.
`offlineSales.offlineSalesAmount`; `brand.onlinePaidAmount` vs. `brand.offlineSalesAmount`) —
never as a literal `channel: "online" | "offline"` tag on a transaction line. Store Dimension
design (Part 6) should follow this same established idiom rather than inventing a new
universal tagged-union `channel` field that doesn't otherwise exist in this codebase.

---

## Part 5 — Store Master v1 Architecture (proposed, not implemented)

```json
{
  "stores": [
    {
      "storeCode": "APGUJEONG",
      "displayName": "압구정 매장",
      "type": "physical",
      "aliases": []
    },
    {
      "storeCode": "VAIL",
      "displayName": "SAMPLAS VAIL",
      "type": "physical",
      "aliases": []
    }
  ]
}
```

**`aliases` are deliberately empty in this proposal.** Per Part 2, no real ECOUNT warehouse
raw value was found for either store — inventing plausible-looking values (`"매장"`,
`"SAMPLAS Veil"`) into this file now would violate the batch's own explicit instruction not
to guess. The mapping the task pre-supposed (`매장 → APGUJEONG`, `SAMPLAS Veil → VAIL`) is
**not confirmed** — it cannot be, because no warehouse field exists anywhere in the currently
parsed sales data to check it against (Part 2), and the inventory side's only warehouse
field is universally blank (Part 3). This file is proposed as an **empty, ready-to-fill
skeleton** — the concrete alias values must come from the "Recommended concrete next step"
in Part 2 before STORE-BATCH-B can safely populate them.

Proposed location: `work/store-master.json`, matching the existing precedent of
`work/category-master.json` (BI-BATCH-I) and `work/brand-master.json` — small, hand-curated,
force-added despite `work/`'s blanket `.gitignore`, served read-only via a new
`GET /api/intelligence/store-master` route mirroring `handleCategoryMasterGet`.

---

## Part 6 — Canonical Store Dimension Design (proposed)

### Offline physical transaction (`salesLines[]` entries where `isOfflineRevenue === true`)

```
storeCode: "APGUJEONG" | "VAIL" | "UNKNOWN"
storeRaw:  the original ECOUNT warehouse raw value, verbatim, once one exists
```

`storeCode` is resolved from `storeRaw` via the Store Master's `aliases[]` list — the exact
same resolution pattern already established for Category Master v1's `manualOverrides` and
Brand Master's `aliases`/`name_aliases` (never invented fresh). Lines where `storeRaw` is
absent, blank, or not found in any store's `aliases[]` get `storeCode: "UNKNOWN"` — never
silently defaulted to `APGUJEONG` just because it's the older/larger store. This directly
satisfies Absolute Principle 3.

Because no warehouse field exists on `salesLines[]` today (Part 2/4), **every existing and
historical offline line would resolve to `storeCode: "UNKNOWN"` immediately after this field
is added**, until (a) the parser is extended to actually capture a raw warehouse value, and
(b) that raw value is confirmed and added to the Store Master's `aliases[]`. This is the
structurally honest starting state — not a bug, not "APGUJEONG by default."

### Online transaction

**Recommendation: do not add a `storeCode` field to online transactions at all** (not even
`storeCode: null`), rather than retrofitting a field that doesn't map to anything real.
Online orders have no warehouse concept in Cafe24 and are already structurally separated
from offline lines (Part 4's note: channel is currently expressed by *which aggregation
path* a number came from, not a tag on the line). Following that same established idiom, the
cleanest, lowest-risk expression is: **`storeCode` simply does not exist on online-derived
records** — a Store Filter set to a physical store filters the *offline* aggregation path
only and leaves the *online* aggregation path completely untouched (see Part 7). This avoids
inventing a "channel" concept that isn't otherwise used anywhere in this codebase, and avoids
ever having to answer "what does storeCode:null mean for an online order" — it's not a
question that needs an answer if the field is simply absent where it doesn't apply.

### Where this field gets added, concretely

The single, lowest-risk insertion point is `scripts/load-ecount-offline-sales.mjs`'s
`findHeader()`/line-building loop (Part 4) — the one place raw Excel columns become
`salesLines[]` line objects. Adding `storeRaw`/`storeCode` here means every downstream
consumer (both read paths, all six aggregation call sites) automatically has access to it
without needing six separate changes — they already iterate `line` objects and can simply
start reading two more fields when ready. No consumer needs to change its *fetch* path, only
optionally its *filter* logic (Part 7/8).

---

## Part 7 — Reconciliation Design

### Offline

```
APGUJEONG sales + VAIL sales + UNKNOWN sales === existing offline sales (offlineSalesAmount)
```

Enforced by construction, not by a separate check: `storeCode` is a *classification of the
exact same lines* already summed into `offlineSalesAmount` — every line that contributes to
`offlineSalesAmount` today gets exactly one `storeCode` (never zero, never more than one,
`UNKNOWN` included as a real bucket), so partitioning by `storeCode` and re-summing is
mathematically guaranteed to reconstruct the existing total. This should still be asserted
as an explicit test in STORE-BATCH-B (mirroring BI-BATCH-I's Category coverage reconciliation
test pattern), not merely assumed.

### Total

```
existing online sales + store-classified offline sales === existing total sales
```

Also guaranteed by construction, since store classification never touches the online
aggregation path (Part 6) — `onlineSales.paidAmount` / `brand.onlinePaidAmount` are entirely
unmodified.

### Default (no Store Filter applied) must equal current behavior, exactly

Today / Monthly / Annual / Commerce / Clients / Brand Intelligence must produce **byte-identical
numbers** to today whenever no Store Filter is applied. Because `storeCode`/`storeRaw` are
proposed as **additive fields** appended to existing line objects — never replacing
`salesAmount`, `isOfflineRevenue`, or any existing aggregation formula — and because every
existing call site's summation loop (`for line: if isOfflineRevenue... sum salesAmount`)
would remain textually unchanged unless a Store Filter is explicitly requested, this is
satisfied by the design itself, not by a runtime toggle that could be forgotten. A Store
Filter would be implemented as an *additional, optional* predicate
(`&& (storeCode === requestedStore)`) layered on top of the existing predicate, never a
replacement of it.

---

## Part 8 — UI Architecture Proposal (not implemented)

Reuses the existing Brand Intelligence period-toolbar visual pattern
(`.entity-period-toolbar`, `outputs/samplas-marketing-os.html`/`.css` — the same
pill-button-group idiom already used for 월간/연간/전체 and 비교 모드 toggles) rather than
introducing a new selector component:

```
STORE   [ALL] [압구정] [SAMPLAS VAIL]
```

- **ALL** (default, matches current behavior with zero code path changes): no store filter
  predicate applied; identical to today.
- **압구정**: applies `storeCode === "APGUJEONG"` to the offline aggregation predicate only;
  online sales unaffected (per Part 6, online has no store concept — a natural, honestly-
  disclosed limitation, not a bug: "이 브랜드의 온라인 매출은 매장과 무관합니다" is the kind
  of disclosure BI-BATCH-I already established the precedent for with Category's
  unattributed-offline pattern).
- **SAMPLAS VAIL**: applies `storeCode === "VAIL"` identically.

Proposed placement: alongside the existing period toolbar at the top of Brand Intelligence
(and, longer-term, Today/Monthly/Commerce/Clients once each screen's own aggregation is
store-aware) — not a new page, not a new design system, matching Part 9's cross-feature
compatibility goal. **Not implemented in this batch.**

---

## Part 9 — Future Analytics Compatibility

Because `storeCode`/`storeRaw` are proposed as fields on the same `salesLines[]` objects
already consumed by every listed screen (Part 4's trace), a Store Filter predicate added once
at the shared aggregation layer (or, pragmatically, added independently but identically at
each of the six existing call sites, per the current "no single canonical in-memory object"
reality) is directly reusable by:

```
Today            — buildCanonicalTotalSales() already sums the same lines
Monthly/Annual   — buildMonthlyArchiveSales()/buildMonthlyArchiveBrandSales() already do
Commerce         — reads the same Monthly Archive, no separate change needed
Clients          — loadEcountClientLines() already reads the same raw lines
Brand Intelligence — buildBrandCustomerComposition() + the Monthly Archive it also inherits from
Inventory        — NOT reusable yet (Part 3: no warehouse dimension exists in inventory data
                    at all — this needs its own, currently-unstarted ECOUNT investigation)
Sell-through     — remains DEFERRED regardless (BI-BATCH-F/I) — store dimension doesn't
                    change that blocker
Promotion Attribution / Activity Attribution — not yet audited in this batch (out of the
                    ECOUNT-sales/inventory scope this batch covers); likely compatible in
                    principle since they are also downstream consumers of the same identity/
                    revenue pipeline, but this is a claim for STORE-BATCH-B to verify, not
                    asserted here.
```

압구정 vs VAIL comparison (a Compare-Mode-style two-store view) becomes possible once (a) a
real `storeRaw` value for at least one store exists in the data and (b) the UI in Part 8 is
built — architecturally analogous to Brand Intelligence's existing Compare Mode
(`entityCompareState`), which this batch deliberately does not extend or duplicate.

**Not implemented in this batch**, per instruction.

---

## Part 10 — Confirmation: Nothing Implemented

```
실데이터 audit:        DONE
pipeline trace:        DONE
architecture:          DONE (proposed, Part 5/6)
mapping proposal:      DONE (proposed, empty aliases pending real values)
reconciliation plan:   DONE (proposed, Part 7)
implementation plan:   DONE (Part 6's insertion-point recommendation)
code modification:     NONE
```

The one code execution performed was a temporary, isolated, read-only copy of
`scripts/sync-ecount-inventory.mjs` run from the session scratchpad directory (never
touching `work/ecount-inventory/` or any tracked path), which failed at login due to an
IP-allowlist restriction (Part 2) and produced no output files anywhere. It has since been
deleted from the scratchpad.

---

## Final Summary

```text
====================
STORE-BATCH-A
ECOUNT WAREHOUSE AUDIT
====================

STARTING HEAD:
0216e905abe02173d07cff9e3f96e956efe65cda

GIT STATUS:
clean except known untracked docs/reports/*.md (all pre-existing, all report-only)

SALES WAREHOUSE FIELD:
NOT PRESENT in currently parsed data — load-ecount-offline-sales.mjs's findHeader() does
not look for a warehouse column at all (8 named columns extracted, none warehouse-related).
Whether the source Excel itself contains one is UNVERIFIED (raw file is discarded after
each upload; this environment cannot reach ECOUNT's live API — IP not allowlisted).

DISTINCT SALES WAREHOUSES:
NONE FOUND (field does not exist in any of the 9 available monthly snapshots, 2026-01
through 2026-08-11)

APGUJEONG RAW VALUE:
NOT FOUND / UNVERIFIED

VAIL RAW VALUE:
NOT FOUND / UNVERIFIED

VAIL DATA ALREADY EXISTS:
NO (expected — VAIL opens 2026-08-14; latest sales snapshot ends 2026-08-11)

WAREHOUSE SALES SAMPLE:
N/A — no warehouse dimension exists to sample. Real non-warehouse sample line included in
Part 2 for pipeline-shape reference.

INVENTORY WAREHOUSE SUPPORT:
NO — independently reconfirmed against real cached ECOUNT payloads (raw-products.json:
10,000/10,000 rows have empty WH_CD; raw-inventory.json: {PROD_CD, BAL_QTY} only, already
company-wide-collapsed, 1 row per PROD_CD). Matches two prior documented diagnostic passes.

CURRENT SALES PIPELINE:
ECOUNT 판매현황 Excel (manual monthly upload, source discarded) -> load-ecount-offline-
sales.mjs (parses 8 named columns only) -> import-ecount-offline-sales.mjs -> work/ecount-
sales/{month}.json (the one persisted artifact) -> two independent read paths
(readEcountOfflineSalesSnapshot / loadEcountClientLines) -> six independent aggregation
call sites in server.mjs + intelligence-service.mjs -> Today/Monthly/Annual/Commerce/
Clients/Brand Intelligence (full trace with real function names in Part 4).

WAREHOUSE CURRENTLY:
NOT FETCHED (never captured at the parsing stage — nothing to drop downstream)

PROPOSED STORE MASTER:
work/store-master.json — { stores: [ {storeCode:"APGUJEONG", displayName:"압구정 매장",
type:"physical", aliases:[]}, {storeCode:"VAIL", displayName:"SAMPLAS VAIL",
type:"physical", aliases:[]} ] }. aliases deliberately empty pending real ECOUNT raw values
(Part 5).

PROPOSED CANONICAL FIELDS:
Offline lines gain storeCode ("APGUJEONG"|"VAIL"|"UNKNOWN") + storeRaw (verbatim ECOUNT
value). Online records get no storeCode field at all (not even null) — see Part 6 for why.

ONLINE STORE SEMANTICS:
No storeCode field on online-derived records; a Store Filter narrows only the offline
aggregation predicate, online totals always pass through unfiltered and unchanged.

OFFLINE RECONCILIATION DESIGN:
APGUJEONG + VAIL + UNKNOWN === existing offlineSalesAmount, guaranteed by construction
(every offline line gets exactly one storeCode, UNKNOWN included as a real bucket) — to be
asserted as an explicit test in STORE-BATCH-B.

TOTAL RECONCILIATION DESIGN:
existing online sales + store-classified offline sales === existing total sales, guaranteed
by construction since online aggregation is never touched.

EXPECTED IMPACT ON EXISTING TOTALS:
NONE

UNKNOWN POLICY:
Any offline line whose storeRaw is absent, blank, or not found in Store Master's aliases[]
resolves to storeCode:"UNKNOWN" — never silently defaulted to APGUJEONG. Every existing
historical line resolves to UNKNOWN today, honestly, until a real raw value is confirmed
and mapped (Part 2's recommended next step).

UI PROPOSAL:
Reuses the existing .entity-period-toolbar pill-button pattern: STORE [ALL] [압구정]
[SAMPLAS VAIL], placed alongside Brand Intelligence's period toolbar. No new design system.
Not implemented in this batch.

FILES MODIFIED:
NONE (as expected)

COMMITS:
NONE (as expected)

PUSH:
NONE

DEPLOY:
NONE

NEXT RECOMMENDED BATCH:
STORE-BATCH-B — but only after the Part 2 "Recommended concrete next step" is completed
from a whitelisted environment (inspect one real current 판매현황 Excel's actual header
row, or additively extend findHeader() and re-upload one known month) to obtain real
storeRaw values for both APGUJEONG and VAIL. Implementing Store Master aliases or a parser
change before that would mean guessing — explicitly prohibited by this batch's own
instructions.
====================
```
