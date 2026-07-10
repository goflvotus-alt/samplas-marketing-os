const navItems = [
  "Overview",
  "Content",
  "Editorial AI",
  "Advertising",
  "Sales",
  "Reports",
  "Settings"
];

const months = ["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01"];
let monthlyData = [];
let storyData = { stories: [], totals: {} };
let activeContentTab = "All";
let activeAdLevel = "campaign";
let currentTodayBriefingItems = [];
// Cafe24 재인증 콜백이 실패로 돌아왔을 때만 채워진다(handleCafe24OAuthRedirect() 참고).
// (2026-07-08 Cafe24 재인증 흐름 개선)
let cafe24OAuthErrorReason = null;

const nf = new Intl.NumberFormat("ko-KR");
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const defaultProjectLinks = {
  cafe24: "",
  advertising: "",
  content: "",
  cardnews: "",
  editorial: "",
  overview: ""
};

function num(value) {
  return nf.format(Number(value || 0));
}

function krw(value) {
  return `${nf.format(Math.round(Number(value || 0) / 10000))}만원`;
}

function won(value) {
  return `${nf.format(Math.round(Number(value || 0)))}원`;
}

function hasApiValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function apiNum(value) {
  return hasApiValue(value) ? nf.format(Number(value)) : "-";
}

function apiWon(value) {
  return hasApiValue(value) ? `${nf.format(Math.round(Number(value)))}원` : "-";
}

function cafe24MoneyValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "object") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function instagramApiErrors(data = {}) {
  const errors = data.apiErrors || [];
  const account = errors.find((item) => item.source === "instagram_account_insights")?.message || "";
  const media = errors.find((item) => item.source === "instagram_media_insights")?.message || "";
  return {
    account: account ? `데이터 오류: ${account}` : "",
    media: media ? `데이터 오류: ${media}` : ""
  };
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
}

function multiple(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}x` : "-";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function monthEnd(month) {
  const [year, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

async function getJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `응답을 읽지 못했습니다: ${text.slice(0, 100)}` };
    }
    if (!response.ok && !body.error) body.error = `API 오류 ${response.status}`;
    return body;
  } catch (error) {
    return { error: error.name === "AbortError" ? "응답 지연" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, payload, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `응답을 읽지 못했습니다: ${text.slice(0, 100)}` };
    }
    if (!response.ok && !body.error) body.error = `API 오류 ${response.status}`;
    return body;
  } catch (error) {
    return { error: error.name === "AbortError" ? "응답 지연" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function selectedMonth() {
  const value = $("#monthSelect")?.value;
  return monthlyData.find((item) => item.month === value) || monthlyData[0] || emptyMonth("2026-07");
}

function emptyMonth(month) {
  return {
    month,
    source: "disconnected",
    account: {
      followers: 0,
      followerDelta: 0,
      reach: 0,
      reachDelta: 0,
      views: 0,
      viewsDelta: 0,
      profileVisits: 0,
      profileVisitDelta: 0,
      websiteClicks: 0,
      websiteClickDelta: 0,
      accountEngagement: 0,
      growthRate: 0
    },
    posts: []
  };
}

function errorMonth(month, error) {
  return {
    ...emptyMonth(month),
    source: "api_error",
    error: error || "API 오류",
    cacheWarning: error || "API 오류"
  };
}

function sourceLabel(data) {
  if (!data) return "-";
  if (data.source === "csv_required") return "업로드 필요";
  if (String(data.source || "").startsWith("csv_import")) return "저장 데이터";
  if (String(data.source || "").includes("_cached")) return "저장 데이터";
  if (String(data.source || "").includes("graph_api")) return "자동 갱신";
  return data.source || "-";
}

function sourceText(data) {
  if (isPermissionBlocked(data)) return "Meta 권한 차단: 토큰 권한 또는 앱 권한 확인 필요";
  if (data.source === "csv_required") return data.message || "지난 달은 CSV 업로드 후 표시";
  if (String(data.source || "").startsWith("csv_import")) return "CSV 고정 월간 데이터";
  if (String(data.source || "").includes("_cached")) return "저장된 API 캐시 데이터";
  if (String(data.source || "").includes("graph_api")) return "Instagram Graph API 데이터";
  return "연결 확인 필요";
}

function isPermissionBlocked(data) {
  const text = `${data?.error || ""} ${data?.category || ""}`.toLowerCase();
  return text.includes("api access blocked") || text.includes("permission_blocked");
}

function statusTextForError(data) {
  if (isPermissionBlocked(data)) return "권한 차단";
  if (String(data?.error || "").toLowerCase().includes("refresh_token")) return "토큰 만료";
  return "오류";
}

// 지금 보고 있는 Meta Ads 데이터가 실시간인지/캐시인지/조회 실패인지 한눈에 보이도록 하는 배지입니다.
// - 🔴 No Data: API 호출 자체가 실패했고 저장된 캐시도 없는 경우 (숫자를 지어내지 않고 실패를 그대로 보여줌)
// - 🟡 Cache: 캐시를 사용 중 (정상적으로 저장된 값을 우선 사용했거나, 실시간 조회 실패 후 대체한 경우)
// - 🟢 Live Meta API: 지금 이 요청에서 Meta API를 직접 호출해 받은 값
function metaAdsSourceBadge(meta = {}) {
  if (meta.error) {
    return { icon: "🔴", label: "No Data", tone: "error", detail: meta.error };
  }
  const source = String(meta.source || "");
  const cacheMode = meta.cacheMode || "";
  if (source.includes("_cached") || cacheMode) {
    const syncedMs = meta.syncedAt ? new Date(meta.syncedAt).getTime() : null;
    let agoText = "";
    if (syncedMs) {
      const minutes = Math.max(0, Math.round((Date.now() - syncedMs) / 60000));
      agoText = minutes < 1 ? " · 방금 전 저장" : minutes < 60 ? ` · ${minutes}분 전 저장` : ` · ${Math.round(minutes / 60)}시간 전 저장`;
    }
    const fallbackNote = cacheMode === "fallback_after_error" ? ` · 실시간 조회 실패로 저장된 값 표시(${meta.cacheWarning || ""})` : "";
    return { icon: "🟡", label: "Cache", tone: "warn", detail: `${agoText}${fallbackNote}` };
  }
  return { icon: "🟢", label: "Live Meta API", tone: "good", detail: "" };
}

// Sidebar is a persistent "traffic light" visible on every tab, so it only
// carries dot color + a 4-word badge (정상 / Cache / 실패 / 재인증 필요).
// Full reasons/actions live in the Overview Health Banner and the Settings
// API Health Center — kept out of this function on purpose.
function setSyncRow(id, tone, label, badge) {
  const row = $(`#${id}`);
  if (!row) return;
  row.classList.remove("loading", "good", "warn", "error");
  row.classList.add(tone);
  row.innerHTML = `<span></span><strong>${esc(label)}</strong><em>${esc(badge)}</em>`;
}

// Condenses the richer bannerState() classification (used by the Overview
// Health Banner) down to the sidebar's 4-word vocabulary. Reuses the same
// classification instead of re-deriving status, so sidebar and banner never
// disagree.
function sidebarBadgeFromState(state) {
  if (state.tone === "good") return { tone: "good", badge: "정상" };
  if (state.tone === "error") {
    const isReauth = state.label === "토큰 만료" || state.label === "권한 만료";
    return { tone: "error", badge: isReauth ? "재인증 필요" : "실패" };
  }
  return { tone: "warn", badge: "Cache" };
}

function toast(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = navItems.map((item, index) => (
    `<button type="button" class="${index === 0 ? "active" : ""}" data-view="${esc(item)}">${esc(item)}</button>`
  )).join("");
  setTopbarTitle(navItems[0]);
  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    $$(".nav button").forEach((node) => node.classList.toggle("active", node === button));
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
    setTopbarTitle(button.dataset.view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// Topbar used to repeat "MONTHLY INTELLIGENCE / Marketing Director / SAMPLAS"
// on every tab (already shown once in the sidebar brand block). Replaced with
// a single line reflecting which tab is actually open right now.
function setTopbarTitle(view) {
  const target = $("#topbarTitle");
  if (target) target.textContent = view;
}

function renderContentTabs() {
  $$("[data-content-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.contentTab === activeContentTab);
  });
  $$("[data-content-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.contentPanel === activeContentTab);
  });
}

function renderMonthSelect() {
  const select = $("#monthSelect");
  const current = select.value;
  select.innerHTML = monthlyData.map((item) => `<option value="${item.month}">${item.month}</option>`).join("");
  const bestMonth = monthlyData.find((item) => (item.posts || []).length || Number(item.account?.reach || 0) || Number(item.account?.views || 0));
  select.value = monthlyData.some((item) => item.month === current) ? current : bestMonth?.month || monthlyData[0]?.month || "2026-07";
  select.onchange = renderAll;
}

// Reports used to list every month as a row of pills (its own month picker,
// duplicating the topbar's #monthSelect) under two stacked "Reports /
// 월간 보고서 / Monthly Summary / 월간 요약" headers. Director-mode pass:
// one compact "‹ [month] ›" switcher, no repeated titles, so the report's
// own headline ("2026-07 SAMPLAS MONTHLY REPORT" from renderMonthlyDashboard)
// is what the operator actually sees first.
function renderMonthRail(data) {
  const rail = $("#monthRail");
  if (!rail) return;
  const index = monthlyData.findIndex((item) => item.month === data.month);
  const older = index >= 0 ? monthlyData[index + 1] : null;
  const newer = index > 0 ? monthlyData[index - 1] : null;
  rail.innerHTML = `
    <button type="button" class="month-nav-btn" data-nav="prev" ${older ? "" : "disabled"} aria-label="이전 달">‹</button>
    <select id="monthRailSelect" aria-label="리포트 월 선택">
      ${monthlyData.map((item) => `<option value="${esc(item.month)}" ${item.month === data.month ? "selected" : ""}>${esc(item.month)}</option>`).join("")}
    </select>
    <button type="button" class="month-nav-btn" data-nav="next" ${newer ? "" : "disabled"} aria-label="다음 달">›</button>
    <span class="month-rail-source">${esc(sourceLabel(data))}</span>
  `;
  rail.querySelector('[data-nav="prev"]')?.addEventListener("click", () => {
    if (!older) return;
    $("#monthSelect").value = older.month;
    renderAll();
  });
  rail.querySelector('[data-nav="next"]')?.addEventListener("click", () => {
    if (!newer) return;
    $("#monthSelect").value = newer.month;
    renderAll();
  });
  rail.querySelector("#monthRailSelect")?.addEventListener("change", (event) => {
    $("#monthSelect").value = event.target.value;
    renderAll();
  });
}

function renderKpis(data) {
  if (data.error) {
    const status = statusTextForError(data);
    $("#kpiGrid").innerHTML = [
      ["데이터 오류", status, data.error],
      ["월", data.month || "-", "연결 상태를 확인하세요"],
      ["표시 상태", "0으로 대체 안 함", "실제 데이터가 없으면 원인을 표시합니다."]
    ].map(([label, value, delta]) => (
      `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><p class="delta">${esc(delta)}</p></article>`
    )).join("");
    return;
  }
  const a = data.account || {};
  const postCount = (data.posts || []).length;
  const instagramErrors = instagramApiErrors(data);
  const items = [
    ["오늘 매출", "확인 중", "Cafe24 확인 중"],
    ["오늘 광고비", "확인 중", "Meta Ads 확인 중"],
    ["오늘 주문", "확인 중", "Cafe24 확인 중"],
    ["오늘 인기상품", "-", "Cafe24 확인 중"]
  ];
  $("#kpiGrid").innerHTML = items.map(([label, value, delta]) => (
    `<article class="kpi"><span>${label}</span><strong>${value}</strong><p class="delta">${delta}</p></article>`
  )).join("");
}

