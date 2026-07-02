# Cafe24 OAuth Recovery

Current symptom:

```txt
cafe24=true
```

but live order API calls return:

```txt
Invalid access_token (invalid_token)
Invalid refresh_token
```

This means the required Cafe24 environment variables exist, but both the existing access token and refresh token are expired.

The only reliable fix is Cafe24 OAuth reauthorization.

## Render Redirect URI

Use this Redirect URI in Cafe24 Developers:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
```

Make sure the Cafe24 app has Admin API order read permission.

Recommended scope:

```txt
mall.read_order
```

## Required Existing Render Variables

These must already be set before starting OAuth:

```txt
CAFE24_MALL_ID=scause
CAFE24_CLIENT_ID=...
CAFE24_CLIENT_SECRET=...
CAFE24_REDIRECT_URI=https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
CAFE24_SCOPES=mall.read_order
```

## Start Reauthorization

Open this URL in the browser:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/oauth/start
```

Flow:

1. Browser redirects to Cafe24 authorization.
2. Log in to Cafe24 as the authorized mall/admin user.
3. Approve the app permission request.
4. Cafe24 redirects back to:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
```

5. The callback page displays 3 Render Environment Variable lines.

## Update Render Environment Variables

Copy the 3 values from the callback page and update these Render variables:

```txt
CAFE24_ACCESS_TOKEN=...
CAFE24_REFRESH_TOKEN=...
CAFE24_ACCESS_TOKEN_EXPIRES_AT=...
```

Important:

- The callback page displays real tokens. Do not share screenshots.
- Render Free plan file storage is temporary, so values saved to server `.env` are not enough.
- The new token values must be copied into Render Environment Variables.
- After saving the Render variables, restart or redeploy the service.

## Verify

After redeploy/restart:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/health
```

Then test current orders:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/orders?start_date=2026-07-01&end_date=2026-07-31&limit=20
```

Expected:

- No `invalid_token`
- No `Invalid refresh_token`
- `source=cafe24_admin_api`
- `totals.orderCount` and `totals.orderAmount` are returned if Cafe24 has orders in the selected period

## Dashboard Shortcut

Dashboard > API Setup includes:

```txt
Cafe24 재인증 > 재인증 시작
```

This opens:

```txt
/api/cafe24/oauth/start
```

## If It Still Fails

Check:

```txt
https://samplas-marketing-os.onrender.com/api/diagnostics/logs
```

Common causes:

- Redirect URI in Cafe24 Developers does not exactly match Render URL.
- Cafe24 app does not have order read permission.
- `CAFE24_CLIENT_ID` or `CAFE24_CLIENT_SECRET` is wrong.
- Render was not restarted after environment variable update.
