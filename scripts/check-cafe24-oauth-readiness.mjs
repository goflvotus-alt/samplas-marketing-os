#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPathDefault = join(workDir, "cafe24-oauth-readiness-diagnostic.json");

const REQUIRED_ENV = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET"];
const OPTIONAL_ENV = ["CAFE24_REDIRECT_URI", "CAFE24_SCOPES", "CAFE24_TOKEN_STORE_DIR", "CAFE24_PROXY_BASE_URL", "CAFE24_ACCESS_TOKEN", "CAFE24_REFRESH_TOKEN"];
const SENSITIVE_NAME = /TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION/i;

function parseCliArgs(argv) {
  const options = { output: outputPathDefault, noWriteProbe: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-write-probe") options.noWriteProbe = true;
    else if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
  }
  return options;
}

async function loadEnvWithSources() {
  const envPath = join(rootDir, ".env");
  const values = { ...process.env };
  const sources = {};
  for (const key of Object.keys(process.env)) sources[key] = "process.env";
  if (!existsSync(envPath)) return { values, sources, envPathExists: false };
  const text = await readFile(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] !== undefined) continue;
    values[key] = value;
    sources[key] = ".env";
  }
  return { values, sources, envPathExists: true };
}

export function describeEnvValue(name, value, source = "missing") {
  const text = value === undefined || value === null ? "" : String(value);
  const trimmed = text.trim();
  return {
    name,
    present: value !== undefined && value !== null,
    source,
    length: text.length,
    empty: trimmed.length === 0,
    containsWhitespace: /\s/.test(text),
    hasLeadingOrTrailingWhitespace: text !== trimmed,
    valueRedacted: SENSITIVE_NAME.test(name)
  };
}

function tokenStoreDir(env) {
  return resolve(env.CAFE24_TOKEN_STORE_DIR || join(workDir, "secrets"));
}

function tokenStoreFile(env) {
  return join(tokenStoreDir(env), "cafe24-token-store.json");
}

export function safeUrlParts(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      scheme: url.protocol.replace(/:$/, ""),
      host: url.hostname,
      path: url.pathname,
      portPresent: Boolean(url.port),
      trailingSlash: url.pathname.endsWith("/") && url.pathname !== "/"
    };
  } catch {
    return { invalid: true };
  }
}

function redirectUri(env, host = "127.0.0.1", port = 8787) {
  return env.CAFE24_REDIRECT_URI || `http://${host}:${port}/api/cafe24/oauth/callback`;
}

export function analyzeServerOAuthRoutes(serverText) {
  return {
    oauthStartRoutePresent: serverText.includes('url.pathname === "/api/cafe24/oauth/start"'),
    callbackRoutePresent: serverText.includes('url.pathname === "/api/cafe24/oauth/callback"'),
    oauthConfigDiagnosticPresent: serverText.includes('url.pathname === "/api/diagnostics/cafe24-oauth-config"'),
    tokenStoreDiagnosticPresent: serverText.includes('url.pathname === "/api/diagnostics/cafe24-token-store"'),
    authorizeFunctionPresent: serverText.includes("function buildCafe24AuthorizeUrl()"),
    callbackFunctionPresent: serverText.includes("async function handleCafe24OAuthCallback"),
    randomUuidStatePresent: /const state = randomUUID\(\)/.test(serverText),
    callbackChecksStateMismatch: /state !== env\.CAFE24_OAUTH_STATE/.test(serverText),
    callbackAllowsMissingServerState: /if \(env\.CAFE24_OAUTH_STATE && state !== env\.CAFE24_OAUTH_STATE\)/.test(serverText),
    callbackRedirectsWithoutTokenDisplay: serverText.includes('redirect(res, "/?cafe24_oauth=success")'),
    tokenWriteAtomicRenamePresent: /writeFile\(tempFile[\s\S]*rename\(tempFile, cafe24TokenStoreFile\)/.test(serverText),
    tokenWriteMode0600Present: /mode:\s*0o600/.test(serverText),
    tokenStoreDirectoryCreatePresent: /mkdir\(cafe24TokenStoreDir,\s*\{\s*recursive:\s*true\s*\}\)/.test(serverText)
  };
}

async function gitCheckIgnore(path) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", ["check-ignore", "-v", path], { cwd: rootDir, encoding: "utf8" });
  return {
    ignored: result.status === 0,
    rule: result.status === 0 ? result.stdout.trim() : null
  };
}

