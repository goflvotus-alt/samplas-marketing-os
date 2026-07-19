# Cafe24 API Access Diagnostic

Read-only authentication and endpoint diagnostic for SAMPLAS Inventory Intelligence Phase 2D.

## Scope

This diagnostic separates Cafe24 authentication failure from product endpoint availability. It does not refresh tokens, start OAuth, mutate products, rebuild caches, or change UI/server behavior.

## Existing Product Dashboard Access Path

- Environment/token source: `server.mjs` process environment plus `readCafe24TokenRecord()`
- Token hydration: `hydrateCafe24EnvFromTokenRecord()`
- Refresh behavior: `ensureCafe24AccessToken()` refreshes expired tokens and product GET helpers retry once after invalid token
- Request helper: `cafe24FetchJson(url)`
- Base URL: `https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin`
- API version header: `CAFE24_API_VERSION || CAFE24_ADMIN_API_VERSION || 2025-06-01`
- Product list: `GET /products?limit&offset`
- Product detail: `GET /products/{productNo}`
- Variants/inventory: `GET /products/{productNo}/variants?limit=100&embed=inventories`
- Cache builder: `buildCafe24ProductCatalogWithCache()` and `buildProductDashboardWithCache()`
- Latest observed dashboard cache: `work/product-dashboard-proxy-2026-06-24_2026-07-18.json`

## Phase 2C Probe Access Path

- Environment/token source: root `.env` plus token store if present
- Refresh behavior: no OAuth refresh; GET-only product API probe
- Base URL/API version: same Cafe24 admin URL/version fallback as server
- Product detail: `GET /products/{productNo}`
- Variants: `GET /products/{productNo}/variants`
- Variants with inventories: `GET /products/{productNo}/variants?embed=inventories`
- Inventories: `GET /products/{productNo}/inventories`

## Key Difference

The existing server path can refresh an expired/invalid access token and retry a read-only product request. The Phase 2C probe intentionally does not refresh tokens because that phase required GET-only behavior and no authentication mutation.

## Actual Read-Only Result

Sample product: `14600`

- Product detail: HTTP 401, `access_token_invalid`
- Product variants: HTTP 401, `access_token_invalid`
- Product variants with inventories: HTTP 401, `access_token_invalid`
- Product inventories: HTTP 404, `endpoint_not_found_unconfirmed`

Because authentication failed in the same run, the 404 inventory response is not treated as definitive proof that the endpoint is unsupported.

## Environment Summary

Values are not recorded. The diagnostic stores presence, length, whitespace, placeholder flags, and source only.

- Mall ID: present
- Client ID: present
- Client secret: present
- Configured scopes: present, includes product-read-like scope text
- API version override: not present, default fallback used
- Token store: default work-dir token store not present
- Effective access token: present from `.env`
- Effective refresh token: present from `.env`
- Proxy base URL: present

## Conclusion

Case B: the current read-only product API access token is invalid or expired for direct product GET calls.

The next step is Cafe24 OAuth reauthentication or verifying the existing server refresh path with a valid refresh token. Do not conclude that Cafe24 product identity fields are absent until at least one product detail GET succeeds.
