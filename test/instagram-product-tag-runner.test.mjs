// Feed post -> product tags runner against a fake Graph API and fake Dropbox. No network, no real POST.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphError, SAMPLAS_META, toTagCafe24View } from "../scripts/instagram-product-tags.mjs";
import { captionSha256, createFeedDropbox, createPostStore, createProductTagService, findPublishedMedia, MAX_WRITE_RUNS, newPostRecord, runTagJob } from "../scripts/instagram-product-tag-runner.mjs";

const IG = SAMPLAS_META.igUserId;
const CATALOG = SAMPLAS_META.catalogId;
const CAPTION = "@tae_global 26AW RELEASE NOW";
const SLOT = "2026-10-28T11:00:00.000Z";
const AFTER = Date.parse(SLOT) + 10 * 60e3;
const ON = { INSTAGRAM_PRODUCT_TAG_WRITES: "on" };
const manifest = { folderName: "TAEGLOBAL-26AW", items: [{ order: 1, savedAsset: "assets/01.jpg" }, { order: 2, savedAsset: "assets/02.jpg" }] };
const mapping = (tags = [[1, [{ productNo: 101, metaProductId: "P101", x: 0.5, y: 0.5, approved: true }]]]) => ({ schemaVersion: 1, folderName: "TAEGLOBAL-26AW", post: { mediaId: null },
  slides: tags.map(([order, t]) => ({ order, savedAsset: `assets/0${order}.jpg`, tags: t })) });
const record = (over = {}) => ({ ...newPostRecord({ folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2, acceptUnverifiedVariantApproval: true, ...over }).record });

function fakeGraph({ feed, username = "samplaskr", postFailures = [] } = {}) {
  const state = { tags: { c1: [], c2: [] }, posts: [] };
  const failures = [...postFailures];
  const media = feed ?? [{ id: "m1", caption: CAPTION, timestamp: "2026-10-28T11:00:05+0000", permalink: "https://www.instagram.com/p/X/", media_type: "CAROUSEL_ALBUM", children: { data: [{ id: "c1" }, { id: "c2" }] } }];
  const graph = {
    async get(path, params = {}) {
      if (path === "app") return { id: SAMPLAS_META.appId };
      if (path === "me/permissions") return { data: ["instagram_basic", "instagram_shopping_tag_products", "catalog_management"].map((permission) => ({ permission, status: "granted" })) };
      if (path === IG) return { id: IG, username, shopping_product_tag_eligibility: true };
      if (path === `${IG}/media`) return { data: media };
      if (path === CATALOG) return { id: CATALOG, business: { id: SAMPLAS_META.businessId } };
      if (path === `${IG}/available_catalogs`) return { data: [{ catalog_id: CATALOG }] };
      if (path === "m1") return { id: "m1", media_type: "CAROUSEL_ALBUM", username: "samplaskr", owner: { id: IG } };
      if (path === "m1/children") return { data: [{ id: "c1", media_type: "IMAGE" }, { id: "c2", media_type: "IMAGE" }] };
      if (path.endsWith("/product_tags")) return { data: state.tags[path.split("/")[0]].map((t) => ({ ...t })) };
      if (path === `${IG}/catalog_product_search`) return { data: [{ product_id: `P${params.q}`, retailer_id: `${params.q}.X`, review_status: "approved", product_variants: [{ product_id: `P${params.q}` }] }] };
      // Catalog-wide product list is refused live (2026-10-29); rows come through the product group.
      if (path === `${CATALOG}/products`) throw new GraphError(403, { error: { code: 200, message: "(#200) Permissions error" } });
      if (/^P\d+$/.test(path) && params.fields === "product_group{id,retailer_id}") return { product_group: { id: `G${path.slice(1)}`, retailer_id: path.slice(1) } };
      if (/^G\d+\/products$/.test(path)) { const no = path.slice(1).split("/")[0]; return { data: [{ id: `P${no}`, retailer_id: `${no}.BK`, name: `[TAEGLOBAL] item ${no}`, availability: "in stock" }] }; }
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, params) {
      const child = path.split("/")[0];
      state.posts.push({ child, tags: params.updated_tags.map((t) => t.product_id) });
      const failure = failures.shift();
      if (failure) throw failure;
      for (const t of params.updated_tags) state.tags[child].push({ product_id: t.product_id, x: t.x, y: t.y, review_status: "approved" });
      return { success: true };
    }
  };
  return { graph, state };
}
const variant = (code, quantity) => ({ variant_code: code, selling: "T", display: "T", inventories: [{ use_inventory: "T", display_soldout: "T", quantity }] });
const cafe24 = async (no) => toTagCafe24View({ product_no: no, selling: "T", display: "T" }, [variant("BK", 2)]);
const READY_PATH = "/F/READY/TAEGLOBAL-26AW";
const UPLOADED_PATH = "/F/UPLOADED/20261028-201500 TAEGLOBAL-26AW";
const ready = (m = mapping(), man = manifest, location = "READY", path = READY_PATH) => async () => ({ location, path, manifest: man, mapping: m });
const job = (graph, over = {}) => runTagJob({ record: record(), graph, readFeedFolder: ready(), getCafe24Product: cafe24, now: AFTER, ...over });

test("post record: validated input, caption hashed, approvals off unless given", () => {
  const r = newPostRecord({ folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: ` ${CAPTION}\r\n`, slideCount: 7 });
  assert.equal(r.record.captionSha256, captionSha256(CAPTION));
  assert.deepEqual(r.record.approvals, { acceptUnverifiedVariantApproval: false });
  assert.deepEqual(newPostRecord({ folderName: "../READY", slotIso: "x", slideCount: 21 }).problems, ["folder_name", "slot_iso", "caption_sha256", "slide_count"]);
});

test("publish check: scheduled, not found, wrong account, duplicate, early, slide count, published", async () => {
  const r = record();
  const check = (feed, over = {}, now = AFTER) => findPublishedMedia(fakeGraph({ feed, ...over }).graph, r, { now });
  assert.equal((await check([], {}, Date.parse(SLOT) - 1)).state, "SCHEDULED");
  assert.equal((await check([])).state, "NOT_FOUND");
  assert.deepEqual(await check(undefined, { username: "other" }), { state: "MISMATCH", reason: "wrong_account" });
  const post = (o = {}) => ({ id: "m1", caption: CAPTION, timestamp: "2026-10-28T11:01:00+0000", media_type: "CAROUSEL_ALBUM", children: { data: [{ id: "c1" }, { id: "c2" }] }, ...o });
  assert.equal((await check([post(), post({ id: "m2" })])).reason, "duplicate_caption");
  assert.equal((await check([post({ timestamp: "2026-10-27T11:00:00+0000" })])).reason, "published_before_slot");
  assert.equal((await check([post({ children: { data: [{ id: "c1" }] } })])).reason, "slide_count:1!=2");
  assert.equal((await check([post({ caption: "other" })])).state, "NOT_FOUND");
  assert.deepEqual(await check([post()]), { state: "PUBLISHED", mediaId: "m1", permalink: undefined, timestamp: "2026-10-28T11:01:00+0000" });
});

