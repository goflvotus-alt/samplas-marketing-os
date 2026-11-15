/* SAMPLAS Marketing Intelligence: integrated monthly marketing action workspace. Read only. */
(()=>{'use strict';
const ID='MarketingIntelligenceAction',MARK='data-marketing-intelligence-entry';
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR').format(n):'확인 불가';
const money=n=>Number.isFinite(n)?fmt(Math.round(n))+'원':'확인 불가';
const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?(a/b-1)*100:null;
const change=(a,b)=>{const d=delta(a,b);return d===null?'전년 비교 불가':(d>0?'+':'')+d.toFixed(1)+'%';};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={active:false,serial:0,loaded:false,loading:false};
const css=[
'#'+ID+'{max-width:1300px;color:#1b2520;padding-bottom:50px}',
'#'+ID+' h2{font-size:29px;line-height:1.3;letter-spacing:-.04em;margin:4px 0 9px}',
'#'+ID+' h3{font-size:18px;margin:0 0 11px}',
'#'+ID+' p{line-height:1.65;margin:0}',
'#'+ID+' .mi-muted{font-size:13px;color:#63756b}',
'#'+ID+' .mi-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}',
'#'+ID+' .mi-eyebrow{font-size:11px;font-weight:850;letter-spacing:.1em;color:#48765a}',
'#'+ID+' .mi-tag{display:inline-block;padding:5px 9px;background:#fff2d9;color:#926115;border-radius:8px;font-weight:800;font-size:12px}',
'#'+ID+' button{padding:9px 12px;background:white;border:1px solid #d9e0dc;border-radius:8px;cursor:pointer}',
'#'+ID+' .mi-hero{background:#1b3227;color:white;border-radius:14px;padding:24px 28px;margin:17px 0 20px}',
'#'+ID+' .mi-hero h3{font-size:25px;margin:8px 0;color:white}',
'#'+ID+' .mi-hero p{font-size:14px;color:#d5e7da}',
'#'+ID+' .mi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
'#'+ID+' .mi-kpi,#'+ID+' .mi-action,#'+ID+' .mi-panel{background:white;border:1px solid #dce5de;border-radius:12px;padding:18px;min-width:0}',
'#'+ID+' .mi-kpi small{font-size:12px;font-weight:750;color:#61736a}',
'#'+ID+' .mi-kpi strong{display:block;font-size:25px;letter-spacing:-.04em;margin:8px 0}',
'#'+ID+' .mi-kpi p{font-size:12px;color:#68766e}',
'#'+ID+' .mi-kpi b{color:#245941}',
'#'+ID+' .mi-kpi b.down{color:#b34c43}',
'#'+ID+' .mi-section{margin:25px 0 12px;display:flex;justify-content:space-between;align-items:center;gap:12px}',
'#'+ID+' .mi-action .mi-index{display:inline-block;background:#e7f2e9;color:#286a45;font-weight:800;padding:5px 8px;border-radius:7px;font-size:12px}',
'#'+ID+' .mi-action h4{font-size:17px;margin:12px 0 8px;line-height:1.45}',
'#'+ID+' .mi-action p{font-size:13px;color:#506456}',
'#'+ID+' .mi-action .mi-next{border-top:1px solid #e9eee9;margin-top:12px;padding-top:12px;font-size:12px;line-height:1.75;color:#264f36}',
'#'+ID+' .mi-duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
'#'+ID+' .mi-note{background:#f2f7f3;padding:13px;border-radius:9px;margin:10px 0;font-size:14px;line-height:1.65}',
'#'+ID+' .mi-panel p{font-size:13px;color:#56695e}',
'#'+ID+' details{border:1px solid #e1e9e2;border-radius:9px;padding:13px;margin-top:12px}',
'#'+ID+' summary{cursor:pointer;font-size:13px;font-weight:750}',
'#'+ID+' .mi-footer{color:#687b70;font-size:12px;line-height:1.7;margin-top:17px}',
'#'+ID+' .mi-loading{background:#f3f6f3;border-radius:11px;padding:48px;text-align:center;color:#6b786e}',
'#'+ID+' .mi-error{font-size:12px;color:#8b5b25}',
'.nav [data-marketing-intelligence-entry].active{background:#252d29!important;color:#fff!important;border:1px solid #496452!important}',
'@media(max-width:960px){#'+ID+' .mi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
'@media(max-width:650px){#'+ID+' .mi-grid,#'+ID+' .mi-duo{grid-template-columns:1fr}#'+ID+' .mi-head{display:block}#'+ID+' .mi-head button{margin-top:10px}#'+ID+' .mi-hero{padding:18px}#'+ID+' h2{font-size:24px}}'
].join('\n');
function mount(){
 if(!$('marketing-action-styles')){const s=document.createElement('style');s.id='marketing-action-styles';s.textContent=css;document.head.appendChild(s)}
 const nav=$('nav'),main=document.querySelector('main.main');if(!nav||!main)return;
 if(!$(ID)){
  const v=document.createElement('section');v.id=ID;v.className='view';v.setAttribute('aria-label','Marketing Intelligence');
  v.innerHTML='<div class="mi-head"><div><div class="mi-eyebrow">MARKETING INTELLIGENCE · ONLINE GROWTH</div><h2>다음 달, 온라인 매출을 어떻게 올릴까?</h2><p class="mi-muted">첫 구매와 재구매를 늘리기 위해 확인할 숫자와 실행 과제를 연결했어.</p></div><div><span class="mi-tag" id="miStatus">조회 대기</span> <button id="miReload" type="button">다시 확인</button></div></div><div id="miBody" class="mi-loading">실제 CRM 데이터를 확인하고 있어.</div>';
  main.appendChild(v);$('miReload').addEventListener('click',load);
 }
 if(!nav.querySelector('['+MARK+']')){
  const a=document.createElement('a');a.setAttribute(MARK,'yes');a.href='#marketing-intelligence';a.textContent='Marketing Intelligence';a.setAttribute('aria-label','Marketing Intelligence');
  a.style.cssText='display:block;padding:11px 14px;margin:6px 0;border:1px solid rgba(120,140,150,.25);border-radius:9px;text-decoration:none;color:inherit;font-weight:750;font-size:13px';
  const content=[...nav.querySelectorAll('button,a')].find(x=>x.textContent.trim()==='Content');
  content?content.insertAdjacentElement('afterend',a):nav.appendChild(a);
 }
}
function enter(){
 mount();state.active=true;
 document.querySelectorAll('main .view.active').forEach(e=>e.classList.remove('active'));
 $(ID)?.classList.add('active');
 $('nav')?.querySelectorAll('.active').forEach(e=>e.classList.remove('active'));
 $('nav')?.querySelector('['+MARK+']')?.classList.add('active');
 if($('topbarTitle'))$('topbarTitle').textContent='Marketing Intelligence';
 if(!state.loading&&!state.loaded)load();
}
function leave(){state.active=false;$(ID)?.classList.remove('active');$('nav')?.querySelector('['+MARK+']')?.classList.remove('active')}
async function get(url){
 const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('HTTP '+r.status);
 const raw=await r.json();if(!raw||raw.ok===false)throw Error('API unavailable');
 const d=raw.data??raw.structuredContent?.data??raw;if(!d||typeof d!=='object')throw Error('Missing data');
 return {...d,__meta:raw.meta??raw.structuredContent?.meta??null};
}
const prev=m=>String(Number(m.slice(0,4))-1)+m.slice(4);
const sum=(list,key)=>list.length&&list.every(x=>x&&Number.isFinite(x[key]))?list.reduce((a,x)=>a+x[key],0):null;
const row=(month,x)=>x?{month,amount:x.total?.amount,new:x.newMembers?.members,repeat:x.repeatMembers?.amount,unknown:x.unverifiedMembers?.members,meta:x.__meta}:null;
function metric(title,value,then,description,negative){
 return '<article class="mi-kpi"><small>'+esc(title)+'</small><strong>'+esc(value)+'</strong><p><b'+(negative?' class="down"':'')+'>'+esc(then)+'</b></p><p>'+esc(description)+'</p></article>';
}
function task(num,title,signal,step,kpi){
 return '<article class="mi-action"><span class="mi-index">'+num+'</span><h4>'+esc(title)+'</h4><p>'+esc(signal)+'</p><div class="mi-next"><b>다음 달 할 일</b><div>'+esc(step)+'</div><b>성과를 판단할 기준</b><div>'+esc(kpi)+'</div></div></article>';
}
async function load(){
 if(!$('miBody'))return;const token=++state.serial;state.loaded=false;state.loading=true;
 $('miStatus').textContent='조회 중';$('miBody').className='mi-loading';$('miBody').textContent='신규 고객과 재구매 데이터를 비교하는 중이야.';
 const months=['2026-07','2026-08','2026-09','2026-10'];
 const urls=[...months.map(m=>'/api/crm/monthly?month='+m),...months.map(m=>'/api/crm/monthly?month='+prev(m)),...months.map(m=>'/api/crm/acquisition?month='+m),...months.map(m=>'/api/crm/data-quality?month='+m),...months.map(m=>'/api/crm/acquisition?month='+prev(m)),...months.map(m=>'/api/crm/data-quality?month='+prev(m)),'/api/crm/cohort?from=2026-07&to=2026-10&windows=30,60,90'];
 const responses=new Array(urls.length);let i=0;
 await Promise.all(Array.from({length:4},async()=>{while(i<urls.length){const n=i++;try{responses[n]={ok:true,value:await get(urls[n])}}catch(e){responses[n]={ok:false,error:e.message}}}}));
 if(token!==state.serial)return;state.loading=false;state.loaded=true;
 const group=start=>responses.slice(start,start+4).map(x=>x?.ok?x.value:null);
 const current=group(0).map((x,i)=>row(months[i],x)),previous=group(4).map((x,i)=>row(prev(months[i]),x));
 const acquisition=group(8),qualities=group(12),oldAcq=group(16),oldQuality=group(20),cohort=responses[24]?.ok?responses[24].value:null;
 const sales=sum(current,'amount'),oldSales=sum(previous,'amount'),newCount=sum(current,'new'),oldNew=sum(previous,'new'),repeat=sum(current,'repeat'),oldRepeat=sum(previous,'repeat'),unknown=sum(current,'unknown');
 const fall=delta(newCount,oldNew),repeatFall=delta(repeat,oldRepeat);
 const warnings=[...qualities,...oldQuality].flatMap(q=>{
  if(!q)return ['월별 데이터 품질 조회 누락'];let out=[];
  if(q.closeStatus!=='FINAL'&&q.closeStatus!=='CLOSED')out.push('월별 매출·고객 자료 미마감');
  if(q.__meta?.completeness!=='COMPLETE')out.push('데이터 수집 범위 확인 필요');
  if(q.history?.gaps?.length)out.push('일부 과거 구매 이력 누락');
  if(q.issues?.includes('POST_SNAPSHOT_CANCELS_UNVERIFIED'))out.push('취소 주문 검증 미완료');
  return out;
 });
 if(responses.some(x=>!x?.ok))warnings.push('일부 데이터 조회 실패');
 if(unknown===null||unknown>0)warnings.push('첫 구매 여부 미확인 회원 존재');
 const unique=[...new Set(warnings)];
 const mature=(cohort?.cohorts??[]).flatMap(c=>(c.cells??[]).filter(x=>x.window===30&&x.status==='MATURE'&&Number.isFinite(x.rate)).map(x=>c.month+' '+fmt(x.rate)+'%'));
 const title=fall!==null&&fall<=-20?'다음 달 우선순위는 신규 고객의 첫 구매를 늘리는 거야.':repeatFall!==null&&repeatFall<0?'다음 달에는 재구매를 늘릴 방법부터 점검하자.':'다음 달 매출을 늘릴 실험을 데이터로 선택하자.';
 const subtitle=fall!==null?'첫 구매 회원이 전년 같은 기간 대비 '+change(newCount,oldNew)+' 변했어. '+(unique.length?'수치는 아직 잠정치이므로 원인과 실행 전에 검증이 필요해.':'이 변화를 중심으로 실행 과제를 정리했어.'):'전년 비교값이 불충분해서 신규 고객 변화를 단정할 수 없어.';
 const html=
 '<section class="mi-hero"><div class="mi-eyebrow" style="color:#aad0b6">2026년 7~10월 vs 2025년 동일 기간 · 다음 달 전략</div><h3>'+esc(title)+'</h3><p>'+esc(subtitle)+'</p></section>'+
 '<section class="mi-grid" aria-label="온라인 매출 성장 지표">'+
 metric('온라인 실결제 매출',money(sales),change(sales,oldSales),'온라인 주문 금액이 전년보다 얼마나 변했는지',delta(sales,oldSales)<0)+
 metric('신규 구매 확인 회원',newCount===null?'확인 불가':fmt(newCount)+'명',change(newCount,oldNew),'처음 구매한 회원 수, 미확인 회원 제외',fall<0)+
 metric('재구매 회원 매출',money(repeat),change(repeat,oldRepeat),'기존 구매 회원이 다시 구매한 금액',repeatFall<0)+'</section>'+
 '<div class="mi-section"><h3>다음 달 우선 실행 과제</h3><span class="mi-tag">자동 집행 없음 · 조사/실험 제안</span></div><section class="mi-grid">'+
 task('01','신규 첫 구매가 막히는 지점 찾기',newCount!==null&&oldNew!==null?'신규 구매 회원 '+fmt(oldNew)+'명 → '+fmt(newCount)+'명 ('+change(newCount,oldNew)+', 잠정)':'신규 첫 구매 수의 전년 비교가 불완전해.','유입 채널별 구매 경로를 확인하고 10만 원 미만 입문 상품의 재고·노출·구매 동선을 점검해.','첫 구매 회원 수 · 첫 구매 전환율 · 신규 첫 주문 매출')+
 task('02','기존 고객의 두 번째 구매 기회 찾기',repeat!==null&&oldRepeat!==null?'재구매 회원 매출 전년 대비 '+change(repeat,oldRepeat)+' (잠정)':'재구매 매출 비교 자료를 확인해야 해.','관찰이 끝난 30·60·90일 코호트만 분석하고 재입고 안내·스타일링 콘텐츠·후속 구매 실험을 설계해.','두 번째 구매율 · 재구매 매출 · 할인 차감 이익')+
 task('03','네이버 유입 측정 정확히 만들기','이전 점검에서 광고 클릭 대비 유입 식별의 큰 차이가 확인됐어.','네이버 광고 연결 URL 및 추적값과 Cafe24 방문 기록을 대조한 뒤 채널 실적을 다시 평가해.','광고 클릭 대비 추적 유입 · 첫 구매 매칭률')+'</section>'+
 '<div class="mi-section"><h3>숫자가 말해주는 것</h3><span class="mi-muted">원인 확정이 아닌 검증할 가설</span></div><section class="mi-duo">'+
 '<article class="mi-panel"><h3>신규 고객은 정말 줄었을까?</h3><div class="mi-note">전년 '+(oldNew===null?'확인 불가':fmt(oldNew)+'명')+' → 현재 '+(newCount===null?'확인 불가':fmt(newCount)+'명')+' · '+change(newCount,oldNew)+'</div><p>방문자 수나 인스타그램 팔로워가 아닌 <b>실제 첫 구매 회원</b>이야. '+(acquisition.filter(Boolean).length===4&&oldAcq.filter(Boolean).length===4?'유입 데이터는 조회됐지만 출처 미식별과 태깅 문제는 별도 검증해야 해.':'일부 유입 기록을 조회하지 못해 채널 원인을 확정할 수 없어.')+'</p></article>'+
 '<article class="mi-panel"><h3>고객은 다시 구매했을까?</h3><div class="mi-note">'+(mature.length?'30일 관찰이 끝난 월: '+esc(mature.join(' / ')):'30일 재구매율: 신뢰할 수 있는 관찰 완료 월 확인 불가')+'</div><p>첫 구매 후 다시 사는 비율이야. <b>관찰 기간이 지나지 않은 고객은 0%로 취급하지 않아.</b></p></article></section>'+
 '<div class="mi-section"><h3>데이터 신뢰도</h3></div><div class="mi-panel"><span class="mi-tag">'+(unique.length?'잠정 분석 · 추가 확인 필요':'기본 검증 완료')+'</span><p style="margin-top:9px">현재 신뢰할 수 있는 관측치만 보여주고, 미확인 값을 0으로 바꾸지 않아. 검증 전에는 광고 예산 변경·쿠폰 발급·CRM 메시지 발송을 권하지 않아.</p><details><summary>확인해야 할 데이터 문제 보기 ('+unique.length+'종류)</summary><ul style="font-size:12px;line-height:1.85">'+(unique.length?unique.map(x=>'<li>'+esc(x)+'</li>').join(''):'<li>추가 경고 없음</li>')+'</ul><p class="mi-error">월별로 반복되는 동일 경고는 합쳐서 보여줘. 기술 오류 코드나 70개 경고 목록을 나열하지 않아.</p></details></div>'+
 '<p class="mi-footer">출처: SAMPLAS Marketing OS CRM 월별·유입·품질·코호트 API. 2026년 7~10월과 2025년 같은 기간 비교. 미마감 수치는 잠정치야. 신규 고객 감소의 실제 원인이나 예상 매출 증가는 확정하지 않았어. 광고 플랫폼 전환은 실매출로 합산하지 않아.</p>';
 $('miBody').className='';$('miBody').innerHTML=html;$('miStatus').textContent=unique.length?'잠정 데이터':'데이터 조회 완료';
}
document.addEventListener('click',e=>{
 const link=e.target.closest?.('['+MARK+']');if(link){e.preventDefault();enter();return}
 if(state.active&&e.target.closest?.('#nav button,#nav a'))leave();
},true);
function init(){
 mount();const nav=$('nav');
 if(nav){const obs=new MutationObserver(()=>{if(!nav.querySelector('['+MARK+']'))mount()});obs.observe(nav,{childList:true})}
 if(location.hash==='#marketing-intelligence')enter();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();