# Cafe24 Render Product Identity Probe

Read-only retry after Cafe24 OAuth reauthentication.

## Access Path

This probe uses the existing authenticated Render server path. It does not copy local tokens or create a local token store.

- Token diagnostic: `GET /api/diagnostics/cafe24-token-store`
- Product access diagnostic: `GET /api/diagnostics/cafe24-product-access`
- Product detail: `GET /api/cafe24/products/{productNo}`

All calls are GET requests. No product, option, inventory, cache, registry, or UI data is modified.

## Authentication Result

Render token store status:

- source: `render_persistent_disk`
- configured: true
- status: active
- has access token: true
- has refresh token: true
- needs refresh: false
- reauth required: false
- last error: none

## Sample

Product numbers:

- `14600`
- `14595`
- `14599`
- `14598`
- `14597`

All 5 product detail calls succeeded.

## Endpoint Result

From Render product access diagnostic:

- Product list: success
- Product detail: success
- Product variants: success
- Orders: success
- Product images: 404
- Product categories: 404
- Product inventories: 404
- Sales products report: 404

The direct Render product detail endpoint currently exposes product detail only. Raw variant, inventory, custom, and additional-field payloads are not exposed through this endpoint, so those identity surfaces remain unavailable in this run.

## Identity Fields Found

| alias | JSON path | populated | distinct | uniqueness | strength | ECOUNT exact match |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `product_code` | `product.product_code` | 5 | 5 | 1.0 | medium | 0 |
| `manufacturer_code` | `product.manufacturer_code` | 5 | 3 | 0.6 | medium | 0 |
| `supplier_code` | `product.supplier_code` | 5 | 3 | 0.6 | medium | 0 |
| `custom_product_code` | `product.custom_product_code` | 0 | 0 | n/a | unusable | 0 |

## Barcode Result

No populated barcode-like fields were found in the product detail responses:

- `barcode`
- `bar_code`
- `ean`
- `jan`
- `isbn`
- `upc`
- `gtin`

ECOUNT BAR_CODE universe loaded for sample comparison: 9,866 values.

Cafe24 barcode-like populated count: 0.

ECOUNT exact match count: 0.

## Recommendation

Case B: barcode-like fields were not found through the existing Render product detail endpoint, but medium identity fields exist.

Next step should be a code-combination matching diagnostic using `product_code`, `manufacturer_code`, `supplier_code`, brand, and normalized name. If variant/custom identity must be inspected, add a later read-only Render endpoint that exposes redacted variant/custom identity paths without changing operational cache or registry data.
