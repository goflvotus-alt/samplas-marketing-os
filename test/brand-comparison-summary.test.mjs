import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// STEP67-10G-3: buildComparisonSummaryFacts()는 순수 함수(네트워크/DOM/Date.now
// 의존 없음)라, 이미 이 저장소가 쓰는 패턴(test/brand-comparison-yoy-timeout.test.mjs)
// 그대로 실제 소스에서 함수 텍스트를 뽑아 Function() 생성자로 실행한다. 새 export
// 메커니즘/새 빌드 도구를 추가하지 않는다.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceRange(startMarker, endFunctionName) {
  const start = js.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} missing`);
  const fnStart = js.indexOf(`function ${endFunctionName}(`, start);
  assert.notEqual(fnStart, -1, `${endFunctionName} missing`);
  let depth = 0;
  let opened = false;
  for (let index = fnStart; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${endFunctionName} incomplete`);
}

const ENGINE_SOURCE = sourceRange("const ENTITY_COMPARE_SUMMARY_METRICS", "buildComparisonSummaryFacts");

const CLIENT_TYPE_LABELS = {
  stylist: "스타일리스트", samplas_press: "프레스", customer: "일반 손님",
  foreign: "외국인", online_first_signup: "온라인 첫가입", ff: "직원 구매"
};

function loadEngine() {
  return Function(
    "apiNum", "entityCompositionTypeLabel",
    `${ENGINE_SOURCE}; return buildComparisonSummaryFacts;`
  )((v) => Number(v).toLocaleString("ko-KR"), CLIENT_TYPE_LABELS);
}

// NEXT-CROSS-BRAND-FACT: entityCompareSummaryChannelDominantFact()는 3-fact
// 우선순위 절단과 무관하게 그 자체 로직(same/different/single-sided/both-balanced)을
// 격리해서 검증하기 위해 buildComparisonSummaryFacts 대신 이 함수를 직접 반환한다.
// 같은 ENGINE_SOURCE 블록 안에 이미 선언돼 있으므로 새 추출 로직이 필요 없다.
function loadChannelDominantFact() {
  return Function(
    "apiNum", "entityCompositionTypeLabel",
    `${ENGINE_SOURCE}; return entityCompareSummaryChannelDominantFact;`
  )((v) => Number(v).toLocaleString("ko-KR"), CLIENT_TYPE_LABELS);
}

const PROHIBITED_WORDS = [
  "좋습니다", "나쁩니다", "성공했습니다", "실패했습니다", "인기가 많습니다",
  "문제가 있습니다", "우수합니다", "더 낫습니다", "추천합니다", "전략적으로",
  "재고를 늘려야", "발주해야", "프로모션해야", "수익성이 좋습니다",
  "견인", "상쇄", "로 인해", "덕분", "driven", "because"
];

function assertNoProhibitedWording(text) {
  for (const word of PROHIBITED_WORDS) assert.ok(!text.includes(word), `prohibited wording "${word}" found in: ${text}`);
}

function allText(result) {
  return [...result.facts.map((f) => f.text), ...result.caveats.map((c) => c.text)].join(" ");
}

// ---- 실측 기반 fixture(STEP67-10G-1/10G-2가 실제 확인한 값, CARNET ARCHIVE vs
// TROUBLED WATERS, 2026-08 vs 2026-07 / 2025-08) ----
const CARNET_CURRENT_LIVE = { revenue: 9441259, quantitySold: 28, orderCount: 21, aov: 449584, online: 1021959, offline: 8419300 };
const CARNET_TARGET_PREV = { revenue: 23303130, quantitySold: 69, orderCount: 66, aov: 353078, online: 2448430, offline: 20854700 };
const CARNET_TARGET_YOY = { revenue: 2799140, quantitySold: 5, orderCount: 5, aov: 559828 };
const TROUBLED_CURRENT_LIVE = { revenue: 3991200, quantitySold: 13, orderCount: 13, aov: 307015, online: 0, offline: 3991200 };
const TROUBLED_TARGET_YOY_LOW_BASE = { revenue: 324820, quantitySold: 1, orderCount: 1, aov: 324820 };

