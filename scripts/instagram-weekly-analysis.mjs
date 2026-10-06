import {analysisRow,compareText,change,metricPresent,metricText} from './weekly-report-analysis.mjs';
export function analyzeInstagram(model){
  const rows=[],actions=[],posts=model.content||[],s=model.summary,p=model.previousSummary;
  if(!model.ok)return {rows:[analysisRow('P1','data','Instagram','UNAVAILABLE','No weekly source','Metrics unavailable; no fabricated recommendations.','Restore read-only data access.','Source available.')],actions:[{priority:'P1',action:'Restore report source',evidence:'Weekly data unavailable',target_format:'ALL',success_metric:'Data availability',decision_rule:'Analyze only after data is available.'}]};
  const addAction=(priority,action,evidence,target_format,success_metric,decision_rule)=>actions.push({priority,action,evidence,target_format,success_metric,decision_rule});
  for(const k of ['postCount','views','likes','comments','saves','shares','engagement']){
    const delta=change(s[k],p?.[k]);const evidence=compareText(k,s[k],p?.[k]);
    rows.push(analysisRow(metricPresent(delta)&&delta<=-30?'P1':'P2','weekly','Instagram',k.toUpperCase()+' CHANGE',evidence,p?`${metricPresent(delta)?delta.toFixed(1)+'% WoW':'WoW N/A (missing/zero baseline)'}. Shares indicate distribution, not guaranteed sales.`:'Previous week unavailable; no growth inference.','Compare format mix and release cadence; test rather than promise effects.',`Review next-week ${k} against this baseline.`));
    if(k==='shares'&&metricPresent(delta)&&delta<=-30)addAction('P1','Test share-worthy content and review format mix',evidence,'High-share formats','Shares per post and total shares','Retain tests only when shares improve without engagement decline.');
  }
  for(const k of ['views','shares','saves']){
    const ranked=posts.filter(r=>metricPresent(r[k])).slice().sort((a,b)=>b[k]-a[k]);if(!ranked.length)continue;
    const top=ranked[0];rows.push(analysisRow('P2','content',top.title||top.id,k.toUpperCase()+' WINNER',`${k}=${metricText(top[k])}; format=${top.type||'N/A'}`,'Highest observed metric within this week; no causal guarantee.','Retest the observed format/content structure.',`Compare ${k} per post in the next test.`));
    if(top[k]>0){const label=String(top.tag||'')+' '+String(top.title||'');const candidate=/착장|사람|LOOK|PEOPLE/i.test(label)?'사람/착장형':/신상품|release|new arrival/i.test(label)?'신상품 release형':top.type||'winning content structure';addAction('P2',`Retest ${candidate}`,`${top.title||top.id}: ${k}=${metricText(top[k])}`,candidate,`${k} per post`,'Controlled comparison only; do not promise reach or sales effects.');}
  }
  const comparable=posts.filter(r=>metricPresent(r.views)&&metricPresent(r.shares)&&metricPresent(r.saves));
  if(comparable.length>1){const low=comparable.slice().sort((a,b)=>a.views-b.views)[0];rows.push(analysisRow('P2','content',low.title||low.id,'LOW PERFORMER',`views=${metricText(low.views)}; shares=${metricText(low.shares)}; saves=${metricText(low.saves)}`,'Lowest views among posts with all three metrics; inspect shares/saves before concluding quality.','Review hook, format and distribution; change one variable.','Next test improves views without reducing shares/saves.'));}
  if(!model.reels.length)addAction('P1','Secure Reels source footage / resume upload tests','Reels published=0 in the reported week','Reels','Reels publication count, views, shares','Review performance after a real Reels test; no promised result.');
  if(!actions.length)addAction('P2','Review missing metrics and repeat a controlled content test','No actionable winner with available metrics','ALL','Metric availability','Do not infer performance from missing data.');
  return {rows,actions};
}
