// In-memory Dropbox for SESSION DIRECTOR tests: list_folder (with continue), download (rev header)
// and upload with add/update modes and strict rev conflicts. No network.
export function createFakeDropbox() {
  const files = new Map(); // path -> { text, rev }
  const calls = [];
  let revCounter = 0;
  const reply = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  const conflict = (tag) => reply(409, { error_summary: `path/${tag}/`, error: { ".tag": "path", reason: { ".tag": tag }, path: { ".tag": tag } } });

  async function fetchImpl(url, init = {}) {
    const arg = init.headers?.["Dropbox-API-Arg"] ? JSON.parse(init.headers["Dropbox-API-Arg"]) : null;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, arg, body });
    if (url.endsWith("/files/list_folder")) {
      const prefix = `${body.path}/`;
      const names = [...new Set([...files.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]))];
      if (!names.length) return reply(409, { error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } });
      return reply(200, { entries: names.map((name) => ({ ".tag": "folder", name })), has_more: false });
    }
    if (url.endsWith("/files/download")) {
      const file = files.get(arg.path);
      if (!file) return reply(409, { error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } });
      return reply(200, file.text, { "dropbox-api-result": JSON.stringify({ rev: file.rev }) });
    }
    if (url.endsWith("/files/upload")) {
      const existing = files.get(arg.path);
      if (arg.mode[".tag"] === "add" && existing) return conflict("conflict");
      if (arg.mode[".tag"] === "update" && (!existing || existing.rev !== arg.mode.update)) return conflict("conflict");
      const rev = `rev${++revCounter}`;
      files.set(arg.path, { text: Buffer.from(init.body).toString("utf8"), rev });
      return reply(200, { rev, path_display: arg.path });
    }
    throw new Error(`unexpected Dropbox call ${url}`);
  }
  return {
    fetchImpl, files, calls,
    getToken: async () => "fake-token",
    json: (path) => JSON.parse(files.get(path).text),
    // Simulates another writer landing between our read and our upload.
    touch(path, mutate) { const doc = JSON.parse(files.get(path).text); mutate(doc); files.set(path, { text: JSON.stringify(doc), rev: `rev${++revCounter}` }); }
  };
}