test("not published yet: no feed folder read, no tag request", async () => {
  const { graph, state } = fakeGraph({ feed: [] });
  let reads = 0;
  const out = await job(graph, { now: Date.parse(SLOT) - 1, readFeedFolder: async () => { reads++; return {}; }, write: true, env: ON });
  assert.deepEqual([out.step, out.record.publish.state, reads, state.posts.length], ["publish", "SCHEDULED", 0, 0]);
});

test("missing or short feed inputs hold the tags; an empty mapping means no tags (final)", async () => {
  const { graph } = fakeGraph();
  const hold = async (readFeedFolder) => (await job(graph, { readFeedFolder })).record;
  assert.equal((await hold(ready(null))).tags.reason, "product_tags_missing");
  assert.equal((await hold(async () => ({ location: null, path: null, manifest: null, mapping: null, reason: "folder_not_found" }))).tags.reason, "folder_not_found");
  assert.equal((await hold(ready(mapping(), { ...manifest, items: manifest.items.slice(0, 1) }))).tags.reason, "manifest_slide_count");
  const none = await hold(ready(mapping([])));
  assert.deepEqual([none.tags.state, none.files.location, "move" in none], ["NO_TAGS", "READY", false]);
  assert.equal((await runTagJob({ record: none, graph, readFeedFolder: async () => { throw new Error("must not read"); }, getCafe24Product: cafe24, now: AFTER })).step, "done");
});

