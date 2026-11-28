import { buildNaverAttributionReport, previousPeriod } from './naver-attribution-report.mjs';

const DAY = 86_400_000;
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const utc = value => Date.parse(value + 'T00:00:00Z');
const addDays = (value, delta) => dateKey(utc(value) + delta * DAY);
export const naverKstDay = (value = Date.now()) => dateKey(+value + 9 * 3_600_000);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  Number.isFinite(utc(value)) && dateKey(utc(value)) === value;
const validBrand = value => value === null || /^[A-Z0-9_:-]{1,72}$/i.test(value);

export function naverReportQuery(params, today = naverKstDay()) {
  const since = params.get('since');
  const until = params.get('until');
  const grain = params.get('grain') || 'day';
  const brand = params.get('brand') || null;
  if (!validDate(since) || !validDate(until) || since < '2025-01-01' || since > until ||
      until > today || utc(until) - utc(since) > 91 * DAY ||
      !['day', 'week', 'month'].includes(grain) || !validBrand(brand) ||
      ![null, 'xlsx'].includes(params.get('format'))) return null;
  return { since, until, grain, brand };
}

export function previousNaverReportDefault(today = naverKstDay()) {
  return { since: addDays(today, -30), until: addDays(today, -1) };
}

function windows(since, until, size) {
  const result = [];
  for (let start = since; start <= until;) {
    const end = dateKey(Math.min(utc(until), utc(start) + (size - 1) * DAY));
    result.push({ since: start, until: end });
    start = addDays(end, 1);
  }
  return result;
}

const complete = row => row.ok && row.completeness === 'COMPLETE';

