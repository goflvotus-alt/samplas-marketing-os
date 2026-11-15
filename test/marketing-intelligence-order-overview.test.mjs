import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crmOrderTrace, crmMonthly} from '../scripts/crm-analytics.mjs';
const code=readFileSync(new URL('../outputs/marketing-intelligence-entry.js',import.meta.url),'utf8');
const time=d=>Date.parse(d+'T12:00:00+09:00');
const order=(id,date,member,flag,amount,extra={})=>({
 id,date,time:time(date),month:date.slice(0,7),member,firstOrderFlag:flag,amount,valid:true,
 identityKnown:true,personalPayment:false,productItems:[{name:'ORDER ITEM',productNo:'123',quantity:1}],
 itemCountAvailable:true,...extra
});
const ds={
 orders:[
 order('sep1','2026-09-10','returning','T',100),
 order('oct1','2026-10-03','fresh','T',200),
 order('oct2','2026-10-04','fresh','F',50),
 order('oct3','2026-10-05','returning','F',300),
 order('oct4','2026-10-06',null,null,80),
 order('oct5','2026-10-07',null,null,30,{personalPayment:true}),
 order('oct6','2026-10-08','history_unknown','F',60),
 order('oct7','2026-10-09',null,null,25,{identityKnown:false})
 ],
 spans:[{since:'2026-09-01',until:'2026-10-31'}],
 analytics:new Map([['oct1',{ad:'ig',medium:'social'}]])
};
test('category counts and paid amounts are an exclusive partition of orders',()=>{
 const d=crmOrderTrace(ds,'2026-10','ALL',{from:'2026-10',to:'2026-10'});
 assert.equal(d.totals.orders,7);
 assert.equal(d.totals.paidAmount,745);
 assert.deepEqual(d.overview.buckets.map(x=>[x.key,x.orders,x.paidAmount]),[
  ['MEMBER',4,610],['GUEST',1,80],['PERSONAL',1,30],['UNKNOWN',1,25]
 ]);
 assert.equal(d.overview.buckets.reduce((n,x)=>n+x.orders,0),d.overview.all.orders);
 assert.equal(d.overview.buckets.reduce((n,x)=>n+x.paidAmount,0),d.overview.all.paidAmount);
 assert.deepEqual(d.overview.memberTypes.map(x=>[x.key,x.orders]),[['NEW',2],['REPEAT',1],['UNVERIFIED',1]]);
 assert.equal(d.overview.stylist.orders,null);
});
test('multiple months preserve member category for each order month',()=>{
 const d=crmOrderTrace(ds,'2026-09','ALL',{from:'2026-09',to:'2026-10'});
 assert.equal(d.totals.orders,8);
 assert.equal(d.totals.paidAmount,845);
 assert.equal(d.overview.buckets.reduce((n,x)=>n+x.orders,0),d.totals.orders);
 assert.equal(d.overview.buckets.reduce((n,x)=>n+x.paidAmount,0),d.totals.paidAmount);
 assert.equal(d.overview.memberTypes.find(x=>x.key==='NEW').orders,3);
 assert.equal(d.overview.memberTypes.find(x=>x.key==='REPEAT').orders,1);
 assert.equal(d.overview.memberTypes.find(x=>x.key==='UNVERIFIED').orders,1);
});
test('backend order preview reveals only anonymized order data',()=>{
 const d=crmOrderTrace(ds,'2026-10','ALL');
 assert.equal(d.overview.buckets.find(x=>x.key==='MEMBER').preview.length,3);
 assert.ok(d.overview.buckets.every(x=>x.preview.length<=3));
 for(const group of d.overview.buckets)for(const row of group.preview){
  assert.deepEqual(Object.keys(row).sort(),['anonymousCustomer','date','paidAmount','product','segment'].sort());
  assert.doesNotMatch(JSON.stringify(row),/order_id|member_id|email|phone|shipping_address/i);
 }
 assert.equal(d.overview.buckets.find(x=>x.key==='PERSONAL').preview[0].product,'개인결제');
});
test('source category detail and attribution filters still work',()=>{
 const all=crmOrderTrace(ds,'2026-10','MEMBER');
 assert.equal(all.totals.orders,4);
 assert.equal(crmOrderTrace(ds,'2026-10','NEW',{firstOnly:true}).totals.orders,1);
 assert.equal(crmOrderTrace(ds,'2026-10','NEW',{firstOnly:true,channel:'ig',medium:'social'}).totals.orders,1);
 assert.throws(()=>crmOrderTrace(ds,'2026-10','ALL',{from:'2025-01',to:'2026-10'}));
});
test('customer categories are readable and do not invent stylist counts or expose technical item codes',()=>{
 assert.match(code,/고객·결제 유형별 주문/);
 assert.match(code,/스타일리스트 · 확인 불가/);
 assert.match(code,/data-mi-order-group/);
 assert.match(code,/mi-order-preview/);
 assert.match(code,/mi-order-results/);
 assert.match(code,/miProductEvidenceLabel/);
 assert.match(code,/ORDER_ITEMS_LATEST_OBSERVATION'\)return ''/);
});
test('monthly evidence compares periods and links every month to actual source orders',()=>{
 assert.match(code,/MONTHLY EVIDENCE · 월별 매출 근거/);
 assert.match(code,/선택 기간 매출/);
 assert.match(code,/비교 기간 매출/);
 assert.match(code,/data-mi-evidence-month/);
 assert.match(code,/mi-period-evidence/);
 assert.match(code,/mi-evidence-bar/);
});
