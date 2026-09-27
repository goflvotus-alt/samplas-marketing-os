import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  isDropboxConfigured,
  resolveWeeklyReportDestination,
  dropboxWeeklyReportDir,
  dropboxTargetPath,
  asciiSafeJson,
  getDropboxAccessToken,
  dropboxFileExists,
  dropboxUploadFile,
  saveWeeklyReportToDropbox
} from "../scripts/dropbox-report-uploader.mjs";

const FAKE_ENV = {
  DROPBOX_APP_KEY: "fake-app-key",
  DROPBOX_APP_SECRET: "FAKE_APP_SECRET_VALUE",
  DROPBOX_REFRESH_TOKEN: "FAKE_REFRESH_TOKEN_VALUE"
};

function jsonResponse(body, ok = true, status = ok ? 200 : 400) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

// Dispatches by URL so a single mock covers the whole token->exists->upload chain.
function makeFetchMock({ tokenOk = true, existsResult = "not_found", existsSize = 12345, uploadOk = true, uploadSizeOverride } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2/token")) {
      return tokenOk
        ? jsonResponse({ access_token: "FAKE_ACCESS_TOKEN_VALUE", token_type: "bearer", expires_in: 14400 })
        : jsonResponse({ error: "invalid_grant", error_description: "refresh token revoked" }, false, 401);
    }
    if (String(url).includes("files/get_metadata")) {
      if (existsResult === "exists") return jsonResponse({ name: "x.xlsx", size: existsSize });
      if (existsResult === "server_error") return jsonResponse({ error_summary: "internal" }, false, 500);
      return jsonResponse({ error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } }, false, 409);
    }
    if (String(url).includes("files/upload")) {
      if (!uploadOk) return jsonResponse({ error_summary: "insufficient_space/" }, false, 507);
      const bodyLength = options.body ? options.body.length : 0;
      const decodedArg = JSON.parse(options.headers["Dropbox-API-Arg"].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
      return jsonResponse({
        name: "NAVER_ADS_WEEKLY_2026-09-15_2026-09-21.xlsx",
        path_display: decodedArg.path,
        path_lower: decodedArg.path.toLowerCase(),
        size: uploadSizeOverride ?? bodyLength
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
  return { fetchImpl, calls };
}

async function makeTinyWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("SUMMARY").addRow(["test"]);
  return workbook;
}

test("1. Dropbox target path is exactly /SAMPLAS WORK/병구 작업/네이버 광고 리포트/<file>", () => {
  assert.equal(dropboxWeeklyReportDir({}), "/SAMPLAS WORK/병구 작업/네이버 광고 리포트");
  assert.equal(
    dropboxTargetPath("NAVER_ADS_WEEKLY_2026-09-15_2026-09-21.xlsx", {}),
    "/SAMPLAS WORK/병구 작업/네이버 광고 리포트/NAVER_ADS_WEEKLY_2026-09-15_2026-09-21.xlsx"
  );
});

test("dropbox destination is overridable via DROPBOX_WEEKLY_REPORT_DIR without a code change", () => {
  assert.equal(dropboxWeeklyReportDir({ DROPBOX_WEEKLY_REPORT_DIR: "/Custom/Dir" }), "/Custom/Dir");
});

// Blocker 1 fix: a partially-configured Dropbox (1 or 2 of the 3 vars set) must never
// silently fall back to "local" — that would mean Production writes the report to
// Render's own disk instead of Dropbox while still reporting success. Zero vars is the
// only condition allowed to mean "local/dev mode"; anything in between is "misconfigured"
// and the caller (server.mjs's scheduler) must fail closed on it.
test("resolveWeeklyReportDestination: zero vars -> local, all 3 -> dropbox, partial -> misconfigured (never local)", () => {
  assert.equal(resolveWeeklyReportDestination({}).mode, "local");
  assert.equal(resolveWeeklyReportDestination(FAKE_ENV).mode, "dropbox");
  assert.equal(isDropboxConfigured({ ...FAKE_ENV, DROPBOX_REFRESH_TOKEN: "" }), false);

  const onlyAppKey = resolveWeeklyReportDestination({ DROPBOX_APP_KEY: "x" });
  assert.equal(onlyAppKey.mode, "misconfigured");
  assert.deepEqual(onlyAppKey.missing.sort(), ["DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"]);

  const appKeyAndSecret = resolveWeeklyReportDestination({ DROPBOX_APP_KEY: "x", DROPBOX_APP_SECRET: "y" });
  assert.equal(appKeyAndSecret.mode, "misconfigured");
  assert.deepEqual(appKeyAndSecret.missing, ["DROPBOX_REFRESH_TOKEN"]);

  const onlyRefreshToken = resolveWeeklyReportDestination({ DROPBOX_REFRESH_TOKEN: "z" });
  assert.equal(onlyRefreshToken.mode, "misconfigured");
  assert.deepEqual(onlyRefreshToken.missing.sort(), ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"]);

  // never leaks the (fake, but still) credential values into the "missing" list — only var names
  const stringified = JSON.stringify(onlyAppKey);
  assert.equal(stringified.includes("x"), false);
});

test("asciiSafeJson escapes non-ASCII (Korean path) characters, leaving no raw bytes above 0x7f", () => {
  const encoded = asciiSafeJson({ path: "/SAMPLAS WORK/병구 작업/네이버 광고 리포트/x.xlsx" });
  for (const ch of encoded) assert.ok(ch.charCodeAt(0) <= 0x7f, `non-ASCII char leaked: ${ch}`);
  assert.match(encoded, /\\uc0c8|\\ub124|\\ubc84/i); // some \uXXXX escape is present for the Korean text
});

// 2. upload request shape
test("2. upload request uses the correct endpoint, Bearer auth, Dropbox-API-Arg, and binary body", async () => {
  const { fetchImpl, calls } = makeFetchMock();
  const workbook = await makeTinyWorkbook();
  const path = dropboxTargetPath("f.xlsx", {});
  const accessToken = await getDropboxAccessToken({ env: FAKE_ENV, fetchImpl });
  const buffer = await workbook.xlsx.writeBuffer();
  await dropboxUploadFile(path, buffer, { accessToken, fetchImpl });
  const uploadCall = calls.find((c) => c.url.includes("files/upload"));
  assert.equal(uploadCall.url, "https://content.dropboxapi.com/2/files/upload");
  assert.equal(uploadCall.options.headers.Authorization, "Bearer FAKE_ACCESS_TOKEN_VALUE");
  assert.equal(uploadCall.options.headers["Content-Type"], "application/octet-stream");
  const arg = JSON.parse(uploadCall.options.headers["Dropbox-API-Arg"].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
  assert.equal(arg.path, path);
  assert.equal(arg.mode, "add");
  assert.equal(arg.autorename, false);
  assert.ok(Buffer.isBuffer(uploadCall.options.body) || uploadCall.options.body instanceof Uint8Array);
});

// 3. credential leakage
test("3. no credential leakage in module source, thrown errors, or a failed token exchange", async () => {
  const source = await readFile(new URL("../scripts/dropbox-report-uploader.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*(accessToken|APP_SECRET|REFRESH_TOKEN)/i);

  const { fetchImpl } = makeFetchMock({ tokenOk: false });
  await assert.rejects(
    () => getDropboxAccessToken({ env: FAKE_ENV, fetchImpl }),
    (error) => {
      assert.equal(error.message.includes(FAKE_ENV.DROPBOX_APP_SECRET), false);
      assert.equal(error.message.includes(FAKE_ENV.DROPBOX_REFRESH_TOKEN), false);
      return true;
    }
  );
});

// 4. upload success
test("4. upload success returns uploaded:true with the resolved size", async () => {
  const { fetchImpl } = makeFetchMock({ existsResult: "not_found", uploadOk: true });
  const workbook = await makeTinyWorkbook();
  const result = await saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl });
  assert.equal(result.uploaded, true);
  assert.equal(result.alreadyExists, false);
  assert.equal(result.filePath, "/SAMPLAS WORK/병구 작업/네이버 광고 리포트/NAVER_ADS_WEEKLY_2026-09-15_2026-09-21.xlsx");
  assert.ok(result.size > 0);
});

// 5. auth/token refresh failure
test("5. auth/token refresh failure surfaces as a rejected promise, not a false success", async () => {
  const { fetchImpl } = makeFetchMock({ tokenOk: false });
  const workbook = await makeTinyWorkbook();
  await assert.rejects(() => saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl }));
});

// 6. network failure
test("6. a network failure (fetch throws) propagates instead of being swallowed", async () => {
  const fetchImpl = async () => { throw new Error("getaddrinfo ENOTFOUND api.dropbox.com"); };
  const workbook = await makeTinyWorkbook();
  await assert.rejects(() => saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl }), /ENOTFOUND/);
});

