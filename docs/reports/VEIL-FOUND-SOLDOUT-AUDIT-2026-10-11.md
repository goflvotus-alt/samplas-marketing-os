# VEIL FOUND sold-out caption audit: implementation (local, 2026-10-11)

Approved scope: local implementation, isolated tests and a local commit. No push, no Render deploy, no plugin publication, and no Instagram post, edit or delete. The plan is in `docs/reports/VEIL-FOUND-SOLDOUT-AUDIT-PLAN-2026-10-11.md` of the DEV working tree.

## A. Base branch

`origin/main` (121215c) already holds the VEIL ChatGPT private plugin:

- `veil-found-plugin/`
- `scripts/veil-found-control.mjs`
- `POST /api/ai-audit/veil-found/mcp`
- 5 upload tools

The local DEV branch `codex/weekly-onepage-20261006` does not hold this code. The work was therefore done in a separate worktree, `~/Documents/Codex/samplas-veil-soldout-audit`, on branch `feat/veil-soldout-audit` from `origin/main`. The DEV working tree and its uncommitted ECOUNT changes were not touched.

## B. Real caption check (Chrome, read only)

The public @samplas_veil profile was read. Nothing was clicked except navigation, and no edit or comment was made.

| Post | Date | Carousel slides | Caption items |
|---|---|---:|---|
| DcVwi5Oo1YD | 2026-08-22 | 8 | #001-#008 |
| Dcn02boo2AG | 2026-08-29 | 7 | #009-#015 |
| DdLwRDKoyKB | 2026-09-12 (edited) | 9 | #016-#024 |
| DeUD5C3IyVS | 2026-10-10 | 10 | #025-#034 |

- 34 numbers with no gap and no duplicate. The slide count equals the item count in every post.
- The other `samplas_veil` posts are pre-open, VEIL PEOPLE and VEIL MOOD posts, plus collaboration posts. None of them has a VEIL FOUND number.
- One caption holds several blocks: `VEIL FOUND #NNN` / brand / product, then `<price> KRW` or `SOLD OUT`. The price can be on the product line or on its own line.
- The variants found are `888,000KRW`, `Sold out`, `Sold Out`, `SOLD OUT` and `#022 ` (trailing space). All are handled.
- Examples:
  - Priced: #001
  - SOLD OUT: #002, #004, #026
  - Price on its own line: #005, #017, #024, #030-#034
  - Normal: #025

The captions are stored as the test fixture `test/fixtures/veil-found-captions-2026-10-11.json` (public text plus permalink, no tokens).

## C. Implementation

- `scripts/veil-found-soldout-audit.mjs` (new) has pure functions plus injected read functions:
  - `parseVeilFoundCaption`
  - `matchCafe24Product`: exact match only. Similar names become candidates and are never confirmed.
  - `evaluateCafe24Stock` / `evaluateOption`. These check:
    - product display/selling
    - per-option display/selling
    - `use_inventory` (F = unlimited, sellable)
    - quantity and `display_soldout`
    - the product `sold_out` flag as a cross-check
    - Anything unclear gives `STOCK_UNCERTAIN`.
  - `runVeilSoldOutAudit`: verdicts and coverage. Any failed Cafe24 call gives `ok:false`, `auditStatus: INCOMPLETE`, `notChecked` and `failures[{number, stage, errorCode, status}]`.
    - `errorCode` comes from the existing `classifyAiAuditCafe24Error`.
  - Brands resolve through the existing `buildBrandRegistry` + `resolveBrand` (exact name/alias, null on conflict).
  - SPL_ split identities are `UNCERTAIN_MATCH` without a Cafe24 call.
- `scripts/veil-found-control.mjs` adds two read-only tools after the five upload tools:
  - `auditSoldOutCaptions {view?: issues|all}`. Its description holds "VEIL 품절 검수".
  - `checkSoldOutPost {number}`.
  - Input validation is added. The new `soldOutAudit` dependency fails closed (503) when it is not wired.
