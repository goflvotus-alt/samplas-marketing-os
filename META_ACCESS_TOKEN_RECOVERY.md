# Meta Access Token Recovery

Current symptom:

```txt
instagram=true
metaAds=true
```

but live API calls return:

```txt
API access blocked.
status=400
code=200
type=OAuthException
```

This means Render has environment variables, but the `META_ACCESS_TOKEN` is not allowed to call the required Meta APIs.

## Required Permissions

The token used as `META_ACCESS_TOKEN` must be able to access:

- SAMPLAS Facebook Page
- SAMPLAS Instagram Business account connected to that Page
- SAMPLAS Meta Ad Account

Recommended permission set:

```txt
pages_show_list
pages_read_engagement
instagram_basic
instagram_manage_insights
ads_read
business_management
```

Minimum for Instagram Insights:

```txt
pages_show_list
pages_read_engagement
instagram_basic
instagram_manage_insights
```

Minimum for Meta Ads:

```txt
ads_read
```

Practical note:

- `pages_show_list` lets the token see Pages the user/system user can access.
- `pages_read_engagement` is commonly needed for Page-connected Instagram access.
- `instagram_basic` lets the token read the Instagram Business account identity/media basics.
- `instagram_manage_insights` is needed for Instagram insight metrics.
- `ads_read` is needed for Marketing API insights.
- `business_management` is often needed when using Business Manager system users/assets.

## Generate A New Token In Graph API Explorer

Use this when you want a quick test token.

1. Open Meta Graph API Explorer.
2. Select the Meta app connected to SAMPLAS.
3. Click Generate Access Token.
4. Select the user that has access to SAMPLAS assets.
5. Add permissions:

```txt
pages_show_list
pages_read_engagement
instagram_basic
instagram_manage_insights
ads_read
business_management
```

6. Approve the permission dialog.
7. Test the token before putting it in Render:

```txt
GET /me/accounts
GET /361113897317760?fields=instagram_business_account
GET /17841400194524814?fields=id,username,followers_count,media_count
GET /17841400194524814/insights?metric=reach,profile_views&period=day&since=2026-07-01&until=2026-07-31
GET /act_1133491086790634/insights?fields=campaign_id,campaign_name,spend,reach,impressions,clicks,actions,action_values&level=campaign&time_range={"since":"2026-07-01","until":"2026-07-31"}
```

If any request returns `API access blocked`, the token/app still does not have the needed permission or asset access.

## Long-Lived Token

Short-lived user tokens expire quickly. For operation, exchange the short-lived user token for a long-lived token.

Use Meta's long-lived token exchange:

```txt
GET https://graph.facebook.com/v25.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={APP_ID}
  &client_secret={APP_SECRET}
  &fb_exchange_token={SHORT_LIVED_USER_ACCESS_TOKEN}
```

Important:

- Do not run this in frontend/browser code because it uses the App Secret.
- A long-lived user token generally lasts about 60 days.
- If the token is already expired, it cannot be exchanged. Generate a new short-lived token first.

For a more stable operation setup, use a Meta Business system user token with the required assets assigned:

1. Open Meta Business Settings.
2. Go to Users > System users.
3. Create/select a system user.
4. Assign assets:
   - Facebook Page
   - Instagram Business account
   - Ad Account
5. Generate token for the SAMPLAS app.
6. Select permissions:

```txt
pages_show_list
pages_read_engagement
instagram_basic
instagram_manage_insights
ads_read
business_management
```

7. Test the same Graph API calls above.

## Render Values To Update

After the new token is tested, update only this Render Environment Variable:

```txt
META_ACCESS_TOKEN={new tested token}
```

Usually these can stay the same:

```txt
FACEBOOK_PAGE_ID=361113897317760
INSTAGRAM_BUSINESS_ACCOUNT_ID=17841400194524814
META_AD_ACCOUNT_ID=act_1133491086790634
```

Then in Render:

1. Save Environment Variables.
2. Redeploy or restart the service.
3. Confirm:

```txt
https://samplas-marketing-os.onrender.com/api/status
```

4. Confirm real API calls:

```txt
https://samplas-marketing-os.onrender.com/api/instagram/monthly?month=2026-07&refresh=1
https://samplas-marketing-os.onrender.com/api/meta-ads/summary?since=2026-07-01&until=2026-07-31&refresh=1
```

5. If still blocked, inspect:

```txt
https://samplas-marketing-os.onrender.com/api/diagnostics/logs
```

## Important Distinction

`/api/status` checks whether environment variables are present.

It does not prove Meta approved the token for actual API calls.

Actual success is confirmed only when the Instagram and Meta Ads endpoints return real data instead of:

```txt
API access blocked.
```

Official Meta docs:

- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
- https://developers.facebook.com/docs/marketing-api/get-started
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
