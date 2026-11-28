import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { saveWeeklyReportToDropboxAtPath, findPublishedReport } from '../scripts/dropbox-report-uploader.mjs';

const env = { DROPBOX_APP_KEY: 'test', DROPBOX_APP_SECRET: 'test', DROPBOX_REFRESH_TOKEN: 'test' };
const targetPath = '/reports/NAVER_ADS_WEEKLY_2026-11-17_2026-11-23.xlsx';
const missing = { error: { '.tag': 'path', path: { '.tag': 'not_found' } } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

async function workbook(period = '2026-11-17 – 2026-11-23') {
  const book = new ExcelJS.Workbook();
  const report = book.addWorksheet('REPORT');
  report.getCell('A1').value = 'NAVER SEARCH ADS WEEKLY REPORT';
  report.getCell('A2').value = 'SAMPLAS  |  ' + period;
  for (const [cell, amount] of [['A6', 123], ['E6', 15], ['E10', 35]]) report.getCell(cell).value = amount;
  book.addWorksheet('ISSUE_EVIDENCE', { state: 'veryHidden' }).getCell('A1').value =
    JSON.stringify({ since: '2026-11-17', until: '2026-11-23', review: { result: 'PASS' } });
  return book;
}

function storage(initial) {
  const files = new Map(initial ? [[targetPath, initial]] : []);
  const state = { uploads: 0, fail: false, files };
  state.fetchImpl = async (url, request) => {
    if (url.endsWith('/token')) return json({ access_token: 'test' });
    if (url.endsWith('/get_metadata')) {
      const { path } = JSON.parse(request.body);
      const bytes = files.get(path);
      return bytes ? json({ size: bytes.length, rev: path.endsWith('_FAILED.txt') ? 'notice-rev' : 'xlsx-rev' }) : json(missing, 409);
    }
    const args = JSON.parse(request.headers['Dropbox-API-Arg']);
    if (url.endsWith('/download')) {
      const path = args.path === 'rev:notice-rev' ? [...files.keys()].find(key => key.endsWith('_FAILED.txt')) : args.path;
      return new Response(files.get(path));
    }
    assert.ok(url.endsWith('/upload'));
    if (state.fail) return json({}, 507);
    assert.equal(args.autorename, false);
    const bytes = Buffer.from(request.body);
    if (args.mode === 'add') {
      assert.equal(files.has(args.path), false);
      state.uploads++;
    } else {
      assert.match(args.path, /_FAILED\.txt$/);
      assert.deepEqual(args.mode, { '.tag': 'update', update: 'notice-rev' });
    }
    files.set(args.path, bytes);
    if (state.loseResponse && args.mode === 'add') throw new Error('connection closed after commit');
    return json({ path_display: args.path, size: bytes.length });
  };
  return state;
}

test('first publication and rerun use one durable file', async () => {
  const store = storage();
  const options = { env, targetPath, fetchImpl: store.fetchImpl };
  assert.equal((await saveWeeklyReportToDropboxAtPath(await workbook(), options)).uploaded, true);
  assert.equal((await saveWeeklyReportToDropboxAtPath(await workbook(), options)).alreadyExists, true);
  assert.equal(store.uploads, 1);
});

test('a valid existing workbook of a different size is preserved', async () => {
  const original = await workbook();
  original.getWorksheet('REPORT').getCell('A55').value = 'older report notes '.repeat(40);
  const oldBytes = await original.xlsx.writeBuffer();
  const candidate = await workbook();
  assert.notEqual(oldBytes.length, (await candidate.xlsx.writeBuffer()).length);
  const store = storage(oldBytes);
  assert.equal((await saveWeeklyReportToDropboxAtPath(candidate, { env, targetPath, fetchImpl: store.fetchImpl })).size, oldBytes.length);
  assert.equal(store.uploads, 0);
});

test('damaged XLSX and mismatched period both fail closed', async () => {
  const wrong = await workbook('2026-11-10 – 2026-11-16');
  for (const bytes of [Buffer.from('damaged'), await wrong.xlsx.writeBuffer()]) {
    const store = storage(bytes);
    await assert.rejects(findPublishedReport({ env, targetPath, fetchImpl: store.fetchImpl }), /Invalid report workbook/);
    assert.equal(store.uploads, 0);
  }
});

test('Dropbox save failure is retried without a spurious success', async () => {
  const store = storage();
  const options = { env, targetPath, fetchImpl: store.fetchImpl };
  store.fail = true;
  await assert.rejects(saveWeeklyReportToDropboxAtPath(await workbook(), options), /HTTP 507/);
  store.fail = false;
  assert.equal((await saveWeeklyReportToDropboxAtPath(await workbook(), options)).uploaded, true);
});

test('an official recovery with partial API coverage performs no Dropbox upload', async () => {
  const { publishOfficialReport } = await import('../scripts/official-report-publication.mjs');
  for (const platform of ['naver', 'instagram']) {
    const store = storage();
    const calls = [];
    const adapter = async (since, until) => {
      calls.push({ since, until });
      return { ok: true, since, until, partial: since !== '2026-11-17', posts: [], campaigns: [] };
    };
    const result = await publishOfficialReport({ platform, since: '2026-11-17', until: '2026-11-23' }, {
      env, fetchImpl: store.fetchImpl, fetchers: { [platform]: adapter }, now: new Date('2026-11-27T06:00Z')
    });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 2);
    assert.equal(store.uploads, 0);
  }
});