test("writes off: plan stays PENDING with the reason, nothing sent", async () => {
  const { graph, state } = fakeGraph();
  for (const [write, env, approve] of [[false, ON, true], [true, {}, true], [true, ON, false]]) {
    const out = await runTagJob({ record: record({ acceptUnverifiedVariantApproval: approve }), graph, readFeedFolder: ready(), getCafe24Product: cafe24, now: AFTER, write, env });
    assert.equal(out.record.tags.state, "PENDING");
  }
  const blocked = await runTagJob({ record: record({ acceptUnverifiedVariantApproval: false }), graph, readFeedFolder: ready(), getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.equal(blocked.record.tags.applyReason, "variant_approval_unverified");
  assert.equal(state.posts.length, 0);
});

test("full path: publish found, tags sent and read back; re-run does nothing; files never moved", async () => {
  const { graph, state } = fakeGraph();
  const m = mapping([[1, [{ productNo: 101, metaProductId: "P101", x: 0.25, y: 0.4, approved: true }]], [2, [{ productNo: 102, metaProductId: "P102", x: 0.6, y: 0.7, approved: true }]]]);
  const out = await job(graph, { readFeedFolder: ready(m), write: true, env: ON });
  assert.deepEqual(state.posts, [{ child: "c1", tags: ["P101"] }, { child: "c2", tags: ["P102"] }]);
  assert.deepEqual([out.record.publish.state, out.record.tags.state, out.record.tags.writeRuns], ["PUBLISHED", "TAG_VERIFIED", 1]);
  assert.deepEqual(out.record.tags.tags.map((t) => t.approval.variant), ["APPROVED_IN_READBACK", "APPROVED_IN_READBACK"]);
  const again = await runTagJob({ record: out.record, graph, readFeedFolder: ready(m), getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.deepEqual([again.step, state.posts.length], ["done", 2]);
});

test("folder already moved to UPLOADED by the upload automation: tags still applied from there", async () => {
  const { graph, state } = fakeGraph();
  const out = await job(graph, { readFeedFolder: ready(mapping(), manifest, "UPLOADED", UPLOADED_PATH), write: true, env: ON });
  assert.deepEqual([out.record.files.location, out.record.files.path, out.record.tags.state, state.posts.length], ["UPLOADED", UPLOADED_PATH, "TAG_VERIFIED", 1]);
});

test("uncertain POST survives a folder move and manual rerun without another POST", async () => {
  const { graph, state } = fakeGraph({ postFailures: [new GraphError(503, { error: { code: 2 } })] });
  const m = mapping([[1, [{ productNo: 101, metaProductId: "P101", x: 0.5, y: 0.5, approved: true }]], [2, [{ productNo: 102, metaProductId: "P102", x: 0.5, y: 0.5, approved: true }]]]);
  const first = await job(graph, { readFeedFolder: ready(m), write: true, env: ON });
  assert.deepEqual([first.record.files.location, first.record.tags.state], ["READY", "POST_OUTCOME_UNKNOWN"]);
  assert.deepEqual(first.record.tags.tags.map((t) => t.state), ["POST_OUTCOME_UNKNOWN", "PENDING"]);
  const second = await runTagJob({ record: first.record, graph, readFeedFolder: ready(m, manifest, "UPLOADED", UPLOADED_PATH), getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.equal(second.record.files.location, "UPLOADED");
  assert.deepEqual([second.step, second.record.tags.state, state.posts.map((p) => p.tags)], ["post_outcome_unknown", "POST_OUTCOME_UNKNOWN", [["P101"]]]);
});

test("run cap still blocks a never-attempted pending record", async () => {
  const { graph, state } = fakeGraph();
  const capped = await job(graph, { record: { ...record(), tags: { state: "PENDING", writeRuns: MAX_WRITE_RUNS } }, write: true, env: ON });
  assert.deepEqual([capped.record.tags.state, capped.record.tags.reason, state.posts.length], ["TAG_REVIEW_REQUIRED", "max_write_runs", 0]);
});

test("a successful POST acknowledgement with no visible tag is held, not automatically posted again", async () => {
  const { graph, state } = fakeGraph();
  const post = graph.post;
  graph.post = async (...args) => { const ack = await post(...args); state.tags.c1 = []; return ack; };
  const first = await job(graph, { write: true, env: ON });
  assert.equal(first.record.tags.state, "POST_OUTCOME_UNKNOWN");
  assert.equal(first.record.tags.tags[0].reason, "readback_missing");
  const next = await job(graph, { record: first.record, write: true, env: ON });
  assert.equal(next.step, "post_outcome_unknown");
  assert.equal(state.posts.length, 1);
});

test("failed POST read-back persists an explicit hold across service restarts and autorun", async () => {
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-")));
  const { graph, state } = fakeGraph();
  const get = graph.get;
  let failReadback = true;
  graph.get = async (path, params) => { if (failReadback && state.posts.length && path.endsWith("/product_tags")) throw new Error("read-back down"); return get(path, params); };
  const config = { graph, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, store, env: ON, now: () => AFTER };
  await store.put(record());
  const first = await createProductTagService(config).run("TAEGLOBAL-26AW");
  assert.equal(first.record.tags.state, "POST_OUTCOME_UNKNOWN");
  const partial = await store.get("TAEGLOBAL-26AW");
  assert.deepEqual([partial.publish.state, partial.tags.writeRuns, partial.tags.tags[0].state], ["PUBLISHED", 1, "POST_OUTCOME_UNKNOWN"]);
  failReadback = false;
  const restarted = createProductTagService(config);
  assert.deepEqual(await restarted.tick(), []);
  assert.equal((await restarted.autoMap("TAEGLOBAL-26AW", {})).error, "post_outcome_unknown");
  assert.equal((await restarted.approveAutoMap("TAEGLOBAL-26AW", [], "operator", "old")).error, "post_outcome_unknown");
  const reconciled = await restarted.run("TAEGLOBAL-26AW");
  assert.equal(reconciled.record.tags.state, "TAG_VERIFIED");
  assert.equal(reconciled.record.tags.images[0].attempts.length, 1);
  assert.equal(state.posts.length, 1);
});

test("hold is durable before POST even when the final state save fails", async () => {
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-")));
  const { graph, state } = fakeGraph();
  await store.put(record());
  const post = graph.post;
  graph.post = async (...args) => {
    const checkpoint = await store.get("TAEGLOBAL-26AW");
    assert.equal(checkpoint.tags.state, "POST_OUTCOME_UNKNOWN");
    assert.equal(checkpoint.tags.tags[0].state, "POST_OUTCOME_UNKNOWN");
    return post(...args);
  };
  const config = { graph, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, store, env: ON, now: () => AFTER };
  const failingStore = { ...store, put: async (rec) => { if (state.posts.length) throw Error("disk unavailable"); await store.put(rec); } };
  await assert.rejects(createProductTagService({ ...config, store: failingStore }).run("TAEGLOBAL-26AW"), /disk unavailable/);
  assert.equal((await store.get("TAEGLOBAL-26AW")).tags.state, "POST_OUTCOME_UNKNOWN");
  // Even a stale Graph GET that cannot see the already attempted tag must never trigger another POST.
  state.tags.c1 = [];
  const restarted = createProductTagService(config);
  assert.equal((await restarted.run("TAEGLOBAL-26AW")).step, "post_outcome_unknown");
  assert.deepEqual(await restarted.tick(), []);
  assert.equal(state.posts.length, 1);
});

test("checkpoint write failure prevents the external POST", async () => {
  const { graph, state } = fakeGraph();
  const store = { ...createPostStore(await mkdtemp(join(tmpdir(), "ptag-"))),
    get: async () => record(), put: async () => { throw Error("disk unavailable"); } };
  const svc = createProductTagService({ graph, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, store, env: ON, now: () => AFTER });
  await assert.rejects(svc.run("TAEGLOBAL-26AW"), /disk unavailable/);
  assert.equal(state.posts.length, 0);
});

test("one failed final save cannot overwrite the checkpoint with the old pending record", async () => {
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-")));
  const { graph, state } = fakeGraph();
  await store.put(record());
  let failed = false;
  const flaky = { ...store, put: async (rec) => {
    if (rec.tags.state === "TAG_VERIFIED" && !failed) { failed = true; throw Error("final save failed once"); }
    await store.put(rec);
  } };
  const config = { graph, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, store: flaky, env: ON, now: () => AFTER };
  assert.equal((await createProductTagService(config).run("TAEGLOBAL-26AW")).error, "final save failed once");
  assert.equal((await store.get("TAEGLOBAL-26AW")).tags.state, "TAG_VERIFIED");
  state.tags.c1 = [];
  assert.equal((await createProductTagService(config).run("TAEGLOBAL-26AW")).step, "done");
  assert.equal(state.posts.length, 1);
});

test("same folder twice at once: second run does nothing", async () => {
  const { graph, state } = fakeGraph();
  let release;
  const slow = () => new Promise((r) => { release = () => r({ location: "READY", path: READY_PATH, manifest, mapping: mapping() }); });
  const a = job(graph, { readFeedFolder: slow, write: true, env: ON });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await job(graph, { write: true, env: ON })).step, "already_running");
  release();
  await a;
  assert.equal(state.posts.length, 1);
});

test("Dropbox: READY first, else the one UPLOADED folder; list and download only", async () => {
  const calls = [];
  const box = (uploaded, readyHas = false) => createFeedDropbox({ getToken: async () => "T", feedDir: "/F", fetchImpl: async (url, init) => {
    calls.push(url.split("/2/")[1]);
    if (url.endsWith("/list_folder")) return { ok: true, status: 200, json: async () => ({ entries: uploaded.map((name) => ({ ".tag": "folder", name })), has_more: false }) };
    const path = JSON.parse(init.headers["Dropbox-API-Arg"]).path;
    const found = (readyHas && path.startsWith("/F/READY/")) || (path.startsWith("/F/UPLOADED/") && path.endsWith("manifest.json"));
    return found ? { ok: true, status: 200, text: async () => JSON.stringify(manifest) } : { ok: false, status: 409, text: async () => '{"error_summary":"path/not_found/"}' };
  } });
  const r1 = await box([], true).readFeedFolder("TAEGLOBAL-26AW");
  assert.deepEqual([r1.location, r1.path], ["READY", "/F/READY/TAEGLOBAL-26AW"]);
  const r2 = await box(["20261027-162640 SUNDAY-OFF-CLUB-26AW", "20261028-201500 TAEGLOBAL-26AW", "TAEGLOBAL-26AW copy", "x TAEGLOBAL-26AW"]).readFeedFolder("TAEGLOBAL-26AW");
  assert.deepEqual([r2.location, r2.path, r2.mapping], ["UPLOADED", UPLOADED_PATH, null]);
  assert.equal((await box(["20261028-201500 TAEGLOBAL-26AW", "20261029-101500 TAEGLOBAL-26AW"]).readFeedFolder("TAEGLOBAL-26AW")).reason, "uploaded_folder_ambiguous");
  assert.equal((await box([]).readFeedFolder("TAEGLOBAL-26AW")).reason, "folder_not_found");
  await assert.rejects(box([]).readFeedFolder("../x"), /invalid folder name/);
  assert.deepEqual([...new Set(calls)].sort(), ["files/download", "files/list_folder"]);
});

test("service: register once, run unknown folder, errors recorded, tick skips future and finished posts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-"));
  const store = createPostStore(dir);
  let now = AFTER;
  const { graph } = fakeGraph();
  const svc = createProductTagService({ graph, dropbox: { readFeedFolder: ready(mapping([])) }, getCafe24Product: cafe24, store, env: {}, now: () => now });
  const input = { folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2 };
  assert.equal((await svc.register(input)).ok, true);
  assert.equal((await svc.register(input)).existing, true);
  assert.equal((await svc.register({ ...input, folderName: "B", slotIso: "2099-01-01T00:00:00Z" })).ok, true);
  assert.deepEqual(await svc.run("NOPE"), { ok: false, error: "not_registered" });
  const ticked = await svc.tick();
  assert.deepEqual(ticked.map((t) => [t.folderName, t.record.tags.state]), [["TAEGLOBAL-26AW", "NO_TAGS"]]);
  assert.deepEqual(await svc.tick(), [], "final records and future slots are skipped");
  assert.equal(JSON.parse(await readFile(join(dir, "TAEGLOBAL-26AW.json"), "utf8")).publish.state, "PUBLISHED");
  const broken = createProductTagService({ graph: { get: async () => { throw new Error("graph down"); } }, dropbox: {}, getCafe24Product: cafe24, store, env: {}, now: () => now });
  const failed = await broken.run("B");
  assert.equal(failed.ok, false);
  assert.equal((await store.get("B")).lastError.message, "graph down");
});

test("server wiring: internal auth, autorun off by default, feed files never written or moved", async () => {
  const src = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('if (["/api/instagram-product-tags/posts"'), src.indexOf('if (url.pathname === "/api/cafe24/brands")'));
  assert.match(block, /if \(!isAuthorizedInternalRequest\(req\) && !isTagRegistrationRequest\(req, url\.pathname\)\) return json\(res, \{ error: "Unauthorized" \}, 401\);/);
  assert.match(src, /if \(env\.INSTAGRAM_PRODUCT_TAG_AUTORUN === "on"\) setInterval\(\(\) => productTags\.tick\(\)/);
  const runner = await readFile(new URL("../scripts/instagram-product-tag-runner.mjs", import.meta.url), "utf8");
  assert.equal(/files\/(upload|delete|move|copy|create_folder)/.test(runner), false, "runner never writes, moves or deletes feed files");
  assert.equal(/INSTAGRAM_FEED_UPLOADED_MOVE|9333|chromium|playwright/i.test(runner + block), false, "no move gate, no Chrome");
});

test("auto mapping: proposal held until a person approves, then tagged and verified; folder file wins", async () => {
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-")));
  const { graph, state } = fakeGraph();
  let folderMapping = null;
  const svc = createProductTagService({ graph, dropbox: { readFeedFolder: async () => ({ location: "UPLOADED", path: UPLOADED_PATH, manifest, mapping: folderMapping }) }, getCafe24Product: cafe24, store, env: ON, now: () => AFTER });
  await svc.register({ folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2, acceptUnverifiedVariantApproval: true });
  const findings = { schemaVersion: 1, folderName: "TAEGLOBAL-26AW", analyzer: "test", slides: [
    { order: 1, savedAsset: "assets/01.jpg", items: [{ label: "jacket", x: 0.5, y: 0.3, candidates: [{ productNo: 101, confidence: 0.95, evidence: "print" }] }] },
    { order: 2, savedAsset: "assets/02.jpg", items: [{ label: "pants", x: 0.5, y: 0.7, candidates: [{ productNo: 102, confidence: 0.7 }, { productNo: 103, confidence: 0.65 }] }] }] };
  const made = await svc.autoMap("TAEGLOBAL-26AW", findings);
  assert.deepEqual(made.mapping.slides.map((s) => s.tags.map((t) => [t.status, t.approved, t.metaProductId])), [[["PROPOSED", false, "P101"]], [["TAG_REVIEW_REQUIRED", false, "P102"]]]);
  const held = await svc.run("TAEGLOBAL-26AW");
  assert.deepEqual([held.record.tags.reason, held.record.files.mappingSource, state.posts.length], ["auto_mapping_not_approved", "auto", 0]);
  const builtAt = made.mapping.source.builtAt;
  assert.deepEqual((await svc.approveAutoMap("TAEGLOBAL-26AW", [{ order: 2, productNo: 102 }], "op", builtAt)).problems, ["not_proposed:2:102"]);
  assert.equal((await svc.approveAutoMap("TAEGLOBAL-26AW", [{ order: 1, productNo: 101 }], "", builtAt)).ok, false);
  // Approval and a run at the same time: serialized per folder, neither loses the other's change.
  const [approved, ran] = await Promise.all([svc.approveAutoMap("TAEGLOBAL-26AW", [{ order: 1, productNo: 101 }], "op", builtAt), svc.run("TAEGLOBAL-26AW")]);
  assert.deepEqual([approved.ok, ran.record.tags.state], [true, "TAG_VERIFIED"]);
  assert.equal((await store.get("TAEGLOBAL-26AW")).tags.state, "TAG_VERIFIED");
  const done = await svc.get("TAEGLOBAL-26AW");
  assert.deepEqual([done.tags.state, done.files.mappingSource, state.posts], ["TAG_VERIFIED", "auto", [{ child: "c1", tags: ["P101"] }]]);
  assert.equal((await store.get("TAEGLOBAL-26AW")).autoMapping.source.state, "APPROVED");
  assert.equal((await svc.autoMap("TAEGLOBAL-26AW", findings)).error, "tags_final");
  // A product-tags.json in the folder is used instead of any auto mapping.
  folderMapping = mapping([]);
  await svc.register({ folderName: "B-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2 });
  await svc.autoMap("B-26AW", { ...findings, folderName: "B-26AW" });
  const b = await svc.run("B-26AW");
  assert.deepEqual([b.record.files.mappingSource, b.record.tags.state], ["folder", "NO_TAGS"]);
});

const scheduledProposal = (over={}) => ({schemaVersion:1,folderName:manifest.folderName,brand:'TAEGLOBAL',preparedBy:'Claude existing schedule preparation',mappings:manifest.items.map(m=>({slideIndex:m.order,savedAsset:m.savedAsset,productNo:101,variantCode:'BK',color:'BLACK',option:'M',x:.5,y:.5,evidence:'reused verified zipper/panel match',confidence:.9,reviewRequired:false})),...over});
const scheduledInput = p => ({folderName:manifest.folderName,slotIso:SLOT,caption:CAPTION,slideCount:2,mappingProposal:p});
const serviceForProposal = async ({graph=fakeGraph().graph,getCafe24Product=cafe24,env=ON}={})=>createProductTagService({graph,dropbox:{readFeedFolder:ready(null)},getCafe24Product,env,store:createPostStore(await mkdtemp(join(tmpdir(),'scheduled-proposal-')))});

test('schedule proposal: no key/model, publish detection and fresh validation; human approval required even with WRITES on',async()=>{
 const {graph,state}=fakeGraph();const service=await serviceForProposal({graph,env:{...ON,INSTAGRAM_PRODUCT_TAG_VISION:'on',OPENAI_API_KEY:'must-never-be-used'}});
 const input=scheduledInput(scheduledProposal());input.acceptUnverifiedVariantApproval=true;input.approved=true;
 const made=await service.register(input);assert.equal(made.record.approvals.acceptUnverifiedVariantApproval,false);
 const result=await service.run(input.folderName);
 assert.equal(result.record.publish.state,'PUBLISHED');assert.equal(result.record.tags.state,'TAG_REVIEW_REQUIRED');assert.equal(state.posts.length,0);
 assert.equal(result.record.autoMapping.source.state,'AWAITING_HUMAN_APPROVAL');assert.ok(result.record.autoMapping.slides.every(s=>s.tags.every(t=>!t.approved && t.status==='PROPOSED')));
 assert.equal((await service.register(input)).existing,true);
 assert.equal((await service.register({...input,mappingProposal:scheduledProposal({preparedBy:'changed'})})).ok,false);
});

test('uncertain items, exact option mismatch and API failures cannot be approved',async()=>{
 for(const mode of ['review','variant','api']) {
  const {graph,state}=fakeGraph();const p=scheduledProposal();
  if(mode==='review')p.mappings[0].reviewRequired=true;
  if(mode==='variant')p.mappings[0].variantCode='OTHER';
  if(mode==='api'){const get=graph.get.bind(graph);graph.get=async(path,p)=>{if(path.endsWith('/catalog_product_search'))throw new Error('unavailable');return get(path,p);};}
  const service=await serviceForProposal({graph});await service.register(scheduledInput(p));const out=await service.run(p.folderName);
  assert.equal(out.record.tags.state,'TAG_REVIEW_REQUIRED');assert.equal(state.posts.length,0);
  const refused=await service.approveAutoMap(p.folderName,[{order:1,productNo:101}],'human',out.record.autoMapping?.source.builtAt);
  assert.equal(refused.ok,false);assert.equal(state.posts.length,0);
 }
});

test('human approval checks builtAt and CURRENT stock; historical proposal stock is not current',async()=>{
 const {graph,state}=fakeGraph();let inStock=true;
 const getCafe24Product=async no=>{const row=await cafe24(no);return {...row,options:row.options.map(o=>({...o,available:inStock}))};};
 const service=await serviceForProposal({graph,getCafe24Product});const p=scheduledProposal();await service.register(scheduledInput(p));
 const proposal=(await service.run(p.folderName)).record.autoMapping;
 assert.equal((await service.approveAutoMap(p.folderName,[{order:1,productNo:101}],'human','old')).ok,false);
 inStock=false;assert.equal((await service.approveAutoMap(p.folderName,[{order:1,productNo:101}],'human',proposal.source.builtAt)).ok,false);
 inStock=true;assert.equal((await service.approveAutoMap(p.folderName,[{order:1,productNo:101}],'human',proposal.source.builtAt)).ok,true);
 const after=await service.run(p.folderName);assert.equal(after.record.tags.applyReason,'variant_approval_unverified');assert.equal(state.posts.length,0);
});

test('proposal registration is serialized, rejects malformed coordinates and preserves unknown holds',async()=>{
 const service=await serviceForProposal();const input=scheduledInput(scheduledProposal());
 const made=await Promise.all([service.register(input),service.register(input)]);assert.ok(made.every(m=>m.ok));assert.equal(made.filter(m=>m.existing).length,1);
 const bad=scheduledProposal();bad.mappings[0].x=2;assert.equal(newPostRecord(scheduledInput(bad)).ok,false);
 assert.equal((await service.register({...input,slotIso:'2026-11-01T11:00:00Z'})).ok,false);
});

test('legacy paid-vision opt-in never calls an analyzer',async()=>{
 const {graph,state}=fakeGraph();
 const out=await runTagJob({record:newPostRecord({...scheduledInput(undefined),autoTag:{brand:'TAEGLOBAL'}}).record,graph,readFeedFolder:ready(null),getCafe24Product:cafe24,env:{...ON,INSTAGRAM_PRODUCT_TAG_VISION:'on',OPENAI_API_KEY:'unused'},write:true,analyzeImages:()=>assert.fail('paid call forbidden')});
 assert.equal(out.record.tags.reason,'paid_vision_disabled');assert.equal(state.posts.length,0);
});

test('explicit human tag + separate variant acceptance permits existing runner; uncertain POST hold still persists',async()=>{
 for(const failure of [false,true]) {
  const {graph,state}=fakeGraph({postFailures:failure?[new GraphError(0,{})]:[]});const service=await serviceForProposal({graph});
  const p=scheduledProposal();await service.register(scheduledInput(p));const map=(await service.run(p.folderName)).record.autoMapping;
  assert.equal((await service.approveAutoMap(p.folderName,[{order:1,productNo:101},{order:2,productNo:101}],'human',map.source.builtAt,{acceptUnverifiedVariantApproval:true})).ok,true);
  const out=await service.run(p.folderName);assert.equal(out.record.tags.state,failure?'POST_OUTCOME_UNKNOWN':'TAG_VERIFIED');
  const attempts=state.posts.length;assert.equal(attempts,failure?1:2);
  await service.run(p.folderName);assert.equal(state.posts.length,attempts);
  assert.equal((await service.register(scheduledInput(p))).record.tags.state,failure?'POST_OUTCOME_UNKNOWN':'TAG_VERIFIED');
 }
});

test('preapproved folder file cannot bypass human approval of a new scheduled proposal',async()=>{
 const {graph,state}=fakeGraph();
 const rec=newPostRecord(scheduledInput(scheduledProposal())).record;
 const out=await runTagJob({record:rec,graph,readFeedFolder:ready(mapping()),getCafe24Product:cafe24,env:ON,write:true});
 assert.equal(out.record.tags.state,'TAG_REVIEW_REQUIRED');assert.equal(state.posts.length,0);
});

// NVRFRGT-26AW 2026-11-04: registered without a scheduling proposal (flag false), mapped with /automap and
// approved without the flag. The same picks + builtAt may later grant the flag, with the full candidate checks,
// keeping the approved mapping as it is; then the existing runner tags and verifies the post.
test("automap post approved without the variant flag: re-confirm grants it with candidate checks, mapping kept, runner tags", async () => {
  const { graph, state } = fakeGraph();
  let inStock = true;
  const getCafe24Product = async (no) => { const row = await cafe24(no); return { ...row, options: row.options.map((o) => ({ ...o, available: inStock })) }; };
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-nvr-")));
  const svc = createProductTagService({ graph, dropbox: { readFeedFolder: async () => ({ location: "READY", path: UPLOADED_PATH, manifest, mapping: null }) }, getCafe24Product, store, env: ON, now: () => AFTER });
  assert.equal((await svc.register({ folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2 })).record.approvals.acceptUnverifiedVariantApproval, false);
  const findings = { schemaVersion: 1, folderName: "TAEGLOBAL-26AW", analyzer: "test", slides: [1, 2].map((order) => ({ order, savedAsset: `assets/0${order}.jpg`, items: [{ label: "jacket", x: 0.5, y: 0.3, candidates: [{ productNo: 101, confidence: 0.95, evidence: "origin url" }] }] })) };
  const built = (await svc.autoMap("TAEGLOBAL-26AW", findings)).mapping.source.builtAt;
  const picks = [{ order: 1, productNo: 101 }, { order: 2, productNo: 101 }];
  assert.equal((await svc.approveAutoMap("TAEGLOBAL-26AW", picks, "op", built)).ok, true);
  const approved = (await store.get("TAEGLOBAL-26AW")).autoMapping;
  const blocked = await svc.run("TAEGLOBAL-26AW");
  assert.deepEqual([blocked.record.tags.state, blocked.record.tags.applyReason, state.posts.length], ["PENDING", "variant_approval_unverified", 0]);
  // Refusals leave the flag off and the mapping untouched.
  const refusals = [
    [picks, "op", "old", ["mapping_changed"]],
    [picks.slice(0, 1), "op", built, ["not_selected:2:101"]],
    [[...picks, { order: 2, productNo: 999 }], "op", built, ["unknown_tag:2:999"]],
    [picks, "", built, ["approver_required"]]
  ];
  for (const [p, by, b, problems] of refusals) assert.deepEqual((await svc.approveAutoMap("TAEGLOBAL-26AW", p, by, b, { acceptUnverifiedVariantApproval: true })).problems, problems);
  inStock = false;
  assert.deepEqual((await svc.approveAutoMap("TAEGLOBAL-26AW", picks, "op", built, { acceptUnverifiedVariantApproval: true })).problems, ["cafe24_option_out_of_stock"]);
  inStock = true;
  let rec = await store.get("TAEGLOBAL-26AW");
  assert.deepEqual([rec.approvals.acceptUnverifiedVariantApproval, rec.autoMapping], [false, (await store.get("TAEGLOBAL-26AW")).autoMapping]);
  assert.deepEqual(rec.autoMapping.slides.map((s) => s.tags.map((t) => [t.productNo, t.status, t.approved])), approved.slides.map((s) => s.tags.map((t) => [t.productNo, t.status, t.approved])));
  // Without the flag nothing changes for an approved mapping (old behavior: re-approval of PENDING tags is refused).
  assert.equal((await svc.approveAutoMap("TAEGLOBAL-26AW", picks, "op", built)).ok, false);
  const ok = await svc.approveAutoMap("TAEGLOBAL-26AW", picks, "op", built, { acceptUnverifiedVariantApproval: true });
  assert.equal(ok.ok, true);
  rec = await store.get("TAEGLOBAL-26AW");
  assert.equal(rec.approvals.acceptUnverifiedVariantApproval, true);
  assert.deepEqual(rec.autoMapping, { ...approved }, "approved mapping kept byte for byte");
  const done = await svc.run("TAEGLOBAL-26AW");
  assert.deepEqual([done.record.tags.state, state.posts.length], ["TAG_VERIFIED", 2]);
  assert.equal((await svc.approveAutoMap("TAEGLOBAL-26AW", picks, "op", built, { acceptUnverifiedVariantApproval: true })).error, "tags_final");
});

test("variant flag on a not-yet-approved automap mapping: normal approval plus candidate checks", async () => {
  const { graph, state } = fakeGraph();
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-nvr2-")));
  const svc = createProductTagService({ graph, dropbox: { readFeedFolder: async () => ({ location: "READY", path: UPLOADED_PATH, manifest, mapping: null }) }, getCafe24Product: cafe24, store, env: ON, now: () => AFTER });
  await svc.register({ folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2 });
  const findings = { schemaVersion: 1, folderName: "TAEGLOBAL-26AW", analyzer: "test", slides: [{ order: 1, savedAsset: "assets/01.jpg", items: [{ label: "jacket", x: 0.5, y: 0.3, candidates: [{ productNo: 101, confidence: 0.95, evidence: "x" }] }] }, { order: 2, savedAsset: "assets/02.jpg", items: [] }] };
  const built = (await svc.autoMap("TAEGLOBAL-26AW", findings)).mapping.source.builtAt;
  assert.equal((await svc.approveAutoMap("TAEGLOBAL-26AW", [{ order: 1, productNo: 101 }], "op", built, { acceptUnverifiedVariantApproval: true })).ok, true);
  assert.equal((await store.get("TAEGLOBAL-26AW")).approvals.acceptUnverifiedVariantApproval, true);
  assert.deepEqual([(await svc.run("TAEGLOBAL-26AW")).record.tags.state, state.posts.length], ["TAG_VERIFIED", 1]);
});

// CARNET / AZVA shape: proposal registration + AUTO_APPROVE. The fix must not change that path.
test("regression: proposal + AUTO_APPROVE (CARNET/AZVA path) still auto-approves, sets the flag and tags", async () => {
  const { graph, state } = fakeGraph();
  const service = await serviceForProposal({ graph, env: { ...ON, INSTAGRAM_PRODUCT_TAG_AUTO_APPROVE: "on" } });
  const p = scheduledProposal();
  assert.equal((await service.register(scheduledInput(p))).record.approvals.acceptUnverifiedVariantApproval, false);
  const out = await service.run(p.folderName);
  assert.equal(out.record.autoApproval.approved, 2);
  assert.equal(out.record.approvals.acceptUnverifiedVariantApproval, true);
  assert.deepEqual([out.record.tags.state, state.posts.length], ["TAG_VERIFIED", 2]);
});


test("partial batch survives restart and explicit recovery sends only missing IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-recovery-"));
  const store = createPostStore(dir);
  const { graph, state } = fakeGraph();
  const post = graph.post;
  graph.post = async (path, params) => {
    const ack = await post(path, params);
    if (state.posts.length === 1) state.tags.c1 = state.tags.c1.filter((tag) => tag.product_id === "P101");
    return ack;
  };
  const tag = (productNo) => ({ productNo, metaProductId: `P${productNo}`, x: 0.5, y: 0.5, approved: true });
  const m = mapping([[1, [tag(101), tag(102)]], [2, [tag(103)]]]);
  const config = { graph, dropbox: { readFeedFolder: ready(m) }, getCafe24Product: cafe24, store, env: ON, now: () => AFTER };
  await store.put(record());
  const first = await createProductTagService(config).run("TAEGLOBAL-26AW");
  assert.deepEqual(first.record.tags.counts, { planned: 3, verified: 2, excluded: 0 });
  assert.equal(first.record.tags.outcome, "PARTIAL");
  assert.deepEqual(first.record.tags.images.map((image) => image.state), ["FAILED", "VERIFIED"]);
  const restarted = createProductTagService({ ...config, store: createPostStore(dir) });
  assert.equal((await restarted.run("TAEGLOBAL-26AW")).record.tags.state, "POST_OUTCOME_UNKNOWN");
  assert.equal(state.posts.length, 2);
  const drifted = structuredClone(m);
  drifted.slides[0].tags[1].x = 0.7;
  const prepare = async () => {
    const inspection = await restarted.run("TAEGLOBAL-26AW", { write: false });
    const review = { planIdentity: inspection.record.tags.planIdentity, writeRuns: 1, targets: inspection.recoveryPreview };
    const approval = await restarted.run("TAEGLOBAL-26AW", { approve: true, review });
    assert.equal(approval.ok, true);
    return { recover: true, review, approvalId: approval.approvalId };
  };
  const approved = await prepare();
  assert.equal((await restarted.run("TAEGLOBAL-26AW", { ...approved, review: { ...approved.review, writeRuns: 2 } })).error, "recovery_review_changed");
  for (const change of [{ productId: "P101" }, { x: 0.7 }]) {
    const altered = { ...approved.review, targets: [{ ...approved.review.targets[0], ...change }] };
    assert.equal((await restarted.run("TAEGLOBAL-26AW", { ...approved, review: altered })).error, "recovery_approval_invalid");
  }
  const wrong = createProductTagService({ ...config, dropbox: { readFeedFolder: ready(drifted) } });
  assert.equal((await wrong.run("TAEGLOBAL-26AW", approved)).step, "recovery_plan_mismatch");
  assert.equal(state.posts.length, 2);
  assert.equal((await restarted.run("TAEGLOBAL-26AW", approved)).error, "recovery_approval_invalid");
  const recovered = await restarted.run("TAEGLOBAL-26AW", await prepare());
  assert.deepEqual(state.posts.map((item) => item.tags), [["P101", "P102"], ["P103"], ["P102"]]);
  assert.deepEqual(recovered.record.tags.counts, { planned: 3, verified: 3, excluded: 0 });
  assert.equal(recovered.record.tags.outcome, "COMPLETE");
  assert.deepEqual(recovered.record.tags.images.map((image) => image.attempts.length), [2, 1]);
  assert.equal((await store.get("TAEGLOBAL-26AW")).tags.writeRuns, 2);
});

