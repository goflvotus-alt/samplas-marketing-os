// Read-only reader: the only injected transport is the existing Graph GET helper.
// Creative URLs are candidates, not verified redirects or resolved catalog templates.
const CREATIVE_FIELDS = 'id,object_story_spec,asset_feed_spec,link_url,object_url,url_tags,template_url,template_url_spec,effective_object_story_id';
const DESTINATION_KEYS = new Set(['link','link_url','website_url','object_url','template_url','deeplink_url','deep_link_url']);
function httpUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && url.hostname ? url : null; } catch { return null; }
}
function isMetaCode(value) { return /^meta_[a-zA-Z0-9_]+$/.test(value); }

export function diagnoseAdLanding(ad) {
  const creative = ad.creative || {}, candidates = new Set();
  function collect(value, path = []) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      // Never treat image/video/media URLs as landing destinations.
      if (['images','videos','image','picture','thumbnail_url','image_url','image_hash','video_url'].includes(key)) continue;
      if (DESTINATION_KEYS.has(key) || (key === 'url' && path.some(p => ['link_urls','child_attachments'].includes(p)))) {
        const url = httpUrl(child);
        if (url) candidates.add(url.href);
      }
      if (child && typeof child === 'object') collect(child, [...path, key]);
    }
  }
  collect(creative);
  const destinationUrls = [...new Set([...candidates].map(value => {
    const url = new URL(value);
    if (typeof creative.url_tags === 'string') {
      for (const [key, val] of new URLSearchParams(creative.url_tags.replace(/^\?/, ''))) url.searchParams.append(key, val);
    }
    return url.href;
  }))];
  const codesByUrl = destinationUrls.map(value => new URL(value).searchParams.getAll('ghost_mall_id'));
  const ghostMallIds = [...new Set(codesByUrl.flat().filter(Boolean))];
  const trackedCount = codesByUrl.filter(values => values.some(isMetaCode)).length;
  const warnings = [];
  if (!destinationUrls.length) warnings.push('No HTTP(S) destination found; catalog destinations or published-post links may require product/post data.');
  if ([...candidates, creative.url_tags || ''].some(value => /\{\{.*?\}\}/.test(value))) warnings.push('Dynamic URL macros are unresolved; candidates are not final rendered destinations.');
  if (codesByUrl.some(values => new Set(values.filter(Boolean)).size > 1)) warnings.push('Conflicting ghost_mall_id values in a destination URL.');
  return {
    campaignId: ad.campaign?.id || ad.campaign_id || null, campaignName: ad.campaign?.name || null,
    adsetId: ad.adset?.id || ad.adset_id || null, adsetName: ad.adset?.name || null,
    adId: ad.id || null, adName: ad.name || null, creativeId: creative.id || null,
    destinationUrls, ghostMallIds,
    trackingStatus: trackedCount ? 'TRACKED' : destinationUrls.length ? 'MISSING' : 'UNRESOLVED',
    trackingCoverage: !destinationUrls.length ? 'UNRESOLVED' : trackedCount === destinationUrls.length ? 'ALL' : trackedCount ? 'PARTIAL' : 'NONE',
    // There is no confirmed ad-ID -> expected-code registry. Names are not evidence.
    expectedTrackingCode: null, warnings
  };
}

export async function fetchLandingDiagnostics(adAccountId, graphGet, {maxPages = 100} = {}) {
  if (!/^act_\d+$/.test(adAccountId || '')) throw new Error('Valid Meta ad account ID is required.');
  const path = `${adAccountId}/ads`;
  const params = {fields: `id,name,campaign{id,name},adset{id,name},creative{${CREATIVE_FIELDS}}`, limit: 100};
  const ads = [], seenCursors = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const body = await graphGet(path, params);
    if (body.error || !Array.isArray(body.data)) throw new Error('Meta landing diagnostics response is incomplete.');
    ads.push(...body.data.map(diagnoseAdLanding));
    if (!body.paging?.next) return {ok: true, source: 'meta_marketing_api', ads};
    // Rebuild GET with cursor instead of following an arbitrary token-bearing URL.
    const next = httpUrl(body.paging.next);
    const after = body.paging.cursors?.after || next?.searchParams.get('after');
    if (!next || next.protocol !== 'https:' || next.hostname !== 'graph.facebook.com' || !next.pathname.endsWith(`/${path}`) || !after || seenCursors.has(after)) throw new Error('Unsafe or repeated Meta paging cursor.');
    if (page === maxPages) throw new Error('Meta landing diagnostics pagination incomplete; page limit reached.');
    seenCursors.add(after); params.after = after;
  }
  throw new Error('Meta landing diagnostics pagination incomplete.');
}
