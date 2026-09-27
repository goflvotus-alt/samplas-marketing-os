import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Source-extraction pattern already used across this repo's test suite
// (test/naver-ads-read-only.test.mjs, test/advertising-overview.test.mjs):
// the real function bodies are pulled out of server.mjs as text and executed
// in a vm context with injected fakes, so these tests exercise the actual
// production code rather than a hand-written reimplementation of it. File
// I/O uses a real temp directory (not a mocked fs) so read/write/rename
// semantics are genuinely exercised; only Meta's own network calls (fetch)
// are mocked — no real Meta API call is ever made.
const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
function section(start, end) {
  assert.ok(source.includes(start), `missing marker: ${start}`);
  assert.ok(source.includes(end), `missing marker: ${end}`);
  return source.slice(source.indexOf(start), source.indexOf(end));
}

const oauthAndStoreSource = section(
  "const META_OAUTH_SCOPES = [",
  "async function updateEnvFile(values) {"
);
const cleanAdAccountIdSource = section(
  "function cleanAdAccountId() {",
  "function missingEnv(keys) {"
);
const graphGetSource = section(
  "async function graphGet(path, params = {}) {",
  "async function graphGetRawUrl(fullUrl) {"
);
const safeErrorMessageSource = section(
  "function safeErrorMessage(error) {",
  "function apiErrorPayload(error) {"
);