// 7. non-2xx response
test("7. a non-2xx upload response (e.g. insufficient space) rejects with Dropbox's own error text", async () => {
  const { fetchImpl } = makeFetchMock({ existsResult: "not_found", uploadOk: false });
  const workbook = await makeTinyWorkbook();
  await assert.rejects(
    () => saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl }),
    /insufficient_space/
  );
});

test("a non-409, non-2xx get_metadata response (real failure) rejects instead of being treated as not-found", async () => {
  const { fetchImpl } = makeFetchMock({ existsResult: "server_error" });
  await assert.rejects(() => dropboxFileExists("/x.xlsx", { accessToken: "t", fetchImpl }));
});

// 8 / Blocker 2. existing weekly file -> duplicate-safe ONLY when its size actually
// matches the report this run would have produced. A same-name file of a different size
// (truncated, corrupted, a leftover from a previous failed attempt, or manually placed)
// must never be silently accepted as a valid prior success.
test("8a. an already-existing Dropbox file of the SAME size is treated as already-done — no upload call is made", async () => {
  const workbook = await makeTinyWorkbook();
  const expectedSize = (await workbook.xlsx.writeBuffer()).length;
  const { fetchImpl, calls } = makeFetchMock({ existsResult: "exists", existsSize: expectedSize });
  const result = await saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl });
  assert.equal(result.uploaded, false);
  assert.equal(result.alreadyExists, true);
  assert.equal(result.size, expectedSize);
  assert.equal(calls.some((c) => c.url.includes("files/upload")), false);
});

