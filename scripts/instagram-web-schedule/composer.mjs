// Instagram web composer helpers shared by the schedule steps. Ported from the TAEGLOBAL scripts
// (tg.mjs, nt2/nt3, order2) used for the 2026-10-28 schedule; brand, files, caption and slot come from the plan.
// Runs only through the existing run2.mjs on the dedicated Chrome (CDP 9333). Never clicks 공유하기/저장/삭제.
import fs from "node:fs";

// The draft tab is the one draft.mjs named with the plan's marker.
export async function findTab(ctx, plan) {
  const tabs = [];
  for (const t of ctx.pages()) if (await t.evaluate(() => window.name).catch(() => "") === plan.tabMarker) tabs.push(t);
  return tabs.length === 1 ? tabs[0] : null;
}

// Every field the 예약 click depends on. ok only when all match the plan.
export async function verify(tab, plan) {
  const d = tab.locator('[role="dialog"]').last();
  const txt = await d.innerText();
  const got = (await d.locator('[aria-label="캡션 추가..."]').innerText()).trim();
  const loc = await d.locator('input[type="text"]').evaluateAll((a) => a.map((x) => x.value).filter(Boolean));
  const sched = (txt.split("콘텐츠 예약")[1] || "").replace(/\n/g, " ");
  const n = plan.slideCount;
  const r = {
    account: /\nsamplaskr\n/.test(`\n${txt}\n`),
    caption: got.normalize("NFC") === plan.caption, captionLen: got.length,
    location: loc.includes(plan.location.name),
    date: sched.includes(plan.slot.dateText),
    time: new RegExp(`${plan.slot.hours}\\s*:\\s*${plan.slot.minutes}\\s*${plan.slot.ampm}`).test(sched),
    // carousel dots (one per slide); a single image has none
    slides: n === 1 || await d.evaluate((el, n) => [...el.querySelectorAll("div")].some((x) => x.children.length === n && [...x.children].every((c) => { const w = c.getBoundingClientRect().width; return w > 2 && w < 12; })), n),
    button: await d.locator('div[role="button"]', { hasText: /^예약$/ }).count()
  };
  r.ok = r.account && r.caption && r.location && r.date && r.time && r.slides && r.button === 1;
  return { r, sched: sched.slice(0, 90), got };
}

// Visible crop frame of the current slide (image clipped by its ancestors).
export const frame = (p) => p.evaluate(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].at(-1);
  const e = [...dlg.querySelectorAll("img, div")].find((x) => { const b = x.getBoundingClientRect(); const bg = getComputedStyle(x).backgroundImage; return (x.tagName === "IMG" ? x.src.startsWith("blob:") : /blob:/.test(bg)) && b.width > 200 && b.x >= 0 && b.x < innerWidth * 0.8; });
  if (!e) return null;
  const b = e.getBoundingClientRect(); let [x1, y1, x2, y2] = [b.left, b.top, b.right, b.bottom];
  for (let a = e.parentElement; a && a !== dlg; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflow !== "visible" || cs.overflowX !== "visible") { const r = a.getBoundingClientRect(); x1 = Math.max(x1, r.left); y1 = Math.max(y1, r.top); x2 = Math.min(x2, r.right); y2 = Math.min(y2, r.bottom); } }
  return +((x2 - x1) / (y2 - y1)).toFixed(3);
});

// Caption step: walk the carousel and match each visible slide to the source images by an 8x8 hash.
// -> [[sourceIndex (1-based), distance], ...]; the order is right when entry i is [i + 1, small].
export async function orderCheck(page, plan) {
  const src = plan.images.map((f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`);
  const d = page.locator('[role="dialog"]').last();
  const left = d.locator('[aria-label="왼쪽 방향 아이콘"]').first();
  for (let i = 0; i < 25 && await left.isVisible().catch(() => false); i++) { await left.click(); await page.waitForTimeout(500); }
  const seq = [];
  for (let k = 0; k < plan.slideCount; k++) {
    seq.push(await page.evaluate(async (src) => {
      const hash = (url, A) => new Promise((ok, no) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d"); const W = im.naturalWidth, H = im.naturalHeight; let sw = W, sh = H; if (W / H > A) sw = H * A; else sh = W / A; g.drawImage(im, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, 16, 16); const px = g.getImageData(0, 0, 16, 16).data; const v = []; for (let i = 0; i < 256; i++) v.push(px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11); const m = v.reduce((a, b) => a + b) / 256; ok(v.map((x) => (x > m ? 1 : 0))); }; im.onerror = no; im.src = url; });
      const dlg = [...document.querySelectorAll('[role="dialog"]')].at(-1);
      const vis = [...dlg.querySelectorAll("img")].filter((im) => { const b = im.getBoundingClientRect(); return im.src.startsWith("blob:") && b.width > 200 && b.x >= 0 && b.x < innerWidth / 2; });
      if (!vis.length) return null;
      const pane = dlg.querySelector('[aria-label="사람 태그"]')?.getBoundingClientRect() || { x: 16 };
      const v0 = vis.sort((a, b) => Math.abs(a.getBoundingClientRect().x - pane.x) - Math.abs(b.getBoundingClientRect().x - pane.x))[0];
      const bb = v0.getBoundingClientRect();
      // The blob is the uploaded original: hash it and the sources at the same visible aspect.
      const t = await hash(v0.src, bb.width / bb.height);
      const sh = await Promise.all(src.map((u) => hash(u, bb.width / bb.height)));
      const ds = sh.map((s) => s.reduce((a, b, i) => a + (b !== t[i]), 0));
      const best = ds.indexOf(Math.min(...ds));
      return [best + 1, ds[best]];
    }, src));
    if (k < plan.slideCount - 1) { await d.locator('[aria-label="오른쪽 방향 아이콘"]').first().click(); await page.waitForTimeout(700); }
  }
  return seq;
}
