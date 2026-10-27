# Product/brand attribution residual: root cause (read only, 2026-10-07)

Read only. The input is the Production Cafe24 order data for 2026-01..10, fetched today with `GET /api/cafe24/orders` (the canonical order cache). Each order was run locally through the deployed `allocateCanonicalPaidSalesForOrder` (`server.mjs`) and the canonical module functions. There was no code change and no Production write. Order ids are masked; the report holds no personal data.

## A. April residual total

Production April reconciliation (after the 21c141c deploy):

- orderPaid 60,115,561
- products 60,067,161
- shipping 22,000
- reported `difference` **0**

The real gap is orderPaid − products − shipping = **26,400**.

Per-order recompute: `residual = orderPaid − shipping − allocatedProductPaid`, over all non-excluded orders.

| Order | canceled | Paid | Shipping | Allocated | Residual | Reported difference |
|---|---|---:|---:|---:|---:|---:|
| 20260401…088 | F | 19,800 | 3,000 | 0 | **16,800** | 0 |
| 20260429…041 | M | 9,600 | 0 | 0 | **9,600** | 0 |
| **Total** | | | | | **26,400** | 0 |

The breakdown is **not** 9,600 + 9,600 + 7,200. It is two orders: 16,800 + 9,600. The 16,800 order splits arithmetically into 9,600 + 7,200, which is probably where the three-case reading came from.

## B. The two "9,600" cases

- **20260429…041 has a residual of 9,600.**
  - Items: N40 48,000×1 with `additional_discount_price` 76,800; R40 48,000×1 (claimed) with no discount.
  - Initial payment 19,200 (= 96,000 × 20%). After the return, the remaining payment is 9,600.
  - Cafe24 records the discount for both lines (76,800) on the surviving line only. The surviving line's direct net is therefore max(0, 48,000 − 76,800) = 0. The order's total direct net is 0, so the order takes the zero-net early return.
- **20260429…111 has no residual.**
  - Items: C40 48,000 (−38,400), N40 48,000 (−38,400), C40 68,000 (−54,400). The discount is spread per line at 80%.
  - The surviving N40 net is 9,600. It is allocated 9,600, which reconciles.
  - This order was a false suspect.

## C. The "7,200" case = 20260401…088 (residual 16,800)

- Not a claim order: `canceled` is F and the order has one N40 line.
- Item: 28,000 × 2 = gross 56,000, `additional_discount_price` 39,200.
- Paid 19,800 − shipping 3,000 = 16,800 = 56,000 − 39,200. Cafe24's `additional_discount_price` is the **line total**.
- `cafe24ItemDirectDiscountAmount` multiplies every discount field by quantity: 39,200 × 2 = 78,400. Capped at gross, that leaves a direct net of 0. The order takes the same early return.
- Evidence on line-total vs per-unit semantics: across 2026 there are only 2 orders with quantity > 1 and a direct discount. One reconciles only as a line total (this order). The other is a 0-paid order, so it is not informative. The evidence is n = 1.

## D. Current allocation pipeline

1. `cafe24OrderItems(order)` keeps items that are not `isCafe24CanceledItem` (C40/R40 excluded), so returned items never receive money.
2. For each surviving item:
   - gross = `product_price × qty`
   - directDiscount = min(gross, Σ(item discount fields) × qty)
   - directNet = max(0, gross − directDiscount)
3. orderPaid = `cafe24OrderAmount(order)`; shipping = min(orderPaid, `cafe24ShippingFee`); allocatable = orderPaid − shipping.
4. **If allocatable === 0 or Σ directNet ≤ 0 (`server.mjs:4237`):** every item gets 0, and the function returns `difference: 0, matched: true`.
5. Otherwise, allocatable is split proportionally to directNet with `Math.round`. The rounding residue goes to the largest-directNet item, clamped by `Math.max(0, …)`. `difference` = allocatable − allocated.
6. Brand/product rows add the item `paidAmount`. Reconciliation adds `orderAllocation.difference` only for orders where some active item has a `product_no`.

