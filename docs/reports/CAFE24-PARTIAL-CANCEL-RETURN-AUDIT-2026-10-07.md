# Cafe24 partial cancel/return in canonical Sales: root cause (read only, 2026-10-07)

Read only: `GET /api/cafe24/orders` per month (Production canonical order cache; past months are cached). The computation used the canonical module's own functions locally. No code change, no write. Order ids are masked; no personal data.

## A. Current policy (`scripts/cafe24-order-amount.mjs`)

Canonical online = `summarizeCafe24Orders(orders).totals.orderAmount` = the sum of `cafe24OrderAmount(order)` over orders that are not `isCafe24CanceledOrRefunded`. This was verified: the recomputed totals equal Production `orderAmount` and `/api/sales/total` online for every month from Jan to Oct.

`isCafe24CanceledOrRefunded(order)` excludes the **whole order** when either:
- any order-level flag (`canceled`, `cancelled`, `refunded`, `returned`, `*_status`) is one of `t/true/y/yes/cancel/…`, or
- **any** order-level `cancel_date`, `return_confirmed_date` or `refund_date` exists.

Item status is not consulted. Otherwise the amount is `actual_order_amount.payment_amount`, which Cafe24 reduces after partial claims; the stored-value fallback applies when the payment is 0.

| Case | Cafe24 shape | Current result |
|---|---|---|
| Full cancel/return/refund | `canceled: "T"` + order-level dates | 0 (correct) |
| Partial, order-level date not (yet) set | `canceled: "M"`, no order-level date | counted at the reduced `actual_order_amount.payment_amount` (correct) |
| **Partial, order-level date set** | `canceled: "M"` + order-level `cancel_date`/`return_confirmed_date` | **0: the remaining payment is dropped** |

## B. Cafe24 partial-order model (from the actual responses)

- The order-level `canceled` flag takes **`F`** (1,141), **`T`** (327) and **`M`** (43) across 2026-01..10. `M` is Cafe24's own partial marker.
- Item `order_status` codes: `N40` kept/delivered; `C40` cancelled (취소완료); `R40` returned (반품완료).
- After a partial claim, Cafe24 keeps `initial_order_amount.payment_amount` (the original) and lowers **`actual_order_amount.payment_amount` to the amount still paid**. That is the field canonical already uses for every other order.
- Order-level `cancel_date` / `return_confirmed_date` hold the **latest claim time**, even when other items remain. Their presence therefore does not mean "fully cancelled".

## C. Key sample 20260825…048

| Field | Value |
|---|---|
| Items | 6: 4 returned (R40, completed 2026-08-31 11:32 and 19:56 KST), 2 kept (N40) |
| Original payment | 840,200 (`initial_order_amount.payment_amount`) |
| Current actual payment | **238,000** = kept items 230,000 + shipping 8,000 (`actual_order_amount.payment_amount`) |
| Order flag | `canceled: "M"`; order-level `cancel_date` = `return_confirmed_date` = 2026-08-31 19:56 |
| Canonical | 0, because of the order-level date |
| Partial-aware | 238,000 (the same `cafe24OrderAmount`, without the date short-circuit) |

The 238,000 is real remaining revenue: Cafe24's own current paid amount for an order that still has two delivered items.

## D. Full vs partial

- `T` → the full claim is confirmed by Cafe24 → 0 stays correct.
- `M` → partial. The remaining items are active, and `actual_order_amount.payment_amount` is the remaining payment.
- Using "any date → whole order out" for `M` orders makes the result depend on whether Cafe24 has stamped the order-level date: 19 `M` orders are dropped, while the other `M` orders are counted at their reduced amount. The same Cafe24 state gives two different answers.
- Anomaly kept as is: `20260101…105` is flagged `T` with 1 of 2 items kept and actual 128,000. Cafe24 marks it fully cancelled (possibly an exchange), so a minimal fix keyed on `M` leaves it at 0.

## E. 2026 monthly impact (Production orders, canonical functions)

| Month | Current canonical online | Partial-aware (`M` only) | Difference | Affected orders |
|---|---|---|---|---|
| 2026-01 | 41,060,858 | 41,989,838 | +928,980 | 2 |
| 2026-02 | 36,073,089 | 37,393,089 | +1,320,000 | 2 |
| 2026-03 | 59,947,553 | 60,631,553 | +684,000 | 2 |
| 2026-04 | 59,101,361 | 60,115,561 | +1,014,200 | 3 |
| 2026-05 | 29,508,421 | 35,269,721 | **+5,761,300** | 2 (one is 17 items / 4,206,000 remaining) |
| 2026-06 | 28,535,186 | 29,636,386 | +1,101,200 | 2 |
| 2026-07 | 34,591,903 | 35,000,863 | +408,960 | 2 |
| 2026-08 | 33,636,420 | 34,722,620 | +1,086,200 | 3 |
| 2026-09 | 30,967,793 | 31,099,793 | +132,000 | 1 |
| 2026-10 (to 10-07) | 5,041,234 | 5,041,234 | 0 | 0 |
| **Total** | 358,463,818 | 370,900,658 | **+12,436,840** | **19** |

The item-heuristic variant, which also counts the `T` anomaly, gives +12,564,840 / 20 orders. **This is structural:** 19 orders across 9 months, 3.5% of 2026 online revenue.

