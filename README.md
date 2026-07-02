# SAMPLAS Marketing OS

## Current Source Of Truth

Use this local dashboard project as the latest source:

`/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com`

Local URL:

`http://127.0.0.1:8787/`

Main morning launcher:

`/Users/binggu/Desktop/SAMPLAS DASHBOARD.command`

Do not replace the main launcher. It should open the SAMPLAS work homepage first.

## Local Run

```sh
cd "/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com"
npm start
```

Then open:

`http://127.0.0.1:8787/`

## Cafe24 Data

Recommended rule:

- Current month: API can be used as a quick check.
- Past months: use CSV/cache only.
- Final monthly reporting: use Cafe24 CSV-confirmed actual orders.

Local Cafe24 CSV cache files live in:

`work/cafe24-csv-orders-YYYY-MM-DD_YYYY-MM-DD.json`

June 2026 local CSV status:

- Orders: 155
- Items: 192
- Actual paid amount: 32,454,810 KRW

## Render

Render URL:

New Render service:

`https://samplas-marketing-os.onrender.com/`

Existing Render service to keep untouched for now:

`https://samplas-meta-dashboard.onrender.com/`

Render must use this same source folder and `render.yaml`.

Current deployment status:

- Local source is ready.
- `npm run check` passes.
- GitHub repo is connected:
  `goflvotus-alt/samplas-marketing-os`
- GitHub `main` currently contains the Starter plan + Disk config.
- `https://samplas-marketing-os.onrender.com/` currently returns Render `Not Found` with `x-render-routing: no-server`.
- That means the request is not reaching this Node app yet. The most likely cause is that the new Render Web Service has not actually been created inside the `samplas-marketing-os` project.

Needed to deploy from this machine:

- Render API key and service id, or
- A Git repository connected to the Render service, or
- Manual Render Dashboard access to deploy this folder / Blueprint.

Do not upload Cafe24 CSV to Render until the latest code is deployed and `/api/cafe24/csv/import` exists on Render.

Important Render requirements:

- `HOST=0.0.0.0`
- `WORK_DIR=/var/data/samplas-dashboard/work`
- Render Disk mounted at `/var/data/samplas-dashboard`
- Instagram / Meta / Cafe24 / future Naver credentials set as Render environment variables

`WORK_DIR` is important. Without it, uploaded CSV/cache files can disappear on redeploy.

Required endpoint after deployment:

`POST /api/cafe24/csv/import`

Until that endpoint is deployed and CSV is uploaded, Render may show zero Cafe24 sales if the Cafe24 API token is invalid.

## GitHub Private Repo Setup

Use a private GitHub repository named:

`samplas-marketing-os`

This repository should contain source code only. Do not commit local secrets or business data.

Never commit:

- `.env`
- Cafe24 CSV files
- Cafe24 order/cache JSON files
- `work/`
- `baselines/**/work-samples/`
- API tokens, passwords, Render keys, Cafe24 customer/order data

Safe to commit:

- `server.mjs`
- `package.json`
- `render.yaml`
- `.env.example`
- `README.md`
- `SAMPLAS_DIAGNOSTIC_REPORT.md`
- `SAMPLAS_DASHBOARD_BASELINE.md`
- `outputs/samplas-marketing-os.html`
- `outputs/samplas-marketing-os.css`
- `outputs/samplas-marketing-os.js`
- `scripts/check-render-deployment.mjs`
- `scripts/upload-cafe24-csv-to-render.mjs`

The `render.yaml` file is already in this project root:

`/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com/render.yaml`

### GitHub Push Commands

After creating an empty private GitHub repo, run these commands. Do not add README, license, or gitignore from GitHub when creating the repo because this folder already has them.

```sh
cd "/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com"
git remote add origin https://github.com/YOUR_GITHUB_ID/samplas-marketing-os.git
git push -u origin main
```

If `origin` already exists:

```sh
git remote set-url origin https://github.com/YOUR_GITHUB_ID/samplas-marketing-os.git
git push -u origin main
```

