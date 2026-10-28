// Feed post -> product tags pipeline for @samplaskr posts scheduled on Instagram web.
// Publishing and the READY -> UPLOADED move belong to the upload automation (separate session).
// This runner never publishes, re-posts, deletes, moves folders or connects to Chrome.
//
// One record per registered post, kept in the runner's own state store (never in the feed folders):
//   publish:     SCHEDULED | NOT_FOUND | MISMATCH | PUBLISHED (Graph read of the @samplaskr feed)
//   tags:        TAG_STATES of instagram-product-tags.mjs, plus NO_TAGS (product-tags.json lists no tags)
//   moveAdvice:  HELD | READY_TO_MOVE, status only; the upload side decides and moves on its own
// Order per run: find the published media -> locate the folder (READY, else UPLOADED/<stamp> <folder>) and
// read manifest.json + product-tags.json (read only) -> buildTagPlan -> applyTagPlan (gated) -> verifyTagPlan.
// A folder that is not found (mid-move) keeps the post PENDING for the next run; a tag problem never
// touches the publish state. Anything unclear holds the post: missing mapping is TAG_REVIEW_REQUIRED, never a guess.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asciiSafeJson } from "./dropbox-report-uploader.mjs";
import { applyTagPlan, buildTagPlan, SAMPLAS_META, validateMapping, verifyTagPlan } from "./instagram-product-tags.mjs";

export const FEED_DIR_DEFAULT = "/SAMPLAS WORK/병구 작업/피드 자동화";
// A run that sent tags counts once; after this many the post waits for a person.
export const MAX_WRITE_RUNS = 3;
// The feed read covers the newest posts only; a post this old is no longer looked for.
const RECENT_MEDIA_LIMIT = "25";
const SLOT_EARLY_MS = 5 * 60 * 1000;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const list = (v) => (Array.isArray(v) ? v : []);
export const captionSha256 = (caption) => createHash("sha256").update(String(caption ?? "").normalize("NFC").replace(/\r\n/g, "\n").trim()).digest("hex");
export const isFeedFolderName = (name) => FOLDER_RE.test(String(name || "")) && !String(name).includes("..");

// What the upload side registers once the post is scheduled. Approval is per post and defaults to off.
export function newPostRecord({ folderName, slotIso, caption, captionSha256: sha, slideCount, acceptUnverifiedVariantApproval = false }) {
  const problems = [];
  if (!isFeedFolderName(folderName)) problems.push("folder_name");
  if (!Number.isFinite(Date.parse(slotIso))) problems.push("slot_iso");
  const hash = sha ? String(sha).toLowerCase() : caption ? captionSha256(caption) : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) problems.push("caption_sha256");
  if (!Number.isInteger(slideCount) || slideCount < 1 || slideCount > 20) problems.push("slide_count");
  if (problems.length) return { ok: false, problems };
  return { ok: true, record: { schemaVersion: 1, folderName, slotIso: new Date(slotIso).toISOString(), captionSha256: hash, slideCount,
    approvals: { acceptUnverifiedVariantApproval: acceptUnverifiedVariantApproval === true },
    publish: { state: "SCHEDULED" }, tags: { state: "PENDING", writeRuns: 0 }, moveAdvice: { state: "HELD" } } };
}

// Publish check, ported from the verify-feed-post prototype used for the 10/27-28 scheduled posts:
// account is @samplaskr, exactly one recent post has the caption hash, it went live at or after the
// slot, and its slide count matches. Before the slot a miss is SCHEDULED, after it NOT_FOUND.
export async function findPublishedMedia(graph, record, { now = Date.now(), expected = SAMPLAS_META } = {}) {
  const account = await graph.get(expected.igUserId, { fields: "id,username" });
  if (String(account.id) !== expected.igUserId || account.username !== expected.username) return { state: "MISMATCH", reason: "wrong_account" };
  const media = list((await graph.get(`${expected.igUserId}/media`, { fields: "id,caption,timestamp,permalink,media_type,children{id}", limit: RECENT_MEDIA_LIMIT })).data);
  const hits = media.filter((m) => captionSha256(m.caption) === record.captionSha256);
  const slot = Date.parse(record.slotIso);
  if (!hits.length) return { state: now < slot ? "SCHEDULED" : "NOT_FOUND" };
  if (hits.length > 1) return { state: "MISMATCH", reason: "duplicate_caption", permalinks: hits.map((h) => h.permalink) };
  const m = hits[0];
  const slides = m.media_type === "CAROUSEL_ALBUM" ? list(m.children?.data).length : m.media_type === "IMAGE" ? 1 : 0;
  const found = { mediaId: String(m.id), permalink: m.permalink, timestamp: m.timestamp };
  if (!(Date.parse(m.timestamp) >= slot - SLOT_EARLY_MS)) return { state: "MISMATCH", reason: "published_before_slot", ...found };
  if (slides !== record.slideCount) return { state: "MISMATCH", reason: `slide_count:${slides}!=${record.slideCount}`, ...found };
  return { state: "PUBLISHED", ...found };
}

