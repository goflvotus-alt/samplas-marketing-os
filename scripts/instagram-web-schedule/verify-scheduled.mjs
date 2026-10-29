// Step 4 (run2.mjs), read-only: open every item of /scheduled_content/ in a fresh tab, read caption, location,
// time, slide sizes and order against the plan's originals (full-frame diff); close the tab (discard).
// Ported from the 2026-10-28 nt6.mjs. Never clicks 저장/공유/삭제. Returns the schedule-verification result.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { planFromEnv } from './plan.mjs';
export default async (page, ctx) => {
  const plan = await planFromEnv();
  const cap = plan.caption;
  const origs = plan.images.map(f => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64'));
  const probe = await ctx.newPage();
  await probe.goto('https://www.instagram.com/scheduled_content/', { waitUntil: 'domcontentloaded' }); await probe.waitForTimeout(7000);
  const cal = await probe.locator('main').innerText();
  const n = await probe.locator('main img[alt="예약된 게시물 썸네일"]').count();
  console.log('CAL thumbs', n, '|', plan.slot.calendarTime, cal.split(plan.slot.calendarTime).length - 1);
  await probe.close();
  const observations = [];
  for (const t of (process.env.ONLY ? [+process.env.ONLY] : [...Array(n).keys()])) {
    const p = await ctx.newPage();
    await p.goto('https://www.instagram.com/scheduled_content/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(7000);
    await p.locator('main img[alt="예약된 게시물 썸네일"]').nth(t).click(); await p.waitForTimeout(5000);
    const d = p.locator('[role="dialog"]').last();
    const got = (await d.locator('[aria-label="캡션 추가..."]').innerText()).trim();
    const loc = await d.locator('input[aria-label="위치 추가"]').inputValue().catch(() => '');
    const txt = (await d.innerText()).replace(/\n+/g, ' ');
    const cb = await d.locator('[aria-label="캡션 추가..."]').boundingBox(); const ib = await d.locator("img").evaluateAll(a => { const x = a.find(i => i.naturalWidth > 300).getBoundingClientRect(); return { t: x.top, b: x.bottom }; }); const imgBox = { l: 0, r: cb.x - 5, t: ib.t, b: ib.b };
    const list = [];
    for (let i = 0; i <= plan.slideCount; i++) {
      const imgs = await d.locator('img').evaluateAll(a => a.filter(x => x.naturalWidth > 300).map(x => { const r = x.getBoundingClientRect(); return { src: x.src, w: x.naturalWidth, h: x.naturalHeight, cx: r.left }; }));
      for (const m of imgs) if (!list.some(z => z.src === m.src)) list.push(m);
      const chev = (await d.locator('svg[aria-label="오른쪽 방향 아이콘"]').evaluateAll(a => a.map(s => { const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }))).filter(c => c.x > imgBox.l && c.x < imgBox.r && c.y > imgBox.t && c.y < imgBox.b);
      if (!chev.length) break;
      await p.mouse.click(chev[0].x, chev[0].y); await p.waitForTimeout(1500);
    }
    list.sort((a, b) => a.cx - b.cx);
    const match = await p.evaluate(async ({ served, origs }) => {
      const load = u => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = u; });
      const px = img => { const c = document.createElement('canvas'); c.width = 48; c.height = 60; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 60); return g.getImageData(0, 0, 48, 60).data; };
      const dd = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return +(s / (a.length / 4 * 3)).toFixed(1); };
      const O = (await Promise.all(origs.map(load))).map(px);
      const out = [];
      for (const u of served) { const s = px(await load(u)); const ds = O.map(o => dd(s, o)); const j = ds.indexOf(Math.min(...ds)); out.push([j + 1, ds[j]]); }
      return out;
    }, { served: list.map(x => x.src), origs });
    console.log(`POST ${t}`, JSON.stringify({ sizes: list.map(x => x.w + 'x' + x.h), order: match, captionMatch: got.normalize('NFC') === cap, captionLen: got.length, location: loc, sched: (txt.match(/날짜 (.*?) 예약된 콘텐츠 삭제/) || [])[1] }));
    observations.push({ sizes: list.map(x => x.w + 'x' + x.h), order: match, captionMatch: got.normalize('NFC') === cap,
      captionSha256: createHash('sha256').update(got.normalize('NFC').replace(/\r\n/g, '\n').trim()).digest('hex'),
      sched: (txt.match(/날짜 (.*?) 예약된 콘텐츠 삭제/) || [])[1] });
    await p.close();
  }
  return { kind: 'schedule-verification', complete: !process.env.ONLY && observations.length === n, calendarCount: n, observations };
};
