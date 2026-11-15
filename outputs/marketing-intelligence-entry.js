/* SAMPLAS Marketing Intelligence: integrated monthly marketing action workspace. Read only. */
(()=>{'use strict';
const ID='MarketingIntelligenceAction',MARK='data-marketing-intelligence-entry';
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR').format(n):'확인 불가';
const money=n=>Number.isFinite(n)?fmt(Math.round(n))+'원':'확인 불가';
const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?(a/b-1)*100:null;
const change=(a,b)=>{const d=delta(a,b);return d===null?'비교 기간 데이터 없음':(d>0?'+':'')+d.toFixed(1)+'%';};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={active:false,serial:0,loaded:false,loading:false,preset:'1',start:'',end:'',compare:'previous',compareStart:'',compareEnd:'',tab:'overview',detail:null,loadedRows:null};
const mn=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
const ym=n=>Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0');
function latestMonth(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(new Date());return ym(Number(p.find(x=>x.type==='year').value)*12+Number(p.find(x=>x.type==='month').value)-2)}
function syncPeriod(){
 if(state.preset!=='custom'){const last=latestMonth();state.end=last;state.start=ym(mn(last)-Number(state.preset)+1)}
 for(const [id,v] of [['miStart',state.start],['miEnd',state.end]]){const el=$(id);if(el){el.value=v;el.min='2025-01';el.max=latestMonth();el.disabled=state.preset!=='custom'}}
 for(const [id,v] of [['miCompareStart',state.compareStart],['miCompareEnd',state.compareEnd]]){const el=$(id);if(el){el.value=v;el.min='2025-01';el.max=latestMonth();el.disabled=state.compare!=='custom'}}
}

const css=[
'#'+ID+'{max-width:1300px;color:#1b2520;padding-bottom:50px}',
'#'+ID+' h2{font-size:29px;line-height:1.3;letter-spacing:-.04em;margin:4px 0 9px}',
'#'+ID+' h3{font-size:18px;margin:0 0 11px}',
'#'+ID+' p{line-height:1.65;margin:0}',
'#'+ID+' .mi-muted{font-size:13px;color:#63756b}',
'#'+ID+' .mi-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}',
'#'+ID+' .mi-range{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:16px 0;padding:14px;background:#fff;border:1px solid #dce5de;border-radius:12px}',
'#'+ID+' .mi-range label{display:grid;gap:5px;font-size:12px;font-weight:750}',
'#'+ID+' .mi-tabs{display:flex;flex-wrap:wrap;gap:9px;padding-bottom:12px;border-bottom:1px solid #dce6de;margin:18px 0}',
'#'+ID+' .mi-tabs button{border:1px solid #cfddd1;background:#fff;color:#2a4d37;font-weight:750;padding:12px 15px}',
'#'+ID+' .mi-tabs button[aria-selected=true]{background:#1b3227;color:#fff;border-color:#1b3227}',
'#'+ID+' .mi-pane[hidden]{display:none!important}',
'#'+ID+' .mi-inspect{border:1px solid #9ab8a5;background:#f3f9f4;padding:17px;border-radius:13px;margin:14px 0;line-height:1.7}',
'#'+ID+' .mi-inspect p{font-size:13px}',
'#'+ID+' .mi-provisional{border:1px dashed #bdcdc2;background:#f7faf7;padding:22px;border-radius:13px;margin:12px 0}',
'#'+ID+' .mi-segment-button{border:1px solid #bdcfc1;background:#f2f8f2;color:#2e6043;padding:7px 11px;margin-top:8px}',
'#'+ID+' .mi-range select,#'+ID+' .mi-range input{padding:9px;border:1px solid #d5ded7;border-radius:8px;font:inherit;font-size:13px}',
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
'#'+ID+' .mi-breakdown{background:white;border:1px solid #dce5de;border-radius:14px;padding:20px;min-width:0}',
'#'+ID+' .mi-total{font-size:28px;font-weight:850;letter-spacing:-.03em;margin:8px 0 13px}',
'#'+ID+' .mi-stack{display:flex;width:100%;height:24px;border-radius:7px;overflow:hidden;gap:2px;background:#eef1ed}',
'#'+ID+' .mi-stack>span{height:100%;min-width:0}',
'#'+ID+' .mi-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 18px;margin:17px 0}',
'#'+ID+' .mi-legend-item{display:flex;gap:9px;align-items:center;font-size:12px;line-height:1.5}',
'#'+ID+' .mi-dot{width:11px;height:11px;border-radius:3px;flex:0 0 auto}',
'#'+ID+' .mi-legend-item strong{margin-left:auto;white-space:nowrap}',
'#'+ID+' .mi-legend-item em{font-size:11px;font-style:normal;color:#67746c;white-space:nowrap}',
'#'+ID+' .mi-table-wrap{max-width:100%;overflow-x:auto;margin-top:12px}',
'#'+ID+' .mi-table{border-collapse:collapse;width:100%;min-width:620px;font-size:12px}',
'#'+ID+' .mi-table th,#'+ID+' .mi-table td{padding:10px 9px;border-bottom:1px solid #e8ede9;text-align:right;font-variant-numeric:tabular-nums}',
'#'+ID+' .mi-table th:first-child,#'+ID+' .mi-table td:first-child{text-align:left;white-space:nowrap}',
'#'+ID+' .mi-table th{font-weight:800;background:#f4f7f4;color:#4d6353}',
'#'+ID+' .mi-why{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
'#'+ID+' .mi-why-item{padding:15px;border:1px solid #e1e7e2;border-radius:10px;background:#fff}',
'#'+ID+' .mi-why-item h4{margin:0 0 7px;font-size:15px}',
'#'+ID+' .mi-why-item p{font-size:12px;color:#526455;line-height:1.8}',
'@media(max-width:700px){#'+ID+' .mi-legend,#'+ID+' .mi-why{grid-template-columns:1fr}#'+ID+' .mi-breakdown{padding:15px}}',
'.nav [data-marketing-intelligence-entry].active{background:#252d29!important;color:#fff!important;border:1px solid #496452!important}',
'.main.mi-marketing-mode .topbar .controls{display:none}',
'@media(max-width:960px){#'+ID+' .mi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
'@media(max-width:650px){#'+ID+' .mi-grid,#'+ID+' .mi-duo{grid-template-columns:1fr}#'+ID+' .mi-head{display:block}#'+ID+' .mi-head button{margin-top:10px}#'+ID+' .mi-hero{padding:18px}#'+ID+' h2{font-size:24px}}'
].join('\n');
function mount(){
 if(!$('marketing-action-styles')){const s=document.createElement('style');s.id='marketing-action-styles';s.textContent=css;document.head.appendChild(s)}
 const nav=$('nav'),main=document.querySelector('main.main');if(!nav||!main)return;
 if(!$(ID)){
  const v=document.createElement('section');v.id=ID;v.className='view';v.setAttribute('aria-label','Marketing Intelligence');
  v.innerHTML='<div class="mi-head"><div><div class="mi-eyebrow">SAMPLAS · MARKETING INTELLIGENCE</div><h2>마케팅 데이터 분석</h2><p class="mi-muted">기간을 바꾸고 매출·고객·유입의 변화를 탐색해.</p></div><div><span class="mi-tag" id="miStatus">조회 대기</span> <button id="miReload" type="button">다시 확인</button></div></div><div class="mi-range"><label>분석 기간<select id="miPreset"><option value="1">최근 완료 월</option><option value="3">최근 3개월</option><option value="6">최근 6개월</option><option value="12">최근 12개월</option><option value="custom">직접 선택</option></select></label><label>시작 월<input id="miStart" type="month"></label><label>종료 월<input id="miEnd" type="month"></label><label>비교 기간<select id="miCompare"><option value="previous">직전 동일 기간</option><option value="year">전년 동일 기간</option><option value="custom">직접 비교</option></select></label><label>비교 시작 월<input id="miCompareStart" type="month" disabled></label><label>비교 종료 월<input id="miCompareEnd" type="month" disabled></label><span id="miPeriodHint" class="mi-muted"></span></div><div id="miTabs" class="mi-tabs" role="tablist" aria-label="분석 영역"></div><div id="miInspect" aria-live="polite"></div><div id="miBody" class="mi-loading">조회 전</div>';
  main.appendChild(v);$('miReload').addEventListener('click',load);
  $('miTabs').addEventListener('click',e=>{const b=e.target.closest('[data-mi-tab]');if(!b)return;state.tab=b.getAttribute('data-mi-tab');state.detail=null;showExplorerTab()});
  $('miBody').addEventListener('click',e=>{const b=e.target.closest('[data-mi-segment]');if(!b||!state.loadedRows)return;state.detail=Number(b.getAttribute('data-mi-segment'));showSegmentDetail()});
  $('miInspect').addEventListener('click',e=>{if(e.target.closest('[data-mi-close]')){state.detail=null;showSegmentDetail()}});
  showExplorerTab();
  $('miPreset').addEventListener('change',e=>{state.preset=e.target.value;syncPeriod();load()});
  $('miCompare').addEventListener('change',e=>{state.compare=e.target.value;if(state.compare==='custom'&&(!state.compareStart||!state.compareEnd)){const length=mn(state.end)-mn(state.start);state.compareEnd=ym(mn(state.start)-1);state.compareStart=ym(mn(state.compareEnd)-length)}syncPeriod();load()});
  for(const id of ['miCompareStart','miCompareEnd'])$(id).addEventListener('change',()=>{state.compareStart=$('miCompareStart').value;state.compareEnd=$('miCompareEnd').value;load()});
  for(const id of ['miStart','miEnd'])$(id).addEventListener('change',()=>{state.start=$('miStart').value;state.end=$('miEnd').value;load()});
  syncPeriod();
 }
 if(!nav.querySelector('['+MARK+']')){
  const a=document.createElement('a');a.setAttribute(MARK,'yes');a.href='#marketing-intelligence';a.textContent='Marketing Intelligence';a.setAttribute('aria-label','Marketing Intelligence');
  a.style.cssText='display:block;padding:11px 14px;margin:6px 0;border:1px solid rgba(120,140,150,.25);border-radius:9px;text-decoration:none;color:inherit;font-weight:750;font-size:13px';
  const content=[...nav.querySelectorAll('button,a')].find(x=>x.textContent.trim()==='Content');
  content?content.insertAdjacentElement('afterend',a):nav.appendChild(a);
 }
}
function enter(){
 mount();state.active=true;document.querySelector('main.main')?.classList.add('mi-marketing-mode');
 document.querySelectorAll('main .view.active').forEach(e=>e.classList.remove('active'));
 $(ID)?.classList.add('active');
 $('nav')?.querySelectorAll('.active').forEach(e=>e.classList.remove('active'));
 $('nav')?.querySelector('['+MARK+']')?.classList.add('active');
 if($('topbarTitle'))$('topbarTitle').textContent='Marketing Intelligence';
 if(!state.loading&&!state.loaded){syncPeriod();load();}
}
function leave(){state.active=false;document.querySelector('main.main')?.classList.remove('mi-marketing-mode');$(ID)?.classList.remove('active');$('nav')?.querySelector('['+MARK+']')?.classList.remove('active')}
async function get(url){
 const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('HTTP '+r.status);
 const raw=await r.json();if(!raw||raw.ok===false)throw Error('API unavailable');
 const d=raw.data??raw.structuredContent?.data??raw;if(!d||typeof d!=='object')throw Error('Missing data');
 return {...d,__meta:raw.meta??raw.structuredContent?.meta??null};
}
const prev=m=>String(Number(m.slice(0,4))-1)+m.slice(4);
const sum=(list,key)=>list.length&&list.every(x=>x&&Number.isFinite(x[key]))?list.reduce((a,x)=>a+x[key],0):null;
const row=(month,x)=>x?{month,orders:x.total?.orders,amount:x.total?.amount,new:x.newMembers?.members,newRevenue:x.newMembers?.amount,repeat:x.repeatMembers?.amount,guestRevenue:x.guests?.amount,naverPayGuest:x.guests?.naverPay?.amount,personalRevenue:x.personalPayment?.amount,unverifiedRevenue:x.unverifiedMembers?.amount,identityUnknownRevenue:x.identityUnknown?.amount,unknown:x.unverifiedMembers?.members,meta:x.__meta}:null;
function metric(title,value,then,description,negative){
 return '<article class="mi-kpi"><small>'+esc(title)+'</small><strong>'+esc(value)+'</strong><p><b'+(negative?' class="down"':'')+'>'+esc(then)+'</b></p><p>'+esc(description)+'</p></article>';
}
function task(num,title,signal,step,kpi){
 return '<article class="mi-action"><span class="mi-index">'+num+'</span><h4>'+esc(title)+'</h4><p>'+esc(signal)+'</p><div class="mi-next"><b>추가 분석 과제</b><div>'+esc(step)+'</div><b>성과를 판단할 기준</b><div>'+esc(kpi)+'</div></div></article>';
}

function revenueBreakdown(rows){
 const specs=[
  {key:'newRevenue',name:'신규 회원 구매 매출',color:'#287c60',desc:'첫 구매 회원이 이 기간에 만든 매출. 회원 첫 구매 구분은 구매 이력 검증 영향을 받아.'},
  {key:'repeat',name:'재구매 회원 매출',color:'#78a58c',desc:'이전 구매 이력이 확인된 회원이 다시 구매한 매출.'},
  {key:'guestRevenue',name:'비회원 주문 매출',color:'#dbad60',desc:'비회원 주문 금액. 네이버페이 주문이 포함되며 신규 고객이라는 의미는 아니야.'},
  {key:'personalRevenue',name:'개인결제창 주문 매출',color:'#7d8dad',desc:'개인결제창 주문으로 별도 집계된 금액. 스타일리스트·직원 매출이라고 단정할 수 없어.'},
  {key:'unverifiedRevenue',name:'최초 구매 이력 미확인 회원',color:'#a4aeb2',desc:'과거 구매 이력을 확인하지 못한 회원의 매출. 신규나 재구매에 임의 배분하지 않아.'},
  {key:'identityUnknownRevenue',name:'회원·비회원 분류 불가',color:'#c3b8bd',desc:'주문 데이터에서 회원 여부조차 확인되지 않은 금액.'}
 ];
 const total=sum(rows,'amount');let known=0;
 const items=specs.map(spec=>{
  const amount=sum(rows,spec.key);
  if(amount!==null)known+=amount;
  return {...spec,amount,share:total!==null&&total>0&&amount!==null?amount/total*100:null};
 });
 const complete=total!==null&&items.every(x=>x.amount!==null);
 const discrepancy=complete?total-known:null;
 return {total,items,complete,discrepancy};
}
function renderBreakdown(rows,previous,compareLabel='비교 기간'){
 const data=revenueBreakdown(rows),prior=revenueBreakdown(previous);
 const reconciled=data.complete&&data.discrepancy===0;
 const legend=data.items.map(x=>'<div class="mi-legend-item"><span class="mi-dot" style="background:'+x.color+'"></span><div>'+esc(x.name)+' <em>'+(x.share===null?'비중 미확인':x.share.toFixed(1)+'%')+'</em></div><strong>'+money(x.amount)+'</strong></div>').join('');
 const stack=reconciled?'<div class="mi-stack" role="img" aria-label="온라인 매출 구성 비중">'+data.items.filter(x=>x.amount>0).map(x=>'<span title="'+esc(x.name)+' '+x.share.toFixed(1)+'%" style="width:'+x.share.toFixed(5)+'%;background:'+x.color+'"></span>').join('')+'</div>':'<p class="mi-error">세부 매출 합계와 총매출의 검증이 완료되지 않아 구성 비율 그래프를 표시하지 않아.</p>';
 const movement=data.items.map(x=>{const previousItem=prior.items.find(p=>p.key===x.key);const before=previousItem?previousItem.amount:null;const difference=x.amount!==null&&before!==null?x.amount-before:null;return {label:x.name,current:x.amount,prior:before,difference}}).filter(x=>x.current!==0||x.prior!==0);
 const movementRows=movement.map(x=>'<tr><td>'+esc(x.label)+'</td><td>'+money(x.prior)+'</td><td>'+money(x.current)+'</td><td>'+((x.difference===null)?'비교 불가':(x.difference>0?'+':'')+money(x.difference))+'</td></tr>').join('');
 const totalDiff=data.total!==null&&prior.total!==null?data.total-prior.total:null;
 const negative=movement.filter(x=>x.difference!==null&&x.difference<0).sort((a,b)=>a.difference-b.difference)[0];
 const positive=movement.filter(x=>x.difference!==null&&x.difference>0).sort((a,b)=>b.difference-a.difference)[0];
 const rowsHtml=rows.map(x=>{
  if(!x)return '<tr><td>월 데이터 없음</td><td colspan="6">조회 실패 · 확인 불가</td></tr>';
  return '<tr><td>'+esc(x.month)+'</td>'+[x.amount,x.newRevenue,x.repeat,x.guestRevenue,x.personalRevenue,x.unverifiedRevenue].map(v=>'<td>'+money(v)+'</td>').join('')+'</tr>';
 }).join('');
 return '<section class="mi-breakdown"><h3>온라인 매출은 누가 만들었을까?</h3><p class="mi-muted">회원 구매 이력과 주문 유형을 기준으로 나눈 <b>서로 겹치지 않는 매출 구성</b>이야. 고객 직업/등급 구분이 아니야.</p>'+
 '<div class="mi-total">'+money(data.total)+'</div>'+stack+
 '<div class="mi-legend">'+legend+'</div>'+
 '<p class="mi-muted">'+(reconciled?'구성 항목 합계가 온라인 매출과 정확히 일치해.':'아직 합계가 맞지 않아. 차액 또는 누락 데이터부터 점검해야 해.')+' 아래 항목 중 개인결제창 주문은 CRM 신규·재구매 분석에 포함하지 않아.</p>'+
 '<div class="mi-note" style="margin-top:13px"><b>선택한 비교 기간과 대조하면</b><div>비교 기간 '+money(prior.total)+' → 선택 기간 '+money(data.total)+' · 변화 '+(totalDiff===null?'비교 불가':(totalDiff>0?'+':'')+money(totalDiff))+' ('+change(data.total,prior.total)+')</div><p class="mi-muted">고객 유형별 증감은 매출 구성 변화야. 특정 채널이나 콘텐츠가 원인이라는 뜻은 아니야.</p></div>'+ 
 '<div class="mi-duo" style="margin:12px 0"><div class="mi-note"><b>가장 큰 감소 구분</b><div>'+(negative?esc(negative.label)+' '+money(negative.difference):'비교 데이터 부족')+'</div></div><div class="mi-note"><b>감소를 일부 상쇄한 증가 구분</b><div>'+(positive?esc(positive.label)+' +'+money(positive.difference):'확인된 증가 구분 없음')+'</div></div></div>'+
 '<div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>주문·고객 구분</th><th>비교 기간</th><th>선택 기간</th><th>매출 차이</th></tr></thead><tbody>'+movementRows+'</tbody></table></div>'+
 '<details><summary>월별로 누가 얼마나 구매했는지 보기</summary><div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>월</th><th>온라인 전체</th><th>신규 회원</th><th>재구매 회원</th><th>비회원</th><th>개인결제</th><th>구매 이력 미확인</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></details>'+
 '<details><summary>각 매출 구분은 무엇을 의미할까?</summary><ul style="padding-left:20px;font-size:12px;line-height:1.9">'+data.items.map(x=>'<li><b>'+esc(x.name)+'</b>: '+esc(x.desc)+'</li>').join('')+'</ul><p class="mi-muted">스타일리스트·직원·프레스 등 고객 유형별 온라인 매출은 현재 주문 데이터만으로 구분 불가해. 별도 검증된 주문-고객 연결이 필요해.</p></details></section>';
}
function renderWhy(rows,acquisition,oldAcq){
 const unknown=sum(rows,'unknown');
 const guests=sum(rows,'guestRevenue'),naverGuest=sum(rows,'naverPayGuest');
 const naverPct=guests!==null&&guests>0&&naverGuest!==null?naverGuest/guests*100:null;
 const acquisitionReliable=acquisition.every(x=>x?.__meta?.completeness==='COMPLETE'&&x.analyticsCoverage==='COMPLETE')&&oldAcq.every(x=>x?.__meta?.completeness==='COMPLETE'&&x.analyticsCoverage==='COMPLETE');
 return '<section class="mi-why">'+
 '<article class="mi-why-item"><h4>신규 구매 매출은 어떤 변화가 있을까?</h4><p>신규 회원 매출은 전체 주문 중 일부에 불과해. 신규 첫 구매가 늘어도 전체 매출이 얼마나 오를지는 구매 전환·객단가를 함께 확인해야 해. 현재 채널 귀속 분석은 '+(acquisitionReliable?'조회 기준 통과':'자료 검증 전이라 원인 확정 불가')+' 상태야.</p></article>'+
 '<article class="mi-why-item"><h4>비회원 주문 구성은?</h4><p>비회원 매출 '+money(guests)+' 중 네이버페이 주문 '+money(naverGuest)+(naverPct!==null?' ('+naverPct.toFixed(1)+'%)':'')+'이야. 네이버페이 주문을 모두 신규 고객으로 볼 수 없으므로 회원 전환 기회를 조사해야 해.</p></article>'+
 '<article class="mi-why-item"><h4>개인결제는 어떤 주문일까?</h4><p>개인결제창은 일반 회원 구매와 다른 주문 방식이야. 스타일리스트 매출인지, 특정 고객의 결제인지 현재 데이터만으로 알 수 없어. 주문 유형과 고객 관계를 연결하기 전에는 분류를 확정하지 않아.</p></article>'+
 '<article class="mi-why-item"><h4>재구매 해석에서 주의할 점은?</h4><p>최초 구매 이력 미확인 고객이 '+(unknown===null?'확인 불가':fmt(unknown)+'명')+' 있어. 이들을 재구매 회원이나 신규 회원으로 임의 분류하지 않아. 코호트는 관찰이 완료된 기간만 비교해야 해.</p></article>'+
 '</section>';
}

function renderChannelEvidence(current,prior,compareLabel){
 const aggregate=rows=>{
  const map=new Map();let gaps=0;
  for(const row of rows){
   if(!row||!Array.isArray(row.firstPurchaseChannels)){gaps++;continue}
   for(const item of row.firstPurchaseChannels){
    if(!Number.isFinite(item.members)){gaps++;continue}
    const key=(item.channel||'UNKNOWN')+(item.medium?' / '+item.medium:'');
    map.set(key,(map.get(key)||0)+item.members);
   }
  }
  return {map,gaps};
 };
 const a=aggregate(current),b=aggregate(prior);
 const keys=[...new Set([...a.map.keys(),...b.map.keys()])].sort((x,y)=>(a.map.get(y)||0)-(a.map.get(x)||0));
 const rows=keys.map(k=>'<tr><td>'+esc(k)+'</td><td>'+fmt(a.map.get(k)??null)+'</td><td>'+fmt(b.map.get(k)??null)+'</td><td>'+(a.map.has(k)&&b.map.has(k)?(a.map.get(k)-b.map.get(k)>0?'+':'')+fmt(a.map.get(k)-b.map.get(k)):'비교 불가')+'</td></tr>').join('');
 const any=current.some(x=>x?.__meta?.completeness!=='COMPLETE'||x?.analyticsCoverage!=='COMPLETE')||prior.some(x=>x?.__meta?.completeness!=='COMPLETE'||x?.analyticsCoverage!=='COMPLETE');
 return '<section class="mi-breakdown"><h3>첫 구매 고객은 어떤 경로에서 왔을까?</h3><p class="mi-muted">Cafe24 Analytics와 주문을 연결한 회원 첫 구매 유입 분류야. 실제 방문 수, 광고 증분 효과, 고객 획득의 인과관계가 아니야.</p>'+
 '<div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>유입 출처 / 매체</th><th>선택 기간 신규 회원</th><th>'+esc(compareLabel)+'</th><th>차이</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4">확인 가능한 유입 기록이 없어</td></tr>')+'</tbody></table></div>'+
 '<p class="mi-error">'+(any||a.gaps||b.gaps?'유입 채널 분류에 누락이나 검증되지 않은 구간이 있어. 채널별 원인 확정·예산 판단 금지.':'유입 분류 확인 완료. 다만 유입 출처와 구매 기여는 별개야.')+'</p></section>';
}
async function load(){
 if(!$('miBody'))return;
 const token=++state.serial;state.loaded=false;state.loading=true;
 const valid=state.start&&state.end&&mn(state.start)<=mn(state.end)&&state.start>='2025-01'&&state.end<=latestMonth()&&mn(state.end)-mn(state.start)<12;
 if(!valid){state.loading=false;$('miStatus').textContent='기간 오류';$('miBody').className='mi-loading';$('miBody').textContent='2025년 1월 이후 완료된 월 가운데 최대 12개월을 선택해.';return}
 const months=Array.from({length:mn(state.end)-mn(state.start)+1},(_,i)=>ym(mn(state.start)+i));
 const prevMonths=state.compare==='custom'?(state.compareStart&&state.compareEnd&&mn(state.compareStart)<=mn(state.compareEnd)?Array.from({length:mn(state.compareEnd)-mn(state.compareStart)+1},(_,i)=>ym(mn(state.compareStart)+i)):[]):months.map((m,i)=>state.compare==='year'?ym(mn(m)-12):ym(mn(state.start)-months.length+i));
 if(prevMonths.length!==months.length||prevMonths.at(-1)>latestMonth()){state.loading=false;$('miStatus').textContent='비교 기간 확인';$('miBody').className='mi-loading';$('miBody').textContent='선택 기간과 비교 기간의 개월 수가 같아야 하고, 완료된 월만 사용할 수 있어.';return}
 // Missing historical comparison months do not block the selected current period.
 const compareLabel=state.compare==='custom'?'직접 비교 '+prevMonths[0]+' ~ '+prevMonths.at(-1):state.compare==='year'?'전년 같은 기간':'직전 같은 길이 기간';
 $('miPeriodHint').textContent=months[0]+' ~ '+months.at(-1)+' · '+compareLabel;
 $('miStatus').textContent='조회 중';$('miBody').className='mi-loading';$('miBody').textContent='선택한 월의 CRM 데이터 확인 중';
 const urls=[...months.map(m=>'/api/crm/monthly?month='+m),...prevMonths.map(m=>m<'2025-01'?null:'/api/crm/monthly?month='+m),...months.map(m=>'/api/crm/acquisition?month='+m),...months.map(m=>'/api/crm/data-quality?month='+m),...prevMonths.map(m=>m<'2025-01'?null:'/api/crm/acquisition?month='+m),...prevMonths.map(m=>m<'2025-01'?null:'/api/crm/data-quality?month='+m),'/api/crm/cohort?from='+months[0]+'&to='+months.at(-1)+'&windows=30,60,90'];
 const responses=new Array(urls.length);let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<urls.length){const i=cursor++;try{if(!urls[i]){responses[i]={ok:false,error:'BEFORE_COVERAGE'};continue}responses[i]={ok:true,value:await get(urls[i])}}catch(e){responses[i]={ok:false,error:e.message}}}}));
 if(token!==state.serial)return;state.loaded=true;state.loading=false;
 const n=months.length,group=k=>responses.slice(k*n,(k+1)*n).map(r=>r?.ok?r.value:null);
 const current=group(0).map((x,i)=>row(months[i],x)),previous=group(1).map((x,i)=>row(prevMonths[i],x)),acquisition=group(2),qualities=group(3),oldAcq=group(4),oldQuality=group(5),cohort=responses[6*n]?.ok?responses[6*n].value:null;
 state.loadedRows={current,previous,months,prevMonths,acquisition,qualities,cohort};state.detail=null;
 const orders=sum(current,'orders'),oldOrders=sum(previous,'orders');
 const sales=sum(current,'amount'),oldSales=sum(previous,'amount'),newCount=sum(current,'new'),oldNew=sum(previous,'new'),repeat=sum(current,'repeat'),oldRepeat=sum(previous,'repeat'),unknown=sum(current,'unknown');
 const aov=orders>0&&sales!==null?sales/orders:null,priorAov=oldOrders>0&&oldSales!==null?oldSales/oldOrders:null;
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
 const title='매출과 고객 구성 변화';
 const subtitle='고객·주문 유형별로 무엇이 변했는지 확인하고, 원인은 데이터로 검증해.';
 const html=
 '<section class="mi-hero"><div class="mi-eyebrow" style="color:#aad0b6">'+months[0]+' ~ '+months.at(-1)+' · '+compareLabel+'</div><h3>'+esc(title)+'</h3><p>'+esc(subtitle)+'</p></section>'+
 '<section class="mi-grid" aria-label="온라인 매출 성장 지표">'+
 metric('온라인 실결제 매출',money(sales),change(sales,oldSales),'선택한 비교 기간과 온라인 주문 금액 비교',delta(sales,oldSales)<0)+
 metric('온라인 주문 수',orders===null?'확인 불가':fmt(orders)+'건',change(orders,oldOrders),'주문 건수가 변해 매출에 영향을 주었는지 확인',delta(orders,oldOrders)<0)+
 metric('주문당 평균 결제금액',money(aov),change(aov,priorAov),'온라인 매출 ÷ 온라인 주문 수. 회원별 객단가와는 달라.',delta(aov,priorAov)<0)+
 metric('신규 구매 확인 회원',newCount===null?'확인 불가':fmt(newCount)+'명',change(newCount,oldNew),'처음 구매한 회원 수, 미확인 회원 제외',fall<0)+
 metric('재구매 회원 매출',money(repeat),change(repeat,oldRepeat),'기존 구매 회원이 다시 구매한 금액',repeatFall<0)+'</section>'+
 '<div class="mi-section"><h3>매출을 구성하는 고객과 주문</h3><span class="mi-muted">합계 검증 · 월별 상세</span></div>'+renderBreakdown(current,previous,compareLabel)+
 '<div class="mi-section"><h3>첫 구매 유입 채널</h3><span class="mi-muted">원천 추적 품질에 주의</span></div>'+renderChannelEvidence(acquisition,oldAcq,compareLabel)+
 '<div class="mi-section"><h3>변화를 해석할 때 확인할 점</h3><span class="mi-muted">관측 근거와 미확인 원인을 구분해</span></div>'+renderWhy(current,acquisition,oldAcq)+
 '<div class="mi-section"><h3>고객 변화 탐색</h3><span class="mi-muted">원인 확정이 아닌 검증할 가설</span></div><section class="mi-duo">'+
 '<article class="mi-panel"><h3>신규 고객 수 변화</h3><div class="mi-note">비교 기간 '+(oldNew===null?'확인 불가':fmt(oldNew)+'명')+' → 현재 '+(newCount===null?'확인 불가':fmt(newCount)+'명')+' · '+change(newCount,oldNew)+'</div><p>방문자 수나 인스타그램 팔로워가 아닌 <b>실제 첫 구매 회원</b>이야. '+(acquisition.length===months.length&&acquisition.every(Boolean)&&oldAcq.length===months.length&&oldAcq.every(Boolean)?'유입 데이터는 조회됐지만 출처 미식별과 태깅 문제는 별도 검증해야 해.':'일부 유입 기록을 조회하지 못해 채널 원인을 확정할 수 없어.')+'</p></article>'+
 '<article class="mi-panel"><h3>고객은 다시 구매했을까?</h3><div class="mi-note">'+(mature.length?'30일 관찰이 끝난 월: '+esc(mature.join(' / ')):'30일 재구매율: 신뢰할 수 있는 관찰 완료 월 확인 불가')+'</div><p>첫 구매 후 다시 사는 비율이야. <b>관찰 기간이 지나지 않은 고객은 0%로 취급하지 않아.</b></p></article></section>'+
 '<div class="mi-section"><h3>데이터 신뢰도</h3></div><div class="mi-panel"><span class="mi-tag">'+(unique.length?'잠정 분석 · 추가 확인 필요':'기본 검증 완료')+'</span><p style="margin-top:9px">현재 신뢰할 수 있는 관측치만 보여주고, 미확인 값을 0으로 바꾸지 않아. 검증 전에는 광고 예산 변경·쿠폰 발급·CRM 메시지 발송을 권하지 않아.</p><details><summary>확인해야 할 데이터 문제 보기 ('+unique.length+'종류)</summary><ul style="font-size:12px;line-height:1.85">'+(unique.length?unique.map(x=>'<li>'+esc(x)+'</li>').join(''):'<li>추가 경고 없음</li>')+'</ul><p class="mi-error">월별로 반복되는 동일 경고는 합쳐서 보여줘. 기술 오류 코드나 70개 경고 목록을 나열하지 않아.</p></details></div>'+
 '<p class="mi-footer">출처: SAMPLAS Marketing OS CRM 월별·유입·품질·코호트 API. '+months[0]+' ~ '+months.at(-1)+' · '+compareLabel+'. 미마감 수치는 잠정치야. 신규 고객 감소의 실제 원인이나 예상 매출 증가는 확정하지 않았어. 광고 플랫폼 전환은 실매출로 합산하지 않아.</p>';
 $('miBody').className='';$('miBody').innerHTML=html;$('miStatus').textContent=unique.length?'잠정 데이터':'데이터 조회 완료';organizeExplorer();
}

