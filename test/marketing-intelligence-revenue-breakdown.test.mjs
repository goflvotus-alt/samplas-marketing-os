import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../outputs/marketing-intelligence-entry.js',import.meta.url),'utf8');
const begin=source.indexOf('const sum=(list,key)=>');
const end=source.indexOf('function renderBreakdown(rows)',begin);
assert.ok(begin>=0&&end>begin,'revenue analysis must be present in the entrypoint');
const expr=source.slice(begin,end)+'\nthis.readBreakdown=revenueBreakdown;';
const context={Number,Array,String,Set,Math};
vm.runInNewContext(expr,context);
const analyze=context.readBreakdown;
const rows=[
{month:'2026-07',amount:35000863,newRevenue:6967100,repeat:6288110,guestRevenue:12855453,personalRevenue:7190000,unverifiedRevenue:1700200,identityUnknownRevenue:0},
{month:'2026-08',amount:34722620,newRevenue:10728160,repeat:4624280,guestRevenue:9533480,personalRevenue:9359400,unverifiedRevenue:477300,identityUnknownRevenue:0},
{month:'2026-09',amount:30748893,newRevenue:6188060,repeat:8140140,guestRevenue:8204953,personalRevenue:7906740,unverifiedRevenue:309000,identityUnknownRevenue:0},
{month:'2026-10',amount:39462706,newRevenue:6142730,repeat:16654950,guestRevenue:13503726,personalRevenue:1783300,unverifiedRevenue:1378000,identityUnknownRevenue:0}
];
test('four monthly revenue mixes reconcile to actual total without double count',()=>{
 for(const row of rows){const result=analyze([row]);assert.equal(result.complete,true);assert.equal(result.discrepancy,0,row.month)}
});
test('four-month total includes personal payment as its own segment',()=>{
 const r=analyze(rows),dict=Object.fromEntries(r.items.map(x=>[x.key,x.amount]));
 assert.equal(r.total,139935082);assert.equal(dict.newRevenue,30026050);
 assert.equal(dict.repeat,35707480);assert.equal(dict.guestRevenue,44097612);
 assert.equal(dict.personalRevenue,26239440);assert.equal(dict.unverifiedRevenue,3864500);
 assert.equal(r.discrepancy,0);
});
test('missing components never become fake zero and block trusted stacked percentages',()=>{
 const partial=rows.map(x=>({...x}));partial[1].guestRevenue=null;
 const r=analyze(partial);
 assert.equal(r.complete,false);
 assert.equal(r.items.find(x=>x.key==='guestRevenue').amount,null);
 assert.equal(r.discrepancy,null);
});
test('mismatch does not count as reconciled',()=>{
 const data=rows.map(x=>({...x}));data[0].personalRevenue+=1;
 const r=analyze(data);assert.equal(r.complete,true);assert.equal(r.discrepancy,-1);
});

test('comparison table labels actual months and explains observed changes',()=>{
 const left=source.slice(source.indexOf('const fmt='),source.indexOf('const state='));
 const functions=source.slice(source.indexOf('const sum='),source.indexOf('function metric('))+'\n'+source.slice(source.indexOf('function revenueBreakdown('),source.indexOf('function renderWhy('));
 const render=vm.runInNewContext(left+'\n'+functions+'\nrenderBreakdown',{Number,Array,String,Set,Math,Intl});
 const html=render([rows[3]],[rows[2]],'직전 같은 길이 기간');
 assert.match(html,/선택 2026-10/);
 assert.match(html,/비교 2026-09/);
 assert.match(html,/39,462,706원/);
 assert.match(html,/30,748,893원/);
 assert.match(html,/8,713,813원/);
 assert.match(html,/재구매 회원 매출/);
 assert.match(html,/\+8,514,810원/);
 assert.match(html,/개인결제창 주문 매출/);
 assert.match(html,/-6,123,440원/);
 assert.match(html,/월별 근거/);
 assert.match(html,/온라인 매출 합계/);
});
test('no undefined variable in segment button rendering',()=>{
 assert.match(source,/const labels=\[/);
 assert.match(source,/if\(i>=labels.length\)/);
});
