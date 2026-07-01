# SAMPLAS Dashboard Baseline

Date: 2026-07-01

This is the current app baseline. Future updates should be made on top of this state.

Baseline snapshot:

`baselines/2026-07-01-current-app-baseline/`

Baseline UI:

- Local dashboard root: `http://127.0.0.1:8787/`
- Main page: `outputs/samplas-marketing-os.html`
- CSS: `outputs/samplas-marketing-os.css`
- JS: `outputs/samplas-marketing-os.js`
- Server: `server.mjs`

Monthly report baseline:

- Keep the restored monthly report layout.
- Keep the executive summary, KPI board, saved/shared/reach TOP lanes, format mix, and content board.
- Cardnews Report must show posts like an Instagram feed.
- Cardnews cards must show likes, comments, shares, and saves.
- Do not replace this UI with a simplified page.

API policy:

- Current month only: API can be called.
- Past months: never call Instagram, Meta Ads, or Cafe24 order APIs automatically.
- Past months must use CSV imports or saved cache files.
- If a past month has no CSV/cache, return a clear `csv_required` state instead of trying the API.
- This prevents repeated token/cache/API errors every morning.

Render policy:

- `https://samplas-meta-dashboard.onrender.com/` should follow the same code and API policy after deployment.
- If Render still behaves differently, the local baseline code must be deployed to Render or the Render source must be updated to match this folder.
