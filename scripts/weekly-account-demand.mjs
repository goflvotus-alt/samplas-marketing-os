// Exact weekly account totals and observed monthly search demand; no inferred metrics.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeBrandKey, resolveBrand } from './brand-engine.mjs';
const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function exactTotal(items, metric) {
  const rows = items.filter(row => row.name === metric);
  const value = rows.length === 1 ? rows[0].total_value?.value : null;
  return valid(value) ? value : null; // Daily reach series must NEVER be summed.
}
export async function collectWeeklyAccount({ since, until, fetchMetric }) {
  const result = { since, until, source: 'instagram_graph_api_weekly_total_value', reasons: {} };
  await Promise.all(['reach', 'views', 'profile_views', 'website_clicks'].map(async metric => {
    try {
      result[metric] = exactTotal(await fetchMetric(metric, since, until), metric);
      if (result[metric] === null) result.reasons[metric] = '해당 주간 total_value 미제공';
    } catch (error) {
      result[metric] = null;
      result.reasons[metric] = error?.code === 190 ? 'Graph API 인증 실패 (code 190)' : '해당 주간 Graph API 지표 조회 실패';
    }
  }));
  return result;
}
let followerQueue = Promise.resolve();
export function captureWeeklyFollowers(file, { accountId, followers, capturedAt = new Date().toISOString() }) {
  const run = followerQueue.then(async () => {
    if (!valid(followers)) return { followers: null, delta: null, reason: '현재 followers_count 미제공' };
    const day = new Date(Date.parse(capturedAt) + 9 * 3600000).toISOString().slice(0, 10);
    let store;
    try { store = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; store = { snapshots: [] }; }
    if (!Array.isArray(store.snapshots)) throw new Error('Invalid weekly follower snapshot store');
    let current = store.snapshots.find(s => s.accountId === accountId && s.date === day);
    if (!current) {
      current = { accountId, date: day, capturedAt, followers };
      store.snapshots.push(current);
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(store, null, 2) + '\n');
      await rename(temp, file);
    }
    const target = Date.parse(current.capturedAt) - 7 * 86400000;
    const prior = store.snapshots.filter(s => s.accountId === accountId && valid(s.followers) && Math.abs(Date.parse(s.capturedAt) - target) <= 2 * 3600000).sort((a,b) => Math.abs(Date.parse(a.capturedAt)-target)-Math.abs(Date.parse(b.capturedAt)-target))[0];
    return { followers, delta: prior ? current.followers - prior.followers : null, current, previous: prior || null,
      reason: prior ? '실제 수집일 7일 간격 (2시간 이내) 스냅샷 비교' : '직전 동일 요일·시간의 주간 스냅샷 없음' };
  });
  followerQueue = run.catch(() => {});
  return run;
}
const keywordKey = value => normalizeBrandKey(value).replace(/\s+/g, '');
export function demandCandidates(adgroups, registry) {
  const found = new Map();
  for (const group of adgroups) {
    const brand = resolveBrand(group.name, registry);
    if (brand && registry.brands.some(b => (b.id === brand.brandId || b.brandId === brand.brandId) && b.active !== false))
      found.set(brand.brandId, { brandId: brand.brandId, name: brand.name });
  }
  return [...found.values()];
}
export function exactDemand(rows, keyword) {
  const matched = rows.filter(row => keywordKey(row.keyword) === keywordKey(keyword));
  if (matched.length !== 1) return null;
  const row = matched[0];
  return valid(row.monthlyPcQueryCount) && valid(row.monthlyMobileQueryCount)
    ? { pc: row.monthlyPcQueryCount, mobile: row.monthlyMobileQueryCount, total: row.monthlyPcQueryCount + row.monthlyMobileQueryCount } : null;
}
export function buildSearchDemand(candidates, snapshots, now = new Date().toISOString()) {
  const week = timestamp => {
    const date = new Date(Date.parse(timestamp) + 9 * 3600000);
    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
    return date.toISOString().slice(0, 10);
  };
  const currentWeek = week(now), previousWeek = week(new Date(Date.parse(now) - 7 * 86400000).toISOString());
  const records = [], unavailable = [];
  for (const brand of candidates) {
    const rows = snapshots.filter(s => keywordKey(s.keyword) === keywordKey(brand.name) && s.source === 'naver-searchad-keywordstool' && Date.parse(s.collectedAt) <= Date.parse(now)).sort((a,b) => b.collectedAt.localeCompare(a.collectedAt));
    const current = rows.find(s => week(s.collectedAt) === currentWeek);
    const previous = rows.find(s => week(s.collectedAt) === previousWeek);
    const value = current && exactDemand(current.rows, brand.name);
    if (!value) { unavailable.push(brand.name); continue; }
    const old = previous && exactDemand(previous.rows, brand.name);
    records.push({ ...brand, ...value, collectedAt: current.collectedAt, previous: old?.total ?? null,
      previousCollectedAt: previous?.collectedAt || null, increase: old ? value.total - old.total : null,
      growth: old && old.total > 0 ? (value.total / old.total - 1) * 100 : null });
  }
  return { available: records.length > 0, source: 'Naver Keyword Tool 월간 검색량의 주간 Snapshot 비교',
    top10: [...records].sort((a,b) => b.total-a.total || a.name.localeCompare(b.name)).slice(0,10),
    rising5: records.filter(r => r.increase !== null && r.increase > 0).sort((a,b) => b.increase-a.increase || (b.growth ?? -Infinity)-(a.growth ?? -Infinity) || a.name.localeCompare(b.name)).slice(0,5),
    unavailable, observedAt: now, reason: records.length ? '' : '정확한 브랜드 키워드 또는 이번 주 실측 Snapshot 없음' };
}
