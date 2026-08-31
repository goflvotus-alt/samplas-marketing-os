import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAuthorizedOperatorRequest } from "../server.mjs";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const importer = await readFile(new URL("../scripts/import-ecount-offline-sales.mjs", import.meta.url), "utf8");
const root = fileURLToPath(new URL("..", import.meta.url));
let nextPort = 18940;

function basic(value) {
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

function httpCall(port, path, { headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { Host: "production.example", ...headers } }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function withServer(overrides, run) {
  const port = nextPort++;
  const childEnv = { ...process.env, HOST: "127.0.0.1", PORT: String(port), ...overrides };
  if (overrides.SAMPLAS_OPERATOR_BASIC_AUTH === undefined) delete childEnv.SAMPLAS_OPERATOR_BASIC_AUTH;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("test server start timeout")), 10_000);
      child.stdout.on("data", (chunk) => {
        if (!String(chunk).includes("SAMPLAS Marketing OS running")) return;
        clearTimeout(timeout);
        resolve();
      });
      child.once("exit", (code) => reject(new Error(`test server exited: ${code}`)));
    });
    await run(port);
  } finally {
    child.kill("SIGTERM");
  }
}

test("Production ECOUNT import requires an operator session or existing internal authorization", () => {
  assert.match(server, /if \(!isAuthorizedEcountImport\(req\)\)/);
  assert.match(server, /samplas_operator=.*HttpOnly; SameSite=Strict/);
  assert.match(server, /new URL\(origin\)\.host/);
});

test("operator credentials are entered at runtime and no secret is embedded in frontend source", () => {
  assert.match(frontend, /authorizeEcountProductionUpload/);
  assert.match(frontend, /Production 업로드 권한을 확인할 수 없습니다/);
  assert.doesNotMatch(frontend, /CAFE24_PROXY_SECRET|CAFE24_PROXY_BASIC_AUTH|x-samplas-internal-token/);
});

test("operator Basic credentials reject missing, empty, malformed, and mismatched values", () => {
  const req = { headers: { authorization: basic("operator:correct") } };
  for (const credentials of [undefined, "", "operator", ":password", "operator:", "operator:wrong"]) {
    assert.equal(isAuthorizedOperatorRequest(req, credentials), false, String(credentials));
  }
  assert.equal(isAuthorizedOperatorRequest(req, "operator:correct"), true);
});

test("operator session and ECOUNT import use the dedicated credential over real HTTP", async () => {
  await withServer({ SAMPLAS_OPERATOR_BASIC_AUTH: "operator:correct" }, async (port) => {
    const valid = await httpCall(port, "/api/operator/session", { headers: { Authorization: basic("operator:correct") } });
    assert.equal(valid.status, 200);
    const cookie = valid.headers["set-cookie"]?.[0];
    assert.match(cookie, /^samplas_operator=.*HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure$/);

    const invalid = await httpCall(port, "/api/operator/session", { headers: { Authorization: basic("operator:wrong") } });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.headers["set-cookie"], undefined);

    const unauthenticatedImport = await httpCall(port, "/api/ecount-sales/import", { headers: { Origin: "https://production.example" } });
    assert.equal(unauthenticatedImport.status, 401);
    const authenticatedImport = await httpCall(port, "/api/ecount-sales/import", { headers: { Origin: "https://production.example", Cookie: cookie } });
    assert.notEqual(authenticatedImport.status, 401);
  });
});

test("Cafe24 proxy credentials never authorize an operator session but retain internal auth", async () => {
  await withServer({
    SAMPLAS_OPERATOR_BASIC_AUTH: undefined,
    CAFE24_PROXY_BASIC_AUTH: "proxy:correct",
    CAFE24_PROXY_SECRET: " "
  }, async (port) => {
    const basicOnly = await httpCall(port, "/api/operator/session", { headers: { Authorization: basic("proxy:correct") } });
    assert.equal(basicOnly.status, 401);
    const missing = await httpCall(port, "/api/operator/session");
    assert.equal(missing.status, 401);
    const existingInternal = await httpCall(port, "/api/cafe24/csv/import", { headers: { Authorization: basic("proxy:correct") } });
    assert.notEqual(existingInternal.status, 401);
  });
  await withServer({
    SAMPLAS_OPERATOR_BASIC_AUTH: undefined,
    CAFE24_PROXY_BASIC_AUTH: " ",
    CAFE24_PROXY_SECRET: "proxy-secret"
  }, async (port) => {
    const secretOnly = await httpCall(port, "/api/operator/session", { headers: { "x-samplas-internal-token": "proxy-secret" } });
    assert.equal(secretOnly.status, 401);
    const existingInternal = await httpCall(port, "/api/cafe24/csv/import", { headers: { "x-samplas-internal-token": "proxy-secret" } });
    assert.notEqual(existingInternal.status, 401);
  });
});

test("Production upload always parses the workbook and rejects filename/content month mismatch before write", () => {
  assert.match(server, /force: true/);
  assert.match(importer, /options\.expectedMonth && month !== options\.expectedMonth/);
  assert.match(importer, /buildWarehouseRoutedSnapshots\(loaded, month, filePath\)/);
  assert.match(importer, /writeJsonSetAtomic\(entries, options\.atomicFs\)/);
});

test("upload UI describes direct current-environment application, not Local-only sync", () => {
  const region = frontend.slice(frontend.indexOf("function ecountWizardModalNode"), frontend.indexOf("function ecountWizardMonthFromFileName"));
  assert.match(region, /현재 운영 환경에 즉시 반영됩니다/);
  assert.doesNotMatch(region, /로컬 Marketing OS|Render 운영 배포는 별도/);
});
