// Executive presentation only. No collection, attribution or source-metric changes.
import { metricPresent, change } from './weekly-report-analysis.mjs';
import { engagement, reachRate, instagramActions, instagramVerdict, naverActions, naverVerdict, naverCampaignSignal } from './weekly-report-presentation.mjs';
const C={ink:'FF17201C',green:'FF1F5D45',muted:'FF6E7772',line:'FFD7E0DB',pale:'FFF1F7F3',white:'FFFFFFFF',bad:'FFB85B5B'};
const fill=argb=>({type:'pattern',pattern:'solid',fgColor:{argb}});
export const unitFormat=unit=>unit==='%'?'#,##0.00%':unit==='x'?'#,##0.00"x"':`#,##0"${unit}"`;
const number=(v,u='')=>metricPresent(v)?`${v.toLocaleString('ko-KR',{maximumFractionDigits:2})}${u}`:'N/A';
const ratio=(v,p)=>metricPresent(v)&&metricPresent(p)&&p!==0?change(v,p):null;
function box(s,row,from,to,value,{size=10,bold=false,color=C.ink,bg,height=22,align='left'}={}) {
  if(from!==to)s.mergeCells(row,from,row,to);
  const c=s.getCell(row,from);c.value=value;c.font={name:'맑은 고딕',size,bold,color:{argb:color}};
  c.alignment={vertical:'middle',horizontal:align,wrapText:true};if(bg)c.fill=fill(bg);
  c.border={bottom:{style:'hair',color:{argb:C.line}}};s.getRow(row).height=height;return c;
}
function section(s,row,title){box(s,row,1,12,title,{bold:true,color:C.white,bg:C.ink,height:25});}
function base(workbook,model,title) {
 const s=workbook.addWorksheet('REPORT');s.columns=Array.from({length:12},()=>({width:11}));
 s.views=[{showGridLines:false,zoomScale:85}];s.properties.defaultRowHeight=21;
 // A3 portrait keeps the required detailed metrics readable on one printed page.
 s.pageSetup={orientation:'portrait',paperSize:8,fitToPage:true,fitToWidth:1,fitToHeight:1,printArea:'A1:L57',margins:{left:.25,right:.25,top:.3,bottom:.3,header:0,footer:0}};
 box(s,1,1,12,title,{size:22,bold:true,color:C.white,bg:C.ink,height:44});
 box(s,2,1,12,`SAMPLAS  |  ${model.since} – ${model.until}`,{size:11,color:C.white,bg:C.ink,height:28});
 box(s,3,1,12,`직전 동일 기간  ${model.previousSince||'N/A'} – ${model.previousUntil||'N/A'}`,{size:10,color:C.muted,height:24});
 return s;
}
function cards(s,items) {
 items.forEach((k,i)=>{
  const count=items.length>6?4:3,row=i<count?5:9,col=1+(i%count)*(12/count),to=col+12/count-1;
  box(s,row,col,to,k.label,{size:10,bold:true,color:C.green,bg:C.pale});
  const c=box(s,row+1,col,to,metricPresent(k.value)?k.value:typeof k.value==='string'?k.value:'N/A',{size:metricPresent(k.value)?21:12,bold:true,color:metricPresent(k.value)?C.ink:C.muted,height:34,bg:C.pale});c.numFmt=unitFormat(k.unit);
  box(s,row+2,col,to,k.note||'주간 실측 기준',{size:9,color:C.muted,bg:C.pale,height:24});
 });
}
function comparison(s,metrics) {
 section(s,13,'01  성과 비교  |  현재 / 직전 / 증감률 / 해석');
 const spans=[[1,2],[3,4],[5,6],[7,8],[9,12]];
 ['지표','현재','직전','증감률','주요 해석'].forEach((v,i)=>box(s,14,...spans[i],v,{bold:true,color:C.green,bg:C.pale}));
 metrics.slice(0,10).forEach((k,i)=>{
  const row=15+i;box(s,row,1,2,k.label,{size:9});const current=box(s,row,3,4,metricPresent(k.current)?k.current:typeof k.current==='string'?k.current:'N/A',{size:10,align:'right'});current.numFmt=unitFormat(k.unit);
  const previous=box(s,row,5,6,metricPresent(k.previous)?k.previous:typeof k.previous==='string'?k.previous:'N/A',{size:10,align:'right'});previous.numFmt=unitFormat(k.unit);
  const d=ratio(k.current,k.previous),positive=metricPresent(d)&&d!==0&&!k.neutral?(k.inverse?d<0:d>0):null;
  const wow=box(s,row,7,8,metricPresent(d)?d/100:'N/A',{size:10,align:'right',color:positive===null?C.muted:positive?C.green:C.bad});wow.numFmt='+#,##0.00%;-#,##0.00%;0.00%';
  box(s,row,9,12,k.note||(!metricPresent(d)?'비교 자료 부족 또는 직전 0':positive===null?'단독으로 성과 판단하지 않음':positive?'직전 대비 개선':'원인 확인 필요'),{size:9});
 });
}
function judgments(s,rows) {
 section(s,26,'02  핵심 판단');
 rows.slice(0,4).forEach(([label,text],i)=>{box(s,27+i,1,3,label,{bold:true,color:C.green,size:10,height:32});box(s,27+i,4,12,text,{size:10,height:32});});
}
function detail(s,headers,rows) {
 section(s,32,'03  상세 성과');
 const spans=headers.length===11?[[1,1],[2,2],[3,4],[5,5],[6,6],[7,7],[8,8],[9,9],[10,10],[11,11],[12,12]]:headers.map((_,i)=>[i+1,i+1]);
 headers.forEach((h,i)=>box(s,33,...spans[i],h,{bold:true,size:8,color:C.white,bg:C.green,height:32}));
 rows.slice(0,8).forEach((values,i)=>values.forEach((v,j)=>{
  const c=box(s,34+i,...spans[j],v?.value??v??'N/A',{size:9,height:34,align:j>1&&j<headers.length-1?'right':'left'});
  if(v&&typeof v==='object')c.numFmt=unitFormat(v.unit);
  if(['확대','유지'].includes(c.value))c.font={...c.font,color:{argb:C.green}};
  if(['개선','축소 검토'].includes(c.value))c.font={...c.font,color:{argb:C.bad}};
 }));
 if(!rows.length)box(s,34,1,12,'데이터 부족 — 확인된 상세 성과가 없습니다.',{color:C.muted,height:34});
}
function actions(s,rows,start=43,title='04') {
 section(s,start,`${title}  다음 액션  |  최대 3개`);
 rows.slice(0,3).forEach((a,i)=>{
  box(s,start+1+i,1,2,a.priority||'P2',{bold:true,color:C.green,height:40});
  box(s,start+1+i,3,9,a.action,{size:10,height:40});box(s,start+1+i,10,12,a.success||'다음 주 동일 지표 비교',{size:9,color:C.muted,height:40});
 });
}
function notes(s,rows,start=49) {
 section(s,start,'SOURCE / DATA NOTE');
 rows.slice(0,6).forEach((t,i)=>box(s,start+1+i,1,12,t,{size:9,color:C.muted,height:26}));
 box(s,start+8,1,12,'SAMPLAS  ·  WEEKLY REPORT',{size:9,color:C.green,height:20});
}
const measured=(v,u)=>({value:metricPresent(v)?v:'N/A',unit:u});
const kind=p=>/story|스토리/i.test(p.type||'')?'Story':/reel|릴스/i.test(p.type||'')?'Reel':'Feed';
const median=values=>{const a=values.filter(metricPresent).sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null;};
const UNKNOWN_REASONS=[[/\.(campaign|adset|ad):COVERAGE_UNKNOWN$/,'Meta 일부 광고 구매값(action_values) 미보고 · 계정 합계 대조 불가'],[/:ANALYTICS_COVERAGE_UNKNOWN$/,'Cafe24 Analytics 범위 검증 불가'],[/:ORDER_COVERAGE_UNKNOWN$/,'Cafe24 주문 범위 검증 불가'],[/^UNKNOWN_ADJUSTMENT$/,'직전 발행본 대비 설명되지 않은 금액 차이'],[/^PAYMENT_AMOUNT_UNVERIFIED$/,'정상 주문의 결제금액 0원(외부 결제 등) · 금액 미검증']];
const reasonText=codes=>[...new Set((codes||[]).map(c=>UNKNOWN_REASONS.find(([r])=>r.test(c))?.[1]||c))].join(' / ');
// Row 4 is the first-page verification banner; unverified figures are never presented as confirmed.
function verificationBanner(s,v){
 if(!v)return;
 const preview=v.mode==='preview'?'PREVIEW · 발행본 아님 · ':'';
 const text=v.result==='PASS'?`${preview}검증 PASS · Meta·Cafe24 수집 완전성 및 결제 근거 확인`:v.result==='UNKNOWN'?`${preview}미검증(UNKNOWN) · 확정 수치 아님 — ${reasonText(v.unknowns)} · 미확인 값은 0으로 대체하지 않음`:`${preview}검증 실패(FAIL) · 발행 불가 — ${(v.failures||[]).join(', ')}`;
 box(s,4,1,12,text,{size:10,bold:true,color:v.result==='PASS'?C.green:C.white,bg:v.result==='PASS'?C.pale:C.bad,height:30});
}
const orderIds=(rows,f)=>new Set((rows||[]).filter(f).map(r=>r.order_id)).size;
// Graded reports count ID-confirmed orders by matched ad; ad-name candidates are shown beside, never added.
function confirmedFor(actual,adId,g){
 if(!g)return orderIds(actual.rows,r=>r.tracking_source==='META_PAID'&&r.content_id===adId);
 const ok=orderIds(actual.rows,r=>r.attribution_grade==='G1_AD_ID'&&r.matched_ad_id===adId),cand=orderIds(actual.rows,r=>r.attribution_grade==='G2_AD_NAME'&&r.matched_ad_id===adId);
 return cand?`${ok} (+후보 ${cand})`:ok;
}
function refundLine(t){
 if(!t)return '최근 발행 환불 추적 없음';
 if(t.error)return `최근 발행 환불 추적 미검증 (${t.error})`;
 if(t.ledgerError)return `정정 장부 미검증 · 이번 반영 0건 · 미확인 차이 ${t.unknownCount}건`;
 return `최근 ${t.weeks}주 정정 최초 반영 ${t.newRefundCount}건 ${number(t.newRefundAmount,'원')} · 이전 반영 ${t.previouslyReportedCount}건 · 미확인 ${t.unknownCount}건 · 조회 실패 ${t.failedPeriods}기간`;
}
export function metaOnePage(workbook,model) {
 const s=base(workbook,model,'META ADS WEEKLY REPORT'),sum=model.summary||{},prev=model.previousSummary||{};
 verificationBanner(s,model.verification);
 const unverified=model.verification&&model.verification.result!=='PASS',metaNote=unverified?'미검증 · Meta 보고값 · 확정 아님':undefined;
 // Unverifiable Cafe24 actuals are shown as 미검증, never as a computed 0; a verified 0 stays 0.
 const reconciled=model.previousPublicationComparison,curOk=model.verification?.actual?.current!==false,prevOk=model.verification?.actual?.previous!==false,issuedOk=reconciled?.issuedVerified!==false;
 const shown=(ok,summary)=>summary&&!ok?{metaPaidOrderCount:'미검증',metaPaidRevenue:'미검증'}:summary;
 const actual=model.actualProducts,commerce=shown(curOk,actual?.available?actual.summary:null),old=reconciled?shown(issuedOk,{metaPaidOrderCount:reconciled.issuedOrderCount,metaPaidRevenue:reconciled.issuedRevenue}):shown(prevOk,model.previousActualProducts?.available?model.previousActualProducts.summary:null);
 const reconciliation=model.previousPublicationComparison;
 const g=actual?.available?actual.summary.grades:null,split=model.attribution,splitOk=split?.completeness==='COMPLETE',won=v=>number(v,'원');
 const splitNote=(k,u)=>!split?metaNote:splitOk?`클릭 ${number(split.totals.click[k],u)} · 노출 ${number(split.totals.view[k],u)}${unverified?' · 미검증':''}`:'클릭/노출 분해 미검증';
 cards(s,[{label:'광고비',value:sum.spend,unit:'원',note:metaNote},{label:'구매 · Meta 귀속',value:sum.purchases,unit:'건',note:splitNote('purchases','건')},{label:'매출 · Meta 귀속',value:sum.purchaseValue,unit:'원',note:splitNote('value','원')},{label:'ROAS · Meta 귀속',value:sum.roas,unit:'x',note:metaNote},{label:'CPA · Meta 귀속',value:sum.cpa,unit:'원',note:metaNote},{label:'CTR',value:sum.ctr,unit:'%',note:metaNote},{label:'CPC',value:sum.cpc,unit:'원',note:metaNote},g?{label:'Cafe24 광고 ID 유입 확인',value:!curOk||(g.paymentUnverifiedCount&&!g.normalCount)?'미검증':g.normalRevenue,unit:'원',note:curOk?`정상 유지 ${g.normalCount}건 · 클레임 진행 ${g.claimCount}건 ${won(g.claimRevenue)} 별도${g.paymentUnverifiedCount?` · 결제금액 미검증 ${g.paymentUnverifiedCount}건`:''} · 광고명 후보 ${g.adNameCandidateCount}건 합산 안 함`:'확인 불가 · Cafe24 Analytics/주문 범위 미검증 · 0원 아님'}:{label:'Cafe24 실제 Meta 유료 주문',value:commerce?.metaPaidRevenue,unit:'원',note:commerce?(curOk?`${unverified?'미검증 · ':''}${commerce.metaPaidOrderCount}건 · 주문번호 일치 · Meta 귀속 매출과 별도`:'확인 불가 · Cafe24 Analytics/주문 범위 미검증 · 0원 아님'):'UNAVAILABLE · 실제 주문 근거 부족'}]);
 comparison(s,[...['spend','purchases','purchaseValue','roas','cpa','ctr','cpc'].map((key,i)=>({label:['광고비','구매 · Meta','매출 · Meta','ROAS · Meta','CPA · Meta','CTR','CPC'][i],current:sum[key],previous:prev[key],unit:key==='ctr'?'%':key==='roas'?'x':key==='purchases'?'건':'원',inverse:['cpa','cpc'].includes(key),neutral:key==='spend'})),{label:'실제 유료 주문',current:commerce?.metaPaidOrderCount,previous:old?.metaPaidOrderCount,unit:'건',note:'Analytics paid 또는 검증된 inflow · 취소/중복 제외'},{label:'실제 유료 매출',current:commerce?.metaPaidRevenue,previous:old?.metaPaidRevenue,unit:'원',note:reconciliation?(reconciliation.issuedKind==='legacy_import'?'직전 = 기존 발행본(legacy_import) · 현재 재조회는 아래 별도 표시':'직전 = 발행본 · 현재 재조회는 아래 별도 표시'):'Admin Orders 실제 결제 · 플랫폼 매출과 합산 금지'},...(g?[{label:'광고명 후보',current:curOk?g.adNameCandidateCount:'미검증',previous:null,unit:'건',note:'광고명만 일치 · 후보 · 실제 매출에 합산하지 않음'}]:[])]);
 if(reconciliation){for(const cell of ['E22','E23'])if(s.getCell(cell).value==='N/A')s.getCell(cell).value='UNAVAILABLE';}
 judgments(s,[['플랫폼 성과',`Meta 귀속 구매 ${number(sum.purchases,'건')} · 매출 ${number(sum.purchaseValue,'원')} · ROAS ${number(sum.roas,'x')}`],['실제 주문 검증',reconciliation?`발행 당시 매출 ${!issuedOk?'미검증':reconciliation.issuedRevenue===null?'UNAVAILABLE':number(reconciliation.issuedRevenue,'원')} · 후속 환불 조정 ${!prevOk||!issuedOk?'미검증':reconciliation.refundAdjustment===null?'UNAVAILABLE':number(reconciliation.refundAdjustment,'원')} · 현재 기준 순매출 ${prevOk?number(reconciliation.currentRevenue,'원'):'미검증'}`:commerce?`Cafe24 확인 주문 ${curOk?commerce.metaPaidOrderCount+'건':'미검증'} · 실제 결제 ${curOk?number(commerce.metaPaidRevenue,'원'):'미검증'}`:`UNAVAILABLE — ${actual?.reason||'추적정보 부족'}`],g?['등급 · 환불',`광고 ID 유입 ${g.adIdCount}건 · 추적코드 ${g.inflowCodeCount}건 · 광고명 후보 ${g.adNameCandidateCount}건(합산 안 함) · 클레임 진행 ${g.claimCount}건 · 결제 미검증 ${g.paymentUnverifiedCount}건 / ${refundLine(model.refundTracking)}`]:['상품 근거',commerce?'ACTUAL_PRODUCTS_SOLD의 주문번호·상품·옵션·수량 참조. Analytics 금액은 실결제로 대체하지 않음.':'실제 주문 근거 없이 판매 상품을 표시하지 않음.'],['주의',`광고별 상위 8개만 아래 표시 · 전체 ${model.ads?.length||0}개는 CREATIVE_AD 시트 · 실제 주문 커버리지와 Meta 귀속 수치는 다름.`]]);
 detail(s,['광고 ID','캠페인','광고명','광고비','구매','귀속매출','ROAS','CPA','CTR','CPC','확인주문'],[...(model.ads||[])].sort((a,b)=>(b.spend||0)-(a.spend||0)).map(row=>[String(row.adId||''),String(row.campaignName||''),String(row.adName||''),measured(row.spend,'원'),measured(row.purchases,'건'),measured(row.purchaseValue,'원'),measured(row.roas,'x'),measured(row.cpa,'원'),measured(row.ctr,'%'),measured(row.cpc,'원'),commerce?confirmedFor(actual,row.adId,g):'N/A']));
 for(let row=34;row<=41;row++){s.getRow(row).height=60;s.getRow(row).eachCell(cell=>{cell.font={...cell.font,size:8};});}
 actions(s,[{priority:'P1',action:'Analytics ig/paid와 Admin order_id 일치 주문을 지속 검증',success:'추적 누락·미매칭 분리'},{priority:'P1',action:'기존 ghost_mall_id 필터와 Analytics 유료 주문을 중복 없이 비교',success:'동일 주문 결제 1회 집계'},{priority:'P2',action:'광고 판단은 Meta 성과와 확인된 실제 주문 근거를 별도 확인',success:'귀속 매출 혼합 금지'}]);
 notes(s,['Meta Marketing API Insights · source-metric 그대로 사용','Cafe24 Analytics: 유입 근거만 사용 / Admin Orders: 상품 및 실결제 근거','동일 주문번호 결제 1회 · canonical 취소/환불 및 부분취소 규칙 유지',g?'광고 ID 유입 = Cafe24 Analytics 광고 ID 기록 · Meta 개별 구매와 1:1 아님 · 노출 구매는 주문 연결 불가 · META_ATTRIBUTION/REFUND_TRACKING 시트':'기존 공통 REPORT 1페이지 레이아웃 재사용 · 상세 시트 별도 유지','현재/비교 기간은 KST 날짜 범위 · 자동 리포트는 완료된 화~월 7일과 직전 7일 비교','확인된 주문만 표시 · 미추적 주문을 광고 주문으로 추정하지 않음']);
 return s;
}
export function instagramDecision(post,posts) {
 if(kind(post)==='Story'||post.unavailableReason)return '관찰';
 const er=reachRate(engagement(post),post.reach),sr=reachRate(post.saves,post.reach),sh=reachRate(post.shares,post.reach);
 if(![er,sr,sh].every(metricPresent))return '관찰';
 const peers=posts.filter(p=>kind(p)===kind(post)&&!p.unavailableReason&&[reachRate(engagement(p),p.reach),reachRate(p.saves,p.reach),reachRate(p.shares,p.reach)].every(metricPresent));
 if(!post.saves&&!post.shares&&!engagement(post)&&post.views>0)return '개선';
 if(peers.length<2)return '관찰';
 const em=median(peers.map(p=>reachRate(engagement(p),p.reach))),sm=median(peers.map(p=>reachRate(p.saves,p.reach))),hm=median(peers.map(p=>reachRate(p.shares,p.reach)));
 if(kind(post)==='Reel') {
  if(!metricPresent(post.views)||!metricPresent(post.reach))return '관찰';
  const vm=median(peers.map(p=>p.views)),rm=median(peers.map(p=>p.reach));
  if(post.views>vm&&post.reach>rm&&post.saves>0&&post.shares>0&&er>=em)return '확대';
  if(post.views<vm&&post.reach<rm&&er<em)return '개선';
  return post.saves>0&&post.shares>0?'유지':'관찰';
 }
 if(sr>sm&&sh>hm&&er>=em&&post.saves>0&&post.shares>0)return '확대';
 if(sr<sm&&sh<hm&&er<em)return '개선';
 return post.saves>0||post.shares>0?'유지':'관찰';
}
export function naverDecision(row,model) {
 if(!metricPresent(row.conversions)||!metricPresent(row.spend))return '관찰';
 if(row.spend>0&&row.conversions===0)return '축소 검토';
 const signal=naverCampaignSignal(row,model);
 if(signal==='ACTION REQUIRED'||signal==='WATCH')return '관찰';
 // A week of attributed conversions is not proof of stable volume; no automatic scaling.
 return row.conversions>0?'유지':'관찰';
}
export function instagramOnePage(workbook,model) {
 const s=base(workbook,model,'INSTAGRAM WEEKLY REPORT'),sum=model.summary||{},prev=model.previousSummary||{};
 const current=model.accountWeekly||{},prior=model.previousAccountWeekly||{},followers=model.followerSnapshot||{};
 const note='보고서 생성 시점 followers_count';
 cards(s,[{label:'팔로워 · 현재',value:followers.followers,unit:'명',note},{label:'도달 · 계정 고유',value:model.weeklyUniqueReach,unit:'명',note:'요청 주간 total_value · 합산 금지'},{label:'조회수 · 주간',value:current.views,unit:'회',note:'계정 views · 노출과 구분'},{label:'프로필 방문 · 주간',value:current.profile_views,unit:'회'},{label:'링크 클릭 · 주간',value:current.website_clicks,unit:'회'},{label:'참여 · 게시물 합계',value:sum.engagement,unit:'건',note:'해당 기간 발행 콘텐츠 기준'}]);
 comparison(s,[{label:'팔로워 · 수집시점',current:followers.current?.followers??followers.followers,previous:followers.previous?.followers,unit:'명',note},{label:'팔로워 증감',current:followers.delta,previous:null,unit:'명',note:followers.reason||'비교 가능한 주간 Snapshot 없음'},{label:'계정 고유 도달',current:model.weeklyUniqueReach,previous:prior.reach,unit:'명',note:'주간 total_value만 사용 · 일별/게시물 합산 금지'},{label:'조회수',current:current.views,previous:prior.views,unit:'회',note:'계정 주간 views · 노출 아님'},{label:'프로필 방문',current:current.profile_views,previous:prior.profile_views,unit:'회'},{label:'링크 클릭',current:current.website_clicks,previous:prior.website_clicks,unit:'회'},{label:'참여 합계',current:sum.engagement,previous:prev.engagement,unit:'건'},{label:'콘텐츠 조회 합계',current:sum.views,previous:prev.views,unit:'회'},{label:'저장',current:sum.saves,previous:prev.saves,unit:'건'},{label:'공유',current:sum.shares,previous:prev.shares,unit:'건'}]);
 const posts=model.content||[],judged=posts.map(p=>({post:p,decision:instagramDecision(p,posts)}));
 const best=judged.find(x=>x.decision==='확대')||judged.filter(x=>x.decision==='유지').sort((a,b)=>(reachRate(engagement(b.post),b.post.reach)||0)-(reachRate(engagement(a.post),a.post.reach)||0))[0];
 const low=judged.find(x=>x.decision==='개선');
 const scheduled=instagramActions(model).slice(0,3);
 const typeCounts=source=>!model.ok?'데이터 부족':['Feed','Reel'].map(t=>`${t} ${source.filter(p=>kind(p)===t).length}건`).join(' / ');
 const oldFormat=Array.isArray(model.previousContent)?typeCounts(model.previousContent):'데이터 부족';
 judgments(s,[['이번 주 판단',instagramVerdict(model)],['우수 / 개선 콘텐츠',`${best?`${best.post.title||best.post.id}: ${best.decision} (반응·포맷 내 비교)`:'우수 판단 자료 부족'} / ${low?`${low.post.title||low.post.id}: 개선`:'명확한 저성과 판단 없음'}`],['포맷 변화',`현재 ${typeCounts(posts)} · 직전 ${oldFormat}. Story는 확보된 기록만 해석.`],['다음 주 방향',scheduled[0]?.action||'측정 자료를 확인한 뒤 콘텐츠 변수 하나를 테스트합니다.']]);
 const seen=new Set(posts.map(p=>String(p.id))),stories=(model.stories||[]).filter(p=>!seen.has(String(p.id))).map(p=>({...p,type:'Story',title:p.title||p.caption||'Story',date:String(p.date||p.timestamp||'').slice(0,10)}));
 const rows=[...posts,...stories].slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(p=>{
  const missing=!!p.unavailableReason,story=kind(p)==='Story',value=k=>missing?null:p[k];
  return [p.date||'N/A',kind(p),p.title||p.id||'N/A',measured(value('reach'),'명'),measured(value('views'),'회'),measured(story?null:p.likes,'건'),measured(story?null:p.comments,'건'),measured(value('saves'),'건'),measured(value('shares'),'건'),measured(missing?null:reachRate(engagement(p),p.reach),'%'),instagramDecision(p,posts)];
 });
 detail(s,['게시일','종류','콘텐츠명','도달','조회','좋아요','댓글','저장','공유','참여율','판단'],rows);actions(s,scheduled);
 notes(s,[`SOURCE: Instagram Graph API · 기간별 콘텐츠 (캐시 기준) · ${model.since} – ${model.until}`,`계정 지표: 요청 주간 Graph total_value. 팔로워: ${note} · ${followers.reason||'현재 수집 기록 없음'}. ${Object.entries(current.reasons||{}).map(([k,v])=>`${k}: ${v}`).join(' / ')}`,`게시물 Reach 합계 ${number(sum.reach,'명')}은 중복 포함 수치입니다. 계정 주간 고유 도달로 사용하거나 합산 비교하지 않습니다.`,`참여율 = 실제 참여 ÷ 해당 콘텐츠 도달. 도달 0·누락 시 N/A. Story ${model.stories===null?'주간 기록 미제공 (데이터 부족).':'확보 기록만 표시 · 전체 기간 coverage 불완전.'}`,`상세 ${Math.min(rows.length,8)} / ${number(rows.length,'건')} 표시 (날짜순). 확대는 동일 포맷 내 실측 반응을 확인한 콘텐츠 반복 테스트입니다.`,'콘텐츠별 프로필 방문·팔로우 기여는 미측정이므로 제외했습니다. 0은 실측값, N/A는 미제공입니다.']);
 return s;
}
// Row 4 banner: PASS only when campaign and adgroup sections both verified; otherwise PARTIAL with the section reason.
function naverBanner(s,review){
 if(!review)return;
 const issue=review.issues[0],label={FAILED:'검증 실패',PARTIAL:'부분 확인',UNAVAILABLE:'조회 불가'}[issue?.status];
 const text=review.result==='PASS'?'검증 PASS · 캠페인·광고그룹 통계 대조 완료':`PARTIAL · 캠페인 성과 검증 완료 · 광고그룹 상세 ${label} — ${issue.detail}`;
 box(s,4,1,12,text,{size:10,bold:true,color:review.result==='PASS'?C.green:C.white,bg:review.result==='PASS'?C.pale:C.bad,height:30});
}
export function naverOnePage(workbook,model) {
 const s=base(workbook,model,'NAVER SEARCH ADS WEEKLY REPORT'),sum=model.summary||{},prev=model.previousSummary||{};
 cards(s,[{label:'광고비',value:sum.spend,unit:'원',note:'예산 투입 · 단독 우열 판단 불가'},{label:'클릭',value:sum.clicks,unit:'건'},{label:'CPC',value:sum.cpc,unit:'원'},{label:'전환',value:sum.conversions,unit:'건'},{label:'전환매출',value:sum.conversionValue,unit:'원'},{label:'ROAS',value:sum.roas,unit:'x',note:'플랫폼 귀속 전환 성과'}]);
 const metrics=[['광고비','spend','원'],['노출','impressions','회'],['클릭','clicks','건'],['CTR','ctr','%'],['CPC','cpc','원'],['전환','conversions','건'],['전환율','conversionRate','%'],['전환매출','conversionValue','원'],['CPA','cpa','원'],['ROAS','roas','x']].map(([label,key,unit])=>({label,current:metricPresent(sum[key])?sum[key]/(unit==='%'?100:1):null,previous:metricPresent(prev[key])?prev[key]/(unit==='%'?100:1):null,unit,inverse:['cpc','cpa'].includes(key),neutral:['spend','ctr','impressions','clicks'].includes(key),note:key==='ctr'?'클릭 효율 · 전환과 함께 판단':key==='spend'?'투입 비용 · 단독 우열 판단 불가':undefined}));
 comparison(s,metrics);
 naverBanner(s,model.review);
 const campaigns=model.campaigns||[],allActions=naverActions(model),scheduled=allActions.slice(0,3),top=(model.adgroups?.available?model.adgroups.rows:campaigns).slice().sort((a,b)=>(b.spend||0)-(a.spend||0));
 if(allActions.length>3)scheduled[2]={...scheduled[2],action:'광고 상품의 재고·옵션과 검색어 품질을 점검합니다. 키워드 상세는 현재 소스에서 미제공입니다.',success:'구매 가능·검색 품질 확인'};
 judgments(s,[['이번 주 판단',naverVerdict(model)],['유입 / 전환',`클릭 ${number(prev.clicks,'건')} → ${number(sum.clicks,'건')} · 전환 ${number(prev.conversions,'건')} → ${number(sum.conversions,'건')}. CTR 단독으로 확대하지 않습니다.`],['성과 단위 / 예산',`${model.adgroups?.available?'광고그룹 실측':'캠페인 fallback'} 기준. 전환 0은 추적·랜딩 확인 후 축소 검토. 소수 전환만으로 증액하지 않습니다.`],['다음 주 방향',scheduled[0]?.action||'집계와 전환 추적을 점검합니다.']]);
 const rows=top.map(r=>[r.canonicalBrandName||r.name||r.campaignName||r.campaignId||'N/A',measured(r.spend,'원'),measured(r.impressions,'회'),measured(r.clicks,'건'),measured(metricPresent(r.ctr)?r.ctr/100:null,'%'),measured(r.cpc,'원'),measured(r.conversions,'건'),measured(metricPresent(r.conversionRate)?r.conversionRate/100:null,'%'),measured(r.conversionValue,'원'),measured(r.cpa,'원'),measured(r.roas,'x'),r.statsAvailable===false?'데이터 부족':naverDecision(r,model)]);
 detail(s,[model.adgroups?.available?'광고그룹':'캠페인','광고비','노출','클릭','CTR','CPC','전환','전환율','전환매출','CPA','ROAS','판단'],rows);
 s.getCell('A32').value=model.adgroups?.verification==='FAILED'?'03  광고그룹 상세 · 검증 실패 — 아래는 검증된 캠페인 성과':'03  브랜드 / 광고그룹 성과';
 for(let row=34;row<=41;row++)s.getRow(row).height=24;
 searchDemandTables(s,model.searchDemand);actions(s,scheduled,56,'06');
 s.pageSetup.printArea='A1:L69';
 notes(s,[`SOURCE: Naver Search Ads · 기간별 캠페인 통계 · ${model.since} – ${model.until}`,model.adgroups?.available?`SOURCE: /ncc/adgroups + 광고그룹 ID별 /stats. 실측 ${model.adgroups.coverage?.successful??0}/${model.adgroups.coverage?.total??rows.length} · N/A ${model.adgroups.coverage?.unavailable??0}. 정확히 resolve된 canonical 이름만 표시.`:`${model.adgroups?.verification==='FAILED'?'광고그룹 검증 실패 → 검증된 캠페인 fallback':'광고그룹 조회 불가 → 실제 캠페인 fallback'}: ${model.adgroups?.reason||'상세 미제공'}`,'CTR·CVR는 클릭·전환 효율입니다. ROAS는 광고비 대비 전환매출 배수, CPA·CPC는 전환·클릭당 비용입니다.','전환·매출은 플랫폼 귀속 성과입니다. 실제 주문 실결제액으로 간주하지 않습니다. 0과 N/A를 구분합니다.',`상세 ${Math.min(rows.length,8)} / ${number(rows.length,'건')} 표시. 전체 광고그룹 확인 금액 ${number(model.adgroups.coverage?.knownSpend,'원')} / 캠페인 ${number(sum.spend,'원')} · 미확인 차액 ${number(model.adgroups.coverage?.difference,'원')}. 누락은 0으로 대체하지 않습니다.`,`검색 수요: ${model.searchDemand?.source||'Naver Keyword Tool 월간 검색량의 주간 Snapshot 비교'}. 광고 전환과 별개. 정확한 브랜드 키워드만 사용; <10/누락은 N/A. 수집 ${model.searchDemand?.observedAt||'N/A'} · 미확보 ${(model.searchDemand?.unavailable||[]).length}개.`],61);
 return s;
}

