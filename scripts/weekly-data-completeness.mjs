// Coverage of the requested response, never a replacement for revenue or attribution.
const states=['COMPLETE','UNKNOWN','PARTIAL','UNAVAILABLE'];
const numeric=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
const scoped=(row,s)=>typeof row?.order_id==='string'&&row.order_id.length>0&&typeof row.order_date==='string'&&row.order_date.slice(0,10)>=s.since&&row.order_date.slice(0,10)<=s.until;
const result=(kind,scope,completeness,reasons=[],observed={})=>({kind,scope,completeness,reasons,observed});
function upstream(body){
 if(body?.error||body?.ok===false)return 'UNAVAILABLE';
 if(body?.partial===true||body?.complete===false)return 'PARTIAL';
 const declared=[body?.completeness,body?.meta?.completeness,body?.coverage?.completeness].filter(Boolean);
 return states.slice(1).reverse().find(s=>declared.includes(s))||null;
}
export function combineWeeklyCoverage(parts,scope){
 const completeness=states.slice().reverse().find(s=>parts.some(p=>(p?.completeness||'UNKNOWN')===s))||'UNKNOWN';
 return result('weekly_actual_orders',scope,completeness,[...new Set(parts.flatMap(p=>p?.reasons||['COVERAGE_NOT_PROVIDED']))]);
}
export function metaInsightsCoverage(body,scope){
 const rows=body?.data,observed={limit:100,rowCount:Array.isArray(rows)?rows.length:null,hasNextPage:Boolean(body?.paging?.next)};
 if(upstream(body))return result('meta_insights',scope,upstream(body),['UPSTREAM_'+upstream(body)],observed);
 if(!Array.isArray(rows))return result('meta_insights',scope,'UNAVAILABLE',['INSIGHTS_DATA_NOT_RETURNED'],observed);
 if(observed.hasNextPage||rows.length>=100)return result('meta_insights',scope,'PARTIAL',['INSIGHTS_PAGE_NOT_EXHAUSTED'],observed);
 const missing=rows.some(r=>!r||!['spend','impressions','clicks'].every(k=>numeric(r[k]))||!['actions','action_values'].every(k=>Array.isArray(r[k])&&r[k].every(a=>a&&typeof a.action_type==='string'&&numeric(a.value))));
 return result('meta_insights',scope,missing?'UNKNOWN':'COMPLETE',missing?['RAW_METRICS_NOT_RETURNED']:[],observed);
}
export function metaWeeklyCoverage(data,scope){
 if(data?.ok===false||data?.error)return result('meta_insights',scope,'UNAVAILABLE',['INSIGHTS_REQUEST_FAILED']);
 const declared=upstream(data);
 if(declared)return result('meta_insights',scope,declared,['UPSTREAM_'+declared]);
 const c=data?.coverage;
 if(!c||c.kind!=='meta_insights')return result('meta_insights',scope,'UNKNOWN',['INSIGHTS_COVERAGE_NOT_RECORDED']);
 if(c.completeness!=='COMPLETE')return {...c,completeness:states.includes(c.completeness)?c.completeness:'UNKNOWN'};
 if(c.scope?.since!==scope.since||c.scope?.until!==scope.until||c.scope?.level!==scope.level||data.since!==scope.since||data.until!==scope.until||data.level!==scope.level)return result('meta_insights',scope,'UNKNOWN',['INSIGHTS_SCOPE_MISMATCH']);
 if(data.cacheMode==='fallback_after_error'||data.staleRefreshTriggered||data.source?.endsWith('_cached')&&(!Number.isFinite(data.cacheAgeMs)||!Number.isFinite(data.ttlMs)||data.cacheAgeMs<0||data.cacheAgeMs>data.ttlMs))return result('meta_insights',scope,'UNKNOWN',['INSIGHTS_CACHE_NOT_CURRENT']);
 return c;
}
export function cafe24OrdersCoverage(orders,scope,{terminalPage,pages,limit,malformedPage}={}){
 const observed={rowCount:orders.length,pages,limit,terminalPage:terminalPage===true};
 if(malformedPage)return result('cafe24_orders',scope,'UNAVAILABLE',['ORDERS_PAGE_MALFORMED'],observed);
 if(!terminalPage||orders.length>=limit)return result('cafe24_orders',scope,'PARTIAL',['ORDERS_LIMIT_REACHED'],observed);
 if(orders.some(o=>o.itemFetchError))return result('cafe24_orders',scope,'PARTIAL',['ORDER_ITEMS_UNAVAILABLE'],observed);
 if(orders.some(o=>!scoped(o,scope)))return result('cafe24_orders',scope,'UNKNOWN',['ORDER_ID_OR_DATE_INVALID'],observed);
 return result('cafe24_orders',scope,'COMPLETE',[],observed);
}
export function cafe24AnalyticsCoverage(body,scope){
 const rows=body?.orderdetails,observed={limit:100,rowCount:Array.isArray(rows)?rows.length:null,hasNextPage:Boolean(body?.paging?.next),reportedTotal:body?.total_count??null};
 if(upstream(body))return result('cafe24_analytics',scope,upstream(body),['UPSTREAM_'+upstream(body)],observed);
 if(!Array.isArray(rows))return result('cafe24_analytics',scope,'UNAVAILABLE',['ANALYTICS_ROWS_NOT_RETURNED'],observed);
 if(rows.length>=100||observed.hasNextPage||numeric(observed.reportedTotal)&&Number(observed.reportedTotal)>rows.length)return result('cafe24_analytics',scope,'PARTIAL',['ANALYTICS_LIMIT_OR_NEXT_PAGE'],observed);
 if(rows.some(r=>!scoped(r,scope)||!numeric(r.order_amount)||!['ad','medium','campaign','content','keyword'].every(k=>typeof r[k]==='string')))return result('cafe24_analytics',scope,'UNKNOWN',['ANALYTICS_ROW_INVALID'],observed);
 return result('cafe24_analytics',scope,'COMPLETE',[],observed);
}
// Account-level insights are the denominator Meta itself reports. When every additive metric of a
// level equals it, rows that omitted actions/action_values are proven to contribute zero; otherwise
// the omission stays UNKNOWN. Values are never zero-filled here.
const ADDITIVE=['spend','impressions','clicks','purchases','purchaseValue'];
const cents=v=>Math.round(Number(v)*100);
export function metaAccountTotalsCoverage(body,scope,totals){
 const rows=body?.data,observed={rowCount:Array.isArray(rows)?rows.length:null,hasNextPage:Boolean(body?.paging?.next)};
 if(upstream(body))return {...result('meta_account_totals',scope,upstream(body),['UPSTREAM_'+upstream(body)],observed),totals:null};
 if(!Array.isArray(rows)||rows.length!==1||observed.hasNextPage)return {...result('meta_account_totals',scope,'UNKNOWN',['ACCOUNT_ROW_NOT_SINGLE'],observed),totals:null};
 const row=rows[0];
 if(row.date_start!==scope.since||row.date_stop!==scope.until)return {...result('meta_account_totals',scope,'UNKNOWN',['ACCOUNT_SCOPE_MISMATCH'],observed),totals:null};
 if(!['spend','impressions','clicks'].every(k=>numeric(row[k]))||!['actions','action_values'].every(k=>Array.isArray(row[k])&&row[k].every(a=>a&&typeof a.action_type==='string'&&numeric(a.value))))return {...result('meta_account_totals',scope,'UNKNOWN',['ACCOUNT_ACTIONS_NOT_RETURNED'],observed),totals:null};
 if(!totals||!ADDITIVE.every(k=>numeric(totals[k])))return {...result('meta_account_totals',scope,'UNKNOWN',['ACCOUNT_TOTALS_INVALID'],observed),totals:null};
 return {...result('meta_account_totals',scope,'COMPLETE',[],observed),totals:Object.fromEntries(ADDITIVE.map(k=>[k,Number(totals[k])]))};
}
export function accountReconciles(levelTotals,account,scope){
 if(account?.kind!=='meta_account_totals'||account.completeness!=='COMPLETE'||account.scope?.since!==scope.since||account.scope?.until!==scope.until||!account.totals)return false;
 return ADDITIVE.every(k=>numeric(levelTotals?.[k])&&cents(levelTotals[k])===cents(account.totals[k]));
}
