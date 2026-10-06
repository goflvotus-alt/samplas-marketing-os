// Presentation only. Source models, metric definitions and collection remain unchanged.
import { metricPresent } from './weekly-report-analysis.mjs';
const colors = { ink:'FF242220', muted:'FF77736D', line:'FFE5E3DE', good:'FF216A3E', bad:'FF9C2634' };
const fill = color => ({type:'pattern',pattern:'solid',fgColor:{argb:color}});
const text = v => metricPresent(v) ? v.toLocaleString('ko-KR',{maximumFractionDigits:2}) : 'N/A';
const deltaText = v => metricPresent(v) ? `${v>0?'+':''}${v.toFixed(1)}%` : 'N/A';
export const engagement = p => p.totalInteractions ?? ([p.likes,p.comments,p.saves,p.shares].some(metricPresent) ? [p.likes,p.comments,p.saves,p.shares].filter(metricPresent).reduce((a,b)=>a+b,0) : null);
export const reachRate = (value,reach) => metricPresent(value)&&metricPresent(reach)&&reach>0 ? value/reach : null;

export function styleTable(sheet) {
  sheet.views=[{state:'frozen',ySplit:1,showGridLines:false}];
  sheet.getRow(1).font={name:'맑은 고딕',bold:true,color:{argb:colors.ink}};
  sheet.getRow(1).fill=fill('FFF3F2EF');
  sheet.eachRow((row,n)=>{row.alignment={vertical:'top',wrapText:true};row.height=n===1?30:48;row.eachCell(c=>{c.border={bottom:{style:'hair',color:{argb:colors.line}}};});});
}
function band(sheet,row,from,to,value,height=28) {
  sheet.mergeCells(row,from,row,to);const c=sheet.getCell(row,from);c.value=value;c.alignment={wrapText:true,vertical:'middle'};sheet.getRow(row).height=height;return c;
}
function dashboard(workbook,model,platform,verdict,kpis,insights) {
  const s=workbook.addWorksheet('01_한눈에');
  s.columns=Array.from({length:12},()=>({width:13}));
  s.views=[{showGridLines:false}];
  s.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1};
  s.properties.defaultRowHeight=22;
  band(s,1,1,12,'SAMPLAS WEEKLY REPORT').font={name:'맑은 고딕',size:20,bold:true,color:{argb:colors.ink}};
  band(s,2,1,12,`${platform}  |  ${model.since} ~ ${model.until}  |  비교 ${model.previousSince||'N/A'} ~ ${model.previousUntil||'N/A'}`).font={size:10,color:{argb:colors.muted}};
  band(s,4,1,12,`WEEKLY VERDICT · ${verdict}`,48).font={size:13,bold:true,color:{argb:colors.ink}};
  kpis.forEach((k,i)=>{
    const row=6+Math.floor(i/3)*5,col=1+(i%3)*4,current=model.summary?.[k.key],previous=model.previousSummary?.[k.key];
    const d=model.wow?.[k.key]??null,good=metricPresent(d)&&d!==0&&!k.neutral?(k.inverse?d<0:d>0):null;
    const label=band(s,row,col,col+3,k.label);label.font={size:11,color:{argb:colors.muted}};label.border={bottom:{style:'hair',color:{argb:colors.line}}};
    const number=band(s,row+1,col,col+3,metricPresent(current)?current/(k.percent?100:1):'N/A',34);
    number.numFmt=k.format||'#,##0';number.font={size:24,bold:true,color:{argb:colors.ink}};
    band(s,row+2,col,col+3,`전주 ${text(previous)}${k.percent&&metricPresent(previous)?'%':''}  ·  WoW ${deltaText(d)}`).font={size:10,color:{argb:good===null?colors.muted:good?colors.good:colors.bad}};
    band(s,row+3,col,col+3,good===null?'비교 확인':good?'개선':'주의').font={size:10,color:{argb:good===null?colors.muted:good?colors.good:colors.bad}};
  });
  const boxesRow=6+Math.ceil(kpis.length/3)*5;
  insights.forEach(([label,value],i)=>{
    const col=1+i*4;band(s,boxesRow,col,col+3,label).font={bold:true,size:11,color:{argb:colors.ink}};
    band(s,boxesRow+1,col,col+3,value,78).font={size:11,color:{argb:colors.ink}};
  });
  return {sheet:s,nextRow:boxesRow+4};
}
export function instagramWinners(posts) {
  const winners=new Map();
  for(const [key,label] of [['reach','REACH WINNER'],['saves','SAVE WINNER'],['shares','SHARE WINNER'],['engagement','ENGAGEMENT WINNER']]) {
    const metric=p=>key==='engagement'?engagement(p):p[key];
    const ranked=posts.map((post,index)=>({post,index,value:metric(post)})).filter(x=>metricPresent(x.value)&&x.value>0).sort((a,b)=>b.value-a.value);
    if(!ranked.length)continue;
    const {post,index}=ranked[0];if(!winners.has(index))winners.set(index,{post,signals:[]});winners.get(index).signals.push(label);
  }
  return [...winners.values()];
}
const igLabels={postCount:'게시물 수',views:'조회수',reach:'게시물 Reach 합계',engagement:'반응',saves:'저장',shares:'공유'};
export function instagramVerdict(model) {
  if(!model.ok)return '주간 데이터가 없어 성과 판단을 보류합니다.';
  if(!model.previousSummary)return '전주 비교 데이터가 없습니다. 이번 주 콘텐츠 실측값을 기준으로 다음 테스트를 준비합니다.';
  const p1=(model.analysis||[]).filter(x=>x.scope==='weekly'&&x.priority==='P1');
  if(p1.length)return `${p1.map(x=>igLabels[x.signal.split(' ')[0].toLowerCase()]||'주요 반응').join('·')} 지표가 감소했습니다. 콘텐츠 구성과 발행 흐름을 점검하고 한 가지 변수를 비교 테스트합니다.`;
  const keys=['views','saves','shares','engagement'].filter(k=>metricPresent(model.wow?.[k])&&model.wow[k]>0);
  return keys.length?`${keys.map(k=>igLabels[k]).join('·')} 지표가 전주보다 증가했습니다. 관측된 우수 콘텐츠 구조를 재검증합니다.`:'주요 반응의 개선이 확인되지 않았습니다. 관측값과 형식별 구성을 기준으로 다음 콘텐츠를 테스트합니다.';
}
function igAction(a) {
  const reel=/Reels source/.test(a.action),share=/share-worthy/.test(a.action),repeat=/Retest/.test(a.action);
  return {priority:a.priority,happened:reel?'이번 주 릴스 발행이 없습니다.':share?'공유가 전주보다 크게 감소했습니다.':repeat?'관측된 우수 콘텐츠가 있습니다.':'비교 판단에 필요한 데이터를 점검합니다.',
    evidence:a.evidence,action:reel?'릴스 촬영 원본을 확보하고 업로드 테스트를 재개합니다.':share?'공유 유도 구성과 형식 비중을 바꾸어 비교 테스트합니다.':repeat?`${a.target_format} 구조를 한 번 더 제작해 비교합니다.`:'누락 지표를 확인한 뒤 콘텐츠 변수 하나를 테스트합니다.',success:reel?'릴스 발행 수·조회·공유':share?'게시물당 공유 및 공유 합계':repeat?`${a.target_format} 관측 지표의 재현 여부`:'지표 수집 정상 여부',decision:reel?'발행 후 조회·공유 실측값으로 다음 제작을 결정합니다.':repeat?'같은 지표가 재현될 때만 유지합니다.':'공유 개선과 반응 감소 여부를 함께 확인해 유지·수정합니다.'};
}
export function instagramActions(model) {return (model.actions||[]).slice().sort((a,b)=>a.priority.localeCompare(b.priority)).slice(0,5).map(igAction);}
export function instagramDashboard(workbook,model) {
  const winners=instagramWinners(model.content||[]),actions=instagramActions(model);
  const worked=winners.length?`${winners[0].post.title||winners[0].post.id}: ${winners[0].signals.join(' / ')}. 이번 주 관측값 기준이며 매출 효과를 뜻하지 않습니다.`:'비교 가능한 우수 콘텐츠가 없습니다.';
  const watch=(model.analysis||[]).filter(x=>x.scope==='weekly'&&x.priority==='P1').map(x=>{const k=x.signal.split(' ')[0].toLowerCase();return `${igLabels[k]||k}: 전주 ${text(model.previousSummary?.[k])} → 이번 주 ${text(model.summary?.[k])}`;}).join('; ')||'게시물 도달 합계는 계정 주간 고유 도달이 아닙니다. 스토리 불완전 자료는 판단에서 제외합니다.';
  const {sheet:s,nextRow:r}=dashboard(workbook,model,'INSTAGRAM',instagramVerdict(model),['postCount','views','reach','engagement','saves','shares'].map(key=>({key,label:igLabels[key]})),[['WHAT WORKED',worked],['WHAT TO WATCH',watch],['NEXT MOVE',actions[0]?.action||'누락 데이터부터 확인합니다.']]);
  band(s,r,1,12,'BEST CONTENT TOP 3').font={bold:true,size:13};
  const headers=['콘텐츠명','유형','Reach','Saves','Shares','Engagement','WINNING SIGNAL','WHY IT MATTERS','REPEAT NEXT WEEK'];
  const spans=[[1,2],[3,3],[4,4],[5,5],[6,6],[7,7],[8,9],[10,11],[12,12]];
  const tableCell=(row,i,value,height)=>{const [from,to]=spans[i];return band(s,row,from,to,value,height);};
  headers.forEach((h,i)=>{tableCell(r+1,i,h,40).font={bold:true,size:10};});
  winners.slice().sort((a,b)=>b.signals.length-a.signals.length||(b.post.reach||0)-(a.post.reach||0)).slice(0,3).forEach((x,i)=>{
    const values=[x.post.title||x.post.id,x.post.type,x.post.reach,x.post.saves,x.post.shares,engagement(x.post),x.signals.join(' / '),'이번 주 실측 최대값. 재현 여부를 검증합니다.','동일 구조에서 변수 하나만 바꿔 테스트'];
    values.forEach((v,j)=>{const c=tableCell(r+2+i,j,v??'N/A',88);c.font={size:10,color:{argb:j===6?colors.good:colors.ink}};if(j>=2&&j<=5)c.numFmt='#,##0';});
  });
  band(s,r+6,1,12,`게시물 Reach 합계는 중복 포함 · 계정 주간 고유 도달: ${text(model.weeklyUniqueReach)} · 스토리 coverage는 숨김 시트 참고`).font={size:9,color:{argb:colors.muted}};
  return s;
}
export function instagramContentRows(model) {
  const winners=instagramWinners(model.content||[]);
  return (model.content||[]).map(p=>{
    const win=winners.find(w=>w.post===p),low=(model.analysis||[]).some(a=>a.scope==='content'&&a.signal==='LOW PERFORMER'&&a.entity===(p.title||p.id));
    return {...p,saveRate:reachRate(p.saves,p.reach)??'N/A',shareRate:reachRate(p.shares,p.reach)??'N/A',engagementRate:reachRate(engagement(p),p.reach)??'N/A',performance_signal:win?win.signals.join(' / '):low?'LOW PERFORMER':'관측',next_action:win?'우수 구조를 재검증':low?'도입부·형식·배포 변수 하나만 테스트':'관측값을 유지·비교'};
  });
}
export function addActionTable(workbook,name,rows,columns) {
  const s=workbook.addWorksheet(name);s.columns=columns.map(([header,key])=>({header,key,width:key==='priority'?10:38}));
  rows.forEach(row=>s.addRow(row));styleTable(s);return s;
}
export function naverVerdict(model) {
  if(!model.ok)return '주간 데이터가 없어 성과 판단을 보류합니다.';
  if((model.analysis||[]).some(a=>a.scope==='summary'&&a.signal==='FUNNEL HEALTHY / CONVERSION BROKEN'))return '유입 효율은 개선됐지만 전환 단계가 크게 악화되었습니다. 입찰 축소보다 전환 추적·랜딩·재고·검색 품질 확인이 우선입니다.';
  if((model.analysis||[]).some(a=>a.scope==='summary'&&a.priority==='P1'))return '전환 효율의 경고 신호가 있습니다. 추적·랜딩·재고를 확인한 뒤 광고 운영 변경을 판단합니다.';
  return model.previousSummary?'주요 경고 기준에 해당하지 않습니다. 유입과 전환을 함께 비교하며 다음 주 흐름을 확인합니다.':'전주 비교 데이터가 없습니다. 이번 주 실측값으로 기준을 확보합니다.';
}
export function naverCampaignSignal(row,model) {
  const signals=(model.analysis||[]).filter(a=>a.scope==='campaign'&&a.entity===(row.campaignName||'Naver total'));
  if(signals.some(a=>a.priority==='P1'))return 'ACTION REQUIRED';
  if(!metricPresent(row.wowConversionValue)||!metricPresent(row.wowSpend)||!metricPresent(row.conversions))return 'WATCH';
  if(row.wowConversionValue<0)return 'WATCH';
  if(row.conversions>0&&row.wowConversionValue>0&&row.wowSpend<=0)return 'STRONG';
  return 'HEALTHY';
}
export function naverActions(model) {
  const rows=(model.analysis||[]).slice().sort((a,b)=>a.priority.localeCompare(b.priority));
  const summary=rows.find(a=>a.scope==='summary')||rows[0];
  if(summary){
    // A single existing diagnosis split into its executable checks; no new performance threshold.
    return [['전환 추적','전환 이벤트·집계 기간·태그 정상 여부부터 확인합니다.','추적 정상 및 전환 집계 확인'],['랜딩','광고 랜딩 연결·구매 흐름을 실제로 점검합니다.','랜딩 오류 없음 및 CVR 회복 확인'],['재고','광고 상품의 품절·옵션·구매 가능 여부를 점검합니다.','광고 상품 구매 가능'],['검색 품질','검색어·키워드 품질을 별도 확인합니다. 현재 리포트는 키워드 데이터가 없습니다.','검색 품질 확인 후 전환·ROAS 비교']].map(([area,action,success])=>({priority:summary.priority,happened:summary.signal==='FUNNEL HEALTHY / CONVERSION BROKEN'?'유입 개선 대비 전환 효율이 악화되었습니다.':'기존 분석에서 전환 효율 경고가 확인되었습니다.',evidence:summary.evidence,area,action,success}));
  }
  return [{priority:'P2',happened:'주요 경고 기준에 해당하지 않거나 비교 데이터가 없습니다.',evidence:`전환 ${text(model.summary?.conversions)} · ROAS ${text(model.summary?.roas)}`,area:'전환 모니터링',action:'추적 상태와 전환 흐름을 확인하고 다음 주와 비교합니다.',success:'비교 데이터 확보 및 전환·ROAS 흐름 확인'}];
}
export function naverDashboard(workbook,model) {
  const s=model.summary||{},p=model.previousSummary||{};
  const worked=['impressions','clicks','cpc'].map(k=>`${({impressions:'노출',clicks:'클릭',cpc:'CPC'})[k]} ${text(p[k])} → ${text(s[k])}`).join('\n');
  const broke=['conversions','conversionRate','cpa','roas'].map(k=>`${({conversions:'전환',conversionRate:'CVR',cpa:'CPA',roas:'ROAS'})[k]} ${text(p[k])} → ${text(s[k])}`).join('\n');
  const {sheet,nextRow}=dashboard(workbook,model,'NAVER SEARCH ADS',naverVerdict(model),[
    {key:'spend',label:'광고비',format:'#,##0"원"',neutral:true},{key:'clicks',label:'클릭'},{key:'cpc',label:'CPC',format:'#,##0"원"',inverse:true},{key:'conversions',label:'전환'},{key:'conversionRate',label:'CVR',percent:true,format:'0.0%'},{key:'cpa',label:'CPA',format:'#,##0"원"',inverse:true},{key:'roas',label:'ROAS',format:'0.00"x"'}], [['WHAT WORKED',worked],['WHAT BROKE',broke],['NEXT MOVE',naverActions(model)[0].action+'\n전환 추적 → 랜딩 → 재고 → 검색 품질 순으로 점검합니다.']]);
  band(sheet,nextRow,1,12,'퍼널 · 노출 → 클릭 → 전환').font={size:13,bold:true};
  const headers=['기간','노출','클릭','전환'];headers.forEach((v,i)=>sheet.getCell(nextRow+1,i+1).value=v);
  [['CURRENT',s],['PREVIOUS',p],['WoW',model.wow||{}]].forEach(([label,values],i)=>{
    sheet.getCell(nextRow+2+i,1).value=label;
    ['impressions','clicks','conversions'].forEach((k,j)=>{const c=sheet.getCell(nextRow+2+i,j+2);c.value=values[k]??'N/A';c.numFmt=i===2?'+0.0"%";-0.0"%";0.0"%"':'#,##0';});
  });
  band(sheet,nextRow+6,1,12,'Coverage: 캠페인 데이터 기준 · 광고그룹/키워드 데이터는 미제공이며 숨김 시트에서 확인 가능합니다.').font={size:9,color:{argb:colors.muted}};
  return sheet;
}
