// Publication evidence only. Canonical Cafe24 amounts and attribution are unchanged.
import {readFile,open,mkdir,rename,realpath,unlink} from 'node:fs/promises';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {accountReconciles} from './weekly-data-completeness.mjs';
import {cafe24OrderAmount,cafe24OrderItems,cafe24ItemAmount,isCafe24CanceledItem,isCafe24CanceledOrRefunded} from './cafe24-order-amount.mjs';

const POLICY='META_WEEKLY_REVIEW_V2',LEGACY_POLICY='META_LEGACY_IMPORT_V1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const publishable=r=>r?.policy===POLICY&&Array.isArray(r.failures)&&Array.isArray(r.unknowns)&&!r.failures.length&&(r.result==='PASS'?!r.unknowns.length:r.result==='UNKNOWN'&&r.unknowns.length>0)&&JSON.stringify(r.errors)===JSON.stringify([...r.failures,...r.unknowns]);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const money=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const isMeta=row=>['META_PAID','META_INFLOW'].includes(row.tracking_source);
const itemId=item=>String(item.order_item_code||item.item_no||'');
const orderId=order=>String(order.order_id||order.orderId||'');
const inPeriod=(d,s,u)=>/^\d{4}-\d{2}-\d{2}/.test(d||'')&&d.slice(0,10)>=s&&d.slice(0,10)<=u;
const periodDir=(root,s,u)=>{
 if(![s,u].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))throw Error('Invalid issued period');
 return join(root,'issued',`${s}_${u}`);
};
const completed=item=>isCafe24CanceledItem(item)||/^(취소완료|반품완료)$/.test(item.status_text||'');

export function scheduledMetaPublication({at,since,until,mode,onePage,requireCompleteData}){
 if(!['auto','scheduled'].includes(mode)||!onePage||!requireCompleteData)return false;
 const kst=new Date(at.getTime()+9*3600000);
 const date=offset=>new Date(kst.getTime()+offset*86400000).toISOString().slice(0,10);
 return kst.getUTCDay()===2&&kst.getUTCHours()===10&&since===date(-7)&&until===date(-1);
}

function actualById(products){
 const result=new Map();
 for(const r of products?.rows||[]){
  if(!isMeta(r))continue;
  const id=String(r.order_id||'');
  if(!result.has(id))result.set(id,{orderId:id,orderDate:r.order_date,amount:0});
  if(r.actual_paid_amount!==null&&r.actual_paid_amount!==undefined)result.get(id).amount+=Number(r.actual_paid_amount);
 }
 return result;
}

function rawOrders(data){
 const orders=new Map(),conflicts=new Set();
 for(const o of [...(data?.orders||[]),...(data?.analyticsOrders||[])]){
  const id=orderId(o);if(!id)continue;
  const signature=JSON.stringify([o.order_date,o.paid,isCafe24CanceledOrRefunded(o),cafe24OrderAmount(o),o.canceled,o.cancel_date,o.return_confirmed_date,o.refund_date,o.actual_order_amount,o.payment_amount,o.refunds,cafe24OrderItems(o)]);
  if(orders.has(id)&&orders.get(id).signature!==signature)conflicts.add(id);
  else orders.set(id,{order:o,signature});
 }
 return {orders,conflicts};
}

// allowUnknown: UNKNOWN (could not verify) is reported separately from PARTIAL/UNAVAILABLE (known gaps).
function partialOrUnverified(value,allowUnknown=false){
 if(!value||typeof value!=='object')return false;
 if(value.partial===true||value.complete===false||value.available===false||value.possibleLimitReached===true||value.ok===false||value.error)return true;
 if(value.completeness&&value.completeness!=='COMPLETE'&&!(allowUnknown&&value.completeness==='UNKNOWN'))return true;
 if(value.status&&['PARTIAL','UNAVAILABLE','ERROR'].includes(value.status))return true;
 if(Array.isArray(value.issues)&&value.issues.some(s=>/partial|incomplete|not_verified|unavailable|zero_filled/i.test(s)))return true;
 return ['meta','coverage','data'].some(k=>partialOrUnverified(value[k],allowUnknown));
}

