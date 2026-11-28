# Meta ad UTM standard procedure

Goal: every Meta ad order that Cafe24 Analytics records must carry the numeric Meta ad ID, so Marketing OS grades it `G1_AD_ID`.

## Why the ad ID

- Marketing OS grades an order G1 only when the Cafe24 Analytics `content` value equals the ID of an ad that delivered in the period (`scripts/meta-weekly-sales-trace.mjs`, `adIds.has(content)`).
- An ad name (`{{ad.name}}`) gives at most a G2 candidate, which is never counted as confirmed revenue. Ad names are not unique.
- Analytics counts Meta as paid only with `utm_source` = `meta` or `ig` and `utm_medium=paid`.
- Analytics credits only direct conversions inside one visit (the visit ends 60 minutes after the last activity).

## 1. When creating an ad

Put this in the ad's **URL parameters** field (`url_tags`):

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

- Do not use name macros (`{{ad.name}}`, `{{campaign.name}}`).
- Prefer `url_tags` over editing the website URL. Meta applies `url_tags` to every clicked URL, including catalog product links and carousel cards.
- Existing ads that already carry an ad-ID UTM in `link_url` stay as they are. Do not edit live ads only to move the UTM.

## 2. Right after publishing

1. Open the ad from Instagram (or the Ads Manager preview link) and click through.
2. The landing address must show `utm_medium=paid` and `utm_content=<numeric ad ID>`. A literal `{{ad.id}}` means the macro was not replaced: fix before spending.
3. Carousel: click at least two different cards. Catalog: click at least two different products. One good link does not prove the rest.
4. Keep a screenshot with the ad ID and time.

## 3. First weekly report after launch

In `TRACKING_DIAGNOSTICS`, `AD_UTM` rows, the note reads `UTM 위치=...; 광고 ID UTM=...; 확인 링크 N개`.

| 광고 ID UTM | Meaning | Action |
|---|---|---|
| 예(전체 링크) | Every visible link carries the ad ID | Keep |
| 일부만 | Some links carry it, some do not; or a catalog whose product-feed links are not visible | Click-check the remaining cards/products |
| 아니오 | No visible link carries the ad ID (missing UTM or a name macro) | Fix candidate, needs approval |
| 판정 불가 | No link visible to the API (existing post without link data, catalog feed only) | Click-check manually |

A catalog ad is never reported as `예(전체 링크)`, because product-feed URLs are not returned with the creative.

## 4. Order-level check (test order or first Meta order)

1. Record the order number and the payment date.
2. Read-only Analytics check (internal auth required):
   `GET /api/diagnostics/cafe24-analytics-orderdetails?start_date=<pay date>&end_date=<pay date>&order_id=<order number>`
   Pass: `ad` = `meta`/`ig`, `medium` = `paid`, `content` = the ad ID. Check again the next day if the row is not there yet.
3. The weekly report for that Tuesday-to-Monday period lists the order in `TRACKING_DIAGNOSTICS` as `G1_AD_ID`.
4. Cancel a test order only after step 3. A canceled order is shown as `EXCLUDED_CANCELED` and hides the G1 result.
5. A test payment also counts as a Meta pixel purchase. Note it in that week's report review.

## Not allowed

- Changing budgets, targeting or the settings of live ads as part of this check.
- Treating G2 ad-name candidates as confirmed revenue.
