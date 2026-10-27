// Shared report invariant: never substitute campaign totals for group statistics.
export const NAVER_GROUP_METRICS = ['impressions','clicks','spend','conversions','conversionValue'];
// Integrity failures carry structured evidence so a caller can fail the adgroup section alone.
const integrityError = (code, evidence, detail) => Object.assign(new Error(`${code}: ${detail}`), { code, evidence });
// Display-only rounding of a derived difference; source amounts are never changed.
const won = v => Math.round(v * 100) / 100;
export function reconcileAdgroupCoverage(adgroups, campaigns) {
  if (!adgroups?.available) return adgroups;
  const rows = adgroups.rows || [], ids = new Set();
  for (const row of rows) {
    if (row.id && ids.has(row.id)) throw integrityError('naver_duplicate_adgroup_id', { adgroupId: row.id }, `adgroup ${row.id}`);
    if (row.id) ids.add(row.id);
  }
  const numeric = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const knownSpend = rows.filter(r => numeric(r.spend)).reduce((s,r) => s+r.spend,0);
  const totals = campaigns.filter(r => numeric(r.spend));
  const campaignSpend = totals.length === campaigns.length ? totals.reduce((s,r) => s+r.spend,0) : null;
  const exceeded = [];
  for (const campaign of totals) {
    const sum = rows.filter(r => r.campaignId === campaign.campaignId && numeric(r.spend)).reduce((s,r) => s+r.spend,0);
    if (sum - campaign.spend > .01) exceeded.push({ campaignId: campaign.campaignId, campaignName: campaign.campaignName ?? null, campaignSpend: campaign.spend, adgroupSpend: sum, excess: won(sum - campaign.spend) });
  }
  // Groups outside every reported campaign only show up in the account-level comparison.
  if (!exceeded.length && campaignSpend !== null && knownSpend - campaignSpend > .01) exceeded.push({ campaignId: null, campaignName: null, campaignSpend, adgroupSpend: knownSpend, excess: won(knownSpend - campaignSpend) });
  // The code stays first so existing log searches keep matching; the amounts make the cause diagnosable.
  if (exceeded.length) throw integrityError('naver_adgroup_spend_exceeds_campaign', { exceeded }, exceeded.map(e => `${e.campaignId ? `campaign ${e.campaignId}` : 'account'} adgroups ${e.adgroupSpend} > ${e.campaignId ? 'campaign' : 'campaigns'} ${e.campaignSpend} (+${e.excess})`).join('; '));
  const successful = rows.filter(r => r.statsAvailable !== false && NAVER_GROUP_METRICS.every(k => numeric(r[k]))).length;
  return { ...adgroups, coverage: { total: rows.length, successful, unavailable: rows.length-successful,
    canonicalResolved: rows.filter(r => r.canonicalBrandName).length, unresolved: rows.filter(r => !r.canonicalBrandName).length,
    knownSpend, campaignSpend, difference: campaignSpend === null ? null : campaignSpend-knownSpend,
    reconciled: campaignSpend !== null && Math.abs(campaignSpend-knownSpend) <= .01 } };
}
const NO_ADGROUPS = '주간 광고그룹 상세가 제공되지 않았습니다.';
// Section verdict for the adgroup detail. Campaign totals are verified upstream (an incomplete
// campaign response fails the whole report), so an adgroup problem only fails this section.
export function verifyAdgroupSection(adgroups, campaigns) {
  if (!adgroups?.available) {
    const reason = adgroups?.reason || NO_ADGROUPS;
    return { adgroups: { ...adgroups, available: false, reason }, section: { status: 'UNAVAILABLE', reasons: ['ADGROUPS_UNAVAILABLE'], detail: reason } };
  }
  try {
    const checked = reconcileAdgroupCoverage(adgroups, campaigns), c = checked.coverage;
    const reasons = [...(c.unavailable ? ['ADGROUP_STATS_PARTIAL'] : []), ...(c.reconciled ? [] : ['ADGROUP_SPEND_UNRECONCILED'])];
    const detail = reasons.length ? `광고그룹 실측 ${c.successful}/${c.total} · 캠페인 대비 미확인 차액 ${c.difference ?? 'N/A'}원` : '';
    return { adgroups: checked, section: { status: reasons.length ? 'PARTIAL' : 'VERIFIED', reasons, detail, coverage: c } };
  } catch (error) {
    if (!error.evidence) throw error;
    // Rows are withheld, not corrected: the report falls back to the verified campaign rows.
    return { adgroups: { available: false, verification: 'FAILED', reason: `광고그룹 상세 검증 실패 — ${error.message}`, rows: [] },
      section: { status: 'FAILED', reasons: [error.code], detail: error.message, evidence: error.evidence } };
  }
}
export function naverWeeklyReview(section) {
  return { policy: 'NAVER_WEEKLY_REVIEW_V1', result: section.status === 'VERIFIED' ? 'PASS' : 'PARTIAL',
    sections: { campaigns: 'VERIFIED', adgroups: section.status },
    issues: section.status === 'VERIFIED' ? [] : [{ section: 'adgroups', ...section }] };
}
export function assertNoReportPlaceholders(workbook) {
  for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => {
    const text = typeof cell.value === 'string' ? cell.value : cell.value?.richText?.map(t => t.text).join('') || '';
    if (/\bfixture\b|placeholder/i.test(text)) throw new Error('naver_report_placeholder_forbidden');
  }));
}