test("1. LIVE current month guard — no period-change facts against a completed month", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_CURRENT_LIVE, aTarget: CARNET_TARGET_PREV,
    bCurrent: TROUBLED_CURRENT_LIVE, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const text = allText(result);
  assert.ok(!text.includes("REVENUE_PERIOD_CHANGE"));
  assert.ok(!result.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE"));
  assert.ok(!result.facts.some((f) => f.type.includes("PERIOD_CHANGE") || f.type === "CONFLICTING_PERIOD_SIGNAL"));
  assert.ok(!text.includes("59%"));
  assert.ok(result.caveats.some((c) => c.type === "PARTIAL_PERIOD"));
  assert.match(result.caveats.find((c) => c.type === "PARTIAL_PERIOD").text, /진행 중이라 완결된 기간과 직접 비교하지 않았습니다/);
});

test("2. cross-brand comparison remains valid during a live current period", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_CURRENT_LIVE, aTarget: CARNET_TARGET_PREV,
    bCurrent: TROUBLED_CURRENT_LIVE, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const leader = result.facts.find((f) => f.type === "REVENUE_LEADER");
  assert.ok(leader, "expected a REVENUE_LEADER cross-brand fact even though the current period is live");
  assert.equal(leader.axis, "CROSS_BRAND");
  assert.equal(leader.direction, "A_HIGHER");
});

test("3. missing brand row never becomes fake zero", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_TARGET_PREV, aTarget: { revenue: 12000000, quantitySold: 40, orderCount: 40, aov: 300000 },
    bCurrent: null, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(result.caveats.some((c) => c.type === "MISSING_DATA" && c.text.includes("TROUBLED WATERS")));
  assert.ok(!allText(result).includes("0원"));
  // Brand A의 유효한 period-change fact는 여전히 살아 있어야 한다.
  assert.ok(result.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE" || f.type === "CONFLICTING_PERIOD_SIGNAL"));
});

test("4. low-base comparison period suppresses dramatic percentage wording", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "TROUBLED WATERS", brandBName: "CARNET ARCHIVE",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: TROUBLED_CURRENT_LIVE, aTarget: TROUBLED_TARGET_YOY_LOW_BASE,
    bCurrent: CARNET_CURRENT_LIVE, bTarget: CARNET_TARGET_YOY,
    compositionA: null, compositionB: null, trendA: null
  });
  const text = allText(result);
  assert.ok(!text.includes("1128") && !text.includes("1,128"));
  assert.ok(!result.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE" || f.type === "CONFLICTING_PERIOD_SIGNAL"));
  assert.ok(result.caveats.some((c) => c.type === "LOW_BASE"));
});

