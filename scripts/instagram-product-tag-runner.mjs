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
// after manual approval or the explicit per-post vision-v1 policy approved it.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { asciiSafeJson } from "./dropbox-report-uploader.mjs";
import { applyTagPlan, buildTagPlan, checkTagCandidate, isCatalogExclusion, SAMPLAS_META, validateMapping, verifyTagPlan } from "./instagram-product-tags.mjs";
import { buildScheduledMapping, validateScheduledProposal } from "./instagram-scheduled-mapping.mjs";
import { approveAutoTags, buildAutoMapping, confirmApprovedTags } from "./instagram-product-tag-automap.mjs";

import { NEW_FEED, LEGACY_FEED, legacyOwners, selectFeed } from "./feed-path-policy.mjs";
export const FEED_DIR_DEFAULT = NEW_FEED;
// A run that sent tags counts once; after this many the post waits for a person.
export const MAX_WRITE_RUNS = 3;
export const AUTO_APPROVER = "auto-policy-v1";
// The feed read covers the newest posts only; a post this old is no longer looked for.
const RECENT_MEDIA_LIMIT = "25";
const SLOT_EARLY_MS = 5 * 60 * 1000;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const list = (v) => (Array.isArray(v) ? v : []);
export const captionSha256 = (caption) => createHash("sha256").update(String(caption ?? "").normalize("NFC").replace(/\r\n/g, "\n").trim()).digest("hex");
export const isFeedFolderName = (name) => FOLDER_RE.test(String(name || "")) && !String(name).includes("..");

