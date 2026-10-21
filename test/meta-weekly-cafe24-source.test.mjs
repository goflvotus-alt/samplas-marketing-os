// Read-only Cafe24 source route for the off-Production Meta weekly rehearsal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import ExcelJS from 'exceljs';
import * as coverage from '../scripts/weekly-data-completeness.mjs';
import {createMetaWeeklyCafe24SourceHandler,minimizeCafe24Source,validateCafe24SourceQuery,inMetaWeeklyWindow,UnexpectedCafe24SourceShape} from '../scripts/meta-weekly-cafe24-source.mjs';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';

const src=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const slice=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const WED=new Date('2026-10-21T03:00:00Z'); // Wednesday 12:00 KST
const at=iso=>()=>new Date(iso);
const q=s=>new URL('http://x/api/reports/meta-weekly/cafe24-source?'+s);

// Personal fields as Cafe24 returns them; none may leave the route.
const PII={billing_name:'홍길동',member_id:'member_secret',member_email:'buyer@example.com',buyer_name:'홍길동',buyer_email:'buyer@example.com',buyer_phone:'02-111-2222',
 buyer_cellphone:'010-1234-5678',receiver_name:'김수령',receiver_phone:'02-333-4444',receiver_cellphone:'010-9999-8888',receiver_address1:'서울시 비밀구 1',receiver_zipcode:'01234',
 shipping_message:'문 앞',bank_account_no:'110-222-333333',bank_account_owner_name:'홍길동',refund_bank_account_no:'999-000',customer_ip:'203.0.113.7',user_agent:'UA-secret',
 buyer:{name:'홍길동',email:'buyer@example.com'},receivers:[{name:'김수령',address1:'서울시 비밀구 1',cellphone:'010-9999-8888'}]};
const PII_VALUES=['홍길동','member_secret','buyer@example.com','010-1234-5678','010-9999-8888','김수령','서울시 비밀구','01234','110-222-333333','999-000','203.0.113.7','UA-secret','02-111-2222','02-333-4444','문 앞'];
const ITEM_PII={supplier_name:'공급사',buyer_name:'홍길동',receiver_cellphone:'010-9999-8888',gift_message:'문 앞'};

const ADS=[{adId:'111',adName:'Ad One',campaignName:'C'},{adId:'222',adName:'Ad Two',campaignName:'C'}];
const TOTALS={spend:395661,impressions:47504,clicks:2166,purchases:14,purchaseValue:5192070};
const level=()=>({completeness:'COMPLETE',coverage:{kind:'meta_insights',completeness:'COMPLETE',reasons:[]},source:'meta_marketing_api',rows:ADS.map(a=>({...a,spend:100,impressions:1000,clicks:10,purchases:1,purchaseValue:100000})),totals:TOTALS});
const day=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
const item=(id,n,extra={})=>({order_item_code:`${id}-${n}`,item_no:n,product_no:10+n,product_code:'P000'+n,variant_code:'P000'+n+'000A',product_name:'상품'+n,option_value:'M',quantity:1,product_price:'50000.00',order_status:'N40',status_code:'N1',status_text:'배송완료',...ITEM_PII,...extra});
const order=(id,date,extra={},items=[item(id,1),item(id,2)])=>({order_id:id,order_date:`${date}T12:00:00+09:00`,payment_date:`${date}T12:01:00+09:00`,paid:'T',canceled:'F',market_id:'self',payment_method:['card'],payment_method_name:['카드'],
 actual_order_amount:{order_price_amount:'100000.00',payment_amount:'100000.00',shipping_fee:'0.00',points_spent_amount:'0.00',credits_spent_amount:'0.00',coupon_discount_price:'0.00',total_amount_due:'0.00'},
 initial_order_amount:{order_price_amount:'100000.00',payment_amount:'100000.00'},...PII,...extra,items});