test("5. conflicting period signal uses neutral observation wording only", () => {
  const engine = loadEngine();
  // 완결 기간만 사용: 매출 증가, 판매수량 감소, 객단가 증가(임계값을 확실히 넘는 값)
  const current = { revenue: 20000000, quantitySold: 20, orderCount: 20, aov: 1000000 };
  const target = { revenue: 12000000, quantitySold: 40, orderCount: 40, aov: 300000 };
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: current, aTarget: target,
    bCurrent: null, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const conflict = result.facts.find((f) => f.type === "CONFLICTING_PERIOD_SIGNAL");
  assert.ok(conflict, "expected a conflicting-signal fact");
  assert.match(conflict.text, /매출은 증가했지만 판매수량은 감소했고 객단가는 증가했습니다/);
  assertNoProhibitedWording(conflict.text);
  // 개별 REVENUE/UNITS/AOV_PERIOD_CHANGE가 별도로 또 나열되지 않아야 한다(합성 1개로 대체).
  assert.ok(!result.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE"));
});

test("6. saved period with both archives complete produces normal period-change facts", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_TARGET_PREV, aTarget: { revenue: 10000000, quantitySold: 30, orderCount: 30, aov: 333333 },
    bCurrent: null, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(result.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE" || f.type === "CONFLICTING_PERIOD_SIGNAL"));
});

test("7. materiality bands: noise / stable / growth / strong growth / decline / strong decline", () => {
  const engine = loadEngine();
  const tierOf = (current, target) => {
    const result = engine({
      brandAName: "A", brandBName: "B",
      currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
      aCurrent: { revenue: current, quantitySold: 100, orderCount: 50, aov: current / 50 },
      aTarget: { revenue: target, quantitySold: 100, orderCount: 50, aov: target / 50 },
      bCurrent: null, bTarget: null, compositionA: null, compositionB: null, trendA: null
    });
    const fact = result.facts.find((f) => f.type === "REVENUE_PERIOD_CHANGE");
    return fact ? fact.materiality : "STABLE_NO_FACT";
  };
  // absolute-floor noise guard: tiny absolute diff even if % looks non-trivial for a huge base
  assert.equal(tierOf(10000050, 10000000), "STABLE_NO_FACT");
  assert.equal(tierOf(10300000, 10000000), "STABLE_NO_FACT"); // 3% -> stable
  assert.equal(tierOf(11000000, 10000000), "MATERIAL"); // 10% -> growth
  assert.equal(tierOf(13000000, 10000000), "STRONG"); // 30% -> strong growth
  assert.equal(tierOf(9000000, 10000000), "MATERIAL"); // -10% -> decline
  assert.equal(tierOf(6000000, 10000000), "STRONG"); // -40% -> strong decline
});

test("8. zero denominator never produces Infinity/NaN/percent text", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 1000000, quantitySold: 10, orderCount: 10, aov: 100000 },
    aTarget: { revenue: 0, quantitySold: 0, orderCount: 0, aov: 0 },
    bCurrent: { revenue: 500000, quantitySold: 5, orderCount: 5, aov: 100000 },
    bTarget: { revenue: 0, quantitySold: 0, orderCount: 0, aov: 0 },
    compositionA: null, compositionB: null, trendA: null
  });
  const text = allText(result);
  assert.ok(!text.includes("Infinity"));
  assert.ok(!text.includes("NaN"));
  assert.ok(!/%/.test(text));
  // orderCount:0/revenue:0 target -> LOW_BASE(0 < 3, 0 < 500000), not a growth percentage claim.
  assert.ok(result.caveats.some((c) => c.type === "LOW_BASE"));
});

test("9. fact priority caps at 3 primary facts even with more candidates", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    // conflicting signal candidate (priority 1)
    aCurrent: { revenue: 20000000, quantitySold: 20, orderCount: 20, aov: 1000000, online: 18000000, offline: 2000000 },
    aTarget: { revenue: 12000000, quantitySold: 40, orderCount: 40, aov: 300000 },
    // cross-brand material revenue diff (priority 2) + channel structural diff (priority 3)
    bCurrent: { revenue: 3000000, quantitySold: 10, orderCount: 10, aov: 300000, online: 0, offline: 3000000 },
    bTarget: null,
    compositionA: { status: "ready", stats: { stylist: { count: 90, sales: 1 }, customer: { count: 10, sales: 1 } } },
    compositionB: { status: "ready", stats: { stylist: { count: 20, sales: 1 }, customer: { count: 80, sales: 1 } } },
    trendA: [
      { key: "2026-05", revenue: 30000000 }, { key: "2026-06", revenue: 25000000 },
      { key: "2026-07", revenue: 20000000 }, { key: "2026-08", revenue: 9000000 }
    ]
  });
  assert.ok(result.facts.length <= 3, `expected at most 3 facts, got ${result.facts.length}`);
  // priority order preserved: conflicting-signal first, revenue cross-brand second
  assert.equal(result.facts[0].type, "CONFLICTING_PERIOD_SIGNAL");
  assert.equal(result.facts[1].type, "REVENUE_LEADER");
});

test("10. wording safety — no evaluative/recommendation/causal vocabulary anywhere", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 20000000, quantitySold: 20, orderCount: 20, aov: 1000000, online: 18000000, offline: 2000000 },
    aTarget: { revenue: 12000000, quantitySold: 40, orderCount: 40, aov: 300000 },
    bCurrent: { revenue: 3000000, quantitySold: 10, orderCount: 10, aov: 300000, online: 0, offline: 3000000 },
    bTarget: null,
    compositionA: { status: "ready", stats: { stylist: { count: 90, sales: 1 } } },
    compositionB: { status: "ready", stats: { stylist: { count: 20, sales: 1 }, customer: { count: 80, sales: 1 } } },
    trendA: null
  });
  assertNoProhibitedWording(allText(result));
});

