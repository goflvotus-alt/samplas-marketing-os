# SAMPLAS Brand Intelligence — Business Rules

This is a permanent implementation document, not a batch report. It defines the canonical
business rules approved and implemented in **BI-BATCH-I** (2026-08-13) for SAMPLAS Brand
Intelligence. It is committed alongside the code that implements it
(`outputs/samplas-marketing-os.js`, `outputs/samplas-marketing-os.html`,
`intelligence-service.mjs`) and should be updated whenever these rules change.

Everything below except **Sell-through** is now implemented and live. Sell-through remains
explicitly deferred — see its own section.

---

## Category Master v1

### Taxonomy

Eleven canonical merchandise categories. This is **not** Cafe24 `categoryNos`
(display/promotion shelves, confirmed unrelated to merchandise taxonomy in BI-BATCH-C) — it
is a new, independent SAMPLAS classification.

| Code | Display name (ko) |
|---|---|
| `TOP` | 상의 |
| `BOTTOM` | 하의 |
| `OUTER` | 아우터 |
| `DRESS` | 드레스 |
| `BAG` | 가방 |
| `FOOTWEAR` | 신발 |
| `HEADWEAR` | 모자 |
| `JEWELRY` | 주얼리 |
| `ACCESSORY` | 액세서리 |
| `OTHER` | 기타 (reachable only via manual override in v1 — no automatic rule targets it) |
| `UNCLASSIFIED` | 미분류 (fallback when nothing else matches) |

Implemented in `outputs/samplas-marketing-os.js` as `CATEGORY_MASTER_V1`.

### Classification priority (deterministic, no runtime AI/LLM)

1. **Manual override** — `work/category-master.json`'s `manualOverrides[]`, keyed by
   Cafe24 `productNo` (the same identifier Product Registry already uses — no new product
   identity is created). Served read-only via `GET /api/intelligence/category-master`.
   Always wins.
2. **Existing confirmed category** — not implemented as a separate cache in v1. Classification
   is cheap and fully deterministic (same input always produces the same output), so it is
   recomputed on every render rather than cached — this is intentionally the same outcome as
   a cache without the staleness risk.
3. **Deterministic product-name keyword rule** — `CATEGORY_NAME_KEYWORD_RULES`, word-boundary
   matched (case-insensitive) against the product name. If a name matches keywords from **more
   than one** category simultaneously, the match is discarded (ambiguous → falls through) —
   the engine never guesses.
4. **ECOUNT product-code (`prodCd`) suffix rule** — only for names that produced no keyword
   match. See below for which suffixes are active.
5. **`UNCLASSIFIED`** — final fallback. Never hidden from the UI; always shown as its own row.

### Name keyword rules (priority 3)

| Category | Keywords |
|---|---|
| TOP | t-shirt, tee, shirt, blouse, knit, sweater, cardigan, hoodie, sweatshirt, jersey top, tank top |
| BOTTOM | pants, trousers, jeans, denim pants, shorts, skirt, slacks |
| OUTER | jacket, coat, blazer, vest, parka, bomber, outer |
| DRESS | dress, one-piece |
| BAG | bag, backpack, tote, shopper, pouch |
| FOOTWEAR | boots, boot, shoe, shoes, sneaker, sneakers, mule, sandal, sandals, loafer |
| HEADWEAR | cap, hat, beanie, headwear |
| JEWELRY | necklace, ring, earring, earrings, bracelet, bangle, chain jewelry, pendant |
| ACCESSORY | belt, wallet, keyring, key chain, scarf, tie, gloves, sunglasses, eyewear, socks, accessory |

`OTHER` has no automatic keyword trigger in v1 (reachable only by manual override) —
jumpsuits and similar ambiguous garment types fall to `UNCLASSIFIED` rather than being
guessed into `DRESS` or `OTHER`.

### ECOUNT `prodCd` suffix rule (priority 4)

Audited against all **103 verified+confirmed** entries in `work/product-registry.json`
(2026-08-13 snapshot) by cross-referencing each entry's real `prodCd` trailing letters
against its real product name. Only suffixes that were **100% consistent** across every
audited occurrence were activated:

