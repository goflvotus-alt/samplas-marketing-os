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

const DEFAULT_DROPBOX_REPORT_DIR = "/SAMPLAS WORK/병구 작업/네이버 광고 리포트";

const DROPBOX_TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const DROPBOX_GET_METADATA_URL = "https://api.dropboxapi.com/2/files/get_metadata";
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
    return { exists: true, size: body.size ?? null };
  }
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const notFound = response.status === 409 && body?.error?.[".tag"] === "path" && body?.error?.path?.[".tag"] === "not_found";
  if (notFound) return { exists: false };
  throw dropboxErrorFromResponse(response.status, text, "existence check");
}

export async function dropboxUploadFile(path, buffer, { accessToken, fetchImpl = fetch }) {
  const dropboxApiArg = asciiSafeJson({ path, mode: "add", autorename: false, mute: true, strict_conflict: true });
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

// The `saveReport(workbook, { since, until, env })` implementation server.mjs's
// scheduler injects into generateWeeklyNaverAdsReport() when Dropbox is configured.
// Idempotent by construction: if the target file already exists in Dropbox (a prior
// run — this run, an earlier retry, or a run just before a server restart — already
// succeeded), this returns success WITHOUT uploading again, using the Dropbox file's own
// existence as the durable "this week is done" marker instead of any new persistent
// scheduler state or database.
export async function saveWeeklyReportToDropbox(workbook, { since, until, env = process.env, fetchImpl = fetch } = {}) {
  const fileName = weeklyReportFileName(since, until);
  const targetPath = dropboxTargetPath(fileName, env);
  const accessToken = await getDropboxAccessToken({ env, fetchImpl });
  const buffer = await workbook.xlsx.writeBuffer();

  const existing = await dropboxFileExists(targetPath, { accessToken, fetchImpl });
  if (existing.exists) {
    // Same canonical filename is not enough on its own — a truncated/corrupted file, a
    // manually-placed wrong file, or a leftover from a previous failed attempt would
    // otherwise be silently accepted as a valid prior success. Size is already available
    // from get_metadata and the buffer we'd have uploaded, so compare them before trusting
    // it. A mismatch fails loudly rather than auto-overwriting — overwriting an existing
    // Dropbox file is a bigger decision than this minimal fix is meant to make.
    if (existing.size !== buffer.length) {
      throw new Error(`Existing weekly Dropbox report size mismatch at ${targetPath}: expected ${buffer.length} bytes, found ${existing.size}.`);
    }
    return { filePath: targetPath, uploaded: false, alreadyExists: true, size: existing.size };
  }

  const uploaded = await dropboxUploadFile(targetPath, buffer, { accessToken, fetchImpl });
  return { filePath: targetPath, uploaded: true, alreadyExists: false, size: uploaded.size };
}

// ---------------------------------------------------------------------------
// Generic, platform-agnostic upload (Meta/Instagram weekly reports reuse this — the
// Naver-specific saveWeeklyReportToDropbox() above is untouched, kept exactly as-is, so
// nothing about the already-working Naver→Dropbox path changes). Same idempotency,
// size-mismatch-fails-loudly, and secret-safety guarantees as the Naver path, just with
// an explicit targetPath instead of a hardcoded Naver filename/directory.
// ---------------------------------------------------------------------------

export async function saveWeeklyReportToDropboxAtPath(workbook, { targetPath, env = process.env, fetchImpl = fetch } = {}) {
  const accessToken = await getDropboxAccessToken({ env, fetchImpl });
  const buffer = await workbook.xlsx.writeBuffer();

  const existing = await dropboxFileExists(targetPath, { accessToken, fetchImpl });
  if (existing.exists) {
    if (existing.size !== buffer.length) {
      throw new Error(`Existing weekly Dropbox report size mismatch at ${targetPath}: expected ${buffer.length} bytes, found ${existing.size}.`);
    }
    return { filePath: targetPath, uploaded: false, alreadyExists: true, size: existing.size };
  }

  const uploaded = await dropboxUploadFile(targetPath, buffer, { accessToken, fetchImpl });
  return { filePath: targetPath, uploaded: true, alreadyExists: false, size: uploaded.size };
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