test('monthly ranges use closed KST months including year boundaries and leap days', async () => {
  const { dueMonthlyReport, officialReportPeriod } = await import('../scripts/official-report-publication.mjs');
  assert.deepEqual(dueMonthlyReport(new Date('2027-01-01T01:05Z')), {
    cadence: 'monthly', since: '2026-12-01', until: '2026-12-31'
  });
  assert.equal(dueMonthlyReport(new Date('2027-01-01T00:59Z')), null);
  assert.equal(dueMonthlyReport(new Date('2027-01-08T01:00Z')), null);
  const body = { cadence: 'monthly', since: '2028-02-01', until: '2028-02-29' };
  assert.equal(officialReportPeriod(body, new Date('2028-03-01T01:00Z')).month, '2028-02');
  assert.throws(() => officialReportPeriod({ ...body, until: '2028-02-28' }, new Date('2028-03-01T01:00Z')), /invalid_report_period/);
});

test('a lost Dropbox response is reconciled by reading and validating the saved bytes', async () => {
  const store = storage();
  store.loseResponse = true;
  const result = await saveWeeklyReportToDropboxAtPath(await workbook(), { env, targetPath, fetchImpl: store.fetchImpl });
  assert.equal(result.alreadyExists, true);
  assert.equal(result.contentMatches, true);
  assert.equal(store.uploads, 1);
});

const naver = async (since, until) => ({
  ok: true, since, until, campaigns: [],
  summary: { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 }
});