async function gitTracked(path) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", ["ls-files", path], { cwd: rootDir, encoding: "utf8" });
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

async function probeAtomicWrite(dir, noWriteProbe = false) {
  if (noWriteProbe) return { skipped: true };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tempFile = join(dir, `.readiness.${process.pid}.tmp`);
  const finalFile = join(dir, `.readiness.${process.pid}.json`);
  try {
    await writeFile(tempFile, `${JSON.stringify({ readinessProbe: true, value: "redacted" })}\n`, { mode: 0o600 });
    await rename(tempFile, finalFile);
    const fileStat = await stat(finalFile);
    await rm(finalFile, { force: true });
    return {
      skipped: false,
      directoryReady: true,
      atomicRenameWorked: true,
      mode0600Requested: true,
      fileMode: `0${(fileStat.mode & 0o777).toString(8)}`
    };
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => {});
    await rm(finalFile, { force: true }).catch(() => {});
    return {
      skipped: false,
      directoryReady: false,
      atomicRenameWorked: false,
      error: error.message
    };
  }
}

function tokenStoreSchema() {
  return {
    schema: "number",
    status: "string",
    accessToken: "string",
    refreshToken: "string",
    expiresAt: "string|null",
    updatedAt: "string",
    lastRefreshAt: "string|null",
    reauthRequiredAt: "string|null",
    lastError: "string|null"
  };
}

function buildBlockingIssues(route, env, tokenStore, git, probe) {
  const issues = [];
  if (!route.oauthStartRoutePresent) issues.push("oauth_start_route_missing");
  if (!route.callbackRoutePresent) issues.push("oauth_callback_route_missing");
  for (const item of env.variables.filter((row) => REQUIRED_ENV.includes(row.name))) {
    if (!item.present || item.empty) issues.push(`env_missing:${item.name}`);
  }
  if (!route.tokenStoreDirectoryCreatePresent || !route.tokenWriteAtomicRenamePresent) issues.push("token_store_atomic_write_not_confirmed");
  if (!git.tokenStoreIgnored) issues.push("token_store_not_gitignored");
  if (git.tokenStoreTracked.length) issues.push("token_store_tracked_by_git");
  if (!probe.skipped && !probe.atomicRenameWorked) issues.push("token_store_write_probe_failed");
  return issues;
}

