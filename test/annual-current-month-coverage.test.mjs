import test from "node:test";
import assert from "node:assert/strict";
import { currentMonthSalesCutoff } from "../server.mjs";

test("ECOUNT through September 27 limits both sales channels to September 27", () => {
  assert.equal(
    currentMonthSalesCutoff("2026-09-30", "2026-09-29", "2026-09-27"),
    "2026-09-27"
  );
});

test("ECOUNT through today uses today rather than the future month end", () => {
  assert.equal(
    currentMonthSalesCutoff("2026-09-30", "2026-09-29", "2026-09-29"),
    "2026-09-29"
  );
});

test("a future-dated snapshot cannot extend sales beyond today", () => {
  assert.equal(
    currentMonthSalesCutoff("2026-09-30", "2026-09-29", "2026-10-01"),
    "2026-09-29"
  );
});