test("11. NULL != ZERO regression", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_TARGET_PREV, aTarget: null,
    bCurrent: null, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(!allText(result).includes("0원"));
  assert.ok(result.caveats.some((c) => c.type === "MISSING_DATA"));
});

test("12. trend excludes the live final month and requires 3 completed consecutive months", () => {
  const engine = loadEngine();
  const trendCompleted = [
    { key: "2026-05", revenue: 10000000 }, { key: "2026-06", revenue: 12000000 }, { key: "2026-07", revenue: 14000000 }
  ];
  const up = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: null, aTarget: null, bCurrent: null, bTarget: null,
    compositionA: null, compositionB: null, trendA: trendCompleted
  });
  assert.ok(up.facts.some((f) => f.type === "RECENT_TREND" && f.direction === "UP"));

  const trendWithLiveMonth = [...trendCompleted, { key: "2026-08", revenue: 1 }]; // 마지막 달이 live -> 제외돼야 함
  const excludesLive = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    aCurrent: null, aTarget: null, bCurrent: null, bTarget: null,
    compositionA: null, compositionB: null, trendA: trendWithLiveMonth
  });
  const trendFact = excludesLive.facts.find((f) => f.type === "RECENT_TREND");
  assert.ok(trendFact, "trend should still resolve from the 3 completed months once the live month is excluded");
  assert.equal(trendFact.direction, "UP");
  assert.ok(!trendFact.values.months.some((m) => m.key === "2026-08"));
});

// ==========================================================================
// NEXT-CROSS-BRAND-FACT: Units/Orders/AOV/Channel Dominance 확장 테스트.
// 위 1~12번(STEP67-10G-3)은 전부 무변경으로 재검증됐다(회귀 없음) — 아래는
// 새로 추가된 낮은 우선순위(5~8) 후보들만 격리해서 검증한다.
// ==========================================================================

test("13. Units cross-brand fact generated when material and isolated from other metrics", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 100, orderCount: 50, aov: 200000 },
    aTarget: null,
    bCurrent: { revenue: 9500000, quantitySold: 50, orderCount: 48, aov: 197917 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const unitsFact = result.facts.find((f) => f.type === "QUANTITYSOLD_LEADER");
  assert.ok(unitsFact, "expected a QUANTITYSOLD_LEADER cross-brand fact");
  assert.equal(unitsFact.axis, "CROSS_BRAND");
  assert.equal(unitsFact.direction, "A_HIGHER");
  assert.match(unitsFact.text, /CARNET ARCHIVE의 판매수량이 TROUBLED WATERS보다 높습니다/);
  // revenue(5%)/orderCount(4%)/aov(1%) 전부 유사 임계값 미달 — 이 fixture에서는 생성되지 않는다.
  assert.ok(!result.facts.some((f) => f.type === "REVENUE_LEADER"));
  assert.ok(!result.facts.some((f) => f.type === "ORDERCOUNT_LEADER"));
  assert.ok(!result.facts.some((f) => f.type === "AOV_LEADER"));
});

test("14. Orders cross-brand fact generated when material", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 100, orderCount: 80, aov: 125000 },
    aTarget: null,
    bCurrent: { revenue: 9500000, quantitySold: 96, orderCount: 40, aov: 110000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const ordersFact = result.facts.find((f) => f.type === "ORDERCOUNT_LEADER");
  assert.ok(ordersFact, "expected an ORDERCOUNT_LEADER cross-brand fact");
  assert.equal(ordersFact.direction, "A_HIGHER");
  assert.match(ordersFact.text, /CARNET ARCHIVE의 주문수가 TROUBLED WATERS보다 높습니다/);
});

test("15. AOV cross-brand fact generated when material (revenue/orderCount-derived, unchanged formula)", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 100, orderCount: 50, aov: 200000 },
    aTarget: null,
    bCurrent: { revenue: 9500000, quantitySold: 97, orderCount: 48, aov: 100000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const aovFact = result.facts.find((f) => f.type === "AOV_LEADER");
  assert.ok(aovFact, "expected an AOV_LEADER cross-brand fact");
  assert.equal(aovFact.direction, "A_HIGHER");
  assert.match(aovFact.text, /CARNET ARCHIVE의 객단가가 TROUBLED WATERS보다 높습니다/);
});

