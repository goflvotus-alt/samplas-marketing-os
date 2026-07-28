import assert from "node:assert/strict";
import {
  isCafe24CanceledItem
} from "../scripts/cafe24-order-amount.mjs";

const cases = [
  {
    name: "C1 입금전취소는 제외",
    item: {
      status_code: "C1",
      status_text: "입금전취소"
    },
    expected: true
  },
  {
    name: "C2 취소신청은 제외",
    item: {
      status_code: "C2",
      status_text: "취소신청"
    },
    expected: true
  },
  {
    name: "C2 취소처리중은 제외",
    item: {
      status_code: "C2",
      status_text: "취소처리중"
    },
    expected: true
  },
  {
    name: "C2 취소완료는 제외",
    item: {
      status_code: "C2",
      status_text: "취소완료"
    },
    expected: true
  },
  {
    name: "C3 반품신청은 판매 유지",
    item: {
      status_code: "C3",
      status_text: "반품신청"
    },
    expected: false
  },
  {
    name: "C3 반품완료는 제외",
    item: {
      status_code: "C3",
      status_text: "반품완료"
    },
    expected: true
  },
  {
    name: "E1 교환신청은 판매 유지",
    item: {
      status_code: "E1",
      status_text: "교환신청"
    },
    expected: false
  },
  {
    name: "E1 교환완료는 판매 유지",
    item: {
      status_code: "E1",
      status_text: "교환완료"
    },
    expected: false
  },
  {
    name: "N1 배송완료는 판매 유지",
    item: {
      status_code: "N1",
      status_text: "배송완료"
    },
    expected: false
  },
  {
    name: "N2 정상 배송 품목은 판매 유지",
    item: {
      status_code: "N2",
      status_text: "배송중"
    },
    expected: false
  }
];

for (const testCase of cases) {
  assert.equal(
    isCafe24CanceledItem(testCase.item),
    testCase.expected,
    testCase.name
  );
}

console.log("cafe24 canceled item tests passed");
