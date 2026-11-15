import test from 'node:test';
import assert from 'node:assert/strict';
import { crmOrderTrace } from '../scripts/crm-analytics.mjs';
import { readFileSync } from 'node:fs';

const time = d => Date.parse(d+'T10:00:00+09:00');
function order(id,date,member,flag,amount,overrides={}){
 return {id,date,time:time(date),month:date.slice(0,7),member,firstOrderFlag:flag,amount,valid:true,identityKnown:true,personalPayment:false,market:null,productItems:[{name:'TEST PRODUCT',productNo:'12',quantity:1}],itemCountAvailable:true,productItemsFromEarlierObservation:false,...overrides};
}
const ds={
 orders:[
  order('sep','2026-09-12','b','T',100),
  order('new-1','2026-10-02','a','T',200),
  order('new-2','2026-10-09','a','F',50),
  order('rep','2026-10-10','b','F',120),
  order('guest','2026-10-11',null,null,80),
  order('personal','2026-10-12',null,null,30,{personalPayment:true}),
  order('unverified','2026-10-13','c','F',60),
  order('unknown','2026-10-14',null,null,25,{identityKnown:false})
 ],
 spans:[{since:'2026-09-01',until:'2026-10-31'}],
 analytics:new Map([['new-1',{ad:'ig',medium:'social'}],['new-2',{ad:'meta',medium:'paid'}]])
};
test('order trace reconciles six buckets without duplicates',()=>{
 const parts=[['NEW',250,2,1],['REPEAT',120,1,1],['GUEST',80,1,null],['PERSONAL',30,1,null],['UNVERIFIED',60,1,1],['UNKNOWN',25,1,null]];
 for(const [group,amount,orders,members] of parts){
  const result=crmOrderTrace(ds,'2026-10',group);
  assert.equal(result.totals.paidAmount,amount,group);
  assert.equal(result.totals.orders,orders,group);
  assert.equal(result.totals.members,members,group);
 }
 assert.equal(crmOrderTrace(ds,'2026-10','ALL').totals.paidAmount,565);
});
test('first purchase, repeated order and exact channel are distinct',()=>{
 assert.equal(crmOrderTrace(ds,'2026-10','NEW',{firstOnly:true}).totals.orders,1);
 assert.equal(crmOrderTrace(ds,'2026-10','NEW',{firstOnly:true,channel:'ig',medium:'social'}).totals.orders,1);
 assert.equal(crmOrderTrace(ds,'2026-10','NEW',{firstOnly:true,channel:'meta',medium:'paid'}).totals.orders,0);
});
test('privacy-safe order rows reveal products but not customer/order identifiers',()=>{
 const rows=crmOrderTrace(ds,'2026-10','NEW').rows;
 assert.ok(rows.every(x=>x.products[0].name==='TEST PRODUCT'));
 assert.ok(rows.every(x=>x.acquisition.searchQuery===null));
 assert.ok(rows.every(x=>x.acquisition.searchQueryStatus==='NOT_COLLECTED'));
 assert.ok(rows.every(x=>!('id' in x)&&!('order_id' in x)&&!('member_id' in x)&&!('email' in x)));
 assert.ok(rows.every(x=>x.anonymousCustomer.startsWith('회원-')));
});
test('personal-payment product titles are not exposed',()=>{
 const row=crmOrderTrace(ds,'2026-10','PERSONAL').rows[0];
 assert.deepEqual(row.products,[]);
 assert.equal(row.productEvidence,'PERSONAL_PAYMENT_NAME_SUPPRESSED');
});
test('page bounds and segment inputs are validated',()=>{
 assert.throws(()=>crmOrderTrace(ds,'2026-10','INVALID'));
 assert.throws(()=>crmOrderTrace(ds,'2026-10','NEW',{limit:1000}));
 assert.equal(crmOrderTrace(ds,'2026-10','NEW',{page:2,limit:1}).rows.length,1);
});
test('frontend connects hover, customer trace, keywords and visitor panels without fake metrics',()=>{
 const s=readFileSync(new URL('../outputs/marketing-intelligence-entry.js',import.meta.url),'utf8');
 assert.match(s,/data-mi-tip/);
 assert.match(s,/\/api\/crm\/order-trace/);
 assert.match(s,/\/api\/marketing-intelligence\/traffic/);
 assert.match(s,/NOT_FINAL|PARTIAL/);
 assert.match(s,/searchQuery|검색어/);
});
