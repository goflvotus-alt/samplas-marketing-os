// Step 3 (run2.mjs): click 예약 once on the marked draft, only with this post's explicit approval
// (SAMPLAS_IG_SCHEDULE_APPROVED=<folderName>@<slot ISO>) and only after every field verifies again.
// Returns the schedule-success result the registration hook observes.
import { createHash } from "node:crypto";
import { findTab, orderCheck, verify } from "./composer.mjs";
import { planFromEnv } from "./plan.mjs";

export default async (page, ctx) => {
  const plan = await planFromEnv();
  const fail = (why) => { console.log("ABORT", why); return { kind: "schedule-success", ok: false }; };
  if (process.env.SAMPLAS_IG_SCHEDULE_APPROVED !== `${plan.folderName}@${plan.slot.iso}`) return fail(`approval required: SAMPLAS_IG_SCHEDULE_APPROVED=${plan.folderName}@${plan.slot.iso}`);
  const tab = await findTab(ctx, plan);
  if (!tab) return fail("draft tab not found");
  const v = await verify(tab, plan);
  console.log("preflight", JSON.stringify(v.r));
  if (!v.r.ok) return fail("preflight mismatch");
  // Same slide count is not enough: every slide must still be the planned image in the planned place.
  const order = await orderCheck(tab, plan);
  console.log("ORDER", JSON.stringify(order));
  if (!order.every((x, i) => x && x[0] === i + 1 && x[1] <= 25)) return fail("slide order");
  await tab.locator('[role="dialog"]').last().locator('div[role="button"]', { hasText: /^예약$/ }).click();
  const clickedAt = new Date().toISOString();
  let confirmed = false;
  for (let i = 0; i < 12; i++) {
    await tab.waitForTimeout(2500);
    const t = (await tab.locator('[role="dialog"]').allInnerTexts().catch(() => [])).join(" || ").replace(/\n/g, " | ");
    console.log(i, t.slice(0, 220));
    if (/오류|문제|다시 시도/.test(t)) break;
    if (/게시물이 예약되었습니다|게시물 예약됨/.test(t)) { confirmed = true; break; }
  }
  return { kind: "schedule-success", ok: confirmed, account: "samplaskr",
    captionSha256: createHash("sha256").update(v.got.normalize("NFC").replace(/\r\n/g, "\n").trim()).digest("hex"),
    slotText: v.sched, at: clickedAt };
};
