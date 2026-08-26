# BATCH 8 Brand Intelligence Full Repair

Date: 2026-08-26 KST

## Scope

- Product Intelligence loading-state completion
- Customer Composition genuine zero-data copy
- Explicit `color-master.json` Render snapshot manifest support
- Production Color Master synchronization and dashboard verification

## Root cause and fixes

### Product Intelligence

The existing orchestration already invoked `refreshEntitySkuSales(...)`. The remaining production-only loading issue was an async render race: Product Intelligence rendered while `entityOfflineAttributionState` was pending, but Customer Composition did not rerender Product after that state became ready or failed. `refreshEntityCustomerComposition()` now rerenders Product once after the attribution state settles. No sales, merge, resolver, or API calculation changed.

### Customer Composition

The zero-customer response reused the no-brand-selected copy. The empty state now distinguishes:

- no brand selected
- selected brand with no confirmed offline customer purchases in the selected period

### Color Intelligence

Local `work/color-master.json` was valid (36 families), while production returned an empty Color Master. The upload manifest now allows only the explicit `color-master.json` path; no wildcard was added. Dry-run returned exactly one file, and that file alone was uploaded after the allowlist deployment was confirmed.

## Files changed

- `outputs/samplas-marketing-os.js`
- `scripts/render-snapshot-manifest.mjs`
- `test/work-data-upload-paths.test.mjs`
- `test/brand-intelligence-live-data.test.mjs`

## Commits

- `3565f0e` — `fix(brand-intelligence): repair dashboard data states`
- `2a6d8e4` — `test(brand-intelligence): cover customer empty states`
- `d825e72` — `fix(brand-intelligence): settle product loading state`

All three commits were pushed to `origin/main`; final ahead/behind was `0/0`.

## Validation

- JavaScript syntax: PASS
- Targeted tests: 5/5 PASS for the final patch; earlier Batch 8 targeted set 22/22 PASS
- Full official suite: 800 total, 798 PASS, 2 pre-existing baseline failures
  - APGUJEONG/VAIL canonical offline fixture mismatch
  - existing Today view markup fixture mismatch
- `git diff --check`: PASS
- `npm run verify:production`: PASS (exit 0)

## Production verification

Brand: CARNET ARCHIVE
Period: 2026-08

- Product Intelligence: `4종 · 온라인 4종 · 오프라인 0종`; loading ended
- Customer Composition: `선택한 기간에 고객 데이터가 없습니다`
- Customer message: `이 기간에 선택 브랜드로 확인된 오프라인 고객 구매가 없습니다.`
- Color Intelligence: BLACK 51%, WHITE 34%, SILVER 14%
- Color coverage: 100%, classified revenue 1,754,959원, unclassified 0원
- Category and channel data remained visible for the selected period
- Production Color Master response checksum after upload: `c06cf1b414a965295063c111c9dcd36e25feca2e2b96e964e6f317299486155f`

## Safety

- No broad upload allowlist
- No other production snapshot uploaded
- No Brand Dashboard redesign
- No sales, resolver, canonical merge, API, or revenue calculation change
- Existing 116 untracked paths were preserved

## Verdict

`BATCH 8 BRAND INTELLIGENCE REPAIR COMPLETE — PRODUCTION VERIFIED`
