# SAMPLAS Render Environment Variables

Current Render service:

`https://samplas-marketing-os.onrender.com`

Existing old service stays untouched:

`https://samplas-meta-dashboard.onrender.com`

Do not put real API keys, tokens, passwords, Cafe24 CSV files, or order data in GitHub.

## Current Priority

The current Render service is on the Free plan.

Priority now:

1. `/api/status` returns 200.
2. The dashboard opens.
3. Render environment variables are connected.
4. Overview shows live Instagram / Meta Ads / Cafe24 summaries.
5. Cafe24 CSV upload is tested only after the above works.

Free plan warning:

- `WORK_DIR=/tmp/samplas-dashboard/work`
- CSV/cache files can disappear when Render restarts, sleeps, or redeploys.
- Cafe24 CSV upload on this Free service is temporary test storage only.
- Long-term Cafe24 CSV history requires a paid Render plan with Persistent Disk.

## Core Variables

Set these in Render Dashboard > service `samplas-marketing-os` > Environment.

```txt
HOST=0.0.0.0
REPORT_TIMEZONE=Asia/Seoul
WORK_DIR=/tmp/samplas-dashboard/work
GRAPH_VERSION=v25.0
SAMPLAS_INSTAGRAM_USERNAME=samplaskr
```

## Meta / Instagram Variables

Required:

```txt
FACEBOOK_PAGE_ID=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
```

`/api/status` becomes:

```txt
instagram=true
metaAds=true
```

when these are present:

- Instagram: `META_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- Meta Ads: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`

### How To Get Meta Values

Use the Meta Business account that owns or manages the SAMPLAS Facebook Page, Instagram Business account, and Ad account.

1. Open Meta Business Settings.
2. Confirm the SAMPLAS Facebook Page is connected to the SAMPLAS Instagram Business account.
3. Get `FACEBOOK_PAGE_ID`.
   - In Meta Business Settings, open the Page asset and copy the Page ID.
   - Or use Graph API Explorer with an access token that can access the Page:

```txt
GET /me/accounts
```

4. Get `INSTAGRAM_BUSINESS_ACCOUNT_ID`.
   - Use the Facebook Page ID:

```txt
GET /{FACEBOOK_PAGE_ID}?fields=instagram_business_account
```

5. Get `META_AD_ACCOUNT_ID`.
   - Open Meta Ads Manager.
   - Copy the Ad Account ID.
   - Use the `act_` prefix in Render, for example:

```txt
META_AD_ACCOUNT_ID=act_1234567890
```

6. Get `META_ACCESS_TOKEN`.
   - Recommended for operation: create a Meta Business system user token.
   - The token must have access to the Page, Instagram Business account, and Ad account.
   - Required permissions depend on Meta app review and asset setup, but this dashboard needs permissions for Instagram insights and ad reporting.
   - Typical permissions:

```txt
instagram_basic
instagram_manage_insights
pages_show_list
pages_read_engagement
ads_read
```

After entering Meta variables in Render:

1. Save Environment Variables.
2. Redeploy or restart the Render service.
3. Open:

```txt
https://samplas-marketing-os.onrender.com/api/status
```

Expected:

```txt
instagram=true
metaAds=true
```

Official Meta docs:

- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
- https://developers.facebook.com/docs/marketing-api/get-started
- https://developers.facebook.com/docs/marketing-api/reference/ad-account

## Cafe24 Variables

Required for direct Cafe24 Admin API mode:

```txt
CAFE24_MALL_ID=
CAFE24_CLIENT_ID=
CAFE24_CLIENT_SECRET=
CAFE24_ACCESS_TOKEN=
CAFE24_REFRESH_TOKEN=
CAFE24_ACCESS_TOKEN_EXPIRES_AT=
CAFE24_REDIRECT_URI=https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
CAFE24_SCOPES=mall.read_order
```

Recommended protection for CSV import:

```txt
CAFE24_PROXY_SECRET=
CAFE24_PROXY_BASIC_AUTH=
```

Use at least one of these before uploading Cafe24 CSV to Render.

`/api/status` becomes:

```txt
cafe24=true
```

when these are present:

```txt
CAFE24_MALL_ID
CAFE24_CLIENT_ID
CAFE24_CLIENT_SECRET
CAFE24_ACCESS_TOKEN
CAFE24_REFRESH_TOKEN
```

### How To Get Cafe24 Values

1. Open Cafe24 Developers.
2. Create or open the SAMPLAS app.
3. Copy:

```txt
CAFE24_CLIENT_ID
CAFE24_CLIENT_SECRET
```

4. Confirm the app has Admin API order read permission.
5. Set the redirect URI in Cafe24 Developers:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
```

6. In Render Environment, enter:

```txt
CAFE24_MALL_ID=scause
CAFE24_CLIENT_ID=...
CAFE24_CLIENT_SECRET=...
CAFE24_REDIRECT_URI=https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
CAFE24_SCOPES=mall.read_order
```

7. Save Environment Variables.
8. Restart or redeploy Render.
9. Start OAuth in the browser:

```txt
https://samplas-marketing-os.onrender.com/api/cafe24/oauth/start
```

10. Approve the Cafe24 authorization.

Important:

- This server can receive the OAuth callback and use the returned tokens in memory.
- On the current Free plan, files written by the server are temporary.
- For stable operation after restart/redeploy, copy the issued `CAFE24_ACCESS_TOKEN`, `CAFE24_REFRESH_TOKEN`, and `CAFE24_ACCESS_TOKEN_EXPIRES_AT` into Render Environment Variables.
- If the token cannot be copied from Cafe24/OAuth tooling, generate tokens locally using the same code flow, then copy only the token values from local `.env` into Render Environment Variables.
- Never commit those token values to GitHub.

Official Cafe24 docs:

- https://developers.cafe24.com
- https://developers.cafe24.com/docs/api/admin

## Verify After Input

After all environment variables are saved and the Render service is redeployed:

```txt
https://samplas-marketing-os.onrender.com/api/status
```

Expected:

```txt
instagram=true
metaAds=true
cafe24=true
```

The response also includes missing-variable details:

```txt
environment.instagram.missing
environment.metaAds.missing
environment.cafe24.missing
```

If one section is still false, check the matching `missing` list first.

## CSV Upload Timing

Do not upload Cafe24 CSV until:

1. `/api/status` returns 200.
2. The dashboard opens.
3. Render environment variables are entered.
4. `/api/status` shows the expected true/false state.

On the current Free plan, CSV upload is only a temporary test. It is not permanent monthly storage.
