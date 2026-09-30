// POPUP DIRECTOR shared-data READ ONLY store — Phase 2-1.
//
// Reads PROJECTS/<project>/popup.json from Dropbox (the same file the local
// samplas_dashboard.py / POPUP DIRECTOR UI already treats as source of truth —
// see the POPUP_DIRECTOR_LITE 3 app.js / samplas_dashboard.py popup shared-data
// layer). This module only ever calls Dropbox's read-only endpoints
// (files/list_folder, files/get_metadata, files/download) — it has no
// files/upload, files/delete, files/move, or files/copy call anywhere in it.
//
// OAuth: reuses the exact same refresh-token flow already implemented in
// scripts/dropbox-report-uploader.mjs (getDropboxAccessToken, asciiSafeJson) —
// imported, never duplicated. That module's own upload/write functions are
// never imported or called here, so nothing about the existing weekly-report
// upload path changes.
//
// Path safety: a requested project `name` is never concatenated into a Dropbox
// path. Every lookup lists the real PROJECTS folder via files/list_folder and
// matches the requested name (NFC-normalized) against each real folder's own
// name (also NFC-normalized) — same discipline as the local
// find_popup_project_dir() in samplas_dashboard.py. Only a folder's own
// Dropbox-returned path_display is ever used to build the popup.json path.
import { getDropboxAccessToken, asciiSafeJson } from "./dropbox-report-uploader.mjs";

const POPUP_PROJECTS_DROPBOX_PATH = "/SAMPLAS WORK/병구 작업/팝업 관련 자동화/PROJECTS";

const DROPBOX_LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";
const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";

function dropboxErrorFromResponse(status, bodyText, context) {
  const trimmed = String(bodyText || "").slice(0, 500);
  return new Error(`Dropbox ${context} failed (HTTP ${status}): ${trimmed || "no response body"}`);
}

function isDropboxPathNotFound(status, bodyText) {
  if (status !== 409) return false;
  try {
    const body = JSON.parse(bodyText);
    return body?.error?.[".tag"] === "path" && body?.error?.path?.[".tag"] === "not_found";
  } catch {
    return false;
  }
}

// Lists the direct children of PROJECTS/ only (never _UPLOADED/_DELETED, which
// are siblings of PROJECTS, not inside it — same scope as the local
// popup_project_summaries()/popup_project_items() in samplas_dashboard.py).
// Hidden entries (name starting with ".") are excluded. Read-only.
export async function listPopupProjectFolders({ env = process.env, fetchImpl = fetch } = {}) {
  const accessToken = await getDropboxAccessToken({ env, fetchImpl });
  const response = await fetchImpl(DROPBOX_LIST_FOLDER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: POPUP_PROJECTS_DROPBOX_PATH })
  });
  const text = await response.text();
  if (!response.ok) {
    if (isDropboxPathNotFound(response.status, text)) return { accessToken, folders: [] };
    throw dropboxErrorFromResponse(response.status, text, "PROJECTS list_folder");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Dropbox list_folder returned an unreadable response.");
  }
  const folders = (body.entries || [])
    .filter((entry) => entry[".tag"] === "folder" && !String(entry.name || "").startsWith("."))
    .map((entry) => ({ name: entry.name, pathDisplay: entry.path_display }));
  return { accessToken, folders };
}

// Requested `name` is NFC-normalized and matched against each real folder's
// own NFC-normalized name — never concatenated into a path. A name that
// matches no real folder (including any path-traversal-shaped input, which
// simply never equals a real folder name) returns null.
export function matchPopupProjectFolder(folders, requestedName) {
  const requested = String(requestedName || "").normalize("NFC");
  if (!requested) return null;
  return folders.find((folder) => String(folder.name || "").normalize("NFC") === requested) || null;
}

// Downloads and parses PROJECTS/<folder>/popup.json using the folder's own
// Dropbox-returned path_display (never a path built from user input).
// Returns null if popup.json does not exist yet (normal "not migrated" state,
// same semantics as the local read_popup_json() returning None) — never
// creates or infers content. Throws on a malformed/corrupt JSON body.
export async function readPopupJsonFromDropbox(folder, { accessToken, fetchImpl = fetch }) {
  const popupJsonPath = `${folder.pathDisplay}/popup.json`;
  const response = await fetchImpl(DROPBOX_DOWNLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": asciiSafeJson({ path: popupJsonPath })
    }
  });
  const text = await response.text();
  if (!response.ok) {
    if (isDropboxPathNotFound(response.status, text)) return null;
    throw dropboxErrorFromResponse(response.status, text, "popup.json download");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`popup.json for "${folder.name}" is not valid JSON.`);
  }
}

// One-shot summary list for GET /api/ai-audit/popup/projects. version/updatedAt
// are read straight from each popup.json — never hardcoded, never fabricated
// for a project that has no popup.json yet (hasData:false, version:null).
export async function getPopupProjectSummaries({ env = process.env, fetchImpl = fetch } = {}) {
  const { accessToken, folders } = await listPopupProjectFolders({ env, fetchImpl });
  const summaries = [];
  for (const folder of folders) {
    let project = null;
    try {
      project = await readPopupJsonFromDropbox(folder, { accessToken, fetchImpl });
    } catch {
      // Corrupt popup.json for this one project should not break the whole
      // list; it is reported as hasData:false rather than aborting.
      project = null;
    }
    summaries.push({
      name: folder.name,
      hasData: project !== null,
      version: project?.version ?? null,
      updatedAt: project?.updatedAt ?? null
    });
  }
  return summaries;
}

// Result shape for GET /api/ai-audit/popup/project?name=...
//   { ok:true, project } on success
//   { ok:false, reason:"project_not_found" } — no matching PROJECTS folder
//   { ok:false, reason:"no_data" } — folder exists, popup.json does not yet
export async function getPopupProjectByName(name, { env = process.env, fetchImpl = fetch } = {}) {
  const { accessToken, folders } = await listPopupProjectFolders({ env, fetchImpl });
  const folder = matchPopupProjectFolder(folders, name);
  if (!folder) return { ok: false, reason: "project_not_found" };
  const project = await readPopupJsonFromDropbox(folder, { accessToken, fetchImpl });
  if (project === null) return { ok: false, reason: "no_data" };
  return { ok: true, project };
}