// PASS: every source verified. UNKNOWN: no known gap, but some source could not be verified (published with
// the reasons on page one). FAIL: a known gap or inconsistency (never published).
export function reviewMetaPublication({model,current,previous,actualOrders,actualAnalytics,previousOrders,previousAnalytics,comparison,accountTotals={}}){
 const failures=[],unknowns=[],coverage={};
 const periods={current:{since:model.since,until:model.until},previous:{since:model.previousSince,until:model.previousUntil}};
 for(const [name,levels] of [['current',current],['previous',previous]])for(const level of ['campaign','adset','ad']){
  const data=levels?.[level];
  const declared=data?.coverage?.completeness||data?.completeness||data?.meta?.completeness||'UNKNOWN';
  coverage[`${name}.${level}`]=declared;
  if(!data||!Array.isArray(data.rows)||partialOrUnverified(data,true))failures.push(`${name}.${level}:COMPLETE_COVERAGE_REQUIRED`);
  else if(declared!=='COMPLETE'){
   if(accountReconciles(data.totals,accountTotals[name],periods[name]))coverage[`${name}.${level}`]='COMPLETE_BY_ACCOUNT_TOTALS';
   else unknowns.push(`${name}.${level}:COVERAGE_UNKNOWN`);
  }
  if(!['spend','impressions','clicks','purchases','purchaseValue'].every(k=>money(data?.totals?.[k])!==null))failures.push(`${name}.${level}:METRICS_UNAVAILABLE`);
 }
 const products=model.actualProducts;
 if(!products?.available||products.missingItems||products.missingDates||products.possibleLimitReached)failures.push('ACTUAL_COVERAGE_INCOMPLETE');
 if(!model.previousActualProducts?.available)failures.push('PREVIOUS_ACTUAL_UNAVAILABLE');
 for (const [name,input,data] of [['current',actualOrders,actualAnalytics],['previous',previousOrders,previousAnalytics]]) {
  coverage[`${name}.orders`]=input?.coverage?.completeness||'UNKNOWN';
  coverage[`${name}.analytics`]=data?.coverage?.completeness||'UNKNOWN';
  const analytics=data?.data?.orderdetails||data?.orderdetails;
  if(!data||data.ok!==true||!Array.isArray(analytics)||analytics.length>=100||partialOrUnverified(data,true))failures.push(`${name}:ANALYTICS_COVERAGE_INCOMPLETE`);
  else if(data.coverage?.completeness!=='COMPLETE')unknowns.push(`${name}:ANALYTICS_COVERAGE_UNKNOWN`);
  if(input?.source!=='cafe24_inflow_queries'||input.analyticsOrdersComplete!==true||!Array.isArray(input.analyticsOrders)||input.analyticsOrders.length>=500||!Array.isArray(input.trackingQueries)||input.trackingQueries.length!==5||input.trackingQueries.some(q=>q.ok!==true||q.complete!==true||!Number.isInteger(q.count)||q.count<0||q.count>=500)||rawOrders(input).conflicts.size||partialOrUnverified(input,true))failures.push(`${name}:ORDER_PROVENANCE_REQUIRED`);
  else if(input.coverage?.completeness!=='COMPLETE')unknowns.push(`${name}:ORDER_COVERAGE_UNKNOWN`);
 }
 const {orders,conflicts}=rawOrders(actualOrders);
 if(conflicts.size||partialOrUnverified(actualOrders,true))failures.push('ORDER_EVIDENCE_INCOMPLETE');
 for(const entry of actualById(products).values()){
  const o=orders.get(entry.orderId)?.order;
  const payment=money(o?.actual_order_amount?.payment_amount??o?.payment_amount);
  if(!o||o.paid!=='T'||payment===null||entry.amount!==cafe24OrderAmount(o)||!Number.isSafeInteger(entry.amount)||!inPeriod(o.order_date,model.since,model.until))failures.push('PAYMENT_EVIDENCE_INCOMPLETE');
 }
 if(comparison?.status==='UNKNOWN_ADJUSTMENT')unknowns.push('UNKNOWN_ADJUSTMENT');
 const f=[...new Set(failures)],u=[...new Set(unknowns)];
 // Cafe24 actual amounts are confirmed only when their orders and acquisition evidence are verified.
 const gap=name=>[`${name}:ANALYTICS_COVERAGE_UNKNOWN`,`${name}:ORDER_COVERAGE_UNKNOWN`,`${name}:ANALYTICS_COVERAGE_INCOMPLETE`,`${name}:ORDER_PROVENANCE_REQUIRED`].some(c=>f.includes(c)||u.includes(c));
 const actual={current:!gap('current')&&!['ACTUAL_COVERAGE_INCOMPLETE','PAYMENT_EVIDENCE_INCOMPLETE','ORDER_EVIDENCE_INCOMPLETE'].some(c=>f.includes(c)),previous:!gap('previous')&&!f.includes('PREVIOUS_ACTUAL_UNAVAILABLE')};
 return {policy:POLICY,result:f.length?'FAIL':u.length?'UNKNOWN':'PASS',errors:[...f,...u],failures:f,unknowns:u,coverage,actual};
}

