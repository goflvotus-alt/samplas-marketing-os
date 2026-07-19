# Cafe24 OAuth Reauthentication Runbook

Prepared for SAMPLAS Inventory Intelligence Phase 2F.

## Current Readiness Result

- OAuth start route: present
- OAuth callback route: present
- Redirect URI source: `CAFE24_REDIRECT_URI`
- Redirect URI structure: `https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback`
- Token store directory: ready
- Token store file: not created yet
- Token store Git status: ignored by `work/`
- Atomic first write: verified with temp file and rename
- File mode requested: `0600`
- Blocking issues: none

## Existing OAuth Flow

1. User browser opens `GET /api/cafe24/oauth/start`.
2. `buildCafe24AuthorizeUrl()` creates a Cafe24 authorization URL with `randomUUID()` state.
3. User logs in to Cafe24 and approves the app.
4. Cafe24 redirects to `GET /api/cafe24/oauth/callback`.
5. `handleCafe24OAuthCallback()` validates the callback and exchanges the authorization code.
6. `writeCafe24TokenRecord()` stores the access/refresh token pair with atomic temp-file rename.
7. Future calls use `ensureCafe24AccessToken()` and the same token store.

## User Steps

Run the local server from the repository root:

```sh
npm start
```

Open the OAuth start route manually:

```txt
http://127.0.0.1:8787/api/cafe24/oauth/start
```

Then:

1. Log in to Cafe24 as the authorized mall/admin user.
2. Confirm the requested scopes include product read access.
3. Approve the app.
4. Wait for the callback to return to the Marketing OS page.
5. Do not copy token values into chat or screenshots.

## Post-Auth Verification

After callback success, run:

```sh
node scripts/check-cafe24-oauth-readiness.mjs
node scripts/recover-cafe24-api-access-and-probe.mjs --product-no=14600 --limit=5
node scripts/probe-cafe24-product-identity-api.mjs --product-no=14600 --product-no=14595 --product-no=14599 --product-no=14598 --product-no=14597
```

Expected after successful reauthentication:

- Token store file exists
- Access token field exists
- Refresh token field exists
- Product Detail GET succeeds
- Variant GET succeeds or returns a non-auth endpoint-specific error
- Identity probe records actual Cafe24 product identity fields

## Notes

State validation is present for the same-process OAuth flow. The current callback only rejects mismatched state when an expected state exists in memory, so after a server restart the callback should be restarted from `/api/cafe24/oauth/start`.

No token, secret, or authorization header should be logged or committed.