// What the record keeps of a plan: per tag only its slide, product and state.
// applyTagPlan can move tags to review without changing plan.state, so a review tag decides the state.
const summarize = (plan) => {
  const tags = (plan.slides || []).flatMap((s) => s.tags.map((t) => ({ order: s.order, productNo: t.productNo ?? null, productId: t.productId ?? null, state: t.state, reason: t.reason ?? null, approval: t.approval ?? null })));
  return { state: tags.some((t) => t.state === "TAG_REVIEW_REQUIRED") ? "TAG_REVIEW_REQUIRED" : plan.state, reason: plan.reason ?? null, tags };
};

export const TAGS_DONE = ["TAG_VERIFIED", "NO_TAGS"];

// Status only, read by the upload side: tagging is finished once publishing is confirmed and the tags are
// verified (or the mapping says there are none). The runner itself never moves a folder.
export function decideMove(record) {
  if (record.publish?.state !== "PUBLISHED") return { state: "HELD", reason: `publish:${record.publish?.state}` };
  if (!TAGS_DONE.includes(record.tags?.state)) return { state: "HELD", reason: `tags:${record.tags?.state}` };
  return { state: "READY_TO_MOVE" };
}

const running = new Set();

// readFolder(folderName) -> { state: "FOUND", path, manifest, mapping } (null for a missing file),
// { state: "NOT_FOUND" } or { state: "AMBIGUOUS", paths }. Writes need record.approvals.acceptUnverifiedVariantApproval,
// write:true and INSTAGRAM_PRODUCT_TAG_WRITES=on.
export async function runTagJob({ record, graph, readFolder, getCafe24Product, write = false, env = process.env, now = Date.now(), expected = SAMPLAS_META }) {
  const rec = structuredClone(record);
  if (rec.publish?.state === "PUBLISHED" && TAGS_DONE.includes(rec.tags?.state)) return { record: rec, step: "done" };
  if (running.has(rec.folderName)) return { record: rec, step: "already_running" };
  running.add(rec.folderName);
  try {
    const at = new Date(now).toISOString();
    if (rec.publish?.state !== "PUBLISHED") {
      rec.publish = { ...(await findPublishedMedia(graph, rec, { now, expected })), checkedAt: at };
      if (rec.publish.state !== "PUBLISHED") return { record: rec, step: "publish" };
    }
    const folder = await readFolder(rec.folderName);
    rec.folder = { state: folder.state, path: folder.path ?? null, ...(folder.paths ? { paths: folder.paths } : {}), checkedAt: at };
    if (folder.state === "NOT_FOUND") {
      // Mid-move or not synced yet: not a tag failure. The next run looks again.
      rec.tags = { ...rec.tags, reason: "folder_not_found", checkedAt: at };
      rec.moveAdvice = decideMove(rec);
      return { record: rec, step: "folder" };
    }
    const { manifest, mapping } = folder;
    const tagCount = list(mapping?.slides).reduce((n, s) => n + list(s?.tags).length, 0);
    if (folder.state !== "FOUND") rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "folder_ambiguous", checkedAt: at };
    else if (!manifest) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "manifest_missing", checkedAt: at };
    else if (list(manifest.items).length !== rec.slideCount) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "manifest_slide_count", checkedAt: at };
    else if (!mapping) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "product_tags_missing", checkedAt: at };
    else if (tagCount === 0 && !validateMapping(mapping, manifest).length) rec.tags = { ...rec.tags, state: "NO_TAGS", reason: null, tags: [], checkedAt: at };
    else {
      let plan = await buildTagPlan({ graph, mapping, manifest, mediaId: rec.publish.mediaId, getCafe24Product, expected });
      const writeRuns = rec.tags?.writeRuns || 0;
      let wrote = false;
      let applyReason = null;
      if (plan.state === "PENDING" && write === true && writeRuns < MAX_WRITE_RUNS) {
        const applied = await applyTagPlan(graph, plan, { write: true, env, acceptUnverifiedVariantApproval: rec.approvals?.acceptUnverifiedVariantApproval === true, expected });
        if (applied.applied) { wrote = true; plan = await verifyTagPlan(graph, applied.plan); } else applyReason = applied.reason;
      }
      rec.tags = { ...summarize(plan), applyReason, writeRuns: writeRuns + (wrote ? 1 : 0), checkedAt: at };
      if (rec.tags.state === "PENDING" && rec.tags.writeRuns >= MAX_WRITE_RUNS) Object.assign(rec.tags, { state: "TAG_REVIEW_REQUIRED", reason: "max_write_runs" });
    }
    rec.moveAdvice = decideMove(rec);
    return { record: rec, step: "tags" };
  } finally {
    running.delete(rec.folderName);
  }
}