test("8b. an already-existing Dropbox file of a DIFFERENT size is rejected — no upload, no false success", async () => {
  const workbook = await makeTinyWorkbook();
  const realSize = (await workbook.xlsx.writeBuffer()).length;
  const { fetchImpl, calls } = makeFetchMock({ existsResult: "exists", existsSize: realSize + 500 }); // corrupted/wrong artifact
  await assert.rejects(
    () => saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl }),
    /size mismatch/i
  );
  assert.equal(calls.some((c) => c.url.includes("files/upload")), false);
});

test("8c. ambiguous prior-upload-timeout scenario: a retry that finds a same-size file succeeds without a duplicate upload", async () => {
  // Simulates: first run's upload actually reached Dropbox but the response was lost to a
  // network timeout (so the first saveWeeklyReportToDropbox call itself would have thrown).
  // The next scheduler poll retries from scratch; get_metadata now finds a file whose size
  // matches exactly what this run would produce, so it's accepted as the real prior success.
  const workbook = await makeTinyWorkbook();
  const realSize = (await workbook.xlsx.writeBuffer()).length;
  const { fetchImpl, calls } = makeFetchMock({ existsResult: "exists", existsSize: realSize });
  const result = await saveWeeklyReportToDropbox(workbook, { since: "2026-09-15", until: "2026-09-21", env: FAKE_ENV, fetchImpl });
  assert.equal(result.alreadyExists, true);
  assert.equal(calls.filter((c) => c.url.includes("files/upload")).length, 0);
});

test("dropboxFileExists correctly distinguishes a 409 not_found from a real error", async () => {
  const notFound = makeFetchMock({ existsResult: "not_found" });
  assert.deepEqual(await dropboxFileExists("/x.xlsx", { accessToken: "t", fetchImpl: notFound.fetchImpl }), { exists: false });
  const exists = makeFetchMock({ existsResult: "exists" });
  const result = await dropboxFileExists("/x.xlsx", { accessToken: "t", fetchImpl: exists.fetchImpl });
  assert.equal(result.exists, true);
  assert.equal(result.size, 12345);
});