## E. 2026 full-year residual audit

| Month | Orders With Residual | Residual Amount |
|---|---:|---:|
| 2026-01 | 0 | 0 |
| 2026-02 | 0 | 0 |
| 2026-03 | 0 | 0 |
| 2026-04 | 2 | 26,400 |
| 2026-05 | 0 | 0 |
| 2026-06 | 0 | 0 |
| 2026-07 | 0 | 0 |
| 2026-08 | 0 | 0 |
| 2026-09 | 0 | 0 |
| 2026-10 | 0 | 0 |
| **Total** | **2** | **26,400** |

Other suspected paths had no cases in 2026:

- The negative rounding-residue clamp in step 5.
- Orders without a `product_no` that are skipped by reconciliation.
- Orders with no active items.

## F. Why the difference field misses it

The early return in step 4 hard-codes `difference: 0` and `matched: true` even when allocatable > 0 and nothing was allocated. Reconciliation sums only `difference`, so the April total reports 0 while products + shipping are 26,400 short. The check is not computed from the amounts; it is asserted. Every other branch computes `difference` as allocatable − allocated.

## G. Root cause

The two orders share one masking defect and have two different triggers.

1. **Defect (both orders):** when the surviving items' direct net sums to 0 but money remains, the function allocates nothing and reports a match. This is the root cause of the lost 26,400 and of the silent check.
2. **Trigger 1 (…088):** `additional_discount_price` is a line total but is multiplied by quantity. This double-counts the discount for quantity > 1.
3. **Trigger 2 (…041):** Cafe24 stores an order-wide discount on a single surviving line, so that line's discount exceeds its price. This is Cafe24 data shape, not our arithmetic.

Fixing trigger 1 alone would recover …088 only. Fixing the defect recovers both, and it also covers future data shapes.

## H. Minimal fix design (not implemented)

Make one change inside `allocateCanonicalPaidSalesForOrder`, the shared function that all callers use.

- When allocatable > 0 and Σ directNet ≤ 0, fall back to **surviving-item gross weights** (the existing `grossAmount`). Use the same proportional `Math.round` allocation, and give the residue to the largest eligible item.
- If gross is also 0, give the full allocatable amount to the last surviving item. The result stays deterministic.
- Compute `difference` from the amounts in every branch; never hard-code it. Keep `allocatable === 0`, where `difference = 0` is true.
- Remove the `Math.max(0, …)` residue clamp, or apply a negative residue to the largest item. Order-level reconciliation then holds exactly, even when one item nets negative.
- Returned/canceled items are already filtered before weighting, so they can never receive money.
- Order paid, total sales, archives and canonical online stay unchanged. Only the item/brand split of these orders changes: April products +26,400, difference 0 and true.

Optional, separate decision: treat `additional_discount_price` as a line total instead of multiplying it by quantity. There is only 1 supporting order, and the semantics of the other discount fields are unverified, so this is not needed for the 26,400. The fallback above already sends …088's 16,800 to its only surviving item.

Test: one unit test with the two masked orders (fixture whitelist as in `cafe24-partial-claims.test.mjs`). It asserts:

- allocated + shipping = paid
- no C40/R40 item receives money
- `difference` is computed

## I. Mutation check

- Production: only the GETs used for the order fetch. No order, archive, ECOUNT, Brand Master, policy or pending change.
- No push and no deploy.
- Code: none changed. The only new file is this report. Scratch data stays in the session scratchpad.

## J. Verdict

**PRODUCT ATTRIBUTION RESIDUAL — ROOT CAUSE IDENTIFIED.**

The 26,400 is two April orders: 16,800 (…088) and 9,600 (…041). In both, the surviving items' direct net comes out at 0, so the zero-net early return allocates nothing. That branch also reports `difference: 0`, which hides the gap. No other 2026 month has a residual.