test("catalog and variant exclusions are reported separately without suppressing a valid tag", async () => {
  const { graph, state } = fakeGraph();
  const get = graph.get;
  graph.get = (path, params) => path === `${IG}/catalog_product_search` && params.q === "102" ? { data: [] } : get(path, params);
  const tag = (productNo) => ({ productNo, metaProductId: `P${productNo}`, x: 0.5, y: 0.5, approved: true });
  const m = mapping([[1, [tag(101), tag(102)]], [2, [tag(103)]]]);
  const getCafe24Product = async (no) => no === 103 ? { ...(await cafe24(no)), options: [] } : cafe24(no);
  const out = await job(graph, { readFeedFolder: ready(m), getCafe24Product, write: true, env: ON });
  assert.deepEqual(state.posts.map((item) => item.tags), [["P101"]]);
  assert.deepEqual(out.record.tags.counts, { planned: 1, verified: 1, excluded: 2 });
  assert.deepEqual(out.record.tags.excluded.map((tag) => tag.reason), ["meta_product_id_not_in_group", "cafe24_option_not_found"]);
  assert.equal(out.record.tags.outcome, "PARTIAL");
  assert.equal(out.record.tags.state, "POST_OUTCOME_UNKNOWN");
});

test("legacy hold can reconcile late readback but has no automatic or explicit write eligibility", async () => {
  const { graph, state } = fakeGraph();
  const old = record();
  old.publish = { state: "PUBLISHED", mediaId: "m1" };
  old.tags = { state: "POST_OUTCOME_UNKNOWN", writeRuns: 1, tags: [
    { order: 1, productNo: 101, productId: "P101", state: "POST_OUTCOME_UNKNOWN", reason: "readback_missing" }
  ] };
  const absent = await job(graph, { record: old, recover: true, write: true, env: ON });
  assert.equal(absent.record.tags.state, "POST_OUTCOME_UNKNOWN");
  assert.equal(absent.record.tags.tags[0].state, "POST_OUTCOME_UNKNOWN");
  assert.equal(state.posts.length, 0);
  state.tags.c1 = [{ product_id: "P101", x: 0.5, y: 0.5, review_status: "approved" }];
  const confirmed = await job(graph, { record: absent.record, write: true, env: ON });
  assert.equal(confirmed.record.tags.state, "TAG_VERIFIED");
  assert.equal(state.posts.length, 0);
});

