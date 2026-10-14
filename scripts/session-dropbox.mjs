// SAMPLAS SESSION DIRECTOR: Dropbox storage. One file per session:
//   /SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/<id>/session.json        (operating sessions)
//   /SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR_TEST/<id>/session.json   (test-session-NNN)
// The path is built only from a validated id. Creation uploads in "add" mode (never overwrites);
// updates check the project version and upload in "update" mode against the rev just read, so a
// write that raced another one fails with 409 instead of overwriting it. Nothing is retried.
// Reuses the existing Dropbox refresh-token flow (dropbox-report-uploader.mjs).
import { asciiSafeJson, getDropboxAccessToken } from "./dropbox-report-uploader.mjs";
import { applyOperations, assertSessionDocument, sessionSummary, SessionError, SESSION_ID_PATTERN } from "./session-store.mjs";
import { assertParticipants, emptyParticipants } from "./session-participants.mjs";

export const SESSION_ROOTS = { live: "/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR", test: "/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR_TEST" };
const API = "https://api.dropboxapi.com/2/files/list_folder";
const DOWNLOAD = "https://content.dropboxapi.com/2/files/download";
const UPLOAD = "https://content.dropboxapi.com/2/files/upload";
const THUMBNAIL = "https://content.dropboxapi.com/2/files/get_thumbnail_v2";
const TEMPORARY_LINK = "https://api.dropboxapi.com/2/files/get_temporary_link";

export function sessionPath(id, file = "session.json") {
  if (!SESSION_ID_PATTERN.test(String(id))) throw new SessionError(400, "invalid_session_id");
  return `${id.startsWith("test-") ? SESSION_ROOTS.test : SESSION_ROOTS.live}/${id}/${file}`;
}

const notFound = (status, text) => status === 409 && /not_found/.test(text);
const failed = (context, status) => new SessionError(502, "dropbox_failed", `Dropbox ${context} failed (HTTP ${status})`);

// Snapshots of the previous version are kept before these changes (a recovery point).
const SNAPSHOT_OPS = new Set(["save_live_log", "approve_answer_correction"]);
const needsSnapshot = (operations) => operations.some((op) => SNAPSHOT_OPS.has(op.type) || (op.type === "update_project" && op.patch?.status === "READY"));