| Suffix | Category | Evidence |
|---|---|---|
| `BG` | BAG | 2/2 — "Shopper Bag", "Shoulder Bag" |
| `BT` | BOTTOM | 14/14 — every occurrence was pants/shorts/skirt |
| `SH` | TOP | 1/1 — "MEN SUNRISE SHIRT" |
| `JW` | JEWELRY | confirmed on "WELDING NECKLACE"; 2 further occurrences had non-descriptive product names (unable to contradict) |
| `FW` | FOOTWEAR | 1/1 — "OTTOLINGER X CAMPER Olas Black sandal" |
| `OT` | OUTER | 7/7 — every occurrence was a jacket |
| `HW` | HEADWEAR | 2/2 — "HAPLOID CAP", "OILSKIN MIRRORED CAP" |

**Explicitly NOT activated** (real catalog evidence showed mixed or absent semantics — do not
re-enable without new evidence):

| Suffix | Reason |
|---|---|
| `AC` | Spans JEWELRY (necklaces), HEADWEAR (caps), ACCESSORY (belts, pouches, socks) — no single meaning |
| `LT` | Mostly TOP (hoodies) but with a "TECH HOODED ZIP FULLSUIT" counter-example; already mostly covered by the name-keyword rule anyway |
| `ST` | Spans TOP (tank tops, polos) and DRESS ("NYC POLO DRESS", "TRIPLE TEE DRESS") |
| `DR` | Zero occurrences in the audited sample — unverifiable, left inactive |

### Coverage policy

