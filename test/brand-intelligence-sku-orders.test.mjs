import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cafe24ItemAmount,
  cafe24ItemQuantity,
  cafe24OrderItems,
  isCafe24CanceledItem,
  isCafe24CanceledOrRefunded,
  trustedCafe24OrderDate
} from "../scripts/cafe24-order-amount.mjs";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const browser = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

test("productNo 11753 uses canonical active-item rules and yields two real 605,000원 orders", () => {
  const buildRows = Function(
    "cafe24ItemAmount", "cafe24ItemQuantity", "cafe24OrderItems", "isCafe24CanceledItem", "isCafe24CanceledOrRefunded", "trustedCafe24OrderDate",
    `${sourceOfFunction(server, "buildCafe24SkuOrderRows")}; return buildCafe24SkuOrderRows;`
  )(cafe24ItemAmount, cafe24ItemQuantity, cafe24OrderItems, isCafe24CanceledItem, isCafe24CanceledOrRefunded, trustedCafe24OrderDate);
  const item = (statusText) => ({ product_no: 11753, product_code: "P0000RKB", product_name: "ZIP BELT EGG CLUSTER SLEEVE KNIT BLOUSE IVORY", quantity: 1, product_price: "605000.00", status_code: "N1", status_text: statusText });
  const rows = buildRows([
    { order_id: "20260812-0000114", order_date: "2026-08-12T22:43:17+09:00", billing_name: "서민우", items: [item("배송중")] },
    { order_id: "20260813-0000047", order_date: "2026-08-13T18:18:19+09:00", billing_name: "변지연", items: [item("배송준비중")] },
    { order_id: "CANCELED", order_date: "2026-08-14", canceled: true, items: [item("취소완료")] },
    { order_id: "OTHER", order_date: "2026-08-14", items: [{ ...item("배송중"), product_no: 99999 }] }
  ]);
  const selected = rows.filter((row) => row.productNo === "11753");
  assert.equal(selected.length, 2);
  assert.equal(selected.reduce((sum, row) => sum + row.quantity, 0), 2);
  assert.equal(selected.reduce((sum, row) => sum + row.amount, 0), 1210000);
  assert.deepEqual(selected.map((row) => row.id), ["20260812-0000114", "20260813-0000047"]);
});

test("Brand Intelligence filters only exact productNo and preserves NULL != ZERO plus stale guards", () => {
  const refreshSource = sourceOfFunction(browser, "refreshEntityOrdersForSku");
  assert.match(refreshSource, /String\(row\?\.productNo \|\| ""\) === String\(productNo \|\| ""\)/);
  assert.doesNotMatch(refreshSource, /productName|includes\(productNo|normalize/);
  assert.match(refreshSource, /seq !== entityOrderRefreshSeq/);
  assert.match(refreshSource, /brandIdentityState\.brandCode !== brandCode/);
  assert.match(refreshSource, /currentEntityPeriodMonthKey\(\) !== periodMonth/);
  const orderConfig = browser.slice(browser.indexOf("order: {"), browser.indexOf("clientOrders: {"));
  assert.match(orderConfig, /주문 데이터를 불러오지 못했습니다/);
  assert.match(orderConfig, /이번 기간 해당 SKU 주문이 없습니다/);
  assert.match(browser, /function activateEntityDrawerRow\(row\)[\s\S]*?void refreshEntityOrdersForSku\(nextContext\.productNo\)/);
});
