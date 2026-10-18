// POPUP DIRECTOR project service for the ChatGPT MCP: create, read, partial update, archive,
// trash, remove and restore popup projects stored as PROJECTS/<name>/popup.json in Dropbox.
//
// Safety rules (same store the local app and the VIEW-ONLY web app read):
// - Every write is a compare-and-swap: the caller's expectedVersion must equal popup.json.version and
//   the upload is pinned to the Dropbox rev that was read (a concurrent writer gets a 409, never lost).
// - Every write is read back before it is reported as saved. A write whose response was lost is
//   settled by reading again and looking for its opId in changeLog; it is never retried blindly.
// - No Dropbox file is ever deleted. "Remove" moves the project folder to _DELETED/PROJECTS and
//   restore moves it back; asset/report links only change popup.json.
import { getDropboxAccessToken, asciiSafeJson } from "./dropbox-report-uploader.mjs";
import { POPUP_PROJECTS_DROPBOX_PATH, listPopupProjectFolders, downloadPopupJsonWithRev, uploadPopupJson } from "./popup-dropbox-store.mjs";
import { randomUUID } from "node:crypto";
import { PopupError, PROJECT_SUBFOLDERS, newProject, applyChanges, appendChangeLog, projectSummary, redactProject, kstToday,
  validateProjectName, sameName, effectiveStatus } from "./popup-projects.mjs";

const API = "https://api.dropboxapi.com/2/files/";
const REMOVED_ROOT = POPUP_PROJECTS_DROPBOX_PATH.replace(/\/PROJECTS$/, "/_DELETED/PROJECTS");
const OP_ID = /^[A-Za-z0-9_.:-]{8,80}$/;
const WEB_APP = "https://samplas-popup-director.vercel.app/";

