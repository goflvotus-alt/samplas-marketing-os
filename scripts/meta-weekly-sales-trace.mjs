import {cafe24OrderAmount,cafe24OrderItems,cafe24ShippingFee,isCafe24CanceledItem,isCafe24CanceledOrRefunded,parseCafe24Money,trustedCafe24OrderDate} from './cafe24-order-amount.mjs';
import {parseMetaContentId} from './meta-product-registry-link.mjs';

const U='UNAVAILABLE',sum=(rows,key)=>rows.reduce((s,r)=>s+(typeof r[key]==='number'?r[key]:0),0);
const publicText=v=>typeof v==='string'||typeof v==='number'?String(v).replace(/[\x00-\x1f\x7f]/g,' ').replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi,'[REDACTED]').replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g,'[REDACTED]').slice(0,300):'';
const money=v=>parseCafe24Money(v);
const purchase=rows=>{const r=Array.isArray(rows)?rows.find(r=>['purchase','offsite_conversion.fb_pixel_purchase'].includes(r.action_type)):null;return r&&Number.isFinite(Number(r.value))?Number(r.value):null;};
export const safeWeeklyProductName=v=>/개인결제창/.test(String(v||''))?'개인결제창 [개인정보 제거 / 실상품 미확인]':publicText(v);
const safeMetaProductId=v=>{const raw=publicText(v);if(!/개인결제창/.test(raw))return raw;const p=parseMetaContentId(raw);return p.valid?`${p.cafe24ProductNo}.${p.variantCode}, 개인결제창 [개인정보 제거]`:'UNAVAILABLE [개인결제창]';};

// These GET callbacks must not refresh credentials. Errors leave partial evidence, never guessed money.
export async function fetchWeeklyItemPayments({codes,get,batchSize=30}){
 const unique=[...new Set(codes.filter(c=>typeof c==='string'&&c))],rows=[],errors=[];
 for(let i=0;i<unique.length;i+=batchSize){
  let body;try{body=await get('/orders/paymentamount',{order_item_code:unique.slice(i,i+batchSize).join(',')});}
  catch(e){body={error:{code:e?.status||0}};}
  if(body?.error){
   const message=String(body.error.message||'');
   errors.push({code:Number(body.error.code)||0,reason:/version|버전/i.test(message)?'API_VERSION_UNAVAILABLE':/자동.?계산|automatic.*calculat/i.test(message)?'AUTO_CALCULATION_UNAVAILABLE':'PAYMENT_LOOKUP_FAILED'});break;
  }
  const records=Array.isArray(body)?body:body?.paymentamount;
  if(!Array.isArray(records)){errors.push({code:0,reason:'PAYMENT_RESPONSE_SHAPE'});break;}
  const requested=new Set(unique.slice(i,i+batchSize));
  for(const r of records){if(!requested.has(r?.order_item_code)){errors.push({code:0,reason:'UNREQUESTED_PAYMENT_RECORD'});continue;}
   rows.push({order_item_code:r.order_item_code,payment_amount:money(r.payment_amount),actual_payment_amount:money(r.actual_payment_amount)});
  }
 }
 if(!errors.length&&new Set(rows.map(r=>r.order_item_code)).size!==unique.length)errors.push({code:200,reason:'PAYMENT_RECORDS_MISSING'});
 return {rows,errors,completeness:errors.length?'PARTIAL':'COMPLETE'};
}

