// Schedule file -> plan -> registration hook, for any brand and slot. No browser, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStoreCaption, loadSchedulePlan, slotParts } from "../scripts/instagram-web-schedule/plan.mjs";
import { createSchedulingRegistrationHook, scheduledSlotIso } from "../scripts/instagram-scheduling-registration-hook.mjs";

const CAPTION = "@azva 26AW RELEASE NOW\n\nAZVA 26AW COLLECTION\nAVAILABLE NOW AT SAMPLAS\n\nONLINE & OFFLINE\nWWW.SAMPLAS.CO.KR";
const NOW = Date.parse("2026-10-29T03:00:00Z");
const proposal = { schemaVersion: 1, folderName: "AZVA-26AW", brand: "AZVA", preparedBy: "Claude schedule preparation",
  mappings: [{ slideIndex: 2, savedAsset: "assets/02.jpg", productNo: 16001, x: 0.5, y: 0.4, evidence: "print and hardware", confidence: 0.9, reviewRequired: false },
    { slideIndex: 3, savedAsset: "assets/03.jpg", evidence: "pants not in catalog", reviewRequired: true }] };
function files(over = {}) {
  const f = {
    "/s.json": { folderName: "AZVA-26AW", slotIso: "2026-11-02T20:00:00+09:00", store: "본점", captionFile: "/c.txt", feedDir: "/feed", mappingProposalFile: "/p.json", ...over.schedule },
    "/c.txt": over.caption ?? CAPTION,
    "/p.json": proposal,
    "/feed/READY/AZVA-26AW/manifest.json": over.manifest ?? { folderName: "AZVA-26AW", items: [1, 2, 3].map((order) => ({ order, savedAsset: `assets/0${order}.jpg` })) }
  };
  return { read: async (p) => { if (!(p in f)) throw new Error(`ENOENT ${p}`); return typeof f[p] === "string" ? f[p] : JSON.stringify(f[p]); },
    imageSize: (p) => (over.size?.(p) ?? "1080x1350"), now: NOW };
}
const load = (over) => loadSchedulePlan("/s.json", files(over));

test("slot from ISO: composer date/time text, and the hook reads it back to the same instant", () => {
  const s = slotParts("2026-11-02T20:00:00+09:00");
  assert.deepEqual([s.dateText, s.hours, s.minutes, s.ampm, s.calendarTime, s.monthText], ["2026년 11월 2일 (월)", "08", "00", "PM", "오후 8:00", "2026년 11월"]);
  for (const iso of ["2026-11-02T20:00:00+09:00", "2026-12-31T00:30:00+09:00", "2026-11-01T03:05:00Z"]) {
    const p = slotParts(iso);
    assert.equal(scheduledSlotIso(`${p.dateText} 시간 ${p.hours} : ${p.minutes} ${p.ampm}`), new Date(iso).toISOString());
  }
  assert.equal(slotParts("2026-12-31T00:30:00+09:00").hours, "12");
  assert.equal(slotParts("2026-11-02T20:00:00"), null, "offset required");
});

test("store caption: 본점 template and Samplas location; VEIL refused until its rule exists", () => {
  assert.deepEqual(checkStoreCaption("본점", CAPTION).location.name, "Samplas");
  assert.deepEqual(checkStoreCaption("본점", "@x 26AW").problems, ["caption_missing_available_at_samplas"]);
  assert.deepEqual(checkStoreCaption("본점", `${CAPTION}\nSAMPLAS VEIL`).problems, ["caption_mentions_veil"]);
  assert.deepEqual(checkStoreCaption("VEIL", CAPTION).problems, ["veil_caption_rule_undefined"]);
  assert.deepEqual(checkStoreCaption(undefined, CAPTION).problems, ["store_required"]);
});

test("new brand and slot from the schedule file only: images in manifest order, registration config", async () => {
  const { ok, plan } = await load();
  assert.equal(ok, true);
  assert.deepEqual(plan.images, ["/feed/READY/AZVA-26AW/assets/01.jpg", "/feed/READY/AZVA-26AW/assets/02.jpg", "/feed/READY/AZVA-26AW/assets/03.jpg"]);
  assert.deepEqual(plan.registration, { folderName: "AZVA-26AW", slotIso: "2026-11-02T11:00:00.000Z", captionSha256: plan.captionSha256, slideCount: 3, dimensions: Array(3).fill("1080x1350"), mappingProposal: proposal });
  assert.equal(plan.tabMarker, "SAMPLAS_SCHEDULE:AZVA-26AW");
});

test("schedule file problems block before any browser step", async () => {
  const problems = async (over) => (await load(over)).problems;
  assert.deepEqual(await problems({ size: (p) => (p.endsWith("02.jpg") ? "1080x1080" : "1080x1350") }), ["images_not_4x5"]);
  assert.deepEqual(await problems({ schedule: { slotIso: "2026-10-29T12:10:00+09:00" } }), ["slot_less_than_20_minutes_ahead"]);
  assert.deepEqual(await problems({ schedule: { store: "VEIL" } }), ["veil_caption_rule_undefined"]);
  assert.deepEqual(await problems({ schedule: { mappingProposalFile: undefined }, manifest: { folderName: "OTHER", items: [{ order: 2, savedAsset: "assets/02.jpg" }] } }), ["manifest_folder_mismatch", "manifest_items"]);
  assert.deepEqual(await problems({ schedule: { captionFile: "c.txt" } }), ["absolute_paths_required"]);
  assert.deepEqual(await problems({ schedule: { mappingProposalFile: undefined }, manifest: { folderName: "AZVA-26AW", items: [{ order: 1, savedAsset: "assets/01.mp4" }] } }), ["non_jpeg_asset"]);
  assert.ok((await problems({ schedule: { mappingProposalFile: "/p.json", folderName: "AZVA-26AW" }, manifest: { folderName: "AZVA-26AW", items: [{ order: 1, savedAsset: "assets/01.jpg" }] } })).includes("proposal_slide"));
});

test("plan registration config drives the existing f3 -> nt6 hook: one /posts call carrying the proposal", async () => {
  const { plan } = await load();
  const slotText = `${plan.slot.dateText} 시간 ${plan.slot.hours} : ${plan.slot.minutes} ${plan.slot.ampm}`;
  let body;
  const hook = createSchedulingRegistrationHook({ config: plan.registration, stateDir: await mkdtemp(join(tmpdir(), "ws-")), baseUrl: "https://example.com", authorization: "Basic mock",
    fetchImpl: async (u, i) => { body = JSON.parse(i.body); return { ok: true, json: async () => ({ ok: true }) }; } });
  await hook.observe({ kind: "schedule-success", ok: true, account: "samplaskr", captionSha256: plan.captionSha256, slotText, at: "x" });
  const observed = { captionSha256: plan.captionSha256, captionMatch: true, sched: slotText, sizes: plan.dimensions, order: plan.images.map((_, i) => [i + 1, 0]) };
  assert.equal((await hook.observe({ kind: "schedule-verification", complete: true, calendarCount: 1, observations: [observed] })).state, "REGISTERED");
  assert.deepEqual([body.folderName, body.slotIso, body.slideCount, body.acceptUnverifiedVariantApproval], ["AZVA-26AW", "2026-11-02T11:00:00.000Z", 3, false]);
  assert.deepEqual(body.mappingProposal, proposal);
});