// One week: ad ID (G1), ad name (G2), unknown ad (G3), claim in progress, Naver Pay 0, canceled, organic.
function week(since,phase){
 const d=day(since,1),id=n=>`${since.replaceAll('-','')}-${String(n).padStart(7,'0')}`;
 const refunded=phase==='refunded'&&since==='2026-10-06';
 const ret=`${day(since,13)}T12:27:28+09:00`,paidBack=`${day(since,13)}T12:27:42+09:00`,cancel=`${day(since,12)}T09:00:00+09:00`,returned=`${day(since,13)}T08:00:00+09:00`;
 return [
  order(id(1),d,refunded?{canceled:'T',cancel_date:ret,return_confirmed_date:ret,actual_order_amount:{order_price_amount:'100000.00',payment_amount:'0.00'}}:{},refunded?[item(id(1),1,{order_status:'R40',status_code:'C3',status_text:'반품완료',return_confirmed_date:ret,refund_date:paidBack}),item(id(1),2,{order_status:'R40',status_code:'C3',status_text:'반품완료',return_confirmed_date:ret,refund_date:paidBack})]:undefined),
  order(id(2),d),order(id(3),d),
  order(id(4),d,{},[item(id(4),1,{status_text:'반품신청',return_request_date:`${d}T15:00:00+09:00`}),item(id(4),2)]),
  order(id(5),d,{payment_method:['npay'],payment_method_name:['네이버페이'],actual_order_amount:{order_price_amount:'100000.00',payment_amount:'0.00'}}),
  order(id(6),d,{canceled:'T',cancel_date:`${d}T13:00:00+09:00`},[item(id(6),1,{order_status:'C40',status_code:'C2',status_text:'취소완료',cancel_date:`${d}T13:00:00+09:00`})]),
  order(id(7),d),
  order(id(8),d,refunded?{canceled:'T',cancel_date:cancel,actual_order_amount:{order_price_amount:'100000.00',payment_amount:'0.00'}}:{},refunded?[item(id(8),1,{order_status:'C40',status_code:'C2',status_text:'취소완료'}),item(id(8),2,{order_status:'C40',status_code:'C2',status_text:'취소완료'})]:undefined),
  order(id(9),d),
  // Returned; only the order carries the confirmation date.
  order(id(10),d,refunded?{canceled:'T',return_confirmed_date:returned,actual_order_amount:{order_price_amount:'100000.00',payment_amount:'0.00'}}:{},refunded?[item(id(10),1,{order_status:'R40',status_code:'C3',status_text:'반품완료'}),item(id(10),2,{order_status:'R40',status_code:'C3',status_text:'반품완료'})]:undefined)
 ];
}
const acquisition=(since)=>{const id=n=>`${since.replaceAll('-','')}-${String(n).padStart(7,'0')}`,d=day(since,1);const r=(n,ad,medium,content)=>({order_id:id(n),order_date:`${d} 12:00:00`,ad,medium,campaign:'C',content,keyword:'',order_amount:100000,member_id:'member_secret',ip:'203.0.113.7',device_type:'mobile'});
 return [r(1,'ig','paid','111'),r(2,'ig','paid','Ad Two'),r(3,'ig','paid','999'),r(4,'ig','paid','111'),r(5,'ig','paid','111'),r(6,'ig','paid','111'),r(8,'ig','paid','111'),r(10,'ig','paid','111')];};