export function reconcileMetaPublication({issued,currentProducts,currentOrders,asOf}){
 const currentRevenue=currentProducts?.available?currentProducts.summary.metaPaidRevenue:null;
 const base={issuedKind:issued?(issued.kind||'scheduled'):null,issuedVerified:issued?issued.summary?.actualVerified!==false:null,issuedRevenue:issued?.summary.metaPaidRevenue??null,issuedOrderCount:issued?.summary.metaPaidOrderCount??null,issuedAt:issued?.issuedAt??null,currentRevenue,currentOrderCount:currentProducts?.summary?.metaPaidOrderCount??null,asOf,refundAdjustment:null,rows:[]};
 if(!issued)return {...base,status:'NO_ISSUED_BASELINE'};
 const {orders,conflicts}=rawOrders(currentOrders),now=actualById(currentProducts),old=new Map(issued.orders.map(o=>[o.orderId,o]));
 let unknown=!currentProducts?.available||conflicts.size>0;
 for(const id of new Set([...old.keys(),...now.keys()])){
  const before=old.get(id),after=now.get(id),raw=orders.get(id)?.order;
  const amount=after?.amount??0,delta=amount-(before?.amount??0);
  if(!delta)continue;
  const row={orderId:id,orderDate:before?.orderDate||after?.orderDate,refundDate:null,refundAmount:null,issuedAt:issued.issuedAt,currentStatus:raw?`canceled=${raw.canceled||'?'} | ${[...new Set(cafe24OrderItems(raw).map(i=>[i.order_status,i.status_text].filter(Boolean).join('/')).filter(Boolean))].join(', ')}`:'UNKNOWN',issuedAmount:before?.amount??0,currentAmount:amount,adjustment:delta,status:'UNKNOWN_ADJUSTMENT'};
  const validDate=d=>time(d)>time(issued.issuedAt)&&time(d)<=time(asOf);
  if(before&&raw&&!conflicts.has(id)&&delta<0&&cafe24OrderAmount(raw)===amount){
   const items=cafe24OrderItems(raw);
   const dates=[raw.refund_date,raw.return_confirmed_date,raw.cancel_date,...items.filter(completed).flatMap(i=>[i.refund_date,i.return_confirmed_date,i.cancel_date])].filter(validDate).sort((a,b)=>time(b)-time(a));
   let evidenceAmount=null;
   if(amount===0&&isCafe24CanceledOrRefunded(raw)&&dates.length)evidenceAmount=before.amount;
   else {
    const events=(Array.isArray(raw.refunds)?raw.refunds:[]).filter(e=>String(e.order_id)===id&&validDate(e.refund_date)&&money(e.actual_refund_amount)!==null);
    const evidence=events.length?events:items.filter(i=>completed(i)&&validDate(i.refund_date||i.return_confirmed_date||i.cancel_date));
    const seen=new Map();let supported=evidence.length>0;
    for(const e of evidence){
     const date=e.refund_date||e.return_confirmed_date||e.cancel_date;
     let amount=money(e.actual_refund_amount);
     if(amount===null){
      const prior=before.items.find(i=>i.itemId&&i.itemId===itemId(e));
      if(prior&&before.items.reduce((s,i)=>s+i.amount,0)===before.amount&&Number(e.quantity)===prior.quantity)amount=prior.amount;
     }
     if(amount===null){supported=false;break;}
     const key=String(e.refund_code||itemId(e)||`${date}|${amount}`);
     if(seen.has(key)&&seen.get(key)!==amount)supported=false;
     seen.set(key,amount);dates.push(date);
    }
    if(supported)evidenceAmount=[...seen.values()].reduce((s,n)=>s+n,0);
   }
   if(evidenceAmount===-delta){row.status='REFUND_ADJUSTMENT';row.refundAmount=-delta;row.refundDate=dates.sort((a,b)=>time(b)-time(a))[0];}
  }
  if(row.status==='UNKNOWN_ADJUSTMENT')unknown=true;
  base.rows.push(row);
 }
 const confirmed=base.rows.filter(r=>r.status==='REFUND_ADJUSTMENT').reduce((s,r)=>s+r.adjustment,0);
 if(currentRevenue!==issued.summary.metaPaidRevenue+confirmed)unknown=true;
 return {...base,status:unknown?'UNKNOWN_ADJUSTMENT':'RECONCILED',refundAdjustment:unknown?null:confirmed};
}