test('NAVER monthly recovery adds attribution, verifies Dropbox bytes and reuses the issued file', async () => {
  const { publishOfficialReport } = await import('../scripts/official-report-publication.mjs');
  const store = storage();
  const period = { since: '2026-11-01', until: '2026-11-30' };
  const comparison = { since: '2026-10-01', until: '2026-10-31' };
  const request = { ...period, platform: 'naver', cadence: 'monthly' };
  const options = {
    env, fetchImpl: store.fetchImpl, now: new Date('2026-12-01T01:00Z'),
    fetchers: { naver, naverMonthlyAttribution: async () => ({ ok: false }) }
  };
  assert.equal((await publishOfficialReport(request, options)).ok, false);
  assert.equal(store.uploads, 0);
  options.fetchers.naverMonthlyAttribution = async query => {
    assert.deepEqual(query, { ...period, grain: 'month', comparison });
    return { ok: true, period, comparison, totals: { net: 380000, platformRevenue: 560000 },
      previous: { net: 190000 }, sources: { publicationReady: true }, orders: [] };
  };
  store.loseResponse = true;
  const published = await publishOfficialReport(request, options);
  assert.equal(published.ok, true);
  assert.match(published.filePath, /NAVER_ADS_MONTHLY_2026-11-01_2026-11-30\.xlsx$/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(store.files.get(published.filePath));
  assert.match(book.getWorksheet('REPORT').getCell('A1').value, /MONTHLY/);
  const summary = book.getWorksheet('성과 요약');
  assert.equal(summary.getCell('L2').value, 380000);
  assert.equal(summary.getCell('N2').value, 560000);
  assert.equal(summary.getCell('A4').value, '직전 월 대비 증감률');
  assert.equal(summary.getCell('L4').value, 1);
  options.fetchers.naverMonthlyAttribution = async () => assert.fail('existing issue must be reused');
  assert.equal((await publishOfficialReport(request, options)).alreadyExists, true);
  assert.equal(store.uploads, 1);
});

test('concurrent NAVER weekly and monthly previews use isolated ranges and add-only paths', async () => {
  const { runWeeklyReportPreview } = await import('../scripts/weekly-report-manual.mjs');
  const store = storage();
  const calls = [];
  const options = {
    env,
    upload: (book, args) => saveWeeklyReportToDropboxAtPath(book, { ...args, fetchImpl: store.fetchImpl }),
    fetchers: { naver, naverAttribution: async query => {
      calls.push(query);
      const { since, until, comparison = { since: '2026-11-10', until: '2026-11-16' } } = query;
      return { ok: true, period: { since, until }, comparison, totals: {}, previous: {},
        sources: { publicationReady: true }, orders: [] };
    } }
  };
  const body = { platform: 'naver', mode: 'preview' };
  const [week, month] = await Promise.all([
    runWeeklyReportPreview({ ...body, referenceDate: '2026-11-24' }, options),
    runWeeklyReportPreview({ ...body, month: '2026-10' }, options)
  ]);
  assert.match(week.filePath, /WEEKLY_2026-11-17_2026-11-23_PREVIEW_/);
  assert.match(month.filePath, /MONTHLY_2026-10-01_2026-10-31_PREVIEW_/);
  assert.equal(store.uploads, 2);
  assert.equal(calls.find(q => q.grain === 'month').comparison.until, '2026-09-30');
  for (const result of [week, month]) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(store.files.get(result.filePath));
    assert.equal(book.getWorksheet('성과 요약').getCell('B2').value, result.since);
  }
});
const instagram = async (since, until) => ({
  ok: true, since, until, posts: [],
  accountWeekly: { reach: 0, views: 0, profile_views: 0, website_clicks: 0 }
});
const metaOrder = since => ({
  order_id: since.replaceAll('-', '') + '-0000001', order_date: since, payment_date: since, paid: 'T', canceled: 'F',
  actual_order_amount: { payment_amount: '1000.00' },
  items: [{ order_item_code: 'item-' + since, product_name: 'Test item', product_price: '1000.00', quantity: 1, order_status: 'N30' }]
});
const meta = {
  fetchByLevel: async () => ({
    completeness: 'COMPLETE', source: 'meta_marketing_api', rows: [{ adId: 'ad1', adName: 'Test ad' }],
    totals: { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0 }
  }),
  fetchActualOrders: async since => ({
    coverage: { completeness: 'COMPLETE' }, source: 'cafe24_inflow_queries', orders: [],
    trackingQueries: ['meta_meantime_look', 'meta_ssage', 'meta_adv_catalog', 'meta_adv_image', 'meta_adv_video'].map(code => ({ code, ok: true, complete: true, count: 0 })),
    analyticsOrders: [metaOrder(since)], analyticsOrdersComplete: true
  }),
  fetchActualAnalytics: async since => ({
    coverage: { completeness: 'COMPLETE' }, ok: true,
    data: { orderdetails: [{ order_id: metaOrder(since).order_id, ad: 'ig', medium: 'paid', content: 'ad1', order_amount: 1000 }] }
  })
};

