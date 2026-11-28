import { createRequire } from "node:module";
import ExcelJS from "exceljs";
// Dropbox upload for the Naver Ads Weekly Report — Production-only concern, kept fully
// separate from scripts/naver-ads-weekly-report.mjs (which stays destination-agnostic:
// it only knows how to build the report model/workbook and, by default, write it to a
// local file). This module never re-derives any ad metric — it only ever accepts an
// already-built ExcelJS workbook and moves its bytes to Dropbox.
//
// Auth: standard Dropbox API v2 OAuth2 "offline access" server pattern (the only one
// that works unattended — a plain access token expires in ~4 hours). No format is
// guessed: this is Dropbox's own documented flow at
// https://developers.dropbox.com/oauth-guide (token_access_type=offline at the initial
// authorization step is what makes Dropbox hand out a refresh_token in the first place;
// that one-time authorization is NOT part of this module — this module only ever
// exchanges an already-issued refresh_token for short-lived access tokens):
//   POST https://api.dropbox.com/oauth2/token
//   Authorization: Basic base64(app_key:app_secret)
//   Body: grant_type=refresh_token&refresh_token=<refresh_token>
//   -> { access_token, token_type: "bearer", expires_in }
//
// Required env (no existing Dropbox credential structure was found anywhere in this
// repo to reuse — see Phase 0 audit in the accompanying report):
//   DROPBOX_APP_KEY
//   DROPBOX_APP_SECRET
//   DROPBOX_REFRESH_TOKEN
// Optional:
//   DROPBOX_WEEKLY_REPORT_DIR (Dropbox API path, default below)
import { weeklyReportFileName } from "./naver-ads-weekly-report.mjs";

// ExcelJS already uses JSZip to read XLSX. Enable its CRC check before parsing sheets.
const JSZip = createRequire(import.meta.resolve("exceljs"))("jszip");

const DEFAULT_DROPBOX_REPORT_DIR = "/SAMPLAS WORK/병구 작업/네이버 광고 리포트";

const DROPBOX_TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const DROPBOX_GET_METADATA_URL = "https://api.dropboxapi.com/2/files/get_metadata";
const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";

export function isDropboxConfigured(env = process.env) {
  return Boolean(env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET && env.DROPBOX_REFRESH_TOKEN);
}

const DROPBOX_REQUIRED_ENV_KEYS = ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"];

// Chooses Production (Dropbox) vs Local (filesystem, existing behavior) purely from
// which credentials are present — no new "environment" flag is introduced, matching
// this project's existing convention (e.g. cafe24Mode is chosen the same way, by which
// env vars are configured, not by NODE_ENV). Zero of the 3 vars set is the only case
// that means genuine local/dev mode. Anything in between (1 or 2 set) is a Production
// misconfiguration, not "use local" — falling back to local there would mean silently
// writing the report to Render's own disk instead of Dropbox while still reporting
// success, so it's reported as its own explicit "misconfigured" mode instead (never
// throws here — the caller decides how to react; see runNaverWeeklyReportCheck in
// server.mjs, which fails closed on it).
export function resolveWeeklyReportDestination(env = process.env) {
  const missing = DROPBOX_REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length === 0) return { mode: "dropbox" };
  if (missing.length === DROPBOX_REQUIRED_ENV_KEYS.length) return { mode: "local" };
  return { mode: "misconfigured", missing };
}

export function dropboxWeeklyReportDir(env = process.env) {
  return env.DROPBOX_WEEKLY_REPORT_DIR || DEFAULT_DROPBOX_REPORT_DIR;
}

export function dropboxTargetPath(fileName, env = process.env) {
  const dir = dropboxWeeklyReportDir(env).replace(/\/+$/, "");
  return `${dir}/${fileName}`;
}

