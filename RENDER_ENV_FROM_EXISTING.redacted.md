# Render Env From Existing Local Setup

Generated from the existing local `.env`. Actual secrets are stored only in `RENDER_ENV_FROM_EXISTING.private.env`, which is gitignored.

## Source Files Checked

- `/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com/.env`
- `/Users/binggu/Documents/Codex/2026-06-17/samplas-4-26-6-80-20` launch/config files
- `/Users/binggu/Desktop/SAMPLAS DASHBOARD.command`

## Render Values Summary

| Key | Value |
| --- | --- |
| HOST | 0.0.0.0 |
| REPORT_TIMEZONE | Asia/Seoul |
| WORK_DIR | /tmp/samplas-dashboard/work |
| GRAPH_VERSION | v25.0 |
| SAMPLAS_INSTAGRAM_USERNAME | samplaskr |
| FACEBOOK_PAGE_ID | 361113897317760 |
| INSTAGRAM_BUSINESS_ACCOUNT_ID | 17841400194524814 |
| META_ACCESS_TOKEN | <set: 199 chars> |
| META_AD_ACCOUNT_ID | act_1133491086790634 |
| CAFE24_MALL_ID | scause |
| CAFE24_CLIENT_ID | xr92BthsFpnmbH0GyWregF |
| CAFE24_CLIENT_SECRET | <set: 22 chars> |
| CAFE24_ACCESS_TOKEN | <set: 22 chars> |
| CAFE24_REFRESH_TOKEN | <set: 22 chars> |
| CAFE24_ACCESS_TOKEN_EXPIRES_AT | (empty) |
| CAFE24_REDIRECT_URI | https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback |
| CAFE24_SCOPES | mall.read_order |
| CAFE24_PROXY_SECRET | (empty) |
| CAFE24_PROXY_BASIC_AUTH | <set: 20 chars> |
| NAVER_ADS_API_KEY | (empty) |
| NAVER_ADS_SECRET_KEY | (empty) |
| NAVER_ADS_CUSTOMER_ID | (empty) |
| NAVER_ADS_BASE_URL | (empty) |

## Notes

- `WORK_DIR` is set to `/tmp/samplas-dashboard/work` for current Render Free plan. CSV/cache files are temporary.
- `CAFE24_REDIRECT_URI` is changed from local URL to `https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback`.
- Existing direct Cafe24 token values were reused if present. No new token was created.
- If `/api/status` still shows a section as false after entering these values, check `environment.*.missing` in the status response.
