import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const start = js.indexOf("async function renderMonthlyArchiveReport(month, renderSeq)");
const end = js.indexOf("\nfunction miniMetric", start);
const monthly = js.slice(start, end);

test("current Monthly Brand Performance uses the existing same-elapsed-day cutoff endpoint", () => {
  assert.match(monthly, /month === todayDateKey\(\)\.slice\(0, 7\)/);
  assert.match(monthly, /\/api\/reports\/monthly-comparison-cutoff\?base=\$\{month\}&compare=\$\{previousMonth\}/);
  assert.match(monthly, /brandComparison\.cutoff\?\.cutoffNormalized === true/);
  assert.match(monthly, /getJson\(`\/api\/reports\/monthly\?month=\$\{month\}`, isCurrentMonthBrandComparison \? 30000 : 8000\)/);
});

test("completed months retain full previous archive comparison without an extra cutoff request", () => {
  assert.match(monthly, /const currentMonthBrandComparison = isCurrentMonthBrandComparison[\s\S]*?: Promise\.resolve\(null\)/);
  assert.match(monthly, /: previousBrandSales;/);
});

test("identity-incomplete cutoff data cannot generate fake deltas", () => {
  assert.match(monthly, /brandComparison\.base\?\.coverage\?\.complete === true/);
  assert.match(monthly, /brandComparison\.comparison\?\.coverage\?\.complete === true/);
  assert.match(monthly, /currentMonthComparisonComplete \? brandComparison\.comparison\.brandSales \|\| \[\] : \[\]/);
  assert.match(monthly, /비교 불가 · 브랜드 identity coverage가 완전하지 않습니다/);
  assert.doesNotMatch(monthly, /-100%/);
});

test("BONNAE, CARNET and LIFE IS HELL use rows from the trusted cutoff response, never hardcoded corrections", () => {
  assert.match(monthly, /brandComparison\.base\.brandSales/);
  assert.match(monthly, /brandComparison\.comparison\.brandSales/);
  assert.doesNotMatch(monthly, /BONNAE|CARNET|LIFE IS HELL/);
});

test("Daily Sales and Online Garage implementations remain present and outside the Monthly comparison change", () => {
  assert.match(js, /<h4>월간 일별 매출 캘린더<\/h4>/);
  assert.match(js, /\{ id: "online-garage", name: "ONLINE GARAGE", categoryNo: "425" \}/);
  assert.match(monthly, /<a href="#todaySalesCalendar">01 Daily Sales<\/a>/);
});
