// Feed post -> product tags runner against a fake Graph API and fake Dropbox. No network, no real POST.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphError, SAMPLAS_META, toTagCafe24View } from "../scripts/instagram-product-tags.mjs";
import { captionSha256, createFeedDropbox, createPostStore, createProductTagService, decideMove, findPublishedMedia, MAX_WRITE_RUNS, newPostRecord, runTagJob } from "../scripts/instagram-product-tag-runner.mjs";

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
      if (path === `${CATALOG}/products`) { const no = params.filter.retailer_product_group_id.eq; return { data: [{ id: `P${no}`, retailer_id: `${no}.BK`, name: `item ${no}`, availability: "in stock" }] }; }
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
const ready = (m = mapping(), man = manifest) => async () => ({ state: "FOUND", path: "/feed/READY/TAEGLOBAL-26AW", manifest: man, mapping: m });
const job = (graph, over = {}) => runTagJob({ record: record(), graph, readFolder: ready(), getCafe24Product: cafe24, now: AFTER, ...over });

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

test("not published yet: no folder read, no tag request", async () => {
  const { graph, state } = fakeGraph({ feed: [] });
  let reads = 0;
  const out = await job(graph, { now: Date.parse(SLOT) - 1, readFolder: async () => { reads++; return {}; }, write: true, env: ON });
  assert.deepEqual([out.step, out.record.publish.state, reads, state.posts.length], ["publish", "SCHEDULED", 0, 0]);
});

test("missing or short folder inputs hold the post; an empty mapping means no tags and may move", async () => {
  const { graph } = fakeGraph();
  const hold = async (readFolder) => (await job(graph, { readFolder })).record;
  assert.equal((await hold(ready(null))).tags.reason, "product_tags_missing");
  assert.equal((await hold(async () => ({ state: "FOUND", manifest: null, mapping: mapping() }))).tags.reason, "manifest_missing");
  assert.equal((await hold(ready(mapping(), { ...manifest, items: manifest.items.slice(0, 1) }))).tags.reason, "manifest_slide_count");
  assert.equal((await hold(ready(null))).moveAdvice.state, "HELD");
  const none = await hold(ready(mapping([])));
  assert.deepEqual([none.tags.state, none.moveAdvice], ["NO_TAGS", { state: "READY_TO_MOVE" }]);
  assert.equal(none.folder.path, "/feed/READY/TAEGLOBAL-26AW");
});