- `veil-found-plugin/worker/index.mjs`: the tool list is regenerated from `VEIL_TOOLS` (7 tools). The home page lists the two names. The bridge logic is unchanged.
- `server.mjs`:
  - wires `soldOutAudit` to `fetchInstagramFeed` (existing, GET), `readBrandMasterFile`, `fetchCafe24BrandProducts` and `fetchCafe24ProductVariantsWithInventory`.
  - `fetchCafe24BrandProducts` also returns `product_name`. This is additive; NEW BRANDS reads only its old fields.
- Unchanged:
  - Friday publisher logic, schedule, state and captions
  - upload tools
  - Meta/Dropbox auth
  - Dropbox files
  - Production data

## D. Tests

- `test/veil-found-soldout-audit.test.mjs` (11 new tests) covers:
  - the real feed: #001-#034, slides equal items, and price/SOLD OUT edge cases
  - unparsed captions
  - exact versus similar versus ambiguous matching
  - every stock state, including unlimited, flag conflicts, missing inventory and zero stock without the sold-out display
  - the verdicts over the real feed
  - partial failure giving INCOMPLETE with the count and cause
  - duplicate number, single number and unknown number
  - the feed read being GET only
  - the 7 tools and the Site list being equal
  - input validation
  - no file written in WORK_DIR and no publish call
- `test/veil-found.test.mjs`: the tool-name assertion is updated from 5 to 7 names. This was required by the new tools.
- Plugin `npm run check/build/validate`: OK. `dist/` was removed afterwards.
- Full suite (`node --test test/*.test.mjs`) in the worktree:

| | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| Clean origin/main baseline | 1520 | 1489 | 29 | 2 |
| This change | 1531 | 1500 | 29 | 2 |

The 29 failures have identical names in both runs. They need real gitignored `work/` data that a fresh worktree does not have, plus the gate test that `docs/veil-found-chatgpt.md` already records as failing on the original HEAD. No new failure.

## E. Can #001-#034 be audited? (read-only dry run)

Read-only GETs: Production `/api/brand-master` and `/api/cafe24/products/full-catalog` (10,384 products). These were combined with the real captions.

- Brand resolve plus exact product match: **32 / 34 MATCHED**.
- `#019` SUNDAY OFF CLUB "HAND-ZARDOZI EMBROIDERED BULL LEATHER JACKET": no exact Cafe24 name and no similar candidate. Result: `UNCERTAIN_MATCH`.
- `#027` SOC X MEANTIME resolves to `SPL_92ce8d7290`, a split identity with no Cafe24 brand code. Result: `UNCERTAIN_MATCH`. This is the same brand as the pending B0000COL policy migration.

Product-level flags from the list. These are not final; the per-option verdict needs the variant inventories that only the deployed route reads:

| No. | Caption | Cafe24 product | Likely verdict |
|---|---|---|---|
| #014 XLIM EP.9 01 JACKET DEEP ORANGE | 480,000 KRW | sold_out=T | SOLD_OUT_BUT_PRICED |
| #024 PACOSPLY FALLING ANGEL SPORTS JACKET BLACK | 237,000 KRW | sold_out=T | SOLD_OUT_BUT_PRICED |
| #002 SUNDAY OFF CLUB Cropped Cartel Worker Jacket | Sold out | display=F | OK |
| #004 NVRFRGT DENIM TRUCKER JACKET | Sold Out | sold_out=T | OK |
| #026 RECORDS INC LEE L/S TEE WHITE | SOLD OUT | sold_out=T | OK |

The other 27 matched products are display=T, selling=T, sold_out=F, with a price in the caption. Each is OK unless the options say otherwise.

## F. Not done (separate approval)

- Push and Render deploy.
  - Needed for `product_name` in the Production brand-products route and for the MCP endpoint to serve the 2 tools.
- Private plugin (Site) publication and refreshing the tool list in ChatGPT.
- Live test "VEIL 품절 검수해줘".

## G. Verdict

VEIL SOLD-OUT AUDIT — LOCAL READY. 34/34 captions parsed; 32 exact matches and 2 correctly uncertain. Final per-option verdicts after deploy.
