// Independent payment-date totals. Never replace missing evidence with Meta or Marketing OS sales.
import {firstCafe24MoneyOrNull,cafe24OrderAmount,isCafe24CanceledOrRefunded,isCafe24StoredValuePayment} from './cafe24-order-amount.mjs';
import {buildActualProductsSold} from './meta-actual-products-sold.mjs';

export function paymentDay(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value))return null;
 const date=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)?value:value.slice(0,10)+'T'+(value.slice(11)||'00:00:00')+'+09:00');
 return Number.isFinite(date.getTime())?new Date(date.getTime()+9*3600000).toISOString().slice(0,10):null;
}
export function buildRevenueEvidence({since,until,paymentOrders,analytics,metaAds=[]}) {
 const e={since,until,timezone:'Asia/Seoul',dateBasis:'pay_date',queriedAt:paymentOrders?.queriedAt??null,
  source:'Cafe24 Admin Orders',dataAsOf:paymentOrders?.dataAsOf??null,queryOk:!!paymentOrders&&paymentOrders.ok!==false&&!paymentOrders.error&&Array.isArray(paymentOrders.orders),
  coverage:paymentOrders?.coverage??null,status:'UNVERIFIED',onlineRevenue:null,onlineOrders:null,verifiedRevenue:null,verifiedOrders:null,
  rawOrders:paymentOrders?.orders?.length??null,uniqueOrders:0,duplicateOrders:0,validOrders:0,excludedUnpaid:0,excludedCanceled:0,
  grossPayment:null,adjustment:null,linkedOrders:null,unlinkedOrders:null,unknownLinkOrders:null,reasons:[],
  basis:'KST 결제일 화~월 주문 코호트 · 조회 시점 canonical 잔여 결제액(배송비 포함) · 완료 취소/환불 제외 · 부분취소 잔여액 1회 · 적립금 정책은 기존 canonical 유지',
  limitations:'세 매출은 합산 금지. 미연결은 광고 비기여를 뜻하지 않음. Analytics는 주문일 조회이므로 이전 주문의 후일 결제는 연결 누락 가능. Meta 구매 이벤트와 주문 1:1 대조 아님. 후속 환불은 기존 REFUND_TRACKING 별도.'};
 const complete=(c)=>c?.completeness==='COMPLETE'&&c.scope?.since===since&&c.scope?.until===until;
 if(!e.queryOk||paymentOrders.dateType!=='pay_date'||!complete(e.coverage)){e.reasons.push('PAYMENT_DATE_ORDERS_UNVERIFIED');return e;}
 const orders=new Map();
 for(const o of paymentOrders.orders){
  const id=String(o?.order_id||'').trim(),day=paymentDay(o?.payment_date||o?.paid_date);
  if(!id||!day||day<since||day>until){e.reasons.push('ORDER_ID_OR_PAYMENT_DATE_INVALID');continue;}
  if(orders.has(id)){e.duplicateOrders++;if(JSON.stringify(orders.get(id))!==JSON.stringify(o))e.reasons.push('DUPLICATE_ORDER_CONFLICT');continue;}
  orders.set(id,o);
 }
 e.uniqueOrders=orders.size;
 const valid=[];let net=0,gross=0,grossKnown=true;
 for(const o of orders.values()){
  const canceled=isCafe24CanceledOrRefunded(o);
  if(!canceled&&o.paid==='F'){e.excludedUnpaid++;continue;}
  if(!canceled&&o.paid!=='T'){e.reasons.push('PAID_STATE_UNKNOWN');continue;}
  const storedValue=isCafe24StoredValuePayment(o);
  let initial=firstCafe24MoneyOrNull([o.initial_order_amount?.payment_amount]);
  if(initial===0&&storedValue){
   // Compare the same economic basis, including the existing stored-value discounts.
   const restored=cafe24OrderAmount({...o,actual_order_amount:o.initial_order_amount});
   initial=restored>0?restored:null;
  }
  if(initial===null||initial<0)grossKnown=false;else gross+=initial;
  if(canceled){e.excludedCanceled++;continue;}
  const primary=firstCafe24MoneyOrNull([o.actual_order_amount?.payment_amount,o.actual_payment_amount,o.payment_amount]);
  const amount=cafe24OrderAmount(o);
  if(primary===null||primary<0||(primary===0&&!storedValue)||!Number.isSafeInteger(amount)||amount<=0){e.reasons.push('PAYMENT_AMOUNT_UNVERIFIED');continue;}
  if(initial!==null&&initial<amount){e.reasons.push('INITIAL_PAYMENT_BELOW_REMAINING');grossKnown=false;}
  net+=amount;valid.push({...o,order_date:paymentDay(o.payment_date||o.paid_date)});
 }
 e.validOrders=valid.length;e.grossPayment=grossKnown?gross:null;e.adjustment=grossKnown?net-gross:null;
 if(e.reasons.length)return e;
 e.onlineRevenue=net;e.onlineOrders=valid.length;e.status='PARTIAL';
 const rows=analytics?.data?.orderdetails||analytics?.orderdetails;
 if(analytics?.ok!==true||!Array.isArray(rows)||rows.length>=100||!complete(analytics.coverage)){
  e.unknownLinkOrders=valid.length;e.reasons.push('ANALYTICS_UNVERIFIED');return e;
 }
 // Conflicting acquisition rows cannot be resolved by picking the last row.
 const acquisition=new Map();let conflict=false;
 for(const r of rows){if(!r.order_id)continue;const sig=JSON.stringify([r.ad,r.medium,r.campaign,r.content,r.keyword]);if(acquisition.has(r.order_id)&&acquisition.get(r.order_id)!==sig)conflict=true;acquisition.set(r.order_id,sig);}
 const products=buildActualProductsSold({data:{orders:valid},analytics,metaAds,since,until,adGrades:true});
 if(conflict||!products.available||products.missingItems||products.missingDates||valid.some(o=>o.itemFetchError)){
  e.unknownLinkOrders=valid.length;e.reasons.push('LINK_ORDER_EVIDENCE_UNVERIFIED');return e;
 }
 // Analytics paid + exact delivering ad ID + exact Admin order ID. Name-only/legacy candidates excluded.
 const linked=new Set(products.rows.filter(r=>r.attribution_grade==='G1_AD_ID'&&r.tracking_source==='META_PAID'&&r.amount_status!=='PAYMENT_UNVERIFIED').map(r=>r.order_id));
 e.linkedOrders=linked.size;e.unlinkedOrders=valid.length-linked.size;e.unknownLinkOrders=0;
 e.verifiedOrders=linked.size;e.verifiedRevenue=valid.filter(o=>linked.has(o.order_id)).reduce((s,o)=>s+cafe24OrderAmount(o),0);
 e.linkEvidence=valid.filter(o=>linked.has(o.order_id)).map(o=>({orderId:o.order_id,paymentDate:paymentDay(o.payment_date||o.paid_date),adId:products.rows.find(r=>r.order_id===o.order_id&&r.attribution_grade==='G1_AD_ID')?.matched_ad_id,amount:cafe24OrderAmount(o),basis:'Admin paid=T + Analytics paid + exact order_id/content ad ID'}));
 if(!grossKnown)e.reasons.push('INITIAL_PAYMENT_OR_ADJUSTMENT_UNVERIFIED');
 e.status=e.reasons.length?'PARTIAL':'PASS';return e;
}
export function revenueMetrics(model){
 const cur=model.revenueEvidence?.current,prev=model.revenueEvidence?.previous;
 const value=(e,k)=>typeof e?.[k]==='number'?e[k]:'UNVERIFIED';
 return [
  {key:'metaRevenue',label:'Meta 귀속 구매매출',english:'META ATTRIBUTED REVENUE',current:model.summary?.purchaseValue,previous:model.previousSummary?.purchaseValue,unit:'원'},
  {key:'onlineRevenue',label:'Cafe24 실제 온라인 결제매출',english:'CAFE24 ONLINE SALES',current:value(cur,'onlineRevenue'),previous:value(prev,'onlineRevenue'),unit:'원'},
  {key:'verifiedRevenue',label:'Meta 광고 연결 검증 매출',english:'META VERIFIED SALES',current:value(cur,'verifiedRevenue'),previous:value(prev,'verifiedRevenue'),unit:'원'},
  {key:'metaOrders',label:'Meta 구매 건수',current:model.summary?.purchases,previous:model.previousSummary?.purchases,unit:'건'},
  {key:'onlineOrders',label:'Cafe24 실제 결제 주문 건수',current:value(cur,'onlineOrders'),previous:value(prev,'onlineOrders'),unit:'건'},
  {key:'verifiedOrders',label:'Meta 연결 검증 주문 건수',current:value(cur,'verifiedOrders'),previous:value(prev,'verifiedOrders'),unit:'건'}
 ];
}
export function writeRevenueEvidence(workbook,model){
 const sheet=workbook.addWorksheet('ISSUE_EVIDENCE');
 // Column A remains reserved for the existing immutable publication JSON and its reader.
 sheet.getColumn(3).width=35;sheet.getColumn(4).width=30;sheet.getColumn(5).width=30;
 sheet.getCell('C1').value='매출 검증 근거';sheet.getCell('D1').value='이번 주';sheet.getCell('E1').value='직전 주';
 let row=2;
 for(const metric of revenueMetrics(model)){
  sheet.getCell(row,3).value=metric.english||metric.label;
  sheet.getCell(row,4).value=metric.current??'N/A';sheet.getCell(row,5).value=metric.previous??'N/A';row++;
 }
 const {current,previous}=model.revenueEvidence||{};
 for(const [key,field] of [['Meta - Cafe24 매출 차이','onlineRevenue'],['Meta - 검증 매출 차이','verifiedRevenue']]){
  sheet.getCell(row,3).value=key;
  for(const [col,e,total] of [[4,current,model.summary?.purchaseValue],[5,previous,model.previousSummary?.purchaseValue]])sheet.getCell(row,col).value=typeof total==='number'&&typeof e?.[field]==='number'?total-e[field]:'UNVERIFIED';
  row++;
 }
 for(const key of Object.keys(current||previous||{})){
  sheet.getCell(row,3).value=key;
  for(const [col,e] of [[4,current],[5,previous]]){const v=e?.[key];sheet.getCell(row,col).value=v==null?'UNVERIFIED':typeof v==='object'?JSON.stringify(v):v;}
  row++;
 }
 sheet.getColumn(4).numFmt='#,##0';sheet.getColumn(5).numFmt='#,##0';
 return sheet;
}
