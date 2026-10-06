// Cafe24 actual orders only. All cancellation, quantity, date and money semantics
// are the same canonical helpers imported by server.mjs; no attributed Meta totals.
import {isCafe24CanceledOrRefunded,isCafe24CanceledItem,cafe24OrderItems,cafe24ItemQuantity,cafe24ItemAmount,cafe24OrderAmount,trustedCafe24OrderDate} from './cafe24-order-amount.mjs';
const MAPPINGS={meta_meantime_look:'MEANTIME 착장 광고',meta_ssage:'SSㅏ게 드립니다.',meta_adv_catalog:'어드벤티지 쇼핑 기본 카탈로그 광고',meta_adv_image:'어드벤티지 쇼핑 카탈로그 이미지 컬렉션 광고'};
const text=value=>typeof value==='string'||typeof value==='number'?String(value):null;
export function buildActualProductsSold({data,since,until}){
  if(!data||data.ok===false||data.error||data.source==='csv_required'||(data.requiresCsv||data.csvRequired)||!Array.isArray(data.orders))return {available:false,reason:'Cafe24 actual orders unavailable; Meta-attributed revenue is never substituted.',rows:[]};
  // Only explicit order-level fields used by the attribution reader establish coverage.
  // Empty/null fields mean exposed but unattributed, not missing payload capability.
  if(!data.orders.some(order=>order&&['inflow_path','ghost_mall_id'].some(key=>Object.hasOwn(order,key))))return {available:false,reason:'Cafe24 order payload does not expose inflow tracking fields; ad-level actual product attribution is unavailable.',rows:[]};
  const rows=[],seen=new Set();let missingItems=0,missingDates=0;
  for(const order of data.orders){
    const code=text(order.inflow_path)||text(order.ghost_mall_id),secondary=text(order.ghost_mall_id);
    if(!code?.startsWith('meta_')&&!secondary?.startsWith('meta_'))continue;
    const tracking=code?.startsWith('meta_')?code:secondary;
    const date=trustedCafe24OrderDate(order);if(!date){missingDates++;continue;}if(date<since||date>until||isCafe24CanceledOrRefunded(order))continue;
    const id=text(order.order_id)||text(order.orderId);if(id&&seen.has(id))continue;if(id)seen.add(id);
    const allItems=cafe24OrderItems(order);if(!allItems.length){missingItems++;continue;}const items=allItems.filter(i=>!isCafe24CanceledItem(i));if(!items.length)continue;
    const ambiguous=code?.startsWith('meta_')&&secondary?.startsWith('meta_')&&code!==secondary;
    const trusted=!!MAPPINGS[tracking]&&!ambiguous;
    const mapping=ambiguous?'TRACKING CONFLICT / AD MAPPING NOT TRUSTED':tracking==='meta_adv_video'?'LEGACY / TRACKING UNRELIABLE':MAPPINGS[tracking]||'UNMAPPED META TRACKING CODE';
    items.forEach((item,index)=>{
      const quantity=cafe24ItemQuantity(item);
      rows.push({order_id:id,order_date:date,inflow_path:tracking,ad_mapping:mapping,
        product_name:text(item.product_name)||text(item.name),product_no:text(item.product_no),
        product_code:text(item.variant_code)||text(item.sku)||text(item.product_code),option_size:text(item.option_value)||text(item.option_name)||text(item.option),quantity,
        product_amount:cafe24ItemAmount(item,quantity),actual_paid_amount:index===0?cafe24OrderAmount(order):null,
        order_status:text(order.order_status)||text(order.status)||text(item.status_text)||text(item.status_code),
        attribution_note:trusted?'Cafe24 actual via inflow_path; not Meta-attributed product':'Cafe24 actual; Tracking present but ad mapping not trusted; not Meta-attributed product'});
    });
  }
  return {available:true,rows,missingItems,missingDates,source:'cafe24_actual',possibleLimitReached:data.orders.length>=500};
}
