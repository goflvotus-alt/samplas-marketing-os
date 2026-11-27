/* SAMPLAS Marketing Intelligence: integrated monthly marketing action workspace. Read only. */
(()=>{'use strict';
const ID='MarketingIntelligenceAction',MARK='data-marketing-intelligence-entry';
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR').format(n):'확인 불가';
const money=n=>Number.isFinite(n)?fmt(Math.round(n))+'원':'확인 불가';
const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?(a/b-1)*100:null;
const change=(a,b)=>{const d=delta(a,b);return d===null?'비교 기간 데이터 없음':(d>0?'+':'')+d.toFixed(1)+'%';};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={active:false,serial:0,loaded:false,loading:false,preset:'1',start:'',end:'',compare:'previous',compareStart:'',compareEnd:'',tab:'overview',detail:null,loadedRows:null,trace:null,tracePage:1,traceMonth:null,traceSerial:0,traceFilter:null,trafficMonth:null,trafficSerial:0};
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
'#'+ID+' #miInspect:not(:empty){position:fixed;inset:0;z-index:2200;display:grid;place-items:center;padding:22px;background:rgba(20,19,15,.54);overflow-y:auto}',
'#'+ID+' #miInspect:not(:empty)>.mi-inspect,#'+ID+' #miInspect:not(:empty)>.mi-trace{box-sizing:border-box;width:min(780px,100%);max-height:calc(100dvh - 44px);overflow:auto;margin:0;background:white;border:1px solid #e0e5df;box-shadow:0 28px 75px rgba(15,30,20,.3);border-radius:16px;padding:24px}',
'#'+ID+' #miInspect .mi-inspect>h3,#'+ID+' #miInspect .mi-trace>h3{font-size:20px;line-height:1.4;margin:4px 50px 12px 0}',
'#'+ID+' #miInspect button[data-mi-close],#'+ID+' #miInspect button[data-mi-trace-close]{border:1px solid #d6e0d7;border-radius:100px;background:#fff;padding:9px 14px;cursor:pointer;float:right}',
'#'+ID+' .mi-order-list{display:grid;gap:10px;margin:14px 0}',
'#'+ID+' .mi-order-card{border:1px solid #e1e8e0;border-radius:12px;background:#fafcfa;padding:13px 15px}',
'#'+ID+' .mi-order-card summary{cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px}',
'#'+ID+' .mi-order-card summary strong{font-size:15px;color:#203c2c}',
'#'+ID+' .mi-order-card .mi-order-products{margin-top:12px;padding-top:10px;border-top:1px solid #dce5dc}',
'#'+ID+' .mi-order-card .mi-order-products>div{padding:5px 0}',

'#'+ID+' #miInspect:not(:empty)>.mi-trace{width:min(1110px,100%);padding:24px;max-height:calc(100dvh - 36px)}',
'#'+ID+' .mi-trace-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}',
'#'+ID+' .mi-trace-stat{border:1px solid #e1e9e2;border-radius:12px;padding:12px;background:#f7faf7}',
'#'+ID+' .mi-trace-stat small{display:block;font-size:11px;color:#63766a;font-weight:750}',
'#'+ID+' .mi-trace-stat strong{display:block;font-size:19px;margin-top:5px;color:#183e2a}',
'#'+ID+' .mi-trace-layout{display:grid;grid-template-columns:255px minmax(0,1fr);gap:16px;min-height:400px}',
'#'+ID+' .mi-trace-nav{border:1px solid #e0e9e2;border-radius:13px;padding:12px;align-self:start;background:#f8faf8}',
'#'+ID+' .mi-trace-nav h4{font-size:12px;margin:2px 0 10px;color:#576a5e}',
'#'+ID+' .mi-order-filter-wrap{position:relative;margin:4px 0}',
'#'+ID+' .mi-order-filter{width:100%;display:flex;justify-content:space-between;align-items:center;gap:7px;text-align:left;border:1px solid transparent!important;background:transparent!important;padding:10px 9px!important;color:#263f2e;border-radius:8px;font-size:13px;font-weight:650}',
'#'+ID+' .mi-order-filter:hover,#'+ID+' .mi-order-filter:focus-visible{border-color:#c1d5c7!important;background:#eff7f0!important}',
'#'+ID+' .mi-order-filter[aria-pressed=true]{background:#dceee1!important;border-color:#9fbda9!important;color:#1e5939}',
'#'+ID+' .mi-order-filter strong{font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}',
'#'+ID+' .mi-order-filter-child{margin-left:12px;width:calc(100% - 12px);font-size:12px}',
'#'+ID+' .mi-order-filter-wrap .mi-order-preview{display:none;position:absolute;z-index:2301;left:calc(100% + 8px);top:0;width:min(320px,70vw);box-sizing:border-box;background:#192c22;color:#f5fff5;padding:14px;border-radius:10px;box-shadow:0 15px 40px #0004;pointer-events:none}',
'#'+ID+' .mi-order-filter-wrap:hover .mi-order-preview,#'+ID+' .mi-order-filter-wrap:focus-within .mi-order-preview{display:block}',
'#'+ID+' .mi-order-preview p{color:#e5eee6;font-size:11px;line-height:1.5;margin:8px 0;border-top:1px solid #466153;padding-top:8px}',
'#'+ID+' .mi-order-preview p span{color:#c5d5c7;display:block;max-width:100%;overflow-wrap:anywhere}',
'#'+ID+' .mi-order-preview strong{font-size:12px;color:#fff}',
'#'+ID+' .mi-order-unverified{border-top:1px solid #dde8e0;padding:12px 8px 6px;font-size:12px;color:#54665b;line-height:1.7}',
'#'+ID+' .mi-order-results{min-width:0;max-height:min(65vh,690px);overflow-y:auto;padding:0 3px 5px 0}',
'#'+ID+' .mi-order-results h4{margin:2px 0 10px;font-size:16px}',
'#'+ID+' .mi-order-card{padding:0!important;margin:8px 0!important;border-radius:10px!important}',
'#'+ID+' .mi-order-card summary{padding:12px!important;list-style:none;display:flex;justify-content:space-between;gap:14px;align-items:center}',
'#'+ID+' .mi-order-card summary::-webkit-details-marker{display:none}',
'#'+ID+' .mi-order-card summary small{display:block;color:#64776a;font-size:11px;margin-top:3px}',
'#'+ID+' .mi-order-card .mi-order-products{padding:0 12px 12px}',
'#'+ID+' .mi-trace-lead{font-size:13px;line-height:1.7;color:#526a59}',
'#'+ID+' .mi-period-evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:17px 0}',
'#'+ID+' .mi-evidence-col{background:#fafcfa;border:1px solid #dfe8df;border-radius:12px;padding:14px;min-width:0}',
'#'+ID+' .mi-evidence-col h4{font-size:13px;margin:0 0 10px}',
'#'+ID+' .mi-evidence-row{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-top:1px solid #e6eee7;font-size:12px}',
'#'+ID+' .mi-evidence-bar{height:7px;border-radius:20px;background:#e6ede7;overflow:hidden}',
'#'+ID+' .mi-evidence-bar span{display:block;height:100%;background:#427a58;border-radius:20px}',
'#'+ID+' .mi-evidence-row button{grid-column:1/-1;justify-self:end;color:#20583d;background:#f0f8f1;border:1px solid #b5d0bd}',
'@media(max-width:840px){#'+ID+' .mi-trace-layout{grid-template-columns:1fr}#'+ID+' .mi-trace-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}#'+ID+' .mi-trace-nav h4,#'+ID+' .mi-order-unverified{grid-column:1/-1}#'+ID+' .mi-order-results{max-height:none}#'+ID+' .mi-order-filter-wrap .mi-order-preview{left:0;top:calc(100% + 4px)}}',
'@media(max-width:580px){#'+ID+' .mi-trace-summary{grid-template-columns:1fr 1fr}#'+ID+' .mi-period-evidence{grid-template-columns:1fr}#'+ID+' #miInspect:not(:empty)>.mi-trace{padding:15px}#'+ID+' .mi-order-preview{max-width:85vw}}',
'#'+ID+' .mi-auth-form{display:flex;flex-wrap:wrap;gap:9px;align-items:end;margin:15px 0}',
'#'+ID+' .mi-auth-form label{display:grid;gap:5px;font-size:12px;font-weight:700}',
'#'+ID+' .mi-auth-form input{min-width:145px;padding:9px;border:1px solid #c8d6cb;border-radius:8px;font:inherit}',
'#'+ID+' .mi-auth-status{font-size:12px;color:#9a4738}',
'@media(max-width:650px){#'+ID+' #miInspect:not(:empty){padding:8px}#'+ID+' #miInspect:not(:empty)>.mi-inspect,#'+ID+' #miInspect:not(:empty)>.mi-trace{padding:17px;max-height:calc(100dvh - 16px)}}',
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
'#'+ID+' .mi-hover{position:relative}',
'#'+ID+' .mi-hover:hover::after,#'+ID+' .mi-hover:focus-visible::after{content:attr(data-mi-tip);position:absolute;top:calc(100% + 6px);left:6px;z-index:15;background:#162e23;color:white;padding:12px 14px;border-radius:9px;box-shadow:0 7px 24px #0003;white-space:normal;min-width:min(270px,75vw);max-width:min(350px,80vw);font-size:12px;font-weight:400;line-height:1.7}',
'#'+ID+' .mi-kpi button,#'+ID+' button[data-mi-trace-segment]{margin-top:10px;border:1px solid #aac7b4;background:#eff8f1;color:#205b3a;font-size:12px;padding:9px 11px;border-radius:8px}',
'#'+ID+' .mi-trace{border:1px solid #afcbb6;border-radius:12px;background:#fff;padding:17px;margin:12px 0}',
'#'+ID+' .mi-trace-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}',
'#'+ID+' .mi-trace-controls select{padding:9px;border:1px solid #d5e0d9;border-radius:8px}',
'#'+ID+' .mi-purchased-product{font-size:12px;line-height:1.6}',
'#'+ID+' .mi-traffic{background:#fff;border:1px solid #dce5de;border-radius:12px;padding:17px;margin:13px 0}',
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
'#'+ID+' .mi-period-bar{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}',
'#'+ID+' .mi-period-bar>div{display:flex;flex-direction:column;gap:4px;background:#f3f7f3;border:1px solid #dce6df;border-radius:11px;padding:13px}',
'#'+ID+' .mi-period-bar strong{font-size:15px}',
'#'+ID+' .mi-period-bar .mi-period-label{font-weight:800;font-size:11px;color:#496452}',
'#'+ID+' .mi-period-bar span:last-child{font-size:15px;font-weight:800}',
'#'+ID+' .mi-findings{margin:17px 0;background:#f5f8f5;border-left:4px solid #488163;padding:14px 16px;border-radius:7px}',
'#'+ID+' .mi-findings p{font-size:13px;margin:6px 0 0}',
'#'+ID+' .mi-table-context{margin:17px 0 8px}',
'#'+ID+' .mi-table-context p{font-size:12px;color:#566c5c;margin-top:4px}',
'#'+ID+' .mi-table caption{caption-side:top;text-align:left;padding-bottom:7px;font-size:12px;color:#526b5b}',
'#'+ID+' .mi-table td{vertical-align:middle}',
'#'+ID+' .mi-cell-explain{font-size:11px;font-weight:400;max-width:310px;color:#657267;line-height:1.6;margin-top:4px}',
'#'+ID+' .mi-down{color:#a23f3f;font-weight:750}',
'#'+ID+' .mi-up{color:#276b49;font-weight:750}',
'#'+ID+' .mi-total-row{background:#edf3ee;font-weight:800}',
'@media(max-width:650px){#'+ID+' .mi-period-bar{grid-template-columns:1fr}}',
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
'#'+ID+' .mi-range[hidden],#'+ID+' #miBody[hidden]{display:none!important}',
'#'+ID+' #miNaverPane,#'+ID+' #miNaverReport{min-width:0;max-width:100%}',
'#'+ID+' #miNaverReport .mi-grid{margin-top:12px}',
'#'+ID+' #miNaverRows .mi-table{min-width:940px}',
'#'+ID+' #miNaverRows button{padding:4px 8px;white-space:nowrap}',
'@media(max-width:650px){#'+ID+' #miNaverFilters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}#'+ID+' #miNaverFilters input,#'+ID+' #miNaverFilters select{min-width:0;width:100%}}',
'@media(max-width:960px){#'+ID+' .mi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
'@media(max-width:650px){#'+ID+' .mi-grid,#'+ID+' .mi-duo{grid-template-columns:1fr}#'+ID+' .mi-head{display:block}#'+ID+' .mi-head button{margin-top:10px}#'+ID+' .mi-hero{padding:18px}#'+ID+' h2{font-size:24px}}'
].join('\n');
function mount(){
 if(!$('marketing-action-styles')){const s=document.createElement('style');s.id='marketing-action-styles';s.textContent=css;document.head.appendChild(s)}
 const nav=$('nav'),main=document.querySelector('main.main');if(!nav||!main)return;
 if(!$(ID)){
  const v=document.createElement('section');v.id=ID;v.className='view';v.setAttribute('aria-label','Marketing Intelligence');
  v.innerHTML='<div class="mi-head"><div><div class="mi-eyebrow">SAMPLAS · MARKETING INTELLIGENCE</div><h2>마케팅 데이터 분석</h2><p class="mi-muted">기간을 바꾸고 매출·고객·유입의 변화를 탐색해.</p></div><div><span class="mi-tag" id="miStatus">조회 대기</span> <button id="miReload" type="button">다시 확인</button></div></div><div class="mi-range"><label>분석 기간<select id="miPreset"><option value="1">최근 완료 월</option><option value="3">최근 3개월</option><option value="6">최근 6개월</option><option value="12">최근 12개월</option><option value="custom">직접 선택</option></select></label><label>시작 월<input id="miStart" type="month"></label><label>종료 월<input id="miEnd" type="month"></label><label>비교 기간<select id="miCompare"><option value="previous">직전 동일 기간</option><option value="year">전년 동일 기간</option><option value="custom">직접 비교</option></select></label><label>비교 시작 월<input id="miCompareStart" type="month" disabled></label><label>비교 종료 월<input id="miCompareEnd" type="month" disabled></label><span id="miPeriodHint" class="mi-muted"></span></div><div id="miTabs" class="mi-tabs" role="tablist" aria-label="분석 영역"></div><div id="miInspect" aria-live="polite"></div><div id="miBody" class="mi-loading">조회 전</div>';
  main.appendChild(v);$('miReload').addEventListener('click',()=>state.tab==='naver'?loadNaverReport():load());
  $('miTabs').addEventListener('click',e=>{const b=e.target.closest('[data-mi-tab]');if(!b)return;state.tab=b.getAttribute('data-mi-tab');state.detail=null;state.trace=null;state.traceSerial++;$('miInspect').innerHTML='';showExplorerTab()});
  $('miBody').addEventListener('click',e=>{
    const source=e.target.closest('[data-mi-source]');
    if(source){
      const value=decodeURIComponent(source.getAttribute('data-mi-source'));
      const where=value.lastIndexOf(' / ');
      const channel=where>=0?value.slice(0,where):value,medium=where>=0?value.slice(where+3):null;
      openOrderTrace('NEW',{channel,medium,firstOnly:true});return;
    }
    const trace=e.target.closest('[data-mi-trace]');if(trace){openOrderTrace(trace.getAttribute('data-mi-trace'));return}
    const b=e.target.closest('[data-mi-segment]');if(!b||!state.loadedRows)return;state.detail=Number(b.getAttribute('data-mi-segment'));showSegmentDetail();
  });
  $('miInspect').addEventListener('click',e=>{
    if(e.target.closest('[data-mi-close]'))closeMiInspector()
    const seg=e.target.closest('[data-mi-trace-segment]');if(seg){openOrderTrace(seg.getAttribute('data-mi-trace-segment'));return}
    const month=e.target.closest('[data-mi-evidence-month]');if(month){openOrderTrace(month.getAttribute('data-mi-evidence-segment'),{month:month.getAttribute('data-mi-evidence-month')});return}
    const group=e.target.closest('[data-mi-order-group]');if(group){
      const selected=group.getAttribute('data-mi-order-group');
      if(['ALL','MEMBER','NEW','REPEAT','UNVERIFIED','GUEST','PERSONAL','UNKNOWN'].includes(selected)){state.trace=selected;state.tracePage=1;loadOrderTrace()}
      return;
    }
    const page=e.target.closest('[data-mi-trace-page]');if(page){state.tracePage=Number(page.getAttribute('data-mi-trace-page'));loadOrderTrace()}
    if(e.target.closest('[data-mi-trace-retry]')){loadOrderTrace()}
    if(e.target.closest('[data-mi-trace-close]')){closeMiInspector()}
    if(e.target===$('miInspect'))closeMiInspector()
  });
  $('miInspect').addEventListener('change',e=>{if(e.target.id==='miTraceMonth'){state.traceMonth=e.target.value||null;state.tracePage=1;loadOrderTrace()}});
  $('miInspect').addEventListener('submit',handleMiAuthSubmit);
  $('miBody').addEventListener('submit',handleMiAuthSubmit);
  $('miBody').addEventListener('change',e=>{if(e.target.id==='miTrafficMonth'){state.trafficMonth=e.target.value;loadVisitEvidence()}});

  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('miInspect')?.innerHTML){closeMiInspector()}});
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
 const trace=title==='온라인 주문 수'?'ALL':title==='신규 구매 확인 회원'?'NEW':null;
 const help='집계 기준: '+description+' 해당 월의 주문·구매이력은 미검증 구간이 있을 수 있어.';
 return '<article class="mi-kpi mi-hover" tabindex="0" data-mi-tip="'+esc(help)+'" aria-label="'+esc(help)+'"><small>'+esc(title)+' · ⓘ</small><strong>'+esc(value)+'</strong><p><b'+(negative?' class="down"':'')+'>'+esc(then)+'</b></p><p>'+esc(description)+'</p>'+(trace?'<button type="button" data-mi-trace="'+trace+'">'+(trace==='NEW'?'신규 고객이 구매한 상품 보기':'전체 주문 내역 보기')+'</button>':'')+'</article>';
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
 const rangeLabel=list=>list?.length&&list.every(x=>x?.month)?(list.length===1?list[0].month:list[0].month+' ~ '+list.at(-1).month):'기간 확인 불가';
 const currentPeriod=rangeLabel(rows),previousPeriod=rangeLabel(previous);
 const periodsKnown=currentPeriod!=='기간 확인 불가'&&previousPeriod!=='기간 확인 불가';
 const totalDifference=data.total!==null&&prior.total!==null?data.total-prior.total:null;
 const reconciled=data.complete&&data.discrepancy===0;
 const legend=data.items.map(x=>'<div class="mi-legend-item"><span class="mi-dot" style="background:'+x.color+'"></span><div>'+esc(x.name)+' <em>'+(x.share===null?'비중 미확인':x.share.toFixed(1)+'%')+'</em></div><strong>'+money(x.amount)+'</strong></div>').join('');
 const stack=reconciled?'<div class="mi-stack" role="img" aria-label="온라인 매출 구성 비중">'+data.items.filter(x=>x.amount>0).map(x=>'<span title="'+esc(x.name)+' '+x.share.toFixed(1)+'%" style="width:'+x.share.toFixed(5)+'%;background:'+x.color+'"></span>').join('')+'</div>':'<p class="mi-error">세부 매출 합계와 총매출의 검증이 완료되지 않아 구성 비율 그래프를 표시하지 않아.</p>';
 const movement=data.items.map((x,index)=>{const previousItem=prior.items.find(p=>p.key===x.key);const before=previousItem?previousItem.amount:null;const difference=x.amount!==null&&before!==null?x.amount-before:null;return {index,label:x.name,current:x.amount,prior:before,difference,share:x.share,description:x.desc}}).filter(x=>x.current!==0||x.prior!==0);
 const movementRows=movement.map(x=>'<tr><td><b>'+esc(x.label)+'</b><div class="mi-cell-explain">'+esc(x.description)+'</div></td><td>'+money(x.prior)+'</td><td>'+money(x.current)+'</td><td>'+(x.share===null?'확인 불가':x.share.toFixed(1)+'%')+'</td><td class="'+(x.difference!==null&&x.difference<0?'mi-down':x.difference>0?'mi-up':'')+'">'+(x.difference===null?'비교 불가':(x.difference>0?'+':'')+money(x.difference))+'</td><td><button type="button" class="mi-segment-button" data-mi-segment="'+x.index+'">월별 근거</button></td></tr>').join('');
 const totalDiff=totalDifference;
 const negative=movement.filter(x=>x.difference!==null&&x.difference<0).sort((a,b)=>a.difference-b.difference)[0];
 const positive=movement.filter(x=>x.difference!==null&&x.difference>0).sort((a,b)=>b.difference-a.difference)[0];
 const netSentence=totalDiff===null?'변화 판단 불가':totalDiff>0?'온라인 매출이 '+money(totalDiff)+' 증가했어.':totalDiff<0?'온라인 매출이 '+money(Math.abs(totalDiff))+' 감소했어.':'온라인 매출 총액은 변하지 않았어.';
 const strongest=negative&&positive?'가장 큰 감소 항목은 '+negative.label+' ('+money(negative.difference)+'), 가장 큰 증가 항목은 '+positive.label+' (+'+money(positive.difference)+')이야.':
  negative?'가장 크게 감소한 항목은 '+negative.label+' ('+money(negative.difference)+')이야.':
  positive?'가장 크게 증가한 항목은 '+positive.label+' (+'+money(positive.difference)+')이야.':'항목별 변화는 확인되지 않았거나 비교할 데이터가 부족해.';
 const rowsHtml=rows.map(x=>{
  if(!x)return '<tr><td>월 데이터 없음</td><td colspan="6">조회 실패 · 확인 불가</td></tr>';
  return '<tr><td>'+esc(x.month)+'</td>'+[x.amount,x.newRevenue,x.repeat,x.guestRevenue,x.personalRevenue,x.unverifiedRevenue].map(v=>'<td>'+money(v)+'</td>').join('')+'</tr>';
 }).join('');
 return '<section class="mi-breakdown"><div class="mi-period-bar"><div><span class="mi-period-label">선택한 분석 기간</span><strong>'+esc(currentPeriod)+'</strong><span>'+money(data.total)+'</span></div><div><span class="mi-period-label">'+esc(compareLabel)+'</span><strong>'+esc(previousPeriod)+'</strong><span>'+money(prior.total)+'</span></div></div>'+
 '<h3>온라인 매출을 구성하는 주문 유형</h3><p class="mi-muted">아래 분류는 회원 구매 이력과 결제 방식을 기준으로 나눈 거야. <b>누가 신규 고객인지 모르는 금액을 신규 매출로 추정하지 않아.</b></p>'+
 '<div class="mi-total">'+money(data.total)+'</div>'+stack+
 '<div class="mi-legend">'+legend+'</div>'+
 '<p class="mi-muted">'+(reconciled?'각 매출 구분의 합계가 선택 기간 온라인 매출과 일치해.':'구성 항목 합계 검증이 되지 않았어. 누락·불일치 확인이 필요해.')+' 비회원·개인결제는 회원 첫 구매·재구매 매출과 다른 구분이야.</p>'+
 '<div class="mi-findings" role="group" aria-label="이번 기간 매출 변화 요약"><b>이 표에서 먼저 볼 것</b><p>'+esc(netSentence)+' '+esc(strongest)+'</p><p class="mi-muted">이것은 매출 변화를 항목별로 분해한 결과야. 매출 변화의 실제 원인이나 광고 기여가 확인됐다는 뜻은 아니야.</p></div>'+
 '<div class="mi-table-context"><b>고객·주문 유형별 매출 비교</b><p>왼쪽부터 각 구분의 매출, 선택 기간 전체 매출에서 차지하는 비율, 비교 기간 대비 증감이야. 항목별 의미는 이름 아래에, 월별 상세는 오른쪽에서 볼 수 있어.</p></div>'+
 '<div class="mi-table-wrap"><table class="mi-table"><caption>선택 기간 '+esc(currentPeriod)+' / 비교 기간 '+esc(previousPeriod)+' / 단위 원</caption><thead><tr><th scope="col">주문·고객 구분</th><th scope="col">비교 '+esc(previousPeriod)+'</th><th scope="col">선택 '+esc(currentPeriod)+'</th><th scope="col">선택 기간 비중</th><th scope="col">매출 증감</th><th scope="col">상세</th></tr></thead><tbody>'+movementRows+
 '<tr class="mi-total-row"><th scope="row">온라인 매출 합계</th><td>'+money(prior.total)+'</td><td>'+money(data.total)+'</td><td>'+(data.total===null?'확인 불가':'100%')+'</td><td>'+(totalDiff===null?'비교 불가':(totalDiff>0?'+':'')+money(totalDiff))+'</td><td>전체</td></tr></tbody></table></div>'+
 '<details><summary>월별 매출 구성 펼쳐보기</summary><p class="mi-muted">선택한 각 월의 고객·주문별 매출이야. 합계에 포함된 다른 달도 함께 확인할 수 있어.</p><div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>월</th><th>온라인 전체</th><th>신규 회원</th><th>재구매 회원</th><th>비회원</th><th>개인결제</th><th>구매 이력 미확인</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div></details>'+
 '<details><summary>집계 방식·고객 구분에 대한 설명</summary><ul style="padding-left:20px;font-size:12px;line-height:1.9">'+data.items.map(x=>'<li><b>'+esc(x.name)+'</b>: '+esc(x.desc)+'</li>').join('')+'</ul><p class="mi-muted">스타일리스트·직원·프레스 고객 유형은 현재 온라인 주문 데이터만으로 분리할 수 없어. 비회원은 신규 고객과 동일하지 않아.</p></details></section>';
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
 const rows=keys.map(k=>'<tr><td>'+esc(k)+'</td><td>'+fmt(a.map.get(k)??null)+'</td><td>'+fmt(b.map.get(k)??null)+'</td><td>'+(a.map.has(k)&&b.map.has(k)?(a.map.get(k)-b.map.get(k)>0?'+':'')+fmt(a.map.get(k)-b.map.get(k)):'비교 불가')+'</td><td>'+(a.map.has(k)?'<button type="button" data-mi-source="'+encodeURIComponent(k)+'">첫 구매 주문 보기</button>':'해당 기간 없음')+'</td></tr>').join('');
 const any=current.some(x=>x?.__meta?.completeness!=='COMPLETE'||x?.analyticsCoverage!=='COMPLETE')||prior.some(x=>x?.__meta?.completeness!=='COMPLETE'||x?.analyticsCoverage!=='COMPLETE');
 return '<section class="mi-breakdown"><h3>첫 구매 고객은 어떤 경로에서 왔을까?</h3><p class="mi-muted">Cafe24 Analytics와 주문을 연결한 회원 첫 구매 유입 분류야. 실제 방문 수, 광고 증분 효과, 고객 획득의 인과관계가 아니야.</p>'+
 '<div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>유입 출처 / 매체</th><th>선택 기간 신규 회원</th><th>'+esc(compareLabel)+'</th><th>차이</th><th>상세</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5">확인 가능한 유입 기록이 없어</td></tr>')+'</tbody></table></div>'+
 '<p class="mi-error">'+(any||a.gaps||b.gaps?'유입 채널 분류에 누락이나 검증되지 않은 구간이 있어. 채널별 원인 확정·예산 판단 금지.':'유입 분류 확인 완료. 다만 유입 출처와 구매 기여는 별개야.')+'</p></section>';
}
async function load(){
 if(!$('miBody'))return;
 const token=++state.serial;state.loaded=false;state.loading=true;state.trace=null;state.traceSerial++;state.trafficSerial++;state.detail=null;if($('miInspect'))$('miInspect').innerHTML='';
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

const EXPLORER_TABS=[['overview','매출 구조'],['customers','고객 분석'],['acquisition','유입 · 광고'],['products','상품 · 콘텐츠'],['naver','네이버 실매출']];
function showExplorerTab(){
 const tabs=$('miTabs');if(tabs)tabs.innerHTML=EXPLORER_TABS.map(([key,label])=>'<button type="button" role="tab" data-mi-tab="'+key+'" aria-selected="'+(state.tab===key)+'">'+label+'</button>').join('');
 for(const pane of document.querySelectorAll('#miBody .mi-pane'))pane.hidden=pane.getAttribute('data-mi-pane')!==state.tab;
 const naverSelected=state.tab==='naver';
 if(naverSelected&&!$('miNaverPane')&&$(ID))createNaverPane($(ID));
 if($('miNaverPane'))$('miNaverPane').hidden=!naverSelected;
 if($('miBody'))$('miBody').hidden=naverSelected;
 const legacyRange=$(ID)?.querySelector('.mi-range');if(legacyRange)legacyRange.hidden=naverSelected;
 if(naverSelected&&!naverReport.request&&state.active)loadNaverReport();
 if(state.tab==='acquisition'){loadAdEvidence();loadVisitEvidence()}
 showSegmentDetail();
}
function organizeExplorer(){
 const body=$('miBody');if(!body||!body.children.length)return;
 // Known composition of the verified legacy read-only analysis renderer.
 const original=Array.from(body.children);
 if(original.length<13)return; // fail safe: retain original report rather than erase it
 const groups=[
  ['overview',[0,1,2,3]],
  ['customers',[6,7,8,9]],
  ['acquisition',[4,5]],
 ];
 const layout=document.createDocumentFragment();
 for(const [name,indices] of groups){
  const section=document.createElement('section');section.className='mi-pane';section.setAttribute('data-mi-pane',name);
  for(const idx of indices)if(original[idx])section.appendChild(original[idx]);
  if(name==='acquisition'){const visit=document.createElement('div');visit.id='miVisitEvidence';section.appendChild(visit);const ads=document.createElement('div');ads.id='miAdsEvidence';section.appendChild(ads)}
  layout.appendChild(section);
 }
 const productPane=document.createElement('section');productPane.className='mi-pane';productPane.setAttribute('data-mi-pane','products');
 productPane.innerHTML='<div class="mi-provisional"><h3>브랜드·상품별 판매 기여</h3><p>현재 제품·브랜드 API는 있지만 고객 유형별 주문 매출과 연결된 검증 자료가 부족해. 동일 주문에서 매출을 중복 없이 분배하는 검증 전에는 상품별 기여도를 표시하지 않아.</p><p class="mi-muted">연결 예정: 상품 실결제 매출, 주문 수, 할인, 재고, 고객 유형 및 매출 기여도</p></div>'+
 '<div class="mi-provisional"><h3>SAMPLAS / VEIL 콘텐츠 비교</h3><p>게시물별 도달·저장·참여 데이터와 실제 구매를 연결할 근거가 필요해. 먼저 계정별 피드·릴스·행사/팝업 분류와 게시물 매핑을 검증해야 해.</p><p class="mi-muted">현재 상태: 콘텐츠 → 구매 귀속 미검증. 임의 ROAS나 인과관계 표시 없음</p></div>';
 layout.appendChild(productPane);
 const quality=document.createElement('div');quality.className='mi-pane-quality';
 for(const idx of [10,11,12])if(original[idx])quality.appendChild(original[idx]);
 body.replaceChildren(layout,quality);
 const labels=['신규 회원','재구매 회원','비회원','개인결제','구매 이력 미확인','회원 구분 불가'];
 const segments=body.querySelectorAll('[data-mi-pane="overview"] .mi-legend-item');
 segments.forEach((row,i)=>{
  if(i>=labels.length)return;
  const button=document.createElement('button');button.type='button';button.className='mi-segment-button';button.setAttribute('data-mi-segment',String(i));button.textContent='월별 근거 보기';
  row.appendChild(button);
 });
 showExplorerTab();
}
const naverReport={request:null,serial:0,model:null};
const naverEndpoint='/api/marketing-intelligence/naver-attribution';
const naverMetrics=[
 ['spend','광고비',money],['impressions','노출',fmt],['clicks','클릭',fmt],
 ['ctr','CTR',n=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'확인 불가'],['cpc','CPC',money],
 ['orders','귀속 주문',fmt],['paid','실결제',money],['refund','취소·환불',money],
 ['net','귀속 순매출',money],['roas','실매출 ROAS',n=>Number.isFinite(n)?n.toFixed(2)+'배':'확인 불가'],
 ['platformRevenue','네이버 플랫폼 전환 매출',money],['newCustomers','신규 구매 고객',fmt],
 ['repeatCustomers','재구매 고객',fmt]
];
const naverStatus={VERIFIED:'확인 완료',COMPLETE:'확인 완료',PENDING:'수집 대기',UNVERIFIED:'미검증',PARTIAL:'부분 확인',UNAVAILABLE:'확인 불가'};
const reportStatus=value=>naverStatus[value]??value??'미검증';
function dateOffset(day,offset){
 const date=new Date(day+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()+offset);
 return date.toISOString().slice(0,10);
}
function naverRange(row,filters){
 const bounds=/^\d{4}-\d{2}-\d{2}$/;
 if(bounds.test(row.since)&&bounds.test(row.until))return [row.since,row.until];
 const key=String(row.key??'');
 if(filters.grain==='month'&&/^\d{4}-\d{2}$/.test(key)){
  const end=new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5)),0)).toISOString().slice(0,10);
  return [key+'-01',end];
 }
 if(bounds.test(key))return [key,dateOffset(key,filters.grain==='week'?6:0)];
 return [filters.since,filters.until];
}
function createNaverPane(view){
 const pane=document.createElement('section');
 pane.id='miNaverPane';pane.className='mi-pane';pane.hidden=true;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 pane.innerHTML=`<div class="mi-section"><h3>네이버 광고 귀속 실매출</h3><span class="mi-muted">KST · 주문번호 기준</span></div>
 <form id="miNaverFilters" class="mi-range">
  <label>시작일<input type="date" name="since" required value="${dateOffset(today,-30)}"></label>
  <label>종료일<input type="date" name="until" required value="${dateOffset(today,-1)}"></label>
  <label>집계 단위<select name="grain"><option value="day">일별</option><option value="week" selected>주별</option><option value="month">월별</option></select></label>
  <label>광고 유입 브랜드<select name="brand"><option value="">전체 브랜드</option></select></label>
  <button type="submit">조회</button><button type="button" id="miNaverExport" disabled>Excel 다운로드</button>
 </form>
 <div id="miNaverReport" aria-live="polite"></div>`;
 view.appendChild(pane);
 const form=$('miNaverFilters');
 form.addEventListener('submit',e=>{e.preventDefault();loadNaverReport(Object.fromEntries(new FormData(form)));});
 $('miNaverExport').addEventListener('click',downloadNaverReport);
 $('miNaverReport').addEventListener('submit',handleMiAuthSubmit);
 $('miNaverReport').addEventListener('change',e=>{if(e.target.id==='miNaverSort')renderNaverRows(e.target.value);});
 $('miNaverReport').addEventListener('click',e=>{
  const button=e.target.closest('[data-mi-naver-detail]');if(!button)return;
  const row=naverReport.model?.[button.dataset.miNaverScope || 'brandRows']?.[Number(button.dataset.miNaverDetail)];
  openNaverDetail(row);
 });
}
function naverQuery(filters,additional={}){
 const query=new URLSearchParams({...filters,...additional});
 if(!query.get('brand'))query.delete('brand');
 return naverEndpoint+'?'+query;
}
async function loadNaverReport(filters=naverReport.request??Object.fromEntries(new FormData($('miNaverFilters')))){
 const panel=$('miNaverReport');
 if(!panel)return;
 naverReport.request=filters;
 naverReport.model=null;
 $('miNaverExport').disabled=true;
 const serial=++naverReport.serial;
 if(!filters.since||!filters.until||filters.since>filters.until){
  panel.textContent='시작일과 종료일을 확인해 주세요.';
  return;
 }
 panel.textContent='네이버 광고와 Cafe24 귀속 데이터를 조회하고 있습니다.';
 try{
  const data=await get(naverQuery(filters));
  if(serial!==naverReport.serial)return;
  naverReport.model=data;
  const brand=$('miNaverFilters').elements.namedItem('brand');
  const available=Array.isArray(data.brands)?data.brands:[];
  brand.replaceChildren(new Option('전체 브랜드',''),...available.map(x=>new Option(x.name??x.code,x.code)));
  if(filters.brand&&!available.some(x=>x.code===filters.brand))brand.add(new Option(filters.brand,filters.brand));
  brand.value=filters.brand;
  const current=data.totals??{},previous=data.previous?.totals??data.previous??{};
  const period=data.period??filters,comparison=data.comparison??{};
  const generated=data.generatedAt?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(data.generatedAt))+' KST':'미확인';
  const cards=naverMetrics.map(([key,title,format])=>{
   const actual=current[key];
   const known=actual==null&&current.known?.[key]>0?' · 확인된 부분 '+format(current.known[key]):'';
   return `<article class="mi-kpi"><small>${title}</small><strong>${esc(format(actual))}</strong><p>직전 기간 ${esc(format(previous[key]))}${esc(known)}</p></article>`;
  }).join('');
  panel.innerHTML=`<div class="mi-note"><strong>${esc(reportStatus(data.trackingStatus??current.trackingStatus))}</strong> · 마지막 갱신 ${esc(generated)}
   <p>선택 ${esc(period.since)} ~ ${esc(period.until)} · 직전 동일 기간 ${esc(comparison.since??'미확인')} ~ ${esc(comparison.until??'미확인')}</p>
   <p>광고비는 선택 기간 네이버 집계, 매출은 같은 기간 Cafe24 주문 귀속 기준입니다. 취소·환불 상태는 마지막 갱신 시각 기준입니다.</p>
   <p>광고 통계 ${esc(reportStatus(current.adStatus))} · 네이버 원천 시각 ${esc(data.sources?.statsAt??'미확인')}</p>
   <p>데이터가 늦게 도착할 수 있습니다. 귀속 매출은 광고로 인한 증분 매출과 별개입니다.</p></div>
   <section class="mi-grid" aria-label="네이버 광고 및 실제 매출 지표">${cards}</section>
   <h3>기간별 성과</h3><div id="miNaverPeriods" class="mi-table-wrap" tabindex="0"></div>
   <div class="mi-section"><h3>브랜드별 광고 성과</h3><label>정렬 <select id="miNaverSort"><option value="spend">광고비 높은 순</option><option value="roas">ROAS 높은 순</option></select></label></div>
   <button type="button" data-mi-naver-detail="-1">전체 주문 근거 보기</button>
   <div id="miNaverRows" class="mi-table-wrap" tabindex="0" role="region" aria-label="브랜드별 광고 성과 표"></div>
   <p id="miNaverExportStatus" class="mi-muted" role="status"></p>`;
  $('miNaverExport').disabled=false;
  renderNaverRows('spend');
 }catch(error){
  if(serial!==naverReport.serial)return;
  panel.innerHTML=error.message==='HTTP 401'||error.message==='HTTP 403'
   ?'<p>네이버 광고 귀속 보고서는 운영자 인증이 필요합니다.</p>'+operatorAuthForm()
   :'<p role="status">보고서 조회에 실패했습니다. 기간을 확인한 뒤 다시 조회해 주세요.</p>';
 }
}
function renderNaverRows(sort){
 const model=naverReport.model,container=$('miNaverRows');
 if(!container||!model)return;
 const rows=(model.brandRows??[]).map((row,index)=>({row,index}));
 const dates=$('miNaverPeriods');
 if(dates) dates.innerHTML='<table class="mi-table"><thead><tr><th>선택 기간</th><th>광고비</th><th>클릭</th><th>귀속 주문</th><th>귀속 순매출</th><th>직전 기간 광고비 / 순매출</th><th>추적 상태</th></tr></thead><tbody>'+model.rows.map((row,index)=>{
  const prev=model.comparisonRows?.[index];
  const details=value=>`<button type="button" data-mi-naver-scope="rows" data-mi-naver-detail="${index}">${esc(value)}</button>`;
  return `<tr><th scope="row">${esc(row.since+' ~ '+row.until)}</th><td>${esc(money(row.spend))}</td><td>${esc(fmt(row.clicks))}</td><td>${details(fmt(row.orders))}</td><td>${details(money(row.net))}</td><td>${prev?esc(prev.since+' ~ '+prev.until+' · '+money(prev.spend)+' / '+money(prev.net)):'—'}</td><td>${esc(reportStatus(row.trackingStatus))}</td></tr>`;
 }).join('')+'</tbody></table>';
 rows.sort((a,b)=>(b.row[sort]??-Infinity)-(a.row[sort]??-Infinity));
 const metrics=naverMetrics;
 container.innerHTML=`<table class="mi-table"><thead><tr><th scope="col">기간 · 유입 브랜드</th>${metrics.map(([,label])=>'<th scope="col">'+label+'</th>').join('')}<th scope="col">추적</th></tr></thead><tbody>${rows.map(({row,index})=>{
  const brand=(model.brands??[]).find(b=>b.code===row.brandCode);
  const title=brand?.name??row.label??row.key;
  return `<tr><th scope="row">${esc(title)}</th>${metrics.map(([key,,format])=>{
   const value=esc(format(row[key]));
   return `<td>${key==='orders'||key==='net'?`<button type="button" data-mi-naver-detail="${index}" aria-label="${esc(title+' 주문 및 매출 근거 보기')}">${value}</button>`:value}</td>`;
  }).join('')}<td>${esc(reportStatus(row.trackingStatus))}</td></tr>`;
 }).join('')||`<tr><td colspan="${metrics.length+2}">반환된 성과 행이 없습니다.</td></tr>`}</tbody></table>`;
}
async function openNaverDetail(row){
 const filter={...naverReport.request};
 if(row){
  const [since,until]=naverRange(row,filter);
  filter.since=since>filter.since?since:filter.since;
  filter.until=until<filter.until?until:filter.until;
  if(row.brandCode)filter.brand=row.brandCode;
 }
 const modal=$('miInspect');
 const heading='광고 귀속 주문 근거';
 modal.innerHTML=`<section class="mi-trace" role="dialog" aria-modal="true" aria-label="${heading}"><button type="button" data-mi-trace-close>닫기</button><h3>${heading}</h3><p data-mi-naver-order-content>주문을 조회하고 있습니다.</p></section>`;
 modal.querySelector('[data-mi-trace-close]').focus();
 const content=modal.querySelector('[data-mi-naver-order-content]');
 try{
  const data=await get(naverQuery(filter,{detail:'1'}));
  if(!content.isConnected)return;
  const orders=data.orders??[];
  const list=document.createElement('div');
  list.className='mi-order-list';
  list.innerHTML=orders.map(order=>`<details class="mi-order-card"><summary><strong>${esc(order.orderId)}</strong><span>${esc(order.day)} · 순매출 ${esc(money(order.net))}</span></summary>
   <p>광고 유입 브랜드 ${esc(order.acquisitionBrand??'미확인')} · 구매 브랜드 ${esc((Array.isArray(order.purchaseBrands)?order.purchaseBrands.join(', '):order.purchaseBrands)||'미확인')}</p>
   <p>실결제 ${esc(money(order.paid))} · 취소·환불 ${esc(money(order.refund))} · 고객 ${esc(order.customerType??'미확인')} · ${esc(reportStatus(order.status))}</p>
   <ul>${(order.items??[]).map(item=>`<li>${esc(item.name)} · ${esc(fmt(item.quantity))}개 · ${esc(item.brand??'미확인')}</li>`).join('')}</ul></details>`).join('');
  if(orders.length)content.replaceWith(list);
  else content.textContent='표시할 주문 근거가 없습니다. 추적 상태를 확인해 주세요.';
 }catch(error){
  if(!content.isConnected)return;
  content.textContent=error.message==='HTTP 401'||error.message==='HTTP 403'
   ?'운영자 인증 후 주문 근거를 다시 조회해 주세요.':'주문 근거를 조회할 수 없습니다.';
 }
}
async function downloadNaverReport(){
 if(!naverReport.model)return;
 const status=$('miNaverExportStatus');
 const button=$('miNaverExport');
 button.disabled=true;
 status.textContent='Excel을 준비하고 있습니다.';
 try{
  const response=await fetch(naverQuery(naverReport.request,{format:'xlsx'}),{credentials:'same-origin'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');
  link.href=url;link.download='NAVER-광고귀속-'+naverReport.request.since+'_'+naverReport.request.until+'.xlsx';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status.textContent='Excel 다운로드를 시작했습니다.';
 }catch(error){
  status.textContent=error.message==='HTTP 401'||error.message==='HTTP 403'
   ?'운영자 세션을 확인한 뒤 다시 조회해 주세요.':'Excel 다운로드에 실패했습니다.';
 }finally{button.disabled=!naverReport.model;}
}

function operatorAuthForm(){
 return '<form data-mi-auth-form class="mi-auth-form" autocomplete="off"><label>운영자 아이디<input name="login" autocomplete="username" required></label><label>운영자 비밀번호<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">인증 후 상세 조회</button><span class="mi-auth-status" role="status"></span></form><p class="mi-muted">운영자 계정으로 인증하며 비밀번호를 저장하지 않아.</p>';
}
async function handleMiAuthSubmit(e){
 const form=e.target.closest?.('[data-mi-auth-form]');if(!form)return;
 e.preventDefault();
 const login=String(form.elements.namedItem('login')?.value||'');
 const password=String(form.elements.namedItem('password')?.value||'');
 const status=form.querySelector('.mi-auth-status');
 if(!login||!password)return;
 if(status)status.textContent='권한을 확인하고 있어.';
 form.elements.namedItem('password').value='';
 try{
  const response=await fetch('/api/operator/session',{method:'POST',credentials:'same-origin',headers:{Authorization:'Basic '+btoa(login+':'+password),Accept:'application/json'}});
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.ok!==true)throw Error('LOGIN_FAILED');
  if(status)status.textContent='인증 완료. 상세 조회 중…';
  if(state.trace)loadOrderTrace();
  if(state.tab==='acquisition')loadVisitEvidence();
  if(state.tab==='naver')loadNaverReport();
 }catch{
  if(status)status.textContent='운영자 인증 실패. 계정이나 권한을 확인해 줘.';
 }
}
function closeMiInspector(){
 state.trace=null;state.detail=null;state.traceSerial++;
 const el=$('miInspect');if(el)el.innerHTML='';
}
function showSegmentDetail(){
 const el=$('miInspect');if(!el||state.trace)return;
 const data=state.loadedRows,ix=state.detail;
 if(ix===null||!data||!Number.isInteger(ix)||ix<0||ix>5){el.innerHTML='';return}
 const specs=[
  ['신규 회원 매출','newRevenue','NEW','검증된 첫 구매 회원 주문'],
  ['재구매 회원 매출','repeat','REPEAT','이전에 구매한 이력이 확인된 회원'],
  ['비회원 주문 매출','guestRevenue','GUEST','네이버페이 포함, 신규 고객과 동일하지 않음'],
  ['개인결제창 주문 매출','personalRevenue','PERSONAL','스타일리스트 여부는 아직 판별 불가'],
  ['구매 이력 미확인 회원','unverifiedRevenue','UNVERIFIED','첫 구매/재구매를 분류할 근거 부족'],
  ['회원 여부 추적 불가','identityUnknownRevenue','UNKNOWN','회원과 비회원을 판별할 근거 부족']
 ];
 const [name,key,segment,definition]=specs[ix];
 const total=sum(data.current,key),previous=sum(data.previous,key);
 const difference=total!==null&&previous!==null?total-previous:null;
 const all=[...data.current,...data.previous].filter(x=>x&&Number.isFinite(x[key]));
 const top=Math.max(1,...all.map(x=>x[key]));
 const rows=(list,kind)=>list.map(x=>{
   const month=x?.month,amount=x?.[key],pct=Number.isFinite(amount)?Math.max(0,Math.min(100,amount/top*100)):0;
   return '<div class="mi-evidence-row"><strong>'+esc(month||'월 미확인')+'</strong><div class="mi-evidence-bar"><span style="width:'+pct.toFixed(2)+'%"></span></div><b>'+money(amount)+'</b>'+
    (month?'<button type="button" data-mi-evidence-month="'+esc(month)+'" data-mi-evidence-segment="'+segment+'">'+esc(month)+' 주문 확인</button>':'')+'</div>';
 }).join('')||'<p class="mi-muted">비교 가능한 자료 없음</p>';
 const period=list=>list?.length?list[0]+' ~ '+list.at(-1):'조회 불가';
 el.innerHTML='<section class="mi-inspect" role="dialog" aria-modal="true" aria-label="'+esc(name)+' 월별 근거"><button type="button" data-mi-close aria-label="상세 닫기">닫기 ✕</button>'+
  '<span class="mi-eyebrow">MONTHLY EVIDENCE · 월별 매출 근거</span><h3>'+esc(name)+'</h3><p class="mi-muted">'+esc(definition)+'</p>'+
  '<div class="mi-trace-summary"><div class="mi-trace-stat"><small>선택 기간 매출</small><strong>'+money(total)+'</strong></div><div class="mi-trace-stat"><small>비교 기간 매출</small><strong>'+money(previous)+'</strong></div><div class="mi-trace-stat"><small>매출 변화</small><strong>'+(difference===null?'비교 불가':(difference>0?'+':'')+money(difference))+'</strong></div></div>'+
  '<div class="mi-period-evidence"><div class="mi-evidence-col"><h4>선택 기간 · '+esc(period(data.months))+'</h4>'+rows(data.current,'selected')+'</div>'+
  '<div class="mi-evidence-col"><h4>비교 기간 · '+esc(period(data.prevMonths))+'</h4>'+rows(data.previous,'compared')+'</div></div>'+
  '<p class="mi-inline-note">각 월의 막대는 여기 표시된 월 중 최댓값에 대한 상대적인 크기야. 주문 확인을 누르면 해당 월의 실제 주문·상품 목록을 볼 수 있어.</p>'+
  '<p class="mi-inline-note">Cafe24 CRM 기준, 구매 이력 검증이 부족하거나 월 마감이 완료되지 않은 값은 잠정치야.</p></section>';
}
function openOrderTrace(segment,filter=null){
 if(!state.loadedRows||!['ALL','MEMBER','NEW','REPEAT','GUEST','PERSONAL','UNVERIFIED','UNKNOWN'].includes(segment))return;
 state.trace=segment;state.tracePage=1;state.traceFilter=filter||null;
 state.traceMonth=filter?.month||null;
 if(filter?.channel&&!filter.month){
  const idx=state.loadedRows.acquisition.findLastIndex(a=>a?.firstPurchaseChannels?.some(row=>(row.channel||'UNKNOWN')===filter.channel&&(row.medium||null)===(filter.medium||null)));
  if(idx>=0)state.traceMonth=state.loadedRows.months[idx];
 }
 state.detail=null;
 loadOrderTrace();
}
function renderMiTraceOverview(data,group){
 const overview=data?.overview;
 if(!overview?.all||!Array.isArray(overview.buckets))return '<p class="mi-error">고객 유형별 주문 요약을 검증하지 못했어. 숫자를 임의로 배분하지 않아.</p>';
 const all=overview.all,groups=overview.buckets,memberTypes=overview.memberTypes||[];
 const label={ALL:'전체 주문',MEMBER:'회원',NEW:'신규 구매 회원',REPEAT:'재구매 회원',UNVERIFIED:'구매 이력 미확인 회원',
   GUEST:'비회원',PERSONAL:'개인결제',UNKNOWN:'추적 불가'};
 const get=k=>k==='ALL'?all:[...groups,...memberTypes].find(x=>x.key===k);
 const preview=record=>{
  const list=record?.preview||[];
  return '<div class="mi-order-preview" role="tooltip"><strong>최근 주문 미리보기</strong>'+
    (list.length?list.map(r=>'<p>'+esc(r.date)+' · '+money(r.paidAmount)+'<span>'+esc(r.anonymousCustomer||'비회원 / 미식별')+' · '+esc(r.product||'상품 미확인')+'</span></p>').join(''):'<p>이 기간에 해당 주문이 없어.</p>')+
    '<p>클릭하면 전체 주문 목록과 구매 상품을 볼 수 있어.</p></div>';
 };
 const navButton=(k,child=false)=>{
  const rec=get(k),num=rec?.orders;
  return '<div class="mi-order-filter-wrap"><button type="button" class="mi-order-filter'+(child?' mi-order-filter-child':'')+'" data-mi-order-group="'+k+'" aria-pressed="'+(group===k)+'" aria-label="'+esc(label[k])+' '+fmt(num)+'건. 클릭해 주문 보기">'+
    '<span>'+esc(label[k])+'</span><strong>'+(Number.isFinite(num)?fmt(num)+'건':'조회 불가')+'</strong></button>'+preview(rec)+'</div>';
 };
 const groupCount=groups.reduce((n,g)=>n+g.orders,0);
 const groupAmount=groups.reduce((n,g)=>n+g.paidAmount,0);
 const reconciled=groupCount===all.orders&&groupAmount===all.paidAmount;
 return '<div class="mi-trace-summary"><div class="mi-trace-stat"><small>전체 온라인 주문</small><strong>'+fmt(all.orders)+'건</strong></div>'+
   '<div class="mi-trace-stat"><small>온라인 실결제 매출</small><strong>'+money(all.paidAmount)+'</strong></div>'+
   '<div class="mi-trace-stat"><small>유형별 주문 합계</small><strong>'+(reconciled?'일치 · '+fmt(groupCount)+'건':'검증 필요')+'</strong></div></div>'+
   '<p class="mi-trace-lead">왼쪽에서 회원 유형을 선택해 주문을 좁혀봐. <b>유형에 마우스를 올리면 최근 주문 3건을 미리 확인</b>할 수 있어.</p>'+
   '<div class="mi-trace-layout"><nav class="mi-trace-nav" aria-label="주문 고객 유형 필터"><h4>고객·결제 유형별 주문</h4>'+
   navButton('ALL')+navButton('MEMBER')+
   '<div class="mi-order-filter-children">'+memberTypes.map(x=>navButton(x.key,true)).join('')+'</div>'+
   '<div class="mi-order-unverified" tabindex="0" title="Clients의 오프라인 스타일리스트 분류는 Cafe24 온라인 주문과 검증된 연결키가 없어 별도로 셀 수 없어."><b>스타일리스트 · 확인 불가</b><div>온라인 주문으로 분리할 식별 근거 없음</div></div>'+
   navButton('GUEST')+navButton('PERSONAL')+navButton('UNKNOWN')+'</nav>'+
   '<div class="mi-order-results" id="miTraceResults"></div></div>';
}
function miProductEvidenceLabel(state){
 if(state==='PRODUCT_ITEMS_NOT_IN_CACHE')return '상품 원본 미수집';
 if(state==='EARLIER_ORDER_OBSERVATION_UNVERIFIED_CANCELLATIONS')return '이전 기록에 있는 상품명 · 이후 취소 여부 미검증';
 if(state==='PERSONAL_PAYMENT_NAME_SUPPRESSED')return '개인결제 상품명 비공개';
 if(state==='ORDER_ITEMS_LATEST_OBSERVATION')return '';
 return '상품 원천 상태 확인 필요';
}
async function loadOrderTrace(){
 const el=$('miInspect'),data=state.loadedRows;
 if(!el||!data||!state.trace)return;
 const reqId=++state.traceSerial,group=state.trace,page=state.tracePage,filter=state.traceFilter;
 const month=state.traceMonth;
 const start=month||data.months[0],end=month||data.months.at(-1);
 const title='온라인 주문 상세 분석';
 const sourceLabel=filter?.channel?' · 유입 '+filter.channel+(filter.medium?' / '+filter.medium:''):'';
 const monthOptions=[...new Set([...data.prevMonths,...data.months])].filter(Boolean).sort();
 const select='<label>조회 기간 <select id="miTraceMonth"><option value=""'+(month?'':' selected')+'>선택 기간 전체 ('+data.months[0]+' ~ '+data.months.at(-1)+')</option>'+
  monthOptions.map(m=>'<option value="'+esc(m)+'"'+(m===month?' selected':'')+'>'+esc(m)+'</option>').join('')+'</select></label>';
 const sameContext=state.traceContext===start+'|'+end+'|'+(filter?.channel||'')+'|'+(filter?.medium||'')+'|'+Boolean(filter?.firstOnly);
 if(!sameContext){state.traceContext=null;state.traceOverview=null}
 if(!el.querySelector('.mi-trace')||!sameContext){
  el.innerHTML='<section class="mi-trace" role="dialog" aria-modal="true" aria-label="'+title+'"><button type="button" data-mi-trace-close aria-label="주문 상세 닫기">닫기 ✕</button><span class="mi-eyebrow">ORDER EXPLORER</span><h3>'+title+esc(sourceLabel)+'</h3><div class="mi-trace-controls">'+select+'</div><p>고객 유형과 주문 내역을 조회하고 있어.</p></section>';
 }else{
  const results=$('miTraceResults');if(results)results.innerHTML='<p class="mi-muted">주문 필터를 적용하고 있어.</p>';
 }
 try{
  const result=await get('/api/crm/order-trace?month='+encodeURIComponent(start)+'&from='+encodeURIComponent(start)+'&to='+encodeURIComponent(end)+
     '&segment='+encodeURIComponent(group)+'&page='+page+'&limit=20'+(filter?.firstOnly?'&firstOnly=true':'')+
     (filter?.channel?'&channel='+encodeURIComponent(filter.channel):'')+(filter?.medium?'&medium='+encodeURIComponent(filter.medium):''));
  if(reqId!==state.traceSerial||state.trace!==group||state.traceMonth!==month)return;
  if(!result?.overview?.all||!Array.isArray(result.overview.buckets))throw new Error('UNRECONCILED_OVERVIEW');
  state.traceContext=start+'|'+end+'|'+(filter?.channel||'')+'|'+(filter?.medium||'')+'|'+Boolean(filter?.firstOnly);
  state.traceOverview=result.overview;
  const all=result.overview.all,buckets=result.overview.buckets;
  if(buckets.reduce((n,g)=>n+g.orders,0)!==all.orders||buckets.reduce((n,g)=>n+g.paidAmount,0)!==all.paidAmount)throw new Error('UNRECONCILED_TOTALS');
  const titleByGroup={ALL:'전체 주문',MEMBER:'회원 주문',NEW:'신규 구매 회원',REPEAT:'재구매 회원',UNVERIFIED:'구매 이력 미확인',GUEST:'비회원 주문',PERSONAL:'개인결제 주문',UNKNOWN:'추적 불가 주문'};
  const records=Array.isArray(result.rows)?result.rows:[];
  const cards=records.map(r=>{
   const productItems=r.products?.length?r.products.map(x=>'<div class="mi-purchased-product">'+esc(x.name||'상품명 미확인')+' · '+fmt(x.quantity)+'개'+(x.productNo?' <span class="mi-muted">#'+esc(x.productNo)+'</span>':'')+'</div>').join(''):'<span class="mi-muted">'+(r.segment==='PERSONAL'?'개인결제 상품명 비공개':'상품 원본 미수집')+'</span>';
   const status=miProductEvidenceLabel(r.productEvidence);
   const channel=r.acquisition?.channel==='UNKNOWN'?'주문 유입 기록 없음':r.acquisition?.channel==='(no ad / direct)'?'광고 식별 없음 / 직접 유입 가능':r.acquisition?.channel||'조회 불가';
   return '<details class="mi-order-card"><summary><span><b>'+esc(r.date)+' · '+esc(r.anonymousCustomer||'비회원 / 미식별')+'</b><small>'+esc(titleByGroup[r.segment]||'주문')+' · '+esc(r.products?.[0]?.name||'구매 상품 확인하기')+'</small></span><strong>'+money(r.paidAmount)+'</strong></summary>'+
   '<div class="mi-order-products"><b>구매 상품 및 수량</b>'+productItems+
   '<p class="mi-muted">기록된 유입: '+esc(channel)+(r.acquisition?.medium?' / '+esc(r.acquisition.medium):'')+'</p>'+
   (status?'<p class="mi-muted">상품 데이터: '+esc(status)+'</p>':'')+'</div></details>';
  }).join('');
  const max=Math.max(1,Math.ceil(Number(result.totals?.orders||0)/20));
  const resultHtml='<h4>'+esc(titleByGroup[group])+' · '+fmt(result.totals?.orders)+'건</h4>'+
   '<p class="mi-muted">결제액 '+money(result.totals?.paidAmount)+' · 주문 '+fmt(result.totals?.orders)+'건'+
   (Number.isFinite(result.totals?.members)?' · 식별 회원 '+fmt(result.totals.members)+'명':'')+'</p>'+
   '<div class="mi-order-list">'+(cards||'<div class="mi-provisional">이 유형에 해당하는 주문이 없어.</div>')+'</div>'+
   '<div class="mi-trace-controls"><button type="button" data-mi-trace-page="'+(page-1)+'"'+(page===1?' disabled':'')+'>이전</button><span>'+page+' / '+max+' 페이지</span><button type="button" data-mi-trace-page="'+(page+1)+'"'+(page>=max?' disabled':'')+'>다음</button></div>';
  if(!sameContext||!el.querySelector('.mi-trace-layout')){
   el.innerHTML='<section class="mi-trace" role="dialog" aria-modal="true" aria-label="'+title+'"><button type="button" data-mi-trace-close aria-label="주문 상세 닫기">닫기 ✕</button><span class="mi-eyebrow">ORDER EXPLORER · 온라인 주문</span><h3>'+title+esc(sourceLabel)+'</h3>'+
    '<div class="mi-trace-controls">'+select+'</div>'+renderMiTraceOverview(result,group)+
    '<p class="mi-inline-note">회원은 첫 구매·재구매·이력 미확인을 포함하고, 개인결제는 스타일리스트로 자동 분류하지 않아. 고객 유형 간 주문이 중복되지 않도록 합계 검증했어.</p>'+
    '<p class="mi-inline-note">상품별 순매출은 별도 검증되지 않았으며, 개인결제·미수집 상품 정보는 공개하지 않아.</p></section>';
  }else{
    const sidebar=el.querySelector('.mi-trace-nav');
    if(sidebar){
      sidebar.querySelectorAll('[data-mi-order-group]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-mi-order-group')===group)));
    }
  }
  const target=$('miTraceResults');if(target)target.innerHTML=resultHtml;
 }catch(e){
  if(reqId!==state.traceSerial)return;
  const unauthorized=String(e?.message||'').includes('401');
  const msg=unauthorized?'운영자 인증이 필요해. 인증하면 주문 분석을 다시 열어줄게.':'주문 상세 데이터 또는 분류 합계 확인에 실패했어. 원천 자료를 확인해야 하며 숫자를 임의로 표시하지 않아.';
  el.innerHTML='<section class="mi-trace" role="dialog" aria-modal="true" aria-label="'+title+'"><button type="button" data-mi-trace-close style="float:right">닫기 ✕</button><h3>'+title+'</h3><p>'+msg+'</p>'+(unauthorized?operatorAuthForm():'')+'<button type="button" data-mi-trace-retry>다시 조회</button></section>';
 }
}

