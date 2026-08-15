# BI-CORE-2 — Live Browser Zero Mismatch Diagnosis

READ-ONLY. No source, test, or data file modified. No server restart. No cache-clearing workaround applied to reach any conclusion. No archive rebuilt/uploaded.

## 1. Verify the Exact Running Server

```
PID:      57547
COMMAND:  node server.mjs
CWD:      /Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com
LISTEN:   127.0.0.1:8787 (loopback-only bind, not 0.0.0.0 — confirmed via lsof)
STARTED:  2026년 8월 12일 (Wed) 01시 32분 03초 (i.e. 2026-08-12 01:32:03, entirely within "today")
```

Only **one** process is listening on port 8787 anywhere on this machine (`lsof -iTCP:8787 -sTCP:LISTEN` returns exactly one row). It is running from the correct repository, as `node server.mjs` directly (matching the entry file BI-CORE-1 already traced). `http://127.0.0.1:8787` and `http://localhost:8787` resolve to this exact same socket/process — there is no separate server, proxy, tunnel, or stale process involved. **Not restarted** by this diagnosis.

## 2. Trace the Actual Page Request

Confirmed by reading the served HTML directly and by live network capture (not inferred):

```
SERVED FRONTEND FILE:
outputs/samplas-marketing-os.js  (outputs/samplas-marketing-os.html:2042 — <script src="./samplas-marketing-os.js?v=20260807-step63-3-clients-identity-pipeline">)

FETCH FUNCTION:
refreshEntityTrendMonths() → getSharedJson(url, 8000) → getJson(url, 8000)   [outputs/samplas-marketing-os.js:13279-13345, 13277 currentEntityPeriodMonthKey helper, 398 getJson]

REQUEST URL (one per month, Jan..selected):
GET /api/reports/monthly?month=2026-01
GET /api/reports/monthly?month=2026-02
... through ...
GET /api/reports/monthly?month=2026-08

REQUEST PARAMS:
month=YYYY-MM (one call per calendar month from January through the selected period, via monthlyReportTrendMonths())
```

The `?v=20260807-...` query string is a pure browser cache-busting token baked into the HTML at build time — it does not affect what the *server* serves (Node reads the file fresh off disk per request; there is no server-side static-file cache in this codebase), so a hard refresh reliably gets the current on-disk file content either way. Not inferred: verified live via a Chrome session navigated to `http://127.0.0.1:8787/#brand-dashboard` with `Cmd+Shift+R`, then selecting "CARNET ARCHIVE" — the browser's own console log (`[Brand Identity] "CARNET ARCHIVE" (brand_code=B00000KU) → 2026-08 Monthly brandSales 매핑: FOUND`) and network capture (`GET http://127.0.0.1:8787/api/reports/monthly-comparison-cutoff?base=2026-08&compare=2026-07` — a *second*, always-fired request explained in §6) confirm the exact live requests.

## 3. Reproduce the Exact Browser Request

```
GET http://127.0.0.1:8787/api/reports/monthly?month=2026-08
```

Raw response fields consumed by the frontend (full payload is large — 160KB, 58 brand rows; the relevant brand row for CARNET ARCHIVE, brand_code `B00000KU`):

```json
{
  "archiveStatus": "live",
  "commerce": {
    "brandSales": [
      {
        "brand_code": "B00000KU",
        "brand_name": "카르넷 아카이브",
        "salesAmount": 10883059,
        "sales": { "paidAmount": 10883059, "grossAmount": 11197100, "discountAmount": 314041 },
        "quantitySold": 32,
        "orderCount": 25,
        "onlinePaidAmount": 1021959,
        "offlineSalesAmount": 9861100,
        "canonicalPaidAmount": 10883059
      }
    ],
    "productSales": [ /* Cafe24 product rows, used for the ONLINE half of the SKU-count line only */ ]
  }
}
```

- Revenue field: `sales.paidAmount` / `canonicalPaidAmount` = **10,883,059**
- Units field: `quantitySold` = **32**
- Orders field: `orderCount` = **25**
- AOV: not a server field — frontend computes `revenue / orderCount` = **435,322**
- Online revenue: `onlinePaidAmount` = **1,021,959**
- Offline revenue: `offlineSalesAmount` = **9,861,100**

This is identical to what BI-CORE-1 already found. **When this exact request succeeds and returns in time, the payload is correct.** The open question this checkpoint exists to answer is *whether it always returns in time*.

## 4. Trace Zero Transformation

Traced against the successful payload above, stage by stage — in every reproduction attempt performed here, **no stage ever produced a zero**:

```
Revenue:    API = 10,883,059  → normalized (canonicalPaidAmount) = 10,883,059  → entityTrendMonths[i].revenue = 10,883,059  → card = 10,883,059원  → rendered = 10,883,059원
Units:      API = 32          → normalized = 32                                → entityTrendMonths[i].quantitySold = 32     → card = 32개          → rendered = 32개
Orders:     API = 25          → normalized = 25                                → entityTrendMonths[i].orderCount = 25       → card = 25건          → rendered = 25건
AOV:        API = (derived)   → normalized (revenue/orders) = 435,322          → entityTrendMonths[i].aov = 435,322         → card = 435,322원     → rendered = 435,322원
```

**No stage where the correct value becomes zero was found under a successful fetch.** This forced tracing the *failure* path instead, since a zero can only appear via the fallback branches — not from any transformation of the real payload above.

**The one fallback path that produces exactly this symptom set** (traced directly from source, `outputs/samplas-marketing-os.js`):

```js
// getJson(), line 398 — timeout/network-error fallback:
} catch (error) {
  return { error: error.name === "AbortError" ? "응답 지연" : error.message };
}
```
```js
// refreshEntityTrendMonths(), lines 13296-13314 — per-month row construction:
const archive = archives[index];                              // = { error: "응답 지연" } on timeout
const brandSales = archive?.commerce?.brandSales || [];        // → []  (commerce is undefined)
const row = brandSales.find(item => monthlyReportBrandCode(item) === brandCode);  // → undefined
const revenue = row ? canonicalPaidAmount(row) : 0;             // → 0
const quantitySold = row ? Number(row.quantitySold || 0) : 0;   // → 0
const orderCount = row ? Number(row.orderCount || 0) : 0;       // → 0
...
aov: orderCount ? Math.round(revenue / orderCount) : 0,         // → 0
const archiveStatus = archive?.archiveStatus || null;           // → null (not "live")
```

**FIRST stage where the correct value becomes zero, if this path is taken**: the `getJson()` timeout/`AbortError` fallback (`outputs/samplas-marketing-os.js:417`) — *before* any brand-matching or normalization logic even runs. Everything downstream (the `row ? ... : 0` fallbacks) is a faithful, correct propagation of an already-empty `archive` object, not a bug in the matching/normalization logic itself.

**Why this fallback path is the best-evidenced explanation, not a guess**:
1. `getJson(url, timeoutMs = 8000)` (`outputs/samplas-marketing-os.js:398`) aborts via `AbortController` after a **fixed 8-second timeout**, with **no retry**.
2. The live build behind `/api/reports/monthly?month=<currentMonth>` (`server.mjs:390-392`, `buildMonthlyArchive()`) runs **four parallel, external-API-dependent computations** per request (`buildBrandSalesDiagnostics` [Cafe24], `buildMetaAdsSummaryWithCache`, `buildMetaAdsFullReportWithCache` [2× Meta Ads], `buildInstagramMonthlyDataWithCache`) — the request only resolves once the *slowest* of these finishes, and none of it is cached for the current (live) month by design.
3. Directly timed this exact endpoint on this exact server, three consecutive calls, right now: **0.77s, 1.30s, 2.70s** — comfortably under 8s *at this moment*, but this is a live, uncached, multi-external-API build; there is no guarantee it stays under 8s under different load/network conditions (Cafe24/Meta/Instagram API latency, rate limiting, or simply cold caches elsewhere in the process). This diagnosis cannot force a slow response without altering code/state (prohibited), so this is presented as strong circumstantial evidence, not a captured failure.
4. Critically, this exact mechanism reproduces **every single symptom the user reported simultaneously** — see §5-§7 below — which no other hypothesis considered (wrong server process, service worker, localStorage cache, stale cached archive file, server clock drift) could explain even partially. Each of those alternatives was checked directly and ruled out (§1, §6).

## 5. The "23 Offline" Clue — Explained

```
온라인 3개 · 오프라인 23개   (label: "이번 기간 판매 상품 수" — distinct products sold this period)
```

