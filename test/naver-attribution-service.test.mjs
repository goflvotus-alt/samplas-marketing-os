import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createNaverAttributionService, naverReportQuery } from '../scripts/naver-attribution-service.mjs';
import { buildNaverAttributionWorkbook } from '../scripts/naver-attribution-workbook.mjs';

test('report reuses scheduled snapshots and coalesces refreshes, provides comparison and Excel', async () => {
  const day = '2026-11-20';
  const previous = '2026-11-19';
  const orderId = 'test-order';
  const mapping = [{ groupId: 'group', brandCode: 'BRAND', brandName: '604SERVICE', content: '604service_test', startDay: previous, logicalId: 'pilot' }];
  let now = Date.parse('2026-11-27T01:00:00Z');
  let calls = 0;
  const service = createNaverAttributionService({
    mapping, now: () => now, ttl: 100,
    fetchAds: async (since, until) => {
      calls++;
      assert.deepEqual([since, until], [previous, day]);
      const rows = [previous, day].map(day => ({ id:'group', day, groupId:'group', brandCode:'BRAND', impressions:100, clicks:10, spend:1000, platformRevenue:999 }));
      return { rows, coverage: [previous, day], campaignRows: rows, campaignCount: 1, status: 'AVAILABLE' };
    },
    loadSnapshots: async () => [{ observedAt: now, analyticsBatches: [
      { since: previous, until: day, ok: true, completeness: 'COMPLETE', rows: [
        { order_id: orderId, order_date: day, ad:'네이버', medium:'cpc', campaign:'powerlink', content:'604service_test' }
      ] }
    ] }],
    fetchOrders: async (startDate, endDate) => ({ source:'cafe24_admin_api', startDate, endDate, orders: [
      { order_id:orderId, order_date:day, paid:'T', canceled:'F', actual_order_amount:{payment_amount:'380000'}, items:[{product_no:1,product_name:'상품',quantity:1}] }
    ] }),
    fetchAnalytics: async () => assert.fail('existing complete snapshot should be used'),
    enrichOrders: async () => ({ catalog: { '1': { brandCode:'OTHER' } } })
  });
  const query = { since:day, until:day };
  const [data, filtered] = await Promise.all([service.report(query),service.report({ ...query, brand:'BRAND' })]);
  assert.equal(calls, 1);
  for (const result of [data, filtered]) {
    assert.equal(result.totals.net, 380000);
    assert.equal(result.totals.roas, 380);
    assert.equal(result.previous.net, 0);
    assert.equal(result.sources.publicationReady, true);
    assert.equal(result.orders[0].purchaseBrands[0], 'OTHER');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildNaverAttributionWorkbook(data));
  assert.equal(workbook.getWorksheet('주문 근거').getCell('A2').value, orderId);
  assert.equal(workbook.getWorksheet('구매 상품').getCell('D2').value, 'OTHER');
  await service.report({ ...query, refresh: true });
  assert.equal(calls, 2);
  now += 101;
  await service.report(query);
  assert.equal(calls, 3);
});

test('validates KST filters and rejects impossible and future dates', () => {
  const query = (since, until, extra = '') => naverReportQuery(new URLSearchParams(`since=${since}&until=${until}${extra}`),'2026-11-27');
  assert.equal(query('2026-02-30','2026-11-27'),null);
  assert.equal(query('2026-11-27','2026-11-28'),null);
  assert.equal(query('2026-11-20','2026-11-27','&grain=week').grain,'week');
});