async function renderOverviewLiveData(data) {
  const target = $("#overviewLiveData");
  const supportTarget = $("#overviewLiveSupport");
  if (!target || !supportTarget) return;
  target.innerHTML = `<article class="action-item"><strong>이번 달 KPI 확인 중</strong><p>매출, 광고, 팔로워, 콘텐츠를 정리합니다.</p></article>`;
  supportTarget.innerHTML = "";
  $("#todayBriefProgress").innerHTML = todayBriefProgressBar([]);
  $("#todayBriefing").innerHTML = `<article class="today-brief-card warning"><div class="today-brief-head"><span>!</span><strong>오늘 해야 할 일을 정리 중입니다.</strong></div><p>연결 상태와 성과 데이터를 확인하고 있습니다.</p></article>`;
  $("#actions").innerHTML = `<article class="home-action-card warn"><span>!</span><div><strong>확인 중</strong><p>중요 알림을 정리합니다.</p></div></article>`;
  $("#nextActions").innerHTML = homeGoalCards();
  $("#insightList").innerHTML = homeActivityCards({ status: {}, meta: {}, cafe: {}, data });

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const [status, meta, cafe, cardnewsStatus] = await Promise.all([
    getJson("/api/status", 6000),
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=500`, 7000),
    getJson("/api/contents/cardnews-status", 6000)
  ]);

  const a = data.account || {};
  const metaTotals = meta.totals || {};
  const cafeTotals = cafe.totals || {};
  const instagramErrors = instagramApiErrors(data);
  const posts = data.posts || [];
  const postCount = posts.length;
  const topContent = topPosts(posts, purposeScore, 1)[0];
  const topSaved = topPosts(posts, (post) => postMetrics(post).saveRate, 1)[0];
  const topCampaign = [...(meta.campaigns || [])].sort((left, right) => Number(right.purchaseValue || 0) - Number(left.purchaseValue || 0))[0];
  const topProduct = (cafe.topProducts || [])[0];
  const roas = Number(metaTotals.spend || 0) ? Number(metaTotals.purchaseValue || 0) / Number(metaTotals.spend || 0) : null;
  const avgSaveRate = avg(posts.map((post) => postMetrics(post).saveRate));
  const followerDelta = Number(a.followerDelta || 0);

  renderHealthBanner({ instagram: data, meta, cafe });

  $("#kpiGrid").innerHTML = [
    homeTopMetric("오늘 매출", cafe.error ? "연결 필요" : apiWon(cafeTotals.orderAmount), cafe.error ? "Cafe24 연결 후 표시" : "선택기간 기준", cardBadge("cafe24", cafe, hasApiValue(cafeTotals.orderAmount))),
    homeTopMetric("오늘 광고비", meta.error ? "확인 필요" : apiWon(metaTotals.spend), meta.error ? "Meta 연결 후 표시" : "선택기간 기준", cardBadge("meta", meta, hasApiValue(metaTotals.spend))),
    homeTopMetric("오늘 주문", cafe.error ? "데이터 없음" : `${apiNum(cafeTotals.orderCount)}건`, cafe.error ? "Cafe24 연결 후 표시" : "정상 주문", cardBadge("cafe24", cafe, hasApiValue(cafeTotals.orderCount))),
    homeTopMetric("오늘 인기상품", topProduct?.productName || "데이터 없음", topProduct ? `${apiNum(topProduct.quantity)}개 · ${apiWon(topProduct.itemAmount)}` : "판매 상품 데이터 없음", cardBadge("cafe24", cafe, Boolean(topProduct)))
  ].join("");

  currentTodayBriefingItems = buildTodayBriefing({ data, meta, cafe, cardnewsStatus, account: a, topSaved, topCampaign, topProduct, roas });
  renderTodayBriefing();

  target.innerHTML = [
    homeMonthPrimaryCard("매출", cafe.error ? "연결 필요" : apiWon(cafeTotals.orderAmount), cafe.error ? "Cafe24 확인 필요" : `주문 ${apiNum(cafeTotals.orderCount)}건`, cardBadge("cafe24", cafe, hasApiValue(cafeTotals.orderAmount))),
    homeMonthPrimaryCard("ROAS", roas === null ? "확인 중" : multiple(roas), "Meta 기준 추정 구매값", cardBadge("meta", meta, roas !== null)),
    homeMonthPrimaryCard("평균 저장률", posts.length ? pct(avgSaveRate) : "데이터 없음", posts.length ? "콘텐츠 평균" : "콘텐츠 데이터 없음", cardBadge("instagram", data, posts.length > 0))
  ].join("");

  supportTarget.innerHTML = [
    homeMonthSupportCard("광고비", meta.error ? "확인 필요" : apiWon(metaTotals.spend), meta.error ? "Meta 확인 필요" : "Meta Ads", cardBadge("meta", meta, hasApiValue(metaTotals.spend))),
    homeMonthSupportCard("팔로워 증가", followerDelta ? `${apiNum(followerDelta)}명` : "데이터 없음", `현재 ${apiNum(a.followers)}명`, cardBadge("instagram", data, Boolean(followerDelta))),
    homeMonthSupportCard("콘텐츠 개수", `${apiNum(postCount)}개`, data.postsScope === "recent_media_fallback" ? "최근 미디어 기준" : "선택 월 기준", cardBadge("instagram", data, postCount > 0))
  ].join("");

  const actions = buildOverviewActions({ data, meta, cafe, account: a, topSaved, roas });
  $("#actions").innerHTML = actions.map((item) => homeActionCard(item)).join("");
  $("#nextActions").innerHTML = homeGoalCards({ cafeTotals, metaTotals, postCount, followerDelta });
  $("#insightList").innerHTML = homeActivityCards({ status, meta, cafe, data });
}

function buildTodayBriefing({ data, meta, cafe, cardnewsStatus, account, topSaved, topCampaign, topProduct, roas }) {
  const items = [];
  if (cafe.error) {
    items.push({
      level: "critical",
      icon: "!",
      title: "Cafe24 연결 확인",
      why: "실제 매출과 주문 데이터를 불러오지 못했습니다.",
      evidence: cafe.error || "Cafe24 주문 API 확인 필요",
      score: 98,
      basis: ["Cafe24 오류", "매출 카드 연결 필요", "주문 데이터 확인 불가"],
      expected: { reach: "-", saves: "-", shares: "-" },
      view: "Sales",
      cta: "Sales 보기",
      projectKey: "cafe24"
    });
  }
  if (meta.error) {
    items.push({
      level: "critical",
      icon: "!",
      title: "Meta API 오류 확인",
      why: "광고비와 구매값을 확인할 수 없어 ROAS 판단이 막힙니다.",
      evidence: meta.error || "Meta Ads API 확인 필요",
      score: 95,
      basis: ["Meta API 오류", "광고비 확인 불가", "ROAS 판단 불가"],
      expected: { reach: "-", saves: "-", shares: "-" },
      view: "Advertising",
      cta: "광고 보기",
      projectKey: "advertising"
    });
  }
  if (roas !== null && roas < 1) {
    items.push({
      level: "warning",
      icon: "!",
      title: "ROAS 낮은 광고 점검",
      why: "광고비 대비 Meta 기준 구매값이 낮습니다.",
      evidence: `ROAS ${multiple(roas)} · 광고비 ${apiWon(meta.totals?.spend)} · 구매값 ${apiWon(meta.totals?.purchaseValue)}`,
      score: recommendationScore(86, roas < 0.5 ? 10 : 0),
      basis: [`ROAS ${multiple(roas)}`, `광고비 ${apiWon(meta.totals?.spend)}`, `구매값 ${apiWon(meta.totals?.purchaseValue)}`],
      expected: { reach: apiNum(meta.totals?.reach), saves: "-", shares: "-" },
      view: "Advertising",
      cta: "광고 점검",
      projectKey: "advertising"
    });
  }
  if (topSaved) {
    const m = postMetrics(topSaved);
    items.push({
      level: "opportunity",
      icon: "+",
      title: "저장률 높은 콘텐츠 재활용",
      why: "저장률이 높은 콘텐츠는 다시 볼 이유가 있어 다음 카드뉴스 소재로 확장하기 좋습니다.",
      evidence: `${topSaved.title || "성과 좋은 콘텐츠"} · 저장률 ${pct(m.saveRate)} · 저장 ${apiNum(topSaved.saves)}`,
      score: recommendationScore(72, m.saveRate * 3),
      basis: [`저장률 ${pct(m.saveRate)}`, `Reach ${apiNum(topSaved.reach)}`, `최근 게시 ${topSaved.date || "-"}`],
      expected: {
        reach: apiNum(Math.round(Number(topSaved.reach || topSaved.views || 0) * 0.85)),
        saves: apiNum(Math.round(Number(topSaved.saves || 0) * 0.9)),
        shares: apiNum(Math.round(Number(topSaved.shares || 0) * 0.9))
      },
      view: "Content",
      cta: "콘텐츠 보기",
      projectKey: "content"
    });
  }
  const cardnewsProject = activeCardnewsProject(cardnewsStatus);
  if (cardnewsProject) {
    const pngCount = Number(cardnewsProject.outputPngCount || 0);
    items.push({
      level: pngCount ? "opportunity" : "idea",
      icon: pngCount ? "✓" : "i",
      title: `${cardnewsProject.brandName || cardnewsProject.projectName} 카드뉴스 진행 확인`,
      why: pngCount ? "출력 파일이 있어 업로드 또는 검수 단계로 넘길 수 있습니다." : "진행 중인 카드뉴스 프로젝트를 이어서 정리할 수 있습니다.",
      evidence: `${cardnewsProject.projectName || "CARD NEWS"} · ${cardnewsProject.status || "진행 중"} · PNG ${apiNum(pngCount)}개 · ${cardnewsProject.modifiedLabel || "-"}`,
      score: recommendationScore(pngCount ? 82 : 70, pngCount ? Math.min(pngCount, 10) : 0),
      basis: [`상태 ${cardnewsProject.status || "진행 중"}`, `마지막 수정 ${cardnewsProject.modifiedLabel || "-"}`, `출력 PNG ${apiNum(pngCount)}개`],
      expected: { reach: "-", saves: "-", shares: "-" },
      view: "Content",
      cta: "콘텐츠 보기",
      projectKey: "cardnews",
      projectUrl: cardnewsLauncherUrl(cardnewsProject)
    });
  }
  const editorialBrand = editorialBriefBrand(data);
  const avgReach = Math.round(avg((data.posts || []).map((post) => Number(post.reach || post.views || 0))));
  const avgSaves = Math.round(avg((data.posts || []).map((post) => Number(post.saves || 0))));
  const avgShares = Math.round(avg((data.posts || []).map((post) => Number(post.shares || 0))));
  items.push({
    level: "idea",
    icon: "i",
    title: `${editorialBrand} 카드뉴스 제작 추천`,
    why: "브랜드 히스토리와 제품 디테일은 저장/공유를 만들기 좋은 정보형 소재입니다.",
    evidence: topProduct ? `인기상품 ${topProduct.productName} · ${apiNum(topProduct.quantity)}개 판매` : `팔로워 변화 ${apiNum(account.followerDelta)}명 · 콘텐츠 ${apiNum((data.posts || []).length)}개`,
    score: recommendationScore(78, topProduct ? 8 : 0),
    basis: [`추천 브랜드 ${editorialBrand}`, `평균 Reach ${apiNum(avgReach)}`, `최근 콘텐츠 ${(data.posts || []).length}개`],
    expected: { reach: apiNum(Math.round(avgReach * 1.12)), saves: apiNum(Math.round(avgSaves * 1.18)), shares: apiNum(Math.round(avgShares * 1.12)) },
    view: "Editorial AI",
    cta: "전략 보기",
    projectKey: "editorial"
  });
  if (!items.some((item) => item.level === "critical") && !items.some((item) => item.level === "warning")) {
    items.unshift({
      level: "opportunity",
      icon: "✓",
      title: "오늘은 반복 가능한 성과 찾기",
      why: "큰 연결 오류가 없으니 성과가 좋은 콘텐츠와 상품을 반복할 수 있습니다.",
      evidence: topCampaign ? `상위 캠페인 ${topCampaign.campaignName || topCampaign.name || "성과 좋은 캠페인"}` : "운영 데이터 정상 확인",
      score: 74,
      basis: ["연결 오류 없음", topCampaign ? "상위 캠페인 확인" : "운영 데이터 정상", "반복 소재 탐색"],
      expected: { reach: apiNum(avgReach), saves: apiNum(avgSaves), shares: apiNum(avgShares) },
      view: "Overview",
      cta: "홈 보기",
      projectKey: "overview"
    });
  }
  return items
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 4)
    .map((item) => ({
    ...item,
    id: todayBriefId(item)
  }));
}

function activeCardnewsProject(cardnewsStatus = {}) {
  const items = Array.isArray(cardnewsStatus.items) ? cardnewsStatus.items : [];
  return items.find((item) => item.status === "진행 중") || items[0] || null;
}

function cardnewsLauncherUrl(project = {}) {
  const url = new URL("http://127.0.0.1:8789/");
  const projectName = project.projectName || project.brandName || "";
  if (projectName) url.searchParams.set("project", projectName);
  if (project.projectName) url.searchParams.set("projectName", project.projectName);
  if (project.projectPath) url.searchParams.set("projectPath", project.projectPath);
  if (project.folderOpenUrl) url.searchParams.set("folderOpenUrl", project.folderOpenUrl);
  return url.toString();
}

function todayBriefId(item) {
  return String(`${item.view}-${item.title}`)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

function recommendationScore(base, bonus = 0) {
  return Math.max(0, Math.min(100, Math.round(Number(base || 0) + Number(bonus || 0))));
}

function editorialBriefBrand(data) {
  const posts = data.posts || [];
  const rows = editorialBrandRows(posts);
  const candidates = editorialOpportunityBrands(rows);
  return candidates[0] || rows[0]?.brand || "GOOMHEO";
}

function todayStorageKey() {
  return `samplas.todayBriefing.${new Date().toISOString().slice(0, 10)}`;
}

function readTodayBriefingState() {
  try {
    return JSON.parse(localStorage.getItem(todayStorageKey()) || "{}");
  } catch {
    return {};
  }
}

function writeTodayBriefingState(state) {
  localStorage.setItem(todayStorageKey(), JSON.stringify(state || {}));
}

function todayBriefState(item) {
  const state = readTodayBriefingState()[item.id] || {};
  return {
    status: state.status || "todo",
    doneAt: state.doneAt || ""
  };
}

function nextTodayStatus(status) {
  if (status === "todo") return "progress";
  if (status === "progress") return "done";
  return "todo";
}

function todayStatusLabel(status) {
  if (status === "progress") return "진행 중";
  if (status === "done") return "완료됨";
  return "진행 전";
}

function todayStatusIcon(status) {
  if (status === "progress") return "⏳";
  if (status === "done") return "✓";
  return "□";
}

function renderTodayBriefing() {
  const target = $("#todayBriefing");
  if (!target) return;
  target.innerHTML = currentTodayBriefingItems.map((item) => todayBriefCard(item)).join("");
  $("#todayBriefProgress").innerHTML = todayBriefProgressBar(currentTodayBriefingItems);
}

function todayBriefProgressBar(items) {
  const total = items.length || 0;
  const done = items.filter((item) => todayBriefState(item).status === "done").length;
  const percent = total ? Math.round(done / total * 100) : 0;
  return `<div class="today-progress-card">
    <div><span>오늘 업무</span><strong>${done} / ${total} 완료</strong></div>
    <i><b style="width:${percent}%"></b></i>
    <em>${percent}%</em>
  </div>`;
}

// Score (0-100) -> 1~5 stars, so the busiest reader sees priority at a glance
// without reading the numeric Recommendation Score.
function starRating(score) {
  const stars = Math.max(1, Math.min(5, Math.round(Number(score || 0) / 20)));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

function todayBriefCard(item) {
  const state = todayBriefState(item);
  const done = state.status === "done";
  return `<article class="today-brief-card ${esc(item.level)} ${esc(state.status)}" data-brief-id="${esc(item.id)}">
    <div class="today-brief-top">
      <div class="today-brief-head"><span>${done ? "✓" : esc(item.icon)}</span><div class="today-brief-title-row"><strong>${esc(item.title)}</strong><em class="today-brief-stars" title="Recommendation Score ${apiNum(item.score)}/100">${starRating(item.score)}</em></div></div>
      <button class="today-status-button" type="button" data-brief-status="${esc(item.id)}">${todayStatusIcon(state.status)} ${todayStatusLabel(state.status)}</button>
    </div>
    <div class="today-score-row"><span>Recommendation Score</span><strong>${apiNum(item.score)}/100</strong></div>
    <p>${esc(item.why)}</p>
    <small>${esc(item.evidence)}</small>
    <div class="today-brief-basis">
      ${(item.basis || []).slice(0, 3).map((value) => `<span>${esc(value)}</span>`).join("")}
    </div>
    <div class="today-expected">
      <span>예상 Reach <strong>${esc(item.expected?.reach || "-")}</strong></span>
      <span>예상 저장 <strong>${esc(item.expected?.saves || "-")}</strong></span>
      <span>예상 공유 <strong>${esc(item.expected?.shares || "-")}</strong></span>
    </div>
    ${done ? `<time>완료 시간 ${esc(state.doneAt)}</time>` : ""}
    <div class="today-brief-buttons">
      <button class="today-jump-button" type="button" data-jump-view="${esc(item.view)}">${esc(item.cta)}</button>
      <button class="today-project-button" type="button" data-project-key="${esc(item.projectKey || "")}" data-project-url="${esc(item.projectUrl || "")}">프로젝트 열기</button>
    </div>
  </article>`;
}

function readProjectLinks() {
  try {
    return { ...defaultProjectLinks, ...JSON.parse(localStorage.getItem("samplas.projectLinks") || "{}") };
  } catch {
    return { ...defaultProjectLinks };
  }
}

function projectLinkFor(key) {
  return readProjectLinks()[key] || "";
}

function buildOverviewActions({ data, meta, cafe, account, topSaved, roas }) {
  const urgent = [
    cafe.error ? { level: "urgent", category: "Critical", icon: "!", title: "Cafe24 연결 오류", text: "실제 매출을 불러오지 못했습니다." } : null,
    meta.error ? { level: "urgent", category: "Critical", icon: "!", title: "Meta API 오류", text: "광고 성과를 불러오지 못했습니다." } : null,
    data.error ? { level: "urgent", category: "Critical", icon: "!", title: "Instagram 오류", text: "콘텐츠 성과를 불러오지 못했습니다." } : null
  ].filter(Boolean);
  const watch = [
    roas !== null && roas < 1 ? { level: "warn", category: "Warning", icon: "!", title: "ROAS 감소", text: "광고비 대비 구매 신호가 약합니다." } : null,
    Number(account.reachDelta) < 0 ? { level: "warn", category: "Warning", icon: "↓", title: "도달 감소", text: `Reach가 ${pct(Math.abs(Number(account.reachDelta)))} 감소했습니다.` } : null,
    Number(account.websiteClickDelta) < 0 ? { level: "warn", category: "Warning", icon: "↓", title: "클릭 감소", text: `웹사이트 클릭이 ${pct(Math.abs(Number(account.websiteClickDelta)))} 감소했습니다.` } : null
  ].filter(Boolean);
  const good = [
    topSaved ? { level: "good", category: "Opportunity", icon: "★", title: "저장률 높은 릴스", text: `"${topSaved.title || "성과 좋은 콘텐츠"}" 반응이 좋습니다.` } : null,
    Number(account.followerDelta) > 0 ? { level: "good", category: "Opportunity", icon: "+", title: "팔로우 증가", text: `${apiNum(account.followerDelta)}명 증가했습니다.` } : null,
    !urgent.length && !watch.length ? { level: "good", category: "Opportunity", icon: "✓", title: "운영 상태 양호", text: "큰 오류 없이 주요 데이터를 볼 수 있습니다." } : null
  ].filter(Boolean);
  return [...urgent, ...watch, ...good].slice(0, 4);
}

function homeTopMetric(label, value, note, badge) {
  return `<article class="kpi home-kpi">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong><p class="delta">${esc(note)}</p></article>`;
}

function homeMonthCard(label, value, note, badge) {
  return `<article class="home-month-card">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

// Overview "이번 달 KPI" now follows the same 대표/보조 visual language as
// Reports/Content/Advertising/Sales: 3 emphasized primary cards (green accent,
// reused from Advertising's ad-core-kpi-card) + a compact supporting row
// (reused from Reports' report-support-row).
function homeMonthPrimaryCard(label, value, note, badge) {
  return `<article class="action-item ad-summary-card ad-core-kpi-card">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function homeMonthSupportCard(label, value, note, badge) {
  return `<div class="report-support-item">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(note)}</em></div>`;
}

function homeActionCard(item) {
  return `<article class="home-action-card ${esc(item.level)}"><span>${esc(item.icon || "•")}</span><div><em>${esc(item.category || "")}</em><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></div></article>`;
}

function homeGoalCards({ cafeTotals = {}, metaTotals = {}, postCount = 0, followerDelta = 0 } = {}) {
  const items = [
    { label: "매출", value: goalPercent(Number(cafeTotals.orderAmount || 0), 5000000), note: "월 목표 500만원" },
    { label: "광고", value: goalPercent(Number(metaTotals.spend || 0), 1500000), note: "월 예산 150만원" },
    { label: "콘텐츠", value: goalPercent(Number(postCount || 0), 20), note: "월 목표 20개" },
    { label: "팔로워", value: goalPercent(Math.max(0, Number(followerDelta || 0)), 300), note: "월 목표 +300명" }
  ];
  return items.map((item) => `<article class="home-goal-card">
    <div><span>${esc(item.label)}</span><strong>${item.value}%</strong></div>
    <i><b style="width:${item.value}%"></b></i>
    <p>${esc(item.note)}</p>
  </article>`).join("");
}

function goalPercent(value, target) {
  if (!target) return 0;
  const percent = Math.round((Number(value || 0) / target) * 100);
  return Math.max(0, Math.min(100, percent || 0));
}

function homeActivityCards({ status = {}, meta = {}, cafe = {}, data = {} }) {
  const instagramOk = !data.error && status.instagram !== false;
  // 진단용 로그 (2026-07-08). data는 /api/instagram/monthly 응답, status는 /api/status 응답이다.
  // instagramOk가 false인데 data.error가 비어있다면 status.instagram이 원인이고,
  // data.error가 채워져 있다면 loadMonths()가 받아온 시점의 실제 값이 원인이다.
  console.log({ data, status, instagramOk });
  const metaOk = !meta.error && status.metaAds !== false;
  const cafeOk = !cafe.error && status.cafe24 !== false;
  return [
    homeActivityCard("Cafe24 동기화", cafeOk ? "완료" : "확인 필요", cafeOk ? "주문 데이터를 불러왔습니다." : "주문 연결을 확인하세요.", syncStatusText(cafe), cafeOk ? "good" : "warn"),
    homeActivityCard("Meta 광고 업데이트", metaOk ? "완료" : "확인 필요", metaOk ? "광고 데이터를 불러왔습니다." : "광고 연결을 확인하세요.", syncStatusText(meta), metaOk ? "good" : "warn"),
    homeActivityCard("Instagram 캐시 저장", instagramOk ? "완료" : "확인 필요", instagramOk ? "콘텐츠 데이터를 불러왔습니다." : "연결 상태를 확인하세요.", syncStatusText(data), instagramOk ? "good" : "warn"),
    homeActivityCard("월간 보고서", "대기", "Reports에서 월간 정리를 확인할 수 있습니다.", "-", "neutral")
  ].join("");
}

function homeActivityCard(label, value, note, time, level) {
  return `<article class="home-activity-card ${esc(level)}"><div><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></div><time>${esc(time)}</time></article>`;
}

function brandFromProduct(productName = "") {
  const cleaned = String(productName || "").trim();
  if (!cleaned) return "-";
  return cleaned.split(/\s+/)[0] || cleaned;
}

function interaction(post) {
  return Number(post.totalInteractions || 0) || Number(post.likes || 0) + Number(post.comments || 0) + Number(post.saves || 0) + Number(post.shares || 0);
}

function postInteractionValue(post) {
  if (hasApiValue(post.totalInteractions)) return post.totalInteractions;
  const values = [post.likes, post.comments, post.saves, post.shares].filter(hasApiValue);
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
}

function sum(items, key) {
  return (items || []).reduce((total, item) => total + Number(item?.[key] || 0), 0);
}

function avg(values) {
  const usable = (values || []).filter((value) => Number.isFinite(Number(value)));
  return usable.length ? usable.reduce((total, value) => total + Number(value), 0) / usable.length : 0;
}

function rate(value, base) {
  const denominator = Number(base || 0);
  return denominator ? Number(value || 0) / denominator * 100 : 0;
}

function postMetrics(post) {
  const reach = Number(post.reach || 0);
  const views = Number(post.views || 0);
  const clicks = Number(post.websiteClicks || 0);
  const sales = Number(post.cafe24Sales7d || 0);
  const spend = Number(post.adSpend || 0);
  return {
    engagementRate: rate(interaction(post), reach || views),
    saveRate: rate(post.saves, reach || views),
    shareRate: rate(post.shares, reach || views),
    commentRate: rate(post.comments, reach || views),
    likeRate: rate(post.likes, reach || views),
    clickRate: rate(clicks, reach || views),
    sales,
    roas: spend ? sales / spend : 0
  };
}

function purposeScore(post) {
  const m = postMetrics(post);
  const reachScore = Math.min(35, Number(post.reach || 0) / 850);
  const viewScore = Math.min(20, Number(post.views || 0) / 1500);
  const saveScore = Math.min(18, m.saveRate * 4);
  const shareScore = Math.min(12, m.shareRate * 8);
  const clickScore = Math.min(10, m.clickRate * 3);
  const salesScore = Math.min(5, Number(post.cafe24Sales7d || 0) / 200000);
  return reachScore + viewScore + saveScore + shareScore + clickScore + salesScore;
}

function topPosts(posts, selector, count = 5) {
  return [...(posts || [])].sort((left, right) => Number(selector(right) || 0) - Number(selector(left) || 0)).slice(0, count);
}

function summarizeByType(posts) {
  const groups = new Map();
  for (const post of posts || []) {
    const type = post.type || "기타";
    const group = groups.get(type) || [];
    group.push(post);
    groups.set(type, group);
  }
  return [...groups.entries()].map(([type, group]) => ({
    type,
    count: group.length,
    reach: sum(group, "reach"),
    saves: sum(group, "saves"),
    shares: sum(group, "shares"),
    avgSaveRate: avg(group.map((post) => postMetrics(post).saveRate))
  })).sort((left, right) => right.count - left.count);
}

function explainPost(post) {
  const m = postMetrics(post);
  if (post.type === "카드뉴스") return `저장 ${num(post.saves)} / 공유 ${num(post.shares)} / 저장률 ${pct(m.saveRate)}. 카드뉴스는 저장과 공유를 핵심으로 봅니다.`;
  if (post.type === "릴스") return `도달 ${num(post.reach)} / 조회 ${num(post.views)} / 참여율 ${pct(m.engagementRate)}. 릴스는 신규 유입과 조회 효율을 봅니다.`;
  if (Number(post.websiteClicks || 0)) return `웹사이트 클릭 ${num(post.websiteClicks)} / 클릭률 ${pct(m.clickRate)}. 구매 유입 후보 콘텐츠입니다.`;
  return `좋아요 ${num(post.likes)}, 댓글 ${num(post.comments)}, 저장 ${num(post.saves)}, 공유 ${num(post.shares)}를 함께 봅니다.`;
}

function renderInsights(data) {
  const posts = data.posts || [];
  const a = data.account || {};
  const topReach = topPosts(posts, (post) => post.reach, 1)[0];
  const topSave = topPosts(posts, (post) => post.saves, 1)[0];
  const cardAvgSave = avg(posts.filter((post) => post.type === "카드뉴스").map((post) => postMetrics(post).saveRate));
  const notes = [
    `${data.month} 기준 도달 ${num(a.reach)}회, 조회 ${num(a.views)}회입니다.`,
    `프로필 방문 ${num(a.profileVisits)}회, 웹사이트 클릭 ${num(a.websiteClicks)}회입니다.`,
    topReach ? `도달 1위는 "${esc(topReach.title)}"입니다. 도달 ${num(topReach.reach)}회입니다.` : "게시물별 데이터가 없는 월입니다.",
    topSave ? `저장 1위는 "${esc(topSave.title)}"입니다. 저장 ${num(topSave.saves)}회, 카드뉴스 평균 저장률 ${pct(cardAvgSave)}입니다.` : "저장/공유 분석은 게시물 데이터가 필요합니다."
  ];
  $("#insightList").innerHTML = notes.map((note) => `<div class="insight">${note}</div>`).join("");
}

function renderPurposeRadar(posts) {
  const target = $("#purposeRadar");
  if (!target) return;
  const groups = new Map();
  for (const post of posts || []) {
    const key = post.tag || post.type || "기타";
    const current = groups.get(key) || { label: key, score: 0 };
    current.score += Math.round(Number(post.reach || 0) / 100 + interaction(post));
    groups.set(key, current);
  }
  const rows = [...groups.values()].sort((a, b) => b.score - a.score).slice(0, 7);
  const max = Math.max(1, ...rows.map((row) => row.score));
  target.innerHTML = rows.length ? rows.map((row) => (
    `<div class="bar-row"><span>${esc(row.label)}</span><div class="bar"><i style="width:${Math.max(6, row.score / max * 100)}%"></i></div><em>${num(row.score)}</em></div>`
  )).join("") : `<div class="insight">게시물별 데이터가 없습니다.</div>`;
}

function renderContentTable(posts) {
  renderContentPerformanceCenter(posts || [], selectedMonth());
  const legacyRows = $("#contentRows");
  if (!legacyRows) return;
  legacyRows.innerHTML = (posts || []).slice(0, 80).map((post) => {
    const metrics = postMetrics(post);
    return `<tr>
      <td>${esc(post.date || "-")}</td>
      <td><strong>${esc(post.title || "-")}</strong><br>${esc(post.tag || "-")}</td>
      <td>${esc(post.type || "-")}</td>
      <td>${apiNum(post.reach)}</td>
      <td>${apiNum(post.views)}</td>
      <td>${apiNum(post.likes)}</td>
      <td>${apiNum(post.comments)}</td>
      <td>${apiNum(post.saves)}</td>
      <td>${apiNum(post.shares)}</td>
      <td>${pct(metrics.engagementRate)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="10">게시물별 데이터가 없습니다.</td></tr>`;
}

function renderContentPerformanceCenter(posts, data = {}) {
  const account = data.account || {};
  const targetKpis = $("#contentKpiGrid");
  if (!targetKpis) return;
  const totalReach = sum(posts, "reach");
  const totalLikes = sum(posts, "likes");
  const totalShares = sum(posts, "shares");
  const avgSaveRate = posts.length ? avg(posts.map((post) => postMetrics(post).saveRate)) : null;
  // Information-density pass: 저장률/Reach stay as the two highlighted
  // numbers a director actually judges content by; 게시물 수/Likes/Shares/
  // 팔로우 증가 move into one compact secondary row instead of 6 equal-weight
  // 128px cards. Same underlying data as before (postMetrics/sum), no new
  // calculation source.
  targetKpis.innerHTML = `
    <article class="content-kpi-highlight">
      <span>저장률</span>
      <strong>${avgSaveRate === null ? "데이터 없음" : pct(avgSaveRate)}</strong>
      <p>이번 달 평균 저장률</p>
    </article>
    <article class="content-kpi-highlight">
      <span>Reach</span>
      <strong>${apiNum(totalReach)}</strong>
      <p>게시물 합산 도달</p>
    </article>
    <div class="content-kpi-row">
      ${contentKpiRowItem("게시물 수", `${apiNum(posts.length)}개`)}
      ${contentKpiRowItem("Likes", apiNum(totalLikes))}
      ${contentKpiRowItem("Shares", apiNum(totalShares))}
      ${contentKpiRowItem("팔로우 증가", hasApiValue(account.followerDelta) ? `${apiNum(account.followerDelta)}명` : "-")}
    </div>
  `;

  $("#contentTopGrid").innerHTML = [
    contentRankingCard("조회수 TOP 5", topPosts(posts, (post) => post.views || post.reach, 5), (post) => `조회 ${apiNum(post.views)} · Reach ${apiNum(post.reach)}`),
    contentRankingCard("저장률 TOP 5", topPosts(posts, (post) => postMetrics(post).saveRate, 5), (post) => `저장률 ${pct(postMetrics(post).saveRate)} · 저장 ${apiNum(post.saves)}`),
    contentRankingCard("공유 TOP 5", topPosts(posts, (post) => post.shares, 5), (post) => `공유 ${apiNum(post.shares)} · 공유율 ${pct(postMetrics(post).shareRate)}`),
    contentRankingCard("팔로우 전환 TOP 5", topPosts(posts, (post) => post.follows || post.profileVisits || post.websiteClicks || postMetrics(post).engagementRate, 5), (post) => `프로필 ${apiNum(post.profileVisits)} · 클릭 ${apiNum(post.websiteClicks)}`)
  ].join("");

  $("#contentTypeGrid").innerHTML = contentTypeCards(posts);
  $("#contentHeatmap").innerHTML = contentHeatmapCards(posts);
  $("#contentBrandGrid").innerHTML = contentBrandCards(posts);
  $("#contentAiGrid").innerHTML = contentRecommendationCards(posts);
}

function contentKpiCard(label, value, note) {
  return `<article class="content-kpi-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function contentKpiRowItem(label, value) {
  return `<div class="content-kpi-row-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function contentRankingCard(title, rows, helper) {
  return `<article class="content-rank-card">
    <h4>${esc(title)}</h4>
    ${rows.length ? `<ol>${rows.map((post, index) => `<li>
      <mark>${index + 1}</mark>
      <div><strong title="${esc(post.title || "-")}">${esc(post.title || "-")}</strong><p>${esc(helper(post))}</p></div>
    </li>`).join("")}</ol>` : contentEmpty("콘텐츠 데이터가 없습니다.")}
  </article>`;
}

function contentTypeCards(posts) {
  const summary = summarizeByType(posts);
  const total = Math.max(1, posts.length);
  const expected = ["릴스", "카드뉴스", "사진"];
  const rows = expected.map((type) => summary.find((item) => item.type === type) || { type, count: 0, reach: 0, avgSaveRate: 0, shares: 0 });
  return rows.map((item) => {
    const share = Math.round(Number(item.count || 0) / total * 100);
    return `<article class="content-type-card">
      <div><span>${esc(item.type)}</span><strong>${share}%</strong></div>
      <i><b style="width:${Math.max(4, share)}%"></b></i>
      <p>${apiNum(item.count)}개 · Reach ${apiNum(item.reach)} · 저장률 ${pct(item.avgSaveRate)}</p>
    </article>`;
  }).join("");
}

function contentHeatmapCards(posts) {
  const dayRows = contentTimeGroups(posts, "day");
  const hourRows = contentTimeGroups(posts, "hour");
  return [
    contentHeatmapGroup("요일별 성과", dayRows),
    contentHeatmapGroup("시간대별 성과", hourRows)
  ].join("");
}

function contentTimeGroups(posts, mode) {
  const labels = mode === "day" ? ["월", "화", "수", "목", "금", "토", "일"] : ["오전", "점심", "오후", "저녁"];
  const groups = new Map(labels.map((label) => [label, []]));
  for (const post of posts) {
    const key = mode === "day" ? contentDayLabel(post.date) : contentHourLabel(post.date || post.createdAt || post.timestamp);
    groups.set(key, [...(groups.get(key) || []), post]);
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    count: group.length,
    score: Math.round(avg(group.map((post) => Number(post.reach || 0) + interaction(post) * 10)))
  }));
}

function contentDayLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "월";
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}

function contentHourLabel(value) {
  const date = new Date(value || "");
  const hour = Number.isNaN(date.getTime()) ? 12 : date.getHours();
  if (hour < 11) return "오전";
  if (hour < 14) return "점심";
  if (hour < 18) return "오후";
  return "저녁";
}

function contentHeatmapGroup(title, rows) {
  const max = Math.max(1, ...rows.map((row) => row.score));
  return `<article class="content-heat-card"><h4>${esc(title)}</h4><div>
    ${rows.map((row) => `<span style="opacity:${Math.max(0.28, row.score / max)}"><b>${esc(row.label)}</b><em>${apiNum(row.count)}개</em></span>`).join("")}
  </div></article>`;
}

function contentBrandCards(posts) {
  const groups = new Map();
  for (const post of posts) {
    const brand = post.brand || post.tag || brandFromProduct(post.title || "") || "기타";
    const group = groups.get(brand) || [];
    group.push(post);
    groups.set(brand, group);
  }
  const rows = [...groups.entries()].map(([brand, group]) => ({
    brand,
    count: group.length,
    reach: avg(group.map((post) => Number(post.reach || 0))),
    saveRate: avg(group.map((post) => postMetrics(post).saveRate)),
    shares: avg(group.map((post) => Number(post.shares || 0)))
  })).sort((left, right) => right.reach - left.reach).slice(0, 8);
  return rows.length ? rows.map((row) => `<article class="content-brand-card">
    <strong>${esc(row.brand)}</strong>
    <span>${apiNum(row.count)} posts</span>
    <p>평균 Reach ${apiNum(Math.round(row.reach))}</p>
    <p>평균 저장률 ${pct(row.saveRate)} · 평균 공유 ${apiNum(Math.round(row.shares))}</p>
  </article>`).join("") : contentEmpty("브랜드별 성과 데이터가 없습니다.");
}

function contentRecommendationCards(posts) {
  const best = topPosts(posts, purposeScore, 1)[0];
  const saved = topPosts(posts, (post) => postMetrics(post).saveRate, 1)[0];
  const brand = saved ? (saved.brand || saved.tag || brandFromProduct(saved.title || "")) : "";
  return [
    contentAiCard("가장 성과가 좋았던 콘텐츠", best ? best.title || "Untitled" : "데이터 없음", best ? explainPost(best) : "콘텐츠 데이터가 쌓이면 표시됩니다."),
    contentAiCard("저장률이 높은 이유", saved ? saved.title || "Untitled" : "데이터 없음", saved ? "저장률이 높은 콘텐츠는 다시 볼 이유가 명확한 정보형 구성이 많습니다." : "저장률 판단 데이터가 없습니다."),
    contentAiCard("다음 콘텐츠 추천", saved ? `${saved.type || "콘텐츠"} 포맷 반복` : "릴스/카드뉴스 테스트", saved ? "성과가 나온 포맷을 같은 브랜드 또는 유사 상품으로 반복하세요." : "이번 주에는 릴스와 카드뉴스를 각각 1개씩 테스트하세요."),
    contentAiCard("비슷한 브랜드 추천", brand || "데이터 없음", brand ? `${brand}와 비슷한 톤의 브랜드 콘텐츠를 추가로 기획하세요.` : "브랜드 태그가 쌓이면 추천이 더 정확해집니다.")
  ].join("");
}

function contentAiCard(title, value, note) {
  return `<article class="content-ai-card"><span>${esc(title)}</span><strong title="${esc(value)}">${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function contentEmpty(message) {
  return `<div class="content-empty">${esc(message)}</div>`;
}

function renderEditorialAi(data) {
  const posts = data.posts || [];
  const account = data.account || {};
  const brandRows = editorialBrandRows(posts);
  const topSaved = topPosts(posts, (post) => postMetrics(post).saveRate, 1)[0];
  const topShared = topPosts(posts, (post) => post.shares, 1)[0];
  const topViewed = topPosts(posts, (post) => post.views || post.reach, 1)[0];
  const avgScore = avg(posts.map(purposeScore));
  const highPosts = posts.filter((post) => purposeScore(post) > avgScore);
  const best = topPosts(posts, purposeScore, 1)[0];
  const bestType = editorialBestType(posts);
  const bestBrand = brandRows[0];
  const bestDay = editorialBestTime(posts, "day");
  const bestHour = editorialBestTime(posts, "hour");
  const avgSaveRate = avg(posts.map((post) => postMetrics(post).saveRate));
  const titleLength = Math.round(avg(posts.map((post) => String(post.title || "").length)));
  const recommendedBrands = editorialOpportunityBrands(brandRows);
  const discoverRows = editorialDiscoverRows({ posts, brandRows, bestType, bestDay, bestHour });

  $("#editorialInsightGrid").innerHTML = [
    editorialInsightCard("저장률 최고", topSaved?.title || "데이터 없음", topSaved ? `저장률 ${pct(postMetrics(topSaved).saveRate)} · 저장 ${apiNum(topSaved.saves)}` : "콘텐츠 데이터가 필요합니다."),
    editorialInsightCard("공유 최고", topShared?.title || "데이터 없음", topShared ? `공유 ${apiNum(topShared.shares)} · 공유율 ${pct(postMetrics(topShared).shareRate)}` : "공유 데이터가 필요합니다."),
    editorialInsightCard("조회수 TOP", topViewed?.title || "데이터 없음", topViewed ? `조회 ${apiNum(topViewed.views)} · Reach ${apiNum(topViewed.reach)}` : "조회 데이터가 필요합니다."),
    editorialInsightCard("평균 이상 게시물", posts.length ? `${apiNum(highPosts.length)}개` : "데이터 없음", posts.length ? `전체 ${apiNum(posts.length)}개 중 성과 평균 이상` : "게시물 데이터가 필요합니다.")
  ].join("");

  $("#editorialWhyGrid").innerHTML = [
    editorialWhyCard("카드뉴스 비중", editorialTypeShare(posts, "카드뉴스"), "저장형 콘텐츠 비중"),
    editorialWhyCard("릴스 비중", editorialTypeShare(posts, "릴스"), "조회와 신규 도달 비중"),
    editorialWhyCard("브랜드", bestBrand?.brand || "데이터 없음", bestBrand ? `평균 Reach ${apiNum(Math.round(bestBrand.reach))}` : "브랜드 태그가 필요합니다."),
    editorialWhyCard("업로드 요일", bestDay.label, `평균 성과 ${apiNum(bestDay.score)}`),
    editorialWhyCard("업로드 시간", bestHour.label, `평균 성과 ${apiNum(bestHour.score)}`),
    editorialWhyCard("제목 길이", titleLength ? `${apiNum(titleLength)}자` : "데이터 없음", "콘텐츠 제목 평균"),
    editorialWhyCard("평균 저장률", posts.length ? pct(avgSaveRate) : "데이터 없음", "이번 달 콘텐츠 평균")
  ].join("");

  $("#editorialRecommendGrid").innerHTML = [
    editorialRecommendCard("다음 카드뉴스 추천", best ? `${bestBrand?.brand || brandFromProduct(best.title || "")} 디테일 분석` : "브랜드 히스토리 카드뉴스", best ? "성과가 좋았던 브랜드를 정보형 카드뉴스로 반복하세요." : "데이터가 적을 때는 저장 가능한 정보형 콘텐츠부터 시작하세요."),
    editorialRecommendCard("추천 브랜드", recommendedBrands[0] || bestBrand?.brand || "GOOMHEO", "최근 성과와 기회 브랜드를 함께 반영했습니다."),
    editorialRecommendCard("추천 업로드 시간", bestHour.label, "현재 월 게시 시간대 성과 기준입니다."),
    editorialRecommendCard("추천 요일", bestDay.label, "현재 월 요일별 평균 성과 기준입니다."),
    editorialRecommendCard("추천 콘텐츠 형식", bestType.type || "카드뉴스", bestType.note || "저장률과 공유율을 높이기 좋은 포맷입니다."),
    editorialRecommendCard("추천 이유", best ? explainPost(best) : "저장/공유가 쌓이는 콘텐츠가 구매 전환 전에 브랜드 관심을 만듭니다.", "현재 콘텐츠 지표 기반 자동 제안")
  ].join("");

  $("#editorialBrandGrid").innerHTML = brandRows.length ? brandRows.slice(0, 8).map((row) => `<article class="editorial-brand-card">
    <strong>${esc(row.brand)}</strong>
    <span>${apiNum(row.count)} posts</span>
    <p>평균 Reach ${apiNum(Math.round(row.reach))}</p>
    <p>Saves ${apiNum(Math.round(row.saves))} · Shares ${apiNum(Math.round(row.shares))}</p>
    <p>저장률 ${pct(row.saveRate)}</p>
  </article>`).join("") : editorialEmpty("브랜드별 분석 데이터가 없습니다.");

  $("#editorialOpportunityGrid").innerHTML = recommendedBrands.map((brand) => `<article class="editorial-opportunity-card">
    <span>Opportunity</span>
    <strong>${esc(brand)}</strong>
    <p>아직 많이 다루지 않았지만 다음 달 테스트 후보로 적합합니다.</p>
  </article>`).join("");

  $("#editorialDiscoverRadar").innerHTML = discoverRows.map((row) => editorialDiscoverCard(row)).join("");

  $("#editorialContentStrategy").innerHTML = `<ol>
    ${editorialStrategyLines({ posts, bestType, bestBrand, bestDay, bestHour, best, discoverRows, avgSaveRate }).map((line) => `<li>${esc(line)}</li>`).join("")}
  </ol>`;

  $("#editorialSummary").innerHTML = `<ol>
    ${editorialSummaryLines({ posts, bestType, bestBrand, bestDay, bestHour, best, recommendedBrands, account }).map((line) => `<li>${esc(line)}</li>`).join("")}
  </ol>`;
}

function editorialBrandRows(posts) {
  const groups = new Map();
  for (const post of posts || []) {
    const brand = post.brand || post.tag || brandFromProduct(post.title || "") || "기타";
    const group = groups.get(brand) || [];
    group.push(post);
    groups.set(brand, group);
  }
  return [...groups.entries()].map(([brand, group]) => ({
    brand,
    count: group.length,
    reach: avg(group.map((post) => Number(post.reach || 0))),
    saves: avg(group.map((post) => Number(post.saves || 0))),
    shares: avg(group.map((post) => Number(post.shares || 0))),
    saveRate: avg(group.map((post) => postMetrics(post).saveRate)),
    score: avg(group.map(purposeScore))
  })).sort((left, right) => right.score - left.score);
}

function editorialBestType(posts) {
  const rows = summarizeByType(posts || []);
  const best = [...rows].sort((left, right) => Number(right.avgSaveRate || 0) - Number(left.avgSaveRate || 0))[0];
  return best ? { type: best.type, note: `저장률 ${pct(best.avgSaveRate)} · ${apiNum(best.count)}개 게시` } : { type: "", note: "" };
}

function editorialTypeShare(posts, type) {
  const total = Math.max(1, (posts || []).length);
  const count = (posts || []).filter((post) => post.type === type).length;
  return `${Math.round(count / total * 100)}%`;
}

function editorialBestTime(posts, mode) {
  const rows = contentTimeGroups(posts || [], mode).sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  return rows[0] || { label: "데이터 없음", score: 0 };
}

function editorialOpportunityBrands(brandRows) {
  const candidates = ["GOOMHEO", "AE SYNCTX", "RAVE", "MEANTIME"];
  const existing = new Set((brandRows || []).map((row) => String(row.brand || "").toUpperCase()));
  const underused = candidates.filter((brand) => !existing.has(brand));
  return [...underused, ...(brandRows || []).slice(0, 2).map((row) => row.brand)].slice(0, 4);
}

function editorialDiscoverRows({ posts = [], brandRows = [], bestType = {}, bestDay = {}, bestHour = {} }) {
  const candidates = ["GOOMHEO", "AE SYNCTX", "RAVE", "MEANTIME"];
  const existingMap = new Map((brandRows || []).map((row) => [String(row.brand || "").toUpperCase(), row]));
  const bestPost = topPosts(posts, purposeScore, 1)[0];
  const reachBase = Math.max(1200, Math.round(avg(posts.map((post) => Number(post.reach || post.views || 0))) || 0));
  const saveBase = Math.max(0.8, avg(posts.map((post) => postMetrics(post).saveRate)) || 0);
  return candidates.map((brand, index) => {
    const existing = existingMap.get(brand);
    const score = existing ? Math.min(5, 3 + Math.round(existing.score / 30)) : Math.max(3, 5 - index % 3);
    const estimatedReach = existing ? Math.round(existing.reach * 1.12) : Math.round(reachBase * (1.18 - index * 0.05));
    const estimatedSaveRate = existing ? existing.saveRate * 1.08 : saveBase + (0.6 - index * 0.08);
    return {
      brand,
      score,
      reason: existing ? "이미 반응이 검증된 브랜드라 확장 가치가 있습니다." : "아직 노출이 적어 신규 테스트 여지가 큽니다.",
      format: bestType.type || (index % 2 ? "릴스" : "카드뉴스"),
      estimatedReach,
      estimatedSaveRate,
      similar: bestPost?.title || brandRows[0]?.brand || "상위 성과 콘텐츠",
      day: bestDay.label || "금",
      hour: bestHour.label || "저녁"
    };
  }).sort((left, right) => right.score - left.score);
}

function editorialDiscoverCard(row) {
  return `<article class="editorial-discover-card">
    <div class="editorial-discover-head">
      <div><span>Brand</span><strong>${esc(row.brand)}</strong></div>
      <em>${"★".repeat(row.score)}${"☆".repeat(Math.max(0, 5 - row.score))}</em>
    </div>
    <p>${esc(row.reason)}</p>
    <dl>
      <div><dt>추천 형식</dt><dd>${esc(row.format)}</dd></div>
      <div><dt>예상 Reach</dt><dd>${apiNum(row.estimatedReach)}</dd></div>
      <div><dt>예상 저장률</dt><dd>${pct(row.estimatedSaveRate)}</dd></div>
      <div><dt>성공 사례</dt><dd title="${esc(row.similar)}">${esc(row.similar)}</dd></div>
      <div><dt>요일</dt><dd>${esc(row.day)}</dd></div>
      <div><dt>시간</dt><dd>${esc(row.hour)}</dd></div>
    </dl>
  </article>`;
}

function editorialStrategyLines({ posts, bestType, bestBrand, bestDay, bestHour, best, discoverRows, avgSaveRate }) {
  if (!posts.length) {
    return [
      "이번 달 콘텐츠 데이터가 아직 부족해 명확한 승리 패턴을 판단하기 어렵습니다.",
      "다음 달에는 릴스와 카드뉴스를 각각 최소 2개 이상 업로드해 비교 기준을 만들어야 합니다.",
      "브랜드 히스토리, 소재 디테일, 스타일링 제안처럼 저장할 이유가 있는 콘텐츠를 우선 추천합니다.",
      "GOOMHEO, AE SYNCTX, RAVE, MEANTIME은 Discover Radar 테스트 후보로 유지합니다.",
      "게시 후 Reach보다 Saves와 Shares를 함께 보면서 다음 콘텐츠 방향을 조정하세요."
    ];
  }
  const radar = discoverRows[0];
  return [
    `이번 달에는 ${bestType.type || "상위 포맷"} 콘텐츠가 저장률 ${bestType.note ? bestType.note.replace(/^저장률 /, "").split(" · ")[0] : pct(avgSaveRate)} 기준으로 가장 좋은 신호를 보였습니다.`,
    `${bestBrand?.brand || "상위 브랜드"} 관련 콘텐츠가 평균 Reach와 저장 반응에서 가장 강했습니다.`,
    best ? `"${best.title || "대표 콘텐츠"}"는 다음 달 콘텐츠 구조를 잡을 때 참고할 성공 사례입니다.` : "대표 콘텐츠는 추가 데이터가 쌓이면 더 명확하게 선정할 수 있습니다.",
    `${bestDay.label}요일과 ${bestHour.label} 업로드가 현재 데이터에서 가장 좋은 반응을 보였습니다.`,
    `다음 달에는 ${radar?.brand || "RAVE"}와 ${discoverRows[1]?.brand || "AE SYNCTX"}를 중심으로 브랜드 히스토리와 제품 디테일 콘텐츠를 추천합니다.`,
    `추천 형식은 ${radar?.format || bestType.type || "카드뉴스"}이며, 저장 가능한 정보형 구성을 우선 적용하는 것이 좋습니다.`,
    "릴스는 신규 도달, 카드뉴스는 저장과 공유를 담당하도록 역할을 분리해서 운영하세요."
  ];
}

function editorialSummaryLines({ posts, bestType, bestBrand, bestDay, bestHour, best, recommendedBrands, account }) {
  if (!posts.length) {
    return [
      "이번 달 콘텐츠 데이터가 아직 충분하지 않습니다.",
      "먼저 릴스와 카드뉴스를 균형 있게 업로드해 비교 기준을 만드는 것이 좋습니다.",
      "브랜드 태그와 게시 시간 데이터가 쌓이면 추천 정확도가 올라갑니다.",
      "다음 달에는 브랜드 히스토리와 제품 디테일 콘텐츠를 우선 테스트하세요.",
      "Cafe24 매출 분석과 함께 보면 콘텐츠의 판매 기여도를 더 명확히 볼 수 있습니다."
    ];
  }
  return [
    `이번 달에는 ${bestType.type || "성과 좋은 포맷"} 콘텐츠가 저장률 측면에서 가장 좋은 신호를 보였습니다.`,
    `${bestBrand?.brand || "상위 브랜드"} 관련 게시물이 가장 높은 평균 성과를 기록했습니다.`,
    `${bestHour.label} 업로드와 ${bestDay.label}요일 콘텐츠가 상대적으로 좋은 반응을 얻었습니다.`,
    best ? `"${best.title || "대표 콘텐츠"}"는 다음 콘텐츠 기획의 기준으로 삼을 만합니다.` : "대표 콘텐츠를 추가로 확인할 필요가 있습니다.",
    `다음 달에는 ${recommendedBrands[0] || "GOOMHEO"} 중심의 브랜드 히스토리/디테일 콘텐츠를 추천합니다. 팔로워 변화는 ${apiNum(account.followerDelta)}명입니다.`
  ];
}

function editorialInsightCard(title, value, note) {
  return `<article class="editorial-card"><span>${esc(title)}</span><strong title="${esc(value)}">${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function editorialWhyCard(title, value, note) {
  return `<article class="editorial-why-card"><span>${esc(title)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function editorialRecommendCard(title, value, note) {
  return `<article class="editorial-recommend-card"><span>${esc(title)}</span><strong title="${esc(value)}">${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function editorialEmpty(message) {
  return `<div class="content-empty">${esc(message)}</div>`;
}

function metricCard(post) {
  const metrics = postMetrics(post);
  return `<article class="report-panel">
    <h4>${esc(post.title || "Untitled")}</h4>
    <p>${esc(post.date || "-")} · ${esc(post.tag || post.type || "-")}</p>
    <div class="report-metrics">
      <span>Reach <strong>${apiNum(post.reach)}</strong></span>
      <span>Views <strong>${apiNum(post.views)}</strong></span>
      <span>Likes <strong>${apiNum(post.likes)}</strong></span>
      <span>Comments <strong>${apiNum(post.comments)}</strong></span>
      <span>Saves <strong>${apiNum(post.saves)}</strong></span>
      <span>Shares <strong>${apiNum(post.shares)}</strong></span>
      <span>Engagement Rate <strong>${pct(metrics.engagementRate)}</strong></span>
    </div>
    ${post.unavailableReason ? `<p class="delta">API 오류: ${esc(post.unavailableReason)}</p>` : ""}
  </article>`;
}

function feedStat(label, value) {
  return `<div class="feed-stat"><span>${label}</span><strong>${value}</strong></div>`;
}

// 2026-07-08 Reports 썸네일 실제 이미지 교체: 서버 normalizePost()가 media_type별
// 규칙(IMAGE→media_url, CAROUSEL_ALBUM→children 첫 장, VIDEO/REELS→thumbnail_url
// 우선)으로 계산한 coverImageUrl을 최우선으로 쓰고, coverImageUrl이 아직 없는(=이
// 필드가 추가되기 전에 저장된 과거 캐시) 게시물은 기존 thumbnailUrl/mediaUrl로
// 폴백한다. 이미지가 전혀 없으면 기존 Gradient Placeholder(.feed-media의 CSS
// background)가 그대로 보인다.
function feedCoverImageUrl(post) {
  return post.coverImageUrl || post.thumbnailUrl || post.mediaUrl || "";
}

function feedCard(post, options = {}) {
  const m = postMetrics(post);
  const imageUrl = feedCoverImageUrl(post);
  const permalink = post.permalink || "";
  const stats = [
    ["Reach", apiNum(post.reach)],
    ["Views", apiNum(post.views)],
    ["Likes", apiNum(post.likes)],
    ["Comments", apiNum(post.comments)],
    ["Saves", apiNum(post.saves)],
    ["Shares", apiNum(post.shares)]
  ];
  // 이미지 <img>는 CSS background가 아니라 실제 <img> 엘리먼트로 렌더링하고
  // object-fit: cover로 채운다. loading="lazy"로 지연 로딩하고, 로드 실패 시
  // onerror가 자신을 제거해 .feed-media의 has-image 클래스만 해제하면 기존
  // Gradient Placeholder(CSS background)가 자동으로 다시 보인다.
  const imgHtml = imageUrl
    ? `<img class="feed-media-img" src="${esc(imageUrl)}" alt="${esc(post.title || "Instagram 게시물")}" loading="lazy" onerror="this.closest('.feed-media')?.classList.remove('has-image');this.remove();">`
    : "";
  return `<article class="feed-card">
    <a class="feed-media${imageUrl ? " has-image" : ""}" href="${esc(permalink || "#")}" target="_blank" rel="noreferrer">
      ${imgHtml}
      <span class="feed-type">${esc(post.type || "POST")}</span>
      <strong>${esc(post.title || "Untitled")}</strong>
      ${permalink ? `<span class="feed-media-hover">▶ Instagram 보기</span>` : ""}
    </a>
    <div class="feed-body">
      <div class="chip-row">
        <span class="chip">${esc(post.tag || "Untitled")}</span>
        <span class="chip">${esc(post.date || "-")}</span>
      </div>
      <p class="feed-caption">${esc(post.caption || "캡션 없음")}</p>
      ${post.unavailableReason ? `<p class="delta">API 오류: ${esc(post.unavailableReason)}</p>` : ""}
      <div class="feed-stats">${stats.map(([label, value]) => feedStat(label, value)).join("")}</div>
      <div class="chip-row">
        <span class="chip">Engagement Rate ${pct(m.engagementRate)}</span>
        <span class="chip">저장률 ${pct(m.saveRate)}</span>
      </div>
    </div>
  </article>`;
}

function renderCards(id, posts, mode = "metric") {
  const target = $(`#${id}`);
  if (!target) return;
  if (mode === "feed" || mode === "cardnews") {
    target.classList.add("instagram-feed");
    target.classList.remove("cards");
    target.innerHTML = posts.length ? posts.map((post) => feedCard(post)).join("") : `<article class="feed-card"><div class="feed-body"><h4>데이터 없음</h4><p class="feed-caption">해당 월에 표시할 콘텐츠가 없습니다.</p></div></article>`;
    return;
  }
  target.classList.add("cards");
  target.classList.remove("instagram-feed");
  target.innerHTML = posts.length ? posts.map(metricCard).join("") : `<div class="action-item">해당 콘텐츠 데이터가 없습니다.</div>`;
}

function renderMonthlyDashboard(data) {
  const a = data.account || {};
  const posts = data.posts || [];
  const topByScore = topPosts(posts, purposeScore, 5);
  const topSaved = topPosts(posts, (post) => post.saves, 4);
  const topShared = topPosts(posts, (post) => post.shares, 4);
  const topReach = topPosts(posts, (post) => post.reach, 4);
  const typeSummary = summarizeByType(posts);
  const totalSaves = sum(posts, "saves");
  const totalShares = sum(posts, "shares");
  const totalLikes = sum(posts, "likes");
  const totalComments = sum(posts, "comments");
  const totalClicks = sum(posts, "websiteClicks") || Number(a.websiteClicks || 0);
  const totalSales = sum(posts, "cafe24Sales7d");
  const totalSpend = sum(posts, "adSpend");
  const topContent = topByScore[0];
  $("#monthlyDashboard").innerHTML = `
    <div class="executive-summary">
      <section class="executive-hero">
        <p class="eyebrow">${esc(sourceText(data))}</p>
        <h4>${esc(data.month)} SAMPLAS MONTHLY REPORT</h4>
        <strong>${topContent ? esc(topContent.title) : "게시물 데이터 없음"}</strong>
        <span>${topContent ? `이번 달 대표 콘텐츠 · ${esc(topContent.tag || topContent.type)} · 점수 ${Math.round(purposeScore(topContent))}` : "월간 KPI 중심으로 표시합니다."}</span>
      </section>
      <section class="executive-kpis">
        <p class="report-tier-label">Business</p>
        <div class="executive-kpis-grid">
          ${miniMetric("도달", num(a.reach), `${pct(a.reachDelta)} 전월 대비`)}
          ${miniMetric("웹사이트 클릭", num(totalClicks), "구매 유입 후보")}
          ${miniMetric(totalSales ? "Cafe24 7일 매출" : "Meta 광고비", totalSales ? krw(totalSales) : krw(totalSpend), totalSales ? "실제 주문 기준" : "광고 캐시 기준")}
          ${miniMetric("팔로워 증가", `+${num(a.followerDelta)}`, `현재 ${num(a.followers)}명`)}
        </div>
      </section>
    </div>

    <p class="report-tier-label report-support-label">Content · Supporting KPI</p>
    <div class="report-support-row">
      ${supportMetric("콘텐츠 수", num(posts.length), "이번 달 분석 대상")}
      ${supportMetric("좋아요", num(totalLikes), "반응 신호")}
      ${supportMetric("댓글", num(totalComments), "대화 신호")}
      ${supportMetric("저장 / 공유", `${num(totalSaves)} / ${num(totalShares)}`, "카드뉴스 핵심")}
    </div>

    <p class="report-tier-label">Analysis</p>
    <div class="report-lanes executive-lanes">
      ${reportLane("종합 TOP", topByScore, (post) => `${post.tag || post.type} · 점수 ${Math.round(purposeScore(post))}`)}
      ${reportLane("저장 TOP", topSaved, (post) => `저장 ${num(post.saves)} · 저장률 ${pct(postMetrics(post).saveRate)}`)}
      ${reportLane("공유 TOP", topShared, (post) => `공유 ${num(post.shares)} · 공유율 ${pct(postMetrics(post).shareRate)}`)}
      ${reportLane("도달 TOP", topReach, (post) => `도달 ${num(post.reach)} · 조회 ${num(post.views)}`)}
    </div>

    <section class="report-panel format-panel">
      <div class="feed-toolbar">
        <div>
          <p class="eyebrow">Format Mix</p>
          <h4>콘텐츠 유형별 성과 비교</h4>
        </div>
        <span class="badge">저장률 / 도달 / 콘텐츠 수</span>
      </div>
      <div class="format-bars">
        ${typeSummary.length ? typeSummary.map((item) => formatBar(item, posts)).join("") : `<div class="compact-row"><strong>데이터 없음</strong><span>콘텐츠 유형별 데이터가 없습니다.</span></div>`}
      </div>
    </section>

    <section class="feed-section">
      <div class="feed-toolbar">
        <div>
          <p class="eyebrow">Content Board</p>
          <h4>${esc(data.month)} 콘텐츠 보드</h4>
        </div>
        <span class="badge">${posts.length ? `${num(posts.length)} posts` : "No posts"}</span>
      </div>
      <div class="instagram-feed">
        ${posts.length ? posts.map((post) => feedCard(post)).join("") : `<article class="feed-card"><div class="feed-body"><h4>표시할 콘텐츠가 없습니다</h4><p class="feed-caption">해당 월의 게시물 데이터가 아직 없습니다.</p></div></article>`}
      </div>
    </section>`;
}

function miniMetric(label, value, helper) {
  return `<div class="mini-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(helper)}</p></div>`;
}

function signalCard(label, value, helper) {
  return `<article class="signal-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(helper)}</p></article>`;
}

function supportMetric(label, value, helper) {
  return `<div class="report-support-item"><span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(helper)}</em></div>`;
}

function reportLane(title, posts, helper) {
  return `<section class="report-panel report-lane">
    <h4>${esc(title)}</h4>
    <div class="compact-list">
      ${posts.length ? posts.map((post) => `<div class="compact-row"><strong>${esc(post.title || "-")}</strong><span>${esc(helper(post))}</span></div>`).join("") : `<div class="compact-row"><strong>데이터 없음</strong><span>해당 월에 표시할 콘텐츠가 없습니다.</span></div>`}
    </div>
  </section>`;
}

function formatBar(item, posts) {
  const maxCount = Math.max(...summarizeByType(posts).map((entry) => entry.count), 1);
  const width = Math.max(8, Math.round(item.count / maxCount * 100));
  return `<article class="format-row">
    <div>
      <strong>${esc(item.type)}</strong>
      <span>${num(item.count)}개 · 도달 ${num(item.reach)} · 저장률 ${pct(item.avgSaveRate)}</span>
    </div>
    <div class="format-track"><span style="width:${width}%"></span></div>
  </article>`;
}

function renderGrowthChart() {
  const rows = [...monthlyData].reverse();
  const max = Math.max(1, ...rows.map((item) => Number(item.account?.followerDelta || 0)));
  $("#growthChart").innerHTML = rows.map((item) => (
    `<div class="bar-row"><span>${item.month}</span><div class="bar"><i style="width:${Math.max(4, Number(item.account?.followerDelta || 0) / max * 100)}%"></i></div><em>+${num(item.account?.followerDelta)}</em></div>`
  )).join("");
}

function renderOtherSections(data) {
  const posts = data.posts || [];
  renderCards("reelsReport", posts.filter((post) => post.type === "릴스"), "feed");
  renderCards("cardnewsReport", posts.filter((post) => post.type === "카드뉴스"), "cardnews");
  renderCards("conversionGrid", [...posts].sort((a, b) => Number(b.websiteClicks || 0) - Number(a.websiteClicks || 0)).slice(0, 6));
  $("#adAiBriefing").innerHTML = `<article class="action-item"><strong>오늘 AI 브리핑 확인 중</strong><p>Objective별 Score를 계산하고 있습니다.</p></article>`;
  $("#adTodayStatus").innerHTML = `<span class="status-dot"></span><strong>오늘 광고 상태 확인 중</strong><span class="note">Meta Ads 데이터를 불러오고 있습니다.</span>`;
  $("#adCoreKpi").innerHTML = `<article class="action-item"><strong>핵심 지표 확인 중</strong><p>광고비, ROAS, 실매출을 확인합니다.</p></article>`;
  $("#advertisingSummary").innerHTML = `<article class="action-item"><strong>Meta 광고 데이터 확인 중</strong><p>광고비, 도달, 클릭, 구매값, ROAS를 확인합니다.</p></article>`;
  $("#campaignPerformance").innerHTML = `<article class="action-item"><strong>캠페인 성과 확인 중</strong><p>Meta 캠페인 기준으로 불러옵니다.</p></article>`;
  $("#adReconciliationSummary").innerHTML = `<article class="action-item"><strong>데이터 일치 검증 확인 중</strong><p>Meta 계정 전체 합계와 비교하고 있습니다.</p></article>`;
  $("#adFullReportActiveRows").innerHTML = `<tr><td colspan="18">전체 캠페인 데이터를 확인하고 있습니다.</td></tr>`;
  $("#adOrganicContent").innerHTML = `<article class="action-item"><strong>광고 / 유기 콘텐츠 비교 확인 중</strong><p>콘텐츠의 광고 집행 여부를 기준으로 비교합니다.</p></article>`;
  renderAdvertising(data);
  $("#salesHealthBanner").innerHTML = `<span class="status-dot"></span><strong>Sales Health 확인 중</strong><span class="note">Meta · Cafe24 데이터를 불러오고 있습니다.</span>`;
  $("#salesImpact").classList.add("cards");
  $("#salesImpact").classList.remove("instagram-feed");
  $("#salesImpact").innerHTML = `<article class="action-item"><strong>Cafe24 주문 데이터 확인 중</strong><p>CSV 또는 저장 캐시를 읽고 있습니다.</p></article>`;
  $("#salesDetail").innerHTML = `<article class="action-item"><strong>결제수단 · TOP 상품 확인 중</strong><p>Cafe24 주문 데이터를 불러오고 있습니다.</p></article>`;
  renderCafe24Sales(data);
  $("#salesMetaEstimate").innerHTML = `<article class="action-item"><strong>Meta 추정 매출 확인 중</strong><p>Meta 구매값을 불러오고 있습니다.</p></article>`;
  $("#salesVariance").innerHTML = `<article class="action-item"><strong>오차 분석 확인 중</strong><p>Meta 구매값과 Cafe24 실제 매출을 비교합니다.</p></article>`;
  $("#salesAction").innerHTML = `<article class="action-item"><strong>추천 Action 확인 중</strong><p>Sales Health 판단 후 표시됩니다.</p></article>`;
  renderAdComparison(data);
  $("#productDashboardBanner").innerHTML = `<span class="status-dot"></span><strong>상품 Dashboard 확인 중</strong><span class="note">Cafe24 Orders · Products 데이터를 불러오고 있습니다.</span>`;
  $("#productDashboardRows").innerHTML = `<tr><td colspan="7">상품 데이터를 불러오고 있습니다.</td></tr>`;
  renderProductDashboard(data);
  $("#calendarGrid").innerHTML = ["Brand Discovery", "Product Focus", "Editorial Cardnews", "Event / Sale"].map((title, index) => (
    `<article class="action-item"><strong>${index + 1}주차</strong><span>${title}</span><p>상위 성과 콘텐츠 톤을 다음 달에 확장합니다.</p></article>`
  )).join("");
  renderApiHealthCenter(data);
  renderScoreWeightsSettings();
  renderCafe24ProductDiagnostics();
}

const SCORE_FACTOR_LABELS = {
  roas: "ROAS",
  purchase: "Purchase",
  cpa: "CPA",
  ctr: "CTR",
  landingPageView: "Landing Page View",
  cpc: "CPC",
  thruplay: "ThruPlay",
  completionRate: "Completion Rate",
  engagementRate: "Engagement Rate",
  frequency: "Frequency",
  reach: "Reach",
  cpm: "CPM"
};

const SCORE_OBJECTIVE_LABELS = {
  sales: "Sales",
  traffic: "Traffic",
  video: "Video",
  engagement: "Engagement",
  awareness: "Awareness"
};

// Preset은 저희가 만든 출발점입니다. Balanced는 기본값과 동일하고, Sales/Traffic/Aggressive는
// 각각 매출 전환, 트래픽/유입, 효율보다 규모(볼륨)를 우선하는 쪽으로 가중치를 옮긴 것입니다.
// Preset을 고르면 값만 채워지고, 실제 저장은 "저장" 버튼을 눌러야 반영됩니다.
const SCORE_PRESETS = {
  balanced: {
    sales: { roas: 50, purchase: 30, cpa: 20 },
    traffic: { ctr: 35, landingPageView: 35, cpc: 30 },
    video: { thruplay: 50, completionRate: 50 },
    engagement: { engagementRate: 70, ctr: 30 },
    awareness: { reach: 35, frequency: 35, cpm: 30 }
  },
  sales: {
    sales: { roas: 60, purchase: 25, cpa: 15 },
    traffic: { ctr: 25, landingPageView: 50, cpc: 25 },
    video: { thruplay: 40, completionRate: 60 },
    engagement: { engagementRate: 50, ctr: 50 },
    awareness: { reach: 30, frequency: 40, cpm: 30 }
  },
  traffic: {
    sales: { roas: 40, purchase: 40, cpa: 20 },
    traffic: { ctr: 45, landingPageView: 30, cpc: 25 },
    video: { thruplay: 60, completionRate: 40 },
    engagement: { engagementRate: 40, ctr: 60 },
    awareness: { reach: 45, frequency: 25, cpm: 30 }
  },
  aggressive: {
    sales: { roas: 30, purchase: 50, cpa: 20 },
    traffic: { ctr: 30, landingPageView: 20, cpc: 50 },
    video: { thruplay: 70, completionRate: 30 },
    engagement: { engagementRate: 80, ctr: 20 },
    awareness: { reach: 60, frequency: 15, cpm: 25 }
  }
};

function renderScoreWeightsForm(weights) {
  const formTarget = $("#scoreWeightsForm");
  if (!formTarget) return;
  formTarget.innerHTML = Object.entries(weights).map(([objective, factors]) => `
    <div class="score-weights-group">
      <h4>${esc(SCORE_OBJECTIVE_LABELS[objective] || objective)}</h4>
      ${Object.entries(factors).map(([factorKey, value]) => `
        <label class="score-weights-field">
          <span>${esc(SCORE_FACTOR_LABELS[factorKey] || factorKey)}</span>
          <input type="number" min="0" max="100" data-objective="${esc(objective)}" data-factor="${esc(factorKey)}" value="${esc(value)}" />
        </label>
      `).join("")}
    </div>
  `).join("");
}

async function renderScoreWeightsSettings() {
  const formTarget = $("#scoreWeightsForm");
  const saveBtn = $("#scoreWeightsSaveBtn");
  const presetSelect = $("#scoreWeightsPreset");
  if (!formTarget) return;
  const resp = await getJson("/api/meta-ads/score-weights", 5000);
  const weights = resp.weights || {};
  renderScoreWeightsForm(weights);

  if (presetSelect && !presetSelect.dataset.bound) {
    presetSelect.dataset.bound = "1";
    presetSelect.addEventListener("change", () => {
      const preset = SCORE_PRESETS[presetSelect.value];
      if (!preset) return;
      renderScoreWeightsForm(preset);
      toast("Preset 값을 채웠습니다. 저장을 눌러야 실제로 반영됩니다.");
    });
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", async () => {
      const inputs = $$("#scoreWeightsForm input[data-objective]");
      const next = {};
      inputs.forEach((input) => {
        const objective = input.dataset.objective;
        const factor = input.dataset.factor;
        next[objective] = next[objective] || {};
        next[objective][factor] = Number(input.value || 0);
      });
      saveBtn.disabled = true;
      const originalLabel = saveBtn.textContent;
      saveBtn.textContent = "저장 중...";
      const result = await postJson("/api/meta-ads/score-weights", { weights: next }, 5000);
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
      toast(result.error ? "저장에 실패했습니다." : "가중치를 저장했습니다.");
    });
  }
}

async function renderApiHealthCenter(data) {
  const target = $("#apiSetup");
  if (!target) return;
  target.innerHTML = `<article class="api-health-card"><strong>연동 상태 확인 중</strong><p>Instagram, Meta Ads, Cafe24 상태를 확인합니다.</p></article>`;
  $("#apiHealthActions").innerHTML = apiHealthActionCards();

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const [status, meta, cafeStatus] = await Promise.all([
    getJson("/api/status", 6000),
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getCafe24Status(startDate, endDate)
  ]);
  const instagramOk = !data.error && status.instagram !== false;
  // 진단용 로그 (2026-07-08). renderApiHealthCenter()는 renderOtherSections(data)에서
  // selectedMonth()가 반환한 data를 그대로 받는다 — 여기 찍히는 data가 실제
  // /api/instagram/monthly 최신 응답과 같은지 이 로그로 확인한다.
  console.log("renderApiHealthCenter", { data, status, instagramOk });
  const metaOk = !meta.error && status.metaAds !== false;
  target.innerHTML = [
    apiHealthCard({
      title: "Instagram",
      ok: instagramOk,
      status: instagramOk ? "연결됨" : statusTextForError(data),
      source: integrationSource(data.source),
      updatedAt: syncStatusText(data),
      rows: [
        ["데이터 소스", sourceLabel(data)],
        ["마지막 성공 여부", instagramOk ? "성공" : "실패"],
        ["재인증 필요", instagramOk ? "아니오" : "확인 필요"],
        ["계정", data.account?.username || status.username || "samplaskr"],
        ["자동 동기화(6시간)", instagramSyncStatusLabel(status.instagramSync)]
      ],
      // data.error/data.cacheWarning는 이 페이지 요청 자체가 실패했을 때만 채워진다.
      // 서버 백그라운드 스케줄러(6시간 주기)가 조용히 실패한 경우는 이 값들에 잡히지
      // 않으므로, /api/status의 instagramSync.lastError도 함께 보여준다 — 캐시는
      // 깨지지 않지만 "에러는 health 상태에 표시"라는 요구를 만족시키기 위함.
      // (2026-07-08 Instagram 자동 동기화 기능 추가)
      detail: data.error || data.cacheWarning || status.instagramSync?.lastError || sourceText(data)
    }),
    apiHealthCard({
      title: "Meta Ads",
      ok: metaOk,
      status: metaOk ? "연결됨" : statusTextForError(meta),
      source: integrationSource(meta.source),
      updatedAt: syncStatusText(meta),
      rows: [
        ["데이터 소스", String(meta.source || "").includes("_cached") ? "캐시" : "API"],
        ["캠페인 수", `${apiNum((meta.campaigns || meta.rows || []).length)}개`],
        ["마지막 성공 여부", metaOk ? "성공" : "실패"],
        ["광고 계정", status.metaAdAccountId || "-"]
      ],
      detail: meta.error || `광고비 ${apiWon(meta.totals?.spend)} · 구매값 ${apiWon(meta.totals?.purchaseValue)}`
    }),
    apiHealthCard({
      title: "Cafe24",
      ok: cafeStatus.ok,
      status: cafeStatus.status,
      source: cafeStatus.source,
      updatedAt: cafeStatus.updatedAt,
      rows: [
        ["마지막 주문 조회", cafeStatus.lastOrderCheck],
        ["주문 API 상태", cafeStatus.orderApiStatus],
        ["proxyBaseUrl", status.cafe24ProxyBaseUrl || "-"],
        ["조회 주문 수", cafeStatus.orderCount],
        ["연결 기준", cafeStatus.basis]
      ],
      detail: cafeStatus.detail
    })
  ].join("");
  // Cafe24 재인증 콜백이 실패로 돌아온 경우, alert 대신 Settings의 이 패널 맨 위에
  // 계속 보이는 경고 카드로 안내한다(요청: Overview 또는 Settings에 오류 메시지 표시,
  // alert 금지). Cafe24 상태가 다시 정상이 되면 자동으로 사라진다.
  // (2026-07-08 Cafe24 재인증 흐름 개선)
  if (cafeStatus.ok) {
    cafe24OAuthErrorReason = null;
  } else if (cafe24OAuthErrorReason) {
    target.innerHTML = `<article class="api-health-card warn">
      <div class="api-health-head">
        <div><span>Cafe24</span><strong>재인증 실패</strong></div>
        <em>확인 필요</em>
      </div>
      <p>${esc(cafe24OAuthErrorReason)}</p>
    </article>` + target.innerHTML;
  }
}

async function getCafe24Status(startDate, endDate) {
  const [health, orders] = await Promise.all([
    getJson("/api/cafe24/health", 6000),
    getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=20`, 8000)
  ]);
  const ordersOk = !orders.error && orders.ok !== false;
  const orderCount = orders?.totals?.orderCount ?? orders?.orders?.length ?? orders?.orderCount;
  const sourceData = ordersOk ? orders : health;
  return {
    ok: ordersOk,
    status: ordersOk ? "연결됨" : "확인 필요",
    badge: ordersOk ? "정상" : "오류",
    tone: ordersOk ? "good" : "error",
    source: cafe24SourceLabel(sourceData),
    updatedAt: syncStatusText(sourceData),
    lastOrderCheck: ordersOk ? "성공" : "실패",
    orderApiStatus: ordersOk ? "정상" : "확인 필요",
    orderCount: hasApiValue(orderCount) ? `${apiNum(orderCount)}건` : "-",
    basis: health.ok === true && !health.error ? "Health 정상" : "주문 API 기준",
    detail: ordersOk
      ? `연결됨 · 주문 API가 정상 응답했습니다${hasApiValue(orderCount) ? ` · 주문 ${apiNum(orderCount)}건` : ""}.`
      : orders.error || health.error || health.message || "Cafe24 주문 API 확인 필요"
  };
}

function integrationSource(source) {
  const text = String(source || "");
  if (!text) return "-";
  if (text.includes("csv")) return "CSV";
  if (text.includes("cached")) return "캐시";
  if (text.includes("api") || text.includes("graph")) return "API";
  return source;
}

// 서버가 6시간마다 자동으로 돌리는 Instagram 백그라운드 동기화(runInstagramBackgroundSync)의
// 마지막 상태를 사람이 읽을 수 있는 문구로 바꾼다. (2026-07-08 Instagram 자동 동기화 기능 추가)
function instagramSyncStatusLabel(instagramSync) {
  if (!instagramSync || !instagramSync.lastAttemptAt) return "대기 중 (곧 첫 실행)";
  if (instagramSync.lastError) return `오류 (${relativeAgeText(cacheAgeMinutes({ syncedAt: instagramSync.lastAttemptAt }))} 전 시도) · 기존 캐시 유지`;
  if (instagramSync.lastSuccessAt) return `정상 (${relativeAgeText(cacheAgeMinutes({ syncedAt: instagramSync.lastSuccessAt }))} 전)`;
  return "확인 중";
}

function healthTime() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// --- Real sync-time / cache-vs-live helpers (1차 신뢰도 패치) ---
// Data payloads from server.mjs already carry a real syncedAt (when the cache
// file was last written by a live fetch). Previously the UI ignored that and
// showed healthTime() (the browser's current clock) instead, which always
// looked like "just synced" even when serving hours/days-old cache. These
// helpers read the real timestamp so "마지막 동기화" reflects reality.
function formatSyncStamp(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// true = live API response, false = cache/CSV, null = unknown (no source info yet)
function isLiveSource(data = {}) {
  const source = String(data.source || "");
  if (!source) return null;
  if (source.includes("cached") || source.includes("csv") || data.cacheMode) return false;
  if (source.includes("graph_api") || source.includes("marketing_api") || source.includes("admin_api")) return true;
  return null;
}

function syncStatusText(data = {}) {
  const stamp = formatSyncStamp(data.syncedAt);
  if (!stamp) return "동기화 기록 없음";
  const live = isLiveSource(data);
  if (live === null) return stamp;
  return `${live ? "Live" : "Cache"} · ${stamp}`;
}

// How many minutes old is this payload's syncedAt? null = unknown.
function cacheAgeMinutes(data = {}) {
  const iso = data.syncedAt;
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

// "Cache 사용 중" alone doesn't tell a director whether the number can be
// trusted right now. Show relative age instead: 최신 / N분 전 / N시간 전 / N일 전.
function cacheFreshnessLabel(data = {}) {
  const minutes = cacheAgeMinutes(data);
  if (minutes === null) return "Cache";
  if (minutes < 15) return "Cache (최신)";
  if (minutes < 60) return `Cache (${minutes}분 전)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Cache (${hours}시간 전)`;
  const days = Math.floor(hours / 24);
  return `Cache (${days}일 전)`;
}

function cacheFreshnessTone(data = {}) {
  const minutes = cacheAgeMinutes(data);
  if (minutes === null) return "warn";
  return minutes >= 1440 ? "error" : "warn";
}

// One-line health classification shared by the Overview banner. Failures
// carry a concrete reason + next action (not just "실패"), and cache carries
// a freshness read so a director can judge whether to trust the number.
// kind is "instagram" | "meta" | "cafe24" — only Cafe24 has an in-app
// re-auth link (/api/cafe24/oauth/start); Instagram/Meta tokens are rotated
// manually in .env, so those show the required action as plain text.
function bannerState(data = {}, kind = "") {
  if (data.error) {
    const lower = String(data.error).toLowerCase();
    const category = String(data.category || "").toLowerCase();
    if (lower.includes("refresh_token") || category.includes("expired_refresh_token") || lower.includes("재인증")) {
      return {
        tone: "error",
        label: "토큰 만료",
        reason: "Refresh Token 만료",
        action: "재인증 필요",
        actionHref: kind === "cafe24" ? "/api/cafe24/oauth/start" : null
      };
    }
    if (isPermissionBlocked(data) || category.includes("permission_blocked")) {
      return { tone: "error", label: "권한 만료", reason: "앱 권한 차단", action: "다시 로그인 필요", actionHref: null };
    }
    if (lower.includes("access_token") || lower.includes("invalid_token") || category.includes("invalid_access_token")) {
      return { tone: "error", label: "토큰 오류", reason: "Access Token 오류", action: "토큰 재발급 필요", actionHref: null };
    }
    return { tone: "error", label: "API 실패", reason: data.error, action: "연결 상태 확인 필요", actionHref: null };
  }
  if (data.source === "csv_required") {
    return { tone: "warn", label: "캐시 사용 중", reason: "지난 달 데이터(CSV)", action: "", actionHref: null };
  }
  const live = isLiveSource(data);
  if (live === false) {
    return { tone: cacheFreshnessTone(data), label: cacheFreshnessLabel(data), reason: "", action: "", actionHref: null };
  }
  return { tone: "good", label: "정상", reason: "", action: "", actionHref: null };
}

// Small "출처 배지" for individual data cards: which service the number came
// from (확정 매출 vs 추정 vs 콘텐츠 신호), and whether it's Live or Cache right
// now. Falls back to "데이터 없음" so a real zero is never silently shown the
// same way as a missing/blocked value.
function cardBadge(kind, data = {}, hasValue = true) {
  if (data.error || !hasValue) return { label: "데이터 없음", tone: "muted" };
  const kindLabel = { cafe24: "Cafe24 확정", meta: "Meta 추정", instagram: "Instagram 콘텐츠 신호" }[kind] || "";
  const live = isLiveSource(data);
  const modeLabel = live === false ? "Cache" : live === true ? "Live API" : "";
  return {
    label: [kindLabel, modeLabel].filter(Boolean).join(" · "),
    tone: live === false ? "cache" : live === true ? "live" : "neutral"
  };
}

function dataBadgeHtml(badge) {
  if (!badge || !badge.label) return "";
  return `<i class="data-badge ${esc(badge.tone || "")}">${esc(badge.label)}</i>`;
}

// 상대 시간 텍스트만("최신"/"N분 전"/"N시간 전"/"N일 전") 반환한다. cacheFreshnessLabel()은
// "Cache (N일 전)"처럼 "Cache" 접두어가 고정되어 있어 Instagram의 "정상 (N일 전)" 문구에는
// 재사용할 수 없어 별도로 뺐다. (2026-07-08 Health Banner 색상/문구 보정)
function relativeAgeText(minutes) {
  if (minutes === null) return "";
  if (minutes < 15) return "최신";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

// Overview 상단 Health Banner 전용 색상/문구 보정.
// bannerState()/cacheFreshnessTone()는 Sidebar(updateSync)와 Sales 판단(salesDecisionState)
// 등 다른 화면에서도 쓰이므로 그대로 두고, 이 함수는 Health Banner 렌더링에서만 쓴다.
//
// 문제였던 지점: bannerState()는 data.error가 없어도(=API 자체는 정상) 서버가 온디스크
// 캐시를 서빙 중이면(source에 "_cached") cacheFreshnessTone()으로 넘어가고, 캐시가
// 24시간(1440분) 넘게 오래됐으면 tone:"error"를 반환했다 — Sidebar는 이미 지난 수정에서
// data.error 유무만으로 판정하도록 바꿨지만, Health Banner는 여전히 bannerState()의 원본
// tone을 그대로 써서 Sidebar(정상)와 Health Banner(빨간 점)가 서로 모순되어 보였다.
//
// 기준: 빨간색 = 실제 오류/재인증 필요, 노란색 = Cache/동기화 필요/최신 아님, 초록색 = API 정상.
// 캐시가 오래됐다는 이유만으로는(=data.error 없음) 절대 빨간색을 쓰지 않는다.
function healthBannerState(data = {}, kind = "") {
  const base = bannerState(data, kind);
  if (data.error) {
    // 실제 오류: Cafe24는 재인증성 오류를 요청하신 문구("재인증 필요")로 통일한다.
    // Instagram/Meta는 기존 라벨(토큰 오류/API 실패 등)을 그대로 유지한다.
    if (kind === "cafe24" && (base.label === "토큰 만료" || base.label === "권한 만료" || base.label === "토큰 오류")) {
      return { ...base, tone: "error", label: "재인증 필요" };
    }
    return { ...base, tone: "error" };
  }
  // data.error가 없는데 base.tone이 "error"라면 원인은 오직 "캐시가 오래됐다"는 것뿐이다
  // (bannerState()의 cacheFreshnessTone() 분기) — 이건 실패가 아니라 정상/동기화 필요다.
  if (kind === "instagram") {
    const minutes = cacheAgeMinutes(data);
    const ageText = relativeAgeText(minutes);
    // 방금 동기화된 경우("최신")까지 괄호로 덧붙이면 중복스러우니 그때는 "정상"만 표시한다.
    return {
      tone: "good",
      label: ageText && ageText !== "최신" ? `정상 (마지막 동기화 ${ageText})` : "정상",
      reason: "",
      action: "",
      actionHref: null
    };
  }
  const live = isLiveSource(data);
  if (live === false || data.source === "csv_required") {
    const minutes = cacheAgeMinutes(data);
    return {
      tone: "warn",
      label: minutes === null ? "동기화 필요" : "Cache",
      reason: base.reason,
      action: base.action,
      actionHref: base.actionHref
    };
  }
  return { tone: "good", label: "정상", reason: base.reason, action: base.action, actionHref: base.actionHref };
}

// Reference UI status-banner language: Overview/Advertising/Sales all answer
// "지금 데이터를 믿어도 되는가" with the exact same visual grammar (dot +
// bold label + muted note, reusing .ad-status-banner). Overview needs 3
// source rows (Instagram/Meta/Cafe24) instead of Advertising/Sales' single
// synthesized row, so it stacks 3 of the same banner instead of one.
function renderHealthBanner({ instagram = {}, meta = {}, cafe = {} } = {}) {
  const target = $("#apiHealthBanner");
  if (!target) return;
  target.classList.remove("loading");
  const rows = [
    ["Instagram", instagram, "instagram"],
    ["Meta Ads", meta, "meta"],
    ["Cafe24", cafe, "cafe24"]
  ];
  target.innerHTML = rows.map(([label, data, kind]) => {
    const state = healthBannerState(data, kind);
    const stamp = formatSyncStamp(data.syncedAt) || "동기화 기록 없음";
    const reasonText = [state.reason, stamp].filter(Boolean).join(" · ");
    // Cafe24 재인증 링크는 새 탭이 아니라 같은 탭에서 이동한다 — Cafe24 로그인/동의 화면을
    // 거친 뒤 서버가 "/"로 리다이렉트하므로, 같은 탭에서 그대로 대시보드로 돌아오게 하기 위함이다.
    // (2026-07-08 Cafe24 재인증 흐름 개선)
    const actionHtml = !state.action ? "" : state.actionHref
      ? `<a class="health-action" href="${esc(state.actionHref)}">${esc(state.action)}</a>`
      : `<span class="health-action" title="${esc(kind === "cafe24" ? "" : "META_ACCESS_TOKEN / .env에서 수동 갱신 필요")}">${esc(state.action)}</span>`;
    return `<div class="ad-status-banner ${esc(state.tone)}">
      <span class="status-dot"></span>
      <strong>${esc(label)} · ${esc(state.label)}</strong>
      <span class="note">${esc(reasonText)}</span>
      ${actionHtml}
    </div>`;
  }).join("");
}

function apiHealthCard({ title, ok, status, source, updatedAt, rows, detail }) {
  return `<article class="api-health-card ${ok ? "good" : "warn"}">
    <div class="api-health-head">
      <div><span>${esc(title)}</span><strong>${esc(status)}</strong></div>
      <em>${ok ? "정상" : "확인 필요"}</em>
    </div>
    <p>${esc(detail || "-")}</p>
    <dl>
      <div><dt>데이터 소스</dt><dd>${esc(source || "-")}</dd></div>
      <div><dt>마지막 동기화</dt><dd>${esc(updatedAt || "-")}</dd></div>
      ${(rows || []).map(([label, value]) => `<div><dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`).join("")}
    </dl>
  </article>`;
}

function apiHealthActionCards() {
  return [
    ["지금 동기화", "현재 화면의 데이터를 다시 불러옵니다.", "", "refresh", false],
    // Cafe24 재인증은 같은 탭에서 이동해야 Cafe24 로그인/동의 후 서버가 "/"로 리다이렉트할 때
    // 같은 탭으로 돌아온다 — 새 탭(target="_blank")이면 새 탭에만 결과가 남는다.
    // (2026-07-08 Cafe24 재인증 흐름 개선)
    ["재인증 안내", "Cafe24 토큰 만료 시 OAuth 재인증을 시작합니다.", "/api/cafe24/oauth/start", "", false],
    ["상세 보기", "최근 진단 로그를 확인합니다.", "/api/diagnostics/logs", "", true]
  ].map(([title, note, href, action, newTab]) => `<article class="api-health-action">
    <strong>${esc(title)}</strong>
    <p>${esc(note)}</p>
    ${href ? `<a class="button secondary" href="${href}"${newTab ? ' target="_blank" rel="noreferrer"' : ""}>${esc(title)}</a>` : `<button class="button secondary" type="button" data-health-action="${esc(action)}">${esc(title)}</button>`}
  </article>`).join("");
}

async function renderAdvertising(data) {
  const briefingTarget = $("#adAiBriefing");
  const statusTarget = $("#adTodayStatus");
  const coreKpiTarget = $("#adCoreKpi");
  const summaryTarget = $("#advertisingSummary");
  const campaignTarget = $("#campaignPerformance");
  const contentTarget = $("#adOrganicContent");
  const tableTarget = $("#adPerformanceRows");
  const reconTarget = $("#adReconciliationSummary");
  const fullReportTargets = {
    active: $("#adFullReportActiveRows"),
    other: $("#adFullReportOtherRows")
  };
  bindAdFullReportToggles();
  if (!briefingTarget || !statusTarget || !coreKpiTarget || !summaryTarget || !campaignTarget || !contentTarget || !tableTarget || !reconTarget || !fullReportTargets.active || !fullReportTargets.other) return;

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  renderAdLevelTabs();
  const [meta, fullReport, weightsResp] = await Promise.all([
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}&level=${activeAdLevel}`, 9000),
    getJson(`/api/meta-ads/full-report?since=${startDate}&until=${endDate}`, 12000),
    getJson("/api/meta-ads/score-weights", 5000)
  ]);
  const scoreWeights = weightsResp.weights || {};
  const posts = data.posts || [];
  const adPosts = posts.filter((post) => Number(post.adSpend || 0));
  const organicPosts = posts.filter((post) => !Number(post.adSpend || 0));
  logAdExecutionDebug(fullReport, data.month);

  if (meta.error) {
    const status = statusTextForError(meta);
    const badge = metaAdsSourceBadge(meta);
    briefingTarget.innerHTML = `<article class="action-item"><strong>브리핑 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다.</p></article>`;
    statusTarget.className = "ad-status-banner error";
    statusTarget.innerHTML = `<span class="status-dot"></span><strong>${esc(badge.icon)} ${esc(badge.label)} · ${esc(status)}</strong><span class="note">${esc(startDate)} ~ ${esc(endDate)} · ${esc(meta.error)}</span>`;
    coreKpiTarget.innerHTML = `<article class="action-item"><strong>핵심 지표 확인 불가</strong><p>Meta API 오류가 해결되면 광고비 · ROAS · 실매출이 표시됩니다.</p></article>`;
    summaryTarget.innerHTML = [
      `<article class="action-item"><strong>Meta API 상태</strong><span>${esc(status)}</span><p>${esc(meta.error)}</p></article>`,
      `<article class="action-item"><strong>권한 오류 안내</strong><p>Meta API 권한 또는 토큰 권한이 막히면 광고 성과를 불러올 수 없습니다. Settings의 Meta Ads 연결 상태를 확인하세요.</p></article>`
    ].join("");
    campaignTarget.innerHTML = `<article class="action-item"><strong>캠페인별 성과</strong><p>Meta API 오류가 해결되면 캠페인 기준 성과가 표시됩니다.</p></article>`;
    tableTarget.innerHTML = `<tr><td colspan="11">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    reconTarget.innerHTML = `<article class="action-item"><strong>검증 불가</strong><p>Meta API 오류가 해결되면 표시됩니다.</p></article>`;
    fullReportTargets.active.innerHTML = `<tr><td colspan="18">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    fullReportTargets.other.innerHTML = "";
    contentTarget.innerHTML = renderAdOrganicCards(adPosts, organicPosts);
    return;
  }

  renderAdAiBriefing(fullReport, scoreWeights, briefingTarget);

  const totals = meta.totals || {};
  const spend = Number(totals.spend || 0);
  const purchaseValue = Number(totals.purchaseValue || 0);
  const roas = spend ? purchaseValue / spend : null;
  const badge = metaAdsSourceBadge(meta);

  statusTarget.className = `ad-status-banner ${badge.tone}`;
  statusTarget.innerHTML = `<span class="status-dot"></span><strong>${esc(badge.icon)} ${esc(badge.label)}</strong><span class="note">${esc(startDate)} ~ ${esc(endDate)}${badge.detail ? " " + esc(badge.detail) : ""}</span>`;

  coreKpiTarget.innerHTML = [
    metaAdsSummaryCard("광고비", apiWon(totals.spend), "선택 기간 집행 금액", true),
    metaAdsSummaryCard("ROAS", roas === null ? "-" : multiple(roas), "Meta 구매값 / 광고비", true),
    metaAdsSummaryCard("실매출", "Cafe24 연동 예정", "추후 Cafe24 실제 매출과 연결됩니다.", true)
  ].join("");

  summaryTarget.innerHTML = [
    metaAdsSummaryCard("노출", apiNum(totals.impressions), "광고가 표시된 횟수"),
    metaAdsSummaryCard("도달", apiNum(totals.reach), "광고를 본 계정 수"),
    metaAdsSummaryCard("클릭", apiNum(totals.clicks), "Meta 클릭 합계"),
    metaAdsSummaryCard("CTR", pct(Number(totals.ctr || 0) * 100), "클릭 / 노출"),
    metaAdsSummaryCard("CPC", apiWon(totals.cpc), "광고비 / 클릭"),
    metaAdsSummaryCard("CPM", apiWon(totals.cpm), "1,000회 노출 비용"),
    metaAdsSummaryCard("Meta 구매수", apiNum(totals.purchases || totals.metaPurchases), "Meta 기준 구매 이벤트"),
    metaAdsSummaryCard("Meta 구매값", apiWon(totals.purchaseValue), "Meta 기준 추정 구매값")
  ].join("");

  const rows = metaAdsRowsForLevel(meta)
    .sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0))
    .slice(0, 6);
  campaignTarget.innerHTML = rows.length ? rows.map((campaign) => metaAdsPerformanceCard(campaign)).join("") : `<article class="action-item"><strong>${esc(metaAdsLevelLabel(activeAdLevel))} 데이터 없음</strong><p>선택 월에 표시할 Meta 광고 데이터가 없습니다.</p></article>`;

  tableTarget.innerHTML = renderMetaAdsRows(metaAdsRowsForLevel(meta));
  renderMetaAdsReconciliation(fullReport, reconTarget);
  renderMetaAdsFullReportGroups(fullReport, scoreWeights, fullReportTargets);
  contentTarget.innerHTML = renderAdOrganicCards(adPosts, organicPosts);
}

function metaAdsSummaryCard(label, value, note, emphasize = false) {
  return `<article class="action-item ad-summary-card${emphasize ? " ad-core-kpi-card" : ""}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    <p>${esc(note)}</p>
  </article>`;
}

function metaAdsPerformanceCard(row = {}) {
  return `<article class="action-item ad-performance-card">
    <strong title="${esc(metaAdsRowName(row))}">${esc(metaAdsRowName(row))}</strong>
    <span>${apiWon(row.spend)}</span>
    <div class="ad-card-metrics">
      ${metaAdsMiniMetric("노출", apiNum(row.impressions))}
      ${metaAdsMiniMetric("도달", apiNum(row.reach))}
      ${metaAdsMiniMetric("클릭", apiNum(row.clicks))}
      ${metaAdsMiniMetric("CTR", pct(Number(row.ctr || 0) * 100))}
      ${metaAdsMiniMetric("CPC", apiWon(row.cpc))}
      ${metaAdsMiniMetric("ROAS", row.roas === null ? "-" : multiple(row.roas || row.metaRoas))}
    </div>
  </article>`;
}

function metaAdsMiniMetric(label, value) {
  return `<em><small>${esc(label)}</small><b>${esc(value)}</b></em>`;
}

function renderAdLevelTabs() {
  $$("[data-ad-level]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adLevel === activeAdLevel);
  });
}

function metaAdsRowsForLevel(meta = {}) {
  if (Array.isArray(meta.rows) && meta.rows.length) return meta.rows;
  if (activeAdLevel === "ad") return meta.ads || [];
  if (activeAdLevel === "adset") return meta.adsets || [];
  return meta.campaigns || [];
}

function metaAdsLevelLabel(level) {
  return { campaign: "캠페인", adset: "광고세트", ad: "광고" }[level] || "캠페인";
}

function metaAdsRowName(row = {}) {
  if (activeAdLevel === "ad") return row.adName || row.adId || row.label || "광고";
  if (activeAdLevel === "adset") return row.adsetName || row.adsetId || row.label || "광고세트";
  return row.campaignName || row.campaignId || row.label || "캠페인";
}

function renderMetaAdsRows(rows = []) {
  return rows.length ? rows
    .sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0))
    .map((row) => (
      `<tr>
        <td class="ad-name-cell" title="${esc(metaAdsRowName(row))}">${esc(metaAdsRowName(row))}</td>
        <td>${apiWon(row.spend)}</td>
        <td>${apiNum(row.impressions)}</td>
        <td>${apiNum(row.reach)}</td>
        <td>${apiNum(row.clicks)}</td>
        <td>${pct(Number(row.ctr || 0) * 100)}</td>
        <td>${apiWon(row.cpc)}</td>
        <td>${apiWon(row.cpm)}</td>
        <td>${apiNum(row.purchases || row.metaPurchases)}</td>
        <td>${apiWon(row.purchaseValue || row.metaPurchaseValue)}</td>
        <td>${row.roas === null ? "-" : multiple(row.roas || row.metaRoas)}</td>
      </tr>`
    )).join("") : `<tr><td colspan="11">선택 월에 표시할 Meta 광고 데이터가 없습니다.</td></tr>`;
}

