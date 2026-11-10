// Minimal projection of the observed real 2026-11-08 order; no customer data or original order ID.
// Reuses the captured real financial fields; no report values are filled from this fixture.
import test from 'node:test';import assert from 'node:assert/strict';
import {buildRevenueEvidence} from '../scripts/meta-weekly-revenue.mjs';
import {cafe24OrderAmount} from '../scripts/cafe24-order-amount.mjs';
const order={order_id:'sha256:eaa38341fe9a',order_date:'2026-11-08',payment_date:'2026-11-08T04:02:14+09:00',paid:'T',canceled:'F',payment_method_name:'선불금',payment_amount:'0.00',actual_order_amount:{payment_amount:'0.00',order_price_amount:'628000.00',points_spent_amount:'0.00',credits_spent_amount:'0.00',membership_discount_amount:'0.00',coupon_discount_price:'0.00'},initial_order_amount:{payment_amount:'0.00',order_price_amount:'628000.00',points_spent_amount:'0.00',credits_spent_amount:'0.00',membership_discount_amount:'0.00',coupon_discount_price:'0.00'},items:[{order_status:'N40',quantity:1,product_price:'628000.00',cancel_date:null,refund_date:null}]};
test('real stored-value paid order must preserve the existing canonical 628000 won',()=>{
 const canonical=cafe24OrderAmount(order);assert.equal(canonical,628000);
 const actual=buildRevenueEvidence({since:'2026-11-03',until:'2026-11-09',paymentOrders:{orders:[order],dateType:'pay_date',coverage:{completeness:'COMPLETE',scope:{since:'2026-11-03',until:'2026-11-09'}}}});
 console.log(JSON.stringify({candidateStatus:actual.status,reasons:actual.reasons,canonicalSales:canonical,candidateOnlineSales:actual.onlineRevenue}));
 assert.equal(actual.onlineRevenue,canonical);
});
