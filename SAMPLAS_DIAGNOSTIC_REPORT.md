# SAMPLAS Dashboard Diagnostic Report

Date: 2026-07-02

## Latest App Paths

Main morning launcher:

`/Users/binggu/Desktop/SAMPLAS DASHBOARD.command`

Main launcher homepage:

`file:///Users/binggu/Documents/Codex/2026-06-17/samplas-4-26-6-80-20/launcher/index.html`

Latest local marketing dashboard:

`http://127.0.0.1:8787/`

Latest local dashboard source:

`/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com`

Card video maker:

`http://127.0.0.1:8772/`

Render dashboard:

New target service:

`https://samplas-marketing-os.onrender.com/`

Existing service to keep untouched for now:

`https://samplas-meta-dashboard.onrender.com/`

## What Works Now

- Local `8787` dashboard serves the restored Marketing OS UI.
- Local `8787` reads Instagram monthly cache/CSV data.
- Local `8787` reads Meta Ads cached data for past months.
- Local `8787` reads Cafe24 CSV order cache for past months.
- Local `8787` Cafe24 June data is present:
  - Orders: 155
  - Items: 192
  - Quantity: 192
  - Actual paid amount: 32,454,810 KRW
  - Average order amount: 209,386 KRW
- Local `8772` Card Video maker now has `make_video.py` restored.
- The `SOMAR NEW COLLTECION` video generation test succeeded:
  - Output: `/Users/binggu/Desktop/SAMPLAS CONTENTS/CARDVIDEO/SOMAR NEW COLLTECION/output/samplas_ad.mp4`
  - Size: 5.9 MB
  - Length: 20 seconds

## Fixed In This Pass

- Restored missing Card Video generator files:
  - `/Users/binggu/Desktop/SAMPLAS CONTENTS/CARDVIDEO/.card_video_system/make_video.py`
  - `/Users/binggu/Desktop/SAMPLAS CONTENTS/CARDVIDEO/.card_video_system/requirements.txt`
  - `/Users/binggu/Desktop/SAMPLAS CONTENTS/CARDVIDEO/SOMAR NEW COLLTECION/make_video.py`
  - `/Users/binggu/Desktop/SAMPLAS CONTENTS/CARDVIDEO/SOMAR NEW COLLTECION/requirements.txt`
- Verified the `8772` make-video API creates a real MP4 file.
- Confirmed `Follower Growth` exists only once in the current local `8787` HTML/JS.
- Confirmed local Cafe24 CSV cache is correctly read before old proxy cache.
- Added local server support for future CSV import endpoint:
  - `POST /api/cafe24/csv/import`

## Still Broken / Not Yet Deployed

The new Render URL currently returns `Not Found` for both `/` and `/api/status`.

The response includes:

`x-render-routing: no-server`

This indicates the request is not reaching the Node server. The local code has `/`, `/api/status`, and `/api/cafe24/csv/import`, so the current blocker is Render service creation/routing, not an app route bug.

The existing Render service does not show June Cafe24 data because it does not have the CSV cache files and does not yet have the new CSV import endpoint deployed.

Current Render Cafe24 orders response still fails with:

`Invalid refresh_token`

So the Render issue is not that CSV cannot work. It is that Render is still trying the Cafe24 API and has no deployed CSV import path yet.

## Data Source Policy

Recommended operating model:

`API + CSV hybrid`

- Instagram:
  - Current month: API/cache
  - Past months: CSV/cache
- Meta Ads:
  - API is useful, but past months should be cached.
  - Meta revenue must be labeled as platform-attributed estimate.
- Cafe24:
  - Past months: CSV is the source of truth.
  - Current month: API can be used only as a quick check.
  - Final monthly report must use CSV-confirmed Cafe24 orders.
- Naver Search Ads:
  - API is appropriate for campaign/keyword spend and performance.
  - If API access becomes painful, monthly CSV import should also be supported.

## Revenue Rules

Do not mix these as the same metric:

- Cafe24 actual paid amount: real sales
- Meta purchase value / ROAS: Meta attribution estimate
- Naver conversion revenue / ROAS: Naver attribution estimate

Dashboard labels must keep these separated.

## Render Deployment Requirement

Current Free-plan deployment goal:

1. Deploy the local dashboard source to Render.
2. Use `render.yaml`.
3. Do not attach Render Disk for the current Free test service.
4. Set `WORK_DIR=/tmp/samplas-dashboard/work`.
5. Confirm `/api/status` returns 200.
6. Confirm the basic dashboard opens.
7. Only after that, test whether Render has `POST /api/cafe24/csv/import`.
8. Upload the Cafe24 CSV through that endpoint only for a temporary test:

```sh
npm run render:upload-cafe24 -- "/Users/binggu/Downloads/scause_20260701_1306_710a.csv"
```

9. Confirm `/api/cafe24/orders?start_date=2026-06-01&end_date=2026-06-30` returns `cafe24_csv_import_cached`.

```sh
npm run render:check
```

Free plan warning:

- CSV/cache files stored in `/tmp/samplas-dashboard/work` can disappear after restart, sleep, or redeploy.
- This is acceptable for the current deployment smoke test.
- Long-term Cafe24 CSV history requires a paid Render plan with Persistent Disk.

Current deployment blocker found on 2026-07-02:

- GitHub repo `goflvotus-alt/samplas-marketing-os` is connected and contains the latest source.
- GitHub `main` should point to the Free plan configuration while payment setup is pending.
- `https://samplas-marketing-os.onrender.com/api/status` returns Render `Not Found` with `x-render-routing: no-server`.
- The Render project `samplas-marketing-os` appears to have no Web Service yet.
- Uploading the Cafe24 CSV should wait until the new Render Web Service exists and `/api/status` returns 200.

Required Render Dashboard path:

1. Open Render project `samplas-marketing-os`.
2. Create a new Web Service.
3. Connect repo `goflvotus-alt/samplas-marketing-os`.
4. Use branch `main`.
5. Set service name `samplas-marketing-os`.
6. Use Region `Oregon`, Plan `Free`, Build `npm install`, Start `npm start`.
7. Set Health Check Path `/api/status`.
8. Do not add Disk for the current Free test service.
9. Set `WORK_DIR=/tmp/samplas-dashboard/work`.
10. Add API credentials only in Render environment variables.
11. Deploy and confirm `/api/status` returns 200.

Cafe24 CSV upload warning:

The Cafe24 CSV contains private order/customer data. Upload it only to the confirmed SAMPLAS Render service after deployment.

## Launcher Policy

Keep:

`/Users/binggu/Desktop/SAMPLAS DASHBOARD.command`

This remains the main morning launcher.

Recommended emergency launcher structure:

- Keep the main command.
- Add separate small launchers for individual tools.
- The safest Dock approach is:
  1. Create feature-specific `.command` files.
  2. Wrap each `.command` in Automator or AppleScript app.
  3. Dock-pin the app wrappers.
  4. Each app opens one URL or starts only the needed local server.

Do not replace the main launcher. Emergency apps are backup entry points.

Suggested emergency apps:

- SAMPLAS DASHBOARD: `http://127.0.0.1:8787/`
- SAMPLAS CONTENTS MAKER: `file:///Users/binggu/Documents/Codex/2026-06-17/samplas-4-26-6-80-20/launcher/index.html`
- SAMPLAS META REPORT: local dashboard Meta section
- SAMPLAS INSTAGRAM INSIGHT: local dashboard Instagram/Monthly Report
- SAMPLAS CAFE24 SALES: local dashboard Cafe24 Sales Impact
- SAMPLAS NAVER ADS REPORT: future Naver report page
- SAMPLAS KPI HUB: future integrated KPI page

## Naver Search Ads Requirements

Needed from Naver Search Ads:

- API Key
- Secret Key
- Customer ID

Expected auth style:

- Request timestamp
- HMAC signature using secret key
- API key and customer id headers

Naver does not operate like Cafe24 OAuth refresh tokens. It is better suited to stable server-side API calls once credentials are set.

Required environment variables:

```txt
NAVER_ADS_API_KEY=
NAVER_ADS_SECRET_KEY=
NAVER_ADS_CUSTOMER_ID=
NAVER_ADS_BASE_URL=https://api.searchad.naver.com
```

Initial Naver report fields:

- Campaign spend
- Keyword spend
- Impressions
- Clicks
- CTR
- CPC
- Conversions
- Conversion revenue
- ROAS
- Search term / keyword performance
- Daily trend

## Next Development Order

1. Deploy current local `8787` source to Render.
2. Upload Cafe24 CSV to Render through `/api/cafe24/csv/import`.
3. Restore Render Product Purchase and Unmatched Meta Purchase views using CSV cache.
4. Add emergency Dock launchers without replacing `SAMPLAS DASHBOARD.command`.
5. Add Naver Search Ads API credentials and basic report page.
6. Add integrated KPI Hub with actual sales and platform-estimated sales separated.