export function publicationRecord({model,actualOrders,generatedAt,reviewedAt,review}){
 const raw=rawOrders(actualOrders).orders;
 const orders=[...actualById(model.actualProducts).values()].map(entry=>({...entry,items:cafe24OrderItems(raw.get(entry.orderId)?.order).filter(i=>!completed(i)).map(i=>({itemId:itemId(i),quantity:Number(i.quantity||1),amount:cafe24ItemAmount(i,Number(i.quantity||1))}))}));
 return {schemaVersion:1,policy:POLICY,mode:'scheduled',since:model.since,until:model.until,generatedAt,issuedAt:reviewedAt,reviewedAt,review,summary:{metaPaidOrderCount:model.actualProducts.summary.metaPaidOrderCount,metaPaidRevenue:model.actualProducts.summary.metaPaidRevenue,actualVerified:review.actual?.current===true},orders};
}

export async function readIssuedMetaReport({outputDir,since,until}){
 const dir=periodDir(outputDir,since,until);let m;
 try{m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('ISSUED_MANIFEST_INVALID');}
 if(m.kind==='legacy_import')return readLegacyManifest(dir,m,since,until);
 if(m.schemaVersion!==1||m.policy!==POLICY||m.mode!=='scheduled'||!publishable(m.review)||m.since!==since||m.until!==until||!scheduledMetaPublication({at:new Date(m.generatedAt),since,until,mode:m.mode,onePage:true,requireCompleteData:true})||!(time(m.reviewedAt)>=time(m.generatedAt))||m.issuedAt!==m.reviewedAt||!Array.isArray(m.orders))throw Error('ISSUED_REVIEW_INVALID');
 if(new Set(m.orders.map(o=>o.orderId)).size!==m.orders.length||m.orders.some(o=>!o.orderId||!inPeriod(o.orderDate,since,until)||!Number.isSafeInteger(o.amount)||o.amount<0)||m.orders.length!==m.summary?.metaPaidOrderCount||m.orders.reduce((s,o)=>s+o.amount,0)!==m.summary?.metaPaidRevenue)throw Error('ISSUED_LEDGER_INVALID');
 const bytes=await readFile(join(dir,'report.xlsx'));
 if(sha(bytes)!==m.sha256)throw Error('ISSUED_HASH_MISMATCH');
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);
 const {sha256,...record}=m;
 const parts=[];w.getWorksheet('ISSUE_EVIDENCE')?.eachRow(row=>parts.push(row.getCell(1).value));
 if(parts.join('')!==JSON.stringify(record))throw Error('ISSUED_LEDGER_MISMATCH');
 return {...m,filePath:join(dir,'report.xlsx'),manifestPath:join(dir,'manifest.json')};
}

