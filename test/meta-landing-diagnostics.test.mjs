import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {diagnoseAdLanding,fetchLandingDiagnostics} from '../scripts/meta-landing-diagnostics.mjs';
const link='https://samplas.co.kr/p?ghost_mall_id=meta_ssage';
test('link tracking uses exact URL query parser and does not guess from ad names',()=>{
  const row=diagnoseAdLanding({id:'a',name:'MEANTIME 착장 광고',campaign:{id:'c',name:'C'},adset:{id:'s',name:'S'},creative:{id:'cr',object_story_spec:{link_data:{link}}}});
  assert.equal(row.trackingStatus,'TRACKED');assert.deepEqual(row.ghostMallIds,['meta_ssage']);assert.equal(row.expectedTrackingCode,null);assert.equal(row.campaignId,'c');assert.equal(row.creativeId,'cr');
});
test('multiple dynamic/catalog/video destinations are deduplicated; media is excluded',()=>{
  const row=diagnoseAdLanding({creative:{object_story_spec:{video_data:{call_to_action:{value:{link}}},template_data:{link:'https://samplas.co.kr/catalog',child_attachments:[{link}]}},asset_feed_spec:{link_urls:[{website_url:'https://samplas.co.kr/dynamic?ghost_mall_id=meta_adv_image'}],images:[{url:'https://cdn.example/image.jpg'}]}}});
  assert.equal(row.destinationUrls.length,3);assert.deepEqual(row.ghostMallIds,['meta_ssage','meta_adv_image']);assert.equal(row.trackingCoverage,'PARTIAL');
});
test('absent query, wrong key, fragment, other code and invalid URL cannot be TRACKED',()=>{
  for(const value of ['https://samplas.co.kr/','https://samplas.co.kr/?x=ghost_mall_id=meta_ssage','https://samplas.co.kr/#ghost_mall_id=meta_ssage','https://samplas.co.kr/?ghost_mall_id=other'])assert.equal(diagnoseAdLanding({creative:{link_url:value}}).trackingStatus,'MISSING');
  for(const value of ['bad URL','javascript:alert(1)'])assert.equal(diagnoseAdLanding({creative:{link_url:value}}).trackingStatus,'UNRESOLVED');
});
test('url_tags compose effective destinations, decoded repeated values and macros are handled',()=>{
  const row=diagnoseAdLanding({creative:{link_url:'https://samplas.co.kr/?ghost_mall_id=meta_ssage',url_tags:'ghost_mall_id=meta_%61dv_image&utm_source=meta'}});
  assert.deepEqual(row.ghostMallIds,['meta_ssage','meta_adv_image']);
  assert.equal(diagnoseAdLanding({creative:{link_url:'https://samplas.co.kr/?ghost_mall_id=meta_{{ad.name}}'}}).trackingStatus,'MISSING');
});
test('GET reader follows all pages, rejects unsafe paging and incomplete results',async()=>{
  const calls=[];const get=async(path,params)=>{calls.push({path,params});return {data:[{id:'1',creative:{link_url:link}}],paging:{cursors:{after:'cursor'},next:'https://graph.facebook.com/v25.0/act_123/ads?after=cursor'}};};
  const result=await fetchLandingDiagnostics('act_123',async(path,params)=>params.after?{data:[{id:'2'}]}:get(path,params));
  assert.equal(result.ads.length,2);assert.equal(result.source,'meta_marketing_api');assert.equal(result.ads[1].trackingStatus,'UNRESOLVED');
  await assert.rejects(fetchLandingDiagnostics('act_123',async()=>({data:[],paging:{next:'https://evil.example/',cursors:{after:'x'}}})),/paging/i);
  await assert.rejects(fetchLandingDiagnostics('act_123',get,{maxPages:1}),/incomplete/i);
  await assert.rejects(fetchLandingDiagnostics('act_123',async()=>{throw new Error('permission denied');}),/permission denied/);
});
test('endpoint is GET-only and helper cannot issue Meta mutations',async()=>{
  const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');const helper=await readFile(new URL('../scripts/meta-landing-diagnostics.mjs',import.meta.url),'utf8');
  assert.match(server,/url.pathname === "\/api\/meta-ads\/landing-diagnostics"/);assert.match(server,/req.method !== "GET"/);
  assert(!/\bfetch\s*\(|method\s*:|graphPost|graphDelete/.test(helper));
  const start=server.indexOf('    if (url.pathname === "/api/meta-ads/landing-diagnostics")');
  const end=server.indexOf('    if (url.pathname === "/api/meta-ads/full-report")',start);
  const route=runInNewContext(`(async function(req,res,url){${server.slice(start,end)}})`,{
    fetchLandingDiagnostics:async(account,get)=>{assert.equal(account,'act_123');assert.equal(typeof get,'function');return {ok:true,ads:[]};},
    cleanAdAccountId:()=> 'act_123',graphGet:()=>{},json:(_res,body,status=200)=>({body,status}),safeErrorMessage:e=>e.message
  });
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await route({method},{},{pathname:'/api/meta-ads/landing-diagnostics'})).status,405);
  assert.equal((await route({method:'GET'},{},{pathname:'/api/meta-ads/landing-diagnostics'})).body.ok,true);
});
test('real Graph transport only reads the ads edge and never exposes credential paging URLs',async()=>{
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');const start=server.indexOf('async function graphGet(path, params = {})');const end=server.indexOf('// Meta의 paging.next',start);const requests=[];
 const get=runInNewContext(`(${server.slice(start,end).trim()})`,{URL,graphVersion:'v25.0',resolveMetaAccessToken:async()=> 'fake-test-token',fetch:async(url,options)=>{requests.push({url:String(url),method:options?.method||'GET'});return {ok:true,json:async()=>({data:[{id:'1',creative:{id:'c',object_story_spec:{link_data:{link}}}}]})};}});
 const result=await fetchLandingDiagnostics('act_123',get);assert.equal(result.ads[0].trackingStatus,'TRACKED');assert(requests.every(r=>r.method==='GET'));assert(requests.every(r=>new URL(r.url).pathname==='/v25.0/act_123/ads'));assert(!JSON.stringify(result).includes('fake-test-token'));
});
