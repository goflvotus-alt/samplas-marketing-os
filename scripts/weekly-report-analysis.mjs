// Pure reporting rules and workbook presentation. No API calls or mutations.
export const ANALYSIS_COLUMNS = ['priority','scope','entity','signal','evidence','interpretation','this_week_action','success_check'];
export const ACTION_COLUMNS = ['priority','action','evidence','target_format','success_metric','decision_rule'];
export const metricPresent = v => typeof v === 'number' && Number.isFinite(v);
export const metricText = v => metricPresent(v) ? Number(v.toFixed(2)).toLocaleString('en-US') : 'N/A';
export function change(current,previous){return metricPresent(current)&&metricPresent(previous)&&previous!==0?(current-previous)/previous*100:null;}
export const compareText=(metric,current,previous)=>`${metric}: ${metricText(previous)} → ${metricText(current)}`;
export function analysisRow(priority,scope,entity,signal,evidence,interpretation,this_week_action,success_check){return {priority,scope,entity,signal,evidence,interpretation,this_week_action,success_check};}
export function writeDecisionSheet(workbook,name,rows,columns=ANALYSIS_COLUMNS){
  const sheet=workbook.addWorksheet(name);sheet.columns=columns.map(key=>({header:key,key,width:key==='priority'?10:['scope','signal'].includes(key)?22:42}));
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
  for(const row of rows)sheet.addRow(row);
  sheet.eachRow((row,n)=>{if(n>1){row.alignment={vertical:'top',wrapText:true};row.height=56;}});
  if(rows.length)sheet.addConditionalFormatting({ref:`A2:${sheet.getColumn(columns.length).letter}${sheet.rowCount}`,rules:[{type:'expression',formulae:['$A2="P1"'],priority:1,style:{fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE3DE'}},font:{color:{argb:'FF9C2634'}}}}]});
  return sheet;
}
export function addExecutiveRead(sheet,rows){
  sheet.getCell('F1').value='EXECUTIVE READ';sheet.getCell('F1').font={bold:true,color:{argb:'FF9C2634'}};
  sheet.getColumn('F').width=110;
  const ranked=rows.slice().sort((a,b)=>a.priority.localeCompare(b.priority));
  const positive=ranked.find(r=>r.signal==='SHARES WINNER')||ranked.find(r=>/WINNER|LEADER|RECOVERY|CONTROLLED SCALE|VALUE INCREASE/.test(r.signal||''));
  const selected=[...ranked.filter(r=>r.priority==='P1').slice(0,3),...(positive?[positive]:[])];
  for(const r of ranked)if(selected.length<5&&!selected.includes(r))selected.push(r);
  selected.forEach((r,i)=>{const c=sheet.getCell(i+2,6);c.value=`${r.priority} · ${r.entity||r.scope||''} · ${r.signal||r.action}: ${r.evidence} → ${r.this_week_action||r.action}`;c.alignment={wrapText:true,vertical:'top'};sheet.getRow(i+2).height=52;});
  if(!selected.length)sheet.getCell('F2').value='No rule threshold crossed; review data coverage before changing operations.';
}
// WoW is percentage-points in these models. Spend alone is neutral; cost decreases are good.
export function addWowFormatting(sheet,column,from,to,metric){
  if(to<from||metric==='spend')return;
  const inverse=['cpa','cpc','cpm'].includes(metric),letter=sheet.getColumn(column).letter;
  sheet.addConditionalFormatting({ref:`${letter}${from}:${letter}${to}`,rules:[
    {type:'cellIs',operator:inverse?'greaterThanOrEqual':'lessThanOrEqual',formulae:[inverse?30:-30],priority:2,style:{font:{color:{argb:'FF9C2634'}},fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE3DE'}}}},
    {type:'cellIs',operator:inverse?'lessThanOrEqual':'greaterThanOrEqual',formulae:[inverse?-20:20],priority:3,style:{font:{color:{argb:'FF216A3E'}},fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFE3F3E9'}}}}
  ]});
}
export function addPerformanceFormatting(sheet,{spend,outcome,roas,from=2,to=sheet.rowCount}){
  if(to<from)return;
  const letter=k=>sheet.getColumn(k).letter;
  sheet.addConditionalFormatting({ref:`A${from}:${sheet.getColumn(sheet.columnCount).letter}${to}`,rules:[{type:'expression',formulae:[`AND(ISNUMBER($${letter(spend)}${from}),$${letter(spend)}${from}>0,ISNUMBER($${letter(outcome)}${from}),$${letter(outcome)}${from}=0)`],priority:4,style:{fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}}}}]});
  sheet.addConditionalFormatting({ref:`${letter(roas)}${from}:${letter(roas)}${to}`,rules:[{type:'cellIs',operator:'greaterThanOrEqual',formulae:[4],priority:5,style:{fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFE3F3E9'}}}}]});
}
export function analyzeMetaLevels(current,previous){
  const result=[],campaigns=new Map((current?.campaign?.rows||[]).map(r=>[r.campaignId,r]));
  for(const [level,idKey,nameKey] of [['campaign','campaignId','campaignName'],['adset','adsetId','adsetName'],['ad','adId','adName']]){
    const prior=new Map((previous?.[level]?.rows||[]).map(r=>[r[idKey],r]));
    for(const r of current?.[level]?.rows||[]){
      const p=prior.get(r[idKey]),entity=r[nameKey]||r.label||r[idKey],objective=String(r.objective||campaigns.get(r.campaignId)?.objective||'').toUpperCase();
      const add=(priority,signal,metrics,interpretation,action,check)=>result.push(analysisRow(priority,level,entity,signal,metrics.map(k=>compareText(k,r[k],p?.[k])).join('; '),interpretation,action,check));
      if(/TRAFFIC|AWARENESS|REACH|BRAND_AWARENESS/.test(objective)){
        if(change(r.ctr,p?.ctr)<=-30&&metricPresent(change(r.ctr,p?.ctr)))add('P1','OBJECTIVE METRICS DECLINE',['ctr','cpc','cpm','reach'],'Traffic/awareness: zero purchases is not failure.','Review creative/placement and landing relevance; controlled objective-metric test.','CTR recovers without CPC/CPM deterioration.');
        else if((change(r.cpc,p?.cpc)>=30||change(r.cpm,p?.cpm)>=30))add('P1','OBJECTIVE COST INCREASE',['ctr','cpc','cpm','reach'],'Traffic/awareness delivery cost increased.','Inspect creative fatigue and audience delivery before changing budgets.','CPC/CPM improves with stable reach.');
        else add('P2','OBJECTIVE METRICS REVIEW',['ctr','cpc','cpm','reach'],'Evaluate the stated objective; purchases are not its primary success metric.','Keep monitoring CTR/CPC/CPM/reach.','Objective metrics meet the reviewed baseline.');
        continue;
      }
      if(!/SALES|CONVERSIONS|PRODUCT_CATALOG/.test(objective)){
        add('P2','OBJECTIVE UNCLASSIFIED',['spend','purchases','roas'],'Objective missing/unsupported; do not assume a sales failure.','Verify campaign objective before interpreting zero purchases.','Objective confirmed.');continue;
      }
      if(r.spend>0&&r.purchases===0)add('P1','SPEND WITHOUT PURCHASES',['spend','purchases'],'Sales spend has no Meta-reported purchases.','Check tracking, landing, stock and creative; do not mutate budgets automatically.','Tracking validated and purchases resume.');
      if(metricPresent(r.spend)&&metricPresent(p?.spend)&&r.spend>p.spend&&metricPresent(r.purchases)&&metricPresent(p?.purchases)&&r.purchases<p.purchases)add('P1','SPEND UP / PURCHASES DOWN',['spend','purchases'],'Efficiency deteriorated despite more spend.','Inspect attribution, SKU availability and creative breakdown.','Purchases recover with stable spend.');
      if(change(r.roas,p?.roas)<=-30&&metricPresent(change(r.roas,p?.roas)))add('P1','KEEP / INVESTIGATE DECLINE',['roas','spend','purchaseValue'],'ROAS declined ≥30%; a still-high ROAS does not justify an automatic stop.','Review product feed, stock, price and sold SKUs.','Explain decline and restore ROAS trend.');
      if(change(r.cpa,p?.cpa)>=30)add('P1','CPA INCREASE',['cpa','purchases'],'CPA increased ≥30%.','Check conversion and creative/product mix before spend changes.','CPA returns toward prior baseline.');
      if(p?.purchases===0&&r.purchases>0)add('P2',r.roas>=4?'KEEP / CONTROLLED SCALE TEST':'RECOVERY',['purchases','roas','purchaseValue'],'Purchases recovered from zero; no percentage growth invented.','Keep; review creative and SKU breakdown; propose a controlled test only.','Purchase recovery persists; CPA/ROAS remain acceptable.');
      if(change(r.purchaseValue,p?.purchaseValue)>=50)add('P2','PURCHASE VALUE INCREASE',['purchaseValue','roas','purchases'],'Meta-attributed value rose ≥50%; not Cafe24 actual revenue.','Confirm purchase tracking and repeat contributing creative/SKU tests.','Gain persists without ROAS deterioration.');
    }
  }
  const candidates=(current?.campaign?.rows||[]).filter(r=>/SALES|CONVERSIONS|PRODUCT_CATALOG/i.test(r.objective||'')&&r.spend>0&&r.purchases>0&&metricPresent(r.roas));
  const leader=candidates.slice().sort((a,b)=>b.roas-a.roas)[0];
  if(leader)result.push(analysisRow('P2','campaign',leader.campaignName||leader.campaignId,'SALES ROAS LEADER',`ROAS=${metricText(leader.roas)}; purchases=${metricText(leader.purchases)}; spend=${metricText(leader.spend)}`,'Highest observed sales-campaign Meta ROAS in this report; not Cafe24 actual revenue.','Keep monitoring; review actual sold SKUs and propose a controlled test only.','ROAS and purchase count remain healthy with validated tracking.'));
  return result;
}
export function analyzeNaver(model,current,previous){
  const out=[];
  for(const [scope,r,p] of [['summary',model.summary,model.previousSummary],...model.campaigns.map(r=>['campaign',r,(previous?.campaigns||[]).find(p=>p.campaignId===r.campaignId)])]){
    if(!r)continue;const entity=r.campaignName||'Naver total';
    const evidence=['impressions','clicks','spend','ctr','cpc','conversions','conversionValue','conversionRate','cpa','roas'].map(k=>compareText(k,r[k],p?.[k])).join('; ');
    const add=(priority,signal,interpretation,action,check)=>out.push(analysisRow(priority,scope,entity,signal,evidence,interpretation,action,check));
    if(p&&r.impressions>p.impressions&&r.clicks>p.clicks&&metricPresent(r.cpc)&&metricPresent(p.cpc)&&r.cpc<p.cpc&&metricPresent(r.conversions)&&metricPresent(p.conversions)&&r.conversions<p.conversions&&metricPresent(r.conversionRate)&&metricPresent(p.conversionRate)&&r.conversionRate<p.conversionRate&&metricPresent(r.roas)&&metricPresent(p.roas)&&r.roas<p.roas){
      add('P1','FUNNEL HEALTHY / CONVERSION BROKEN','Traffic improved but conversion efficiency fell; do not immediately reduce bids.','1. Check conversion tracking health; 2. review search-term/keyword quality (keyword analysis unavailable); 3. check landing/sold-out/product availability; 4. review new-brand/product coverage.','Tracking healthy; CVR/conversions/ROAS recover.');
    }
    if(r.spend>0&&r.conversions===0)add('P1','SPEND WITHOUT CONVERSIONS','Conversion is zero with positive spend.','Validate conversion tracking and landing/stock; keyword analysis unavailable.','Tracking confirmed and conversions return.');
    if(change(r.roas,p?.roas)<=-30&&metricPresent(change(r.roas,p?.roas)))add('P1','ROAS DECLINE','ROAS fell ≥30%.','Review tracking, landing and coverage before bid changes; keyword analysis unavailable.','ROAS recovers with healthy tracking.');
    if(change(r.cpa,p?.cpa)>=30)add('P1','CPA INCREASE','CPA rose ≥30%.','Review conversion health and product availability.','CPA improves without losing conversions.');
  }
  return out;
}
