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
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";

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

// ---------------------------------------------------------------------------
// WRITE (Phase 2-2). Only entry point that calls files/upload. Never called by
// the GET routes above. project folder must already exist in PROJECTS/ — a
// missing folder is never created here.
// ---------------------------------------------------------------------------

export function validatePopupProjectPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("malformed_json");
  const project = payload.project;
  if (!project || typeof project !== "object") throw new Error("project is required");
  if (typeof project.name !== "string" || !project.name.trim()) throw new Error("project.name is required");
  for (const key of ["tasks", "assets", "notes"]) {
    if (!Array.isArray(project[key])) throw new Error(`project.${key} must be an array`);
  }
  if (!("expectedVersion" in payload)) throw new Error("expectedVersion is required");
  const expectedVersion = payload.expectedVersion;
  if (expectedVersion !== null && typeof expectedVersion !== "number") {
    throw new Error("expectedVersion must be a number or null");
  }
  return { project, expectedVersion };
}

// Same download as readPopupJsonFromDropbox, plus the Dropbox file `rev` (from
// the Dropbox-API-Result response header) needed for the update-mode
// compare-and-swap in saveProjectWithExpectedVersion. Never swallows a
// corrupt-JSON error — a write must not blindly overwrite an unparseable
// existing file.
async function downloadPopupJsonWithRev(folder, { accessToken, fetchImpl = fetch }) {
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
    if (isDropboxPathNotFound(response.status, text)) return { project: null, rev: null };
    throw dropboxErrorFromResponse(response.status, text, "popup.json download");
  }
  let project;
  try {
    project = JSON.parse(text);
  } catch {
    throw new Error(`popup.json for "${folder.name}" is not valid JSON.`);
  }
  let rev = null;
  try {
    rev = JSON.parse(response.headers.get("dropbox-api-result") || "null")?.rev ?? null;
  } catch {
    rev = null;
  }
  return { project, rev };
}

// Storage-level compare-and-swap: mode "update" + the rev just read means
// Dropbox itself rejects the write if the file changed since — this is the
// authoritative concurrency guard (no in-process lock needed, works across
// any number of Render instances). "add" mode (no rev) is only used for the
// one-time case where the folder exists but popup.json has never been
// written yet (expectedVersion must be null for that to be accepted).
async function uploadPopupJson(folder, projectObj, { accessToken, fetchImpl = fetch, rev }) {
  const popupJsonPath = `${folder.pathDisplay}/popup.json`;
  const mode = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
  const response = await fetchImpl(DROPBOX_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": asciiSafeJson({ path: popupJsonPath, mode, autorename: false, mute: true }),
      "Content-Type": "application/octet-stream"
    },
    body: JSON.stringify(projectObj, null, 2)
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 409) return { conflict: true };
    throw dropboxErrorFromResponse(response.status, text, "popup.json upload");
  }
  return { conflict: false };
}

// Result shape:
//   { ok:true, project } — write succeeded, project has server-set version/updatedAt
//   { ok:false, reason:"project_not_found" }
//   { ok:false, reason:"version_conflict", currentVersion }
export async function saveProjectWithExpectedVersion(name, incomingProject, expectedVersion, { env = process.env, fetchImpl = fetch } = {}) {
  const { accessToken, folders } = await listPopupProjectFolders({ env, fetchImpl });
  const folder = matchPopupProjectFolder(folders, name);
  if (!folder) return { ok: false, reason: "project_not_found" };

  const { project: current, rev } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl });
  const currentVersion = current?.version ?? null;
  if (expectedVersion !== currentVersion) {
    return { ok: false, reason: "version_conflict", currentVersion };
  }

  const newVersion = (currentVersion || 0) + 1;
  const updatedProject = {
    ...incomingProject,
    updatedAt: new Date().toISOString(),
    version: newVersion
  };

  const result = await uploadPopupJson(folder, updatedProject, { accessToken, fetchImpl, rev });
  if (result.conflict) {
    // Someone else's write landed between our read and our upload. Re-read to
    // report the real current version rather than guessing.
    const { project: latest } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl });
    return { ok: false, reason: "version_conflict", currentVersion: latest?.version ?? null };
  }
  return { ok: true, project: updatedProject };
}
