const identity = { campaign: 'campaign_id', adset: 'adset_id', ad: 'ad_id' };
const metrics = ['spend', 'impressions', 'clicks', 'purchases', 'purchaseValue'];

export async function collectMetaInsightPages(level, readPage, { maxPages = 50 } = {}) {
  const data = [];
  const ids = new Set();
  const cursors = new Set();
  let after;
  for (let page = 0; page < maxPages; page++) {
    const response = await readPage(after);
    if (!Array.isArray(response?.data) || response.error) throw new Error('META_INSIGHTS_PAGE_INVALID');
    for (const row of response.data) {
      const id = row?.[identity[level]];
      if (!id || ids.has(id)) return { data, partial: true, paginationExhausted: false };
      ids.add(id);
      data.push(row);
    }
    if (!response.paging?.next) return { data, paginationExhausted: true };
    after = response.paging.cursors?.after;
    if (!after || cursors.has(after)) break;
    cursors.add(after);
  }
  return { data, partial: true, paginationExhausted: false };
}

export function reconcileMetaLevels(levels) {
  const names = Object.keys(identity);
  const ready = names.every(name => {
    const level = levels?.[name];
    return (level?.coverage?.completeness || level?.completeness) === 'COMPLETE';
  });
  return metrics.map(metric => {
    const [campaign, adset, ad] = names.map(name => levels?.[name]?.totals?.[metric] ?? null);
    const values = [campaign, adset, ad];
    const comparable = values.every(Number.isFinite);
    const comparableValues = values.map(value => Math.round(value * 100));
    const matches = new Set(comparableValues).size === 1;
    const status = !comparable ? 'UNVERIFIED' : ready ? (matches ? 'MATCH' : 'MISMATCH')
      : (matches ? 'MATCH_COVERAGE_UNVERIFIED' : 'MISMATCH_COVERAGE_UNVERIFIED');
    return { metric, campaign, adset, ad, status };
  });
}

export function isExactMetaInsightScope(cached, { level, since, until }) {
  return cached?.since === since && cached.until === until && cached.level === level &&
    !cached.coverage?.reasons?.includes('INSIGHTS_PAGE_NOT_EXHAUSTED');
}
