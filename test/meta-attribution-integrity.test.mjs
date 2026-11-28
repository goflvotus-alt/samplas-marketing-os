import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMetaInsightPages, isExactMetaInsightScope, reconcileMetaLevels } from '../scripts/meta-attribution-integrity.mjs';
import { buildWeeklySalesTrace, attachWeeklyOrderMatch } from '../scripts/meta-weekly-sales-trace.mjs';

test('collects past the first page and rejects repeated IDs or cursors', async () => {
  const pages = [
    { data: [{ad_id:'1'}], paging:{next:'unused',cursors:{after:'A'}} },
    { data: [{ad_id:'2'}] }
  ];
  const complete = await collectMetaInsightPages('ad', async after => pages[after ? 1 : 0]);
  assert.deepEqual(complete.data.map(r=>r.ad_id), ['1','2']);
  assert.equal(complete.paginationExhausted, true);
  const repeated = await collectMetaInsightPages('ad', async () => pages[0]);
  assert.equal(repeated.partial, true);
  assert.equal(repeated.paginationExhausted, false);
});

test('reconciliation compares additive metrics and preserves a discrepancy', () => {
  const input = (spend, reach) => ({ completeness:'COMPLETE', totals:{spend,reach,clicks:1,impressions:3,purchases:1,purchaseValue:230000} });
  const audit = reconcileMetaLevels({campaign:input(12,3),adset:input(12,2),ad:input(8,1)});
  assert.equal(audit.find(r=>r.metric==='spend').status,'MISMATCH');
  assert.equal(audit.some(r=>r.metric==='reach'),false);
});

test('same amount and date without tracking never confirms an order', () => {
  const since='2026-11-25', until=since;
  const order={order_id:'20261125-0000054',order_date:since,paid:'T',payment_amount:230000,items:[]};
  const ads=[{adId:'120251125886880277',adName:'Sale',purchaseValue:230000}];
  const trace=buildWeeklySalesTrace({since,until,actualOrders:[order],ads});
  attachWeeklyOrderMatch(trace,{onlineOrders:1,linkedOrders:0,unlinkedOrders:1,unknownLinkOrders:0,linkEvidence:[]});
  assert.equal(trace.orders[0].attributionStatus,'UNATTRIBUTED');
  assert.equal(trace.orders[0].matchAdId,null);
});

test('confirmed order and unique UTM candidate are separately attributed at each Meta level', () => {
  const day = '2026-11-25';
  const orders = ['confirmed', 'candidate', 'ambiguous'].map(order_id =>
    ({order_id, paid:'T', payment_amount:1200, order_date:day, items:[]}));
  const [confirmed,candidate,ambiguous] = orders.map(o=>o.order_id);
  const ads = [
    {adId:'a', adName:'exact',adsetId:'sa',campaignId:'c'},
    {adId:'b', adName:'other',adsetId:'sb',campaignId:'c'},
    {adId:'d', adName:'ambiguous',adsetId:'sb',campaignId:'c'},
    {adId:'e', adName:'ambiguous',adsetId:'sb',campaignId:'c'}
  ];
  const analytics = {orderdetails:[
    {order_id:confirmed,ad:'meta',medium:'paid',campaign:'c',content:'a'},
    {order_id:candidate,ad:'meta',medium:'paid',campaign:'c',content:'campaign-tag'},
    {order_id:ambiguous,ad:'meta',medium:'paid',campaign:'c',content:'ambiguous'}
  ]};
  const trace=buildWeeklySalesTrace({since:day,until:day,actualOrders:orders,analytics,ads,
    tracking:{rows:[{id:'b',url_tags:'utm_source=meta&utm_medium=paid&utm_campaign=c&utm_content=campaign-tag'}]},
    customerTypes:{confirmed:'NEW',candidate:'REPEAT'}});
  attachWeeklyOrderMatch(trace,{onlineOrders:3, linkedOrders:1, unlinkedOrders:2, unknownLinkOrders:0, verifiedRevenue:1200,
    linkEvidence:[{orderId:confirmed,adId:'a',basis:'verified'}]});
  assert.deepEqual(trace.orders.map(o=>[o.attributionStatus,o.attributionAdId,o.customerType]),
    [['CONFIRMED','a','NEW'],['MATCHED','b','REPEAT'],['UNATTRIBUTED',null,'UNKNOWN']]);
  assert.equal(trace.attribution.CONFIRMED.net,1200);
  assert.equal(trace.attribution.MATCHED.net,1200);
  assert.equal(trace.attributionLevels.find(o=>o.level==='campaign'&&o.status==='CONFIRMED').net,1200);
});

test('historical cache does not substitute a different end date or an exhausted page budget', () => {
  const wanted={level:'ad',since:'2026-10-01',until:'2026-10-31'};
  assert.equal(isExactMetaInsightScope({...wanted,until:'2026-10-12'},wanted),false);
  assert.equal(isExactMetaInsightScope({...wanted,coverage:{reasons:['INSIGHTS_PAGE_NOT_EXHAUSTED']}},wanted),false);
  assert.equal(isExactMetaInsightScope(wanted,wanted),true);
});

test('unverified coverage never reports an empty confirmed cohort as zero', () => {
  const trace=buildWeeklySalesTrace({});
  attachWeeklyOrderMatch(trace,{unknownLinkOrders:null});
  assert.equal(trace.attributionCoverage,'PARTIAL');
  assert.equal(trace.attribution.CONFIRMED.orders,null);
  assert.equal(trace.attribution.CONFIRMED.net,null);
});
