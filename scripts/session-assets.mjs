// SAMPLAS SESSION assets: a read-only view of the design team's Dropbox folder.
//   SESSION_ASSETS_ROOT   the Dropbox folder that holds one folder per session, matched by its number
//                         ("SESSION 001", "SESSION 3", ...). Unset: the view says it is not connected.
// Nothing here writes, copies, moves, deletes or shares: listing, a thumbnail, the first bytes of an image
// (for its pixel size) and Dropbox's 4-hour temporary link for "open original". No shared links are made.
// Every path a browser sends is checked to sit inside that session's folder before Dropbox is asked.
import { SESSION_ROOTS } from "./session-dropbox.mjs";
import { SessionError, SESSION_ID_PATTERN } from "./session-store.mjs";

export const CATEGORIES = ["feed", "story", "carousel", "reels", "recruit", "photo", "sketch", "document", "other", "raw", "work"];
// Not finished content: camera originals and editing project files. Listed, but outside the default content view.
export const SOURCE_CATEGORIES = ["raw", "work"];
export const SPECS = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } };

const IMAGE = /\.(png|jpe?g|webp|gif|heic)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const DOCUMENT = /\.(pdf|docx?|pptx?|key|hwp|txt)$/i;
// Never listed: OS files and render caches (audio/video previews).
const SKIP_FILE = /(^\.|\.(prv|pek|cfa|ds_store|tmp|lnk)$)/i;
const SKIP_FOLDER = /(^|\/)(adobe premiere pro (audio previews|video previews)|__macosx)(\/|$)/i;
// Editing work files: projects, auto-saves, layered sources, Premiere Composer media.
const WORK_FILE = /\.(prproj|prin|aep|psd|ai|indd)$/i;
const WORK_FOLDER = /(^|\/)(adobe premiere pro auto-save|premiere composer files)(\/|$)/i;
// Camera originals: a clips/originals folder, or camera file names (IMG_1234.MOV, C0797.MP4, DJI_0001.MP4).
const RAW_FOLDER = /(^|\/)(클립|원본|촬영\s*원본|clips?|raw|footage)(\/|$)/i;
const RAW_NAME = /^(img_\d+|c\d{4}|dji_\d+|mvi_\d+|dsc_?\d+|gopr\d+)\.(mov|mp4|m4v)$/i;

const sessionNumber = (id) => (SESSION_ID_PATTERN.test(String(id)) && !id.startsWith("test-") ? Number(id.split("-").pop()) : null);
const folderNumber = (name) => { const m = /^session\s*0*(\d{1,4})(\D|$)/i.exec(name.trim()); return m ? Number(m[1]) : null; };