const canonical = (value) => JSON.stringify(value, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export function createPopupService({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  async function call(accessToken, endpoint, body) {
    const response = await fetchImpl(API + endpoint, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* error bodies may be plain text */ }
    return { ok: response.ok, status: response.status, json, summary: String(json?.error_summary || text).slice(0, 200) };
  }
  const conflictLike = (r) => r.status === 409 && /conflict/.test(r.summary);

  async function folders() {
    const { accessToken, folders: list } = await listPopupProjectFolders({ env, fetchImpl });
    return { accessToken, folders: list };
  }
  async function readAll() {
    const { accessToken, folders: list } = await folders();
    const items = [];
    for (const folder of list) {
      const { project, rev } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl }).catch(() => ({ project: null, rev: null }));
      items.push({ folder, project, rev });
    }
    return { accessToken, items };
  }
  // A project is named by its folder name or by its popup.json id.
  async function resolve(ref) {
    if (typeof ref !== "string" || !ref.trim()) throw new PopupError(400, "invalid_arguments", "name (project name or id) is required");
    const { accessToken, folders: list } = await folders();
    const byName = list.find((f) => sameName(f.name, ref));
    if (byName) {
      const { project, rev } = await downloadPopupJsonWithRev(byName, { accessToken, fetchImpl });
      if (!project) throw new PopupError(404, "no_data", `PROJECTS/${byName.name} has no popup.json`);
      return { accessToken, folder: byName, project, rev };
    }
    for (const folder of list) {
      const { project, rev } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl }).catch(() => ({ project: null }));
      if (project?.id && project.id === ref.trim()) return { accessToken, folder, project, rev };
    }
    throw new PopupError(404, "project_not_found", `No popup project named or with id "${ref}". Use listPopupProjects.`);
  }

  const view = (folder, project) => ({ ...redactProject(project), ...effectiveStatus(project, kstToday(now())),
    storage: { folder: `PROJECTS/${folder.name}`, removed: false }, webUrl: `${WEB_APP}?project=${encodeURIComponent(project.name ?? folder.name)}` });

  async function readBack(folder, accessToken, expected) {
    const { project } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl });
    if (!project || canonical(project) !== canonical(expected)) {
      throw new PopupError(502, "write_unverified", "The save could not be confirmed by reading it back. Read the project again before doing anything else.", { currentVersion: project?.version ?? null });
    }
    return project;
  }

  // The single write path: read with rev, check version, change a copy, upload pinned to the rev, read back.
  async function mutate(ref, expectedVersion, { actor, opId, op, change, folderMove }) {
    if (opId !== undefined && !OP_ID.test(opId)) throw new PopupError(400, "invalid_arguments", "opId must be 8-80 letters, digits, _ . : -");
    if (!Number.isInteger(expectedVersion)) throw new PopupError(400, "invalid_arguments", "expectedVersion (integer, from getPopupProject) is required");
    const id = opId || randomUUID();
    let { accessToken, folder, project, rev } = await resolve(ref);
    const replay = opId && (project.changeLog || []).find((e) => e.opId === opId);
    if (replay) return { replayed: true, changed: replay.changes || [], project: view(folder, project), version: project.version };
    if (project.version !== expectedVersion) {
      throw new PopupError(409, "version_conflict", `The project is now version ${project.version}, not ${expectedVersion}. Read it again, show the user what changed, and ask before retrying.`, { currentVersion: project.version ?? null });
    }
    const next = structuredClone(project);
    const changes = change(next);
    if (!changes.length) return { unchanged: true, changed: [], project: view(folder, project), version: project.version };
    next.version = (project.version || 0) + 1;
    next.updatedAt = now().toISOString();
    appendChangeLog(next, { at: next.updatedAt, by: actor, op, changes: changes.slice(0, 30), opId: id, version: next.version });

    const original = folder;
    if (folderMove) folder = await folderMove(accessToken, folder, next);
    // A failed save after a rename moves the folder back so name and folder never drift apart.
    const undoMove = async () => {
      if (folder === original) return;
      const back = await call(accessToken, "move_v2", { from_path: folder.pathDisplay, to_path: original.pathDisplay, autorename: false });
      if (!back.ok) throw new PopupError(502, "rename_rollback_failed", `The save failed and the folder could not be renamed back from PROJECTS/${folder.name}. Read the project list before doing anything else.`);
    };
    let result;
    try {
      result = await uploadPopupJson(folder, next, { accessToken, fetchImpl, rev });
    } catch {
      // The response was lost: settle it from the stored file, never by sending it again.
      const { project: latest } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl }).catch(() => ({ project: null }));
      if (latest?.changeLog?.some((e) => e.opId === id)) return { changed: changes, project: view(folder, latest), version: latest.version, verified: true };
      await undoMove();
      throw new PopupError(502, "write_unconfirmed", "Dropbox did not confirm the save and it is not in the stored project. Nothing is reported as saved; read the project again before retrying.");
    }
    if (result.conflict) {
      await undoMove();
      const { project: latest } = await downloadPopupJsonWithRev(original, { accessToken, fetchImpl }).catch(() => ({ project: null }));
      throw new PopupError(409, "version_conflict", "Someone else saved this project at the same time. Read it again and ask the user before retrying.", { currentVersion: latest?.version ?? null });
    }
    const saved = await readBack(folder, accessToken, next);
    return { changed: changes, project: view(folder, saved), version: saved.version, verified: true };
  }

  async function removedFolders(accessToken) {
    const r = await call(accessToken, "list_folder", { path: REMOVED_ROOT });
    if (!r.ok) { if (r.status === 409 && /not_found/.test(r.summary)) return []; throw new PopupError(502, "dropbox_error", "Could not list removed projects"); }
    return (r.json.entries || []).filter((e) => e[".tag"] === "folder").map((e) => ({ name: e.name, pathDisplay: e.path_display }));
  }

  return {
    async list({ status, includeDeleted = false, includeRemoved = false } = {}) {
      const today = kstToday(now());
      const { accessToken, items } = await readAll();
      let projects = items.map(({ folder, project }) => (project ? projectSummary(project, { folderName: folder.name, today }) : { name: folder.name, folder: folder.name, hasData: false }));
      if (!includeDeleted) projects = projects.filter((p) => !p.deleted);
      if (status) projects = projects.filter((p) => p.status === status);
      const result = { projects };
      if (includeRemoved) {
        result.removed = [];
        for (const folder of await removedFolders(accessToken)) {
          const { project } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl }).catch(() => ({ project: null }));
          result.removed.push({ removedFolder: folder.name, name: project?.name ?? null, id: project?.id ?? null, removedAt: project?.removed?.at ?? null, version: project?.version ?? null });
        }
      }
      return result;
    },

    async get(ref, { includeFiles = true } = {}) {
      const { accessToken, folder, project } = await resolve(ref);
      const out = view(folder, project);
      if (includeFiles) {
        const r = await call(accessToken, "list_folder", { path: folder.pathDisplay, recursive: true, limit: 500 });
        out.storage.files = r.ok ? (r.json.entries || []).filter((e) => e[".tag"] === "file" && !e.name.startsWith(".") && e.name !== "popup.json")
          .map((e) => ({ path: e.path_display.slice(folder.pathDisplay.length + 1), size: e.size })).slice(0, 300) : null;
        out.storage.filesTruncated = r.ok ? Boolean(r.json.has_more) : null;
      }
      return out;
    },

    async create(args, { actor }) {
      if (args.opId !== undefined && !OP_ID.test(args.opId)) throw new PopupError(400, "invalid_arguments", "opId must be 8-80 letters, digits, _ . : -");
      const opId = args.opId || randomUUID();
      const project = newProject(args, { now: now(), actor, opId });
      const { accessToken, items } = await readAll();
      const same = items.find(({ folder, project: p }) => sameName(folder.name, project.name) || sameName(p?.name, project.name));
      if (same) {
        if (args.opId && same.project?.changeLog?.some((e) => e.opId === args.opId)) return { replayed: true, project: view(same.folder, same.project) };
        throw new PopupError(409, "already_exists", `A popup project named "${same.folder.name}" already exists; nothing was created. Use getPopupProject / updatePopupProject.`, { existing: { name: same.folder.name, id: same.project?.id ?? null, version: same.project?.version ?? null } });
      }
      const path = `${POPUP_PROJECTS_DROPBOX_PATH}/${project.name}`;
      const made = await call(accessToken, "create_folder_v2", { path, autorename: false });
      if (!made.ok) {
        if (conflictLike(made)) throw new PopupError(409, "already_exists", `PROJECTS/${project.name} already exists; nothing was created.`);
        throw new PopupError(502, "dropbox_error", "Could not create the project folder; nothing was created.");
      }
      const folder = { name: made.json.metadata.name, pathDisplay: made.json.metadata.path_display };
      for (const sub of PROJECT_SUBFOLDERS) {
        const r = await call(accessToken, "create_folder_v2", { path: `${folder.pathDisplay}/${sub}`, autorename: false });
        if (!r.ok && !conflictLike(r)) throw new PopupError(502, "dropbox_error", `Created PROJECTS/${folder.name} but not ${sub}; read the project before retrying.`);
      }
      let result;
      try { result = await uploadPopupJson(folder, project, { accessToken, fetchImpl, rev: null }); }
      catch { result = null; }
      if (!result || result.conflict) {
        const { project: stored } = await downloadPopupJsonWithRev(folder, { accessToken, fetchImpl }).catch(() => ({ project: null }));
        if (stored?.changeLog?.some((e) => e.opId === opId)) return { project: view(folder, stored), verified: true };
        throw new PopupError(502, "write_unconfirmed", `The folder PROJECTS/${folder.name} exists but popup.json was not confirmed. Read the project before retrying.`);
      }
      return { project: view(folder, await readBack(folder, accessToken, project)), verified: true };
    },

    update(ref, expectedVersion, { patch, operations }, { actor, opId }) {
      return mutate(ref, expectedVersion, { actor, opId, op: "update",
        change: (p) => applyChanges(p, { patch, operations }, { now: now(), actor }),
        // A rename moves PROJECTS/<old> to PROJECTS/<new> first so folder name and project name stay equal.
        folderMove: patch?.name !== undefined ? async (accessToken, folder, next) => {
          const name = validateProjectName(patch.name);
          if (name === folder.name) return folder;
          const { folders: list } = await folders();
          if (list.some((f) => f !== folder && f.name !== folder.name && sameName(f.name, name))) throw new PopupError(409, "already_exists", `A project named "${name}" already exists.`);
          const moved = await call(accessToken, "move_v2", { from_path: folder.pathDisplay, to_path: `${POPUP_PROJECTS_DROPBOX_PATH}/${name}`, autorename: false });
          if (!moved.ok) throw new PopupError(conflictLike(moved) ? 409 : 502, conflictLike(moved) ? "already_exists" : "dropbox_error", "Could not rename the project folder; nothing was changed.");
          next.name = name;
          return { name: moved.json.metadata.name, pathDisplay: moved.json.metadata.path_display };
        } : undefined });
    },

    // Old contract kept for the existing tool: the whole name/tasks/assets/notes from a GET, plus expectedVersion.
    // Only those keys (and start/end) are taken, so redacted or unrelated data can never be wiped through it.
    legacyUpdate(name, body, { actor }) {
      const project = body?.project;
      if (!project || typeof project !== "object" || !["tasks", "assets", "notes"].every((k) => Array.isArray(project[k]))) {
        throw new PopupError(400, "invalid_arguments", "body.project with tasks, assets and notes arrays is required");
      }
      if (typeof project.name !== "string" || !sameName(project.name, name)) throw new PopupError(400, "invalid_arguments", "body.project.name must equal name (use patch.name to rename)");
      return mutate(name, body.expectedVersion, { actor, op: "update_full_lists", change: (p) => {
        const changes = [];
        for (const key of ["tasks", "assets", "notes", "start", "end"]) {
          if (project[key] === undefined || canonical(project[key]) === canonical(p[key])) continue;
          p[key] = structuredClone(project[key]);
          changes.push(`${key} replaced`);
        }
        return changes;
      } });
    },

    // mode "trash": hidden from the default list, everything kept; "remove": folder moved to _DELETED/PROJECTS.
    async delete(ref, expectedVersion, { mode = "trash", confirmName }, { actor, opId }) {
      if (!["trash", "remove"].includes(mode)) throw new PopupError(400, "invalid_arguments", "mode must be trash or remove");
      if (mode === "trash") {
        return mutate(ref, expectedVersion, { actor, opId, op: "trash", change: (p) => {
          if (p.deleted) return [];
          p.deleted = { at: now().toISOString(), by: actor };
          return ["project moved to trash"];
        } });
      }
      const { project } = await resolve(ref);
      if (typeof confirmName !== "string" || confirmName.normalize("NFC") !== String(project.name).normalize("NFC")) {
        throw new PopupError(400, "confirmation_required", `Type the exact project name "${project.name}" as confirmName after the user approves removing the whole folder.`);
      }
      if (!project.deleted) throw new PopupError(409, "trash_first", "Move the project to trash first (mode trash), then remove it.");
      const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "Z");
      const target = `${REMOVED_ROOT}/${project.name}__${stamp}`;
      // Save the removed marker first (still in PROJECTS), then move; a failed move leaves a trashed, intact project.
      return mutate(ref, expectedVersion, { actor, opId, op: "remove",
        change: (p) => { p.removed = { at: now().toISOString(), by: actor, from: `PROJECTS/${p.name}` }; return ["project folder moved to _DELETED/PROJECTS"]; } }).then(async (result) => {
        const { accessToken, folder } = await resolve(project.id || ref);
        const moved = await call(accessToken, "move_v2", { from_path: folder.pathDisplay, to_path: target, autorename: false });
        if (!moved.ok) throw new PopupError(502, "dropbox_error", "Saved the removal marker but could not move the folder; the project is still in trash and intact.");
        return { ...result, project: undefined, removedFolder: moved.json.metadata.name, removedPath: `_DELETED/PROJECTS/${moved.json.metadata.name}` };
      });
    },

    // Restores a removed folder, a trashed project or an archived project (in that order of what applies).
    async restore(ref, expectedVersion, { actor, opId }) {
      const { accessToken, folders: list } = await folders();
      const removed = await removedFolders(accessToken);
      const baseName = (n) => (n.includes("__") ? n.slice(0, n.lastIndexOf("__")) : n);
      const hit = removed.filter((f) => sameName(f.name, ref) || sameName(baseName(f.name), ref));
      if (!list.some((f) => sameName(f.name, ref)) && hit.length) {
        const folder = hit.sort((a, b) => b.name.localeCompare(a.name))[0];
        const name = baseName(folder.name);
        if (list.some((f) => sameName(f.name, name))) throw new PopupError(409, "already_exists", `PROJECTS/${name} exists again; rename it before restoring.`);
        const moved = await call(accessToken, "move_v2", { from_path: folder.pathDisplay, to_path: `${POPUP_PROJECTS_DROPBOX_PATH}/${name}`, autorename: false });
        if (!moved.ok) throw new PopupError(502, "dropbox_error", "Could not move the folder back; nothing was changed.");
        const { project } = await resolve(name);
        return mutate(name, project.version, { actor, opId, op: "restore", change: (p) => { delete p.removed; delete p.deleted; return ["project folder restored from _DELETED/PROJECTS"]; } });
      }
      return mutate(ref, expectedVersion, { actor, opId, op: "restore", change: (p) => {
        const changes = [];
        if (p.deleted) { delete p.deleted; changes.push("restored from trash"); }
        if (p.status === "ARCHIVED") { p.status = p.statusBeforeArchive || "PLANNING"; delete p.statusBeforeArchive; changes.push(`status: ARCHIVED → ${p.status}`); }
        return changes;
      } });
    },

    async history(ref) {
      const { project } = await resolve(ref);
      return { name: project.name, version: project.version, changeLog: (project.changeLog || []).slice(-50) };
    }
  };
}
