# STORE INTELLIGENCE LIVE DATA FOUNDATION + ALL CURRENTLY AVAILABLE METRICS

- Date: 2026-08-14 KST
- Project: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Starting branch / HEAD: `main` / `21771e3`
- Commit / push / deploy: **NO / NO / NO**

## Result

The APGUJEONG and VEIL Store Intelligence views now use one read-only composition endpoint backed by the existing store-separated ECOUNT snapshots and canonical helpers. The former Store Intelligence mock objects and fabricated business values were removed. Sections without a supported source remain visible and explicitly report that their data or definition is unavailable.

## Files changed in this batch

- `server.mjs`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.css`
- `test/store-intel-ui-a.test.mjs`
- `test/store-intelligence-live-data.test.mjs` (new)
- `docs/reports/STORE-INTELLIGENCE-LIVE-DATA-IMPLEMENTATION.md` (new)

Existing unrelated dirty changes in these and other files were preserved. No file was staged.

## Shared foundation

New read-only route:

`GET /api/intelligence/store?store={APGUJEONG|VAIL}&since=YYYY-MM-DD&until=YYYY-MM-DD`

The server implementation reuses:

- `work/store-master.json` through the existing Store Master loader
- `readEcountOfflineSalesSnapshot(month, { storeCode })`
- `buildCanonicalTotalSales({ since, until, storeCode })`
- `buildClientsOverview({ since, until, cafe24Orders: [], storeCode })`
- `loadResolverContext()`
- `mergeOfflineBrandSales()`

No new parser, persistence format, canonical resolver, or revenue calculator was added. The physical-store Clients call continues to exclude unattributed Cafe24 online orders by passing an empty online order set, preserving the existing Store Focus contract.

## Payload and availability policy

The payload exposes store identity, snapshot coverage, sales, canonical brands, and existing Clients aggregation. Unsupported sections are returned as `available:false` with a reason:

- Product: product identifier not connected
- Category: available after canonical product connection
- Inventory: store-level inventory not connected
- Sell-through: receipt/arrival data not connected
- New brand response: onboarding-date data not connected
- Staff relationship / brand-client cross: relationship data not connected
- Repeat/new customer: definition not confirmed
- Insight: rule not defined

No unsupported metric is represented by a fabricated zero array or sample value.

## Actual 2026-08 verification

### APGUJEONG

- Coverage: 2026-08-01 ~ 2026-08-14
- Period offline sales: **97,177,900원**
- Latest day: 2026-08-14
- Latest-day sales: **5,390,600원**
- Quantity: **348**
- Orders: **164**
- Clients: **60**
- AOV: **231,392.53원** from the existing Clients canonical definition (UI: 231,393원)
- Client types: stylist 47, customer 1, press 9, foreign 1, FF 2
- Stylist-type customer ranking: live Clients aggregation
- Staff assignment, brand × stylist, repeat share, and insight: explicitly unavailable

### VEIL (`VAIL` internal key)

- User-facing label: **VEIL**
- Coverage: 2026-08-03 ~ 2026-08-13
- Period offline sales: **70,200원**
- Latest-day sales: **70,200원**
- Quantity: **1**
- Orders: **1**
- AOV: **70,200원**
- Canonical brand rows: **1**
- Brand: **PACOSPLY** (`B00000ZT`), 70,200원, 1개, 1건
- Product/category/inventory/sell-through/new-brand/insight: explicitly unavailable; no invented values

## Canonical baseline protection

- APGUJEONG offline: 97,177,900원
- VEIL offline: 70,200원
- Reconciled offline: **97,248,100원**
- Existing online baseline: **18,113,792원**
- Existing total baseline: **115,361,892원**

`97,177,900 + 70,200 = 97,248,100`

`97,248,100 + 18,113,792 = 115,361,892`

Canonical sales calculations were not modified. Store Intelligence only composes existing helper outputs.

## UI implementation

- Existing APGUJEONG and VEIL shells and navigation contracts were retained.
- Internal key and route contract remain `VAIL` / `VailIntelligence`.
- All runtime user-facing VEIL labels render as `VEIL`.
- Both renderers call the shared endpoint; they do not resolve brand identity in the frontend.
- APGUJEONG renders actual sales, Clients summary/type composition, stylist-type customer ranking, and recent clients.
- VEIL renders actual sales KPIs and exactly one actual canonical brand row; it does not pad the ranking.
- Unsupported cards remain visible with honest unavailable text.

## Tests

- JavaScript / server syntax: **PASS**
- Targeted Store Intelligence tests: **29/29 PASS**
- Full regression: **669/669 PASS**
- `git diff --check`: **PASS**
- New test oracle covers VEIL 70,200원 / 1 quantity / 1 order / PACOSPLY and rejects mock values.
- Existing Store Intelligence UI test was decoupled from deleted mock constants and now verifies the live endpoint and unavailable-state policy.

## Chrome QA

Chrome extension session, local server `http://127.0.0.1:8788`:

- APGUJEONG live view: **PASS**
- VEIL live view: **PASS**
- VEIL spelling: **PASS**
- APGUJEONG 97,177,900원: **PASS**
- VEIL 70,200원 / 1개 / 1건 / PACOSPLY: **PASS**
- Empty-state honesty: **PASS**
- Visible layout: **PASS**
- Application console errors attributable to this change: **NONE**

Chrome reported extension message-channel errors unrelated to the application. The Store Intelligence range reads the visible month selector directly, so initial deep-link rendering does not depend on the asynchronous Monthly data bootstrap.

## Git safety

- Staged: none
- Commit: none
- Push: none
- Deploy / Render: none
- Work snapshots regenerated or modified: none
- Existing dirty working tree: preserved

## Final verdict

**PASS — Store Intelligence live data foundation is implemented for all currently supported metrics, with canonical calculations unchanged and unsupported metrics reported honestly.**