// Verified scheduler receipt (or operator registration). Automation is opt-in; legacy approvals default off.
export function newPostRecord({ folderName, slotIso, caption, captionSha256: sha, slideCount, acceptUnverifiedVariantApproval = false, autoTag, mappingProposal }) {
  const problems = [];
  if (!isFeedFolderName(folderName)) problems.push("folder_name");
  if (!Number.isFinite(Date.parse(slotIso))) problems.push("slot_iso");
  const hash = sha ? String(sha).toLowerCase() : caption ? captionSha256(caption) : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) problems.push("caption_sha256");
  if (sha && caption && captionSha256(caption) !== hash) problems.push("caption_hash_mismatch");
  if (!Number.isInteger(slideCount) || slideCount < 1 || slideCount > 20) problems.push("slide_count");
  if (autoTag !== undefined && (!autoTag || typeof autoTag.brand !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .&_-]{0,60}$/.test(autoTag.brand.trim()))) problems.push("auto_tag_brand");
  if (mappingProposal !== undefined) problems.push(...validateScheduledProposal(mappingProposal, folderName, slideCount));
  if (problems.length) return { ok: false, problems };
  return { ok: true, record: { schemaVersion: 1, folderName, slotIso: new Date(slotIso).toISOString(), captionSha256: hash, slideCount,
    ...(mappingProposal ? { mappingProposal: structuredClone(mappingProposal) } : {}),
    ...(!mappingProposal && autoTag ? { autoTag: { brand: autoTag.brand.trim().toUpperCase(), policy: "vision-v1" } } : {}),
    approvals: { acceptUnverifiedVariantApproval: !mappingProposal && acceptUnverifiedVariantApproval === true },
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

const mappingExclusions = (mapping) => list(mapping?.slides).flatMap((slide) => {
  const items = [...list(slide.skipped), ...list(slide.review)];
  if (mapping.source?.state !== "APPROVED") items.push(...list(slide.tags));
  return items.flatMap((item) => {
    const reason = String(item.validationReason ?? item.reason ?? "").split(",").find(isCatalogExclusion);
    return reason ? [{ order: slide.order, productNo: item.productNo ?? null, productId: item.metaProductId ?? null, reason }] : [];
  });
});

// Retain tag evidence and the image-scoped POST journal in the existing atomic record.
const summarize = (plan, prePlanExclusions = []) => {
  const images = plan.slides.map((slide) => {
    const { order, mediaId, attempts = [], tags } = slide;
    const excluded = prePlanExclusions.some((tag) => tag.order === order);
    const state = !tags.length ? (excluded ? "EXCLUDED" : "NO_TAGS")
      : tags.every((tag) => tag.state === "TAG_VERIFIED") && !slide.unreadable && !slide.lostExisting?.length && !slide.unexpectedExisting?.length ? "VERIFIED"
      : tags.every((tag) => tag.state === "PENDING") && !attempts.length ? "NOT_ATTEMPTED" : "FAILED";
    return { order, mediaId, state, attempts };
  });
  const tags = plan.slides.flatMap((slide) => slide.tags.map((tag) => ({
    order: slide.order, productNo: tag.productNo ?? null, productId: tag.productId ?? null,
    state: tag.state === "PRODUCT_TAGGING" ? "POST_OUTCOME_UNKNOWN" : tag.state,
    reason: tag.reason ?? (tag.state === "PRODUCT_TAGGING" ? "post_outcome_unconfirmed" : null),
    approval: tag.approval ?? null, eligible: tag.eligible === true
  })));
  const excluded = [...prePlanExclusions, ...tags.filter((tag) => isCatalogExclusion(tag.reason))];
  const verified = tags.filter((tag) => tag.state === "TAG_VERIFIED").length;
  const planned = tags.filter((tag) => tag.eligible).length;
  const state = tags.some((tag) => tag.state === "POST_OUTCOME_UNKNOWN") ? "POST_OUTCOME_UNKNOWN" : plan.state;
  const complete = state === "TAG_VERIFIED" && verified === planned && !excluded.length && images.every((image) => image.state !== "FAILED");
  return { state: state === "TAG_VERIFIED" && !complete ? "TAG_REVIEW_REQUIRED" : state,
    outcome: complete ? "COMPLETE" : verified ? "PARTIAL" : "INCOMPLETE",
    reason: plan.reason ?? plan.stopReason ?? null, counts: { planned, verified, excluded: excluded.length }, excluded, images, tags };
};

export const isTagJobDone = (record) => ["TAG_VERIFIED", "NO_TAGS"].includes(record?.tags?.state);
const isTagJobHeld = (record) => Boolean(record?.tags?.recoveryRequired) || record?.tags?.state === "POST_OUTCOME_UNKNOWN" ||
  list(record?.tags?.tags).some((t) => ["PRODUCT_TAGGING", "POST_OUTCOME_UNKNOWN"].includes(t.state));

const running = new Set();
const RECOVERY_APPROVAL_MS = 10 * 60 * 1000;
const targetKey = (tag) => JSON.stringify([tag.order, tag.productId, tag.x, tag.y]);
const targetSetKey = (targets) => JSON.stringify(targets.map(targetKey).sort());
const sameRecoveryRecord = (record, review) => isTagJobHeld(record) &&
  Boolean(review?.targets?.length && record.tags.planIdentity && record.tags.planIdentity === review.planIdentity &&
    record.tags.writeRuns === review.writeRuns);

// readFeedFolder(folderName) -> { location, path, manifest, mapping } (null for a missing file).
// Writes need record.approvals.acceptUnverifiedVariantApproval, write:true and INSTAGRAM_PRODUCT_TAG_WRITES=on.
export async function runTagJob({ record, graph, readFeedFolder, getCafe24Product, write = false, recover = false, recoveryTargets, assertRecoveryFresh, env = process.env, now = Date.now(), expected = SAMPLAS_META, checkpoint = async () => {}, checkMediaOwner = async () => {} }) {
  const rec = structuredClone(record);
  const held = isTagJobHeld(rec);
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
    if (!held && rec.mappingProposal && !rec.autoMapping && manifest && list(manifest.items).length === rec.slideCount) {
      try {
        rec.autoMapping = await buildScheduledMapping({ proposal: rec.mappingProposal, manifest, graph, getCafe24Product, now, expected });
        rec.proposalManifestSha256 = captionSha256(JSON.stringify(manifest));
      } catch {
        rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "scheduled_mapping_validation_failed", checkedAt: at };
        return { record: rec, step: "proposal" };
      }
      // Auto approval, off unless INSTAGRAM_PRODUCT_TAG_AUTO_APPROVE=on. Only tags that passed every check of
      // buildScheduledMapping are approved: PROPOSED (confidence >= 0.8, no competing candidate, brand, color,
      // Cafe24 option available, Meta in stock, approved IG product group) and not marked reviewRequired.
      // Every other tag and every review entry stays out of this post. buildTagPlan checks all of it again
      // before any POST, and the POST still needs INSTAGRAM_PRODUCT_TAG_WRITES=on.
      if (env.INSTAGRAM_PRODUCT_TAG_AUTO_APPROVE === "on") {
        const picks = rec.autoMapping.slides.flatMap((s) => s.tags.filter((t) => t.status === "PROPOSED" && t.reviewRequired === false && t.metaProductId && t.approval).map((t) => ({ order: s.order, productNo: t.productNo })));
        const out = picks.length ? approveAutoTags(rec.autoMapping, picks, { by: AUTO_APPROVER, builtAt: rec.autoMapping.source.builtAt, now }) : null;
        rec.autoApproval = { policy: AUTO_APPROVER, at, approved: out?.ok ? picks.length : 0, problems: out && !out.ok ? out.problems : [] };
        if (out?.ok) {
          rec.autoMapping = out.mapping;
          // The variant approval is read back after the POST (verifyTagPlan), as for a person's approval.
          rec.approvals = { ...rec.approvals, acceptUnverifiedVariantApproval: true };
        }
      }
      await checkpoint(rec);
    }
    if (rec.mappingProposal && rec.proposalManifestSha256 && rec.proposalManifestSha256 !== captionSha256(JSON.stringify(manifest))) {
      rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "proposal_manifest_changed", checkedAt: at };
      return { record: rec, step: "proposal" };
    }
    if (rec.autoTag && !rec.mappingProposal && !rec.autoMapping && !read.mapping) {
      rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "paid_vision_disabled", checkedAt: at };
      return { record: rec, step: "proposal" };
    }
    // New proposal jobs require their own human approval; a folder file cannot bypass it.
    // Legacy/manual jobs retain the existing folder-file priority.
    const folderMapping = rec.mappingProposal ? null : read.mapping;
    const auto = !folderMapping && rec.autoMapping ? rec.autoMapping : null;
    const mapping = folderMapping ?? (auto?.source?.state === "APPROVED" ? auto : null);
    rec.files = { location: location ?? null, path: path ?? null, mappingSource: folderMapping ? "folder" : auto ? "auto" : null, checkedAt: at };
    const tagCount = list(mapping?.slides).reduce((n, s) => n + list(s?.tags).length, 0);
    if (held && (!manifest || !mapping || !tagCount || list(manifest.items).length !== rec.slideCount)) {
      return { record: rec, step: "recovery_inputs_unavailable" };
    }
    if (!manifest) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: reason || "manifest_missing", checkedAt: at };
    else if (list(manifest.items).length !== rec.slideCount) rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: "manifest_slide_count", checkedAt: at };
    else if (!mapping) {
      const excluded = mappingExclusions(auto);
      rec.tags = { ...rec.tags, state: "TAG_REVIEW_REQUIRED", reason: auto ? "auto_mapping_not_approved" : "product_tags_missing", checkedAt: at };
      if (excluded.length) Object.assign(rec.tags, { outcome: "INCOMPLETE", counts: { planned: 0, verified: 0, excluded: excluded.length }, excluded });
    }
    else if (tagCount === 0 && !validateMapping(mapping, manifest).length) rec.tags = { ...rec.tags, state: "NO_TAGS", reason: null, tags: [], checkedAt: at };
    else {
      const previous = rec.tags;
      const writeRuns = previous?.writeRuns || 0;
      let plan = await buildTagPlan({ graph, mapping, manifest, mediaId: rec.publish.mediaId, getCafe24Product, expected });
      const identity = captionSha256(JSON.stringify([rec.publish.mediaId, mapping, plan.slides.map((slide) => [slide.order, slide.mediaId, slide.savedAsset])]));
      if (held) {
        const legacyTags = list(previous.tags);
        const current = summarize(plan).tags;
        const legacyMatches = legacyTags.length > 0 && legacyTags.length === current.length &&
          legacyTags.every((old, i) => old.order === current[i].order && old.productNo === current[i].productNo && old.productId === current[i].productId);
        if (!plan.slides.length || (previous.planIdentity ? previous.planIdentity !== identity : !legacyMatches)) {
          return { record: rec, step: "recovery_plan_mismatch" };
        }
      }
      let wrote = false;
      let applyReason = held ? "recovery_approval_required" : null;
      if (held && plan.state === "PENDING" && writeRuns >= MAX_WRITE_RUNS) applyReason = "max_write_runs";
      // Ordinary runs reconcile from fresh reads. Recovery writes require explicit selection by the caller
      // and a matching pre-POST identity. Legacy records have no such identity.
      const allowRecovery = held && previous.planIdentity === identity &&
        !list(previous.tags).some((old) => old.state === "TAG_VERIFIED" && !plan.slides.some((slide) =>
          slide.order === old.order && slide.tags.some((tag) => tag.productId === old.productId && tag.state === "TAG_VERIFIED")));
      const pendingTargets = held && plan.state === "PENDING" && allowRecovery && writeRuns < MAX_WRITE_RUNS
        ? plan.slides.flatMap((slide) => slide.tags.filter((tag) => tag.state === "PENDING")
          .map(({ productId, x, y }) => ({ order: slide.order, productId, x, y })))
        : [];
      if (recover && pendingTargets.some((target) => !recoveryTargets?.some((approved) => targetKey(approved) === targetKey(target)))) {
        return { record: rec, step: "recovery_targets_changed" };
      }
      const keepState = (inProgress = false) => {
        const summary = summarize(plan, mappingExclusions(auto));
        for (const image of summary.images) {
          const old = list(previous?.images).find((saved) => saved.mediaId === image.mediaId);
          image.attempts = [...list(old?.attempts), ...image.attempts];
          if (image.state === "NOT_ATTEMPTED" && image.attempts.length) image.state = "FAILED";
        }
        if (held) {
          for (const tag of summary.tags) {
            if (tag.state !== "PENDING") continue;
            const old = list(previous.tags).find((saved) => saved.order === tag.order && saved.productId === tag.productId);
            if (!old || !["PRODUCT_TAGGING", "POST_OUTCOME_UNKNOWN", "TAG_VERIFIED"].includes(old.state)) continue;
            tag.state = "POST_OUTCOME_UNKNOWN";
            tag.reason = "readback_missing";
            const image = summary.images.find((saved) => saved.order === tag.order);
            if (image) image.state = "FAILED";
          }
          if (summary.tags.some((tag) => tag.state === "POST_OUTCOME_UNKNOWN")) summary.state = "POST_OUTCOME_UNKNOWN";
        }
        rec.tags = { ...summary, applyReason: summary.state === "TAG_VERIFIED" ? null : applyReason, recoveryRequired: (held || wrote) && summary.state !== "TAG_VERIFIED",
          planIdentity: held ? previous.planIdentity : identity, writeRuns: writeRuns + Number(wrote), checkedAt: at };
        if (inProgress) rec.tags.recoveryRequired = true;
        // Older runners only honor the legacy hold state during a rollback.
        if (rec.tags.recoveryRequired) rec.tags.state = "POST_OUTCOME_UNKNOWN";
      };
      if (plan.state === "PENDING" && write === true && (!held || (recover && allowRecovery && assertRecoveryFresh)) && writeRuns < MAX_WRITE_RUNS) {
        await checkMediaOwner(rec);
        const applied = await applyTagPlan(graph, plan, { write: true, env, acceptUnverifiedVariantApproval: rec.approvals?.acceptUnverifiedVariantApproval === true, expected,
          beforePost: async () => {
            if (held) assertRecoveryFresh();
            wrote = true;
            keepState(true);
            await checkpoint(rec);
            if (held) assertRecoveryFresh();
          },
          afterPost: async () => {
            keepState(true);
            await checkpoint(rec);
          }
        });
        applyReason = applied.reason ?? null;
        if (applied.applied && !plan.stopReason) plan = await verifyTagPlan(graph, plan);
      }
      keepState();
      if (plan.state === "PENDING" && rec.tags.writeRuns >= MAX_WRITE_RUNS && !held) Object.assign(rec.tags, { state: "TAG_REVIEW_REQUIRED", reason: "max_write_runs" });
      if (held && !wrote && !isTagJobDone(rec)) {
        return { record: rec, step: "post_outcome_unknown", ...(!write ? { recoveryPreview: pendingTargets } : {}) };
      }
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
export function createFeedDropbox({ getToken, fetchImpl = fetch, feedDir = FEED_DIR_DEFAULT, legacyDir = feedDir === FEED_DIR_DEFAULT ? LEGACY_FEED : null, legacyFolders = legacyOwners() }) {
  const owners = legacyFolders instanceof Set ? legacyFolders : legacyOwners(legacyFolders);
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
      if (response.status === 409) {
        const error = await response.text();
        if (/not_found/.test(error)) return [];
        throw new Error("Dropbox list unavailable");
      }
      if (!response.ok) throw new Error(`Dropbox list failed (${response.status})`);
      const page = await response.json();
      names.push(...list(page.entries).filter((e) => e[".tag"] === "folder").map((e) => e.name));
      if (!page.has_more) return names;
      url = "https://api.dropboxapi.com/2/files/list_folder/continue"; body = { cursor: page.cursor };
    }
  };
  const read = async (location, path) => ({ location, path, manifest: await download(`${path}/manifest.json`), mapping: await download(`${path}/product-tags.json`) });
  return {
    async readFeedImage(path, savedAsset) {
      const root = [feedDir, legacyDir].filter(Boolean).find(root => String(path || "").startsWith(`${root}/`));
      const prefix = `${root}/`;
      const relative = String(path || "").startsWith(prefix) ? path.slice(prefix.length) : "";
      if (!/^(READY\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}|UPLOADED\/(?:\d{8}-\d{6} )?[A-Za-z0-9][A-Za-z0-9._-]{0,80})$/.test(relative) ||
          relative.includes("..") || !/^assets\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(String(savedAsset))) throw new Error("invalid_feed_image_path");
      const response = await fetchImpl("https://content.dropboxapi.com/2/files/download", { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { ...(await auth()), "Dropbox-API-Arg": asciiSafeJson({ path: `${path}/${savedAsset}` }) } });
      if (!response.ok || !response.body) throw new Error(`Dropbox image read failed (${response.status})`);
      const max = 8 * 1024 * 1024;
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); throw new Error("feed_image_too_large"); }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      const ext = savedAsset.split(".").pop().toLowerCase();
      const mime = ext === "png" ? "png" : ext === "webp" ? "webp" : "jpeg";
      if (!bytes.length) throw new Error("feed_image_empty");
      return `data:image/${mime};base64,${bytes.toString("base64")}`;
    },
    async readFeedFolder(folderName) {
      if (!isFeedFolderName(folderName)) throw new Error("invalid folder name");
      const hits = [];
      for (const [root, legacy] of [[feedDir, false], ...(legacyDir ? [[legacyDir, true]] : [])]) {
        const ready = await read("READY", `${root}/READY/${folderName}`);
        if (ready.manifest || (await listFolders(`${root}/READY`)).includes(folderName)) hits.push({...ready, legacy, ...(!ready.manifest ? {reason:"manifest_missing"} : {})});
        const names = (await listFolders(`${root}/UPLOADED`)).filter(n => n === folderName || (n.endsWith(` ${folderName}`) && /^\d{8}-\d{6} /.test(n)));
        for (const name of names) hits.push({...await read("UPLOADED", `${root}/UPLOADED/${name}`), legacy});
      }
      if (!legacyDir) {
        if (hits.length > 1) return {location: "UPLOADED", path: null, manifest: null, mapping: null, reason: "uploaded_folder_ambiguous"};
        if (!hits.length) return {location: null, path: null, manifest: null, mapping: null, reason: "folder_not_found"};
        return hits[0];
      }
      try { return selectFeed(folderName, hits, owners); }
      catch (error) { return {location:null,path:null,manifest:null,mapping:null,reason:error.message}; }

    }
  };
}