const META_OBJECTIVE_LABEL = {
  sales: "Sales",
  traffic: "Traffic",
  engagement: "Engagement",
  video: "Video",
  awareness: "Awareness",
  unknown: "확인 필요"
};

function metaAdsObjectiveLabel(row = {}) {
  return META_OBJECTIVE_LABEL[row.objective] || "확인 필요";
}

// AI Reason: "중지 검토" 같은 태그가 아니라 마케팅 팀장이 코멘트하듯 자연스러운 한두 문장으로
// 근거를 설명합니다. Objective마다 보는 지표가 다르고, 같은 지표라도 다른 지표와 조합되면
// 결론이 달라집니다(예: CTR은 좋아도 Frequency가 높으면 피로도 경고로 바뀝니다).
function metaAdsNarrative(row = {}) {
  const objective = row.objective || "unknown";
  const impressions = Number(row.impressions || 0);
  const frequency = Number(row.frequency || 0);

  if (objective === "sales") {
    const purchases = Number(row.purchases || 0);
    const roas = Number(row.roas || 0);
    if (purchases <= 0) return "구매 전환이 발생하지 않아 광고비만 소진되고 있습니다. 소재 또는 타겟 점검을 추천합니다.";
    const aov = purchases ? Number(row.purchaseValue || 0) / purchases : 0;
    const cpaEfficient = aov > 0 && Number(row.cpa || 0) / aov <= 0.5;
    if (roas >= 8) return `ROAS는 매우 우수합니다.${cpaEfficient ? " CPA도 낮으므로 예산을 20% 증액해도 좋습니다." : " 예산 확대를 검토해도 좋습니다."}`;
    if (roas >= 3) return "ROAS가 안정적으로 유지되고 있습니다. 현재 예산으로 계속 운영하세요.";
    if (roas >= 1) return "ROAS가 다소 낮은 편입니다. 소재나 타겟 조정을 검토하세요.";
    return "광고비 대비 매출 전환이 낮습니다. 예산 축소 또는 타겟 재설정이 필요합니다.";
  }

  if (objective === "traffic") {
    const ctr = Number(row.ctr || 0);
    if (ctr >= 0.02 && frequency > 3.5) return "CTR은 우수하지만 Frequency가 높아져 피로도가 발생하고 있습니다. 새 크리에이티브 교체를 추천합니다.";
    if (ctr >= 0.02) return "CTR이 우수하고 광고 피로도도 낮습니다. 현재 세팅을 유지하세요.";
    if (ctr >= 0.01) return "CTR이 보통 수준입니다. 소재 테스트로 개선 여지가 있습니다.";
    return "CTR이 낮아 클릭을 충분히 만들지 못하고 있습니다. 타겟 또는 소재 변경이 필요합니다.";
  }

  if (objective === "engagement") {
    const rate = impressions ? Number(row.postEngagement || 0) / impressions : 0;
    if (rate >= 0.05) return "참여율이 우수합니다. 반응이 좋은 소재이니 유사한 콘텐츠로 확장해도 좋습니다.";
    if (rate >= 0.02) return "참여율이 보통 수준입니다. 소재 톤이나 CTA 문구를 조정해보세요.";
    return "참여율이 낮습니다. 콘텐츠 포맷이나 메시지를 재검토하세요.";
  }

  if (objective === "video") {
    const videoViews = Number(row.videoViews || 0);
    if (!videoViews) return "Video 조회 데이터가 아직 없습니다. 집행 기간을 조금 더 지켜보세요.";
    const completionRate = Number(row.videoCompletion || 0) / videoViews;
    if (completionRate >= 0.3) return "완주율이 높아 소재 몰입도가 좋습니다. 예산 확대를 고려해도 좋습니다.";
    if (completionRate >= 0.15) return "완주율이 보통 수준입니다. 영상 초반 3초의 후킹을 강화해보세요.";
    return "완주율이 낮아 초반 이탈이 많습니다. 도입부 크리에이티브 교체를 추천합니다.";
  }

  if (objective === "awareness") {
    const cpm = Number(row.cpm || 0);
    if (frequency > 4) return "Frequency가 높아 동일 사용자에게 반복 노출되고 있습니다. 타겟을 넓히거나 소재를 교체하세요.";
    if (cpm > 12000) return "CPM이 높은 편이라 노출 효율이 낮습니다. 타겟 범위를 재검토하세요.";
    return "Reach가 안정적으로 확대되고 있고 광고 피로도도 낮습니다. 현재 설정을 유지하세요.";
  }

  return "Objective 정보를 확인할 수 없어 자동 판단이 어렵습니다. 직접 확인이 필요합니다.";
}

