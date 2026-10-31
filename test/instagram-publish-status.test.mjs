import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publishStatus } from "../scripts/instagram-publish-status.mjs";
import { captionSha256 } from "../scripts/instagram-product-tag-runner.mjs";
import { SAMPLAS_META } from "../scripts/instagram-product-tags.mjs";

const CAPTION = "brand 26AW RELEASE NOW\nline";
const record = { folderName: "BRAND-26AW", slotIso: "2026-10-30T11:00:00.000Z", captionSha256: captionSha256(CAPTION), slideCount: 2, tags: { state: "TAG_VERIFIED" } };
const post = (o = {}) => ({ id: "181", caption: CAPTION, timestamp: "2026-10-30T11:00:04+0000", permalink: "https://www.instagram.com/p/X/", media_type: "CAROUSEL_ALBUM", children: { data: [{ id: "1" }, { id: "2" }] }, ...o });
const graph = (media, account = { id: SAMPLAS_META.igUserId, username: "samplaskr" }) => {
  const calls = [];
  return { calls, get: async (path, params) => { calls.push(path); return path === SAMPLAS_META.igUserId ? account : { data: media }; } };
};
const AFTER = Date.parse("2026-10-30T12:00:00Z");

test("published: only the fields the archive runner needs; record untouched; Graph GET only", async () => {
  const g = graph([post()]);
  const before = structuredClone(record);
  const s = await publishStatus({ record, graph: g, now: AFTER });
  assert.deepEqual(s, { account: "samplaskr", folderName: "BRAND-26AW", state: "PUBLISHED", reason: null, slotIso: record.slotIso, captionSha256: record.captionSha256, slideCount: 2, mediaId: "181", permalink: "https://www.instagram.com/p/X/", timestamp: "2026-10-30T11:00:04+0000", checkedAt: "2026-10-30T12:00:00.000Z" });
  assert.deepEqual(record, before);
  assert.deepEqual(g.calls, [SAMPLAS_META.igUserId, `${SAMPLAS_META.igUserId}/media`]);
  assert.equal(typeof g.post, "undefined");
});

test("not published, duplicate, wrong count, wrong account: no media id", async () => {
  const cases = [
    [[], Date.parse("2026-10-30T10:00:00Z"), "SCHEDULED", null],
    [[], AFTER, "NOT_FOUND", null],
    [[post(), post({ id: "2" })], AFTER, "MISMATCH", "duplicate_caption"],
    [[post({ children: { data: [{ id: "1" }] } })], AFTER, "MISMATCH", "slide_count:1!=2"],
    [[post({ timestamp: "2026-10-30T10:00:00+0000" })], AFTER, "MISMATCH", "published_before_slot"]
  ];
  for (const [media, now, state, reason] of cases) {
    const s = await publishStatus({ record, graph: graph(media), now });
    assert.deepEqual([s.state, s.reason, s.mediaId, s.timestamp], [state, reason, null, null], state + reason);
  }
  const s = await publishStatus({ record, graph: graph([post()], { id: "1", username: "other" }), now: AFTER });
  assert.deepEqual([s.state, s.reason, s.mediaId], ["MISMATCH", "wrong_account", null]);
});

test("Graph failure rejects (the route answers 502)", async () => {
  await assert.rejects(publishStatus({ record, graph: { get: async () => { throw new Error("graph down"); } }, now: AFTER }));
});

test("publish-status credential: GET of that one path only, and it opens nothing else", async () => {
  process.env.CAFE24_PROXY_BASIC_AUTH ??= "FAKE_TEST:FAKE_TEST";
  const { isApiRequestAllowed, isPublishStatusRequest, isTagRegistrationRequest } = await import("../server.mjs");
  const basic = (c) => `Basic ${Buffer.from(c).toString("base64")}`;
  const req = (method, authorization) => ({ method, headers: { authorization, host: "example.onrender.com" }, socket: { remoteAddress: "10.0.0.1" } });
  const path = "/api/instagram-product-tags/publish-status", cred = "pub:secret", reg = "reg:secret";
  assert.equal(isPublishStatusRequest(req("GET", basic(cred)), path, cred), true);
  for (const [method, p] of [["POST", path], ["GET", path + "/"], ["GET", "/api/instagram-product-tags/posts"], ["GET", "/api/instagram-product-tags/run"], ["POST", "/api/instagram-product-tags/posts"], ["GET", "/api/cafe24/products"]])
    assert.equal(isPublishStatusRequest(req(method, basic(cred)), p, cred), false, `${method} ${p}`);
  for (const c of [undefined, "", "pub", "pub:", ":x"]) assert.equal(isPublishStatusRequest(req("GET", basic(String(c))), path, c), false, `unset/invalid ${c}`);
  assert.equal(isPublishStatusRequest(req("GET", basic("pub:WRONG")), path, cred), false);
  // The two limited credentials do not open each other's route.
  assert.equal(isPublishStatusRequest(req("GET", basic(reg)), path, cred), false);
  assert.equal(isTagRegistrationRequest(req("POST", basic(cred)), "/api/instagram-product-tags/posts", reg), false);
  const gate = (method, p, c) => isApiRequestAllowed(req(method, basic(c)), p, { readAuth: undefined, registrationAuth: reg, publishStatusAuth: cred });
  assert.equal(gate("GET", path, cred), true);
  for (const [method, p] of [["GET", "/api/instagram-product-tags/posts"], ["POST", "/api/instagram-product-tags/posts"], ["POST", "/api/instagram-product-tags/run"], ["GET", "/api/cafe24/products"], ["POST", path]])
    assert.equal(gate(method, p, cred), false, `${method} ${p}`);
  assert.equal(gate("GET", path, reg), false);
});

test("route is read-only: record from productTags.get, answer from publishStatus, no put/run/register", () => {
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const start = src.indexOf('if (url.pathname === "/api/instagram-product-tags/publish-status")');
  const block = src.slice(start, src.indexOf("// Shopping tag records:", start));
  assert.ok(start > 0);
  assert.match(block, /if \(!isAuthorizedInternalRequest\(req\) && !isPublishStatusRequest\(req, url\.pathname\)\) return json\(res, \{ error: "Unauthorized" \}, 401\);/);
  assert.match(block, /req\.method !== "GET"/);
  assert.doesNotMatch(block, /\.put\(|\.run\(|register\(|autoMap|approveAutoMap|store\./);
  assert.equal(src.match(/isPublishStatusRequest\(/g).length, 3, "declared once, used by the /api gate and this route only");
});