test("automatically approved scheduled mapping records excluded catalog and variant selections", async () => {
  const { graph, state } = fakeGraph();
  const p = scheduledProposal();
  p.mappings[1].variantCode = "UNAVAILABLE";
  p.mappings.push({ ...p.mappings[1], productNo: 102, variantCode: "BK" });
  const get = graph.get;
  graph.get = (path, params) => path === `${IG}/catalog_product_search` && params.q === "102" ? { data: [] } : get(path, params);
  const service = await serviceForProposal({ graph, env: { ...ON, INSTAGRAM_PRODUCT_TAG_AUTO_APPROVE: "on" } });
  await service.register(scheduledInput(p));
  const { record: result } = await service.run(p.folderName);
  assert.deepEqual(state.posts.map((item) => item.tags), [["P101"]]);
  assert.deepEqual(result.tags.counts, { planned: 1, verified: 1, excluded: 2 });
  assert.deepEqual(result.tags.excluded.map((tag) => tag.reason), ["no_in_stock_option", "meta_product_not_found"]);
  assert.equal(result.tags.outcome, "PARTIAL");
  assert.equal(result.tags.state, "POST_OUTCOME_UNKNOWN");
});

test("independent processes preserve the shared lock through an old timestamp and release on owner death", { timeout: 10000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-lock-"));
  const ownerScript = `
    import { createPostStore } from ${JSON.stringify(new URL("../scripts/instagram-product-tag-runner.mjs", import.meta.url).href)};
    const store = createPostStore(process.argv[1]);
    const result = await store.withTagLock(async () => {
      if (process.argv[2] === "hold") {
        await store.put({ folderName: "held", tags: { state: "POST_OUTCOME_UNKNOWN", writeRuns: 1 } });
        console.log("post_in_flight");
        process.stdin.resume();
        await new Promise((resolve) => process.stdin.once("end", resolve));
      }
      return { ok: true };
    });
    console.log(JSON.stringify(result));
  `;
  const args = ["--input-type=module", "-e", ownerScript, dir];
  const owner = spawn(process.execPath, [...args, "hold"], { stdio: ["pipe", "pipe", "inherit"] });
  const exited = once(owner, "exit");
  t.after(async () => {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    await exited;
  });
  const [ready] = await once(owner.stdout, "data");
  assert.match(String(ready), /post_in_flight/);
  const old = new Date("2000-01-01T00:00:00Z");
  await utimes(join(dir, ".tag-writes.lock"), old, old);
  const contender = async () => JSON.parse((await promisify(execFile)(process.execPath, args)).stdout);
  assert.deepEqual(await contender(), { ok: false, error: "tag_lock_busy" });
  const denied = await Promise.all([contender(), contender(), contender()]);
  assert.deepEqual(denied, Array(3).fill({ ok: false, error: "tag_lock_busy" }));
  owner.kill("SIGKILL");
  assert.equal((await exited)[1], "SIGKILL");
  assert.deepEqual(await contender(), { ok: true });
  const { graph, state } = fakeGraph();
  const restarted = createProductTagService({ graph, store: createPostStore(dir),
    dropbox: { readFeedFolder: readyFolderForLockTest }, getCafe24Product: cafe24, env: ON, now: () => AFTER });
  assert.equal((await restarted.get("held")).tags.state, "POST_OUTCOME_UNKNOWN");
  assert.deepEqual(await restarted.tick(), []);
  assert.equal(state.posts.length, 0);
});