test("16. Channel Dominance — same dominant channel produces a joint, non-causal fact", () => {
  const channelDominantFact = loadChannelDominantFact();
  // 실측(STEP67-10G-3 §21): CARNET ARCHIVE 89.2%/TROUBLED WATERS 100% 오프라인 —
  // 구조 차이(10.8%p)는 CHANNEL_STRUCTURE_DIFF 임계값(20%p) 미달이지만 둘 다
  // 개별적으로는 70% 이상 OFFLINE_DOMINANT다.
  const fact = channelDominantFact(CARNET_CURRENT_LIVE, TROUBLED_CURRENT_LIVE, "CARNET ARCHIVE", "TROUBLED WATERS");
  assert.ok(fact, "expected a CHANNEL_DOMINANT fact for two individually offline-dominant brands");
  assert.equal(fact.type, "CHANNEL_DOMINANT");
  assert.equal(fact.direction, "SAME_DOMINANT");
  assert.match(fact.text, /CARNET ARCHIVE의 오프라인 비중이 높고, TROUBLED WATERS의 오프라인 비중도 높습니다/);
  assertNoProhibitedWording(fact.text);
});

test("17. Channel Dominance — different dominant channel produces a contrasting, non-causal fact", () => {
  const channelDominantFact = loadChannelDominantFact();
  const fact = channelDominantFact(
    { online: 1000000, offline: 9000000 },
    { online: 9000000, offline: 1000000 },
    "CARNET ARCHIVE", "TROUBLED WATERS"
  );
  assert.ok(fact);
  assert.equal(fact.direction, "DIFFERENT_DOMINANT");
  assert.match(fact.text, /CARNET ARCHIVE의 오프라인 비중이 높고, TROUBLED WATERS의 온라인 비중이 높습니다/);
  assertNoProhibitedWording(fact.text);
});

test("18. Channel Dominance — a balanced counterpart is never described (no invented interpretation)", () => {
  const channelDominantFact = loadChannelDominantFact();
  const fact = channelDominantFact(
    { online: 1000000, offline: 9000000 }, // 0.9 offline-dominant
    { online: 5000000, offline: 5000000 }, // 0.5 balanced
    "CARNET ARCHIVE", "TROUBLED WATERS"
  );
  assert.ok(fact);
  assert.equal(fact.direction, "A_ONLY");
  assert.match(fact.text, /^CARNET ARCHIVE의 오프라인 비중이 높습니다\.$/);
  assert.doesNotMatch(fact.text, /TROUBLED WATERS/);
});

test("19. Channel Dominance — both brands balanced produces no fact (not a vacuous statement)", () => {
  const channelDominantFact = loadChannelDominantFact();
  const fact = channelDominantFact(
    { online: 4500000, offline: 5500000 }, // 0.55 balanced
    { online: 5500000, offline: 4500000 }, // 0.45 balanced
    "CARNET ARCHIVE", "TROUBLED WATERS"
  );
  assert.equal(fact, null);
});

test("20. Channel Dominance never duplicates an already-material CHANNEL_STRUCTURE_DIFF", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 50, orderCount: 40, aov: 250000, online: 9000000, offline: 1000000 },
    aTarget: null,
    bCurrent: { revenue: 9500000, quantitySold: 48, orderCount: 38, aov: 197917, online: 1000000, offline: 9000000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(result.facts.some((f) => f.type === "CHANNEL_STRUCTURE_DIFF"));
  assert.ok(!result.facts.some((f) => f.type === "CHANNEL_DOMINANT"), "CHANNEL_DOMINANT must not appear alongside an already-material CHANNEL_STRUCTURE_DIFF");
});

test("21. null metric on one brand excludes only that metric's cross-brand fact (Null != Zero)", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 100, orderCount: null, aov: 200000 },
    aTarget: null,
    bCurrent: { revenue: 4000000, quantitySold: 40, orderCount: 40, aov: 100000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(!result.facts.some((f) => f.type === "ORDERCOUNT_LEADER"), "orderCount is null on Brand A, the ORDERS fact must be skipped, not treated as zero");
  assert.ok(result.facts.some((f) => f.type === "REVENUE_LEADER"), "revenue is present on both sides and material, must still generate");
});