// 표에서 보여줄 핵심 지표 한 줄(스캔용). 문장형 근거(metaAdsNarrative)와 함께 씁니다.
function metaAdsKeyMetricLine(row = {}) {
  const objective = row.objective || "unknown";
  if (objective === "sales") return `ROAS ${row.roas === null ? "-" : multiple(row.roas)} · 구매 ${apiNum(row.purchases)}건`;
  if (objective === "traffic") return `CTR ${pct(Number(row.ctr || 0) * 100)} · CPC ${apiWon(row.cpc)}`;
  if (objective === "engagement") return `참여율 ${pct((Number(row.impressions || 0) ? Number(row.postEngagement || 0) / Number(row.impressions || 0) : 0) * 100)}`;
  if (objective === "video") return `완주율 ${pct((Number(row.videoViews || 0) ? Number(row.videoCompletion || 0) / Number(row.videoViews || 0) : 0) * 100)}`;
  if (objective === "awareness") return `Frequency ${Number(row.frequency || 0).toFixed(1)} · Reach ${apiNum(row.reach)}`;
  return "";
}

// 별점 라벨(확대/유지/관찰/점검/중지)을 실제 액션 문구로 바꿉니다.
function metaAdsDecisionActionText(label) {
  const map = {
    확대: "예산 확대 추천",
    유지: "현행 유지",
    관찰: "관찰 필요",
    점검: "점검 필요",
    중지: "중지 추천"
  };
  return map[label] || label;
}

