import test from "node:test";
import assert from "node:assert/strict";
import { feedbackWindow, feedbackTimestampDay, filterFeedbackBySessionDate, summariseFeedback } from "../scripts/session-feedback.mjs";

test("window includes event day and seven calendar days after", () => {
  assert.deepEqual(feedbackWindow("2026-10-31"), { from: "2026-10-31", through: "2026-11-07" });
  assert.equal(feedbackWindow("2026-02-30"), null);
});
test("Korean and ISO timestamp parsing", () => {
  assert.equal(feedbackTimestampDay("2026. 10. 31 오전 10:40:00"), "2026-10-31");
  assert.equal(feedbackTimestampDay("2026/11/7 23:59:00"), "2026-11-07");
  assert.equal(feedbackTimestampDay("2026-10-30T15:05:00Z"), "2026-10-31");
  assert.equal(feedbackTimestampDay("not a timestamp"), null);
});
test("001 and 002 are not combined and invalid dates fail closed", () => {
  const rows = [["타임스탬프", "만족도"], ["2026-09-06 13:00", "5"], ["2026-10-30 23:59", "4"], ["2026-10-31 13:00", "5"], ["2026-11-07 23:59", "4"], ["2026-11-08 00:00", "3"], ["", "2"]];
  const filtered = filterFeedbackBySessionDate(rows, "2026-10-31", { otherEventDates:["2026-09-06"] });
  assert.equal(summariseFeedback(filtered).count, 2);
  assert.deepEqual(filtered.map(x=>x[0]), ["타임스탬프","2026-10-31 13:00","2026-11-07 23:59"]);
});
test("overlapping session windows are excluded rather than double-counted", () => {
  const rows = [["타임스탬프", "평점"], ["2026-10-31 12:00", "5"], ["2026-11-02 13:00", "3"]];
  assert.equal(summariseFeedback(filterFeedbackBySessionDate(rows, "2026-10-31", { otherEventDates:["2026-11-02"] })).count, 1);
  assert.equal(summariseFeedback(filterFeedbackBySessionDate(rows, "2026-11-02", { otherEventDates:["2026-10-31"] })).count, 0);
});