const codes=['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'];
const COMPLETE={kind:'x',completeness:'COMPLETE',reasons:[]};
// Raw results shaped exactly like the three scheduler fetchers return them.
const raw=phase=>({
 actual:async(s,u)=>({source:'cafe24_inflow_queries',orders:week(s,phase).filter(o=>o.order_id.endsWith('-0000009')).map(o=>({...o,_metaTrackingCode:'meta_adv_catalog'})),trackingQueries:codes.map(code=>({code,ok:true,complete:true,count:code==='meta_adv_catalog'?1:0,coverage:COMPLETE})),analyticsOrders:week(s,phase),analyticsOrdersComplete:true,analyticsOrdersCoverage:COMPLETE,coverage:COMPLETE}),
 analytics:async(s,u)=>({ok:true,statusCode:200,request:{startDate:s,endDate:u,orderId:null},coverage:COMPLETE,data:{orderdetails:acquisition(s),total_count:8,paging:{next:null}}}),
 refund:async(s,u)=>({orders:week(s,phase),coverage:COMPLETE})
});
const viaRoute=phase=>{const r=raw(phase);return Object.fromEntries(Object.entries(r).map(([k,f])=>[k,async(...a)=>JSON.parse(JSON.stringify(minimizeCafe24Source(k,await f(...a))))]));};

function harness({now=at('2026-10-21T03:00:00Z'),running=false,fetchers}={}){
 const sent=[],calls=[];
 const fx=fetchers||{actual:async(...a)=>{calls.push(['actual',...a]);return (await raw('kept').actual(...a));},analytics:async(...a)=>{calls.push(['analytics',...a]);return raw('kept').analytics(...a);},refund:async(...a)=>{calls.push(['refund',...a]);return raw('kept').refund(...a);}};
 let clock=now;
 const h=createMetaWeeklyCafe24SourceHandler({authorized:req=>req.headers.authorization==='Basic ok',json:(res,body,status=200)=>sent.push({status,body}),fetchers:fx,isReportRunning:()=>running,now:()=>clock()});
 const run=async(query='kind=actual&since=2026-10-13&until=2026-10-19',{method='GET',auth=true}={})=>{await h({method,headers:auth?{authorization:'Basic ok'}:{}},{},q(query));return sent.at(-1);};
 return {run,calls,sent,setNow:f=>{clock=f;}};
}

test('auth required (401) and GET only (405); no fetch happens',async()=>{
 const h=harness();
 assert.equal((await h.run(undefined,{auth:false})).status,401);
 assert.equal((await h.run(undefined,{method:'POST'})).status,405);
 assert.equal(h.calls.length,0);
});

test('only finished 7-day periods within the kind limit are accepted (400)',async()=>{
 const bad=[['kind=orders&since=2026-10-13&until=2026-10-19','invalid_kind'],['since=2026-10-13&until=2026-10-19','invalid_kind'],
  ['kind=actual&since=2026-02-30&until=2026-03-06','invalid_date'],['kind=actual&since=2026-10-13','invalid_date'],['kind=actual&since=20261013&until=20261019','invalid_date'],
  ['kind=actual&since=2026-10-13&until=2026-10-20','period_must_be_7_days'],['kind=actual&since=2026-10-19&until=2026-10-13','period_must_be_7_days'],
  ['kind=actual&since=2026-10-15&until=2026-10-21','period_not_finished'],['kind=refund&since=2026-10-20&until=2026-10-26','period_not_finished'],
  ['kind=actual&since=2026-09-15&until=2026-09-21','period_too_old'],['kind=analytics&since=2026-09-15&until=2026-09-21','period_too_old'],['kind=refund&since=2026-08-17&until=2026-08-23','period_too_old']];
 for(const [query,error] of bad){const h=harness();const r=await h.run(query);assert.deepEqual([r.status,r.body.error],[400,error],query);assert.equal(h.calls.length,0);}
 // Boundaries: 35 days for actual/analytics, 63 for refund (the 8 issued weeks the tracker re-reads).
 assert.equal(validateCafe24SourceQuery(q('kind=actual&since=2026-09-16&until=2026-09-22').searchParams,WED).kind,'actual');
 assert.equal(validateCafe24SourceQuery(q('kind=refund&since=2026-08-19&until=2026-08-25').searchParams,WED).kind,'refund');
 assert.equal(validateCafe24SourceQuery(q('kind=refund&since=2026-08-18&until=2026-08-24').searchParams,WED).error,'period_too_old');
 assert.equal(validateCafe24SourceQuery(q('kind=actual&since=2026-10-14&until=2026-10-20').searchParams,WED).kind,'actual');
});