// One JSON file per folder under dir (WORK_DIR/instagram-product-tags/posts).
export function createPostStore(dir) {
  const file = (name) => { if (!isFeedFolderName(name)) throw new Error("invalid folder name"); return join(dir, `${name}.json`); };
  return {
    async withTagLock(operation, folderName) {
      let handle;
      let acquired;
      try {
        await mkdir(dir, { recursive: true });
        // All writers for the fixed SAMPLAS account use one stable inode. Never delete it.
        const lockPath = folderName === undefined ? join(dir, ".tag-writes.lock") : `${file(folderName)}.lock`;
        handle = await open(lockPath, "a", 0o600);
        acquired = await new Promise((resolve, reject) => {
          // The child locks the open file description shared with this process.
          const child = spawn("flock", ["-n", "-E", "75", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] });
          child.once("error", reject);
          child.once("close", resolve);
        });
      } catch {
        await handle?.close();
        return { ok: false, error: "tag_lock_unavailable" };
      }
      try {
        if (acquired !== 0) return { ok: false, error: acquired === 75 ? "tag_lock_busy" : "tag_lock_unavailable" };
        return await operation();
      } finally {
        await handle.close();
      }
    },
    async get(name) { try { return JSON.parse(await readFile(file(name), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } },
    async put(record) {
      await mkdir(dir, { recursive: true });
      const destination = file(record.folderName);
      const temporary = `${destination}.tmp-${randomUUID()}`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        try {
          await handle.writeFile(JSON.stringify(record, null, 2));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, destination);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      const directory = await open(dir, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    },
    async list() { try { return (await readdir(dir)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)); } catch (e) { if (e.code === "ENOENT") return []; throw e; } }
  };
}

// Server side: register, run one folder, or tick over every open record (autorun).
// Tag writes need each record's approval plus the env gate checked in runTagJob.
export function createProductTagService({ graph, dropbox, getCafe24Product, store, env = process.env, now = () => Date.now() }) {
  // Run takes the account lock before the record lock. Other mutations only need the record lock.
  const queues = new Map();
  const serial = (name, fn, accountWide = false) => {
    const locked = () => {
      if (!store.withTagLock) return { ok: false, error: "tag_lock_unavailable" };
      const recordLock = () => store.withTagLock(fn, name);
      return accountWide ? store.withTagLock(recordLock) : recordLock();
    };
    const next = (queues.get(name) ?? Promise.resolve()).then(locked, locked);
    queues.set(name, next.catch(() => {}));
    return next;
  };
  const run = (folderName, { approve = false, recover = false, write = true, review, approvalId } = {}) => serial(folderName, async () => {
    const record = await store.get(folderName);
    if (!record) return { ok: false, error: "not_registered" };
    if ((approve || recover) && !sameRecoveryRecord(record, review)) {
      return { ok: false, error: "recovery_review_changed" };
    }
    const binding = (review) => captionSha256(JSON.stringify([
      SAMPLAS_META.igUserId, record.publish?.mediaId, folderName, review.planIdentity, review.writeRuns, targetSetKey(review.targets)
    ]));
    if (approve) {
      const inspected = record.recoveryInspection;
      const age = now() - inspected?.inspectedAt;
      if (!inspected || inspected.binding !== binding(review) || !(age >= 0 && age < RECOVERY_APPROVAL_MS)) {
        return { ok: false, error: "recovery_review_changed" };
      }
    }
    const grant = record.recoveryApproval;
    const assertRecoveryFresh = () => {
      const current = now();
      if (!(current >= grant.issuedAt && current < grant.expiresAt && grant.expiresAt - grant.issuedAt === RECOVERY_APPROVAL_MS)) throw new Error("recovery_approval_expired");
    };
    if (recover) {
      if (!grant || typeof approvalId !== "string" || grant.idHash !== captionSha256(approvalId) || grant.binding !== binding(review)) {
        return { ok: false, error: "recovery_approval_invalid" };
      }
      try { assertRecoveryFresh(); } catch {
        delete record.recoveryApproval;
        await store.put(record);
        return { ok: false, error: "recovery_approval_expired" };
      }
      // Consume under the shared lock before any write, even if subsequent validation or POST fails.
      delete record.recoveryApproval;
      await store.put(record);
    }
    let latestRecord = record;
    try {
      const out = await runTagJob({
        record, graph, readFeedFolder: dropbox.readFeedFolder, getCafe24Product, write: approve ? false : write, recover, recoveryTargets: review?.targets,
        assertRecoveryFresh: recover ? assertRecoveryFresh : undefined,
        env, now: now(), checkpoint: (rec) => store.put(rec),
        checkMediaOwner: async (rec) => {
          for (const name of await store.list()) {
            if (name === folderName) continue;
            const other = await store.get(name);
            if (other?.publish?.mediaId === rec.publish.mediaId && (other.tags?.writeRuns > 0 || isTagJobHeld(other))) {
              throw new Error("tag_media_owned_by_another_record");
            }
          }
        }
      });
      latestRecord = out.record;
      if (approve) {
        if (!out.recoveryPreview?.length || targetSetKey(out.recoveryPreview) !== targetSetKey(review.targets)) {
          return { ok: false, error: "recovery_review_changed", step: out.step };
        }
        const id = randomUUID();
        const issuedAt = now();
        if (!Number.isFinite(issuedAt)) return { ok: false, error: "recovery_approval_invalid" };
        const expiresAt = issuedAt + RECOVERY_APPROVAL_MS;
        delete out.record.recoveryInspection;
        out.record.recoveryApproval = { idHash: captionSha256(id), binding: binding(review), issuedAt, expiresAt };
        await store.put(out.record);
        return { ok: true, approvalId: id, expiresAt: new Date(expiresAt).toISOString() };
      }
      if (!write && !recover) {
        delete out.record.recoveryInspection;
        if (out.recoveryPreview?.length) {
          const { planIdentity, writeRuns } = out.record.tags;
          out.record.recoveryInspection = { binding: binding({ planIdentity, writeRuns, targets: out.recoveryPreview }), inspectedAt: now() };
        }
      }
      if (out.step !== "already_running") await store.put({ ...out.record, lastError: null });
      return { ok: true, step: out.step, record: out.record, ...(out.recoveryPreview ? { recoveryPreview: out.recoveryPreview } : {}) };
    } catch (error) {
      const failed = { ...(error?.partialRecord ?? latestRecord), lastError: { message: String(error?.message || error).slice(0, 300), at: new Date(now()).toISOString() } };
      await store.put(failed);
      return { ok: false, error: failed.lastError.message, record: failed };
    }
  }, true);
  return {
    register(input) {
      const made = newPostRecord(input);
      if (!made.ok) return Promise.resolve(made);
      return serial(made.record.folderName, async () => {
        const existing = await store.get(made.record.folderName);
        if (existing) {
          const identity = r => JSON.stringify([r.slotIso, r.captionSha256, r.slideCount, !r.mappingProposal && r.approvals?.acceptUnverifiedVariantApproval === true, r.autoTag ?? null, r.mappingProposal ?? null]);
          return identity(existing) === identity(made.record) ? { ok: true, existing: true, record: existing } : { ok: false, problems: ["registration_conflict"] };
        }
        await store.put(made.record);
        return made;
      });
    },
    // Auto mapping from visual findings (see instagram-product-tag-automap.mjs). Stored in the record, never in
    // the feed folder. A new mapping replaces the old one and needs a new approval.
    autoMap: (folderName, findings) => serial(folderName, async () => {
      const record = await store.get(folderName);
      if (!record) return { ok: false, error: "not_registered" };
      if (isTagJobHeld(record)) return { ok: false, error: "post_outcome_unknown" };
      if (isTagJobDone(record)) return { ok: false, error: "tags_final" };
      const { manifest, reason } = await dropbox.readFeedFolder(folderName);
      if (!manifest) return { ok: false, error: reason || "manifest_missing" };
      const out = await buildAutoMapping({ graph, findings, manifest, getCafe24Product, now: now() });
      if (!out.ok) return { ok: false, error: "invalid_findings", problems: out.problems };
      await store.put({ ...record, autoMapping: out.mapping });
      return { ok: true, mapping: out.mapping };
    }),
    approveAutoMap: (folderName, picks, by, builtAt, { acceptUnverifiedVariantApproval = false } = {}) => serial(folderName, async () => {
      const record = await store.get(folderName);
      if (isTagJobHeld(record)) return { ok: false, error: "post_outcome_unknown" };
      if (!record?.autoMapping) return { ok: false, error: record ? "auto_mapping_missing" : "not_registered" };
      if (isTagJobDone(record)) return { ok: false, error: "tags_final" };
      // The variant flag can also be given to a post registered without a scheduling proposal (automap path),
      // with the same candidate checks as a proposal post. If that mapping is already approved, the same picks and
      // builtAt only re-confirm it for the flag: the mapping is kept as approved, never rebuilt or re-approved.
      const flag = acceptUnverifiedVariantApproval === true;
      const confirmOnly = flag && !record.mappingProposal && record.autoMapping.source?.state === "APPROVED";
      const out = confirmOnly ? confirmApprovedTags(record.autoMapping, picks, { by, builtAt }) : approveAutoTags(record.autoMapping, picks, { by, builtAt, now: now() });
      if (!out.ok) return { ok: false, error: "not_approvable", problems: out.problems };
      if (record.mappingProposal || flag) {
        for (const slide of out.mapping.slides) for (const tag of slide.tags) {
          let checked;
          try { checked = await checkTagCandidate(graph, { ...SAMPLAS_META, productNo: tag.productNo, metaProductId: tag.metaProductId, cafe24: await getCafe24Product(tag.productNo) }); }
          catch { checked = { ok: false, reason: "candidate_validation_unavailable" }; }
          if (!checked.ok) return { ok: false, error: "not_approvable", problems: [checked.reason] };
        }
      }
      await store.put({ ...record, autoMapping: out.mapping,
        ...(record.mappingProposal || flag ? { approvals: { ...record.approvals, acceptUnverifiedVariantApproval: flag } } : {}) });
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
        if (!r || isTagJobDone(r) || isTagJobHeld(r) || Date.parse(r.slotIso) > now()) continue;
        if (r.publish?.state === "NOT_FOUND" && now() - Date.parse(r.slotIso) > 48 * 3600e3) continue;
        out.push({ folderName: name, ...(await run(name)) });
      }
      return out;
    }
  };
}