const readyFolderForLockTest = async () => { throw new Error("held checkpoint must skip Dropbox"); };

test("lock file storage failure blocks the service before Graph or POST", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-lock-failure-"));
  const store = createPostStore(dir);
  await store.put(record());
  await mkdir(join(dir, ".tag-writes.lock"));
  const { graph, state } = fakeGraph();
  graph.get = () => assert.fail("Graph must not be called");
  const svc = createProductTagService({ graph, store, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, env: ON });
  assert.deepEqual(await svc.run("TAEGLOBAL-26AW"), { ok: false, error: "tag_lock_unavailable" });
  assert.equal(state.posts.length, 0);
});

test("a held media claim blocks writes through another folder after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-alias-"));
  const store = createPostStore(dir);
  const first = record();
  first.publish = { state: "PUBLISHED", mediaId: "m1" };
  first.tags = { state: "POST_OUTCOME_UNKNOWN", writeRuns: 1 };
  await store.put(first);
  const other = { ...record(), folderName: "ALT-FOLDER", publish: first.publish };
  await store.put(other);
  const { graph, state } = fakeGraph();
  const svc = createProductTagService({ graph, store: createPostStore(dir),
    dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, env: ON, now: () => AFTER });
  assert.equal((await svc.run(other.folderName)).error, "tag_media_owned_by_another_record");
  assert.equal(state.posts.length, 0);
});