The per-order list (19 `M` orders plus the `T` anomaly) is in the session table: order, items, claimed/kept, original/actual payment, shipping, canonical 0 vs partial-aware.

## F. Other policies

A fix limited to `canceled === "M"` orders leaves the following unchanged:
- full cancel/refund (`T`) → still 0
- the amount function itself (`cafe24OrderAmount`, `actual_order_amount.payment_amount`)
- the stored-value / points fallback
- shipping treatment (same `payment_amount` as every counted order)
- Naver Pay points
- 개인결제창 and gift handling (brand attribution, not totals)
- TAXFREE / QQQ (ECOUNT offline)

## G. Clients / Monthly impact (preview only)

- Canonical Sales online and total rise by the amounts in E for each month.
- Clients:
  - current month: follows live
  - September (canonical fallback): +132,000
  - after the planned online-from-canonical change, July/August would show the partial-aware live values: July online 35,000,863, August 34,722,620
- Monthly saved archives keep their frozen values. They also excluded these orders, if the date was set before the archive was built. Re-saving or a live online read is the separate decision already open from the previous audit.

## H. Root cause

`isCafe24CanceledOrRefunded` treats the **presence of an order-level claim date** as a full cancellation. Cafe24 sets those dates on partially claimed orders too (`canceled: "M"`), while reducing `actual_order_amount.payment_amount` to the remaining paid amount. The remaining revenue of such orders is therefore dropped.

## I. Minimal fix design (not implemented)

In `isCafe24CanceledOrRefunded`:
- **If the order-level `canceled`/`cancelled` flag is `"M"`, return false.** A partially claimed order is active, and `cafe24OrderAmount` already returns Cafe24's reduced `actual_order_amount.payment_amount`.
- All other behaviour is kept: `T`/`true`/… → excluded; dates without an `M` flag → excluded as today.

No new amount rule is added. The amount stays exactly `cafe24OrderAmount`.

Tests:
- 20260825…048 shape → 238,000
- a `T` full return → 0
- an `M` order without dates → unchanged (already counted)
- the `T` anomaly → 0
- monthly totals for a fixture month match the E table

The shared module also affects Clients/Today item-level views (`cafe24ShippingFee`, `cafe24GrossOrderAmount`, `cafe24InitialOrderAmount`, `cafe24PointsUsedAmount` use the same guard). They will start counting `M` orders' remaining shipping and gross too, which is consistent. Item-level product sales already skip claimed items via `isCafe24CanceledItem`, but that function does not recognise `R40` (반품완료 without `C3`). Review it in the same change, so returned items in an `M` order are not counted at item level.

## J. Mutation check

GET only (`/api/cafe24/orders`, Jan–Oct). These may refresh the derived order cache, but no order, archive, ECOUNT, Clients, Monthly, Brand Master, policy or pending was changed. No push or deploy.

## K. Verdict

CAFE24 PARTIAL CANCEL/RETURN — ROOT CAUSE IDENTIFIED: an order-level claim date is treated as a full cancellation. For Cafe24 partial orders (`canceled: "M"`), this drops the remaining `actual_order_amount.payment_amount`. 2026 impact: +12,436,840 over 19 orders.

## Canonical fix (local commit, not deployed)

1. **Order level:** `isCafe24CanceledOrRefunded` returns false when the order-level `canceled`/`cancelled` is `"M"` (Cafe24's partial-claim marker).
   - The amount is unchanged: `cafe24OrderAmount` = `actual_order_amount.payment_amount`, Cafe24's remaining payment.
   - `T` and every other existing rule are unchanged.
2. **Item level:** `isCafe24CanceledItem` treats Cafe24 item `order_status` `C40` (취소완료) and `R40` (반품완료) as claimed; `N40` is kept. Returned items are never allocated in product or brand sales. This also corrects attribution for partial orders that were already counted (an `M` order without dates still had its R40 items allocated).
3. **No new amount or allocation rule.** `allocateCanonicalPaidSalesForOrder` is only exported, for tests.

**Verification on all 1,511 Production orders (2026-01..10):** every month equals the audited "partial-aware" value. The total moves from 358,463,818 to 370,900,658 (+12,436,840), and exactly the 19 `M`-with-claim-date orders change.

**Product attribution:**
- `20260825…048` → active items are only the 2 N40 rows, 68,000 + 162,000, plus shipping 8,000 = 238,000.
- Across all 43 `M` orders, no C40/R40 item is allocated.
- One pre-existing allocation edge remains: `20260429…041`. After the return, Cafe24 put the whole order's `additional_discount_price` (76,800) on the kept 48,000 item, so its direct net is 0 and the allocator puts 9,600 into its reconciliation `difference` instead of the product. The order total is correct. This edge is not new (it applies to any order whose discounts exceed gross) and was left unchanged.

**Tests:** `test/cafe24-partial-claims.test.mjs` with the PII-free fixture `test/fixtures/cafe24-partial-claims-2026.json` (23 real orders, whitelisted fields, synthetic ids).
- C40/R40/N40 item status.
- `…048`: 238,000, N40-only allocation, reconciled.
- `T` full and the `T` anomaly → 0.
- `M` without dates and a normal order → unchanged.
- The 19 orders → per-month deltas equal the audit and total +12,436,840.

Full suite: 1425/1425. Clients, Monthly and archives were not changed.
