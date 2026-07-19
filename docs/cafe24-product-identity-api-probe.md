# Cafe24 Product Identity API Probe

Read-only diagnostic for SAMPLAS Inventory Intelligence Phase 2C.

## Scope

This probe performs GET-only checks against Cafe24 product identity surfaces. It does not update products, variants, inventories, caches, registries, or UI.

## Endpoints Probed

- `GET /api/v2/admin/products/{productNo}`
- `GET /api/v2/admin/products/{productNo}/variants`
- `GET /api/v2/admin/products/{productNo}/variants?embed=inventories`
- `GET /api/v2/admin/products/{productNo}/inventories`

The script samples at most 10 products from the existing Product Dashboard cache unless explicit `--product-no` values are supplied.

## Identity Aliases

The probe recursively searches for barcode-like and code-like aliases including `barcode`, `bar_code`, `barCode`, `ean`, `ean13`, `jan`, `isbn`, `upc`, `gtin`, `product_code`, `custom_product_code`, `manufacturer_code`, `supplier_code`, `variant_code`, `item_code`, `sku`, and `model_number`.

## Sensitive Data Handling

The output stores JSON paths, counts, uniqueness, and masked sample formats only. Token, authorization, cookie, and secret-like keys are redacted or skipped.

## Output

Default output path:

`work/cafe24-product-identity-api-probe.json`

Run examples:

`node scripts/probe-cafe24-product-identity-api.mjs --limit=10`

`node scripts/probe-cafe24-product-identity-api.mjs --product-no=14565 --dry-run`