// Dropbox requires request headers to be ASCII; non-ASCII characters in
// Dropbox-API-Arg (our path contains Korean) must be \uXXXX-escaped per
// https://www.dropbox.com/developers/reference/json-encoding. JSON.stringify alone
// does not do this (it emits raw UTF-8 characters), so this does it explicitly, per
// character by numeric code point (>0x7f) rather than a regex character-class range —
// avoids embedding any raw non-ASCII byte in this source file.
export function asciiSafeJson(value) {
  return JSON.stringify(value)
    .split("")
    .map((ch) => (ch.charCodeAt(0) > 0x7f ? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}` : ch))
    .join("");
}

// Never lets a secret value reach an Error/log message — only Dropbox's own returned
// text (which never echoes back our credentials) or a generic description is used.
function dropboxErrorFromResponse(status, bodyText, context) {
  const trimmed = String(bodyText || "").slice(0, 500);
  return new Error(`Dropbox ${context} failed (HTTP ${status}): ${trimmed || "no response body"}`);
}

export async function getDropboxAccessToken({ env = process.env, fetchImpl = fetch } = {}) {
  if (!isDropboxConfigured(env)) {
    throw new Error("Dropbox is not configured: DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN are all required.");
  }
  const credentials = Buffer.from(`${env.DROPBOX_APP_KEY}:${env.DROPBOX_APP_SECRET}`).toString("base64");
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.DROPBOX_REFRESH_TOKEN });
  const response = await fetchImpl(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const text = await response.text();
  if (!response.ok) throw dropboxErrorFromResponse(response.status, text, "token refresh");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Dropbox token refresh returned an unreadable response.");
  }
  if (!body.access_token) throw new Error("Dropbox token refresh response had no access_token.");
  // Used only in memory for the immediate upload that follows; never written to disk,
  // never logged, never returned from any exported function here.
  return body.access_token;
}

// Returns { exists: true, size } or { exists: false }. Dropbox represents "not found" as
// an HTTP 409 with a structured error body (not a plain 404), so that specific shape is
// treated as "does not exist" and everything else as a real failure.
export async function dropboxFileExists(path, { accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(DROPBOX_GET_METADATA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
  const text = await response.text();
  if (response.ok) {
    const body = JSON.parse(text);
    return { exists: true, size: body.size ?? null, ...(body.rev ? { rev: body.rev } : {}) };
  }
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const notFound = response.status === 409 && body?.error?.[".tag"] === "path" && body?.error?.path?.[".tag"] === "not_found";
  if (notFound) return { exists: false };
  throw dropboxErrorFromResponse(response.status, text, "existence check");
}

export async function dropboxUploadFile(path, buffer, { accessToken, fetchImpl = fetch, rev }) {
  const dropboxApiArg = asciiSafeJson({ path, mode: rev ? { ".tag": "update", update: rev } : "add", autorename: false, mute: true, strict_conflict: true });
  const response = await fetchImpl(DROPBOX_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": dropboxApiArg,
      "Content-Type": "application/octet-stream"
    },
    body: buffer
  });
  const text = await response.text();
  if (!response.ok) throw dropboxErrorFromResponse(response.status, text, "upload");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Dropbox upload returned an unreadable response.");
  }
  if (body.path_display !== path && body.path_lower !== path.toLowerCase()) {
    throw new Error("Dropbox upload response path did not match the requested target path.");
  }
  if (typeof body.size === "number" && body.size !== buffer.length) {
    throw new Error(`Dropbox upload size mismatch: sent ${buffer.length} bytes, Dropbox recorded ${body.size}.`);
  }
  return { size: body.size ?? buffer.length, name: body.name, pathDisplay: body.path_display };
}

const reportLayouts = {
  NAVER_ADS: { title: "NAVER SEARCH ADS", metrics: ["A6", "E6", "E10"], minimumMetrics: 3 },
  META_ADS: { title: "META ADS", sheets: ["SUMMARY", "CAMPAIGN", "AD SET", "CREATIVE_AD", "TREND", "AI_ANALYSIS", "ACTUAL_PRODUCTS_SOLD", "RAW"], metrics: ["A6", "D6", "G6"], minimumMetrics: 3 },
  INSTAGRAM: { title: "INSTAGRAM", metrics: ["E6", "I6", "I10"], minimumMetrics: 1 }
};

async function validateReportBytes(bytes, targetPath) {
  try {
    const fileName = targetPath.split("/").at(-1);
    const match = /^(NAVER_ADS|META_ADS|INSTAGRAM)_(WEEKLY|MONTHLY)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})(_CORRECTED|_PREVIEW_[a-f0-9-]+)?\.xlsx$/.exec(fileName);
    if (!match) throw new Error("unrecognized report filename");
    const [, platform, cadence, since, until, variant] = match;
    if (variant === "_CORRECTED" && (platform !== "META_ADS" || cadence !== "MONTHLY")) {
      throw new Error("invalid corrected report scope");
    }
    const layout = reportLayouts[platform];
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    for (const entry of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"]) {
      if (!archive.file(entry)) throw new Error("missing XLSX package entry");
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    if (layout.sheets?.some(name => !workbook.getWorksheet(name))) throw new Error("missing required XLSX worksheet");
    if (variant === "_CORRECTED" &&
        workbook.getWorksheet("CORRECTION")?.getCell("B1").text !== fileName.replace("_CORRECTED", "")) {
      throw new Error("missing correction provenance");
    }
    const report = workbook.getWorksheet("REPORT");
    if (!report || report.state !== "visible" || report.getCell("A1").text !== `${layout.title} ${cadence} REPORT`) {
      throw new Error("missing REPORT sheet or incorrect platform");
    }
    if (report.getCell("A2").text !== `SAMPLAS  |  ${since} – ${until}`) throw new Error("report period mismatch");
    const measured = layout.metrics.map(address => report.getCell(address).value);
    if (/PREVIEW|검증 실패\(FAIL\)/i.test(report.getCell("A4").text)) throw new Error("workbook is not a publishable issue");
    if (measured.some(value => typeof value === "number" && (!Number.isFinite(value) || value < 0)) ||
        measured.filter(Number.isFinite).length < layout.minimumMetrics) {
      throw new Error("required metrics are missing or invalid");
    }
    const evidence = workbook.getWorksheet("ISSUE_EVIDENCE");
    const parts = [];
    evidence?.eachRow(row => parts.push(row.getCell("A").text));
    const encoded = parts.join("");
    if (platform === "NAVER_ADS" && !encoded) {
      // Older official weekly layouts carry provenance and matching totals on REPORT.
      const totals = ["C15", "C17", "C22"].map(address => report.getCell(address).value);
      if (cadence !== "WEEKLY" || report.getCell("A4").text ||
          report.getCell("A62").text !== `SOURCE: Naver Search Ads · 기간별 캠페인 통계 · ${since} – ${until}` ||
          totals.some((value, index) => value !== measured[index])) {
        throw new Error("missing issue evidence sheet or invalid legacy Naver report");
      }
    } else if (platform === "NAVER_ADS" || evidence) {
      if (evidence?.state !== "veryHidden") throw new Error("missing issue evidence sheet");
      const record = JSON.parse(encoded);
      const allowedReviews = platform === "NAVER_ADS" ? ["PASS", "PARTIAL"] : ["PASS", "UNKNOWN"];
      if (record.since !== since || record.until !== until || !allowedReviews.includes(record.review?.result) || record.review.failures?.length) {
        throw new Error("workbook issue evidence failed validation");
      }
    }
    for (const sheet of workbook.worksheets) {
      sheet.eachRow(row => row.eachCell(cell => {
        if (cell.type === ExcelJS.ValueType.Error || cell.effectiveType === ExcelJS.ValueType.Error) {
          throw new Error("workbook contains spreadsheet errors");
        }
      }));
    }
    return workbook;
  } catch (error) {
    throw new Error(`Invalid report workbook at ${targetPath}: ${error.message}`, { cause: error });
  }
}

async function downloadDropboxFile(path, { accessToken, fetchImpl }) {
  const response = await fetchImpl(DROPBOX_DOWNLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Dropbox-API-Arg": asciiSafeJson({ path }) }
  });
  if (!response.ok) throw dropboxErrorFromResponse(response.status, await response.text(), "download");
  return Buffer.from(await response.arrayBuffer());
}

async function readPublishedReport(targetPath, connection) {
  const existing = await dropboxFileExists(targetPath, connection);
  if (!existing.exists) return null;
  const bytes = await downloadDropboxFile(targetPath, connection);
  const workbook = await validateReportBytes(bytes, targetPath);
  return { filePath: targetPath, uploaded: false, alreadyExists: true, size: bytes.length, bytes, workbook };
}

export async function findPublishedReport({ targetPath, env = process.env, fetchImpl = fetch }) {
  return readPublishedReport(targetPath, { accessToken: await getDropboxAccessToken({ env, fetchImpl }), fetchImpl });
}

export function saveWeeklyReportToDropbox(workbook, { since, until, env = process.env, fetchImpl = fetch } = {}) {
  return saveWeeklyReportToDropboxAtPath(workbook, { targetPath: dropboxTargetPath(weeklyReportFileName(since, until), env), env, fetchImpl });
}

export async function saveWeeklyReportToDropboxAtPath(workbook, { targetPath, env = process.env, fetchImpl = fetch } = {}) {
  const connection = { accessToken: await getDropboxAccessToken({ env, fetchImpl }), fetchImpl };
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  if (/_PREVIEW_[a-f0-9-]+\.xlsx$/.test(targetPath)) {
    const uploaded = await dropboxUploadFile(targetPath, buffer, connection);
    return { filePath: targetPath, uploaded: true, alreadyExists: false, size: uploaded.size };
  }
  const existingResult = ({ bytes, workbook, ...result }) => ({ ...result, contentMatches: bytes.equals(buffer) });
  const existing = await readPublishedReport(targetPath, connection);
  if (existing) return existingResult(existing);
  await validateReportBytes(buffer, targetPath);
  try {
    await dropboxUploadFile(targetPath, buffer, connection);
  } catch (uploadError) {
    // A response can be lost after Dropbox commits, or a competing run can win strict add.
    const published = await readPublishedReport(targetPath, connection);
    if (published) return existingResult(published);
    throw uploadError;
  }
  const saved = await readPublishedReport(targetPath, connection);
  if (!saved || !saved.bytes.equals(buffer)) throw new Error("Dropbox report failed post-upload integrity verification");
  return { filePath: targetPath, uploaded: true, alreadyExists: false, size: saved.size };
}

export async function reconcileWeeklyFailureNotice({ targetPath, env = process.env, fetchImpl = fetch }) {
  const connection = { accessToken: await getDropboxAccessToken({ env, fetchImpl }), fetchImpl };
  const path = targetPath.replace(/\.xlsx$/, "_FAILED.txt");
  const existing = await dropboxFileExists(path, connection);
  if (!existing.exists) return;
  if (!existing.rev) throw new Error("Dropbox failure notice has no revision");
  const prior = await downloadDropboxFile(`rev:${existing.rev}`, connection);
  const status = `SAMPLAS REPORT PUBLISHED — HISTORICAL ATTEMPT BELOW\nreport: ${targetPath}\n\n`;
  const historical = prior.toString("utf8");
  if (historical.startsWith(status)) return;
  if (!/^SAMPLAS (?:WEEKLY REPORT FAILED|REPORT ATTEMPT FAILED)\r?\n/.test(historical)) {
    throw new Error("Unrecognized historical Dropbox failure notice");
  }
  await dropboxUploadFile(path, Buffer.concat([Buffer.from(status), prior]), { ...connection, rev: existing.rev });
}

// Same 3-state fail-closed logic as resolveWeeklyReportDestination() above, generalized
// with a per-platform Dropbox directory env var. When defaultDir is omitted (Instagram,
// pending an explicit destination decision — see the accompanying report), an unset
// directory env var is NOT treated as "use some made-up default"; it's treated the same
// as Dropbox being unconfigured for this platform, i.e. "local" — never silently invents
// a Dropbox path.
export function resolvePlatformDropboxDestination(env, { dirEnvKey, defaultDir = null } = {}) {
  const credsMissing = DROPBOX_REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (credsMissing.length > 0 && credsMissing.length < DROPBOX_REQUIRED_ENV_KEYS.length) {
    return { mode: "misconfigured", missing: credsMissing };
  }
  const dir = env[dirEnvKey] || defaultDir;
  if (credsMissing.length === 0 && dir) return { mode: "dropbox", dir };
  return { mode: "local" };
}

// Failure notice for a week whose report could not be published: reason text only (no
// payloads, no credentials). Add-only like the reports — an existing notice is never touched.
export function weeklyFailureNoticeText({ platform, since, until, error, at }) {
  return [
    "SAMPLAS REPORT ATTEMPT FAILED",
    `platform: ${platform}`,
    `period: ${since} ~ ${until} (KST)`,
    `lastAttemptAt: ${at}`,
    `reason: ${String(error || "unknown").slice(0, 1000)}`,
    "This is an attempt record. The canonical XLSX and its validation determine publication status.",
    ""
  ].join("\n");
}

export async function saveWeeklyFailureNoticeToDropbox({ targetPath, text, env = process.env, fetchImpl = fetch } = {}) {
  const accessToken = await getDropboxAccessToken({ env, fetchImpl });
  const existing = await dropboxFileExists(targetPath, { accessToken, fetchImpl });
  if (existing.exists) return { filePath: targetPath, uploaded: false, alreadyExists: true };
  const reportPath = targetPath.replace(/_FAILED\.txt$/, ".xlsx");
  if (reportPath !== targetPath && await readPublishedReport(reportPath, { accessToken, fetchImpl })) {
    return { filePath: reportPath, uploaded: false, alreadyExists: false, published: true };
  }
  const uploaded = await dropboxUploadFile(targetPath, Buffer.from(text, "utf8"), { accessToken, fetchImpl });
  return { filePath: targetPath, uploaded: true, alreadyExists: false, size: uploaded.size };
}
