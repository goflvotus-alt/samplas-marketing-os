// Local development only: a directory that answers the four Dropbox calls session-dropbox.mjs makes
// (list_folder, download, upload with add/update rev modes), so the full API can run without
// touching the real Dropbox. Enabled by SESSION_LOCAL_STORE_DIR and refused on Render.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function localStoreAllowed(env) {
  return Boolean(env.SESSION_LOCAL_STORE_DIR) && !env.RENDER && !env.RENDER_SERVICE_ID;
}

export function createLocalDropboxFetch(root) {
  const fileFor = (path) => join(root, path.replace(/^\/+/, ""));
  const revOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const reply = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  const notFound = () => reply(409, { error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } });
  const read = (path) => { try { return readFileSync(fileFor(path)); } catch { return null; } };
  return async function localFetch(url, init = {}) {
    const arg = init.headers?.["Dropbox-API-Arg"] ? JSON.parse(init.headers["Dropbox-API-Arg"]) : null;
    if (url.endsWith("/files/list_folder")) {
      const { path } = JSON.parse(init.body);
      let names;
      try { names = readdirSync(fileFor(path)); } catch { return notFound(); }
      return reply(200, { has_more: false, entries: names.filter((n) => !n.startsWith(".")).map((name) => ({ ".tag": statSync(join(fileFor(path), name)).isDirectory() ? "folder" : "file", name })) });
    }
    if (url.endsWith("/files/download")) {
      const bytes = read(arg.path);
      return bytes ? reply(200, bytes.toString("utf8"), { "dropbox-api-result": JSON.stringify({ rev: revOf(bytes) }) }) : notFound();
    }
    if (url.endsWith("/files/upload")) {
      const existing = read(arg.path);
      const conflict = arg.mode[".tag"] === "add" ? Boolean(existing) : !existing || revOf(existing) !== arg.mode.update;
      if (conflict) return reply(409, { error_summary: "path/conflict/file/", error: { ".tag": "path", reason: { ".tag": "conflict" } } });
      const bytes = Buffer.from(init.body);
      mkdirSync(dirname(fileFor(arg.path)), { recursive: true });
      writeFileSync(fileFor(arg.path), bytes);
      return reply(200, { rev: revOf(bytes) });
    }
    throw new Error(`local Dropbox: unsupported call ${url}`);
  };
}