test("22. zero metric value is handled safely — a real zero is not treated as missing, no Infinity/NaN", () => {
  const engine = loadEngine();
  const oneSidedZero = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 0, orderCount: 40, aov: 250000 },
    aTarget: null,
    bCurrent: { revenue: 9500000, quantitySold: 100, orderCount: 38, aov: 100000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  const text = allText(oneSidedZero);
  assert.ok(!text.includes("Infinity"));
  assert.ok(!text.includes("NaN"));
  const unitsFact = oneSidedZero.facts.find((f) => f.type === "QUANTITYSOLD_LEADER");
  assert.ok(unitsFact, "zero on one side vs a real value must still produce a material fact, not be skipped as if missing");
  assert.equal(unitsFact.direction, "B_HIGHER");

  const bothZero = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 0, orderCount: 40, aov: 250000 },
    aTarget: null,
    bCurrent: { revenue: 9500000, quantitySold: 0, orderCount: 38, aov: 100000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(!bothZero.facts.some((f) => f.type === "QUANTITYSOLD_LEADER"));
  assert.ok(!allText(bothZero).includes("NaN"));
});

test("23. Partial-period cutoff preserved — live period keeps new cross-brand facts, still no period-change claims", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_CURRENT_LIVE, aTarget: CARNET_TARGET_PREV,
    bCurrent: TROUBLED_CURRENT_LIVE, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(result.facts.some((f) => f.type === "QUANTITYSOLD_LEADER" && f.axis === "CROSS_BRAND"), "CROSS_BRAND facts remain allowed during a live current period");
  assert.ok(!result.facts.some((f) => f.type.includes("PERIOD_CHANGE")), "no PERIOD_CHANGE-type fact must ever appear while the current period is live");
  assert.ok(result.caveats.some((c) => c.type === "PARTIAL_PERIOD"));
});