export function buildWeeklySalesTrace({since,until,actualOrders,analytics,payments,metaProducts,tracking,ads=[],metaSummary}={}){
 const warnings=new Set(),orders=[],details=[],seen=new Map(),amounts=new Map();
 for(const p of payments?.rows||[]){if(amounts.has(p.order_item_code)){warnings.add('DUPLICATE_PAYMENT_RECORD');amounts.set(p.order_item_code,null);}else amounts.set(p.order_item_code,money(p.actual_payment_amount)??money(p.payment_amount));}
 let candidates=[];
 if(Array.isArray(actualOrders?.analyticsOrders)){candidates=actualOrders.analyticsOrders;if(!actualOrders.analyticsOrdersComplete||actualOrders.analyticsOrdersCoverage?.completeness&&actualOrders.analyticsOrdersCoverage.completeness!=='COMPLETE')warnings.add('ALL_ORDERS_UNVERIFIED');}
 else if(Array.isArray(actualOrders)){candidates=actualOrders;warnings.add('ALL_ORDERS_UNVERIFIED');}
 else if(Array.isArray(actualOrders?.orders)&&!actualOrders.trackingQueries){candidates=actualOrders.orders;if(actualOrders.coverage?.completeness!=='COMPLETE')warnings.add('ALL_ORDERS_UNVERIFIED');}
 else warnings.add('ALL_ORDERS_UNAVAILABLE');
 for(const o of candidates){
  const id=typeof o?.order_id==='string'?o.order_id:null,date=trustedCafe24OrderDate(o);
  if(!id||!date){warnings.add('ORDER_ID_OR_DATE_MISSING');continue;}if(date<since||date>until){warnings.add('ORDER_OUTSIDE_PERIOD');continue;}
  if(seen.has(id)){warnings.add('DUPLICATE_ORDER');if(seen.get(id)!==JSON.stringify(o))warnings.add('CONFLICTING_ORDER');continue;}seen.set(id,JSON.stringify(o));
  const canceled=isCafe24CanceledOrRefunded(o),items=cafe24OrderItems(o),unique=new Map();
  for(const item of items){const key=item.order_item_code;if(!key){warnings.add('ITEM_ID_MISSING');continue;}if(unique.has(key)){warnings.add('DUPLICATE_ITEM');if(JSON.stringify(unique.get(key))!==JSON.stringify(item))warnings.add('CONFLICTING_ITEM');continue;}unique.set(key,item);}
  if(!unique.size)warnings.add('ORDER_ITEMS_MISSING');
  const active=[...unique.values()].filter(i=>!canceled&&!isCafe24CanceledItem(i));
  const rawCash=money(o.actual_order_amount?.payment_amount??o.actual_payment_amount??o.payment_amount),shipping=cafe24ShippingFee(o);
  let revenue=cafe24OrderAmount(o);if(!canceled&&(rawCash===null||revenue===0&&String(o.paid).toUpperCase()==='T')){warnings.add('ORDER_PAYMENT_UNVERIFIED');revenue=null;}
  const currentCash=canceled?0:rawCash;
  const linePayments=active.map(i=>amounts.get(i.order_item_code)??money(i.actual_payment_amount??i.payment_amount));
  const cashExact=linePayments.every(v=>v!==null)&&linePayments.reduce((s,n)=>s+n,0)===currentCash-shipping;
  const salesExact=linePayments.every(v=>v!==null)&&revenue!==null&&linePayments.reduce((s,n)=>s+n,0)===revenue-shipping;
  if(active.length>1&&linePayments.every(v=>v!==null)&&!salesExact)warnings.add('ITEM_PAYMENT_RECONCILIATION_FAILED');
  const mine=[];for(const i of unique.values()){
   const excluded=canceled||isCafe24CanceledItem(i),quantity=typeof i.quantity!=='object'&&String(i.quantity??'').trim()!==''&&Number.isInteger(Number(i.quantity))&&Number(i.quantity)>0?Number(i.quantity):null;
   if(quantity===null)warnings.add('ITEM_QUANTITY_MISSING');
   const name=safeWeeklyProductName(i.product_name||i.name),privatePayment=/개인결제창/.test(name),brand=privatePayment?null:publicText(name.match(/^\[([^\]]+)\]/)?.[1])||null;
   if(privatePayment)warnings.add('PRIVATE_PAYMENT_PRODUCT_UNKNOWN');
   const direct=amounts.get(i.order_item_code)??money(i.actual_payment_amount??i.payment_amount);
   const row={orderId:id,date,orderTime:publicText(o.order_date),itemId:publicText(i.order_item_code),brand,productName:name,productNo:publicText(i.product_no),variant:publicText(i.variant_code||i.sku),option:publicText(i.option_value||i.option_name||i.option)||'(옵션 없음)',quantity,retainedQuantity:excluded?0:quantity,
    paidAmount:excluded?0:active.length===1&&currentCash!==null?currentCash-shipping:cashExact?direct:null,
    salesAmount:excluded?0:active.length===1&&revenue!==null?revenue-shipping:salesExact?direct:null,
    status:publicText(i.order_status||i.status_code),claim:publicText(i.status_text||i.status),excluded,privatePayment,refundDate:publicText(i.refund_date)||null,claimDate:publicText(i.return_confirmed_date||i.cancel_date||i.return_request_date)||null,
    amountBasis:excluded?'EXCLUDED_COMPLETED_CLAIM':active.length===1?'SINGLE_RETAINED_ITEM_EX_SHIPPING':salesExact?'ITEM_PAYMENT_API_RECONCILED':'UNAVAILABLE_NO_ALLOCATION'};
   details.push(row);mine.push(row);
  }
  const allocated=sum(mine,'salesAmount'),unallocated=revenue===null?null:revenue-shipping-allocated;
  if(unallocated!==0)warnings.add('ITEM_AMOUNTS_UNAVAILABLE');
  orders.push({orderId:id,date,revenue,shipping,cash:currentCash,initialCash:money(o.initial_order_amount?.payment_amount),unallocated,quantity:mine.some(r=>r.retainedQuantity===null)?null:sum(mine,'retainedQuantity'),excluded:canceled});
 }
 const productsMap=new Map();for(const row of details){const key=JSON.stringify([row.brand,row.productNo,row.variant,row.productName,row.option]);if(!productsMap.has(key))productsMap.set(key,{brand:row.brand,productNo:row.productNo,variant:row.variant,productName:row.productName,option:row.option,lines:[]});productsMap.get(key).lines.push(row);}
 const products=[...productsMap.values()].map(p=>({...p,quantity:p.lines.some(r=>r.retainedQuantity===null)?null:sum(p.lines,'retainedQuantity'),amount:p.lines.some(r=>r.salesAmount===null)?null:sum(p.lines,'salesAmount'),knownAmount:sum(p.lines,'salesAmount'),unknownAmountLines:p.lines.filter(r=>r.salesAmount===null).length}));
 const analyticsRows=Array.isArray(analytics?.data?.orderdetails)?analytics.data.orderdetails:Array.isArray(analytics?.orderdetails)?analytics.orderdetails:[];
 if(analytics?.coverage?.completeness&&analytics.coverage.completeness!=='COMPLETE'||!analytics)warnings.add('ANALYTICS_UNVERIFIED');
 const acquisition=new Map();for(const a of analyticsRows){if(acquisition.has(a.order_id)){warnings.add('DUPLICATE_ANALYTICS_ORDER');acquisition.set(a.order_id,null);}else acquisition.set(a.order_id,a);}
 const adIds=new Set(ads.map(a=>String(a.adId))),byName=new Map();for(const a of ads){const name=String(a.adName||'').trim().normalize('NFC');if(!byName.has(name))byName.set(name,new Set());byName.get(name).add(String(a.adId));}
 const trackedOrders=orders.map(o=>{const a=acquisition.get(o.orderId),content=String(a?.content||'').trim(),paid=['ig','meta'].includes(String(a?.ad||'').toLowerCase())&&String(a?.medium||'').toLowerCase()==='paid',ids=byName.get(content.normalize('NFC'));
  return {orderId:o.orderId,source:publicText(a?.ad),medium:publicText(a?.medium),campaign:publicText(a?.campaign),content:publicText(a?.content),grade:paid?(adIds.has(content)?'G1_AD_ID':ids?.size===1?'G2_AD_NAME':'G3_UNMATCHED'):[a?.ad,a?.medium,a?.campaign,a?.content].some(Boolean)?'OTHER_INFLOW':'NO_INFLOW',eventMatch:'NOT TRACEABLE'};
 });
 // The legacy inflow query does not prove that ghost_mall_id was queried or returned.
 warnings.add('GHOST_MALL_ID_UNVERIFIED');
 const utmRows=(tracking?.rows||[]).map(a=>{const params=new URLSearchParams(String(a?.creative?.url_tags||a.url_tags||''));return {adId:publicText(a.id||a.adId),adName:publicText(a.name||a.adName),utmSource:publicText(params.get('utm_source')),utmMedium:publicText(params.get('utm_medium')),utmCampaign:publicText(params.get('utm_campaign')),utmContent:publicText(params.get('utm_content')),legacyGhost:/^meta_[a-z0-9_]+$/.test(params.get('ghost_mall_id')||'')?params.get('ghost_mall_id'):''};});
 if(tracking?.completeness!=='COMPLETE')warnings.add('AD_UTM_UNAVAILABLE');
 const adTotals=new Map(ads.map(a=>[String(a.adId??a.ad_id??''),a]));
 const metaGroups=new Map();for(const row of metaProducts?.rows||[]){
  const id=safeMetaProductId(row.product_id||row.contentId),adId=publicText(row.ad_id??row.adId),key=JSON.stringify([adId,id]),parsed=parseMetaContentId(id),count=purchase(row.actions)??(Number.isFinite(row.purchaseCount)?row.purchaseCount:null);
  if(!metaGroups.has(key))metaGroups.set(key,{adId,adName:publicText(row.ad_name??row.adName??adTotals.get(adId)?.adName),productId:id,productNo:parsed.valid?String(parsed.cafe24ProductNo):null,variant:parsed.valid?parsed.variantCode:null,metaPurchases:0,unknownPurchases:false});
  const g=metaGroups.get(key);if(count===null)g.unknownPurchases=true;else g.metaPurchases+=count;
 }
 const metaProductRows=[...metaGroups.values()].map(g=>{const matched=products.filter(p=>p.productNo===g.productNo&&p.variant===g.variant),productOnly=g.productNo&&products.some(p=>p.productNo===g.productNo);return {...g,metaPurchases:g.unknownPurchases?null:g.metaPurchases,actualQuantity:matched.length&&!matched.some(p=>p.quantity===null)?sum(matched,'quantity'):null,actualAmount:matched.length&&!matched.some(p=>p.amount===null)?sum(matched,'amount'):null,match:matched.length?'PRODUCT_VARIANT_ID':productOnly?'PRODUCT_NO_ONLY':'UNRESOLVED',note:'광고 노출 상품 기준 집계. 실제 판매 상품 및 Meta 개별 구매 이벤트와 주문의 일대일 연결 아님.'};});
 if(metaProducts?.completeness!=='COMPLETE')warnings.add('META_PRODUCT_INSIGHTS_UNAVAILABLE');
 const metaProductPurchases=metaProducts?.completeness==='COMPLETE'&&!metaProductRows.some(r=>r.metaPurchases===null)?sum(metaProductRows,'metaPurchases'):null;
 if(typeof metaSummary?.purchases==='number'&&metaProductPurchases!==null&&metaSummary.purchases!==metaProductPurchases)warnings.add('META_PRODUCT_PURCHASE_TOTAL_DIFF');
 const metaAdDifferences=[...adTotals].map(([adId,ad])=>{
  const rows=metaProductRows.filter(r=>r.adId===adId),total=Number.isFinite(ad.purchases)?ad.purchases:null,productTotal=metaProducts?.completeness==='COMPLETE'&&rows.every(r=>r.metaPurchases!==null)?sum(rows,'metaPurchases'):null,difference=total!==null&&productTotal!==null?total-productTotal:null;
  if(difference<0)warnings.add('META_AD_PRODUCT_PURCHASE_EXCEEDS_TOTAL');
  return {adId:publicText(adId),adName:publicText(ad.adName??ad.ad_name),productId:'product_id 없음 / 상품별 분해 불가',metaPurchases:difference!==null&&difference>=0?difference:null,adPurchases:total,productPurchases:productTotal,match:'NOT_TRACEABLE',note:difference===null?'광고별 비교 근거 미확인. 원인 확정 불가.':difference<0?'상품별 구매가 광고 전체 구매를 초과함. 원인 확정 불가.':'광고별 전체 구매와 product_id 구매 합계의 산술 차이. 누락 원인 및 실제 판매 상품은 확정하지 않음.'};
 });
 for(const e of payments?.errors||[])warnings.add(e.reason);
 const dates=[];for(let at=Date.parse(since+'T00:00:00Z');at<=Date.parse(until+'T00:00:00Z');at+=86400000)dates.push(new Date(at).toISOString().slice(0,10));
 const unverified=warnings.has('ALL_ORDERS_UNVERIFIED')||warnings.has('ALL_ORDERS_UNAVAILABLE');
 const daily=dates.map(date=>{const rows=orders.filter(o=>o.date===date);return {date,orders:unverified?null:rows.length,quantity:unverified||rows.some(o=>o.quantity===null)?null:sum(rows,'quantity'),revenue:unverified||rows.some(o=>o.revenue===null)?null:sum(rows,'revenue'),cash:unverified||rows.some(o=>o.cash===null)?null:sum(rows,'cash'),unallocated:unverified||rows.some(o=>o.unallocated===null)?null:sum(rows,'unallocated')};});
 return {completeness:warnings.size?'PARTIAL':'COMPLETE',warnings:[...warnings],orders,details,products,metaProducts:metaProductRows,metaAdDifferences,tracking:{orders:trackedOrders,ads:utmRows,queries:(actualOrders?.trackingQueries||[]).map(q=>({code:publicText(q.code),ok:q.ok===true,complete:q.complete===true,count:q.count??null}))},daily,
  summary:{orders:unverified?null:orders.length,quantity:unverified||orders.some(o=>o.quantity===null)?null:sum(orders,'quantity'),revenue:unverified||orders.some(o=>o.revenue===null)?null:sum(orders,'revenue'),cash:unverified||orders.some(o=>o.cash===null)?null:sum(orders,'cash'),shipping:sum(orders,'shipping'),unallocated:orders.some(o=>o.unallocated===null)?null:sum(orders,'unallocated'),knownItemRevenue:sum(details,'salesAmount'),ordersWithoutInflow:trackedOrders.filter(r=>r.grade==='NO_INFLOW').length,matchedPurchaseEvents:0,metaProductPurchases,metaAccountPurchases:metaSummary?.purchases??null,unknownItemAmounts:details.filter(r=>r.salesAmount===null).length,privatePaymentItems:details.filter(r=>r.privatePayment).length}};
}

