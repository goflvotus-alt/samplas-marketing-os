// Feed post -> product tags pipeline for @samplaskr posts scheduled on Instagram web.
// Publishing stays with the existing web scheduling; this runner never publishes, re-posts or deletes.
//
// The upload automation alone moves READY/<folder> to UPLOADED/<yyyymmdd-HHMMSS> <folder>. This runner never
// moves, writes or deletes feed files: it finds the folder where it is now (READY first, then UPLOADED) and
// only reads it, so tags work before and after the move, and a tag problem never holds the upload.
//
// One record per folder, kept in the runner's own state store:
//   publish: SCHEDULED | NOT_FOUND | MISMATCH | PUBLISHED (Graph read of the @samplaskr feed)
//   tags:    TAG_STATES of instagram-product-tags.mjs, plus NO_TAGS (product-tags.json lists no tags)
//   files:   where manifest.json / product-tags.json were read (READY or UPLOADED) on the last run
// Order per run: find the published media -> read manifest.json + product-tags.json -> buildTagPlan ->
// applyTagPlan (gated) -> verifyTagPlan. TAG_VERIFIED and NO_TAGS are final.
// Anything unclear holds the tags: a missing mapping is TAG_REVIEW_REQUIRED, never a guess.
// Without product-tags.json the runner uses record.autoMapping (instagram-product-tag-automap.mjs), but only
// after a person approved it.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asciiSafeJson } from "./dropbox-report-uploader.mjs";
import { applyTagPlan, buildTagPlan, SAMPLAS_META, validateMapping, verifyTagPlan } from "./instagram-product-tags.mjs";
import { approveAutoTags, buildAutoMapping } from "./instagram-product-tag-automap.mjs";

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

// What a person registers once the post is scheduled. Approvals are per post and default to off.
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
    publish: { state: "SCHEDULED" }, tags: { state: "PENDING", writeRuns: 0 } } };
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

export const isTagJobDone = (record) => ["TAG_VERIFIED", "NO_TAGS"].includes(record?.tags?.state);

const running = new Set();

// readFeedFolder(folderName) -> { location, path, manifest, mapping } (null for a missing file).
// Writes need record.approvals.acceptUnverifiedVariantApproval, write:true and INSTAGRAM_PRODUCT_TAG_WRITES=on.
export async function runTagJob({ record, graph, readFeedFolder, getCafe24Product, write = false, env = process.env, now = Date.now(), expected = SAMPLAS_META }) {
  const rec = structuredClone(record);
  if (isTagJobDone(rec)) return { record: rec, step: "done" };
  if (running.has(rec.folderName)) return { record: rec, step: "already_running" };
  running.add(rec.folderName);
  try {
    const at = new Date(now).toISOString();
    if (rec.publish?.state !== "PUBLISHED") {
      rec.publish = { ...(await findPublishedMedia(graph, rec, { now, expected })), checkedAt: at };
      if (rec.publish.state !== "PUBLISHED") return { record: rec, step: "publish" };
    }
    const read = await readFeedFolder(rec.folderName);
    const { location, path, manifest, reason } = read;
    // product-tags.json in the folder wins. Else an auto mapping a person approved (automap routes).
    const auto = !read.mapping && rec.autoMapping ? rec.autoMapping : null;
    const mapping = read.mapping ?? (auto?.source?.state === "APPROVED" ? auto : null);
    rec.files = { location: location ?? null, path: path ?? null, mappingSource: read.mapping ? "folder" : auto ? "auto" : null, checkedAt: at };
    const tagCount = list(mapping?.slides).reduce((n, s) => n + list(s?.tags).length, 0);
    if (!manifest) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: reason || "manifest_missing", checkedAt: at };
    else if (list(manifest.items).length !== rec.slideCount) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "manifest_slide_count", checkedAt: at };
    else if (!mapping) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: auto ? "auto_mapping_not_approved" : "product_tags_missing", checkedAt: at };
    else if (tagCount === 0 && !validateMapping(mapping, manifest).length) rec.tags = { ...rec.tags, state: "NO_TAGS", reason: null, tags: [], checkedAt: at };
    else {
      let plan = await buildTagPlan({ graph, mapping, manifest, mediaId: rec.publish.mediaId, getCafe24Product, expected });
      const writeRuns = rec.tags?.writeRuns || 0;
      let wrote = false;
      let applyReason = null;
      if (plan.state === "PENDING" && write === true && writeRuns < MAX_WRITE_RUNS) {
        const applied = await applyTagPlan(graph, plan, { write: true, env, acceptUnverifiedVariantApproval: rec.approvals?.acceptUnverifiedVariantApproval === true, expected });
        if (applied.applied) {
          wrote = true;
          rec.tags = { ...summarize(applied.plan), writeRuns: writeRuns + 1, checkedAt: at };
          plan = await verifyTagPlan(graph, applied.plan);
        } else applyReason = applied.reason;
      }
      rec.tags = { ...summarize(plan), applyReason, writeRuns: writeRuns + (wrote ? 1 : 0), checkedAt: at };
      if (rec.tags.state === "PENDING" && rec.tags.writeRuns >= MAX_WRITE_RUNS) Object.assign(rec.tags, { state: "TAG_REVIEW_REQUIRED", reason: "max_write_runs" });
    }
    return { record: rec, step: "tags" };
  } catch (error) {
    // Keep what this run learned (publish state, tags already sent) for the next run.
    error.partialRecord = rec;
    throw error;
  } finally {
    running.delete(rec.folderName);
  }
}

