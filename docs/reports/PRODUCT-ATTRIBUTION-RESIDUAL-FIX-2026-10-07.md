# Product/brand attribution residual: fix (local only, 2026-10-07)

Follow-up to `PRODUCT-ATTRIBUTION-RESIDUAL-2026-10-07.md`. Local implementation, tests and commit only. No push, no deploy, no Production or archive write.

## A. Fallback allocation

`allocateCanonicalPaidSalesForOrder` (`server.mjs`) now picks its weights in this order:

1. Surviving-item direct net, when the sum is > 0. This is the old behavior, unchanged.
2. Otherwise, surviving-item gross (`product_price × qty`), when the sum is > 0.
3. Otherwise, the last surviving item in Cafe24 item order takes the whole allocatable amount. The result is deterministic.

C40/R40 items are filtered out before any weighting, as before. The `allocatable === 0` case runs through the same code: every item gets 0 and the computed difference is 0.

## B. Difference fix

The early return with hard-coded `difference: 0, matched: true` is removed. Every path with active items now returns `difference = orderPaid − shipping − Σ item paidAmount`.

The rounding residue still goes to the largest-weight item (first on ties), as before. The old `Math.max(0, …)` clamp is replaced by a carry: if a negative residue would push that item below 0, the rest moves to the next-largest item. Every item stays ≥ 0 and the item sum always equals allocatable. For every 2026 order with direct net > 0, the per-item amounts are identical to the old code (see D).

## C. April two orders

| Order | Paid | Shipping | Allocatable | Before | After | Difference |
|---|---:|---:|---:|---:|---:|---:|
| 20260401…088 (F, N40 28,000×2) | 19,800 | 3,000 | 16,800 | 0 | N40 16,800 | 0 |
| 20260429…041 (M, N40 + R40) | 9,600 | 0 | 9,600 | 0 | N40 9,600, R40 not allocated | 0 |

## D. 2026 residual result

The old (HEAD 21c141c) and new functions were both run over every Production order fetched today for 2026-01..10.

| Month | Residual before | Residual after | Orders changed |
|---|---:|---:|---:|
| 2026-01..03 | 0 | 0 | 0 |
| 2026-04 | 26,400 | 0 | 2 |
| 2026-05..10 | 0 | 0 | 0 |

Only the two April orders changed. No order has a negative item allocation. `difference` equals the real residual for every order.

## E. Total sales invariance

The change is limited to item attribution. `cafe24OrderAmount`, `cafe24ShippingFee`, `isCafe24CanceledOrRefunded` and the canonical summary are untouched. `/api/sales/total`, Monthly and Clients take online from those functions and not from the allocation.

In the comparison, `orderPaidAmount` was identical between the old and new functions for every order in every month. Canonical online, recomputed per month, matches the Production values:

| Month | Canonical online |
|---|---:|
| Jan | 41,989,838 |
| Feb | 37,393,089 |
| Mar | 60,631,553 |
| Apr | 60,115,561 |
| May | 35,269,721 |
| Jun | 29,636,386 |
| Jul | 35,000,863 |
| Aug | 34,722,620 |
| Sep | 31,099,793 |
| Oct | 5,041,234 |

Archives are not read or written by this function.

## F. Product / brand attribution

- April product attribution: +26,400. Before the fix, products were 60,067,161; with shipping 22,000, the expected result is 60,093,561 + 22,000 = orderPaid 60,115,561.
- Products affected: product_no 8669 (P0000MVL) +16,800 and product_no 5484 (P0000ICY) +9,600.
- Their brands gain those amounts after deploy. Production will confirm the result.
- The AI audit reconciliation/order routes call the same function, so they report the true difference too.

## G. Tests

New file `test/cafe24-attribution-residual.test.mjs` (7 tests) with the fixture `test/fixtures/cafe24-attribution-residual-2026-04.json` (two real orders, whitelisted fields, synthetic ids). It covers:

- the unchanged direct-net split and residue
- the gross fallback, including over-discounted items
- the gross = 0 last-item fallback
- C40/R40 exclusion
- a difference computed on every path
- 2,000 seeded random shapes (exact sum, no negative item)
- the two April orders (16,800 / 9,600, residual 26,400 → 0, order paid untouched)
- the 2026 partial-claim fixture still reconciling

Full suite (`node --test test/*.test.mjs`): 1,439 pass, 0 fail.

## H. Modified files

- `server.mjs`: `allocateCanonicalPaidSalesForOrder` only.
- `test/cafe24-attribution-residual.test.mjs` (new).
- `test/fixtures/cafe24-attribution-residual-2026-04.json` (new).
- This report.

## I. Commit

See git log: `fix(attribution): allocate surviving-item residual and compute difference on every path`.

## J. Open issue: discount × quantity

`cafe24ItemDirectDiscountAmount` multiplies every item discount field, including `additional_discount_price`, by quantity. Order …088 shows that `additional_discount_price` is a line total: 56,000 − 39,200 = 16,800 = paid − shipping. Multiplying it by quantity double-counts the discount when quantity > 1.

This is not changed here:

- The evidence is one order.
- The semantics of the other discount fields are unverified.
- The fallback already removes the residual.

It affects only the relative weights in multi-item orders with quantity > 1, never the order total. A separate audit is needed.

## K. Verdict

PRODUCT ATTRIBUTION RESIDUAL — FIX READY. Full suite: 1,439 tests, 1,439 pass, 0 fail.