// "이번 기간에 실제로 집행되었는지"를 Meta Ads Manager와 동일한 기준(광고비/노출/도달 중
// 하나라도 0보다 큼)으로 판단합니다. 캠페인의 계정 상태(진행중/종료/초안)는 선택한 기간에
// 실제로 돈이 나갔는지와 다를 수 있어(예: 이번 달엔 멈췄지만 상태는 "진행중"), Marketing
// Director는 상태가 아니라 이 실행 여부를 기본 표시 기준으로 삼습니다.
function metaAdsIsExecuted(row = {}) {
  return Number(row.spend || 0) > 0 || Number(row.impressions || 0) > 0 || Number(row.reach || 0) > 0;
}

// 캠페인 전체 표를 집행 / 미집행 2그룹으로 나눕니다.
// 기본 화면은 이번 기간에 실제로 운영된 광고만 보는 것이 목적이라, 미집행 캠페인은 하나로
// 묶어 접어둡니다. 기간을 바꾸면 이 판단도 그 기간의 데이터로 다시 계산됩니다.
function metaAdsStatusGroup(row) {
  return metaAdsIsExecuted(row) ? "active" : "other";
}

// 특정 캠페인이 왜 이번 달 "집행 캠페인"에 보이는지/안 보이는지를 콘솔에서 바로 확인할 수 있게
// 해주는 디버그 로그입니다. 상태(진행중 등)·생성일·이름은 판단에 전혀 쓰지 않고, 오직 선택한
// 기간의 Insights 값(spend/impressions/reach)만으로 isVisible을 계산합니다.
function logAdExecutionDebug(fullReport = {}, month) {
  const rows = fullReport.rows || [];
  const debugRows = rows.map((row) => {
    const isVisible = metaAdsIsExecuted(row);
    return {
      campaign_name: row.campaignName,
      selected_month: month,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      reach: Number(row.reach || 0),
      isVisible,
      hideReason: isVisible ? "" : "이 기간 spend/impressions/reach가 모두 0 (status/생성일/이름은 판단에 사용 안 함)"
    };
  });
  console.groupCollapsed(`[Ad Execution Debug] ${month} · 캠페인 ${debugRows.length}개 (집행 ${debugRows.filter((r) => r.isVisible).length}개 / 미집행 ${debugRows.filter((r) => !r.isVisible).length}개)`);
  if (console.table) console.table(debugRows);
  else debugRows.forEach((r) => console.log(r));
  console.groupEnd();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Objective별 factor를 0~100으로 정규화하는 기준선(벤치마크)입니다. Settings에서 바꿀 수 있는
// 것은 이 factor들 사이의 "가중치"이고, 정규화 기준선 자체는 코드에 고정되어 있습니다
// (계정 성과가 쌓이면 조정이 필요할 수 있습니다).
const SCORE_FACTOR_FNS = {
  sales: {
    roas: (row) => {
      const purchases = Number(row.purchases || 0);
      const roas = Number(row.roas || 0);
      if (!purchases) return 0;
      if (roas < 3) return clampScore(10 + (roas / 3) * 40);
      if (roas < 8) return clampScore(50 + ((roas - 3) / 5) * 40);
      return clampScore(90 + Math.min(10, ((roas - 8) / 8) * 10));
    },
    purchase: (row) => clampScore((Number(row.purchases || 0) / 5) * 100),
    cpa: (row) => {
      const purchases = Number(row.purchases || 0);
      if (!purchases) return 0;
      const aov = Number(row.purchaseValue || 0) / purchases;
      if (!aov) return 0;
      const ratio = Number(row.cpa || 0) / aov;
      if (ratio <= 0.3) return 100;
      if (ratio >= 1) return 0;
      return clampScore(100 * (1 - (ratio - 0.3) / 0.7));
    }
  },
  traffic: {
    ctr: (row) => clampScore((Number(row.ctr || 0) / 0.02) * 100),
    landingPageView: (row) => {
      const clicks = Number(row.clicks || 0);
      const rate = clicks ? Number(row.landingPageViews || 0) / clicks : 0;
      return clampScore((rate / 0.7) * 100);
    },
    cpc: (row) => {
      const cpc = Number(row.cpc || 0);
      if (!cpc) return 0;
      if (cpc <= 200) return 100;
      if (cpc >= 800) return 0;
      return clampScore(100 * (1 - (cpc - 200) / 600));
    }
  },
  video: {
    thruplay: (row) => {
      const impressions = Number(row.impressions || 0);
      const rate = impressions ? Number(row.thruplayViews || 0) / impressions : 0;
      return clampScore((rate / 0.3) * 100);
    },
    completionRate: (row) => {
      const videoViews = Number(row.videoViews || 0);
      if (!videoViews) return 0;
      return clampScore((Number(row.videoCompletion || 0) / videoViews / 0.3) * 100);
    }
  },
  engagement: {
    engagementRate: (row) => {
      const impressions = Number(row.impressions || 0);
      const rate = impressions ? Number(row.postEngagement || 0) / impressions : 0;
      return clampScore((rate / 0.05) * 100);
    },
    ctr: (row) => clampScore((Number(row.ctr || 0) / 0.02) * 100)
  },
  awareness: {
    frequency: (row) => clampScore(100 - Math.max(0, Number(row.frequency || 0) - 3) * 25),
    reach: (row) => {
      const reach = Number(row.reach || 0);
      const spend = Number(row.spend || 0);
      if (!reach) return 0;
      const cpr = spend / reach;
      if (cpr <= 15) return 100;
      if (cpr >= 50) return 0;
      return clampScore(100 * (1 - (cpr - 15) / 35));
    },
    cpm: (row) => {
      const cpm = Number(row.cpm || 0);
      if (!cpm) return 0;
      if (cpm <= 5000) return 100;
      if (cpm >= 15000) return 0;
      return clampScore(100 * (1 - (cpm - 5000) / 10000));
    }
  }
};

// Performance Score(0~100) Rule Engine. Objective별 factor의 0~100 정규화 점수를
// Settings에서 설정한 가중치로 가중평균합니다. 가중치 합이 100이 아니어도 자동으로
// 정규화되고, 가중치가 0/비어있는 factor는 계산에서 제외됩니다.
function metaAdsPerformanceScore(row = {}, weights = {}) {
  const objective = row.objective || "unknown";
  const factorFns = SCORE_FACTOR_FNS[objective];
  if (!factorFns) return null;
  const objectiveWeights = weights[objective] || {};
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [factorKey, fn] of Object.entries(factorFns)) {
    const weight = Number(objectiveWeights[factorKey] || 0);
    if (!weight) continue;
    weightedSum += fn(row) * weight;
    weightTotal += weight;
  }
  if (!weightTotal) return null;
  return Math.round(weightedSum / weightTotal);
}

