# BI Revenue-First Product Registry Review

- Date: 2026-08-15 KST
- Starting branch / HEAD: `main` / `21771e3`
- Result: PASS
- Product Registry SHA after read-only browser QA: `becd74e9b752cfd7ace48980676edfb0db2c33d9c346ed19dfbb5c42d9f5ceb9`

## 1. Existing Product Registry structure

`work/product-registry.json` is the canonical Cafe24 ↔ ECOUNT registry. An entry is usable by Brand Intelligence only when `verified === true` and `status === "confirmed"`. `work/product-registry-review-queue.json` remains diagnostic evidence. The existing Product Registry page/card/detail shell was extended; no new app was created.

## 2. Problem

Real August revenue existed on products whose registry state was ambiguous, candidate, unmatched, or absent. Those products correctly stayed outside exact Stock/Color/SKU joins, but the legacy queue did not prioritize their revenue impact.

## 3. Revenue Priority source

The queue reads the existing Monthly report `commerce.productSales` returned by `/api/reports/monthly?month=YYYY-MM`. Revenue uses the existing `canonicalPaidAmount`/paid amount. No sales calculation, archive selection, or canonical revenue rule was added or changed.

## 4. Queue condition

- Include: canonical product sales with revenue greater than zero and not both verified and confirmed.
- Exclude by default: verified+confirmed products and zero-revenue products.
- Join key: Cafe24 `productNo` only.
- Default order: revenue descending, quantity descending, order count descending.
- 2026-08 result: 64 sold products, 8 already confirmed, 56 Revenue Priority items, ₩17,870,052 revenue at risk.

## 5. Status classification

The API/UI preserves actual registry states (`ambiguous`, `candidate`, `unmatched`) and adds `no_registry_entry` when no Cafe24 productNo entry exists. It does not promote a state automatically.

## 6. Candidate grouping

Existing `matchedProducts` arrays are retained, so size families can be approved together. For a missing registry entry only, candidate discovery reuses the existing deterministic `normalizeProductName()` and `splitEcountProductName()` functions against `work/ecount-inventory/latest.json`; only exact normalized product-name evidence is shown. No fuzzy candidate or sales join was added.

## 7. QQQ policy

QQQ candidates remain visible as `QQQ / SPECIAL`, are never preselected, and their checkboxes are disabled. The writer rejects QQQ codes even if a request is forged.

## 8. Approval pipeline

Product Registry → Revenue Priority → product → ECOUNT candidate(s) → `선택 후보로 승인`.

The server re-reads the Monthly product evidence and ECOUNT inventory, validates selected codes against trusted candidates, then writes `verified: true`, `status: confirmed`, selected `matchedProducts`, human-review matching evidence, and `updatedAt`. Missing entries are created only after this explicit approval with Cafe24 productNo as canonical identity. The UI reloads immediately and selects the next remaining item.

## 9. Atomic write

The writer creates a full backup, writes a UUID temporary JSON file, parses it, and renames it over `work/product-registry.json`. Writes are serialized in the Intelligence service.

## 10. Rollback

Restore the matching `work/backups/product-registry.json.pre-revenue-review-<timestamp>` file to `work/product-registry.json` using the same atomic replacement pattern. No rollback was needed in this implementation/QA; the live master was not changed.

## 11. Cache invalidation

There is no retained Product Registry object cache in this route. GET and PATCH read the registry from disk, and the UI reloads all registry/revenue data after approval. The next Brand Intelligence refresh therefore reads the updated registry without a browser restart.

## 12. Brand Intelligence reflection

The approval format matches the existing verified+confirmed contract. No resolver or Brand Intelligence business rule was changed.

## 13. Color reflection

No Color Master/classifier rule changed. Approved exact ECOUNT product names become eligible for the existing Color classifier; unapproved rows remain UNKNOWN as designed.

## 14. Stock reflection

Approved `matchedProducts` keep exact `prodCd` and size data for the existing inventory join. Null, zero, and negative stock semantics were not changed.

## 15. UI

Added a prominent Revenue Priority tab, month selector, revenue/quantity/order sorting, existing search/filter support, revenue impact, affected Intelligence labels, trusted candidate checkboxes, QQQ/SPECIAL display, and human-only approval action. Existing Product Registry card/detail styling was reused.

## 16. Tests

- Targeted Product Registry/revenue review: 5/5 PASS.
- Related Product Registry + Category + Color regression: 65/65 PASS in the final targeted set.
- Full regression: 751/751 PASS.
- JavaScript syntax: PASS.
- `git diff --check`: PASS.
- Tests use temporary registries; the operating Product Registry SHA remained unchanged.

Coverage includes confirmed exclusion, ambiguous/candidate/no-entry inclusion, zero exclusion, sorting, pre-approval immutability, existing-entry approval, missing-entry creation, multi-size preservation, backup, summary refresh, invalid evidence rejection, and QQQ rejection.

## 17. Browser QA

Verified at `http://127.0.0.1:8787/outputs/samplas-marketing-os.html#product-registry` with current 8787/8797 code:

- Revenue Priority visible and 2026-08 count 56.
- Revenue ordering and CARNET search work.
- HAND COATED shows both M/L candidates and a human approval button.
- ZIP no-entry shows CAR253LT00402/3/4 plus disabled QQQ00260 SPECIAL.
- Confirmed MASS DENIM is absent from the default revenue queue.
- Approval was not clicked against operating data.
- Console errors: 0.

## 18. CARNET cases

| Product | Revenue | State | Candidates |
|---|---:|---|---|
| ZIP BELT EGG CLUSTER… IVORY | ₩1,210,000 | no_registry_entry | CAR253LT00402 S, 00403 M, 00404 L; QQQ00260 shown/disabled |
| HAND COATED MASS VEST OIL BLACK | ₩628,139 | ambiguous | CAR261OT01203 M, CAR261OT01204 L |
| Unearthed Fragment Chain Oil Black | ₩269,660 | ambiguous | CAR253AC01500, POP254CAR047 |
| Burnt Silver Dog Tag Burn Silver | ₩124,160 | candidate | CAR253AC01800 |
| MASS DENIM JACKET DARK GREY | ₩0 | confirmed | excluded from default Revenue Priority |

## 19. Files changed for this batch

- `intelligence-service.mjs`
- `outputs/samplas-marketing-os.html`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.css`
- `scripts/product-registry-revenue-review.mjs` (new)
- `test/product-registry-revenue-review.test.mjs` (new)
- `docs/reports/BI-REVENUE-FIRST-PRODUCT-REGISTRY-REVIEW.md` (new)

These tracked UI/service files already contained unrelated dirty work; nothing was reset or staged.

## 20. Git diff stat

The repository-wide tracked diff at completion contains pre-existing work as well as this batch: 12 tracked files, 2,094 insertions, 338 deletions before this report. New untracked scripts/tests/reports are not represented by normal `git diff --stat` until tracked.

## 21. Git status

Working tree remains intentionally dirty with pre-existing Brand Intelligence, Store Intelligence, ECOUNT loader, category/color, reports, SALES, backups, and test changes. This batch added the seven files listed above or appended scoped hunks to them. Staging, commit, push, and deploy were not performed.

## 22. Remaining limitations

- Candidate discovery for missing entries is exact normalized name only. Products without exact trusted ECOUNT evidence remain visible but cannot be approved until diagnostics/inventory evidence is refreshed.
- Approval was verified with temporary fixtures and UI shell only; no operating Product Registry entry was approved during QA.
- Color and Stock reflection occurs on the next existing Brand Intelligence refresh after a real human approval; no fabricated post-approval business value was generated.
