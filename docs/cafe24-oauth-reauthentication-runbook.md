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

1. 대시보드의 Cafe24 재인증 버튼이 운영자 세션을 확보한 후 비공개 start 경로로 이동합니다.
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

대시보드에 운영자로 로그인한 후 Cafe24 재인증 버튼을 사용합니다. 로그인 취소 또는 인증 실패 시 이동하지 않습니다.

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

State는 서버 메모리에서 인증 시도별로 독립 보관하며 10분 후 만료되고 한 번만 사용할 수 있습니다. 누락·불일치·만료·재사용은 토큰 교환 전에 거부합니다.

No token, secret, or authorization header should be logged or committed.

OAuth start는 관리자 인증이 필요합니다. 직접 URL로 인증을 시작하지 마세요. 서버 재시작 시 기존 state는 모두 무효화되므로 대시보드 로그인 후 재인증 버튼으로 새로 시작합니다.