export function createNaverAttributionService({
  mapping, fetchAds, fetchOrders, fetchAnalytics, loadSnapshots, enrichOrders, now = Date.now, ttl = 15 * 60_000
}) {
  const cache = new Map();
  const contentKeys = new Set(mapping.map(row => row.content));
  const firstDay = mapping.map(row => row.startDay).sort()[0];
  let sourceQueue = Promise.resolve();

  async function analyticsWindow({ since, until }) {
    try {
      const result = await fetchAnalytics({ startDate: since, endDate: until });
      const rows = result.data?.orderdetails;
      const isLimited = Array.isArray(rows) && (rows.length >= 100 || result.coverage?.completeness === 'PARTIAL');
      if (isLimited && since !== until) {
        const middle = dateKey(Math.floor((utc(since) + utc(until)) / (2 * DAY)) * DAY);
        const left = await analyticsWindow({ since, until: middle });
        return left.concat(await analyticsWindow({ since: addDays(middle, 1), until }));
      }
      return [{ since, until, ok: result.ok === true && Array.isArray(rows), rows: Array.isArray(rows) ? rows : [],
        completeness: isLimited ? 'PARTIAL' : result.coverage?.completeness || 'UNVERIFIED',
        observedAt: new Date(now()).toISOString() }];
    } catch {
      return [{ since, until, ok: false, rows: [], completeness: 'UNVERIFIED' }];
    }
  }

  async function collect(since, until) {
    const adsPromise = Promise.resolve().then(() => fetchAds(since, until)).catch(() => ({ rows: [], coverage: [], status: 'UNVERIFIED' }));
    const snapshots = await Promise.resolve().then(loadSnapshots).catch(() => []);
    const analyticsBatches = snapshots.flatMap(snapshot => snapshot.analyticsBatches.map(batch => ({
      ...batch, observedAt: new Date(snapshot.observedAt).toISOString()
    }))).filter(batch => batch.since <= until && batch.until >= since);
    const from = firstDay && firstDay > since ? firstDay : since;
    const today = naverKstDay(now());
    // Existing scheduled snapshots are the primary Analytics source. Only fill uncovered eligible dates.
    const covered = day => analyticsBatches.some(batch => complete(batch) && batch.since <= day && day <= batch.until);
    const gaps = [];
    for (let day = from; day <= until; day = addDays(day, 1)) {
      if (covered(day)) continue;
      const last = gaps.at(-1);
      if (last && addDays(last.until, 1) === day && utc(day) - utc(last.since) < 7 * DAY) last.until = day;
      else gaps.push({ since: day, until: day });
    }
    for (const gap of gaps) analyticsBatches.push(...await analyticsWindow(gap));

    const orders = [];
    const ordersCoverage = [];
    let ordersObservedAt = null;
    for (const span of windows(from, until, 28)) {
      try {
        const result = await fetchOrders(span.since, span.until);
        if (!Array.isArray(result.orders) || result.error) continue;
        orders.push(...result.orders);
        const end = result.endDate || result.requestedEndDate;
        const begin = result.startDate || result.requestedStartDate;
        const sourceConfirmed = ['cafe24_admin_api', 'cafe24_proxy'].includes(result.source);
        ordersObservedAt = result.syncedAt || result.cacheSyncedAt || new Date(now()).toISOString();
        if (sourceConfirmed && end === span.until && begin === span.since && result.orders.length < 500 && span.until < today) {
          ordersCoverage.push({ ...span, ok: true, completeness: 'COMPLETE' });
        }
      } catch { /* Keep observed periods and expose missing coverage. */ }
    }
    const matchedIds = new Set(analyticsBatches.flatMap(batch => batch.rows)
      .filter(row => contentKeys.has(row.content) && row.order_id).map(row => String(row.order_id)));
    const enriched = matchedIds.size ? await Promise.resolve().then(() => enrichOrders(orders.filter(row => matchedIds.has(String(row.order_id))), [since, until])).catch(() => ({})) : {};
    const ads = await adsPromise;
    return {
      mapping, adRows: ads.rows, adCoverage: ads.coverage,
      totalAdRows: ads.campaignRows?.length ? ads.campaignRows : undefined,
      totalAdCoverage: windows(since, until, 1).filter(({ since: day }) =>
        ads.campaignCount > 0 && ads.campaignRows?.filter(row => row.day === day &&
          [row.spend, row.impressions, row.clicks].every(Number.isFinite)).length === ads.campaignCount
      ).map(span => span.since),
      analyticsBatches, orders, ordersCoverage,
      generatedAt: new Date(now()).toISOString(), ...enriched,
      sources: {
        statsAt: ads.observedAt || null, statsStatus: ads.status, statsMissingGroups: ads.missingIds || 0,
        analyticsAt: analyticsBatches.reduce((max, row) => row.observedAt > max ? row.observedAt : max, '') || null,
        ordersAt: ordersObservedAt, pendingDay: today
      }
    };
  }

  function read(since, until, refresh) {
    const key = since + '|' + until;
    const cached = cache.get(key);
    if (cached && (!cached.expires || (!refresh && cached.expires > now()))) return cached.promise;
    if ([...cache.values()].filter(value => !value.expires).length >= 4) throw new Error('Report source queue is full');
    const entry = {};
    entry.promise = sourceQueue.then(() => collect(since, until)).then(result => {
      entry.expires = now() + ttl;
      return result;
    }).catch(error => {
      cache.delete(key);
      throw error;
    });
    sourceQueue = entry.promise.catch(() => {});
    cache.delete(key);
    cache.set(key, entry);
    for (const [oldKey, value] of cache) {
      if (cache.size <= 12) break;
      if (value.expires && oldKey !== key) cache.delete(oldKey);
    }
    return entry.promise;
  }

  return {
    async report({ since, until, grain = 'day', brand = null, refresh = false, comparison = previousPeriod(since, until) }) {
      const source = await read(comparison.since, until, refresh);
      const current = buildNaverAttributionReport({ ...source, since, until, grain, brand });
      const previous = buildNaverAttributionReport({ ...source, ...comparison, grain, brand });
      const publicationReady = current.totals.adStatus === 'VERIFIED'
        && windows(firstDay && firstDay > since ? firstDay : since, until, 1).every(({ since: day }) =>
          source.analyticsBatches.some(batch => complete(batch) && batch.since <= day && batch.until >= day)
          && source.ordersCoverage.some(batch => batch.since <= day && batch.until >= day));
      return { ...current, comparison, previous: previous.totals, comparisonRows: previous.rows,
        sources: { ...source.sources, publicationReady }, mappingCount: mapping.length,
        attributionBasis: 'Cafe24 주문일 KST·기록된 UTM 귀속. 광고비는 동일 KST 기간의 네이버 그룹 통계. 증분 매출 측정값 아님.' };
    }
  };
}