// AI Decision: Objective와 무관하게 Score 하나로 통일한 5단계 신뢰도 표시입니다.
function metaAdsStarDecision(score) {
  if (score === null || score === undefined) return { stars: "-", label: "확인 필요", tone: "warn" };
  if (score >= 80) return { stars: "★★★★★", label: "확대", tone: "good" };
  if (score >= 60) return { stars: "★★★★", label: "유지", tone: "good" };
  if (score >= 40) return { stars: "★★★", label: "관찰", tone: "warn" };
  if (score >= 20) return { stars: "★★", label: "점검", tone: "warn" };
  return { stars: "★", label: "중지", tone: "urgent" };
}

function metaAdsDecisionCellHtml(row, weights) {
  const score = metaAdsPerformanceScore(row, weights);
  const decision = metaAdsStarDecision(score);
  return `<div class="ad-decision-cell ${esc(decision.tone)}">
    <span class="ad-decision-stars">${esc(decision.stars)} ${esc(metaAdsDecisionActionText(decision.label))}</span>
    <span class="ad-decision-line">${esc(metaAdsNarrative(row))}</span>
  </div>`;
}

function metaAdsFullReportRowHtml(row, weights) {
  const score = metaAdsPerformanceScore(row, weights);
  return `<tr>
    <td class="ad-name-cell" title="${esc(row.campaignName || "-")}">${esc(row.campaignName || "-")}</td>
    <td>${esc(row.status || "확인 필요")}</td>
    <td>${esc(metaAdsObjectiveLabel(row))}</td>
    <td>${apiWon(row.spend)}</td>
    <td>${apiNum(row.purchases)}</td>
    <td>${apiWon(row.purchaseValue)}</td>
    <td>${row.roas === null ? "-" : multiple(row.roas)}</td>
    <td>${score === null ? "-" : `${score}점`}</td>
    <td>${metaAdsDecisionCellHtml(row, weights)}</td>
    <td class="ad-detail-col">${pct(Number(row.ctr || 0) * 100)}</td>
    <td class="ad-detail-col">${apiWon(row.cpc)}</td>
    <td class="ad-detail-col">${apiWon(row.cpm)}</td>
    <td class="ad-detail-col">${Number(row.frequency || 0).toFixed(1)}</td>
    <td class="ad-detail-col">${apiNum(row.landingPageViews)}</td>
    <td class="ad-detail-col">${apiNum(row.profileVisits)}</td>
    <td class="ad-detail-col">${pct(Number(row.conversionRate || 0) * 100)}</td>
    <td class="ad-detail-col">${hasApiValue(row.cpa) ? apiWon(row.cpa) : "-"}</td>
    <td class="ad-detail-col">${row.executionStart && row.executionEnd ? `${esc(row.executionStart)} ~ ${esc(row.executionEnd)}` : "-"}</td>
  </tr>`;
}