Attributed + unattributed must reconcile to the canonical brand total (same source as the
매출 KPI card — no new revenue semantics). `UNCLASSIFIED` revenue counts toward
**unattributed** for coverage purposes (we don't actually know the merchandise type) but is
never hidden from the per-category breakdown table.

- **Attributed** = sum of online `entitySkuRows` revenue classified into a named category
  (not `UNCLASSIFIED`).
- **Unattributed** = canonical total − attributed. This is dominated by offline revenue,
  since ECOUNT offline sales have no per-SKU identity in this pipeline (BI-BATCH-F finding,
  unchanged) and therefore cannot be classified at all.
- Coverage is never forced to 100% and is always disclosed in the UI
  (`#entityCategoryCoverageNote`, e.g. "상품군 커버리지 5% · 분류 매출 628,139원 /
  미분류·오프라인 10,859,920원").

### Real coverage measurements (2026-08-13)

**Product Registry (`work/product-registry.json`), verified+confirmed entries:**

```
TOTAL PRODUCT REGISTRY:  880
VERIFIED+CONFIRMED:      103
CATEGORY CLASSIFIED:     74  (70 via name rule, 4 via ECOUNT suffix)
UNCLASSIFIED:            29
CATEGORY COVERAGE:       71.8%
```

**CARNET ARCHIVE, 2026-08 (live, online-sales revenue basis):**

```
Sales revenue attributed:    628,139원 (아우터)
Sales revenue unattributed:  10,859,920원 (미분류 + 100% of offline, which is 85.8% of total)
Coverage:                    5%
```

The low brand-period coverage (5%) versus the higher registry-wide coverage (71.8%) is
expected and not a defect: CARNET ARCHIVE's revenue is 85.8% offline this period, and offline
revenue is structurally unattributable in this pipeline — the registry-wide number measures
classifier quality on products we *can* see; the brand-period number measures how much of
*this specific brand's actual revenue* that translates to.

### Customer Workspace Category

Client Workspace's Category section (previously "고객별 상품군 데이터 연결 대기") now shows
a real breakdown of the selected customer's offline `purchaseDetails` lines
(`entityClientPurchaseLinesFor`), classified by product name only (offline ECOUNT lines carry
no `prodCd`, so only the priority-3 name rule applies — no suffix fallback, no override).

### Category Drawer / Category → SKU drill-down

The "전체 상품군" Drawer reuses `entityCategoryRows` directly (no separate placeholder array).
Clicking a category row threads its code into the drawer navigation context
(`entityDrawerState.context.categoryCode`), and the SKU Drawer filters `entitySkuRows` by it
— so drill-down only shows SKUs Product Registry mapping actually allowed us to classify.

---

## Brand Operating Score v1

Measures **current operating momentum and data health** — not a Sell-through-based
inventory-efficiency score (Sell-through is not part of v1).

### Components and weights

| Component | Weight | Measures |
|---|---|---|
| Revenue Momentum | 35% | Canonical revenue, current period vs. previous comparable period |
| Order Momentum | 25% | Canonical order count, same comparison |
| Customer Momentum | 20% | Unique-purchasing-customer count (existing Customer Composition identity semantics), same comparison |
| Inventory Integrity | 20% | % of current-inventory SKUs with **negative** stock (data/stock health — not sales efficiency, not Sell-through) |

### Period comparison semantics

- **Live (in-progress) current month**: uses the exact same SAME-ELAPSED-DAYS
  cutoff-normalized endpoint Compare Mode already uses
  (`getEntityCompareMonthlyArchiveCutoff`), called independently of whatever Compare Mode's
  own target-period selector is set to (always compares against the immediately preceding
  month). This is a reuse of an existing function from a new call site — not a new fetch
  architecture.
- **Completed current month**: reuses `entityTrendMonths`' adjacent rows (already fetched for
  the Monthly Trend chart) — no new network call.

### Momentum → points (Revenue/Order/Customer, identical table)

| % change | Points |
|---|---|
| ≥ +20% | 100 |
| +10% to <+20% | 90 |
| 0% to <+10% | 80 |
| -10% to <0% | 65 |
| -20% to <-10% | 50 |
| -30% to <-20% | 30 |
| < -30% | 10 |
| comparison unavailable | component unavailable (`null`, never fabricated) |

A genuine 0% change scores 80 (real zero, not treated as missing).

### Inventory Integrity → points

| Negative-stock SKU ratio | Points |
|---|---|
| 0% | 100 |
| >0% and ≤2% | 80 |
| >2% and ≤5% | 60 |
| >5% and ≤10% | 30 |
| >10% | 0 |
| inventory source unavailable | component unavailable (`null`) |

Zero stock (sold out) is never penalized — only *negative* stock (a data-integrity signal) is.

### Partial coverage policy

All 4 components' weights sum to 100. If one or more components are unavailable:

```
availableWeight = sum of weights of available components
if availableWeight >= 60:
  overall = (Σ points_i × weight_i for available i) / availableWeight
  → normalized back onto a 0–100 scale, label assigned
else:
  overall = unavailable (score not shown)
```

Coverage is always disclosed in the UI ("커버리지 XX%").

### Labels

| Score | Label |
|---|---|
| 90–100 | EXCELLENT · 매우 강함 |
| 75–89 | STRONG · 강함 |
| 60–74 | STABLE · 안정 |
| 40–59 | WATCH · 주의 |
| 0–39 | RISK · 위험 |

Labels are descriptive only — no causal explanation is implied or generated.

### UI

Replaces the old undefined "판매 회전율" (Sell-through stand-in) sub-metric with **주문
성장** (Order Momentum) — the old label never had an approved formula and BI-BATCH-D
correctly refused to invent one; it is now genuinely Order Momentum, not Sell-through wearing
a different name. Existing visual shell (`.brand-hero-score-ring`, `.brand-hero-score-block`)
reused unchanged; only content is now real (`renderEntityScore()`,
`outputs/samplas-marketing-os.js`).

---

## Customer Contribution Grade v1

**This is not lifetime loyalty status.** It is the selected customer's relative contribution
within the **currently selected brand + currently selected period's** customer set only — the
UI always labels it "이 브랜드·이 기간 기준 기여도 등급" to make this explicit, and the shell
is called "기여도 등급", never "VIP".

### Formula

```
revenuePercentile = % of the brand-period customer set with strictly lower total revenue
orderPercentile    = % of the brand-period customer set with strictly lower order count
score = revenuePercentile × 0.70 + orderPercentile × 0.30
```

### Grades

| Score | Grade |
|---|---|
| ≥ 90 | S |
| ≥ 70 | A |
| ≥ 40 | B |
| < 40 | C |

### Small-sample rule

If the brand-period customer set has fewer than 5 members, the score is **still calculated**
(not skipped), but the UI appends "표본 적음" to disclose the small sample size.

### Scope isolation

The grade function takes only the already brand+period-scoped `entityCompositionRows` array
as input — it performs no fetch of its own and reaches no global brand/period state, so
isolation across brand switches and period switches is structural, not a runtime check.

---

## Recommended Action v1

**Not autonomous marketing strategy.** A threshold-based operational checklist only. Because
Sell-through is unavailable, inventory sales-efficiency actions (discount, reorder) are
prohibited by design, not merely by omission.

### Rules (priority order, max 3 shown)

| Priority | Trigger | Text |
|---|---|---|
| 1 | Negative-inventory SKU count > 0 | "음수 재고 SKU를 확인하세요. (N개)" |
| 2 | Revenue Momentum points ≤ 50 | "매출 하락 구간을 점검하세요. (직전 비교 기간 대비 X%)" |
| 3 | Order Momentum points ≤ 50 | "주문수 감소 구간을 점검하세요. (직전 비교 기간 대비 X%)" |
| 4 | Customer Momentum points ≤ 50 | "구매 고객 수 감소를 점검하세요. (직전 비교 기간 대비 X%)" |
| — | none triggered | "현재 기준 긴급 점검 항목이 없습니다." |

If more than 3 rules trigger, only the top 3 by priority are shown (verified live: AIVER
2026-08 triggered inventory + revenue + orders and correctly dropped the 4th-priority
customer rule).

### Prohibited

Never generates: 할인하세요 / 광고하세요 / 발주하세요 / 프로모션을 진행하세요, or any
discount/promotion/reorder/ad-spend recommendation, under any input. Never references
Sell-through in any form.

---

## AI Summary v2

Deterministic bullet list (kept deterministic — no LLM). Facts are joined with `\n` and
rendered `white-space: pre-line` (BI-BATCH-H). Possible bullets, all from already-computed
sources, no new causal claims:

- Current revenue + comparison (existing, unchanged)
- Channel Mix dominant-channel share (existing, unchanged)
- Highest/lowest month among completed months (existing, unchanged)
- Online SKU count (existing, unchanged)
- Current inventory (existing, unchanged)
- **New**: Order Momentum sentence (from `entityScoreState`, only when it matches the
  current brand+period)
- **New**: Brand Operating Score + label (same guard)
- **New**: Dominant customer-type share (`entityCompositionTypeStats`)
- **New**: Top online product by revenue (`entitySkuRows`)
- **New**: Category leader — only when `entityCategoryCoverage.coveragePct >= 50` (adequate
  coverage); never guessed at low coverage
- **Always**: `"Sell-through는 입고 데이터 확보 후 제공됩니다."` — the only way Sell-through
  is ever mentioned anywhere in AI Summary

---

## Sell-through — DEFERRED

**Status: unchanged from BI-BATCH-F. Not implemented in BI-BATCH-I, by explicit instruction.**

**Reason**: no canonical source exists anywhere in SAMPLAS's systems for first inbound date,
inbound quantity, or receiving/restock history. `sync-ecount-inventory.mjs` has never called
an ECOUNT receiving/purchase-order endpoint; the prep snapshot script
(`scripts/save-inventory-snapshot.mjs`) exists but has never been run
(`work/inventory-snapshots/` does not exist). This is a **data-availability** blocker, not a
formula-definition blocker — even a supplied formula could not be computed against real data
today.

**Explicitly prohibited approximation**: `sales / (sales + current stock)` — using current
stock as a denominator proxy would misrepresent restocked, discontinued, and newly-listed
SKUs identically, with no way to tell "sold out, never restocked" from "just arrived, hasn't
sold yet." This was independently flagged as the *Highest Data Integrity Risk* in a prior
investigation and is not repeated here.

**Required future inputs** (either would unblock a follow-up batch):
1. The original Sell-through Excel workbook, if one exists outside this repository — it would
   supply both the formula and reveal what inbound source it depended on.
2. A decision to wire `sync-ecount-inventory.mjs` to an ECOUNT purchase-order/goods-receipt
   endpoint (never called today), plus an approved interim start-date proxy until enough
   time-series accumulates.

**Where it appears in the UI**: `FUTURE / BLOCKED` status area (`#entityFutureBlockedStatus`)
— now the *only* item there — and the Sell-through KPI card (`#entityHeroKpiGrid`), both
saying `DEFERRED`/`BLOCKED · 입고 데이터 필요`. AI Summary always discloses it via the one
approved sentence. Recommended Action never references it.

---

## Strict invariants preserved by this batch

- No change to canonical Revenue/Units/Orders/AOV/Cafe24 paid semantics/ECOUNT offline sales
  semantics/cancellation-refund semantics/Product Registry canonical matching/Brand
  Identity/existing inventory quantities.
- No ambiguous Product Registry match was ever forced.
- NULL != ZERO preserved throughout: every new component distinguishes "genuinely computed
  zero" from "unavailable/failed to compute" (`null`), never conflating the two.
