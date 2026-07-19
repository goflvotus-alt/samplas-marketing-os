import assert from "node:assert/strict";
import {
  analyzeServerOAuthRoutes,
  describeEnvValue,
  safeUrlParts
} from "../scripts/check-cafe24-oauth-readiness.mjs";

const serverFixture = `
if (url.pathname === "/api/cafe24/oauth/start") return redirect(res, buildCafe24AuthorizeUrl());
if (url.pathname === "/api/cafe24/oauth/callback") await handleCafe24OAuthCallback(url);
if (url.pathname === "/api/diagnostics/cafe24-oauth-config") return json(res, {});
if (url.pathname === "/api/diagnostics/cafe24-token-store") return json(res, {});
function buildCafe24AuthorizeUrl() { const state = randomUUID(); }
async function handleCafe24OAuthCallback(callbackUrl) {
  if (env.CAFE24_OAUTH_STATE && state !== env.CAFE24_OAUTH_STATE) throw new Error("mismatch");
}
async function writeCafe24TokenRecord(record) {
  await mkdir(cafe24TokenStoreDir, { recursive: true });
  await writeFile(tempFile, JSON.stringify(record), { mode: 0o600 });
  await rename(tempFile, cafe24TokenStoreFile);
}
`;

const routes = analyzeServerOAuthRoutes(serverFixture);
assert.equal(routes.oauthStartRoutePresent, true);
assert.equal(routes.callbackRoutePresent, true);
assert.equal(routes.oauthConfigDiagnosticPresent, true);
assert.equal(routes.tokenStoreDiagnosticPresent, true);
assert.equal(routes.authorizeFunctionPresent, true);
assert.equal(routes.callbackFunctionPresent, true);
assert.equal(routes.randomUuidStatePresent, true);
assert.equal(routes.callbackChecksStateMismatch, true);
assert.equal(routes.callbackAllowsMissingServerState, true);
assert.equal(routes.tokenWriteAtomicRenamePresent, true);
assert.equal(routes.tokenWriteMode0600Present, true);
assert.equal(routes.tokenStoreDirectoryCreatePresent, true);

assert.deepEqual(safeUrlParts("https://samplas.example.com/api/cafe24/oauth/callback"), {
  scheme: "https",
  host: "samplas.example.com",
  path: "/api/cafe24/oauth/callback",
  portPresent: false,
  trailingSlash: false
});

assert.equal(safeUrlParts("not a url").invalid, true);

assert.deepEqual(describeEnvValue("CAFE24_CLIENT_SECRET", " secret ", ".env"), {
  name: "CAFE24_CLIENT_SECRET",
  present: true,
  source: ".env",
  length: 8,
  empty: false,
  containsWhitespace: true,
  hasLeadingOrTrailingWhitespace: true,
  valueRedacted: true
});

assert.equal(describeEnvValue("CAFE24_MALL_ID", "scause", ".env").valueRedacted, false);

console.log("cafe24 oauth readiness tests passed");