function renderMetaAdsFullReportGroups(fullReport = {}, weights = {}, targets = {}) {
  const groups = { active: [], other: [] };
  if (!fullReport.error) {
    (fullReport.rows || []).forEach((row) => {
      groups[metaAdsStatusGroup(row)].push(row);
    });
  }
  Object.values(groups).forEach((rows) => {
    rows.sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0));
  });

  const emptyRow = (label) => `<tr><td colspan="18">${esc(label)}</td></tr>`;
  if (targets.active) {
    targets.active.innerHTML = fullReport.error
      ? emptyRow(fullReport.error)
      : groups.active.length ? groups.active.map((row) => metaAdsFullReportRowHtml(row, weights)).join("") : emptyRow("이 기간에 집행된 캠페인이 없습니다.");
  }
  if (targets.other) {
    targets.other.innerHTML = fullReport.error ? "" : groups.other.length ? groups.other.map((row) => metaAdsFullReportRowHtml(row, weights)).join("") : emptyRow("미집행 캠페인이 없습니다.");
  }

  const otherHeader = $("#adGroupOtherHeader");
  if (otherHeader) otherHeader.textContent = `미집행 캠페인 (${groups.other.length})`;
}

// 상세 보기 토글은 DOM이 다시 그려져도 유지되도록 document 레벨에서 한 번만 바인딩합니다
// (event delegation). 진행중/종료·보관·초안 표 2개 모두에 동시에 적용됩니다.
let adFullReportTogglesBound = false;
function bindAdFullReportToggles() {
  if (adFullReportTogglesBound) return;
  adFullReportTogglesBound = true;
  document.addEventListener("click", (event) => {
    const detailBtn = event.target.closest("#adDetailToggleBtn");
    if (!detailBtn) return;
    const wraps = $$(".ad-full-report-wrap");
    if (!wraps.length) return;
    const show = !wraps[0].classList.contains("show-detail");
    wraps.forEach((wrap) => wrap.classList.toggle("show-detail", show));
    detailBtn.textContent = show ? "기본만 보기" : "상세 보기";
  });
}

// 오늘 확인해야 할 우선순위: 중지 > 점검 > 관찰 > 유지 > 확대 순으로 급한 것부터,
// 같은 등급이면 광고비가 큰 캠페인(=금액이 걸린 위험이 큰 캠페인)을 먼저 보여줍니다.
const AD_DECISION_URGENCY = { 중지: 0, 점검: 1, 관찰: 2, 유지: 3, 확대: 4 };

// 매일 아침 3분 안에 볼 화면이라 카운트 집계 없이 "지금 확인할 3개"만 카드로 보여줍니다.
function renderAdAiBriefing(fullReport = {}, weights = {}, target) {
  if (!target) return;
  if (fullReport.error) {
    target.innerHTML = `<article class="action-item"><strong>브리핑 확인 불가</strong><p>${esc(fullReport.error)}</p></article>`;
    return;
  }
  const rows = (fullReport.rows || []).filter((row) => Number(row.spend || 0) > 0);
  const scored = rows.map((row) => {
    const score = metaAdsPerformanceScore(row, weights);
    const decision = metaAdsStarDecision(score);
    return { row, score, decision };
  });

  const priority = [...scored]
    .sort((left, right) => {
      const urgencyDiff = (AD_DECISION_URGENCY[left.decision.label] ?? 5) - (AD_DECISION_URGENCY[right.decision.label] ?? 5);
      if (urgencyDiff !== 0) return urgencyDiff;
      return Number(right.row.spend || 0) - Number(left.row.spend || 0);
    })
    .slice(0, 3);

  if (!priority.length) {
    target.innerHTML = `<p class="hint-text">이번 기간에 광고비가 집행된 캠페인이 없습니다.</p>`;
    return;
  }

  target.innerHTML = priority.map(({ row, decision }, index) => `
    <article class="ad-ai-briefing-card ${esc(decision.tone)}">
      <div class="ad-ai-briefing-head">
        <span class="ad-ai-briefing-rank">${index + 1}</span>
        <strong>${esc(decision.stars)} ${esc(metaAdsDecisionActionText(decision.label))}</strong>
      </div>
      <p class="ad-ai-briefing-name" title="${esc(row.campaignName || "-")}">${esc(row.campaignName || "-")}</p>
      <p class="ad-ai-briefing-narrative">${esc(metaAdsNarrative(row))}</p>
      <p class="ad-ai-briefing-metric">${esc(metaAdsKeyMetricLine(row))} · 광고비 ${apiWon(row.spend)}</p>
    </article>
  `).join("");
}

// Meta 계정 전체 합계(level=account)와 표에 실제로 보이는 캠페인 합계를 대조합니다.
// 차이가 있으면 삭제/보관되어 캠페인 목록에는 없지만 과거 집행 이력이 insights에는
// 남아있는 경우일 가능성이 큽니다(누락 캠페인 수로 표시).
// Meta 값과 Marketing Director 값이 다를 때 "왜 다른지"를 사람이 바로 이해하도록 원인을 추정합니다.
// 우선순위: 삭제/보관 캠페인(수치로 확인 가능) > 캐시 데이터 기준(source/cacheMode로 확인 가능) > 기간/Attribution(그 외 잔여 원인, 확정할 수 없어 가능성으로만 안내).
function metaAdsReconciliationDiffReason(fullReport = {}, unlistedCount) {
  if (unlistedCount > 0) {
    return `삭제되었거나 보관 처리된 캠페인 ${unlistedCount}개의 과거 광고비가 Meta 전체 합계에는 남아있어 발생한 차이입니다.`;
  }
  const source = fullReport.source || "";
  if (source.includes("_cached") || fullReport.cacheMode) {
    return "저장된 캐시 데이터 기준으로 계산되어 Meta의 실시간 값과 약간의 시간차가 있을 수 있습니다. 동기화 점검으로 최신화해보세요.";
  }
  return "집계 기간 경계 또는 Meta의 Attribution(전환 인정 기준) 차이로 인한 것일 수 있습니다.";
}

function metaAdsReconciliationCard(label, metaValue, mdValue, formatFn, tolerance, reasonText) {
  const ok = Math.abs(Number(metaValue || 0) - Number(mdValue || 0)) <= tolerance;
  return `<article class="action-item ad-summary-card ad-core-kpi-card">
    <span>${esc(label)}</span>
    <strong>${ok ? "✔ 일치" : "⚠ 차이 발생"}</strong>
    <p>Meta Total ${esc(formatFn(metaValue))} · Marketing Director Total ${esc(formatFn(mdValue))}</p>
    ${ok ? "" : `<p>${esc(reasonText)}</p>`}
  </article>`;
}

function renderMetaAdsReconciliation(fullReport = {}, target) {
  if (!target) return;
  if (fullReport.error) {
    target.innerHTML = `<article class="action-item"><strong>검증 불가</strong><p>${esc(fullReport.error)}</p></article>`;
    return;
  }
  const r = fullReport.reconciliation || {};
  const mdSpend = Number(r.tableSpend || 0);
  const mdPurchaseValue = Number(r.tablePurchaseValue || 0);
  const mdRoas = mdSpend ? mdPurchaseValue / mdSpend : null;
  const metaRoas = hasApiValue(r.metaAccountRoas) ? Number(r.metaAccountRoas) : null;
  const unlistedCount = Number(r.unlistedCampaignCount || 0);
  const roasFormat = (value) => (value === null || value === undefined ? "-" : multiple(value));
  // 부동소수점 합산 순서 차이로 생기는 몇 원 단위 오차까지 "차이 발생"으로 잡지 않도록
  // 절대 오차(100원) 또는 Meta 합계의 0.5% 중 더 큰 값을 금액 허용 오차로 둡니다.
  // ROAS는 배율이라 금액과 같은 기준을 쓸 수 없어 0.05x를 허용 오차로 둡니다.
  const spendTolerance = Math.max(100, Math.abs(Number(r.metaAccountSpend || 0)) * 0.005);
  const purchaseValueTolerance = Math.max(100, Math.abs(Number(r.metaAccountPurchaseValue || 0)) * 0.005);
  const diffReason = metaAdsReconciliationDiffReason(fullReport, unlistedCount);
  target.innerHTML = [
    metaAdsReconciliationCard("총 광고비", r.metaAccountSpend, mdSpend, apiWon, spendTolerance, diffReason),
    metaAdsReconciliationCard("총 구매값", r.metaAccountPurchaseValue, mdPurchaseValue, apiWon, purchaseValueTolerance, diffReason),
    metaAdsReconciliationCard("총 ROAS", metaRoas, mdRoas, roasFormat, 0.05, diffReason),
    `<article class="action-item ad-summary-card ad-core-kpi-card">
      <span>누락 캠페인 수</span>
      <strong>${apiNum(unlistedCount)}</strong>
      <p>${unlistedCount ? `삭제/보관 캠페인 광고비 ${apiWon(r.unlistedSpend)} 별도 집계` : "전체 캠페인이 표에 반영됨"}</p>
    </article>`
  ].join("");
}

function renderAdOrganicCards(adPosts, organicPosts) {
  const adReach = sum(adPosts, "reach");
  const organicReach = sum(organicPosts, "reach");
  const adClicks = sum(adPosts, "websiteClicks");
  const organicClicks = sum(organicPosts, "websiteClicks");
  return [
    `<article class="action-item"><strong>광고 집행 콘텐츠</strong><span>${apiNum(adPosts.length)}개</span><p>도달 ${apiNum(adReach)} · 클릭 ${apiNum(adClicks)}</p></article>`,
    `<article class="action-item"><strong>유기 콘텐츠</strong><span>${apiNum(organicPosts.length)}개</span><p>도달 ${apiNum(organicReach)} · 클릭 ${apiNum(organicClicks)}</p></article>`
  ].join("");
}

async function renderCafe24Sales(data) {
  const target = $("#salesImpact");
  const detailTarget = $("#salesDetail");
  if (!target || !detailTarget) return;
  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const sales = await getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=500`, 8000);
  if (sales.error) {
    const state = salesConnectionState(sales.error);
    target.classList.add("cards");
    target.classList.remove("instagram-feed");
    target.innerHTML = [
      salesWarningCard(state),
      salesKpiCard("오늘(선택기간) 매출", "연결 필요", "Cafe24 연결 후 표시됩니다.", "is-disabled"),
      salesKpiCard("정상 주문", "-", "Cafe24 연결 후 표시됩니다.", "is-disabled"),
      salesKpiCard("제외 주문", "-", "Cafe24 연결 후 표시됩니다.", "is-disabled"),
      salesKpiCard("평균 객단가", "-", "Cafe24 연결 후 표시됩니다.", "is-disabled")
    ].join("");
    detailTarget.innerHTML = [
      salesPaymentCard([], 0),
      salesTopProductsCard([])
    ].join("");
    return;
  }
  const totals = sales.totals || {};
  const orders = sales.orders || sales.data || [];
  const topProducts = normalizeCafe24TopProducts(sales.topProducts, orders);
  const payments = normalizeCafe24PaymentMethods(sales.paymentMethods, orders);
  const source = cafe24SourceLabel(sales);
  target.classList.add("cards");
  target.classList.remove("instagram-feed");
  target.innerHTML = [
    salesKpiCard("오늘(선택기간) 매출", apiWon(totals.orderAmount), `${source} · ${sales.startDate || startDate} ~ ${sales.endDate || endDate}`),
    salesKpiCard("정상 주문", `${apiNum(totals.orderCount)}건`, "취소/환불 주문 제외"),
    salesKpiCard("제외 주문", `${apiNum(totals.excludedOrderCount)}건`, "취소/환불로 매출 집계에서 제외"),
    salesKpiCard("평균 객단가", apiWon(totals.averageOrderAmount), "Cafe24 실제 결제 기준")
  ].join("");
  detailTarget.innerHTML = [
    salesPaymentCard(payments, Number(totals.orderAmount || 0)),
    salesTopProductsCard(topProducts)
  ].join("");
}

function salesConnectionState(error) {
  const raw = String(error || "Cafe24 연결 상태를 확인할 수 없습니다.");
  const lowered = raw.toLowerCase();
  if (lowered.includes("refresh_token") || lowered.includes("invalid_token") || lowered.includes("access_token")) {
    return {
      title: "Cafe24 연결이 만료되었습니다.",
      note: "다시 인증하면 Sales 데이터가 자동 복구됩니다.",
      detail: raw
    };
  }
  return {
    title: "Cafe24 데이터를 불러오지 못했습니다.",
    note: "연결 상태를 확인한 뒤 다시 불러와 주세요.",
    detail: raw
  };
}

function salesWarningCard(state) {
  return `<article class="action-item urgent sales-warning-card">
    <span>연결 필요</span>
    <strong>${esc(state.title)}</strong>
    <p>${esc(state.note)}</p>
    <small>${esc(state.detail)}</small>
  </article>`;
}

function salesKpiCard(title, value, note, className = "") {
  return `<article class="action-item sales-kpi-card ${esc(className)}">
    <span>${esc(title)}</span>
    <strong>${esc(value)}</strong>
    <p>${esc(note)}</p>
  </article>`;
}

function salesPaymentCard(payments = [], totalAmount = 0) {
  const empty = !payments.length;
  return `<article class="action-item sales-list-card ${empty ? "sales-empty-card" : ""}">
    <span>결제수단</span>
    ${empty ? "" : `<strong>${esc(payments[0]?.paymentMethod || "-")}</strong>`}
    ${payments.length ? `<ul>${payments.slice(0, 5).map((item) => {
      const share = totalAmount ? `${Math.round((Number(item.orderAmount || 0) / totalAmount) * 100)}%` : `${apiNum(item.orderCount)}건`;
      return `<li>
        <div><b>${esc(item.paymentMethod || "미확인")}</b><small>${apiNum(item.orderCount)}건 · ${share}</small></div>
        <em>${apiWon(item.orderAmount)}</em>
      </li>`;
    }).join("")}</ul>` : `<p>데이터가 없습니다.</p>`}
  </article>`;
}

function salesTopProductsCard(products = []) {
  const empty = !products.length;
  return `<article class="action-item sales-list-card sales-products-card ${empty ? "sales-empty-card" : ""}">
    <span>TOP 상품</span>
    ${empty ? "" : `<strong>${esc(products[0]?.productName || "-")}</strong>`}
    ${products.length ? `<ol>${products.slice(0, 5).map((item, index) => (
      `<li>
        <mark>${index + 1}</mark>
        <div>
          <small>${esc(brandFromProduct(item.productName || ""))}</small>
          <b title="${esc(item.productName || "-")}">${esc(item.productName || "-")}</b>
          <p>판매수량 ${apiNum(item.quantity)}개</p>
        </div>
        <em>${apiWon(item.itemAmount)}</em>
      </li>`
    )).join("")}</ol>` : `<p>데이터가 없습니다.</p>`}
  </article>`;
}

function normalizeCafe24PaymentMethods(paymentMethods = [], orders = []) {
  const normalized = paymentMethods
    .map((item) => ({
      paymentMethod: item.paymentMethod || item.payment_method_name || item.payment_method || item.name || "미확인",
      orderCount: Number(item.orderCount || item.order_count || item.count || 0),
      orderAmount: Number(item.orderAmount || item.order_amount || item.amount || 0)
    }))
    .filter((item) => item.paymentMethod && item.paymentMethod !== "-");
  if (normalized.length) return normalized;
  const map = new Map();
  for (const order of orders) {
    const method = cafe24PaymentMethodName(order);
    const current = map.get(method) || { paymentMethod: method, orderCount: 0, orderAmount: 0 };
    current.orderCount += 1;
    current.orderAmount += cafe24OrderDisplayAmount(order);
    map.set(method, current);
  }
  return [...map.values()].sort((left, right) => right.orderAmount - left.orderAmount);
}

function normalizeCafe24TopProducts(topProducts = [], orders = []) {
  const normalized = topProducts
    .map((item) => ({
      productName: item.productName || item.product_name || item.item_name || item.name || "",
      quantity: Number(item.quantity || item.qty || item.product_quantity || 0),
      itemAmount: Number(item.itemAmount || item.item_amount || item.orderAmount || item.amount || 0)
    }))
    .filter((item) => item.productName && item.productName !== "-");
  if (normalized.length) return normalized;
  const map = new Map();
  for (const order of orders) {
    for (const item of cafe24OrderDisplayItems(order)) {
      const productName = item.product_name || item.productName || item.product_name_default || item.item_name || item.name || "";
      if (!productName) continue;
      const quantity = cafe24ItemDisplayQuantity(item);
      const current = map.get(productName) || { productName, quantity: 0, itemAmount: 0 };
      current.quantity += quantity;
      current.itemAmount += cafe24ItemDisplayAmount(item, quantity);
      map.set(productName, current);
    }
  }
  return [...map.values()].sort((left, right) => right.itemAmount - left.itemAmount);
}

function cafe24PaymentMethodName(order = {}) {
  const raw = order.payment_method_name || order.payment_method || order.payment_methods?.[0]?.payment_method || "미확인";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((value) => String(value || "").trim()).filter(Boolean).join(" + ") || "미확인";
}

function cafe24OrderDisplayAmount(order = {}) {
  return cafe24MoneyValue(order.actual_order_amount?.payment_amount)
    || cafe24MoneyValue(order.actual_payment_amount)
    || cafe24MoneyValue(order.payment_amount)
    || cafe24MoneyValue(order.actual_order_amount?.order_price_amount)
    || cafe24MoneyValue(order.order_price_amount)
    || cafe24MoneyValue(order.initial_order_amount?.payment_amount)
    || cafe24MoneyValue(order.initial_order_amount?.order_price_amount)
    || cafe24MoneyValue(order.order_amount)
    || cafe24MoneyValue(order.total_price);
}

function cafe24OrderDisplayItems(order = {}) {
  for (const candidate of [order.items, order.order_items, order.products, order.order_item]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function cafe24ItemDisplayQuantity(item = {}) {
  const quantity = Number(item.quantity || item.qty || item.product_quantity || item.order_quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function cafe24ItemDisplayAmount(item = {}, quantity = 1) {
  const amount = cafe24MoneyValue(item.actual_payment_amount)
    || cafe24MoneyValue(item.order_price_amount)
    || cafe24MoneyValue(item.product_price)
    || cafe24MoneyValue(item.price)
    || cafe24MoneyValue(item.sale_price)
    || cafe24MoneyValue(item.supply_price);
  return amount * quantity;
}

async function renderAdComparison(data) {
  const healthTarget = $("#salesHealthBanner");
  const metaTarget = $("#salesMetaEstimate");
  const varianceTarget = $("#salesVariance");
  const actionTarget = $("#salesAction");
  if (!healthTarget || !metaTarget || !varianceTarget || !actionTarget) return;
  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const [meta, cafe] = await Promise.all([
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=500`, 8000)
  ]);
  const metaTotals = meta.totals || {};
  const cafeTotals = cafe.totals || {};
  const metaPurchaseValue = hasApiValue(metaTotals.purchaseValue) ? Number(metaTotals.purchaseValue) : null;
  const cafeOrderAmount = hasApiValue(cafeTotals.orderAmount) ? Number(cafeTotals.orderAmount) : null;
  const unmatchedValue = meta.error || cafe.error || metaPurchaseValue === null || cafeOrderAmount === null ? null : Math.max(0, metaPurchaseValue - cafeOrderAmount);
  const mismatchRate = (!meta.error && !cafe.error && metaPurchaseValue !== null && cafeOrderAmount !== null && cafeOrderAmount > 0)
    ? Math.abs(metaPurchaseValue - cafeOrderAmount) / cafeOrderAmount * 100
    : null;

  const decision = salesDecisionState({ meta, cafe, mismatchRate });

  healthTarget.className = `ad-status-banner ${esc(decision.tone)}`;
  healthTarget.innerHTML = `<span class="status-dot"></span><strong>Sales Health · ${esc(decision.label)}</strong><span class="note">${esc(decision.reason)}</span>`;

  metaTarget.innerHTML = salesCompareCard("Meta 구매값", meta.error ? "확인 필요" : apiWon(metaTotals.purchaseValue), `${meta.error || meta.source || "Meta Ads"} · 캠페인 ${apiNum((meta.campaigns || meta.rows || []).length)}개`, { status: Boolean(meta.error), badge: cardBadge("meta", meta, hasApiValue(metaTotals.purchaseValue)) });

  varianceTarget.innerHTML = [
    salesCompareCard("차이", unmatchedValue === null ? "확인 필요" : apiWon(unmatchedValue), "Meta 구매값 - Cafe24 실제매출", { status: unmatchedValue === null, badge: unmatchedValue === null ? { label: "데이터 없음", tone: "muted" } : { label: "계산값", tone: "neutral" } }),
    salesCompareCard("오차율", mismatchRate === null ? "확인 필요" : `${mismatchRate < 1 ? mismatchRate.toFixed(1) : Math.round(mismatchRate)}%`, "Cafe24 실제매출 대비 Meta 구매값 오차", { status: mismatchRate === null, tone: decision.tone === "error" ? "urgent" : decision.tone === "warn" ? "warn" : "" }),
    salesCompareCard("주의사항", "상품 단위 비교 아님", "현재 Meta 데이터는 캠페인 단위이므로 상품별 구매 분석으로 해석하지 않습니다.", { status: true })
  ].join("");

  actionTarget.innerHTML = salesActionCard(decision);
}

