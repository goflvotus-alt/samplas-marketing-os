# ECOUNT Sheet Compatibility + VEIL Data Connection

## Scope

- Starting HEAD: `21771e3`
- Branch: `main`
- Working directory: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Canonical sales calculation changed: **NO**
- Commit: **NO**

## Root cause

`loadEcountOfflineSalesExcel()` selected only the literal sheet name `판매현황`. The current VEIL ECOUNT export contains the literal sheet name `판매현황내역`, so the loader stopped before header or sales-row parsing with `Sheet not found: 판매현황`.

## Change

Modified:

- `scripts/load-ecount-offline-sales.mjs`
- `test/ecount-offline-sales-sheet.test.mjs` (new)

The default sheet priority is now:

1. `판매현황내역`
2. `판매현황`

When `options.sheetName` is supplied, only that exact override is selected. The loader does not fall back to the first workbook sheet. Missing explicit/default supported sheets raise a clear `Sheet not found` error.

No header parsing, row parsing, personal-payment classification, offline revenue inclusion, snapshot, store dimension, brand merge, or canonical total calculation was changed.

## Compatibility

- Current `판매현황내역`: PASS
- Legacy `판매현황`: PASS
- Explicit `options.sheetName`: PASS
- Missing explicit sheet: clear error PASS
- Missing all supported defaults: clear error PASS
- Existing header and sales-row parsing: unchanged, regression PASS

## Real VEIL 2026-08 read-only verification

Source:

`SALES/VEIL/2026/2026-08.xlsx`

- Source SHA-256 before: `f597df071faec43cb82916c5ed2ba51c36b02488e3d4776413083da21bb3d42a`
- Sheet: `판매현황내역`
- Header detection: PASS (`일자-No.`, `품목명`, `합계` and existing optional columns recognized)
- Period start: `2026-08-03`
- Period end: `2026-08-13`
- Parsed detail lines: 7
- Canonical revenue lines: 1
- Non-revenue lines: 6
- Total offline sales: `70,200원`
- Revenue product: `PACOSPLY / WonderLand T-shirts BLACK`
- Revenue brandGroup: `PAC`
- Revenue salesAmount: `70,200원`
- Revenue date: `2026-08-13`

The six other parsed detail rows have no value in the existing `합계` column and remain non-revenue rows under the unchanged parser/canonical policy. No amount was inferred from inventory/purchase-cost columns.

The actual XLSX was read only and was not moved, rewritten, or regenerated.

## Verification

- Loader syntax: PASS
- Test syntax: PASS
- New loader tests: 4/4 PASS
- Store/canonical targeted regression: 46/46 PASS
- Full regression: 665/665 PASS
- `git diff --check`: PASS

The regression test run emitted expected sandbox/network diagnostic warnings from existing Cafe24 cache/log paths, but all tests passed and no work data was written by this change.

## Git state

Files belonging to this batch:

- `scripts/load-ecount-offline-sales.mjs`
- `test/ecount-offline-sales-sheet.test.mjs`
- `docs/reports/ECOUNT-SHEET-COMPAT-VEIL-DATA-CONNECTION.md`

Existing unrelated modified/untracked files were preserved and not staged. No `git add`, commit, push, Render operation, or deploy was performed.