for (const [platform, prefix] of Object.entries({ naver: 'NAVER_ADS', meta: 'META_ADS', instagram: 'INSTAGRAM' })) {
  for (const cadence of ['weekly', 'monthly']) {
    test(`${platform} ${cadence}: real generator, official recovery and verified rerun`, async t => {
      const { publishOfficialReport } = await import('../scripts/official-report-publication.mjs');
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const workDir = await mkdtemp(join(tmpdir(), 'official-report-test-'));
      t.after(() => rm(workDir, { recursive: true }));
      const store = storage();
      const since = cadence === 'weekly' ? '2026-11-17' : '2026-10-01';
      const until = cadence === 'weekly' ? '2026-11-23' : '2026-10-31';
      const filename = `${prefix}_${cadence.toUpperCase()}_${since}_${until}`;
      const notice = `/reports/${filename}_FAILED.txt`;
      store.files.set(notice, Buffer.from('SAMPLAS WEEKLY REPORT FAILED\nreason: earlier timeout'));
      const request = { platform, cadence, since, until };
      const options = {
        env: { ...env, WORK_DIR: workDir, DROPBOX_WEEKLY_REPORT_DIR: '/reports', DROPBOX_META_WEEKLY_REPORT_DIR: '/reports', DROPBOX_INSTAGRAM_WEEKLY_REPORT_DIR: '/reports' },
        fetchImpl: store.fetchImpl, fetchers: { meta, naver, instagram }, now: new Date('2026-11-27T06:00Z')
      };
      const first = await publishOfficialReport(request, options);
      assert.equal(first.ok, true, first.error);
      assert.equal(first.filePath, `/reports/${filename}.xlsx`);
      assert.equal(first.warning, undefined);
      assert.match(String(store.files.get(notice)), /^SAMPLAS REPORT PUBLISHED/);
      assert.match(String(store.files.get(notice)), /reason: earlier timeout/);
      const next = await publishOfficialReport(request, { ...options, fetchers: {} });
      assert.equal(next.ok, true);
      assert.equal(next.alreadyExists, true);
      assert.equal(next.warning, undefined);
      assert.equal(store.uploads, 1);
    });
  }
}

test('Meta API partial response fails review without Dropbox upload', async () => {
  const { publishOfficialReport } = await import('../scripts/official-report-publication.mjs');
  const store = storage();
  const result = await publishOfficialReport({ platform: 'meta', cadence: 'monthly', since: '2026-10-01', until: '2026-10-31' }, {
    env, fetchImpl: store.fetchImpl, now: new Date('2026-11-27T06:00Z'),
    fetchers: { meta: { ...meta, fetchByLevel: async () => ({ ...(await meta.fetchByLevel()), completeness: 'PARTIAL' }) } }
  });
  assert.equal(result.ok, false);
  assert.equal(store.uploads, 0);
});

test('monthly Cafe24 Analytics reconciles capped ranges using complete disjoint slices', async () => {
  const { fetchReportAnalyticsRange, analyticsRangeBelowLimit } = await import('../scripts/weekly-data-completeness.mjs');
  const since = '2026-10-01', until = '2026-10-31';
  const fetchRange = async (start, end) => ({
    ok: true, data: { orderdetails: Array(start === since && end === until ? 100 : 60).fill({}) },
    coverage: { scope: { since: start, until: end }, completeness: start === since && end === until ? 'PARTIAL' : 'COMPLETE',
      reasons: start === since && end === until ? ['ANALYTICS_LIMIT_OR_NEXT_PAGE'] : [] }
  });
  const result = await fetchReportAnalyticsRange(since, until, fetchRange);
  assert.equal(result.data.orderdetails.length, 120);
  assert.ok(analyticsRangeBelowLimit(result, result.data.orderdetails, since, until));
  result.coverage.parts[1].since = result.coverage.parts[0].until;
  assert.equal(analyticsRangeBelowLimit(result, result.data.orderdetails, since, until), false);
  const failed = await fetchReportAnalyticsRange(since, until, (start, end) =>
    end === until && start !== since ? { ok: false } : fetchRange(start, end));
  assert.equal(failed.coverage.completeness, 'PARTIAL');
});