test("internal recovery route and automatic run share the lock and preserve an existing tag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-manual-lock-"));
  const store = createPostStore(dir);
  const { graph, state } = fakeGraph();
  const existing = { product_id: "OTHER", x: 0.12, y: 0.34, review_status: "approved" };
  state.tags.c1.push({ ...existing });
  const post = graph.post;
  let first = true;
  graph.post = async (...args) => {
    if (first) {
      first = false;
      state.posts.push({ child: "c1", tags: ["P101"] });
      return { success: true };
    }
    return post(...args);
  };
  const config = { graph, store, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, env: ON, now: () => AFTER };
  await store.put(record());
  const service = createProductTagService(config);
  await service.run(manifest.folderName);
  const { createProductTagService: otherWorker } = await import("../scripts/instagram-product-tag-runner.mjs?manual-test-worker");
  const automatic = otherWorker({ ...config, store: createPostStore(dir) });
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf('        if (url.pathname === "/api/instagram-product-tags/run")');
  const end = source.indexOf('        if (req.method === "GET")', start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const route = new AsyncFunction("url", "req", "res", "readJsonBody", "productTags", "json", source.slice(start, end));
  const request = (body) => route({ pathname: "/api/instagram-product-tags/run" }, { method: "POST" }, null,
    async () => ({ folderName: manifest.folderName, ...body }), service, (_, payload, status) => ({ payload, status }));
  const inspection = await request({ mode: "inspect" });
  assert.equal(inspection.status, 200);
  assert.equal(state.posts.length, 1);
  const { planIdentity, writeRuns } = inspection.payload.record.tags;
  const review = { planIdentity, writeRuns, targets: inspection.payload.recoveryPreview };
  assert.equal((await request({ mode: "recover_missing", ...review })).status, 400);
  assert.equal((await request({ mode: "approve_recovery", ...review, issuedAt: 0 })).status, 400);
  assert.equal((await request({ mode: "approve_recovery", ...review, expiresAt: 0 })).status, 400);
  const approved = await request({ mode: "approve_recovery", ...review });
  assert.equal(approved.status, 200);
  assert.equal(state.posts.length, 1);
  assert.equal(Date.parse(approved.payload.expiresAt) - AFTER, 600000);
  assert.equal(JSON.stringify(await service.get(manifest.folderName)).includes(approved.payload.approvalId), false);
  const recoverBody = { mode: "recover_missing", ...review, approvalId: approved.payload.approvalId };
  assert.equal((await request({ ...recoverBody, approvedAt: 0 })).status, 400);
  let started, release;
  const entered = new Promise((resolve) => { started = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  graph.post = async (...args) => { started(); await hold; return post(...args); };
  const recovery = request(recoverBody);
  await entered;
  try {
    assert.deepEqual(await automatic.run(manifest.folderName), { ok: false, error: "tag_lock_busy" });
    assert.deepEqual(await automatic.run(manifest.folderName, { recover: true, review, approvalId: approved.payload.approvalId }),
      { ok: false, error: "tag_lock_busy" });
    assert.deepEqual(await automatic.tick(), []);
    assert.equal((await automatic.register({ ...record(), folderName: "ANOTHER-FOLDER" })).ok, true);
  } finally { release(); }
  const recovered = await recovery;
  assert.equal(recovered.status, 200);
  assert.equal(recovered.payload.record.tags.state, "TAG_VERIFIED");
  assert.deepEqual(state.tags.c1.find((tag) => tag.product_id === "OTHER"), existing);
  assert.equal(state.posts.length, 2);
  assert.equal((await request(recoverBody)).status, 409);
});

test("expired recovery approvals persist across restart and require a fresh inspection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-expiry-"));
  const store = createPostStore(dir);
  const { graph, state } = fakeGraph({ postFailures: [new GraphError(500, {})] });
  let now = AFTER;
  const config = { graph, store, dropbox: { readFeedFolder: ready() }, getCafe24Product: cafe24, env: ON, now: () => now };
  await store.put(record());
  const name = manifest.folderName;
  const service = createProductTagService(config);
  await service.run(name);
  const inspection = await service.run(name, { write: false });
  const review = { planIdentity: inspection.record.tags.planIdentity, writeRuns: 1, targets: inspection.recoveryPreview };
  const approval = await service.run(name, { approve: true, review });
  assert.equal(approval.ok, true);
  assert.equal(Date.parse(approval.expiresAt), AFTER + 600000);
  now += 600000;
  const restarted = createProductTagService({ ...config, store: createPostStore(dir) });
  assert.equal((await restarted.run(name, { recover: true, review, approvalId: approval.approvalId })).error, "recovery_approval_expired");
  assert.equal((await restarted.run(name, { approve: true, review })).error, "recovery_review_changed");
  assert.equal(state.posts.length, 1);
  await restarted.run(name, { write: false });
  const fresh = await restarted.run(name, { approve: true, review });
  assert.equal(fresh.ok, true);
  assert.equal((await restarted.run(name, { recover: true, review, approvalId: approval.approvalId })).error, "recovery_approval_invalid");
  assert.equal((await restarted.run(name, { recover: true, review, approvalId: fresh.approvalId })).record.tags.state, "TAG_VERIFIED");
  assert.equal(state.posts.length, 2);
});