test('Tuesday 09:50-11:00 KST and a running scheduled report are refused (503)',async()=>{
 for(const iso of ['2026-10-27T00:50:00Z','2026-10-27T00:59:59Z','2026-10-27T01:00:00Z','2026-10-27T01:59:59Z']){const h=harness({now:at(iso)});const r=await h.run('kind=actual&since=2026-10-13&until=2026-10-19');assert.deepEqual([r.status,r.body.error],[503,'meta_weekly_report_window'],iso);assert.equal(h.calls.length,0);}
 for(const iso of ['2026-10-27T00:49:59Z','2026-10-27T02:00:00Z','2026-10-26T00:55:00Z','2026-10-28T01:30:00Z'])assert.equal(inMetaWeeklyWindow(new Date(iso)),false,iso);
 const h=harness({running:true});assert.equal((await h.run()).status,503);assert.equal(h.calls.length,0);
});

test('one call at a time and at least 10 s apart (429)',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const h=harness({fetchers:{actual:async()=>{await gate;return raw('kept').actual('2026-10-13','2026-10-19');},analytics:async()=>({}),refund:async()=>({})}});
 const first=h.run();
 assert.equal((await h.run('kind=refund&since=2026-10-13&until=2026-10-19')).status,429);
 release();assert.equal((await first).status,200);
 assert.equal((await h.run()).status,429);
 h.setNow(at('2026-10-21T03:00:10Z'));assert.equal((await h.run()).status,200);
});

test('each kind calls its scheduler fetcher with the scheduler arguments; failures leak no detail (502)',async()=>{
 for(const kind of ['actual','analytics','refund']){const h=harness();const r=await h.run(`kind=${kind}&since=2026-10-06&until=2026-10-12`);assert.equal(r.status,200);assert.deepEqual(h.calls,[[kind,'2026-10-06','2026-10-12']]);assert.deepEqual([r.body.kind,r.body.since,r.body.until],[kind,'2026-10-06','2026-10-12']);}
 const h=harness({fetchers:{actual:async()=>{throw Object.assign(Error('Bearer SECRET_TOKEN 010-1234-5678'),{status:500});},analytics:async()=>({}),refund:async()=>({})}});
 const r=await h.run();assert.deepEqual([r.status,r.body],[502,{ok:false,error:'cafe24_source_failed'}]);
});