- **Which payload supplies it**: a *third*, completely independent request — `GET /api/brand-intelligence/{brandCode}/customer-composition?month=2026-08` — fired by `refreshEntityCustomerComposition()` (`outputs/samplas-marketing-os.js:13206-13234`), explicitly commented as "Trend fetch와 별개 네트워크 호출이라 fire-and-forget으로 둔다" (a separate network call from the Trend fetch, deliberately fire-and-forget). The offline figure is `data.offlineProductCount` from *that* response, written directly into `#entityHeroSkuOfflineValue` (line 13221) — it never touches `entityTrendMonths` at all.
- **Why total Orders remains 0 regardless**: Orders (`#entityHeroKpiOrders`) is populated exclusively by `renderEntityHeroKpiFromMonthlyState()` from `entityTrendMonths`, which depends on the `/api/reports/monthly` fetch (§4). It has no relationship to the Customer Composition endpoint.
- **Different endpoints/models**: yes — confirmed two structurally different server-side sources: `buildMonthlyArchive()`/`buildMonthlyArchiveBrandSales()` (Orders/Revenue/Units/AOV) vs. `buildBrandCustomerComposition()` (STEP67-6, in `server.mjs`, reusing `intelligence-service.mjs`'s Clients-screen classification logic) for the offline SKU count.
- **What "23개" actually means**: **distinct offline products sold** (`offlineProductCount`), not orders, not sales lines, not order count. It is a SKU-diversity metric, unrelated in unit to "주문수" (orders).
- **Why this is a key clue, confirmed**: the Customer Composition fetch (`getEntityCompositionJson`, line 12699) has a **built-in retry on timeout** — `if (first?.error === "응답 지연") return getJson(url, ENTITY_COMPOSITION_RETRY_TIMEOUT_MS)` — a resilience fix the Monthly Archive fetch (`getSharedJson`/`getJson` in `refreshEntityTrendMonths`) does **not** have. This is a genuine, pre-existing asymmetry in the codebase: one Brand Intelligence data path tolerates a slow live build via retry, the other does not, and gives up silently after a single 8-second attempt with no retry and no distinct "timed out" UI state — it renders identically to "genuinely zero."

## 6. BI-CORE-1 Request vs. Live UI Request

| | BI-CORE-1 (this session's earlier test) | Live UI (this checkpoint's reproduction) |
|---|---|---|
| Server process | PID 57547, same | PID 57547, same |
| Working directory | this repo | this repo |
| Endpoint | `GET /api/reports/monthly?month=2026-08` | same |
| Query params | `month=2026-08` | same |
| Brand identifier | matched server-side by `brand_code=B00000KU` after client-side name→code resolution | same |
| Period | 2026-08 | same |
| Response shape | `{ archiveStatus: "live", commerce: { brandSales: [...] } }` | identical shape, when it returns in time |
| Revenue field | `sales.paidAmount` = 10,883,059 | identical, when it returns in time |
| Units field | `quantitySold` = 32 | identical |
| Orders field | `orderCount` = 25 | identical |
| AOV | derived, 435,322 | identical |

**SAME REQUEST: YES.** Every dimension checked is identical — same server, same repo, same endpoint, same params, same brand resolution mechanism, same response shape. Both of this checkpoint's own live reproductions (via Chrome, exact user URL/brand/period, with a hard refresh) also returned correct, non-zero values — **the zero state could not be reproduced in either of two independent attempts here.** The most evidence-consistent explanation for why BI-CORE-1 (and this checkpoint's reproductions) got real numbers while the user's browser got zeros is not a *different request* — it is the **same request landing on different sides of the 8-second client timeout race** described in §4, which is inherently intermittent and load/latency-dependent rather than deterministic. This is stated as the best-supported hypothesis, not a certainty — it was not, and could not safely be, forced or captured directly in this diagnosis.

## 7. Brand Identifier Sent by the UI

Verified directly (not inferred): the frontend never sends a brand identifier as a request parameter to `/api/reports/monthly` at all — that endpoint returns *all* brands' rows for the month, unfiltered by brand. Brand filtering happens **client-side**, after the fetch:

```
selectBrandSelectorName("CARNET ARCHIVE")
  → applyBrandIdentity("CARNET ARCHIVE")
  → resolveBrandIdentity("CARNET ARCHIVE")          [looks up brandSelectorIdentityByName Map, keyed by display name]
      → brandCode = "B00000KU"                       [from the matched Brand Master entry's brand_code]
  → refreshEntityTrendMonths()
      → row = archive.commerce.brandSales.find(item => monthlyReportBrandCode(item) === "B00000KU")
```

So the literal value driving the match is the **canonical brand_code, "B00000KU"**, resolved client-side from the display name *before* any network request — not the display name "CARNET ARCHIVE" itself, not a slug, not an alias. This resolution step was directly confirmed working via the browser's own `[Brand Identity] ... FOUND` diagnostic log in both reproduction attempts (§2). **Brand identity resolution is not implicated in the zero-value symptom** — it succeeds identically whether or not the Monthly Archive fetch times out, because the two are independent steps (resolve brand_code client-side → then fetch, rather than sending the brand as a filter and having the server resolve it).

## 8. Scope Discipline

No work performed on Sell-through, Category Intelligence, Compare Mode, Customer Composition redesign, Monthly redesign, or AI Summary redesign. No code modified anywhere.

## Original Repository Safety

No file modified except this report (new, untracked). `git status --short` clean otherwise. No server restart. No archive rebuild. No upload.