test("recovery expiry during Graph preflight prevents the pending POST", async () => {
  const store = createPostStore(await mkdtemp(join(tmpdir(), "ptag-expiry-preflight-")));
  const { graph, state } = fakeGraph({ postFailures: [new GraphError(500, {})] });
  const name = manifest.folderName;
  let now = AFTER;
  const service = createProductTagService({ graph, store, dropbox: { readFeedFolder: ready() },
    getCafe24Product: cafe24, env: ON, now: () => now });
  await store.put(record());
  await service.run(name);
  const inspection = await service.run(name, { write: false });
  const review = { planIdentity: inspection.record.tags.planIdentity, writeRuns: 1, targets: inspection.recoveryPreview };
  const approval = await service.run(name, { approve: true, review });
  const get = graph.get;
  graph.get = async (...args) => {
    now = Date.parse(approval.expiresAt);
    return get(...args);
  };
  const attempted = await service.run(name, { recover: true, review, approvalId: approval.approvalId });
  assert.equal(attempted.error, "recovery_approval_expired");
  assert.equal(state.posts.length, 1);
  assert.equal((await store.get(name)).recoveryApproval, undefined);
});

test('mixed-brand schedule proposal (NEW ARRIVALS): per-slide brand passes, missing brand reviews, no POST before approval',async()=>{
 const {graph:base,state}=fakeGraph();
 // Product 202 belongs to another brand; everything else is the TAEGLOBAL fake catalog.
 const graph={...base,async get(path,params={}){const out=await base.get(path,params);
  if(path==='G202/products')return {data:out.data.map(r=>({...r,name:'[GROSSI : 그로씨] item 202'}))};return out;}};
 const mixed=(brands)=>scheduledProposal({brand:'NEW ARRIVALS',mappings:manifest.items.map((m,i)=>({slideIndex:m.order,savedAsset:m.savedAsset,productNo:[101,202][i],...(brands[i]?{brand:brands[i]}:{}),variantCode:'BK',x:.5,y:.5,evidence:'site thumbnail of the exact product_no',confidence:.95,reviewRequired:false}))});
 const ok=await (await serviceForProposal({graph})).register(scheduledInput(mixed(['TAEGLOBAL','GROSSI'])));
 assert.equal(ok.ok,true);
 const service=await serviceForProposal({graph});await service.register(scheduledInput(mixed(['TAEGLOBAL','GROSSI'])));
 const run=await service.run(manifest.folderName);
 assert.deepEqual(run.record.autoMapping.slides.map(s=>s.tags.map(t=>[t.productNo,t.status,t.reason??null])),[[[101,'PROPOSED',null]],[[202,'PROPOSED',null]]]);
 assert.equal(run.record.autoMapping.source.state,'AWAITING_HUMAN_APPROVAL');assert.equal(state.posts.length,0);
 const other=await serviceForProposal({graph});await other.register(scheduledInput(mixed(['TAEGLOBAL',null])));
 const held=await other.run(manifest.folderName);
 assert.deepEqual(held.record.autoMapping.slides[1].tags.map(t=>[t.status,t.reason]),[['TAG_REVIEW_REQUIRED','brand_mismatch']]);
});