let tempDir;
test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "meta-oauth-test-"));
});
test.after(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

function jsonResponse(body, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

// Mocks Meta's own endpoints by URL shape: code->token exchange, short->long-lived
// exchange, GET /me, the fixed INSTAGRAM_BUSINESS_ACCOUNT_ID, and the fixed
// META_AD_ACCOUNT_ID. Each of the 3 validation checks can be independently
// toggled to fail, matching the "hasn't one, don't save" requirement.
function makeFetchMock({ meOk = true, igOk = true, adOk = true } = {}) {
  return async (input) => {
    const u = new URL(input);
    if (u.hostname === "graph.facebook.com" && u.pathname.endsWith("/oauth/access_token")) {
      if (u.searchParams.get("grant_type") === "fb_exchange_token") {
        return jsonResponse({ access_token: "LONG_LIVED_TOKEN", expires_in: 5184000 });
      }
      return jsonResponse({ access_token: "SHORT_LIVED_TOKEN", expires_in: 3600 });
    }
    if (u.pathname === "/v25.0/me") {
      return meOk ? jsonResponse({ id: "USER123", name: "Test User" }) : jsonResponse({ error: { message: "invalid token" } }, false);
    }
    if (u.pathname.endsWith("/ig123")) {
      return igOk ? jsonResponse({ id: "ig123", username: "samplaskr" }) : jsonResponse({ error: { message: "ig error" } }, false);
    }
    if (u.pathname.endsWith("/act_ad123")) {
      return adOk ? jsonResponse({ id: "act_ad123", name: "Ad Account", account_status: 1 }) : jsonResponse({ error: { message: "ad error" } }, false);
    }
    throw new Error(`Unexpected fetch in test: ${input}`);
  };
}

function freshContext({ env = {}, fetchImpl } = {}) {
  const mergedEnv = {
    META_APP_ID: "appid123",
    META_APP_SECRET: "secret123",
    INSTAGRAM_BUSINESS_ACCOUNT_ID: "ig123",
    META_AD_ACCOUNT_ID: "act_ad123",
    ...env
  };
  const context = {
    env: mergedEnv,
    join,
    mkdir,
    readFile,
    writeFile,
    rename,
    randomUUID,
    fetch: fetchImpl,
    URL,
    process,
    graphVersion: "v25.0",
    host: "127.0.0.1",
    port: 8787,
    metaAccessTokenEnvFallback: mergedEnv.META_ACCESS_TOKEN || "",
    metaStoredAccessTokenCache: "",
    metaTokenStoreDir: tempDir,
    metaTokenStoreFile: join(tempDir, `meta-token-store-${randomUUID()}.json`)
  };
  runInNewContext(oauthAndStoreSource + "\n" + cleanAdAccountIdSource, context);
  return context;
}

test("1. stored token takes priority over env fallback", async () => {
  const ctx = freshContext({ env: { META_ACCESS_TOKEN: "ENV_TOKEN" } });
  await ctx.writeMetaTokenRecord({ accessToken: "STORED_TOKEN" });
  assert.equal(await ctx.resolveMetaAccessToken(), "STORED_TOKEN");
});

test("2. no stored token falls back to env.META_ACCESS_TOKEN", async () => {
  const ctx = freshContext({ env: { META_ACCESS_TOKEN: "ENV_TOKEN" } });
  assert.equal(await ctx.resolveMetaAccessToken(), "ENV_TOKEN");
});

test("3. OAuth start creates a state and a correct authorize URL (minimal scope, no secrets)", () => {
  const ctx = freshContext();
  const url = new URL(ctx.buildMetaAuthorizeUrl());
  assert.equal(url.origin + url.pathname, "https://www.facebook.com/v25.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "appid123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8787/api/meta/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.has("client_secret"), false);
  const scopes = url.searchParams.get("scope").split(",");
  for (const required of ["pages_show_list", "pages_read_engagement", "ads_read", "business_management", "instagram_basic", "instagram_manage_insights"]) {
    assert.ok(scopes.includes(required), `missing scope: ${required}`);
  }
  const state = url.searchParams.get("state");
  assert.ok(state);
  // metaOAuthStates is a lexically-scoped const inside the sliced script (not exposed
  // on the context object), so we prove it was actually recorded by consuming it via
  // the same exposed consumeMetaOAuthState() the real callback route uses.
  assert.equal(ctx.consumeMetaOAuthState(state), true);
});

test("4. invalid/unknown state is rejected", async () => {
  const ctx = freshContext();
  await assert.rejects(
    () => ctx.handleMetaOAuthCallback(new URL("http://localhost/x?code=abc&state=not-a-real-state")),
    /state/i
  );
});

test("5. expired state is rejected, and a consumed state cannot be reused", async () => {
  // metaOAuthStates is a lexically-scoped const inside the sliced script, so expiry
  // can't be forced by poking the map from outside — instead we fake Date.now() to be
  // 11 minutes in the past while the state is created (10-minute TTL), then restore it
  // before the callback checks expiry, exactly reproducing a state that aged out.
  const ctx = freshContext();
  let fakeNow = Date.now() - 11 * 60 * 1000;
  ctx.Date = class extends Date {
    static now() { return fakeNow; }
  };
  const expiredState = ctx.createMetaOAuthState();
  fakeNow = Date.now();
  await assert.rejects(
    () => ctx.handleMetaOAuthCallback(new URL(`http://localhost/x?code=abc&state=${expiredState}`)),
    /state/i
  );

  const ctx2 = freshContext({ fetchImpl: makeFetchMock() });
  const state = ctx2.createMetaOAuthState();
  await ctx2.handleMetaOAuthCallback(new URL(`http://localhost/x?code=abc&state=${state}`));
  await assert.rejects(
    () => ctx2.handleMetaOAuthCallback(new URL(`http://localhost/x?code=abc2&state=${state}`)),
    /state/i
  );
});

test("6. callback success validates GET /me + Instagram + Ad account, then saves the long-lived token", async () => {
  const ctx = freshContext({ fetchImpl: makeFetchMock() });
  const state = ctx.createMetaOAuthState();
  const result = await ctx.handleMetaOAuthCallback(new URL(`http://localhost/x?code=abc&state=${state}`));
  assert.equal(result.ok, true);
  const stored = JSON.parse(await readFile(ctx.metaTokenStoreFile, "utf8"));
  assert.equal(stored.accessToken, "LONG_LIVED_TOKEN");
  assert.equal(stored.metaUserId, "USER123");
  assert.equal(stored.instagramBusinessAccountId, "ig123");
  assert.equal(stored.adAccountId, "act_ad123");
  assert.ok(stored.validatedAt);
});

test("7. Instagram validation failure preserves the existing stored token", async () => {
  const ctx = freshContext({ fetchImpl: makeFetchMock() });
  await ctx.writeMetaTokenRecord({ accessToken: "OLD_TOKEN" });
  ctx.fetch = makeFetchMock({ igOk: false });
  const state = ctx.createMetaOAuthState();
  await assert.rejects(
    () => ctx.handleMetaOAuthCallback(new URL(`http://localhost/x?code=abc&state=${state}`)),
    /검증에 실패/
  );
  const stored = JSON.parse(await readFile(ctx.metaTokenStoreFile, "utf8"));
  assert.equal(stored.accessToken, "OLD_TOKEN");
});

test("8. Ad account validation failure preserves the existing stored token", async () => {
  const ctx = freshContext({ fetchImpl: makeFetchMock() });
  await ctx.writeMetaTokenRecord({ accessToken: "OLD_TOKEN" });
  ctx.fetch = makeFetchMock({ adOk: false });
  const state = ctx.createMetaOAuthState();
  await assert.rejects(
    () => ctx.handleMetaOAuthCallback(new URL(`http://localhost/x?code=abc&state=${state}`)),
    /검증에 실패/
  );
  const stored = JSON.parse(await readFile(ctx.metaTokenStoreFile, "utf8"));
  assert.equal(stored.accessToken, "OLD_TOKEN");
});

test("9. token and app secret never leak into diagnostics output or error messages", async () => {
  const ctx = freshContext();
  await ctx.writeMetaTokenRecord({ accessToken: "SUPER_SECRET_TOKEN" });
  const diag = await ctx.metaTokenDiagnostics();
  assert.equal(diag.hasAccessToken, true);
  assert.equal(JSON.stringify(diag).includes("SUPER_SECRET_TOKEN"), false);

  const redactionContext = {
    env: {
      META_APP_SECRET: "APP_SECRET_XYZ",
      CAFE24_ACCESS_TOKEN: "",
      CAFE24_REFRESH_TOKEN: "",
      CAFE24_CLIENT_SECRET: "",
      CAFE24_PROXY_BASIC_AUTH: "",
      CAFE24_PROXY_SECRET: ""
    },
    metaStoredAccessTokenCache: "STORED_SECRET_TOKEN"
  };
  runInNewContext(safeErrorMessageSource, redactionContext);
  const message = redactionContext.safeErrorMessage(
    new Error("failed with token STORED_SECRET_TOKEN and secret APP_SECRET_XYZ")
  );
  assert.equal(message.includes("STORED_SECRET_TOKEN"), false);
  assert.equal(message.includes("APP_SECRET_XYZ"), false);
});

test("10. graphGet uses the stored token, not the env fallback", async () => {
  const ctx = freshContext({ env: { META_ACCESS_TOKEN: "ENV_TOKEN" } });
  await ctx.writeMetaTokenRecord({ accessToken: "STORED_TOKEN_FOR_GRAPH" });
  let capturedUrl = null;
  ctx.fetch = async (url) => {
    capturedUrl = String(url);
    return jsonResponse({ id: "1" });
  };
  runInNewContext(graphGetSource, ctx);
  await ctx.graphGet("me", { fields: "id" });
  assert.equal(new URL(capturedUrl).searchParams.get("access_token"), "STORED_TOKEN_FOR_GRAPH");
});

test("11. the 3 Meta OAuth routes are registered on the production dispatcher", () => {
  assert.match(source, /if \(url\.pathname === "\/api\/meta\/oauth\/start"\)/);
  assert.match(source, /if \(url\.pathname === "\/api\/meta\/oauth\/callback"\)/);
  assert.match(source, /if \(url\.pathname === "\/api\/diagnostics\/meta-token-store"\)/);
});

// Regression: a token-store file that exists but contains invalid JSON must degrade to
// "no stored token" (env fallback), never throw. Before the fix, readMetaTokenRecord()
// only treated ENOENT as "no record" and rethrew the JSON.parse SyntaxError, which meant
// a corrupted meta-token-store.json broke resolveMetaAccessToken() (and therefore every
// Instagram/Meta Ads Graph call) and metaConnectionStatus() (used by /api/status, Render's
// own healthCheckPath) even though a perfectly valid env.META_ACCESS_TOKEN fallback existed.
test("13. malformed token-store JSON falls back to env.META_ACCESS_TOKEN instead of throwing", async () => {
  const ctx = freshContext({ env: { META_ACCESS_TOKEN: "VALID_ENV_FALLBACK_TOKEN" } });
  await writeFile(ctx.metaTokenStoreFile, "{broken-json", "utf8");
  const token = await ctx.resolveMetaAccessToken();
  assert.equal(token, "VALID_ENV_FALLBACK_TOKEN");
});

test("14. malformed token-store JSON doesn't break metaConnectionStatus()/diagnostics or leak raw content", async () => {
  const ctx = freshContext({ env: { META_ACCESS_TOKEN: "VALID_ENV_FALLBACK_TOKEN" } });
  await writeFile(ctx.metaTokenStoreFile, "{broken-json", "utf8");

  const status = await ctx.metaConnectionStatus();
  assert.equal(status.status, "connected");
  assert.equal(status.source, "env_fallback");
  assert.equal(status.hasStoredConnection, false);

  const diag = await ctx.metaTokenDiagnostics();
  assert.equal(diag.hasAccessToken, false);
  assert.equal(JSON.stringify(diag).includes("broken-json"), false);
});