export async function inspectIssuedStorage({outputDir,env=process.env}){
 if(env.RENDER!=='true'&&!env.RENDER_SERVICE_ID)return {ok:true,kind:'local',path:resolve(outputDir,'issued')};
 let path=resolve(outputDir);
 try{
  for(;;){try{path=await realpath(path);break;}catch(e){if(e.code!=='ENOENT'||dirname(path)===path)throw e;path=dirname(path);}}
  const mounts=(await readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(l=>{const [left,right]=l.split(' - ');return {path:left.split(' ')[4],fs:right?.split(' ')[0]};});
  const mount=mounts.filter(m=>{const r=relative(m.path,path);return r===''||(!r.startsWith('..')&&!isAbsolute(r));}).sort((a,b)=>b.path.length-a.path.length)[0];
  const ok=mount?.path==='/var/data'&&!['tmpfs','overlay'].includes(mount.fs);
  return {ok,kind:ok?'render_persistent_disk':'unverified',path:resolve(outputDir,'issued'),mount:mount?.path||null};
 }catch{return {ok:false,kind:'unverified',path:resolve(outputDir,'issued')};}
}

async function durableWrite(path,bytes){const h=await open(path,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function syncDir(path){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}

export async function storeIssuedMetaReport({outputDir,workbook,record,save}){
 if(!publishable(record.review)||record.mode!=='scheduled')throw Error('ISSUED_REVIEW_INVALID');
 return withPeriodLock(outputDir,record.since,record.until,async({parent,final})=>{
 const existing=await readIssuedMetaReport({outputDir,since:record.since,until:record.until});
 if(existing)return {...existing,alreadyIssued:true};
 const evidence=workbook.addWorksheet('ISSUE_EVIDENCE',{state:'veryHidden'});
 const encoded=JSON.stringify(record);for(let i=0;i<encoded.length;i+=30000)evidence.addRow([encoded.slice(i,i+30000)]);
 const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
 const manifest={...record,sha256:sha(bytes)};
 const stage=join(parent,`.pending-${randomUUID()}`);await mkdir(stage,{mode:0o700});
 await durableWrite(join(stage,'report.xlsx'),bytes);await durableWrite(join(stage,'manifest.json'),JSON.stringify(manifest,null,2));await syncDir(stage);
 // Freeze the exact reviewed bytes for the existing uploader. Its workbook API stays intact.
 const writeBuffer=workbook.xlsx.writeBuffer;workbook.xlsx.writeBuffer=async()=>bytes;
 let delivery;
 try{if(save)delivery=await save();}finally{workbook.xlsx.writeBuffer=writeBuffer;}
 if(delivery?.alreadyExists===true||/PREVIEW/i.test(delivery?.filePath||''))throw Error('UNVERIFIED_EXISTING_DELIVERY');
 // An already-issued nonempty directory cannot be replaced by rename (including a race).
 await rename(stage,final);await syncDir(parent);
 return {...manifest,filePath:join(final,'report.xlsx'),manifestPath:join(final,'manifest.json'),alreadyIssued:false,delivery};
 });
}

async function withPeriodLock(outputDir,since,until,work){
 const final=periodDir(outputDir,since,until),parent=dirname(final);
 await mkdir(parent,{recursive:true});
 const lockPath=join(parent,`.${since}_${until}.lock`);
 let lock;try{lock=await open(lockPath,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('ISSUED_PUBLICATION_BUSY');throw e;}
 try{return await work({parent,final});}finally{await lock.close();await unlink(lockPath);}
}

// ---------------------------------------------------------------------------
// Legacy baseline: an already-delivered Dropbox workbook (read-only source) registered as the issued
// figures for its period. Only values present in that workbook are recorded; item detail is not invented.
// ---------------------------------------------------------------------------
const cellText=v=>v&&typeof v==='object'?(v.richText?v.richText.map(t=>t.text).join(''):v.result??v.text??''):v;
export async function extractLegacyMetaBaseline(bytes){
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);
 const report=w.getWorksheet('REPORT'),sold=w.getWorksheet('ACTUAL_PRODUCTS_SOLD');
 if(!report||!sold)throw Error('LEGACY_SHEETS_MISSING');
 const period=/SAMPLAS\s+\|\s+(\d{4}-\d{2}-\d{2})\s+–\s+(\d{4}-\d{2}-\d{2})/.exec(String(cellText(report.getCell('A2').value)||''));
 if(!period)throw Error('LEGACY_PERIOD_MISSING');
 const [,since,until]=period;let card=null;
 report.eachRow(row=>row.eachCell(cell=>{if(cellText(cell.value)==='Cafe24 실제 Meta 유료 주문')card={row:Number(cell.row),col:Number(cell.col)};}));
 if(!card)throw Error('LEGACY_ACTUAL_CARD_MISSING');
 const revenue=cellText(report.getCell(card.row+1,card.col).value),note=String(cellText(report.getCell(card.row+2,card.col).value)||'');
 const count=/(?:^|· )(\d+)건 · 주문번호 일치/.exec(note);
 if(!Number.isSafeInteger(revenue)||revenue<0||!count)throw Error('LEGACY_ACTUAL_UNAVAILABLE');
 const header={};sold.getRow(1).eachCell(c=>{header[cellText(c.value)]=Number(c.col);});
 if(!['order_id','order_date','tracking_source','actual_paid_amount'].every(k=>header[k]))throw Error('LEGACY_COLUMNS_MISSING');
 const orders=new Map();
 sold.eachRow((row,n)=>{
  if(n===1)return;
  const v=k=>cellText(row.getCell(header[k]).value);
  if(!['META_PAID','META_INFLOW'].includes(v('tracking_source')))return;
  const id=String(v('order_id')||''),date=String(v('order_date')||''),paid=v('actual_paid_amount');
  if(!id||!inPeriod(date,since,until))throw Error('LEGACY_ORDER_INVALID');
  if(!orders.has(id))orders.set(id,{orderId:id,orderDate:date.slice(0,10),amount:0,items:[]});
  if(paid!==null&&paid!==undefined&&paid!==''){if(!Number.isSafeInteger(paid)||paid<0)throw Error('LEGACY_ORDER_INVALID');orders.get(id).amount+=paid;}
 });
 const list=[...orders.values()],summary={metaPaidOrderCount:Number(count[1]),metaPaidRevenue:revenue};
 if(list.length!==summary.metaPaidOrderCount||list.reduce((s,o)=>s+o.amount,0)!==summary.metaPaidRevenue)throw Error('LEGACY_TOTAL_MISMATCH');
 return {since,until,summary,orders:list,reportedActualText:note};
}

// Dropbox content_hash: SHA-256 over the concatenated SHA-256 digests of 4 MiB blocks.
export function dropboxContentHash(bytes){
 const parts=[];for(let i=0;i<bytes.length;i+=4194304)parts.push(createHash('sha256').update(bytes.subarray(i,i+4194304)).digest());
 return sha(Buffer.concat(parts));
}
export function legacyBaselineRecord({extracted,bytes,source,importedAt}){
 if(source?.dropboxContentHash&&source.dropboxContentHash!==dropboxContentHash(bytes))throw Error('LEGACY_DROPBOX_HASH_MISMATCH');
 if(!/^id:[A-Za-z0-9_-]+$/.test(source?.dropboxFileId||'')||typeof source.dropboxPath!=='string'||!source.dropboxPath.startsWith('/')||!Number.isFinite(time(source.serverModified)))throw Error('LEGACY_SOURCE_INVALID');
 if(!(time(importedAt)>=time(source.serverModified)))throw Error('LEGACY_IMPORT_TIME_INVALID');
 return {schemaVersion:1,kind:'legacy_import',policy:LEGACY_POLICY,legacyImport:true,since:extracted.since,until:extracted.until,
  issuedAt:new Date(time(source.serverModified)).toISOString(),importedAt,
  source:{dropboxFileId:source.dropboxFileId,dropboxPath:source.dropboxPath,dropboxRev:source.dropboxRev||null,serverModified:source.serverModified,dropboxContentHash:dropboxContentHash(bytes),sha256:sha(bytes),size:bytes.length},
  reportedActual:{...extracted.summary,text:extracted.reportedActualText},summary:extracted.summary,orders:extracted.orders};
}

async function readLegacyManifest(dir,m,since,until){
 if(m.schemaVersion!==1||m.policy!==LEGACY_POLICY||m.legacyImport!==true||m.since!==since||m.until!==until||!Array.isArray(m.orders)||!(time(m.importedAt)>=time(m.issuedAt))||m.sha256!==m.source?.sha256)throw Error('ISSUED_REVIEW_INVALID');
 const bytes=await readFile(join(dir,'report.xlsx'));
 if(sha(bytes)!==m.sha256)throw Error('ISSUED_HASH_MISMATCH');
 const again=await extractLegacyMetaBaseline(bytes);
 if(again.since!==since||again.until!==until||JSON.stringify(again.summary)!==JSON.stringify(m.summary)||JSON.stringify(again.orders)!==JSON.stringify(m.orders))throw Error('ISSUED_LEDGER_MISMATCH');
 return {...m,filePath:join(dir,'report.xlsx'),manifestPath:join(dir,'manifest.json')};
}

// Writes the untouched source bytes plus manifest; refuses any period that already has a record.
export async function storeLegacyMetaBaseline({outputDir,bytes,record}){
 const again=await extractLegacyMetaBaseline(bytes);
 if(record.kind!=='legacy_import'||sha(bytes)!==record.source?.sha256||again.since!==record.since||again.until!==record.until)throw Error('LEGACY_RECORD_INVALID');
 return withPeriodLock(outputDir,record.since,record.until,async({parent,final})=>{
  if(await readIssuedMetaReport({outputDir,since:record.since,until:record.until}).catch(()=>true))throw Error('ISSUED_PERIOD_ALREADY_RECORDED');
  const manifest={...record,sha256:record.source.sha256};
  const stage=join(parent,`.pending-${randomUUID()}`);await mkdir(stage,{mode:0o700});
  await durableWrite(join(stage,'report.xlsx'),bytes);await durableWrite(join(stage,'manifest.json'),JSON.stringify(manifest,null,2));await syncDir(stage);
  await rename(stage,final);await syncDir(parent);
  return {...manifest,filePath:join(final,'report.xlsx'),manifestPath:join(final,'manifest.json')};
 });
}
