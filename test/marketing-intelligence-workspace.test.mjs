import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../outputs/marketing-intelligence-entry.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fail=false){
 const registry=new Map(),handlers=new Map();
 function classes(){const set=new Set();return {add:v=>set.add(v),remove:v=>set.delete(v),contains:v=>set.has(v)}}
 function el(id){
  if(registry.has(id))return registry.get(id);
  const n={id,style:{},attributes:{},children:[],textContent:'',classList:classes(),events:{},_html:'',
   setAttribute(k,v){this.attributes[k]=v},
   getAttribute(k){return this.attributes[k]},
   appendChild(child){this.children.push(child);if(child.id)registry.set(child.id,child)},
   insertAdjacentElement(_where,child){nav.children.push(child)},
   querySelector(q){return q.includes('data-marketing-intelligence-entry')?this.children.find(x=>x.attributes?.['data-marketing-intelligence-entry']):null},
   querySelectorAll(){return[]},
   addEventListener(type,fn){this.events[type]=fn},
   set innerHTML(v){this._html=v;if(id==='MarketingIntelligenceAction')for(const key of ['miBody','miReload','miStatus'])el(key)},
   get innerHTML(){return this._html},
  };registry.set(id,n);return n;
 }
 const nav=el('nav'),main=el('main'),head=el('head'),topbar=el('topbarTitle');
 nav.children.push(Object.assign(el('content-nav'),{textContent:'Content'}));
 let requests=0;
 const fetch=async url=>{
  requests++;
  if(fail)return {ok:false,status:503};
  const prev=url.includes('2025-');
  let data={};
  if(url.includes('monthly'))data={total:{amount:prev?110000:100000},newMembers:{members:prev?45:21},repeatMembers:{amount:prev?60000:45000},unverifiedMembers:{members:3}};
  else if(url.includes('acquisition'))data={firstPurchaseChannels:[{channel:'naver',members:null}]};
  else if(url.includes('data-quality'))data={closeStatus:'NOT_FINAL',history:{gaps:[{since:'2026-05-31'}]},issues:['POST_SNAPSHOT_CANCELS_UNVERIFIED']};
  else data={cohorts:[{month:'2026-07',cells:[{window:30,status:'IMMATURE',rate:null}]}]};
  return {ok:true,json:async()=>({ok:true,data,meta:{completeness:'PARTIAL'}})};
 };
 const doc={readyState:'complete',head,getElementById:id=>registry.get(id)||null,createElement:()=>({style:{},attributes:{},classList:classes(),setAttribute(k,v){this.attributes[k]=v},addEventListener(type,fn){this.events??={};this.events[type]=fn},textContent:''}),
  querySelector:q=>q==='main.main'?main:null,querySelectorAll:()=>[],addEventListener:(type,fn)=>handlers.set(type,fn)};
 vm.runInNewContext(code,{document:doc,fetch,location:{hash:''},MutationObserver:class{observe(){}},Intl,Date,Array,Math,Number,String,Set,Promise,Error});
 const link=nav.children.find(x=>x.attributes?.['data-marketing-intelligence-entry']);
 const click=()=>handlers.get('click')({target:{closest:q=>q.includes('data-marketing-intelligence-entry')?link:null},preventDefault(){}});
 return {el,nav,main,topbar,link,click,requests:()=>requests};
}
test('Marketing Intelligence is a local OS panel, not external navigation',()=>{
 const h=harness();assert.equal(h.link.href,'#marketing-intelligence');
 h.click();assert.equal(h.el('MarketingIntelligenceAction').classList.contains('active'),true);
 assert.equal(h.topbar.textContent,'Marketing Intelligence');
 assert.equal(h.main.classList.contains('mi-marketing-mode'),true);
});
test('partial CRM produces readable actions, never seventy raw diagnostics',async()=>{
 const h=harness();h.click();for(let i=0;i<30&&!h.el('miBody').innerHTML;i++)await flush();
 const body=h.el('miBody').innerHTML;
 assert.match(body,/다음 달 우선 실행 과제/);
 assert.match(body,/신규 구매 확인 회원/);
 assert.match(body,/재구매 회원 매출/);
 assert.match(body,/잠정/);
 assert.match(body,/데이터 신뢰도/);
 assert.doesNotMatch(body,/POST_SNAPSHOT_CANCELS_UNVERIFIED/);
 assert.doesNotMatch(body,/판단 차단 사유 70건/);
 assert.equal(h.requests(),25);
});
test('API failure does not invent revenue or customer numbers',async()=>{
 const h=harness(true);h.click();for(let i=0;i<30&&!h.el('miBody').innerHTML;i++)await flush();
 const body=h.el('miBody').innerHTML;
 assert.match(body,/확인 불가/);
 assert.match(body,/일부 데이터 조회 실패/);
 assert.doesNotMatch(body,/신규 구매 확인 회원<\/small><strong>0명/);
});
