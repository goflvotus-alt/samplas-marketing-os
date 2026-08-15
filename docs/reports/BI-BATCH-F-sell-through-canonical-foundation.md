# BI-BATCH-F — Sell-Through Canonical Foundation: PATH B (BLOCKED)

No source code was changed. Pure evidence-gathering, ending in a stop-and-report per this batch's own PATH B instruction.

## Pre-Flight

```
branch = main
HEAD = cebc91b24bbbcacaef57ee70dabba49877fae63f
```
`c9d90f4` / `92cba37` / `2c90677` / `43ed178` / `0d5df53` / `cebc91b` all present. BI-BATCH-E was already committed as `cebc91b` — no checkpoint commit needed. Working tree clean except the usual untracked `docs/reports/*.md` files.

## Phase 1/3 — Receiving/Inbound Source Map

| Field | Status | Evidence |
|---|---|---|
| SKU first inbound date | **D — NOT FOUND** | No field, function, or API call anywhere in `server.mjs`/`intelligence-service.mjs`/`scripts/*.mjs` produces or stores an inbound date. |
| Each inbound date / cumulative inbound quantity | **D — NOT FOUND** | Same — zero occurrences. |
| Receiving/purchase document | **D — NOT FOUND** | SAMPLAS's ECOUNT integration (`scripts/sync-ecount-inventory.mjs`) calls exactly two OAPI endpoints: `InventoryBasic/GetBasicProductsList` (product master) and `InventoryBalance/GetListInventoryBalanceStatus` (current stock balance only). It has never called a receiving/purchase-order/GRN endpoint — this isn't a matter of the data existing-but-unused (Category C); the integration code itself doesn't request it. |
| Current stock | **A — EXISTS + CANONICAL** | `work/ecount-inventory/raw-inventory.json`: `{PROD_CD, BAL_QTY}` — a point-in-time balance only, confirmed by direct inspection (3,209 rows, exactly 2 fields, no date/movement data). This is the same source BI-BATCH-B's SKU Drawer already uses; it cannot answer "since when" or "how much came in." |
| Warehouse transfer / stock adjustment | **D — NOT FOUND** | No transfer/adjustment ledger anywhere. |
| Time-series stock snapshots (from which restocks could at least be *inferred* day-over-day) | **D — NOT FOUND (mechanism exists, zero data)** | `scripts/save-inventory-snapshot.mjs` (git-tracked, commit `29498df`) was built explicitly as prep for this: its own top comment states *"향후 Sell-through / 재입고 판단 계산에 필요한 일별 ECOUNT 재고 스냅샷을 남겨두기 위한 준비 작업... Sell-through/누적입고/누적판매/순이익/재입고 추천 등은 전혀 계산하지 않는다(그 계산은 충분한 스냅샷이 쌓인 다음 Phase에서)."* It is CLI-only (no scheduler, no API trigger). **Confirmed live today: `work/inventory-snapshots/` does not exist — zero snapshots have ever been saved**, exactly matching the same zero-count independently found by the prior STEP67-9 investigation on 2026-08-10. Nothing has changed in the two days since. |
| Sold quantity (online) | **A — EXISTS + CANONICAL** | `archive.commerce.productSales` (BI-BATCH-B's existing source), joined to ECOUNT stock via Product Registry `verified+confirmed` entries only. |
| Sold quantity (offline) | **B — EXISTS BUT NOT SKU-JOINABLE THE SAME WAY** | ECOUNT offline sales are ingested (`scripts/load-ecount-offline-sales.mjs`) but at brand level for Monthly Archive purposes, not wired through the same Product-Registry SKU join BI-BATCH-B built for online. |
| Returns | **D — NOT FOUND as a distinguishable field for this purpose** | No dedicated returns-quantity field surfaced through any of the above sources. |

## Phase 2 — Excel Footprint

**Not found in the repository.** Searched for `.xlsx`/`.xls`/`.xlsb` files and any code/doc referencing a Sell-through workbook. Results:
- `input/SAMPLAS 데스크 할인율 07.30.xlsb` — a real, actively-used Excel import (discount rate), unrelated to Sell-through by content.
- `work/brand-sourcing-representative-decision.xlsx`, `work/brand-sourcing-representative-decision-proposal.xlsx` — BI-BATCH-B2's Product Registry review workbooks, unrelated.
- No file, filename, column-name comment, or prior report anywhere references a Sell-through-specific spreadsheet. The `input/` directory pattern (a proven, working mechanism for hand-dropping an Excel file for ingestion) exists and is exercised for other purposes — but the actual Sell-through workbook itself has never been placed there or committed to this repository.

**Per instruction, this is stated clearly rather than reconstructed from guesswork.**

## Phase 4 — Sales Source Map (for completeness — not the blocker)

Online SKU sales (BI-BATCH-B, `archive.commerce.productSales`) and offline brand-level sales (Monthly Archive) are both real, canonical, and already reused elsewhere. This is **not** where the blocker is — even a perfect sales-quantity source is useless as a Sell-through numerator without a proven denominator (inbound quantity), which does not exist.

## Phase 5 — The 10 Definition Questions

| # | Question | Status |
|---|---|---|
| Q1 | Numerator | **NOT PROVEN** — no formula exists anywhere to name one |
| Q2 | Denominator | **NOT PROVEN** — same; and even if named, no inbound-quantity data exists to populate it |
| Q3 | Start date (입고일) | **NOT PROVEN** — zero inbound-date records exist anywhere in the system |
| Q4 | Restock semantics | **NOT PROVEN** — no restock/inbound event has ever been recorded |
| Q5 | Returns subtracted? | **NOT PROVEN** — no returns field identified for this purpose |
| Q6 | Transfers/adjustments included? | **NOT PROVEN** — no transfer/adjustment ledger exists |
| Q7 | Negative current stock handling | **NOT PROVEN** — no rule defined (negative balances do exist in raw ECOUNT data, per prior batches, but no Sell-through-specific handling was ever specified) |
| Q8 | SKU-first-then-aggregate, or brand-total-directly? | **NOT PROVEN** — no aggregation policy exists |
| Q9 | Brand-level weighting | **NOT PROVEN** — same |
| Q10 | Can existing data reproduce the Excel definition exactly? | **NOT PROVEN** — the Excel workbook itself is not in the repository, so there is nothing to reproduce against, and the underlying inbound time-series it would have depended on doesn't exist either |

Every question resolves to NOT PROVEN. This is not a partial gap in one or two answers — the entire premise (a formula, and data to run it against) is absent.

## Decision Gate

**PATH B.** Per instruction: do not implement, do not fall back to a generic retail formula (`sales / (sales + current stock)`) even though it would be trivial to compute today — this exact naive substitution was independently flagged as *"Highest Data Integrity Risk"* by the prior STEP67-9 investigation (2026-08-10): *"Sell-through를 시계열 데이터 없이 억지로 근사치(예: 현재 재고만으로 추정)로 채우려는 시도... 프로젝트 정책(가짜 값 금지)과 정면 충돌"* — using current stock as a stand-in denominator would silently misrepresent restocked, discontinued, and newly-listed SKUs identically, with no way to distinguish "sold out and never restocked" from "just arrived and hasn't sold yet." This batch does not repeat that mistake.

This finding is not new — it independently reconfirms two prior, dedicated investigations reaching the identical conclusion:

| Checkpoint | Result |
|---|---|
| STEP67-6 (2026-08-10) | *"Sell-through/Inventory/Recommended Action은 canonical source 자체가 없어 정직하게 SOURCE NOT AVAILABLE 표시"* |
| STEP67-9 (2026-08-10), §F | *"BLOCKED — 공식 산식/데이터 필요 상태를 그대로 유지해야 한다... 산식도 없고, 산식이 있어도 계산에 쓸 시계열 데이터가 아직 하나도 쌓이지 않았다."* |
| BI-BATCH-F (this batch, 2026-08-12) | Same conclusion, independently re-derived from a fresh source/data check — nothing has changed in the intervening two days. |

Per instruction, no further diagnostic STEPs were spawned to re-litigate this — the evidence was already conclusive on the first pass.

## What Was NOT Attempted (correctly, per PATH B)

Phases 6–15 (canonical SKU/brand Sell-through engine, coverage semantics, Hero UI, SKU Drawer field, AI Summary mention, tests, Chrome QA) were not started — all depend on a proven formula and inbound data source, neither of which exists.

## Files Changed

None.

## Commit

None — no source or master-data change was made or is warranted (per "If no source/master-data change is required: no artificial commit").

## The Single Smallest Input Needed

This is a **data-availability blocker, not a formula-definition blocker** — even if the exact formula were supplied today in writing, it could not be computed against any real data, because zero inbound/receiving records exist anywhere in SAMPLAS's systems (not ingested from ECOUNT, not accumulated via the dormant snapshot mechanism, not present as an Excel workbook in this repository).

**One of the following would unblock this workstream:**
1. **The original Sell-through Excel workbook**, if one still exists outside this repository — it would supply both the exact formula *and* reveal what inbound data source it was actually calculated from (manually entered? a separate ECOUNT purchase-order export not currently synced?).
2. **If no such workbook exists**, a decision on where inbound/receiving data should come from going forward — most likely wiring `sync-ecount-inventory.mjs` to also call an ECOUNT purchase-order/goods-receipt endpoint (ECOUNT's OAPI does expose this class of endpoint; SAMPLAS's integration has just never called it) — plus, until enough time-series accumulates, an explicit decision on whether "since first sale" or another proxy start-date is an acceptable interim substitute for "입고일" (this would itself need to be an approved decision, not an assumption made here).

Either input, once supplied, would let BI-BATCH-F resume as a single follow-up batch with the same scope originally planned here.

## Final Summary

```text
====================
BI-BATCH-F
SELL-THROUGH CANONICAL FOUNDATION
====================

STARTING HEAD:
cebc91b24bbbcacaef57ee70dabba49877fae63f

BATCH E COMMIT:
cebc91b

SELL-THROUGH FORMULA:
NOT PROVEN

EXCEL SOURCE FOUND:
NO

RECEIVING DATA:
NOT AVAILABLE

FIRST INBOUND DATE:
NOT PROVEN

INBOUND QUANTITY:
NOT PROVEN

RESTOCK SEMANTICS:
NOT PROVEN

RETURN SEMANTICS:
NOT PROVEN

SALES QUANTITY SOURCE:
real and canonical (online: BI-BATCH-B productSales; offline: Monthly Archive) — not the blocker

PRODUCT COVERAGE:
880 registry entries, 103 confirmed+verified (BI-BATCH-B2) — not the blocker, moot without inbound data

PATH:
B BLOCKED

SKU SELL-THROUGH:
BLOCKED

BRAND SELL-THROUGH:
BLOCKED

HERO SELL-THROUGH:
BLOCKED (unchanged honest shell)

SKU DRAWER SELL-THROUGH:
BLOCKED (not added)

AI SUMMARY:
UNCHANGED

RECOMMENDED ACTION:
BLOCKED — POLICY STILL REQUIRED (unaffected by this batch either way)

TARGETED TESTS:
N/A (no code changed)

FULL REGRESSION:
N/A (no code changed — 398/398 baseline untouched)

CHROME QA:
NOT RUN

COMMIT:
NONE

FILES CHANGED:
docs/reports/BI-BATCH-F-sell-through-canonical-foundation.md (report only, untracked)

REPORT:
docs/reports/BI-BATCH-F-sell-through-canonical-foundation.md

PUSH:
NONE

DEPLOY:
NONE

IF BLOCKED — SMALLEST REQUIRED INPUT:
The original Sell-through Excel workbook (if it still exists outside this repo), OR a decision to wire SAMPLAS's ECOUNT integration to a purchase-order/receiving endpoint (never called today) plus an approved interim start-date proxy until enough time-series accumulates.

SAFE TO CONTINUE:
YES

NEXT:
Hold Sell-through until the workbook or a receiving-data decision is supplied. Compare Mode remains explicitly not auto-started, per instruction.
====================
```