const EXPLORER_TABS=[['overview','매출 구조'],['customers','고객 분석'],['acquisition','유입 · 광고'],['products','상품 · 콘텐츠']];
function showExplorerTab(){
 const tabs=$('miTabs');if(tabs)tabs.innerHTML=EXPLORER_TABS.map(([key,label])=>'<button type="button" role="tab" data-mi-tab="'+key+'" aria-selected="'+(state.tab===key)+'">'+label+'</button>').join('');
 for(const pane of document.querySelectorAll('#miBody .mi-pane'))pane.hidden=pane.getAttribute('data-mi-pane')!==state.tab;
 if(state.tab==='acquisition')loadAdEvidence();
 showSegmentDetail();
}
function organizeExplorer(){
 const body=$('miBody');if(!body||!body.children.length)return;
 // Known composition of the verified legacy read-only analysis renderer.
 const original=Array.from(body.children);
 if(original.length<13)return; // fail safe: retain original report rather than erase it
 const groups=[
  ['overview',[0,1,2,3]],
  ['customers',[7,8,9]],
  ['acquisition',[4,5]],
 ];
 const layout=document.createDocumentFragment();
 for(const [name,indices] of groups){
  const section=document.createElement('section');section.className='mi-pane';section.setAttribute('data-mi-pane',name);
  for(const idx of indices)if(original[idx])section.appendChild(original[idx]);
  if(name==='acquisition'){const ads=document.createElement('div');ads.id='miAdsEvidence';section.appendChild(ads)}
  layout.appendChild(section);
 }
 const productPane=document.createElement('section');productPane.className='mi-pane';productPane.setAttribute('data-mi-pane','products');
 productPane.innerHTML='<div class="mi-provisional"><h3>브랜드·상품별 판매 기여</h3><p>현재 제품·브랜드 API는 있지만 고객 유형별 주문 매출과 연결된 검증 자료가 부족해. 동일 주문에서 매출을 중복 없이 분배하는 검증 전에는 상품별 기여도를 표시하지 않아.</p><p class="mi-muted">연결 예정: 상품 실결제 매출, 주문 수, 할인, 재고, 고객 유형 및 매출 기여도</p></div>'+
 '<div class="mi-provisional"><h3>SAMPLAS / VEIL 콘텐츠 비교</h3><p>게시물별 도달·저장·참여 데이터와 실제 구매를 연결할 근거가 필요해. 먼저 계정별 피드·릴스·행사/팝업 분류와 게시물 매핑을 검증해야 해.</p><p class="mi-muted">현재 상태: 콘텐츠 → 구매 귀속 미검증. 임의 ROAS나 인과관계 표시 없음</p></div>';
 layout.appendChild(productPane);
 const quality=document.createElement('div');quality.className='mi-pane-quality';
 for(const idx of [10,11,12])if(original[idx])quality.appendChild(original[idx]);
 body.replaceChildren(layout,quality);
 const labels=['신규 회원','재구매 회원','비회원','개인결제','첫 구매 이력 미확인','회원 구분 불가'];
 const segments=body.querySelectorAll('[data-mi-pane="overview"] .mi-legend-item');
 segments.forEach((row,i)=>{
  if(i>=labels.length)return;
  const button=document.createElement('button');button.type='button';button.className='mi-segment-button';button.setAttribute('data-mi-segment',String(i));button.textContent='월별 근거 보기';
  row.appendChild(button);
 });
 showExplorerTab();
}
function showSegmentDetail(){
 const el=$('miInspect');if(!el)return;
 const data=state.loadedRows,ix=state.detail;
 if(ix===null||!data||!Number.isInteger(ix)||ix<0||ix>5){el.innerHTML='';return}
 const specs=[
  ['신규 회원 매출','newRevenue','검증된 첫 구매 회원 주문 매출'],
  ['재구매 회원 매출','repeat','이전 구매 이력이 확인된 회원 매출'],
  ['비회원 주문 매출','guestRevenue','네이버페이를 포함하는 비회원 주문'],
  ['개인결제창 매출','personalRevenue','회원/스타일리스트 유형으로 확정할 수 없는 별도 결제 방식'],
  ['첫 구매 이력 미확인 회원 매출','unverifiedRevenue','과거 주문 이력 부족으로 신규/재구매 구분이 불가능한 회원'],
  ['회원 구분 불가 매출','identityUnknownRevenue','주문 회원 식별 자체가 불확실한 거래']
 ];
 const [name,key,meaning]=specs[ix];
 const body=data.current.map(x=>'<tr><td>'+esc(x?.month??'기간 미확인')+'</td><td>'+money(x?.[key])+'</td></tr>').join('');
 el.innerHTML='<section class="mi-inspect"><button type="button" data-mi-close style="float:right">닫기</button><h3>'+esc(name)+'</h3><p>'+esc(meaning)+'</p><div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>월</th><th>매출</th></tr></thead><tbody>'+body+'</tbody></table></div><p>출처: Cafe24 CRM /api/crm/monthly. 현재 기간의 자료가 NOT_FINAL 또는 PARTIAL이면 확정 수치가 아니야.</p></section>';
}
async function loadAdEvidence(){
 const target=$('miAdsEvidence'),rows=state.loadedRows;if(!target||!rows)return;
 const serial=state.serial;
 target.innerHTML='<div class="mi-provisional">광고 플랫폼 지표 확인 중…</div>';
 const last=rows.months.at(-1);
 const since=rows.months[0]+'-01',until=new Date(Date.UTC(Number(last.slice(0,4)),Number(last.slice(5)),0)).toISOString().slice(0,10);
 try{
  const result=await get('/api/advertising/overview?since='+since+'&until='+until);
  if(serial!==state.serial||state.tab!=='acquisition')return;
  if(!Array.isArray(result.channels))throw Error('No channel data');
  target.innerHTML='<div class="mi-section"><h3>광고 플랫폼 보고 지표</h3><span class="mi-muted">Cafe24 구매 귀속 매출과 별개</span></div><div class="mi-breakdown"><div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>채널</th><th>광고비</th><th>노출</th><th>클릭</th><th>플랫폼 전환</th><th>데이터 경고</th></tr></thead><tbody>'+
    result.channels.map(x=>'<tr><td>'+esc(x.channel)+'</td><td>'+money(x.spend)+'</td><td>'+fmt(x.impressions)+'</td><td>'+fmt(x.clicks)+'</td><td>'+fmt(x.platformConversions)+'</td><td>'+esc(x.issues?.length?x.issues.length+'건 · 검증 필요':'확인')+'</td></tr>').join('')+'</tbody></table></div><p class="mi-muted">출처: Meta·NAVER 플랫폼. 전환과 전환 매출을 Cafe24 실제 매출로 합산하지 않아. 특히 통화·추적 누락 여부를 확인해야 해.</p></div>';
 }catch(e){if(serial===state.serial)target.innerHTML='<div class="mi-provisional">광고 데이터 조회 실패. 매출 및 유입 데이터는 그대로 확인할 수 있어. 임의 수치를 표시하지 않아.</div>'}
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