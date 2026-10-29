// One schedule file per feed post: brand folder, slot, store, caption file, optional mapping proposal.
// Every Instagram web step (draft, compose, schedule, verify) and the Render registration config are derived
// from it, so a new brand or slot needs a new schedule file, not a code change.
//
// schedule.json (keep it outside Dropbox; it holds no secrets):
// { "folderName": "AZVA-26AW", "slotIso": "2026-11-02T20:00:00+09:00", "store": "본점",
//   "captionFile": "/abs/path/caption.txt", "feedDir"?: "<local 피드 자동화 folder>",
//   "mappingProposalFile"?: "/abs/path/proposal.json" }
// The READY folder is only read. Moving it to UPLOADED stays with the upload automation.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { captionSha256, isFeedFolderName } from "../instagram-product-tag-runner.mjs";
import { validateScheduledProposal } from "../instagram-scheduled-mapping.mjs";

export const FEED_DIR_LOCAL = join(homedir(), "Dropbox", "SAMPLAS WORK", "병구 작업", "피드 자동화");
// The 본점 location as Instagram lists it (matches the @samplaskr bio). VEIL has no place entry.
export const SAMPLAS_LOCATION = { name: "Samplas", address: "서울특별시 강남구 도산대로45길 10-2 2,3층" };
const KST = 9 * 3600e3;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// The slot as the composer shows and takes it (KST). An explicit offset is required.
export function slotParts(slotIso) {
  if (typeof slotIso !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(slotIso) || !Number.isFinite(Date.parse(slotIso))) return null;
  const k = new Date(Date.parse(slotIso) + KST);
  const [y, mo, d, h, mi] = [k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate(), k.getUTCHours(), k.getUTCMinutes()];
  const h12 = h % 12 || 12, pad = (n) => String(n).padStart(2, "0");
  return { iso: new Date(slotIso).toISOString(), year: y, month: mo, day: d, monthText: `${y}년 ${mo}월`,
    dateText: `${y}년 ${mo}월 ${d}일 (${WEEKDAYS[k.getUTCDay()]})`, hours: pad(h12), minutes: pad(mi), ampm: h < 12 ? "AM" : "PM",
    calendarTime: `${h < 12 ? "오전" : "오후"} ${h12}:${pad(mi)}` };
}

// Store rule for the feed caption (operating policy confirmed 2026-10-29 from past @samplaskr posts):
// both stores keep "AVAILABLE NOW AT SAMPLAS" and the Samplas location (place 105833437465285).
// VEIL brands also end with "OFFLINE @samplas_veil"; 본점 posts never mention VEIL.
export function checkStoreCaption(store, caption) {
  if (store !== "본점" && store !== "VEIL") return { ok: false, problems: ["store_required"] };
  const problems = [];
  if (!/AVAILABLE NOW AT SAMPLAS\b/.test(caption)) problems.push("caption_missing_available_at_samplas");
  if (store === "본점" && /veil/i.test(caption)) problems.push("caption_mentions_veil");
  if (store === "VEIL" && !/^OFFLINE @samplas_veil$/m.test(caption)) problems.push("caption_missing_offline_samplas_veil");
  return { ok: !problems.length, problems, location: SAMPLAS_LOCATION };
}

const sipsSize = (file) => {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  return `${out.match(/pixelWidth: (\d+)/)[1]}x${out.match(/pixelHeight: (\d+)/)[1]}`;
};

// -> { ok, problems, plan }. Reads the schedule file, the caption file, READY/<folder>/manifest.json and image sizes.
export async function loadSchedulePlan(schedulePath, { read = (p) => readFile(p, "utf8"), imageSize = sipsSize, now = Date.now() } = {}) {
  const problems = [];
  const s = JSON.parse(await read(schedulePath));
  if (!isFeedFolderName(s.folderName)) return { ok: false, problems: ["folder_name"] };
  const slot = slotParts(s.slotIso);
  if (!slot) problems.push("slot_iso_with_offset_required");
  else if (Date.parse(s.slotIso) < now + 20 * 60e3) problems.push("slot_less_than_20_minutes_ahead");
  if (![s.captionFile, s.feedDir ?? FEED_DIR_LOCAL, s.mappingProposalFile ?? "/"].every((p) => typeof p === "string" && isAbsolute(p))) return { ok: false, problems: [...problems, "absolute_paths_required"] };
  const caption = (await read(s.captionFile)).normalize("NFC").replace(/\r\n/g, "\n").trim();
  if (!caption || caption.length > 2200) problems.push("caption_length");
  const store = checkStoreCaption(s.store, caption);
  problems.push(...store.problems);
  const folderDir = resolve(s.feedDir ?? FEED_DIR_LOCAL, "READY", s.folderName);
  const manifest = JSON.parse(await read(join(folderDir, "manifest.json")));
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (manifest.folderName !== s.folderName) problems.push("manifest_folder_mismatch");
  if (!items.length || items.length > 20 || items.some((it, i) => it.order !== i + 1 || !/^assets\/[A-Za-z0-9_-]+\.[a-z0-9]+$/i.test(it.savedAsset || ""))) problems.push("manifest_items");
  // Only JPEG stills were verified in the web composer (crop, order check, server check). Video is not.
  else if (items.some((it) => !/\.jpe?g$/i.test(it.savedAsset))) problems.push("non_jpeg_asset");
  const images = items.map((it) => join(folderDir, it.savedAsset));
  const dimensions = problems.some((x) => /manifest_items|non_jpeg_asset/.test(x)) ? [] : images.map(imageSize);
  // The composer is set to 4:5. Any other source ratio would be cropped.
  if (dimensions.some((d) => { const [w, h] = d.split("x").map(Number); return w * 5 !== h * 4; })) problems.push("images_not_4x5");
  const mappingProposal = s.mappingProposalFile ? JSON.parse(await read(s.mappingProposalFile)) : null;
  if (mappingProposal) problems.push(...validateScheduledProposal(mappingProposal, s.folderName, items.length));
  if (problems.length) return { ok: false, problems };
  const sha = captionSha256(caption);
  return { ok: true, problems: [], plan: {
    folderName: s.folderName, store: s.store, location: store.location, folderDir, images, slideCount: images.length, dimensions,
    caption, captionSha256: sha, slot, tabMarker: `SAMPLAS_SCHEDULE:${s.folderName}`,
    // SAMPLAS_IG_REGISTRATION_CONFIG for instagram-scheduling-registration-hook.mjs
    registration: { folderName: s.folderName, slotIso: slot.iso, captionSha256: sha, slideCount: images.length, dimensions, ...(mappingProposal ? { mappingProposal } : {}) }
  } };
}

// For the browser steps: the plan named by SAMPLAS_IG_SCHEDULE, or an error listing every problem.
export async function planFromEnv(env = process.env) {
  if (!env.SAMPLAS_IG_SCHEDULE) throw new Error("SAMPLAS_IG_SCHEDULE not set");
  const out = await loadSchedulePlan(env.SAMPLAS_IG_SCHEDULE);
  if (!out.ok) throw new Error(`schedule_invalid:${out.problems.join(",")}`);
  return out.plan;
}