async function loadVisitEvidence(){
 const box=$('miVisitEvidence'),data=state.loadedRows;if(!box||!data||state.tab!=='acquisition')return;
 const months=data.months;
 if(!months.includes(state.trafficMonth))state.trafficMonth=months.at(-1);
 const month=state.trafficMonth,token=++state.trafficSerial;
 const selector='<label>유입 통계 월 <select id="miTrafficMonth">'+months.map(m=>'<option value="'+m+'"'+(m===month?' selected':'')+'>'+m+'</option>').join('')+'</select></label>';
 box.innerHTML='<section class="mi-traffic"><div class="mi-section"><h3>방문 채널 · 검색 유입 상세</h3></div><div class="mi-trace-controls">'+selector+'</div><p>카페24 방문·검색어 원천 데이터를 조회하고 있어.</p></section>';
 const until=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 try{
  const result=await get('/api/marketing-intelligence/traffic?since='+month+'-01&until='+until);
  if(token!==state.trafficSerial||state.tab!=='acquisition')return;
  const visits=result.visits||{},domains=result.domains||{},keywords=result.keywords||{};
  const available=v=>v.status==='AVAILABLE'||v.status==='PARTIAL';
  const domainRows=available(domains)?(domains.rows||[]).slice(0,25).map(r=>'<tr><td>'+esc(r.domain)+'</td><td>'+fmt(r.visits)+'</td></tr>').join(''):'';
  const keywordRows=available(keywords)?(keywords.rows||[]).slice(0,30).map(r=>'<tr><td>'+esc(r.keyword)+'</td><td>'+esc(r.engine)+'</td><td>'+fmt(r.visits)+'</td><td>'+fmt(r.purchaseCount)+'</td></tr>').join(''):'';
  box.innerHTML='<section class="mi-traffic"><h3>방문 채널과 검색어</h3><div class="mi-trace-controls">'+selector+'</div>'+
   '<p class="mi-muted">카페24 애널리틱스의 방문 횟수 기준이야. 같은 사람이 다시 방문하면 중복될 수 있고, 광고 클릭 수와 일치하지 않을 수 있어.</p>'+
   '<section class="mi-grid" style="margin:12px 0">'+
    metric('쇼핑몰 방문 횟수',available(visits)?fmt(visits.visitCount):'조회 불가','Cafe24 Analytics', '60분 비활동 이후 다시 방문하면 새로운 방문으로 집계',false)+
    metric('첫 방문 횟수',available(visits)?fmt(visits.firstVisitCount):'조회 불가','Cafe24 Analytics', '첫 방문 통계이며 신규 구매 회원 수가 아니야',false)+
    metric('재방문 횟수',available(visits)?fmt(visits.repeatVisitCount):'조회 불가','Cafe24 Analytics', '다시 방문한 횟수이며 재구매 횟수와는 달라',false)+'</section>'+
   '<div class="mi-duo"><div><h3>어디에서 들어왔나?</h3><p class="mi-muted">유입 도메인별 방문 횟수. 직접/미확인 방문은 광고 유입일 수도 있어.</p>'+
   (available(domains)?'<div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>직전 유입 도메인</th><th>방문 횟수</th></tr></thead><tbody>'+(domainRows||'<tr><td colspan="2">해당 월 기록 없음</td></tr>')+'</tbody></table></div>':'<div class="mi-provisional">유입 도메인 자료를 조회할 수 없어. 방문 수를 추정하지 않아.</div>')+
   '</div><div><h3>어떤 검색어로 들어왔나?</h3><p class="mi-muted">검색엔진·검색어별 유입 기록. 검색어 미제공 방문은 구분할 수 없어.</p>'+
   (available(keywords)?'<div class="mi-table-wrap"><table class="mi-table"><thead><tr><th>검색어</th><th>검색엔진</th><th>유입 횟수</th><th>애널리틱스 구매 건수</th></tr></thead><tbody>'+(keywordRows||'<tr><td colspan="4">검색어 기록 없음</td></tr>')+'</tbody></table></div>':'<div class="mi-provisional">검색어 통계가 아직 연결되지 않았거나 조회할 수 없어. 검색어를 임의 생성하지 않아.</div>')+'</div></div>'+
   '<p class="mi-inline-note">출처: Cafe24 Analytics /visitors/view, /visitpaths/domains, /visitpaths/keyworddetails. 최초 구매 유입은 CRM 주문 연결 기준, 방문 통계는 세션 기준으로 서로 달라. 검색어 표의 구매 건수는 카페24 애널리틱스 원칙이며 환불·취소 반영과 집계 시점이 CRM과 달라.</p>'+
   ((domains.limited||keywords.limited)?'<p class="mi-inline-note">최대 100개 원천 행 중 상위 일부만 표시한 결과야. 전체 방문·키워드 분포로 취급하지 않아.</p>':'')+'</section>';
 }catch(error){
  const unauthorized=String(error?.message||'').includes('401');
  if(token===state.trafficSerial)box.innerHTML='<section class="mi-traffic"><h3>방문 채널·검색어</h3><p>'+(unauthorized?'방문·검색어 상세는 운영자 인증이 필요해.':'카페24 방문·검색어 원천 API 조회에 실패했어.')+'</p>'+(unauthorized?operatorAuthForm():'<p class="mi-muted">카페24 Analytics 권한이나 응답 형식을 점검해야 해. 방문 횟수를 추정하지 않아.</p>')+'</section>';
 }
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