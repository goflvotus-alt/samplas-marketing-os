// Step 2 (run2.mjs): on the marked draft tab, 다음 x2, slide order check, caption, location, 콘텐츠 예약 on,
// date and time from the plan, then verify every field. Never clicks 예약/공유하기.
import { findTab, orderCheck, verify } from "./composer.mjs";
import { planFromEnv } from "./plan.mjs";

export default async (page, ctx) => {
  const plan = await planFromEnv();
  const p = await findTab(ctx, plan);
  if (!p) { console.log("ABORT draft tab not found (run draft.mjs first)"); return { kind: "compose", ok: false }; }
  const d = () => p.locator('[role="dialog"]').last();
  if (/^자르기/.test((await d().innerText()).trim())) for (let i = 0; i < 2; i++) { await d().getByText("다음", { exact: true }).click(); await p.waitForTimeout(2500); }
  const order = await orderCheck(p, plan);
  console.log("ORDER", JSON.stringify(order));
  if (!order.every((x, i) => x && x[0] === i + 1 && x[1] <= 25)) { console.log("ABORT slide order"); return { kind: "compose", ok: false }; }
  // Meta+A/Backspace here dropped the first "@handle" line on 2026-10-29; type only into an empty box.
  if ((await d().locator('[aria-label="캡션 추가..."]').innerText()).trim()) { console.log("ABORT caption box not empty"); return { kind: "compose", ok: false }; }
  await d().locator('[aria-label="캡션 추가..."]').click();
  const lines = plan.caption.split("\n");
  for (let i = 0; i < lines.length; i++) { if (lines[i]) await p.keyboard.insertText(lines[i]); if (i < lines.length - 1) await p.keyboard.press("Shift+Enter"); }
  await p.waitForTimeout(600);
  await d().locator('input[aria-label="위치 추가"]').click();
  await p.keyboard.insertText(plan.location.name);
  const addr = p.getByText(plan.location.address, { exact: true }).locator("visible=true");
  await addr.first().waitFor({ timeout: 15000 }); await addr.first().click();
  await p.waitForTimeout(1000);
  await p.getByText("새 게시물 만들기", { exact: true }).click(); await p.waitForTimeout(600);
  if (!/콘텐츠 예약[\s\S]*\d{4}년 \d+월 \d+일/.test(await d().innerText())) {
    const label = d().getByText("콘텐츠 예약", { exact: true });
    await label.scrollIntoViewIfNeeded();
    const lb = await label.boundingBox();
    const sws = await d().locator('input[role="switch"], [role="switch"], input[type="checkbox"]').evaluateAll((a) => a.map((x) => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const sw = sws.sort((a, b) => Math.abs(a.y - (lb.y + lb.height / 2)) - Math.abs(b.y - (lb.y + lb.height / 2)))[0];
    await p.mouse.click(sw.x, sw.y); await p.waitForTimeout(1200);
  }
  if (!(await d().innerText()).includes(plan.slot.dateText)) {
    await d().getByText(/\d{4}년 \d+월 \d+일/).first().click(); await p.waitForTimeout(1000);
    // ponytail: only the month the picker opens on was verified (10/28). Another month aborts here; add the
    // month arrow once its selector is checked on a real draft.
    if (!(await p.locator("body").innerText()).includes(plan.slot.monthText)) { console.log("ABORT picker month is not", plan.slot.monthText); return { kind: "compose", ok: false }; }
    await p.getByText(String(plan.slot.day), { exact: true }).locator("visible=true").last().click(); await p.waitForTimeout(800);
  }
  const set = async (l, v) => { await d().locator(`input[aria-label="${l}"]`).click(); await p.keyboard.press("Meta+A"); await p.keyboard.type(v); await p.waitForTimeout(300); };
  await set("Hours", plan.slot.hours); await set("Minutes", plan.slot.minutes); await set("AM PM", plan.slot.ampm);
  await p.getByText("새 게시물 만들기", { exact: true }).click(); await p.waitForTimeout(1000);
  const v = await verify(p, plan);
  console.log("VERIFY", JSON.stringify(v.r), "|", v.sched);
  return { kind: "compose", ok: v.r.ok };
};
