import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Same source-extraction pattern as test/meta-oauth-reconnect.test.mjs, applied to the
// frontend file: the real apiHealthActionCards()/handleMetaOAuthRedirect() bodies are
// pulled from outputs/samplas-marketing-os.js and run in a vm context with injected
// DOM/window fakes (no jsdom in this repo, matching existing tests like
// test/brand-intelligence-sku-sales-stock-drilldown.test.mjs).
const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
function section(start, end) {
  assert.ok(source.includes(start), `missing marker: ${start}`);
  assert.ok(source.includes(end), `missing marker: ${end}`);
  return source.slice(source.indexOf(start), source.indexOf(end));
}

const actionCardsSource = section(
  "function apiHealthActionCards(metaConnection = null) {",
  "async function renderAdvertising("
);
const redirectSource = section(
  "function handleMetaOAuthRedirect() {",
  "function productRegistryDiagnosticTypes(item) {"
);

test("Master Data action panel shows 'Meta 연결' + oauth/start link when nothing is connected yet", () => {
  const ctx = {
    esc: (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    apiHealthRefreshInFlight: false
  };
  runInNewContext(actionCardsSource, ctx);
  const html = ctx.apiHealthActionCards(null);
  assert.match(html, />Meta 연결</);
  assert.doesNotMatch(html, /Meta 재연결/);
  assert.match(html, /href="\/api\/meta\/oauth\/start"/);
});

test("Master Data action panel shows 'Meta 재연결' once a stored connection exists", () => {
  const ctx = {
    esc: (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    apiHealthRefreshInFlight: false
  };
  runInNewContext(actionCardsSource, ctx);
  const html = ctx.apiHealthActionCards({ hasStoredConnection: true, status: "connected" });
  assert.match(html, />Meta 재연결</);
  assert.match(html, /href="\/api\/meta\/oauth\/start"/);
});

test("12a. OAuth callback success redirect shows 'Meta 연결 완료' and clears the query but keeps #master-data", () => {
  let toasted = null;
  let replacedTo = null;
  const ctx = {
    toast: (msg) => { toasted = msg; },
    window: {
      location: { search: "?meta_oauth=success", pathname: "/", hash: "#master-data" },
      history: { replaceState: (_state, _title, url) => { replacedTo = url; } }
    },
    URLSearchParams
  };
  runInNewContext(redirectSource, ctx);
  ctx.handleMetaOAuthRedirect();
  assert.equal(toasted, "Meta 연결 완료");
  assert.equal(replacedTo, "/#master-data");
});

test("12b. OAuth callback error redirect shows only a generic 'Meta 연결 실패' message, never raw error text", () => {
  let toasted = null;
  const ctx = {
    toast: (msg) => { toasted = msg; },
    window: {
      location: { search: "?meta_oauth=error&reason=should_never_be_read", pathname: "/", hash: "#master-data" },
      history: { replaceState: () => {} }
    },
    URLSearchParams
  };
  runInNewContext(redirectSource, ctx);
  ctx.handleMetaOAuthRedirect();
  assert.equal(toasted, "Meta 연결 실패");
});

test("no meta_oauth query param means the redirect handler does nothing", () => {
  let toasted = null;
  const ctx = {
    toast: (msg) => { toasted = msg; },
    window: {
      location: { search: "", pathname: "/", hash: "#master-data" },
      history: { replaceState: () => { throw new Error("should not be called"); } }
    },
    URLSearchParams
  };
  runInNewContext(redirectSource, ctx);
  assert.doesNotThrow(() => ctx.handleMetaOAuthRedirect());
  assert.equal(toasted, null);
});
