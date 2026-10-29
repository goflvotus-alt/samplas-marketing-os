// Step 1 (run2.mjs): new draft tab, upload the plan's images in manifest order, set the crop to 4:5 and
// check every slide's frame. Stops at 자르기. Never clicks 다음/예약/공유하기.
import { frame } from "./composer.mjs";
import { planFromEnv } from "./plan.mjs";

export default async (page, ctx) => {
  const plan = await planFromEnv();
  for (const t of ctx.pages()) {
    const x = await t.locator('[role="dialog"]').last().innerText({ timeout: 1000 }).catch(() => "");
    if (/^자르기|새 게시물 만들기/.test(x.trim())) { console.log("ABORT a composer is already open", t.url()); return { kind: "draft", ok: false }; }
  }
  const p = await ctx.newPage();
  await p.goto("https://www.instagram.com/samplaskr/", { waitUntil: "domcontentloaded" });
  await p.evaluate((m) => { window.name = m; }, plan.tabMarker);
  await p.waitForTimeout(5000);
  await p.locator('svg[aria-label="새로운 게시물"], svg[aria-label="만들기"]').first().click();
  await p.waitForTimeout(1500);
  await p.getByText("게시물", { exact: true }).locator("visible=true").last().click();
  await p.waitForTimeout(2500);
  await p.locator('input[type="file"]').last().setInputFiles(plan.images);
  await p.waitForTimeout(4000 + 600 * plan.slideCount);
  const d = p.locator('[role="dialog"]').last();
  await d.locator('svg[aria-label="자르기 선택"]').click();
  await p.waitForTimeout(800);
  await d.getByText("4:5", { exact: true }).click();
  await p.waitForTimeout(1000);
  await d.locator('svg[aria-label="자르기 선택"]').click(); // close the menu
  await p.waitForTimeout(800);
  const ratios = [];
  for (let k = 0; k < plan.slideCount; k++) {
    ratios.push(await frame(p));
    if (k < plan.slideCount - 1) { await d.locator('svg[aria-label="오른쪽 방향 아이콘"]').first().click(); await p.waitForTimeout(800); }
  }
  const ok = ratios.length === plan.slideCount && ratios.every((r) => Math.abs(r - 0.8) <= 0.02);
  console.log("DRAFT", JSON.stringify({ folder: plan.folderName, slides: plan.slideCount, ratios, ok }));
  return { kind: "draft", ok };
};
