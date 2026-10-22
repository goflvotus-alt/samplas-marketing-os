# Weekly Meta sales tracing

The existing weekly generator retains its Meta KPI, publication review and refund ledger calculations. Supplemental sheets read all Admin orders from `analyticsOrders`, not only the Meta inflow subset in `ACTUAL_PRODUCTS_SOLD`.

- `ORDER_DETAIL`: one row per unique order item, including completed claims and private payment placeholders. Customer fields are not copied. Private payment titles are replaced, because they can contain a person's name.
- `PRODUCT SUMMARY`: brand/product/variant/option quantities and verified amounts. Brand comes from the explicit product-name prefix. Unknown brand or private payment composition remains unavailable.
- `META_PRODUCTS`: existing `product_id` Insights breakdown and the existing Cafe24 `product.variant` parser. Compares aggregates only; never a purchase-event/order join. Unknown identifiers remain unresolved.
- `TRACKING_DIAGNOSTICS`: allowlisted creative UTM fields, order acquisition evidence, G1 ad-ID matches, G2 unique-name candidates and G3 unmatched paid inflow. G1 proves acquisition, not an individual Meta conversion. Legacy `inflow_path` queries do not prove `ghost_mall_id` coverage.
- `DAILY SALES` / `ORDER_TOTALS`: order-level controls. Verified item revenue plus explicitly unallocated revenue plus shipping reconciles to canonical V2 order revenue. Missing quantities and payment fields never become plausible zero sales.

## Payment lookup and limitations

The supplemental payment lookup uses GET `/orders/paymentamount`, with bounded batches and the existing stored access token. It never refreshes a token, retries an API failure, writes a token file or changes environment settings. Expired, invalid-expiry and near-expiry credentials fail closed.

Do not send the Orders reader's synthetic `2025-07-01` API version floor to this endpoint. Production returned HTTP 400 `invalid version`. The obsolete `2025-06-01` version was also rejected; the API identified the OAuth app default as `2026-03-01`. Omitting the optional version header uses that existing app default without changing its setting. The corrected GET returned HTTP 200 but no payment records for the requested historical multi-item orders. Treat those records as unavailable; this is not a zero-amount result.

Cafe24 documents that item-payment lookup requires automatic discount calculation. An empty historical result alone does not prove that this setting caused the missing records. Check existing historical calculation/payment exports with an operator before making any conclusion; do not enable settings or allocate discounts to make the workbook reconcile.

References: https://apidocs.cafe24.com/en/docs/2026-06-01/admin/get-orders-paymentamount

## Review before deployment

Generate a local sample from retained source snapshots, compare weekly spend and ROAS with account totals, inspect all-order and product sums, and confirm no customer fields or private payment names appear in the exported workbook. Compare full regression failures against the clean base under the same test environment. Missing item amounts, private-payment composition and refund-date population must be explicitly reported. All sales reflect order date and the state at read time, not a reconstructed historical close.

Real-data validation must use existing authenticated GET paths, persist no credentials and avoid server imports or starting the scheduler. Do not invoke OAuth, force refresh tokens, issue reports, upload to Dropbox or alter prior issued XLSX/manifest files. Publication rules and the existing eight-week correction ledger are unchanged.