// Pixel size from the first bytes of a PNG or JPEG (null when not found there).
export function imageSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at++; continue; }
      const marker = bytes[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

// Folder and file names decide the category first; pixel ratio decides feed vs story for the rest.
export function classify({ path, kind, size }) {
  const p = path.toLowerCase();
  const name = p.split("/").pop();
  if (WORK_FILE.test(name) || WORK_FOLDER.test(p)) return "work";
  if (kind === "video" && (RAW_FOLDER.test(p.slice(0, -name.length)) || RAW_NAME.test(name))) return "raw";
  if (/스케치|sketch/.test(p)) return "sketch";
  if (/모집|참가\s*신청|신청\s*안내|recruit/.test(p)) return "recruit";
  if (/캐러셀|carousel/.test(p)) return "carousel";
  if (kind === "document") return "document"; // planning drafts, cue sheets, guides (shown as 기타 · 기획 문서)
  if (kind === "video") return "reels";
  if (/현장|사진|photo/.test(p) && kind === "image") return "photo";
  if (kind === "image") {
    if (/스토리|story/.test(p)) return "story";
    if (/피드|feed/.test(p)) return "feed";
    if (size) {
      const ratio = size.height / size.width;
      if (Math.abs(ratio - 16 / 9) < 0.03) return "story";
      if (Math.abs(ratio - 5 / 4) < 0.03 || Math.abs(ratio - 1) < 0.03) return "feed";
    }
  }
  return "other";
}

const kindOf = (name) => (IMAGE.test(name) ? "image" : VIDEO.test(name) ? "video" : DOCUMENT.test(name) ? "document" : "file");
const specFor = (category, size) => {
  const want = SPECS[category];
  if (!want) return null;
  return { ...want, matches: Boolean(size && size.width === want.width && size.height === want.height) };
};

export function createAssetService(store, { env = process.env } = {}) {
  const root = String(env.SESSION_ASSETS_ROOT || "").replace(/\/+$/, "");
  const sizes = new Map(); // content_hash -> {width, height} | null  (ponytail: per-process cache; files rarely change)

  async function sessionFolder(id) {
    if (SESSION_ID_PATTERN.test(String(id)) && String(id).startsWith("test-")) return `${SESSION_ROOTS.test}/${id}/files`;
    const number = sessionNumber(id);
    if (number === null) throw new SessionError(400, "invalid_session_id");
    if (!root.startsWith("/")) throw new SessionError(503, "assets_not_configured", "SESSION_ASSETS_ROOT is not set");
    const folders = (await store.listFolder(root)).filter((e) => e[".tag"] === "folder" && folderNumber(e.name) === number);
    return folders.length ? (folders[0].path_display || `${root}/${folders[0].name}`) : null;
  }

  // A browser-supplied path is used only when it is a plain path strictly inside the session folder.
  async function checkedPath(id, path) {
    const folder = await sessionFolder(id);
    const value = String(path || "");
    if (!folder || !value.startsWith("/") || value.length > 1000 || /(^|\/)\.\.?(\/|$)|[\u0000-\u001f\\]/.test(value) ||
        !value.toLowerCase().startsWith(`${folder.toLowerCase()}/`)) throw new SessionError(404, "asset_not_found");
    return value;
  }

  return {
    root,
    async list(id) {
      const folder = await sessionFolder(id);
      if (!folder) return { sessionId: id, folder: null, assets: [], counts: {} };
      const entries = (await store.listFolder(folder, { recursive: true }))
        .filter((e) => e[".tag"] === "file" && !SKIP_FILE.test(e.name) && !SKIP_FOLDER.test(e.path_display || e.name));
      const assets = [];
      for (const e of entries) {
        const path = e.path_display || `${folder}/${e.name}`;
        const kind = kindOf(e.name);
        let size = null;
        if (kind === "image" && /\.(png|jpe?g)$/i.test(e.name)) {
          const key = e.content_hash || `${path}:${e.rev || e.size}`;
          if (!sizes.has(key)) sizes.set(key, imageSize((await store.headBytes(path))?.bytes));
          size = sizes.get(key);
        }
        const category = classify({ path: path.slice(folder.length), kind, size });
        assets.push({ path, name: e.name, folder: path.slice(folder.length + 1, -e.name.length - 1) || "", kind, category,
          width: size?.width ?? null, height: size?.height ?? null, spec: specFor(category, size), bytes: e.size ?? null, modifiedAt: e.server_modified || null,
          // Dropbox makes thumbnails for images only; videos and documents show an icon instead.
          thumbnail: kind === "image" && category !== "work" });
      }
      // Carousel slides keep their file-name order (01, 02, ...); everything else newest first.
      const natural = new Intl.Collator("ko", { numeric: true });
      assets.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
        (a.category === "carousel" ? natural.compare(a.path, b.path) : String(b.modifiedAt).localeCompare(String(a.modifiedAt)) || natural.compare(a.path, b.path)));
      let slide = 0;
      for (const a of assets) if (a.category === "carousel") a.order = ++slide;
      const counts = Object.fromEntries(CATEGORIES.map((c) => [c, assets.filter((a) => a.category === c).length]));
      return { sessionId: id, folder, assets, counts };
    },
    async thumbnail(id, path) {
      const found = await store.thumbnail(await checkedPath(id, path));
      if (!found) throw new SessionError(404, "thumbnail_unavailable");
      return found;
    },
    async link(id, path) {
      const link = await store.temporaryLink(await checkedPath(id, path));
      if (!link) throw new SessionError(404, "asset_not_found");
      return { link, expiresInSeconds: 4 * 3600 };
    }
  };
}