// Feed folder reads in Dropbox: list_folder and download only. The folder is looked up
// where it is now: READY/<folder>, else the one UPLOADED entry named "<yyyymmdd-HHMMSS> <folder>".
export function createFeedDropbox({ getToken, fetchImpl = fetch, feedDir = FEED_DIR_DEFAULT }) {
  const auth = async () => ({ Authorization: `Bearer ${await getToken()}` });
  const download = async (path) => {
    const response = await fetchImpl("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { ...(await auth()), "Dropbox-API-Arg": asciiSafeJson({ path }) } });
    const text = await response.text();
    if (response.status === 409 && /not_found/.test(text)) return null;
    if (!response.ok) throw new Error(`Dropbox download failed (${response.status})`);
    try { return JSON.parse(text); } catch { throw new Error(`Dropbox file is not JSON: ${path.split("/").pop()}`); }
  };
  const listFolders = async (path) => {
    const names = [];
    let url = "https://api.dropboxapi.com/2/files/list_folder", body = { path, recursive: false, include_deleted: false };
    for (;;) {
      const response = await fetchImpl(url, { method: "POST", headers: { ...(await auth()), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Dropbox list failed (${response.status})`);
      const page = await response.json();
      names.push(...list(page.entries).filter((e) => e[".tag"] === "folder").map((e) => e.name));
      if (!page.has_more) return names;
      url = "https://api.dropboxapi.com/2/files/list_folder/continue"; body = { cursor: page.cursor };
    }
  };
  const read = async (location, path) => ({ location, path, manifest: await download(`${path}/manifest.json`), mapping: await download(`${path}/product-tags.json`) });
  return {
    async readFeedFolder(folderName) {
      if (!isFeedFolderName(folderName)) throw new Error("invalid folder name");
      const ready = await read("READY", `${feedDir}/READY/${folderName}`);
      if (ready.manifest) return ready;
      const hits = (await listFolders(`${feedDir}/UPLOADED`)).filter((n) => n.endsWith(` ${folderName}`) && /^\d{8}-\d{6} /.test(n));
      if (hits.length > 1) return { location: "UPLOADED", path: null, manifest: null, mapping: null, reason: "uploaded_folder_ambiguous" };
      if (!hits.length) return { location: null, path: null, manifest: null, mapping: null, reason: "folder_not_found" };
      return read("UPLOADED", `${feedDir}/UPLOADED/${hits[0]}`);
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
// Tag writes need each record's approval plus the env gate checked in runTagJob.
export function createProductTagService({ graph, dropbox, getCafe24Product, store, env = process.env, now = () => Date.now() }) {
  // One change at a time per folder (run, automap, approve), so no call writes a record another one has
  // changed meanwhile. ponytail: in-process only; one server runs the tags (see Operating limits).
  const queues = new Map();
  const serial = (name, fn) => {
    const next = (queues.get(name) ?? Promise.resolve()).then(fn, fn);
    queues.set(name, next.catch(() => {}));
    return next;
  };
  const run = (folderName) => serial(folderName, async () => {
    const record = await store.get(folderName);
    if (!record) return { ok: false, error: "not_registered" };
    try {
      const out = await runTagJob({ record, graph, readFeedFolder: dropbox.readFeedFolder, getCafe24Product, write: true, env, now: now() });
      if (out.step !== "already_running") await store.put({ ...out.record, lastError: null });
      return { ok: true, step: out.step, record: out.record };
    } catch (error) {
      const failed = { ...(error?.partialRecord ?? record), lastError: { message: String(error?.message || error).slice(0, 300), at: new Date(now()).toISOString() } };
      await store.put(failed);
      return { ok: false, error: failed.lastError.message, record: failed };
    }
  });
  return {
    async register(input) {
      const made = newPostRecord(input);
      if (!made.ok) return made;
      if (await store.get(made.record.folderName)) return { ok: false, problems: ["already_registered"] };
      await store.put(made.record);
      return made;
    },
    // Auto mapping from visual findings (see instagram-product-tag-automap.mjs). Stored in the record, never in
    // the feed folder. A new mapping replaces the old one and needs a new approval.
    autoMap: (folderName, findings) => serial(folderName, async () => {
      const record = await store.get(folderName);
      if (!record) return { ok: false, error: "not_registered" };
      if (isTagJobDone(record)) return { ok: false, error: "tags_final" };
      const { manifest, reason } = await dropbox.readFeedFolder(folderName);
      if (!manifest) return { ok: false, error: reason || "manifest_missing" };
      const out = await buildAutoMapping({ graph, findings, manifest, getCafe24Product, now: now() });
      if (!out.ok) return { ok: false, error: "invalid_findings", problems: out.problems };
      await store.put({ ...record, autoMapping: out.mapping });
      return { ok: true, mapping: out.mapping };
    }),
    approveAutoMap: (folderName, picks, by, builtAt) => serial(folderName, async () => {
      const record = await store.get(folderName);
      if (!record?.autoMapping) return { ok: false, error: record ? "auto_mapping_missing" : "not_registered" };
      if (isTagJobDone(record)) return { ok: false, error: "tags_final" };
      const out = approveAutoTags(record.autoMapping, picks, { by, builtAt, now: now() });
      if (!out.ok) return { ok: false, error: "not_approvable", problems: out.problems };
      await store.put({ ...record, autoMapping: out.mapping });
      return { ok: true, mapping: out.mapping };
    }),
    get: (name) => store.get(name),
    list: async () => Promise.all((await store.list()).map((n) => store.get(n))),
    run,
    async tick() {
      const out = [];
      for (const name of await store.list()) {
        const r = await store.get(name);
        // Skip finished posts, posts not due yet, and posts still missing two days after their slot.
        if (!r || isTagJobDone(r) || Date.parse(r.slotIso) > now()) continue;
        if (r.publish?.state === "NOT_FOUND" && now() - Date.parse(r.slotIso) > 48 * 3600e3) continue;
        out.push({ folderName: name, ...(await run(name)) });
      }
      return out;
    }
  };
}