// Wiring as deployed: the real isAuthorizedInternalRequest and the real handler block from server.mjs.
function wired(env,host){
 const block=slice('const metaWeeklyCafe24Source = createMetaWeeklyCafe24SourceHandler','const server = isMainModule');
 const auth=slice('function isAuthorizedInternalRequest(req)','export function isAuthorizedOperatorRequest');
 const calls=[],c={createMetaWeeklyCafe24SourceHandler,Buffer,env,host,json:(res,body,status=200)=>res.out={status,body},metaWeeklyReportScheduler:{running:false},
  fetchCafe24ActualOrdersForWeeklyReport:async(...a)=>{calls.push(['actual',...a]);return raw('kept').actual(a[0],a[1]);},fetchCafe24AnalyticsForWeeklyReport:async(...a)=>{calls.push(['analytics',...a]);return raw('kept').analytics(...a);},fetchCafe24OrdersForRefundTracking:async(...a)=>{calls.push(['refund',...a]);return raw('kept').refund(...a);}};
 runInNewContext(auth+'\n'+block.replace('const metaWeeklyCafe24Source','globalThis.metaWeeklyCafe24Source'),c);
 return {calls,block,send:async(headers={},extra={})=>{const res={};const until=day(new Date().toISOString().slice(0,10),-2);
  await c.metaWeeklyCafe24Source({method:'GET',headers,socket:{remoteAddress:'203.0.113.9'},...extra},res,q(`kind=actual&since=${day(until,-6)}&until=${until}`));return res.out;}};
}
const basic=v=>({authorization:'Basic '+Buffer.from(v).toString('base64')});
test('fail-closed auth: no credential configured means 401 even on a loopback-bound server',async()=>{
 for(const [env,host] of [[{CAFE24_PROXY_BASIC_AUTH:''},'127.0.0.1'],[{},'localhost'],[{},'127.0.0.1'],[{CAFE24_PROXY_BASIC_AUTH:''},'0.0.0.0']])
  for(const headers of [{},{host:'127.0.0.1:8787'},basic(''),basic(':'),{authorization:'Basic '}]){
   const w=wired(env,host),out=await w.send(headers);
   assert.equal(out.status,401,JSON.stringify([env,host,headers]));assert.equal(w.calls.length,0);
  }
 // Configured credential: only the exact Basic value passes, whatever the bind host or Host header.
 for(const host of ['127.0.0.1','0.0.0.0']){
  for(const headers of [{},{host:'localhost'},basic('user:wrong'),{authorization:'Bearer user:pass'}]){const w=wired({CAFE24_PROXY_BASIC_AUTH:'user:pass'},host);assert.equal((await w.send(headers)).status,401);assert.equal(w.calls.length,0);}
  if(!inMetaWeeklyWindow(new Date())){const w=wired({CAFE24_PROXY_BASIC_AUTH:'user:pass'},host);const out=await w.send(basic('user:pass'));assert.equal(out.status,200);
   const until=day(new Date().toISOString().slice(0,10),-2);assert.equal(JSON.stringify(w.calls),JSON.stringify([['actual',day(until,-6),until,{includeAnalyticsOrders:true}]]));}
 }
});

test('server wiring: route before the preview route, scheduler fetchers, no local or operator-session path',()=>{
 const {block}=wired({},'0.0.0.0');
 assert(/Boolean\(env\.CAFE24_PROXY_BASIC_AUTH\) && isAuthorizedInternalRequest\(req\)/.test(block)&&!/isLocalRequest|hasOperatorSession|isAuthorizedOperator/.test(block));
 assert(/actual: \(since, until\) => fetchCafe24ActualOrdersForWeeklyReport\(since, until, \{ includeAnalyticsOrders: true \}\),\s*analytics: fetchCafe24AnalyticsForWeeklyReport,\s*refund: fetchCafe24OrdersForRefundTracking/.test(block));
 const route=src.indexOf('pathname === "/api/reports/meta-weekly/cafe24-source"');
 assert(route>0&&route<src.indexOf('pathname === "/api/reports/weekly/run"'));
 assert.equal(src.split('/api/reports/meta-weekly/cafe24-source').length,2);
});