Before pushing, confirm these commands do not show `.env`, `work/`, Cafe24 CSV, or order JSON files:

```sh
git status --short
git ls-files
```

### Render Dashboard Deploy From GitHub

1. Open Render Dashboard.
2. Connect GitHub if it is not connected yet.
3. Make sure Render has access to the private repo `samplas-marketing-os`.
4. In the Render project `samplas-marketing-os`, create a new Web Service.
5. Connect repo `goflvotus-alt/samplas-marketing-os`.
6. Select branch `main`.
7. Use these service settings:
   - Name: `samplas-marketing-os`
   - Runtime: `Node`
   - Region: `Oregon`
   - Plan: `Starter`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/api/status`
8. Add Disk:
   - Name: `samplas-dashboard-data`
   - Mount Path: `/var/data/samplas-dashboard`
   - Size: `1 GB`
9. Confirm `WORK_DIR=/var/data/samplas-dashboard/work`.
10. Add secret environment values in Render only. Do not put real values in GitHub.
11. Deploy latest commit.
12. After deploy finishes, run:

```sh
npm run render:check
```

Only after the latest Render code is deployed and checked, upload Cafe24 CSV:

```sh
npm run render:upload-cafe24 -- "/Users/binggu/Downloads/scause_20260701_1306_710a.csv"
```

### Render Environment Groups

Set these on Render.

Core:

```txt
HOST=0.0.0.0
REPORT_TIMEZONE=Asia/Seoul
WORK_DIR=/var/data/samplas-dashboard/work
GRAPH_VERSION=v25.0
SAMPLAS_INSTAGRAM_USERNAME=samplaskr
```

Instagram / Meta:

```txt
META_ACCESS_TOKEN=
FACEBOOK_PAGE_ID=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
META_AD_ACCOUNT_ID=
```

Cafe24:

```txt
CAFE24_MALL_ID=
CAFE24_CLIENT_ID=
CAFE24_CLIENT_SECRET=
CAFE24_ACCESS_TOKEN=
CAFE24_REFRESH_TOKEN=
CAFE24_ACCESS_TOKEN_EXPIRES_AT=
CAFE24_REDIRECT_URI=https://samplas-marketing-os.onrender.com/api/cafe24/oauth/callback
CAFE24_SCOPES=
CAFE24_PROXY_SECRET=
CAFE24_PROXY_BASIC_AUTH=
```

Future Naver Search Ads:

```txt
NAVER_ADS_API_KEY=
NAVER_ADS_SECRET_KEY=
NAVER_ADS_CUSTOMER_ID=
NAVER_ADS_BASE_URL=https://api.searchad.naver.com
```

### Render Check

```sh
npm run render:check
```

### Upload Cafe24 CSV To Render

After the latest code is deployed to Render:

```sh
npm run render:upload-cafe24 -- "/Users/binggu/Downloads/scause_20260701_1306_710a.csv"
```

This CSV contains order/customer data. Only run this after confirming the Render destination is the approved SAMPLAS service.

Then confirm:

```sh
npm run render:check
```

Expected Cafe24 source after successful upload:

`cafe24_csv_import_cached`

## Card Video Maker

Local URL:

`http://127.0.0.1:8772/`

The make-video generator has been restored. A successful test created:

`/Users/binggu/Desktop/SAMPLAS CONTENTS/CARDVIDEO/SOMAR NEW COLLTECION/output/samplas_ad.mp4`

## Diagnostic Report

Read this before making structural changes:

`SAMPLAS_DIAGNOSTIC_REPORT.md`

## Data Meaning Rules

Keep these separate:

- Cafe24 actual paid amount: real sales
- Meta purchase value / ROAS: Meta attribution estimate
- Naver conversion revenue / ROAS: Naver attribution estimate

Do not combine actual sales and platform-estimated sales into one unlabeled number.

## Main Run Vs Emergency Run

Main run stays unchanged:

`/Users/binggu/Desktop/SAMPLAS DASHBOARD.command`

Emergency Dock apps will be added later, after the Render deployment structure is stable.

Emergency apps are backup entry points only. They must not replace the main launcher.
