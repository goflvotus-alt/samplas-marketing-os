// Local development only: a directory that answers the Dropbox calls session-dropbox.mjs makes
// (list_folder incl. recursive, download incl. Range, upload with add/update rev modes, and for the
// asset view get_thumbnail_v2 / get_temporary_link), so the full API can run without touching the
// real Dropbox. Enabled by SESSION_LOCAL_STORE_DIR and refused on Render.
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
      const { path, recursive } = JSON.parse(init.body);
      const entries = [];
      const walk = (dir) => {
        let names;
        try { names = readdirSync(fileFor(dir)); } catch { return false; }
        for (const name of names.filter((n) => !n.startsWith("."))) {
          const stat = statSync(join(fileFor(dir), name));
          const display = `${dir.replace(/\/+$/, "")}/${name}`;
          entries.push(stat.isDirectory() ? { ".tag": "folder", name, path_display: display }
            : { ".tag": "file", name, path_display: display, size: stat.size, server_modified: stat.mtime.toISOString().replace(/\.\d+Z$/, "Z"), content_hash: revOf(readFileSync(join(fileFor(dir), name))) });
          if (recursive && stat.isDirectory()) walk(display);
        }
        return true;
      };
      return walk(path) ? reply(200, { has_more: false, entries }) : notFound();
    }
    if (url.endsWith("/files/download")) {
      const bytes = read(arg.path);
      if (!bytes) return notFound();
      const range = /^bytes=0-(\d+)$/.exec(init.headers?.Range || "");
      return range ? new Response(bytes.subarray(0, Number(range[1]) + 1), { status: 206 })
        : reply(200, bytes.toString("utf8"), { "dropbox-api-result": JSON.stringify({ rev: revOf(bytes) }) });
    }
    if (url.endsWith("/files/get_thumbnail_v2")) {
      // Stands in for a real thumbnail with the image itself; videos and documents have none here.
      const path = arg.resource.path;
      const bytes = /\.(png|jpe?g)$/i.test(path) ? read(path) : null;
      return bytes ? new Response(bytes, { status: 200, headers: { "content-type": /\.png$/i.test(path) ? "image/png" : "image/jpeg" } }) : notFound();
    }
    if (url.endsWith("/files/get_temporary_link")) {
      const { path } = JSON.parse(init.body);
      return read(path) ? reply(200, { link: `https://dropbox.local.test/temporary${encodeURI(path)}` }) : notFound();
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