// ============================================================================
// Product Dashboard v1 — Cafe24 Orders + Products 기반 상품 의사결정 Dashboard.
// 상품별 ROAS는 만들지 않고, Meta 광고비/ROAS는 기간 전체 참고치로만 표시한다.
// mall.read_product 스코프가 없으면 서버가 insufficient_scope를 반환하며,
// 이 경우 고정 문구 배너만 보여주고 나머지 카드/테이블은 비활성 처리한다.
// ============================================================================
const PRODUCT_SCOPE_BANNER_TEXT = "Cafe24 상품 데이터 접근 권한이 부족합니다. Cafe24 개발자센터에서 mall.read_product 스코프를 추가한 뒤 OAuth 재인증을 진행해주세요.";

async function renderProductDashboard(data) {
  const bannerTarget = $("#productDashboardBanner");
  const metaRefTarget = $("#productDashboardMetaRef");
  const rowsTarget = $("#productDashboardRows");
  if (!bannerTarget || !metaRefTarget || !rowsTarget) return;
  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const result = await getJson(`/api/products/dashboard?since=${startDate}&until=${endDate}`, 15000);

  if (result.error) {
    bannerTarget.className = "ad-status-banner error";
    bannerTarget.innerHTML = `<span class="status-dot"></span><strong>상품 Dashboard 오류</strong><span class="note">${esc(result.error)}</span>`;
    metaRefTarget.innerHTML = "";
    rowsTarget.innerHTML = `<tr><td colspan="7">상품 데이터를 불러오지 못했습니다.</td></tr>`;
    return;
  }

  if (result.ok === false && result.reason === "insufficient_scope") {
    bannerTarget.className = "ad-status-banner error";
    bannerTarget.innerHTML = `<span class="status-dot"></span><strong>권한 부족</strong><span class="note">${esc(PRODUCT_SCOPE_BANNER_TEXT)}</span>`;
    metaRefTarget.innerHTML = "";
    rowsTarget.innerHTML = `<tr><td colspan="7">mall.read_product 스코프 추가 후 재인증하면 이 표가 채워집니다.</td></tr>`;
    return;
  }

  const products = result.products || [];
  const metaRef = result.metaReference || {};
  const syncNote = result.catalogSyncedAt ? `상품 데이터 동기화 ${esc(formatRelativeMinutes(result.catalogSyncedAt))}` : "상품 데이터 동기화 시각 확인 불가";
  bannerTarget.className = "ad-status-banner good";
  bannerTarget.innerHTML = `<span class="status-dot"></span><strong>상품 Dashboard 정상</strong><span class="note">${syncNote} · 상품 ${apiNum(products.length)}개${result.unmatched?.count ? ` · 미매칭 주문항목 ${apiNum(result.unmatched.count)}건` : ""}</span>`;

  metaRefTarget.innerHTML = [
    salesCompareCard("Meta 광고비 (기간 참고치)", metaRef.error ? "확인 필요" : apiWon(metaRef.spend), "상품별 배분값 아님 · 기간 전체 합계", { status: Boolean(metaRef.error) }),
    salesCompareCard("Meta ROAS (기간 참고치)", metaRef.error || metaRef.roas === null ? "확인 필요" : `${multiple(metaRef.roas)}`, "상품별 ROAS는 v1에서 만들지 않습니다.", { status: Boolean(metaRef.error) })
  ].join("");

  if (products.length === 0) {
    rowsTarget.innerHTML = `<tr><td colspan="7">표시할 상품이 없습니다.</td></tr>`;
    return;
  }

  rowsTarget.innerHTML = [...products]
    .sort((a, b) => Number(b.salesAmount || 0) - Number(a.salesAmount || 0))
    .map(productDashboardRowHtml)
    .join("");
}

function productDashboardRowHtml(row) {
  const actionClass = { Push: "good", Observe: "", Hold: "warn", Stop: "urgent" }[row.aiAction] || "";
  return `<tr>
    <td>${esc(row.productName)}<div class="hint-text">${esc(row.productCode || "")}</div></td>
    <td>${apiNum(row.inventoryQuantity)}${row.soldOut ? ' <span class="badge urgent">품절</span>' : ""}</td>
    <td>${row.daysOfStockLeft === null || row.daysOfStockLeft === undefined ? "-" : `${apiNum(row.daysOfStockLeft)}일`}</td>
    <td>${apiNum(row.quantitySold)}</td>
    <td>${apiWon(row.salesAmount)}</td>
    <td>${Number(row.salesVelocityPerDay || 0).toFixed(2)}개</td>
    <td><span class="badge ${actionClass}">${esc(row.aiAction)}</span><div class="hint-text">${esc(row.aiActionReason || "")}</div></td>
  </tr>`;
}

function formatRelativeMinutes(isoTime) {
  const then = new Date(isoTime).getTime();
  if (!Number.isFinite(then)) return "확인 불가";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

// ============================================================================
// Settings 탭 — Cafe24 상품 API 진단 위젯. 로컬 서버 자체 진단
// (/api/diagnostics/cafe24-product-access)을 호출해 dashboardReady를 보여준다.
// 이 위젯은 로컬 8787의 Cafe24 토큰 상태를 반영하며, Render 배포본의 진단
// (/api/diagnostics/cafe24-product-check)과는 별개다.
// ============================================================================
async function renderCafe24ProductDiagnostics() {
  const target = $("#cafe24ProductDiagnostics");
  if (!target) return;
  target.innerHTML = `<article class="action-item"><strong>Cafe24 상품 API 진단 확인 중</strong><p>로컬 서버 기준으로 확인하고 있습니다.</p></article>`;
  const result = await getJson("/api/diagnostics/cafe24-product-access", 15000);
  const ready = result.dashboardReady || {};
  const keys = Object.keys(ready);
  if (keys.length === 0) {
    target.innerHTML = `<article class="action-item"><strong>진단 결과 없음</strong><p>${esc(result.message || "진단 API 응답을 확인할 수 없습니다.")}</p></article>`;
    return;
  }
  target.innerHTML = `<div class="cafe24-diagnostics-grid">${keys.map((key) => (
    `<article class="action-item"><strong>${ready[key]} ${esc(key)}</strong></article>`
  )).join("")}</div>
  <p class="hint-text">이 결과는 로컬 8787 서버 기준입니다. mall.read_product 스코프 추가 후 재인증했다면, Render 배포본(samplas-marketing-os.onrender.com/api/diagnostics/cafe24-product-check)도 함께 확인해보세요.</p>`;
}

function salesDecisionState({ meta, cafe, mismatchRate }) {
  if (cafe.error) {
    const state = bannerState(cafe, "cafe24");
    return { tone: state.tone === "error" ? "error" : state.tone, label: state.label, reason: state.reason || "Cafe24 데이터를 불러오지 못했습니다.", action: state.action || "Cafe24 연결을 확인하세요." };
  }
  if (meta.error) {
    const state = bannerState(meta, "meta");
    return { tone: state.tone === "error" ? "error" : state.tone, label: state.label, reason: state.reason || "Meta 데이터를 불러오지 못했습니다.", action: state.action || "Meta Ads 연결을 확인하세요." };
  }
  if (mismatchRate === null) {
    return { tone: "warn", label: "판단 보류", reason: "비교할 매출 데이터가 아직 부족합니다.", action: "이번 달 주문이 쌓이면 다시 확인하세요." };
  }
  const rounded = mismatchRate < 1 ? mismatchRate.toFixed(1) : Math.round(mismatchRate);
  if (mismatchRate <= 10) {
    return { tone: "good", label: "정상", reason: `Meta와 Cafe24 오차 ${rounded}%`, action: "Meta 데이터를 참고해도 됩니다." };
  }
  if (mismatchRate <= 25) {
    return { tone: "warn", label: "주의", reason: `Meta와 Cafe24 오차 ${rounded}%`, action: "광고 기여 기간 차이를 먼저 확인하세요." };
  }
  return { tone: "error", label: "주의", reason: `Meta와 Cafe24 오차 ${rounded}%`, action: "광고 귀속 또는 API 상태를 점검하세요." };
}

function salesActionCard(decision) {
  const tone = decision.tone === "error" ? "urgent" : decision.tone === "warn" ? "warn" : "good";
  const icon = decision.tone === "error" ? "\u{1F534}" : decision.tone === "warn" ? "\u{1F7E1}" : "\u{1F7E2}";
  return `<article class="action-item ${esc(tone)} sales-compare-card">
    <span>${icon} ${esc(decision.label)}</span>
    <strong>${esc(decision.reason)}</strong>
    <p>${esc(decision.action)}</p>
  </article>`;
}

function salesCompareCard(title, value, note, options = {}) {
  return `<article class="action-item sales-compare-card">
    ${dataBadgeHtml(options.badge)}
    <span>${esc(title)}</span>
    ${options.status ? `<b class="sales-status-badge ${esc(options.tone || "")}">${esc(value)}</b>` : `<strong>${esc(value)}</strong>`}
    <p>${esc(note)}</p>
  </article>`;
}

function cafe24SourceLabel(data = {}) {
  if (data.source === "csv_required") return "지난 월 CSV 업로드 필요";
  if (data.cacheMode === "fallback_after_error") return `저장된 Cafe24 데이터로 표시${data.cacheWarning ? ` · ${data.cacheWarning}` : ""}`;
  if (String(data.source || "").includes("csv")) return "Cafe24 CSV";
  if (String(data.source || "").includes("admin_api")) return "Cafe24 주문 API";
  if (String(data.source || "").includes("cached")) return "Cafe24 캐시";
  return data.source || "Cafe24";
}

async function renderStoryInsights() {
  storyData = await getJson("/api/instagram/stories", 6000);
  const stories = storyData.stories || [];
  const totals = storyData.totals || {};
  const replyRate = hasApiValue(totals.replyRate) ? totals.replyRate : 0;
  $("#storyStatus").innerHTML = [
    ["Stories", `${num(stories.length)}개`, storyData.source || "-"],
    ["Reach", num(totals.reach), storyData.cacheWarning || "스토리 인사이트 기준"],
    ["Engagement Rate", pct(replyRate), "답장 / 도달 기준"]
  ].map(([title, value, note]) => `<article class="action-item"><strong>${title}</strong><span>${value}</span><p>${esc(note)}</p></article>`).join("");
  $("#storyBoard").innerHTML = stories.slice(0, 12).map((story) => (
    `<article class="report-panel">
      <h4>${esc(story.date || "-")}</h4>
      <div class="report-metrics">
        <span>Reach <strong>${apiNum(story.reach)}</strong></span>
        <span>Views <strong>-</strong></span>
        <span>Likes <strong>-</strong></span>
        <span>Comments <strong>${apiNum(story.replies)}</strong></span>
        <span>Saves <strong>-</strong></span>
        <span>Shares <strong>-</strong></span>
        <span>Engagement Rate <strong>${pct(rate(story.replies, story.reach))}</strong></span>
      </div>
    </article>`
  )).join("") || `<div class="action-item">스토리 데이터가 없습니다.</div>`;
}

// loadMonths()가 데이터를 가져온 "그 순간"의 HTTP 응답 하나로만 성공/실패가 결정되고,
// 이후에는 아무 코드도 그 결과를 다시 검증하지 않는다(getJson()의 108행이 유일하게 .error를
// 세팅하는 지점). 그래서 화면을 이미 열어둔 상태에서 토큰이 재발급되는 등 원인이 해소돼도
// Overview는 새로고침 전까지 예전 실패 상태를 계속 보여준다. 현재 달에 한해 세션당 1회만
// 조용히 재확인해서, 실제로는 해결된 실패를 화면에 계속 남겨두지 않도록 한다.
// (2026-07-08 Instagram Data Sync stale-error 자동 복구)
const instagramRetriedMonths = new Set();

async function updateSync(data) {
  const instagramState = bannerState(data, "instagram");
  // 근본 원인: bannerState()는 data.error가 없어도(=API 자체는 정상) source에 "_cached"가
  // 붙어 있으면(서버가 온디스크 캐시를 서빙 중일 때 항상 이렇게 붙는다, server.mjs의
  // decorateCachedSource()) isLiveSource()가 live=false로 판정하고, cacheFreshnessTone()이
  // 캐시가 24시간(1440분) 넘게 오래됐으면 tone:"error"를 반환한다. sidebarBadgeFromState()는
  // 그 tone을 그대로 "실패"로 표시해왔다. 반면 renderApiHealthCenter/homeActivityCards의
  // instagramOk는 캐시 최신성을 전혀 보지 않고 오직 data.error 유무만 본다 — 그래서
  // renderApiHealthCenter는 "정상", Sidebar는 "실패"로 서로 어긋났다.
  // 수정: Sidebar도 renderApiHealthCenter와 동일하게 data.error 유무만으로 판정한다.
  // (2026-07-08 Sidebar/HealthCenter 판정 불일치 수정)
  const instagramSidebar = data.error
    ? {
        tone: "error",
        badge: instagramState.label === "토큰 만료" || instagramState.label === "권한 만료" ? "재인증 필요" : "실패"
      }
    : { tone: "good", badge: "정상" };
  console.log("sidebar", { bannerState: instagramState, instagramSidebar, dataError: data.error || null, dataSource: data.source });

  if (data.error && data.month === months[0] && !instagramRetriedMonths.has(data.month)) {
    instagramRetriedMonths.add(data.month);
    const fresh = await getJson(`/api/instagram/monthly?month=${data.month}`, 20000);
    if (!fresh.error) {
      const index = monthlyData.findIndex((item) => item.month === data.month);
      if (index !== -1) monthlyData[index] = fresh;
      if (selectedMonth().month === data.month) {
        renderAll();
        return;
      }
    }
  }
  setSyncRow("instagramSyncRow", instagramSidebar.tone, "Instagram", instagramSidebar.badge);

  const meta = await getJson(`/api/meta-ads/summary?since=${data.month}-01&until=${monthEnd(data.month)}`, 5000);
  const metaSidebar = sidebarBadgeFromState(bannerState(meta, "meta"));
  setSyncRow("metaAdsSyncRow", metaSidebar.tone, "Meta Ads", metaSidebar.badge);

  const cafeStatus = await getCafe24Status(`${data.month}-01`, monthEnd(data.month));
  const cafeReauth = /refresh_token|재인증/i.test(String(cafeStatus.detail || ""));
  const cafeSidebar = cafeStatus.ok ? { tone: "good", badge: "정상" } : { tone: "error", badge: cafeReauth ? "재인증 필요" : "실패" };
  setSyncRow("cafe24SyncRow", cafeSidebar.tone, "Cafe24", cafeSidebar.badge);
  // Sidebar에도 재인증 버튼을 노출한다(요청: Sidebar Cafe24 상태 배지 또는 관련 영역에서
  // 재인증 시작 URL로 이동 가능해야 함). 버튼 자체는 HTML에 이미 있었지만 항상 숨겨져 있었고
  // 클릭해도 toast만 띄우고 실제로는 아무 데도 이동하지 않았다 — 여기서 조건부로 보이게 하고,
  // 클릭 동작은 bind()에서 /api/cafe24/oauth/start로 실제 이동하도록 고쳤다.
  // (2026-07-08 Cafe24 재인증 흐름 개선)
  const fixBtn = $("#syncFixBtn");
  if (fixBtn) {
    fixBtn.classList.toggle("hidden", !cafeReauth);
    if (cafeReauth) fixBtn.textContent = "Cafe24 재인증하기";
  }
}

function renderAll() {
  const data = selectedMonth();
  $("#dataModeBadge").textContent = sourceLabel(data);
  renderMonthRail(data);
  renderKpis(data);
  renderOverviewLiveData(data);
  renderMonthlyDashboard(data);
  renderContentTabs();
  renderContentTable(data.posts || []);
  renderEditorialAi(data);
  renderGrowthChart();
  renderOtherSections(data);
  updateSync(data);
}

// options.forceRefresh (2026-07-08 Instagram 자동 동기화 기능 추가): "지금 동기화"
// 버튼은 캐시를 다시 읽는 것만으로는 새 게시물을 반영할 수 없었다 — 서버의
// buildInstagramMonthlyDataWithCache()는 기본적으로 캐시 우선이라 이 함수가
// refresh=1을 보내지 않으면 항상 같은 on-disk 캐시만 돌려줬다. forceRefresh가 true면
// 실제 API를 다시 호출해야 하는 이번 달(months[0])에 한해 refresh=1을 붙인다.
// 지난 달들은 서버가 어차피 CSV/저장 캐시 전용으로 처리하므로 붙이지 않는다.
async function loadMonths(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  monthlyData = [];
  for (const month of months) {
    const refreshQuery = forceRefresh && month === months[0] ? "&refresh=1" : "";
    const data = await getJson(`/api/instagram/monthly?month=${month}${refreshQuery}`, 20000);
    monthlyData.push(data.error ? errorMonth(month, data.error) : data);
  }
  monthlyData.sort((a, b) => b.month.localeCompare(a.month));
  renderMonthSelect();
  renderAll();
}

function bind() {
  $("#refreshBtn")?.addEventListener("click", async () => {
    toast("Instagram 최신 게시물을 실제 API에서 다시 가져옵니다.");
    await loadMonths({ forceRefresh: true });
    await renderStoryInsights();
  });
  $("#refreshStoriesBtn")?.addEventListener("click", renderStoryInsights);
  // 같은 탭에서 이동한다 — Cafe24 로그인/동의 후 서버가 "/"로 리다이렉트하므로 그대로
  // 이 탭으로 돌아온다. (2026-07-08 Cafe24 재인증 흐름 개선)
  $("#syncFixBtn")?.addEventListener("click", () => {
    window.location.href = "/api/cafe24/oauth/start";
  });
  $("#healthRefreshBtn")?.addEventListener("click", () => {
    toast("연동 상태를 다시 확인합니다.");
    renderApiHealthCenter(selectedMonth());
  });
  $("#todayBriefReset")?.addEventListener("click", () => {
    localStorage.removeItem(todayStorageKey());
    renderTodayBriefing();
    toast("오늘 업무 상태를 초기화했습니다.");
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-brief-status]");
    if (!button) return;
    const id = button.dataset.briefStatus;
    const state = readTodayBriefingState();
    const current = state[id]?.status || "todo";
    const next = nextTodayStatus(current);
    state[id] = {
      status: next,
      doneAt: next === "done" ? new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""
    };
    writeTodayBriefingState(state);
    renderTodayBriefing();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump-view]");
    if (!button) return;
    document.querySelector(`[data-view="${button.dataset.jumpView}"]`)?.click();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-key]");
    if (!button) return;
    const url = button.dataset.projectUrl || projectLinkFor(button.dataset.projectKey);
    if (!url) {
      toast("프로젝트 경로가 아직 설정되지 않았습니다. samplas.projectLinks 설정값에 연결할 수 있습니다.");
      return;
    }
    window.open(url, "_blank", "noopener");
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-health-action]");
    if (!button) return;
    if (button.dataset.healthAction === "refresh") {
      toast("연동 상태를 다시 확인합니다.");
      renderApiHealthCenter(selectedMonth());
    }
  });
  $$("[data-content-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeContentTab = button.dataset.contentTab || "All";
      renderContentTabs();
    });
  });
  $$("[data-ad-level]").forEach((button) => {
    button.addEventListener("click", () => {
      activeAdLevel = button.dataset.adLevel || "campaign";
      const current = monthlyData.find((item) => item.month === $("#monthSelect")?.value) || monthlyData[0];
      if (current) renderAdvertising(current);
    });
  });
}

// server.mjs의 /api/cafe24/oauth/callback은 성공/실패 모두 "/"로 리다이렉트하며
// 결과를 쿼리스트링으로만 전달한다(토큰 값은 절대 URL에 담지 않는다 — 실패 시 reason은
// safeErrorMessage()로 이미 마스킹된 짧은 사유 문구뿐). 여기서 그 쿼리스트링을 읽어
// toast + Settings 오류 배너로 안내하고, 새로고침 시 같은 메시지가 반복 표시되지 않도록
// 주소창에서 즉시 제거한다. (2026-07-08 Cafe24 재인증 흐름 개선)
function handleCafe24OAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("cafe24_oauth");
  if (!result) return;
  const reason = params.get("reason") || "";
  window.history.replaceState(null, "", window.location.pathname);
  if (result === "success") {
    toast("Cafe24 재인증이 완료되었습니다. 동기화 상태를 확인합니다.");
    cafe24OAuthErrorReason = null;
  } else if (result === "error") {
    toast("Cafe24 재인증에 실패했습니다. Settings에서 자세한 내용을 확인하세요.");
    cafe24OAuthErrorReason = reason || "원인을 확인할 수 없습니다.";
  }
}

renderNav();
bind();
handleCafe24OAuthRedirect();
loadMonths();
renderStoryInsights();