function searchDemandTables(s,demand={}) {
 box(s,43,1,6,'04  검색 수요 TOP 10 · 월간 검색량 Snapshot',{bold:true,size:9,color:C.white,bg:C.ink,height:34});
 box(s,43,7,12,'05  검색 수요 급상승 TOP 5 · 주간 Snapshot 비교',{bold:true,size:9,color:C.white,bg:C.ink,height:34});
 ['순위','브랜드','브랜드','PC','Mobile','합계','순위','브랜드','직전','현재','증가','증감률'].forEach((v,i)=>{if(i===2)return;if(i===1){box(s,44,2,3,v,{size:8,bold:true,bg:C.pale,height:25});return;}box(s,44,i+1,i+1,v,{size:8,bold:true,bg:C.pale,height:25});});
 const top=demand.top10||[],rising=demand.rising5||[];
 top.forEach((r,i)=>{
  const row=45+i;box(s,row,1,1,i+1,{size:8,height:22}).numFmt='#,##0';box(s,row,2,3,r.name,{size:9,height:22});
  [r.pc,r.mobile,r.total].forEach((v,j)=>{const c=box(s,row,4+j,4+j,metricPresent(v)?v:'N/A',{size:9,height:22,align:'right'});c.numFmt=unitFormat('회');});
 });
 rising.forEach((r,i)=>{
  const row=45+i;[i+1,r.name,r.previous,r.total,r.increase,metricPresent(r.growth)?r.growth/100:'NEW / 기준 없음'].forEach((v,j)=>{const c=box(s,row,7+j,7+j,v,{size:8,height:28,align:j>1?'right':'left'});if(j===0)c.numFmt='#,##0';if(j>=2)c.numFmt=j===5?'#,##0.00%':unitFormat('회');});
 });
 if(!top.length)box(s,45,1,6,demand.reason||'이번 주 정확한 브랜드 Snapshot 없음',{size:9,color:C.muted,height:28});
 if(!rising.length)box(s,45,7,12,'직전 비교 가능 Snapshot 또는 상승 브랜드 없음',{size:9,color:C.muted,height:28});
 box(s,52,7,12,'월간 검색 수요를 주간 수집한 비교입니다. 실제 주간 검색량이 아닙니다.',{size:8,color:C.muted,height:22});
}
