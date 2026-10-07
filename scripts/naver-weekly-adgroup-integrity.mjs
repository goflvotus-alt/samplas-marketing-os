// Shared report invariant: never substitute campaign totals for group statistics.
export const NAVER_GROUP_METRICS = ['impressions','clicks','spend','conversions','conversionValue'];
export function reconcileAdgroupCoverage(adgroups, campaigns) {
  if (!adgroups?.available) return adgroups;
  const rows = adgroups.rows || [], ids = new Set();
  for (const row of rows) {
    if (row.id && ids.has(row.id)) throw new Error('naver_duplicate_adgroup_id');
    if (row.id) ids.add(row.id);
  }
  const numeric = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const knownSpend = rows.filter(r => numeric(r.spend)).reduce((s,r) => s+r.spend,0);
  const totals = campaigns.filter(r => numeric(r.spend));
  const campaignSpend = totals.length === campaigns.length ? totals.reduce((s,r) => s+r.spend,0) : null;
  if (campaignSpend !== null && knownSpend - campaignSpend > .01) throw new Error('naver_adgroup_spend_exceeds_campaign');
  for (const campaign of totals) {
    const sum = rows.filter(r => r.campaignId === campaign.campaignId && numeric(r.spend)).reduce((s,r) => s+r.spend,0);
    if (sum - campaign.spend > .01) throw new Error('naver_adgroup_spend_exceeds_campaign');
  }
  const successful = rows.filter(r => r.statsAvailable !== false && NAVER_GROUP_METRICS.every(k => numeric(r[k]))).length;
  return { ...adgroups, coverage: { total: rows.length, successful, unavailable: rows.length-successful,
    canonicalResolved: rows.filter(r => r.canonicalBrandName).length, unresolved: rows.filter(r => !r.canonicalBrandName).length,
    knownSpend, campaignSpend, difference: campaignSpend === null ? null : campaignSpend-knownSpend,
    reconciled: campaignSpend !== null && Math.abs(campaignSpend-knownSpend) <= .01 } };
}
export function assertNoReportPlaceholders(workbook) {
  for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => {
    const text = typeof cell.value === 'string' ? cell.value : cell.value?.richText?.map(t => t.text).join('') || '';
    if (/\bfixture\b|placeholder/i.test(text)) throw new Error('naver_report_placeholder_forbidden');
  }));
}