test('unexpected response shapes fail with a fixed code: no raw data, no partial result (502)',async()=>{
 const good={actual:await raw('kept').actual('2026-10-13','2026-10-19'),analytics:await raw('kept').analytics('2026-10-13','2026-10-19'),refund:await raw('kept').refund('2026-10-13','2026-10-19')};
 const o=good.refund.orders[0],secret={billing_name:'홍길동',member_email:'buyer@example.com'};
 const bad=[
  ['actual',null],['actual','x'],['actual',[]],['actual',{...good.actual,source:undefined}],['actual',{...good.actual,orders:{0:{...o,...secret}}}],['actual',{...good.actual,trackingQueries:'x'}],
  ['actual',{...good.actual,trackingQueries:[null]}],['actual',{...good.actual,analyticsOrders:{...secret}}],['actual',{...good.actual,analyticsOrdersComplete:'true'}],['actual',{...good.actual,coverage:undefined}],
  ['actual',{...good.actual,analyticsOrdersCoverage:'COMPLETE'}],['actual',{...good.actual,trackingQueries:[{code:'meta_ssage',ok:true,complete:true,count:{n:1}}]}],
  ['analytics',{...good.analytics,ok:false}],['analytics',{...good.analytics,data:{orderdetails:{0:{order_id:'1',...secret}}}}],['analytics',{...good.analytics,data:{orderdetails:['x']}}],
  ['analytics',{...good.analytics,data:{orderdetails:[{order_id:'1',ad:{name:'홍길동'}}]}}],['analytics',{...good.analytics,data:{...good.analytics.data,total_count:{v:1}}}],['analytics',{...good.analytics,data:null}],
  ['refund',{orders:[{...o,items:{...o.items}}],coverage:COMPLETE}],['refund',{orders:[{...o,items:[o.items[0],'x']}],coverage:COMPLETE}],['refund',{orders:[{...o,product_name:'p',items:[{...o.items[0],product_name:{v:'홍길동'}}]}],coverage:COMPLETE}],
  ['refund',{orders:[{...o,actual_order_amount:'100000'}],coverage:COMPLETE}],['refund',{orders:[{...o,payment_method:[{type:'card',holder:'홍길동'}]}],coverage:COMPLETE}],
  ['refund',{orders:[{...o,refunds:{0:{order_id:'1'}}}],coverage:COMPLETE}],['refund',{orders:[o,null],coverage:COMPLETE}],['refund',{orders:[o]}],['refund',{orders:'x',coverage:COMPLETE}]
 ];
 for(const [kind,result] of bad){
  assert.throws(()=>minimizeCafe24Source(kind,result),UnexpectedCafe24SourceShape,kind+JSON.stringify(result)?.slice(0,80));
  const h=harness({fetchers:{actual:async()=>result,analytics:async()=>result,refund:async()=>result}});
  const r=await h.run(`kind=${kind}&since=2026-10-13&until=2026-10-19`);
  assert.deepEqual([r.status,r.body],[502,{ok:false,error:'cafe24_source_unexpected_shape'}]);
 }
 assert.throws(()=>minimizeCafe24Source('orders',good.refund),UnexpectedCafe24SourceShape);
 // Unknown fields are dropped, not an error; nulls the fetchers can return stay null.
 assert.deepEqual(minimizeCafe24Source('refund',{orders:[{order_id:'1',order_date:'2026-10-07',items:null,future_field:{x:1},buyer:{name:'x'}}],coverage:COMPLETE,extra:'x'}),{orders:[{order_id:'1',order_date:'2026-10-07'}],coverage:COMPLETE});
});

test('response carries no personal field or value, only allowlisted report fields',async()=>{
 const out=JSON.stringify(Object.fromEntries(await Promise.all(Object.entries(raw('refunded')).map(async([k,f])=>[k,minimizeCafe24Source(k,await f('2026-10-06','2026-10-12'))]))));
 for(const v of PII_VALUES)assert(!out.includes(v),v);
 for(const k of [...Object.keys(PII),...Object.keys(ITEM_PII),'ip','device_type','paging','statusCode','request','total_amount_due'])assert(!out.includes(`"${k}"`),k);
 const a=minimizeCafe24Source('actual',await raw('kept').actual('2026-10-13','2026-10-19'));
 assert.deepEqual(Object.keys(a).sort(),['analyticsOrders','analyticsOrdersComplete','analyticsOrdersCoverage','coverage','orders','source','trackingQueries']);
 assert.deepEqual(Object.keys(a.analyticsOrders[0]).sort(),['actual_order_amount','canceled','initial_order_amount','items','market_id','order_date','order_id','paid','payment_date','payment_method','payment_method_name']);
 assert.deepEqual(Object.keys(a.analyticsOrders[0].items[0]).sort(),['item_no','option_value','order_item_code','order_status','product_code','product_name','product_no','product_price','quantity','status_code','status_text','variant_code']);
 // Unknown top-level fields never pass through; an allowlisted field holding an object is an error.
 assert.deepEqual(minimizeCafe24Source('refund',{orders:[{order_id:'1',order_date:'2026-10-07',items:[{product_name:'x',supplier:{name:'y'}}],future_field:'x',buyer:{name:'x'}}],coverage:COMPLETE,extra:'x'}),{orders:[{order_id:'1',order_date:'2026-10-07',items:[{product_name:'x'}]}],coverage:COMPLETE});
 assert.throws(()=>minimizeCafe24Source('refund',{orders:[{order_id:'1',items:[{product_name:{nested:'x'}}]}],coverage:COMPLETE}),UnexpectedCafe24SourceShape);
});

