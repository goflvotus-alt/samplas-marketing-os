// scripts/cafe24-order-amount.mjs
// STEP19-C(2026-07-27): server.mjs와 intelligence-service.mjs가 동일한 Cafe24 주문
// 금액/취소판정 로직을 공유하기 위한 독립 모듈. server.mjs가 intelligence-service.mjs를
// import하고(순환 참조 위험) intelligence-service.mjs는 server.mjs를 import할 수 없으므로,
// 제3의 공통 모듈로 분리했다.
//
// 이 파일의 모든 함수는 server.mjs에 있던 기존 함수를 "그대로" 옮긴 것이며,
// 로직/우선순위/필드 순서를 전혀 바꾸지 않았다(server.mjs의 cafe24OrderAmount 등은
// 커밋 4e3d7fe "feat: apply canonical paid sales across commerce"에서 이미 확정된 정책).
// 즉 Today(server.mjs)가 계산하던 금액과 Clients(intelligence-service.mjs)가 이제부터
// 계산할 금액은 항상 같은 함수를 호출한 결과이므로 값이 갈릴 수 없다.

export function parseCafe24Money(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function firstCafe24Money(values = []) {
  for (const value of values) {
    const parsed = parseCafe24Money(value);
    if (parsed !== null) return parsed;
  }
  return 0;
}

export function firstCafe24MoneyOrNull(values = []) {
  for (const value of values) {
    const parsed = parseCafe24Money(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function firstPositiveCafe24Money(values = []) {
  for (const value of values) {
    const parsed = parseCafe24Money(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return 0;
}

export function normalizeCafe24PaymentMethod(order = {}) {
  const raw = order.payment_method_name || order.payment_method || order.payment_methods?.[0]?.payment_method || "미확인";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((value) => String(value || "").trim()).filter(Boolean).join(" + ") || "미확인";
}

export function isCafe24StoredValuePayment(order = {}) {
  const paymentText = normalizeCafe24PaymentMethod(order).replace(/\s+/g, "").toLowerCase();
  return paymentText.includes("선불금") || paymentText.includes("적립금") || paymentText.includes("prepaid") || paymentText.includes("point");
}

export function isCafe24CanceledItem(item = {}) {
  const status = String(item.status_code || item.status || "").trim().toUpperCase();
  const text = String(item.status_text || item.statusText || item.order_status || "").trim().toLowerCase();
  const isCompletedReturn = status === "C3" && text.includes("반품완료");

  return (
    status === "C1" ||
    status === "C2" ||
    status === "CANCEL" ||
    text.includes("취소완료") ||
    text.includes("cancel") ||
    isCompletedReturn
  );
}

export function cafe24OrderItems(order = {}) {
  const candidates = [order.items, order.order_items, order.products, order.order_item];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function cafe24ItemQuantity(item = {}) {
  const quantity = Number(item.quantity || item.qty || item.product_quantity || item.order_quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function cafe24ItemAmount(item = {}, quantity = 1) {
  const amount = firstCafe24Money([
    item.actual_payment_amount,
    item.order_price_amount,
    item.product_price,
    item.price,
    item.sale_price,
    item.supply_price
  ]);
  return amount * quantity;
}

export function hasCafe24ActiveOrderItems(order = {}) {
  return cafe24OrderItems(order).some((item) => !isCafe24CanceledItem(item) && cafe24ItemQuantity(item) > 0);
}

export function isCafe24CanceledOrRefunded(order = {}) {
  const flags = [
    order.canceled,
    order.cancelled,
    order.refunded,
    order.returned,
    order.cancel_status,
    order.return_status,
    order.refund_status
  ].map((value) => String(value || "").toLowerCase());
  if (flags.some((value) => ["t", "true", "y", "yes", "cancel", "canceled", "cancelled", "refund", "refunded", "return", "returned"].includes(value))) return true;
  return Boolean(order.cancel_date || order.return_confirmed_date || order.refund_date);
}

export function cafe24ShippingFee(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  return Math.max(0, firstCafe24Money([
    order.actual_order_amount?.shipping_fee,
    order.actual_order_amount?.shipping_fee_amount,
    order.actual_order_amount?.ship_fee,
    order.shipping_fee,
    order.shipping_fee_amount,
    order.total_shipping_fee,
    order.actual_shipping_fee,
    order.delivery_fee
  ]));
}

export function cafe24GrossOrderAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  return firstCafe24Money([
    order.actual_order_amount?.order_price_amount,
    order.order_price_amount,
    order.initial_order_amount?.order_price_amount,
    order.initial_order_amount?.payment_amount,
    order.payment_amount
  ]);
}

export function cafe24InitialOrderAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  return firstCafe24Money([
    order.initial_order_amount?.order_price_amount,
    order.initial_order_amount?.payment_amount,
    order.order_price_amount,
    order.payment_amount
  ]);
}

export function cafe24OrderAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  const primary = firstCafe24MoneyOrNull([
    order.actual_order_amount?.payment_amount,
    order.actual_payment_amount,
    order.payment_amount
  ]);
  if (primary > 0) return primary;
  if (primary === 0 && isCafe24StoredValuePayment(order)) {
    const restored = firstPositiveCafe24Money([
      order.actual_order_amount?.order_price_amount,
      order.order_price_amount,
      order.initial_order_amount?.order_price_amount,
      order.initial_order_amount?.payment_amount,
      order.order_amount,
      order.total_price
    ]);
    if (restored > 0 && hasCafe24ActiveOrderItems(order)) return restored;
  }
  if (primary === 0) return 0;
  return firstCafe24Money([
    order.actual_order_amount?.order_price_amount,
    order.order_price_amount,
    order.initial_order_amount?.payment_amount,
    order.initial_order_amount?.order_price_amount,
    order.order_amount,
    order.total_price
  ]);
}

// STEP19-C 정책1(적립금 사용액은 매출에서 차감하지 않는다)의 "정보용 부가 필드"를
// 위해 추가. cafe24OrderAmount() 자체는 절대 바꾸지 않고(=Today 금액 불변), 실제
// Cafe24 원본 필드(actual_order_amount.points_spent_amount / credits_spent_amount)가
// 존재하는 주문(현재월 live proxy 캐시)에서만 값을 추출한다. 과거월 CSV 캐시는 이
// 필드 자체가 없으므로(원본 CSV 8개 컬럼에 없음) null을 반환한다 — 없는 값을
// 추측하거나 0으로 기본값 처리하지 않는다.
export function cafe24PointsUsedAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  const value = firstCafe24MoneyOrNull([
    order.actual_order_amount?.points_spent_amount,
    order.actual_order_amount?.credits_spent_amount,
    order.points_spent_amount,
    order.credits_spent_amount
  ]);
  return value;
}

export function trustedCafe24OrderDate(order = {}) {
  const candidates = [
    order.order_date,
    order.orderDate,
    order.ordered_date,
    order.order_timestamp,
    order.payment_date,
    order.paid_date,
    order.created_date
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text) && Number.isFinite(new Date(text).getTime())) return text.slice(0, 10);
  }
  return null;
}