// Feed folder reads in Dropbox: READY/<folder>, or after the upload side moved it, UPLOADED/<stamp> <folder>.
// Files are only downloaded and listed, never written, moved or deleted.
export function createFeedDropbox({ getToken, fetchImpl = fetch, feedDir = FEED_DIR_DEFAULT }) {
  const call = async (url, arg, body) => fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${await getToken()}`,
    ...(body === undefined ? { "Dropbox-API-Arg": asciiSafeJson(arg) } : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const api = async (endpoint, body) => {
    const response = await call(`https://api.dropboxapi.com/2/files/${endpoint}`, undefined, body);
    const text = await response.text();
    if (response.status === 409 && /not_found/.test(text)) return null;
    if (!response.ok) throw new Error(`Dropbox ${endpoint} failed (${response.status})`);
    return JSON.parse(text);
  };
  const download = async (path) => {
    const response = await call("https://content.dropboxapi.com/2/files/download", { path });
    const text = await response.text();
    if (response.status === 409 && /not_found/.test(text)) return null;
    if (!response.ok) throw new Error(`Dropbox download failed (${response.status})`);
    try { return JSON.parse(text); } catch { throw new Error(`Dropbox file is not JSON: ${path.split("/").pop()}`); }
  };
  // UPLOADED/<stamp> <folder>: a stamp that starts with a digit and has no spaces, one space, the folder name.
  // Dropbox paths ignore case, so the name match does too.
  // ponytail: full UPLOADED listing per lookup; cache the found path in the record if the folder grows large.
  const uploadedPaths = async (folderName) => {
    const paths = [];
    let page = await api("list_folder", { path: `${feedDir}/UPLOADED`, recursive: false, limit: 2000 });
    while (page) {
      for (const e of list(page.entries)) if (e[".tag"] === "folder" && /^\d\S* /.test(e.name) && e.name.slice(e.name.indexOf(" ") + 1).toLowerCase() === folderName.toLowerCase()) paths.push(e.path_display);
      page = page.has_more ? await api("list_folder/continue", { cursor: page.cursor }) : null;
    }
    return paths;
  };
  return {
    async readFolder(folderName) {
      if (!isFeedFolderName(folderName)) throw new Error("invalid folder name");
      const ready = `${feedDir}/READY/${folderName}`;
      const paths = (await api("get_metadata", { path: ready }))?.[".tag"] === "folder" ? [ready] : await uploadedPaths(folderName);
      if (!paths.length) return { state: "NOT_FOUND" };
      if (paths.length > 1) return { state: "AMBIGUOUS", paths };
      const [path] = paths;
      return { state: "FOUND", path, manifest: await download(`${path}/manifest.json`), mapping: await download(`${path}/product-tags.json`) };
    }
  };
}

// One JSON file per folder under dir (WORK_DIR/instagram-product-tags/posts).
export function createPostStore(dir) {
  const file = (name) => { if (!isFeedFolderName(name)) throw new Error("invalid folder name"); return join(dir, `${name}.json`); };
  return {
    async get(name) { try { return JSON.parse(await readFile(file(name), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } },
    async put(record) { await mkdir(dir, { recursive: true }); const f = file(record.folderName); const tmp = `${f}.tmp-${randomUUID()}`; await writeFile(tmp, JSON.stringify(record, null, 2)); await rename(tmp, f); },
    async list() { try { return (await readdir(dir)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)); } catch (e) { if (e.code === "ENOENT") return []; throw e; } }
  };
}

// Server side: register, run one folder, or tick over every open record (autorun).
// Write flags come from each record's approval plus the env gate checked in runTagJob.
export function createProductTagService({ graph, dropbox, getCafe24Product, store, env = process.env, now = () => Date.now() }) {
  const run = async (folderName) => {
    const record = await store.get(folderName);
    if (!record) return { ok: false, error: "not_registered" };
    try {
      const out = await runTagJob({ record, graph, readFolder: dropbox.readFolder, getCafe24Product, write: true, env, now: now() });
      if (out.step !== "already_running") await store.put({ ...out.record, lastError: null });
      return { ok: true, step: out.step, record: out.record };
    } catch (error) {
      const failed = { ...record, lastError: { message: String(error?.message || error).slice(0, 300), at: new Date(now()).toISOString() } };
      await store.put(failed);
      return { ok: false, error: failed.lastError.message, record: failed };
    }
  };
  return {
    async register(input) {
      const made = newPostRecord(input);
      if (!made.ok) return made;
      if (await store.get(made.record.folderName)) return { ok: false, problems: ["already_registered"] };
      await store.put(made.record);
      return made;
    },
    get: (name) => store.get(name),
    list: async () => Promise.all((await store.list()).map((n) => store.get(n))),
    run,
    async tick() {
      const out = [];
      for (const name of await store.list()) {
        const r = await store.get(name);
        // Skip finished posts, posts not due yet, and posts still unpublished two days after their slot.
        // A published post whose folder is missing keeps being looked for: the folder may show up later.
        if (!r || (r.publish?.state === "PUBLISHED" && TAGS_DONE.includes(r.tags?.state)) || Date.parse(r.slotIso) > now()) continue;
        if (r.publish?.state === "NOT_FOUND" && now() - Date.parse(r.slotIso) > 48 * 3600e3) continue;
        out.push({ folderName: name, ...(await run(name)) });
      }
      return out;
    }
  };
}