async function sheets(file){const w=new ExcelJS.Workbook();await w.xlsx.load(await readFile(file));const out={};for(const s of w.worksheets){out[s.name]=[];s.eachRow(r=>out[s.name].push(JSON.stringify(r.values)));}return out;}
async function publishWeeks(fetch){
 const dir=await mkdtemp(join(tmpdir(),'cafe24-source-')),results=[];
 for(const [since,phase] of [['2026-10-06','kept'],['2026-10-13','refunded'],['2026-10-20','refunded']]){
  const f=fetch(phase),tuesday=day(since,7);
  const r=await generateWeeklyMetaAdsReport({outputDir:dir,env:{},referenceDateKey:tuesday,period:{since,until:day(since,6)},onePage:true,requireCompleteData:true,now:()=>new Date(`${tuesday}T01:00:00Z`),
   fetchByLevel:async()=>level(),fetchAccountTotals:async(s,u)=>({kind:'meta_account_totals',scope:{since:s,until:u},completeness:'COMPLETE',reasons:[],observed:{},totals:TOTALS}),
   fetchAttribution:async(s,u)=>({kind:'meta_attribution_split',scope:{since:s,until:u},completeness:'COMPLETE',reasons:[],ads:{111:{click:{purchases:11,value:4054410},view:{purchases:3,value:1137660}}},totals:{click:{purchases:11,value:4054410},view:{purchases:3,value:1137660}}}),
   fetchActualOrders:(s,u,o)=>f.actual(s,u,o),fetchActualAnalytics:f.analytics,fetchRefundOrders:f.refund,saveReport:async()=>({filePath:'/no-dropbox/stub.xlsx',uploaded:false})});
  assert.equal(r.ok,true,r.error);
  const p=join(dir,'issued',`${since}_${day(since,6)}`);
  const {sha256,...manifest}=JSON.parse(await readFile(join(p,'manifest.json'),'utf8'));
  results.push({manifest,sheets:await sheets(join(p,'report.xlsx')),review:r.review,comparison:r.comparison});
 }
 return results;
}