test("24. swapping comparison brand / changing period only affects the relevant output (pure function, no hidden state)", () => {
  const engine = loadEngine();
  const resultAB = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 100, orderCount: 50, aov: 200000 },
    aTarget: null,
    bCurrent: { revenue: 4000000, quantitySold: 40, orderCount: 20, aov: 100000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.equal(resultAB.facts.find((f) => f.type === "REVENUE_LEADER").direction, "A_HIGHER");

  const resultSwapped = engine({
    brandAName: "TROUBLED WATERS", brandBName: "CARNET ARCHIVE",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 4000000, quantitySold: 40, orderCount: 20, aov: 100000 },
    aTarget: null,
    bCurrent: { revenue: 10000000, quantitySold: 100, orderCount: 50, aov: 200000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.equal(resultSwapped.facts.find((f) => f.type === "REVENUE_LEADER").direction, "B_HIGHER");

  const resultDifferentPeriod = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "saved", currentStatus: "success", targetStatus: "success",
    aCurrent: { revenue: 10000000, quantitySold: 100, orderCount: 50, aov: 200000 },
    aTarget: { revenue: 8000000, quantitySold: 90, orderCount: 45, aov: 177778 },
    bCurrent: { revenue: 4000000, quantitySold: 40, orderCount: 20, aov: 100000 },
    bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(resultDifferentPeriod.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE" || f.type === "CONFLICTING_PERIOD_SIGNAL"));
  assert.equal(resultDifferentPeriod.facts.find((f) => f.type === "REVENUE_LEADER").direction, "A_HIGHER");
});

test("25. wording safety — new metrics (units/orders/aov/channel dominance) never use prohibited vocabulary", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    aCurrent: CARNET_CURRENT_LIVE, aTarget: CARNET_TARGET_PREV,
    bCurrent: TROUBLED_CURRENT_LIVE, bTarget: null,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(result.facts.some((f) => f.type === "QUANTITYSOLD_LEADER"));
  assertNoProhibitedWording(allText(result));
});

// ==========================================================================
// STEP67 cross-brand-partial-period P2: targetPeriodBasis="cutoff" 입력이 들어올
// 때만 PARTIAL_PERIOD 억제를 풀고 CUTOFF_NORMALIZED 캐치업으로 바꾼다. 실측 값은
// docs/reports/STEP67-cross-brand-partial-period-p1.md §14(2026-08-11, base 2026-08
// vs compare 2026-07, cutoff 8/1~8/11 vs 7/1~7/11)에서 그대로 가져왔다.
// ==========================================================================
const CARNET_CUTOFF_BASE = { revenue: 10883059, quantitySold: 32, orderCount: 25, aov: 435322, online: 1021959, offline: 9861100 };
const CARNET_CUTOFF_COMPARISON = { revenue: 6481990, quantitySold: 19, orderCount: 17, aov: 381294, online: 161290, offline: 6320700 };
const TROUBLED_CUTOFF_BASE = { revenue: 8274400, quantitySold: 26, orderCount: 21, aov: 394019, online: 0, offline: 8274400 };
const TROUBLED_CUTOFF_COMPARISON = { revenue: 1075000, quantitySold: 3, orderCount: 3, aov: 358333, online: 0, offline: 1075000 };

test("26. cutoff-normalized target period allows PERIOD_CHANGE facts and replaces PARTIAL_PERIOD with CUTOFF_NORMALIZED", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    targetPeriodBasis: "cutoff",
    aCurrent: CARNET_CUTOFF_BASE, aTarget: CARNET_CUTOFF_COMPARISON,
    bCurrent: TROUBLED_CUTOFF_BASE, bTarget: TROUBLED_CUTOFF_COMPARISON,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(!result.caveats.some((c) => c.type === "PARTIAL_PERIOD"), "PARTIAL_PERIOD must not appear once the target period is cutoff-normalized");
  assert.ok(result.caveats.some((c) => c.type === "CUTOFF_NORMALIZED"), "expected a CUTOFF_NORMALIZED caveat");
  assert.match(result.caveats.find((c) => c.type === "CUTOFF_NORMALIZED").text, /동일 경과일 기준으로 비교했습니다/);
  const periodFact = result.facts.find((f) => f.type === "REVENUE_PERIOD_CHANGE" || f.type === "CONFLICTING_PERIOD_SIGNAL");
  assert.ok(periodFact, "cutoff-normalized period-change facts must be allowed to generate, unlike the plain PARTIAL_PERIOD case");
  assertNoProhibitedWording(allText(result));
});

test("27. cross-brand fact is prefixed with same-elapsed-day framing during a live current period", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    targetPeriodBasis: "cutoff",
    aCurrent: CARNET_CUTOFF_BASE, aTarget: CARNET_CUTOFF_COMPARISON,
    bCurrent: TROUBLED_CUTOFF_BASE, bTarget: TROUBLED_CUTOFF_COMPARISON,
    compositionA: null, compositionB: null, trendA: null
  });
  const leader = result.facts.find((f) => f.type === "REVENUE_LEADER");
  assert.ok(leader);
  assert.match(leader.text, /^동일 경과일 기준 CARNET ARCHIVE의 매출이 TROUBLED WATERS보다 높습니다\.$/);
});

test("28. without cutoff normalization, live period keeps the original PARTIAL_PERIOD suppression unchanged (regression)", () => {
  const engine = loadEngine();
  const result = engine({
    brandAName: "CARNET ARCHIVE", brandBName: "TROUBLED WATERS",
    currentArchiveStatus: "live", currentStatus: "success", targetStatus: "success",
    targetPeriodBasis: "full_month",
    aCurrent: CARNET_CUTOFF_BASE, aTarget: CARNET_CUTOFF_COMPARISON,
    bCurrent: TROUBLED_CUTOFF_BASE, bTarget: TROUBLED_CUTOFF_COMPARISON,
    compositionA: null, compositionB: null, trendA: null
  });
  assert.ok(result.caveats.some((c) => c.type === "PARTIAL_PERIOD"));
  assert.ok(!result.caveats.some((c) => c.type === "CUTOFF_NORMALIZED"));
  assert.ok(!result.facts.some((f) => f.type === "REVENUE_PERIOD_CHANGE" || f.type === "CONFLICTING_PERIOD_SIGNAL"));
  // cross-brand는 cutoff 여부와 무관하게 여전히 "동일 경과일 기준" 프레이밍을 쓴다
  // (aCurrent/bCurrent는 언제나 같은 만큼만 누적된 같은 기간이므로, §9 원 설계 그대로).
  const leader = result.facts.find((f) => f.type === "REVENUE_LEADER");
  assert.match(leader.text, /^동일 경과일 기준/);
});