export async function buildCafe24OAuthReadiness(options = {}) {
  const { values: env, sources, envPathExists } = await loadEnvWithSources();
  const serverText = await readFile(join(rootDir, "server.mjs"), "utf8");
  const route = analyzeServerOAuthRoutes(serverText);
  const storeDir = tokenStoreDir(env);
  const storeFile = tokenStoreFile(env);
  const [tokenStoreIgnore, tokenStoreDirIgnore, tokenStoreTracked, tokenStoreDirTracked] = await Promise.all([
    gitCheckIgnore(storeFile),
    gitCheckIgnore(storeDir),
    gitTracked(storeFile),
    gitTracked(storeDir)
  ]);
  const writeProbe = await probeAtomicWrite(storeDir, options.noWriteProbe);
  const redirect = redirectUri(env);
  const environment = {
    envPathExists,
    variables: [...REQUIRED_ENV, ...OPTIONAL_ENV].map((name) => describeEnvValue(name, env[name], sources[name] || "missing"))
  };
  const tokenStore = {
    directoryKind: env.CAFE24_TOKEN_STORE_DIR ? "configured" : "work_dir_default",
    directoryReady: existsSync(storeDir),
    fileExists: existsSync(storeFile),
    schema: tokenStoreSchema(),
    gitIgnored: tokenStoreIgnore.ignored,
    gitIgnoreRule: tokenStoreIgnore.rule || tokenStoreDirIgnore.rule || null,
    tracked: tokenStoreTracked,
    parentTracked: tokenStoreDirTracked,
    atomicWriteProbe: writeProbe
  };
  const git = {
    tokenStoreIgnored: tokenStoreIgnore.ignored || tokenStoreDirIgnore.ignored,
    tokenStoreTracked,
    tokenStoreDirectoryTracked: tokenStoreDirTracked
  };
  const blockingIssues = buildBlockingIssues(route, environment, tokenStore, git, writeProbe);
  const stateSecurity = {
    stateGeneratedWithRandomUUID: route.randomUuidStatePresent,
    callbackChecksMismatch: route.callbackChecksStateMismatch,
    callbackAllowsMissingServerState: route.callbackAllowsMissingServerState,
    verdict: route.randomUuidStatePresent && route.callbackChecksStateMismatch
      ? route.callbackAllowsMissingServerState ? "works_for_same_process_flow_but_missing_state_is_not_rejected" : "strict_state_validation"
      : "state_validation_incomplete"
  };
  return {
    generatedAt: new Date().toISOString(),
    mode: "oauth_reauthentication_readiness",
    ready: blockingIssues.length === 0,
    oauthRoutes: route,
    oauthDataFlow: [
      "User Browser -> GET /api/cafe24/oauth/start",
      "buildCafe24AuthorizeUrl() -> Cafe24 authorization URL with random state",
      "Cafe24 authorization page -> configured redirect_uri",
      "GET /api/cafe24/oauth/callback -> handleCafe24OAuthCallback()",
      "authorization_code token exchange -> writeCafe24TokenRecord()",
      "persistent token store -> ensureCafe24AccessToken()",
      "Cafe24 Admin API GET"
    ],
    redirectUri: {
      source: env.CAFE24_REDIRECT_URI ? "CAFE24_REDIRECT_URI" : "fallback_host_port",
      parts: safeUrlParts(redirect),
      expectedPath: "/api/cafe24/oauth/callback"
    },
    stateSecurity,
    tokenStore,
    environment,
    postAuthVerification: {
      commands: [
        "node scripts/check-cafe24-oauth-readiness.mjs",
        "node scripts/recover-cafe24-api-access-and-probe.mjs --product-no=14600 --limit=5",
        "node scripts/probe-cafe24-product-identity-api.mjs --product-no=14600 --product-no=14595 --product-no=14599 --product-no=14598 --product-no=14597"
      ]
    },
    blockingIssues,
    recommendation: blockingIssues.length === 0
      ? { case: "A", nextStep: "Start server and open /api/cafe24/oauth/start manually, then run post-auth verification commands." }
      : { case: "readiness_blocked", nextStep: "Resolve blockingIssues before OAuth reauthentication." }
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildCafe24OAuthReadiness(options);
  await mkdir(resolve(options.output, ".."), { recursive: true }).catch(() => {});
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log("Cafe24 OAuth readiness");
  console.log(`- ready: ${result.ready}`);
  console.log(`- oauth start route: ${result.oauthRoutes.oauthStartRoutePresent}`);
  console.log(`- callback route: ${result.oauthRoutes.callbackRoutePresent}`);
  console.log(`- token store ignored: ${result.tokenStore.gitIgnored}`);
  console.log(`- token store atomic write: ${result.tokenStore.atomicWriteProbe.atomicRenameWorked || false}`);
  console.log(`- blocking issues: ${result.blockingIssues.length ? result.blockingIssues.join(", ") : "none"}`);
  console.log(`- output: ${options.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Cafe24 OAuth readiness failed: ${error.message}`);
    process.exitCode = 1;
  });
}