test('report results are identical with and without the dropped fields: grades, refunds and the ledger',async()=>{
 const [direct,route]=await Promise.all([publishWeeks(raw),publishWeeks(viaRoute)]);
 assert.deepEqual(route,direct);
 const [w1,w2,w3]=direct;
 // G1 x5, tracking code x1, G2 x1 candidate (not summed), G3 x1, claim x1, payment unverified x1; canceled and organic excluded.
 const g=w2.manifest.summary.grades;
 assert.deepEqual([g.adIdCount,g.inflowCodeCount,g.adNameCandidateCount,g.unmatchedPaidCount,g.claimCount,g.paymentUnverifiedCount],[5,1,1,1,1,1]);
 assert.deepEqual(w2.manifest.candidates.map(c=>c.orderId),['20261013-0000002']);
 assert(!w2.manifest.orders.some(o=>['20261013-0000002','20261013-0000003','20261013-0000006','20261013-0000007'].includes(o.orderId)));
 // 10/06 order 1 refunded after issue: deducted once on 10/20 (previous week), shown as earlier report on 10/27.
 assert.deepEqual(w2.manifest.reportedAdjustments,[{issuedPeriod:'2026-10-06_2026-10-12',orderId:'20261006-0000001',cumulativeAdjustment:-100000,refundDate:'2026-10-19T12:27:42+09:00'},{issuedPeriod:'2026-10-06_2026-10-12',orderId:'20261006-0000008',cumulativeAdjustment:-100000,refundDate:'2026-10-18T09:00:00+09:00'},{issuedPeriod:'2026-10-06_2026-10-12',orderId:'20261006-0000010',cumulativeAdjustment:-100000,refundDate:'2026-10-19T08:00:00+09:00'}]);
 const row=(w,id)=>w.sheets.REFUND_TRACKING.map(r=>JSON.parse(r)).find(r=>r[3]===id);
 assert.deepEqual(row(w2,'20261006-0000001').slice(8,11),['REFUND_ADJUSTMENT','최초 반영',-100000]);
 assert.deepEqual(row(w3,'20261006-0000001').slice(8,11),['REFUND_ADJUSTMENT','이전 반영 (2026-10-13_2026-10-19 발행본)',0]);
 assert.deepEqual(row(w2,'20261006-0000008').slice(8,11),['REFUND_ADJUSTMENT','최초 반영',-100000]);
 assert.equal(Object.keys(w2.sheets).length,14);
 assert.equal(w1.review.result,w2.review.result);
});

test('scheduler fetchers never touch the canonical order cache; the general reader does',async()=>{
 const writes=[],reads=[],FixedDate=class extends Date{constructor(...a){super(...(a.length?a:[WED.toISOString()]))}static now(){return WED.getTime()}};
 const c={Date:FixedDate,Intl,URL,env:{CAFE24_MALL_ID:'fixture'},workDir:'/work',join,
  mkdir:async(...a)=>writes.push(['mkdir',...a]),writeFile:async(...a)=>writes.push(['writeFile',a[0]]),readCachedCafe24Orders:async(...a)=>{reads.push(a);return null;},
  ensureCafe24AccessToken:async()=>{},refreshCafe24Token:async()=>{},isCafe24InvalidToken:()=>false,attachCafe24OrderItems:async()=>{},logCafe24OrdersDebug:async()=>{},logApiError:async()=>{},
  cafe24FetchOrdersPage:async()=>({orders:week('2026-10-13','kept')}),fetchCafe24AnalyticsOrderDetails:async()=>({ok:true}),
  isCurrentMonth:()=>true,monthFromDate:d=>d.slice(0,7),summarizeCafe24Orders:()=>({}),cafe24ApiVersion:()=>'v',...coverage};
 runInNewContext([slice('async function fetchCafe24Orders(startDate','// Only the Meta weekly adapter'),slice('async function fetchCafe24WeeklyTrackingOrders','async function fallbackCafe24OrdersAfterError'),
  slice('async function cafe24GetOrders(','async function cafe24FetchOrdersPage('),slice('export async function fetchCafe24OrdersForRefundTracking','async function runMetaWeeklyReportCheck()')].join('\n').replaceAll('export ',''),c);
 const actual=await c.fetchCafe24ActualOrdersForWeeklyReport('2026-10-13','2026-10-19',{includeAnalyticsOrders:true});
 const refund=await c.fetchCafe24OrdersForRefundTracking('2026-10-13','2026-10-19');
 assert.equal(actual.analyticsOrdersComplete,true);assert.equal(refund.coverage.completeness,'COMPLETE');
 assert.deepEqual([writes,reads],[[],[]]);
 // Contrast: the general reader behind /api/cafe24/orders rewrites the period cache file.
 await c.fetchCafe24Orders('2026-10-13','2026-10-19',{limit:500,inflowPath:'meta_ssage'});
 assert.deepEqual(writes.at(-1),['writeFile','/work/cafe24-orders-2026-10-13_2026-10-19.json']);
});