test("folder moved or mid-move: tags still run from UPLOADED, a missing folder retries, publish state untouched", async () => {
  const { graph, state } = fakeGraph();
  const missing = await job(graph, { readFolder: async () => ({ state: "NOT_FOUND" }), write: true, env: ON });
  assert.deepEqual([missing.step, missing.record.publish.state, missing.record.tags.state, missing.record.tags.reason, state.posts.length], ["folder", "PUBLISHED", "PENDING", "folder_not_found", 0]);
  const moved = async () => ({ state: "FOUND", path: "/feed/UPLOADED/20261028-201000 TAEGLOBAL-26AW", manifest, mapping: mapping() });
  const out = await runTagJob({ record: missing.record, graph, readFolder: moved, getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.deepEqual([out.record.tags.state, out.record.folder.path, state.posts.length], ["TAG_VERIFIED", "/feed/UPLOADED/20261028-201000 TAEGLOBAL-26AW", 1]);
  const two = await job(graph, { readFolder: async () => ({ state: "AMBIGUOUS", paths: ["/a 1", "/b 2"] }) });
  assert.deepEqual([two.record.tags.state, two.record.tags.reason, two.record.publish.state], ["TAG_REVIEW_REQUIRED", "folder_ambiguous", "PUBLISHED"]);
});

test("writes off: plan stays PENDING with the reason, nothing sent, folder held", async () => {
  const { graph, state } = fakeGraph();
  for (const [write, env, approve] of [[false, ON, true], [true, {}, true], [true, ON, false]]) {
    const out = await runTagJob({ record: record({ acceptUnverifiedVariantApproval: approve }), graph, readFolder: ready(), getCafe24Product: cafe24, now: AFTER, write, env });
    assert.deepEqual([out.record.tags.state, out.record.moveAdvice.state], ["PENDING", "HELD"]);
  }
  const blocked = await runTagJob({ record: record({ acceptUnverifiedVariantApproval: false }), graph, readFolder: ready(), getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.equal(blocked.record.tags.applyReason, "variant_approval_unverified");
  assert.equal(state.posts.length, 0);
});

test("full path: publish found, tags sent, read back, done; re-run does nothing", async () => {
  const { graph, state } = fakeGraph();
  const m = mapping([[1, [{ productNo: 101, metaProductId: "P101", x: 0.25, y: 0.4, approved: true }]], [2, [{ productNo: 102, metaProductId: "P102", x: 0.6, y: 0.7, approved: true }]]]);
  const out = await job(graph, { readFolder: ready(m), write: true, env: ON });
  assert.deepEqual(state.posts, [{ child: "c1", tags: ["P101"] }, { child: "c2", tags: ["P102"] }]);
  assert.deepEqual([out.record.publish.state, out.record.tags.state, out.record.tags.writeRuns, out.record.moveAdvice.state], ["PUBLISHED", "TAG_VERIFIED", 1, "READY_TO_MOVE"]);
  assert.deepEqual(out.record.tags.tags.map((t) => t.approval.variant), ["APPROVED_IN_READBACK", "APPROVED_IN_READBACK"]);
  let reads = 0;
  const again = await runTagJob({ record: out.record, graph, readFolder: async () => { reads++; return ready(m)(); }, getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.deepEqual([again.step, state.posts.length, reads], ["done", 2, 0]);
  assert.equal(decideMove({ publish: { state: "PUBLISHED" }, tags: { state: "TAG_REVIEW_REQUIRED" } }).reason, "tags:TAG_REVIEW_REQUIRED");
});

test("partial failure: verified tag kept, failed one retried next run, run cap holds the post", async () => {
  const { graph, state } = fakeGraph({ postFailures: [new GraphError(400, { error: { code: 100 } })] });
  const m = mapping([[1, [{ productNo: 101, metaProductId: "P101", x: 0.5, y: 0.5, approved: true }]], [2, [{ productNo: 102, metaProductId: "P102", x: 0.5, y: 0.5, approved: true }]]]);
  const first = await job(graph, { readFolder: ready(m), write: true, env: ON });
  assert.deepEqual(first.record.tags.tags.map((t) => `${t.productId}:${t.state}:${t.reason}`), ["P101:TAG_REVIEW_REQUIRED:post_failed:100", "P102:TAG_VERIFIED:null"]);
  assert.equal(first.record.moveAdvice.state, "HELD");
  const second = await runTagJob({ record: first.record, graph, readFolder: ready(m), getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.deepEqual(state.posts.map((p) => p.tags), [["P101"], ["P102"], ["P101"]]);
  assert.deepEqual([second.record.tags.state, second.record.tags.writeRuns], ["TAG_VERIFIED", 2]);

  const capped = await runTagJob({ record: { ...first.record, tags: { ...first.record.tags, writeRuns: MAX_WRITE_RUNS } }, graph: fakeGraph().graph, readFolder: ready(m), getCafe24Product: cafe24, now: AFTER, write: true, env: ON });
  assert.deepEqual([capped.record.tags.state, capped.record.tags.reason], ["TAG_REVIEW_REQUIRED", "max_write_runs"]);
});

test("same folder twice at once: second run does nothing", async () => {
  const { graph, state } = fakeGraph();
  let release;
  const slow = () => new Promise((r) => { release = () => r({ state: "FOUND", manifest, mapping: mapping() }); });
  const a = job(graph, { readFolder: slow, write: true, env: ON });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await job(graph, { write: true, env: ON })).step, "already_running");
  release();
  await a;
  assert.equal(state.posts.length, 1);
});

test("Dropbox: READY first, else exactly one UPLOADED/<stamp> <folder>; only metadata, list and download calls", async () => {
  const calls = [];
  const entries = [{ ".tag": "folder", name: "20261027-162600 ANT-ANTI", path_display: "/f/UPLOADED/20261027-162600 ANT-ANTI" },
    { ".tag": "folder", name: "20261028-201000 TAEGLOBAL-26AW", path_display: "/f/UPLOADED/20261028-201000 TAEGLOBAL-26AW" },
    { ".tag": "file", name: "20261028-201000 TAEGLOBAL-26AW.zip", path_display: "/f/UPLOADED/x" },
    { ".tag": "file", name: "1 TAEGLOBAL-26AW", path_display: "/f/UPLOADED/1 TAEGLOBAL-26AW" },
    { ".tag": "folder", name: "archive TAEGLOBAL-26AW", path_display: "/f/UPLOADED/archive TAEGLOBAL-26AW" },
    { ".tag": "folder", name: "20261029-120000 Kimyo-26aw", path_display: "/f/UPLOADED/20261029-120000 Kimyo-26aw" }];
  const nf = { ok: false, status: 409, text: async () => '{"error_summary":"path/not_found/"}' };
  const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  let readyExists = true;
  let extra = [];
  const fetchImpl = async (url, init) => {
    const arg = JSON.parse(init.headers["Dropbox-API-Arg"] || init.body);
    calls.push([url.split("/2/")[1], arg.path || arg.cursor]);
    if (url.endsWith("/get_metadata")) return readyExists ? ok({ ".tag": "folder" }) : nf;
    if (url.endsWith("/list_folder")) return ok({ entries: entries.slice(0, 2), has_more: true, cursor: "c1" });
    if (url.endsWith("/list_folder/continue")) return ok({ entries: [...entries.slice(2), ...extra], has_more: false });
    return /product-tags/.test(arg.path) ? nf : ok(manifest);
  };
  const box = createFeedDropbox({ getToken: async () => "T", fetchImpl, feedDir: "/f" });
  assert.deepEqual(await box.readFolder("TAEGLOBAL-26AW"), { state: "FOUND", path: "/f/READY/TAEGLOBAL-26AW", manifest, mapping: null });
  readyExists = false;
  assert.equal((await box.readFolder("TAEGLOBAL-26AW")).path, "/f/UPLOADED/20261028-201000 TAEGLOBAL-26AW");
  assert.equal((await box.readFolder("KIMYO-26AW")).path, "/f/UPLOADED/20261029-120000 Kimyo-26aw", "case ignored like Dropbox");
  assert.deepEqual(await box.readFolder("BLUEMARBLE-26AW"), { state: "NOT_FOUND" });
  extra = [{ ".tag": "folder", name: "20261101-200000 TAEGLOBAL-26AW", path_display: "/f/UPLOADED/20261101-200000 TAEGLOBAL-26AW" }];
  assert.equal((await box.readFolder("TAEGLOBAL-26AW")).state, "AMBIGUOUS");
  await assert.rejects(box.readFolder("../x"), /invalid folder name/);
  assert.deepEqual([...new Set(calls.map((c) => c[0]))].sort(), ["files/download", "files/get_metadata", "files/list_folder", "files/list_folder/continue"]);
});

test("service: register once, run unknown folder, errors recorded, tick skips future and finished posts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptag-"));
  const store = createPostStore(dir);
  let now = AFTER;
  const { graph } = fakeGraph();
  const svc = createProductTagService({ graph, dropbox: { readFolder: ready(mapping([])) }, getCafe24Product: cafe24, store, env: {}, now: () => now });
  const input = { folderName: "TAEGLOBAL-26AW", slotIso: SLOT, caption: CAPTION, slideCount: 2 };
  assert.equal((await svc.register(input)).ok, true);
  assert.deepEqual((await svc.register(input)).problems, ["already_registered"]);
  assert.equal((await svc.register({ ...input, folderName: "B", slotIso: "2099-01-01T00:00:00Z" })).ok, true);
  assert.deepEqual(await svc.run("NOPE"), { ok: false, error: "not_registered" });
  const ticked = await svc.tick();
  assert.deepEqual(ticked.map((t) => [t.folderName, t.record.tags.state, t.record.moveAdvice.state]), [["TAEGLOBAL-26AW", "NO_TAGS", "READY_TO_MOVE"]]);
  assert.deepEqual(await svc.tick(), [], "a finished post is not run again");
  // Published, folder missing for days, then it shows up: the tick keeps looking and tags it.
  const late = createPostStore(await mkdtemp(join(tmpdir(), "ptag-")));
  let found = false;
  const lateSvc = createProductTagService({ graph, dropbox: { readFolder: async () => (found ? ready(mapping([]))() : { state: "NOT_FOUND" }) }, getCafe24Product: cafe24, store: late, env: {}, now: () => now });
  await lateSvc.register(input);
  assert.equal((await lateSvc.tick())[0].record.folder.state, "NOT_FOUND");
  now = AFTER + 72 * 3600e3;
  found = true;
  assert.deepEqual((await lateSvc.tick()).map((t) => t.record.tags.state), ["NO_TAGS"]);
  now = AFTER;
  assert.equal(JSON.parse(await readFile(join(dir, "TAEGLOBAL-26AW.json"), "utf8")).publish.state, "PUBLISHED");
  const broken = createProductTagService({ graph: { get: async () => { throw new Error("graph down"); } }, dropbox: {}, getCafe24Product: cafe24, store, env: {}, now: () => now });
  const failed = await broken.run("B");
  assert.equal(failed.ok, false);
  assert.equal((await store.get("B")).lastError.message, "graph down");
});

test("server wiring: internal auth, autorun off by default, feed folders never written or moved", async () => {
  const src = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('if (url.pathname === "/api/instagram-product-tags/posts"'), src.indexOf('if (url.pathname === "/api/cafe24/brands")'));
  assert.match(block, /if \(!isAuthorizedInternalRequest\(req\)\) return json\(res, \{ error: "Unauthorized" \}, 401\);/);
  assert.match(src, /if \(env\.INSTAGRAM_PRODUCT_TAG_AUTORUN === "on"\) setInterval\(\(\) => productTags\.tick\(\)/);
  const runner = await readFile(new URL("../scripts/instagram-product-tag-runner.mjs", import.meta.url), "utf8");
  assert.equal(/files\/upload|files\/delete|move_v2|files\/copy|chromium|connectOverCDP|browser-guard/.test(runner), false, "runner never writes, moves or deletes in Dropbox and never uses Chrome");
});
