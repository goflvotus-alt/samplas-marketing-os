# Cafe24 OAuth Access Recovery and Identity Probe

Read-only recovery gate for SAMPLAS Inventory Intelligence Phase 2E.

## Scope

The goal is to recover Cafe24 product API access using the existing `server.mjs` OAuth/token-store model before retrying the Product Identity API Probe.

This phase does not start a new OAuth authorization flow, does not modify products/options/inventory, does not rebuild caches, and does not change UI or API behavior.

## Existing Refresh Logic

`server.mjs` already owns the operational refresh path:

- `readCafe24TokenRecord()` reads `cafe24-token-store.json`
- `hydrateCafe24EnvFromTokenRecord()` applies token-store values to runtime env
- `ensureCafe24AccessToken()` checks token status and refresh need
- `refreshCafe24TokenSingleFlight()` prevents concurrent refresh
- `refreshCafe24Token()` calls Cafe24 OAuth token endpoint
- `writeCafe24TokenRecord()` writes the token store through a temp file and rename
- `cafe24FetchJson()` retries one read-only GET after invalid token refresh

## Safety Finding

The local default token store is missing. The local `.env` contains access/refresh token-shaped values, but those are not the persistent token store expected by the current server refresh path.

Because Cafe24 refresh can rotate the refresh token, running refresh against a temporary or non-persistent store could create a new valid token pair and then lose it. For that reason the Phase 2E recovery script uses a safety gate and does not execute refresh POST unless an existing persistent token store is present.

## Actual Result

Representative product: `14600`

- Refresh attempted: no
- Reason: `token_store_missing`
- Product detail GET: failed
- Variants GET: failed
- Inventories endpoint: cannot be confirmed until authentication succeeds
- Identity probe retry: skipped because Product Detail GET did not succeed

## Conclusion

Case D: OAuth reauthentication or persistent token-store setup is required before identity probing can continue.

Recommended path:

1. Use the existing app route `/api/cafe24/oauth/start`.
2. Complete Cafe24 authorization manually.
3. Ensure the resulting tokens are written to the configured token store or deployment environment.
4. Re-run:

```sh
node scripts/recover-cafe24-api-access-and-probe.mjs --product-no=14600 --limit=5
```

After Product Detail GET succeeds, retry the Phase 2C product identity probe.