test('a new Node process verifies the existing official report without generating or uploading', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const store = storage();
  await saveWeeklyReportToDropboxAtPath(await workbook(), { env, targetPath, fetchImpl: store.fetchImpl });
  const moduleUrl = new URL('../scripts/official-report-publication.mjs', import.meta.url).href;
  const child = `
    import assert from 'node:assert/strict';
    import { publishOfficialReport } from ${JSON.stringify(moduleUrl)};
    const bytes = Buffer.from(process.argv[1], 'base64');
    const env = { DROPBOX_APP_KEY: 'test', DROPBOX_APP_SECRET: 'test', DROPBOX_REFRESH_TOKEN: 'test', DROPBOX_WEEKLY_REPORT_DIR: '/reports' };
    const fetchImpl = async (url, request) => {
      if (url.endsWith('/token')) return Response.json({ access_token: 'test' });
      if (url.endsWith('/get_metadata')) {
        if (JSON.parse(request.body).path.endsWith('.xlsx')) return Response.json({ size: bytes.length });
        return Response.json({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, { status: 409 });
      }
      if (url.endsWith('/download')) return new Response(bytes);
      throw new Error('unexpected duplicate upload');
    };
    const result = await publishOfficialReport({ platform: 'naver', since: '2026-11-17', until: '2026-11-23' }, {
      env, fetchImpl, fetchers: {}, now: new Date('2026-11-27T06:00Z')
    });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyExists, true);
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', child, Buffer.from(store.files.get(targetPath)).toString('base64')]);
});

test('a late failed attempt cannot create a notice for a validated published workbook', async () => {
  const { saveWeeklyFailureNoticeToDropbox } = await import('../scripts/dropbox-report-uploader.mjs');
  const store = storage(await (await workbook()).xlsx.writeBuffer());
  const noticePath = targetPath.replace(/\.xlsx$/, '_FAILED.txt');
  const result = await saveWeeklyFailureNoticeToDropbox({
    env, targetPath: noticePath, text: 'attempt error', fetchImpl: store.fetchImpl
  });
  assert.equal(result.published, true);
  assert.equal(store.files.has(noticePath), false);
  assert.equal(store.uploads, 0);
});

test('legacy Naver releases verify repeated source totals without an evidence JSON record', async () => {
  const legacy = await workbook();
  legacy.removeWorksheet(legacy.getWorksheet('ISSUE_EVIDENCE').id);
  const report = legacy.getWorksheet('REPORT');
  report.getCell('A62').value = 'SOURCE: Naver Search Ads · 기간별 캠페인 통계 · 2026-11-17 – 2026-11-23';
  for (const [card, total] of [['A6', 'C15'], ['E6', 'C17'], ['E10', 'C22']]) report.getCell(total).value = report.getCell(card).value;
  const verify = async () => {
    const store = storage(await legacy.xlsx.writeBuffer());
    return findPublishedReport({ env, targetPath, fetchImpl: store.fetchImpl });
  };
  assert.equal((await verify()).alreadyExists, true);
  report.getCell('C15').value = 124;
  await assert.rejects(verify(), /invalid legacy Naver report/);
});

test('October Meta correction keeps the original bytes and validates its add-only corrected variant', async () => {
  const { runWeeklyReportPreview } = await import('../scripts/weekly-report-manual.mjs');
  const store = storage();
  const original = '/reports/META_ADS_MONTHLY_2026-10-01_2026-10-31.xlsx';
  const corrected = original.replace(/\.xlsx$/, '_CORRECTED.xlsx');
  const originalBytes = Buffer.from('canonical existing issue, never read or overwritten');
  store.files.set(original, originalBytes);
  const request = {platform:'meta',month:'2026-10',mode:'correction'};
  const options = {
    env:{...env,DROPBOX_META_WEEKLY_REPORT_DIR:'/reports'},
    hasPersistentMetaConnection:async()=>true,
    fetchers:{meta:meta.fetchByLevel,actualOrders:meta.fetchActualOrders,actualAnalytics:meta.fetchActualAnalytics},
    upload:(book, settings)=>saveWeeklyReportToDropboxAtPath(book,{...settings,fetchImpl:store.fetchImpl})
  };
  const first=await runWeeklyReportPreview(request,options);
  assert.equal(first.filePath,corrected);
  assert.equal(first.alreadyExists,false);
  assert.equal((await runWeeklyReportPreview(request,options)).alreadyExists,true);
  assert.equal(store.uploads,1);
  assert.deepEqual(store.files.get(original),originalBytes);
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(store.files.get(corrected));
  assert.equal(book.getWorksheet('CORRECTION').getCell('B1').text,original.split('/').at(-1));
  assert.equal(book.getWorksheet('META_LEVEL_CHECK').getCell('E2').text,'MATCH');
});
