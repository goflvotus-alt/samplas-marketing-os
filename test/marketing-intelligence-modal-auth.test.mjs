import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../outputs/marketing-intelligence-entry.js',import.meta.url),'utf8');

test('two drilldown APIs require authenticated operator or trusted internal access',()=>{
 const traffic=server.match(/if \(url\.pathname === "\/api\/marketing-intelligence\/traffic"\) \{([\s\S]{0,600})/);
 const trace=server.match(/if \(url\.pathname === "\/api\/crm\/order-trace"\) \{([\s\S]{0,650})/);
 assert.ok(traffic);
 assert.ok(trace);
 const requireAuth=s=>/isLocalRequest\(req\)/.test(s)&&/isAuthorizedInternalRequest\(req\)/.test(s)&&/hasOperatorSession\(req\)/.test(s)&&/isAuthorizedOperatorRequest\(req\)/.test(s)&&/401/.test(s);
 assert.equal(requireAuth(traffic[1]),true);
 assert.equal(requireAuth(trace[1]),true);
});

test('operator cookies are checked against active server-issued sessions',()=>{
 assert.match(server,/function hasOperatorSession\(req\)[\s\S]{0,300}operatorSessions\.has\(cookies\.samplas_operator\)/);
 assert.match(server,/samplas_operator=\$\{token\}; HttpOnly; SameSite=Strict/);
});

test('MI uses Clients-style accessible centered modal for order and purchase details',()=>{
 assert.match(ui,/#miInspect:not\(:empty\)/);
 assert.match(ui,/position:fixed;inset:0;z-index:2200/);
 assert.match(ui,/mi-order-card/);
 assert.match(ui,/data-mi-trace-close/);
 assert.match(ui,/data-mi-close/);
 assert.match(ui,/Escape/);
 assert.match(ui,/function closeMiInspector/);
 assert.match(ui,/구매 상품·수량/);
 assert.match(ui,/주문 기록 유입/);
 assert.match(ui,/구매한 상품과 주문별 근거 확인/);
});

test('missing source or unauthorized trace is explicitly disclosed, never made zero',()=>{
 assert.match(ui,/운영자 세션 확인이 필요해/);
 assert.match(ui,/data-mi-trace-retry/);
 assert.match(ui,/상품 원본 미수집/);
 assert.match(ui,/상품 원천 상태/);
 assert.doesNotMatch(ui,/window\.open\(/);
});