function sheet(wb,name,fields){const s=wb.addWorksheet(name);s.columns=fields.map(([key,header,width])=>({key,header,width:width||24,style:{numFmt:['paidAmount','salesAmount','amount','knownAmount','revenue','cash','initialCash','shipping','unallocated','actualAmount'].includes(key)?'#,##0"원"':'General'}}));s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).alignment={wrapText:true,vertical:'middle'};s.getRow(1).height=36;s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF334155'}};s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:1,column:fields.length}};return s;}
const add=(sh,rows)=>{for(const row of rows){const added=sh.addRow(Object.fromEntries(Object.entries(row).filter(([,v])=>!Array.isArray(v)&&typeof v!=='object'||v===null).map(([k,v])=>[k,v??U])));added.alignment={wrapText:true,vertical:'middle'};added.height=36;added.eachCell(c=>{if(c.value===U)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF1DB'}};});}};
function totals(sh,label,keys){const end=sh.rowCount,row=sh.addRow({[sh.columns[0].key]:label});row.font={bold:true};for(const key of keys){const column=sh.getColumn(key),values=Array.from({length:end-1},(_,i)=>sh.getRow(i+2).getCell(column.number).value);row.getCell(column.number).value=values.every(v=>typeof v==='number')&&values.length?{formula:`SUM(${column.letter}2:${column.letter}${end})`,result:values.reduce((s,n)=>s+n,0)}:U;}}
export function addWeeklySalesTraceSheets(wb,trace){
 const detail=sheet(wb,'ORDER_DETAIL',[['orderTime','주문일시 (KST)',28],['orderId','주문번호'],['itemId','주문품목 코드',28],['brand','브랜드 (상품명 표기)',34],['productName','상품명',80],['option','옵션 / 사이즈 / 컬러',36],['quantity','주문 수량'],['retainedQuantity','유지 수량'],['paidAmount','품목 유지 결제액'],['salesAmount','품목 V2 운영 매출'],['status','주문 상태'],['claim','취소·반품 상태'],['privatePayment','개인결제창'],['refundDate','실제 환불일',28],['claimDate','클레임일',28],['amountBasis','금액 근거',42]]);add(detail,trace.details);
 const products=sheet(wb,'PRODUCT SUMMARY',[['brand','브랜드',34],['productName','상품명',80],['productNo','Cafe24 상품번호'],['variant','옵션 코드'],['option','옵션',36],['quantity','유지 판매 수량'],['amount','상품별 V2 매출'],['knownAmount','확인된 품목 소계'],['unknownAmountLines','금액 미확인 품목 수']]);add(products,trace.products);
 const meta=sheet(wb,'META_PRODUCTS',[['adId','광고 ID'],['adName','광고명',42],['productId','Meta product_id',70],['productNo','Cafe24 상품번호'],['variant','옵션 코드'],['metaPurchases','Meta 귀속 구매 (광고 노출 상품 기준 · 실제 판매 상품 아님)',44],['adPurchases','광고 전체 구매'],['productPurchases','광고 product_id 구매 합계'],['actualQuantity','Cafe24 유지 수량'],['actualAmount','Cafe24 V2 상품 매출'],['match','상품 식별 근거'],['note','한계',90]]);add(meta,trace.metaProducts);add(meta,trace.metaAdDifferences||[]);meta.eachRow((r,n)=>{if(n>1)r.height=60;});if(!trace.metaProducts.length)meta.addRow({note:'UNAVAILABLE — product_id Insights 미확인. 0건으로 해석하지 말 것.'});
 const productNote=meta.addRow({note:`product_id 구매 집계 ${trace.summary.metaProductPurchases??U} / 계정 구매 ${trace.summary.metaAccountPurchases??U}. 차이를 주문·상품에 배분하지 않음. 일치 주문품목이 없는 ID는 실판매 0으로 단정하지 않음.`});productNote.alignment={wrapText:true,vertical:'middle'};productNote.height=54;
 const diagnostics=sheet(wb,'TRACKING_DIAGNOSTICS',[['kind','구분'],['orderId','주문번호'],['adId','광고 ID'],['adName','광고명',42],['source','source'],['medium','medium'],['campaign','campaign'],['content','content'],['grade','G1 ID / G2 광고명 후보'],['eventMatch','구매 이벤트 연결'],['note','설명',90]]);
 add(diagnostics,trace.tracking.orders.map(r=>({kind:'ORDER_INFLOW',...r})));add(diagnostics,trace.tracking.ads.map(r=>({kind:'AD_UTM',adId:r.adId,adName:r.adName,source:r.utmSource,medium:r.utmMedium,campaign:r.utmCampaign,content:r.utmContent,eventMatch:'NOT TRACEABLE',note:r.legacyGhost?`설정된 ghost_mall_id=${r.legacyGhost}; 주문 유입 기록으로의 전달은 미검증`:''})));
 add(diagnostics,trace.tracking.queries.map(q=>({kind:'LEGACY_QUERY',note:`${q.code}: ok=${q.ok}; complete=${q.complete}; count=${q.count??U}`})));
 diagnostics.addRow({kind:'NO_INFLOW',note:`유입 정보 없는 주문 ${trace.summary.ordersWithoutInflow}건. G1은 유입 ID 일치, G2는 광고명 후보이며 구매 이벤트 연결이 아님.`});for(const warning of trace.warnings)diagnostics.addRow({kind:'WARNING',note:warning});
 const daily=sheet(wb,'DAILY SALES',[['date','주문일 (KST)'],['orders','주문 수'],['quantity','유지 수량'],['revenue','V2 운영 매출'],['cash','취소·반품완료 제외 결제액'],['unallocated','품목 미배분 매출']]);add(daily,trace.daily);
 const orders=sheet(wb,'ORDER_TOTALS',[['orderId','주문번호'],['date','주문일'],['quantity','유지 수량'],['revenue','V2 운영 매출'],['cash','유지 결제액'],['initialCash','최초 결제액 원본'],['shipping','배송비'],['unallocated','품목 미배분 매출'],['excluded','완료 취소·반품 제외']]);add(orders,trace.orders);
 totals(detail,'확인 소계',['quantity','retainedQuantity','paidAmount','salesAmount']);totals(products,'주간 합계 (미확인 제외 불가)',['quantity','amount','knownAmount','unknownAmountLines']);totals(daily,'주간 합계',['orders','quantity','revenue','cash','unallocated']);totals(orders,'주간 합계',['quantity','revenue','cash','initialCash','shipping','unallocated']);
 const summary=wb.getWorksheet('SUMMARY');if(summary){summary.addRow([]);for(const [label,value]of [['전체 Cafe24 주문 수',trace.summary.orders],['전체 유지 판매 수량',trace.summary.quantity],['전체 Cafe24 V2 운영 매출',trace.summary.revenue],['전체 Cafe24 유지 결제액',trace.summary.cash],['품목 금액 미배분',trace.summary.unallocated],['판매 추적 검증',trace.completeness],['환불일 기준 실지급 환불액',U]]){const row=summary.addRow({label,current:value??U});if(/매출|결제액|미배분|환불액/.test(label))row.getCell('current').numFmt='#,##0"원"';}
 const note=summary.addRow({label:'집계 기준',current:'원거래 주문일 기준 / Cafe24 조회 시점 상태 (source snapshot time). 유지 매출에 취소·반품 감소분을 이중 차감하지 않음. 선불금 V2 복원은 현금 결제와 구분.'});summary.mergeCells(`B${note.number}:D${note.number}`);note.getCell(2).alignment={wrapText:true,vertical:'middle'};note.height=48;
 summary.getColumn('A').width=46;summary.getColumn('B').width=27;summary.getColumn('C').width=27;summary.getCell('B2').alignment={wrapText:true};summary.getCell('C2').alignment={wrapText:true};summary.mergeCells('B3:D3');summary.getCell('B3').alignment={wrapText:true,vertical:'middle'};summary.getRow(3).height=48;}
 return wb;
}
