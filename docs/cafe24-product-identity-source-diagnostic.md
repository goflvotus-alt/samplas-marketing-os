# Cafe24 Product Identity Source Diagnostic

Generated for SAMPLAS Inventory Intelligence Phase 2B.

## Scope

This is a read-only discovery note. It does not create matches, confirm registry rows, update inventory, or rebuild operating caches.

## Investigated APIs and Code Paths

- `fetchCafe24ProductList()` → `GET /api/v2/admin/products`
- `fetchCafe24ProductDetail(productNo)` → `GET /api/v2/admin/products/{productNo}`
- `fetchCafe24ProductVariantsWithInventory(productNo)` → `GET /api/v2/admin/products/{productNo}/variants?embed=inventories`
- Existing diagnostic endpoint: `/api/diagnostics/cafe24-product-access`
- Loader/cache flow: Product list + product detail + variants/inventories → `normalizeCafe24ProductRow()` → `work/product-dashboard-proxy-*.json`

## Investigated Caches

- `work/product-dashboard-proxy-2026-06-24_2026-07-18.json`
- `work/ecount-inventory/latest.json`
- `work/ecount-inventory/raw-products.json`

## Findings

Current Product Dashboard cache retains Cafe24:

- `productNo`
- `productCode`
- `productName`
- `brand`
- `manufacturer_code`
- `options[].variantCode`
- `options[].optionSummary`
- `options[].quantity`
- `inventoryQuantity`

Current Product Dashboard cache does not contain barcode-like fields:

- `barcode`
- `ean`
- `jan`
- `isbn`
- `upc`
- `gtin`

ECOUNT has strong identity data:

- `BAR_CODE`: present for 9,866 rows in raw product master/latest-derived data
- `PROD_CD`: present for 10,000 rows
- `PROD_DES`: present for 10,000 rows
- `SIZE_DES`: present for 9,973 rows

## API vs Cache Conclusion

This phase did not call the external Cafe24 API. Based on source-code inspection, if Cafe24 product detail or variant responses include barcode-like fields, the current `normalizeCafe24ProductRow()` would not retain them in Product Dashboard cache because it only maps selected fields.

The existing `/api/diagnostics/cafe24-product-access` endpoint checks product, variant, inventory, image, category, sales, and order readiness, but its requested field matrix does not currently inspect `barcode/ean/jan/isbn/upc/gtin` aliases.

Therefore:

- Confirmed: barcode-like fields are absent from the current Product Dashboard cache.
- Confirmed: ECOUNT barcode is available and strong.
- Not confirmed: whether Cafe24 API itself has barcode-like fields.
- Confirmed: current loader would drop barcode-like fields unless explicitly retained in a later approved phase.

## Identity Signal Grades

Strong:

- Barcode/EAN/JAN/ISBN/UPC/GTIN, if Cafe24 API provenance is confirmed.

Medium:

- Cafe24 `productNo`
- Cafe24 `productCode`
- Cafe24 `manufacturer_code`
- Cafe24 `variantCode`

Weak:

- Product name
- Normalized product name
- Option summary/value
- Brand token

Not usable from current cache:

- Cafe24 barcode-like fields, because they are absent.

## ECOUNT Connection Possibility

- `ECOUNT BAR_CODE ↔ Cafe24 barcode/ean/upc/gtin`: Strong in principle, unavailable in current Cafe24 cache.
- `ECOUNT PROD_CD ↔ Cafe24 productCode/manufacturer_code`: Medium, but observed values do not reliably match the ECOUNT code system.
- `ECOUNT PROD_DES/SIZE_DES ↔ Cafe24 productName/options`: Weak, candidate/manual-review only.

## Recommendation

Next step should be a read-only Cafe24 API identity probe that inspects product detail, variants, inventories, and any custom/additional fields for barcode-like aliases. Do not use name-only or brand-only evidence for confirmation.