export function createSessionDropboxStore({ env = process.env, fetchImpl = fetch, getToken = getDropboxAccessToken } = {}) {
  // No store-lifetime token cache: refresh immediately before each request, never replay a write.
  async function transport(context, url, init) {
    let response, text;
    try {
      response = await fetchImpl(url, init);
      text = await response.text();
    } catch {
      throw new SessionError(502, "dropbox_network_failed", `Dropbox ${context} transport failed; request was not retried`);
    }
    if ([401, 403].includes(response.status) || (context === "token" && response.status === 400)) {
      throw new SessionError(502, "dropbox_auth_failed", `Dropbox ${context} authentication failed (HTTP ${response.status})`);
    }
    if (context === "token" && !response.ok) throw failed(context, response.status);
    return { response, text };
  }

  async function request(context, url, init) {
    let token;
    try {
      token = await getToken({ env, fetchImpl: async (u, options) => {
        const { response, text } = await transport("token", u, options);
        return { ok: response.ok, status: response.status, text: async () => text };
      } });
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError(502, "dropbox_auth_failed", "Dropbox token unavailable");
    }
    return transport(context, url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  }

  async function listFolder(root, { recursive = false } = {}) {
    const entries = [];
    let { response, text } = await request("list_folder", API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, recursive }) });
    for (;;) {
      if (notFound(response.status, text)) return [];
      if (!response.ok) throw failed("list_folder", response.status);
      const body = JSON.parse(text);
      entries.push(...(body.entries || []));
      if (!body.has_more) return entries;
      ({ response, text } = await request("list_folder", `${API}/continue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cursor: body.cursor }) }));
    }
  }

  async function download(path, check = assertSessionDocument) {
    const { response, text } = await request("download", DOWNLOAD, { method: "POST", headers: { "Dropbox-API-Arg": asciiSafeJson({ path }) } });
    if (notFound(response.status, text)) return null;
    if (!response.ok) throw failed("download", response.status);
    let doc;
    try { doc = JSON.parse(text); } catch { throw new SessionError(500, "invalid_session_document", "stored session is not JSON"); }
    const rev = JSON.parse(response.headers.get("dropbox-api-result") || "{}").rev || null;
    if (!rev) throw new SessionError(502, "dropbox_failed", "Dropbox download returned no rev");
    return { doc: check(doc), rev };
  }

  // Binary calls for the read-only asset view (session-assets.mjs). They never write, copy, move or share.
  // transport() reads bodies as text, so these go to fetch directly with the same per-request token.
  async function binary(context, url, arg, extraHeaders = {}) {
    let token;
    try { token = await getToken({ env, fetchImpl }); } catch { throw new SessionError(502, "dropbox_auth_failed", "Dropbox token unavailable"); }
    let response;
    try {
      response = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": asciiSafeJson(arg), ...extraHeaders } });
    } catch { throw new SessionError(502, "dropbox_network_failed", `Dropbox ${context} transport failed`); }
    if ([401, 403].includes(response.status)) throw new SessionError(502, "dropbox_auth_failed", `Dropbox ${context} authentication failed (HTTP ${response.status})`);
    if (response.status === 409) return null;
    if (!response.ok && response.status !== 206) throw failed(context, response.status);
    return { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") || "application/octet-stream" };
  }

  // mode: { ".tag": "add" } never overwrites; { ".tag": "update", update: rev } only replaces that rev.
  async function upload(path, doc, mode) {
    const { response, text } = await request("upload", UPLOAD, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": asciiSafeJson({ path, mode, autorename: false, mute: true, strict_conflict: true }) },
      body: Buffer.from(JSON.stringify(doc, null, 2), "utf8")
    });
    if (response.status === 409 && /conflict/.test(text)) return { conflict: true };
    if (!response.ok) throw failed("upload", response.status);
    return { conflict: false, rev: JSON.parse(text).rev };
  }

  return {
    async list({ includeTest = false } = {}) {
      const roots = includeTest ? [SESSION_ROOTS.live, SESSION_ROOTS.test] : [SESSION_ROOTS.live];
      const ids = [];
      for (const root of roots) {
        for (const entry of await listFolder(root)) if (entry[".tag"] === "folder" && SESSION_ID_PATTERN.test(entry.name)) ids.push(entry.name);
      }
      // ponytail: one download per session; add a summary cache when the list passes ~100 sessions.
      const docs = await Promise.all(ids.map(async (id) => (await download(sessionPath(id)))?.doc));
      return docs.filter(Boolean).map(sessionSummary).sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
    },

    // --- read-only Dropbox access for ASSETS (paths are checked by session-assets.mjs) ---
    listFolder,
    headBytes: (path, length = 65536) => binary("download", DOWNLOAD, { path }, { Range: `bytes=0-${length - 1}` }),
    thumbnail: (path) => binary("thumbnail", THUMBNAIL, { resource: { ".tag": "path", path }, format: "jpeg", size: "w640h480", mode: "fitone_bestfit" }),
    async temporaryLink(path) {
      const { response, text } = await request("temporary_link", TEMPORARY_LINK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
      if (notFound(response.status, text)) return null;
      if (!response.ok) throw failed("temporary_link", response.status);
      return JSON.parse(text).link;
    },

    // --- participants.json next to session.json (same add / update-rev rules, never overwritten blindly) ---
    async readParticipants(id) {
      await this.read(id);
      const found = await download(sessionPath(id, "participants.json"), assertParticipants);
      return found || { doc: emptyParticipants(id), rev: null };
    },
    async writeParticipants(id, doc, rev) {
      const result = await upload(sessionPath(id, "participants.json"), doc, rev ? { ".tag": "update", update: rev } : { ".tag": "add" });
      if (result.conflict) throw new SessionError(409, "version_conflict", "participants changed since they were read", { currentVersion: (await this.readParticipants(id)).doc.version });
      return { doc, rev: result.rev };
    },

    async read(id) {
      const found = await download(sessionPath(id));
      if (!found) throw new SessionError(404, "session_not_found");
      return found;
    },

    async create(doc) {
      assertSessionDocument(doc);
      const result = await upload(sessionPath(doc.id), doc, { ".tag": "add" });
      if (result.conflict) throw new SessionError(409, "session_exists", `${doc.id} already exists`);
      return { doc, rev: result.rev };
    },

    // Returns { doc, rev, changed, unchanged }. 409 version_conflict carries currentVersion and, for a
    // live log, whether that run is already stored, so the client never needs a blind resend.
    async update(id, expectedVersion, operations, { actor, now } = {}) {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SessionError(400, "invalid_operation", "version must be a positive integer");
      const { doc, rev } = await this.read(id);
      const conflict = (current) => {
        const runIds = operations.filter((op) => op.type === "save_live_log").map((op) => op.run?.runId);
        const details = { currentVersion: current.version };
        if (runIds.length) details.liveRunSaved = runIds.every((runId) => current.liveLog.runs.some((r) => r.runId === runId));
        return new SessionError(409, "version_conflict", "the session changed since it was read", details);
      };
      if (doc.version !== expectedVersion) throw conflict(doc);
      const result = applyOperations(doc, operations, { actor, now });
      if (result.unchanged) return { doc, rev, changed: [], unchanged: true };
      if (needsSnapshot(operations)) {
        // A conflict means v<n> is already saved (an earlier attempt); version n has one content, so keep it.
        await upload(sessionPath(id, `snapshots/v${doc.version}.json`), doc, { ".tag": "add" });
      }
      const written = await upload(sessionPath(id), result.doc, { ".tag": "update", update: rev });
      if (written.conflict) throw conflict((await this.read(id)).doc);
      return { doc: result.doc, rev: written.rev, changed: result.changed, unchanged: false };
    }
  };
}
