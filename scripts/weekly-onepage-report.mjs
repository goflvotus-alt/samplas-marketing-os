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
  const c=box(s,row+1,col,to,metricPresent(k.value)?k.value:'N/A',{size:metricPresent(k.value)?21:12,bold:true,color:metricPresent(k.value)?C.ink:C.muted,height:34,bg:C.pale});c.numFmt=unitFormat(k.unit);
  box(s,row+2,col,to,k.note||'주간 실측 기준',{size:9,color:C.muted,bg:C.pale,height:24});
 });
}
function comparison(s,metrics) {
 section(s,13,'01  성과 비교  |  현재 / 직전 / 증감률 / 해석');
 const spans=[[1,2],[3,4],[5,6],[7,8],[9,12]];
 ['지표','현재','직전','증감률','주요 해석'].forEach((v,i)=>box(s,14,...spans[i],v,{bold:true,color:C.green,bg:C.pale}));
 metrics.slice(0,10).forEach((k,i)=>{
  const row=15+i;box(s,row,1,2,k.label,{size:9});const current=box(s,row,3,4,metricPresent(k.current)?k.current:'N/A',{size:10,align:'right'});current.numFmt=unitFormat(k.unit);
  const previous=box(s,row,5,6,metricPresent(k.previous)?k.previous:'N/A',{size:10,align:'right'});previous.numFmt=unitFormat(k.unit);
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
export function naverOnePage(workbook,model) {
 const s=base(workbook,model,'NAVER SEARCH ADS WEEKLY REPORT'),sum=model.summary||{},prev=model.previousSummary||{};
 cards(s,[{label:'광고비',value:sum.spend,unit:'원',note:'예산 투입 · 단독 우열 판단 불가'},{label:'클릭',value:sum.clicks,unit:'건'},{label:'CPC',value:sum.cpc,unit:'원'},{label:'전환',value:sum.conversions,unit:'건'},{label:'전환매출',value:sum.conversionValue,unit:'원'},{label:'ROAS',value:sum.roas,unit:'x',note:'플랫폼 귀속 전환 성과'}]);
 const metrics=[['광고비','spend','원'],['노출','impressions','회'],['클릭','clicks','건'],['CTR','ctr','%'],['CPC','cpc','원'],['전환','conversions','건'],['전환율','conversionRate','%'],['전환매출','conversionValue','원'],['CPA','cpa','원'],['ROAS','roas','x']].map(([label,key,unit])=>({label,current:metricPresent(sum[key])?sum[key]/(unit==='%'?100:1):null,previous:metricPresent(prev[key])?prev[key]/(unit==='%'?100:1):null,unit,inverse:['cpc','cpa'].includes(key),neutral:['spend','ctr','impressions','clicks'].includes(key),note:key==='ctr'?'클릭 효율 · 전환과 함께 판단':key==='spend'?'투입 비용 · 단독 우열 판단 불가':undefined}));
 comparison(s,metrics);
 const campaigns=model.campaigns||[],allActions=naverActions(model),scheduled=allActions.slice(0,3),top=(model.adgroups?.available?model.adgroups.rows:campaigns).slice().sort((a,b)=>(b.spend||0)-(a.spend||0));
 if(allActions.length>3)scheduled[2]={...scheduled[2],action:'광고 상품의 재고·옵션과 검색어 품질을 점검합니다. 키워드 상세는 현재 소스에서 미제공입니다.',success:'구매 가능·검색 품질 확인'};
 judgments(s,[['이번 주 판단',naverVerdict(model)],['유입 / 전환',`클릭 ${number(prev.clicks,'건')} → ${number(sum.clicks,'건')} · 전환 ${number(prev.conversions,'건')} → ${number(sum.conversions,'건')}. CTR 단독으로 확대하지 않습니다.`],['성과 단위 / 예산',`${model.adgroups?.available?'광고그룹 실측':'캠페인 fallback'} 기준. 전환 0은 추적·랜딩 확인 후 축소 검토. 소수 전환만으로 증액하지 않습니다.`],['다음 주 방향',scheduled[0]?.action||'집계와 전환 추적을 점검합니다.']]);
 const rows=top.map(r=>[r.name||r.campaignName||r.campaignId||'N/A',measured(r.spend,'원'),measured(r.impressions,'회'),measured(r.clicks,'건'),measured(metricPresent(r.ctr)?r.ctr/100:null,'%'),measured(r.cpc,'원'),measured(r.conversions,'건'),measured(metricPresent(r.conversionRate)?r.conversionRate/100:null,'%'),measured(r.conversionValue,'원'),measured(r.cpa,'원'),measured(r.roas,'x'),naverDecision(r,model)]);
 detail(s,[model.adgroups?.available?'광고그룹':'캠페인','광고비','노출','클릭','CTR','CPC','전환','전환율','전환매출','CPA','ROAS','판단'],rows);
 s.getCell('A32').value='03  브랜드 / 광고그룹 성과';
 for(let row=34;row<=41;row++)s.getRow(row).height=24;
 searchDemandTables(s,model.searchDemand);actions(s,scheduled,56,'06');
 s.pageSetup.printArea='A1:L69';
 notes(s,[`SOURCE: Naver Search Ads · 기간별 캠페인 통계 · ${model.since} – ${model.until}`,model.adgroups?.available?'광고그룹 실측 /stats. 상단 총합은 전체 캠페인 집계 그대로입니다. 그룹 이름을 임의 브랜드로 귀속하지 않습니다.':`광고그룹 조회 불가 → 실제 캠페인 fallback: ${model.adgroups?.reason||'상세 미제공'}`,'CTR·CVR는 클릭·전환 효율입니다. ROAS는 광고비 대비 전환매출 배수, CPA·CPC는 전환·클릭당 비용입니다.','전환·매출은 플랫폼 귀속 성과입니다. 실제 주문 실결제액으로 간주하지 않습니다. 0과 N/A를 구분합니다.',`상세 ${Math.min(rows.length,8)} / ${number(rows.length,'건')} 표시 (광고비순). 상단·비교 합계는 전체 캠페인 기준이며 상세 일부만 합산하지 않습니다.`,`검색 수요: ${model.searchDemand?.source||'Naver Keyword Tool 월간 검색량의 주간 Snapshot 비교'}. 광고 전환과 별개. 정확한 브랜드 키워드만 사용; <10/누락은 N/A. 수집 ${model.searchDemand?.observedAt||'N/A'} · 미확보 ${(model.searchDemand?.unavailable||[]).length}개.`],61);
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
