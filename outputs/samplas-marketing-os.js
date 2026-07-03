const navItems = [
  "Overview",
  "Content",
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

const nf = new Intl.NumberFormat("ko-KR");
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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

function setSyncRow(id, ok, label, detail, status = "정상") {
  const row = $(`#${id}`);
  if (!row) return;
  const isError = ok === false || ["오류", "권한 차단", "토큰 만료"].includes(status);
  row.classList.toggle("good", ok === true && !isError && status !== "캐시");
  row.classList.toggle("warn", ok === true && status === "캐시");
  row.classList.toggle("error", isError);
  row.classList.remove("loading");
  const badge = isError ? status : status === "CSV" ? "CSV" : status === "캐시" ? "캐시" : "100%";
  row.innerHTML = `<span></span><strong>${esc(label)}</strong><small title="${esc(detail)}">${esc(detail)}</small><em>${badge}</em>`;
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
  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    $$(".nav button").forEach((node) => node.classList.toggle("active", node === button));
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
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

function renderMonthRail(data) {
  const rail = $("#monthRail");
  rail.innerHTML = monthlyData.map((item) => (
    `<button class="month-pill ${item.month === data.month ? "active" : ""}" type="button" data-month="${item.month}">
      ${item.month}<span>${sourceLabel(item)}</span>
    </button>`
  )).join("");
  rail.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      $("#monthSelect").value = button.dataset.month;
      renderAll();
    });
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
    ["Followers", apiNum(a.followers), `@${a.username || data.accountIdentity?.username || "samplaskr"}`],
    ["Reach", apiNum(a.reach), instagramErrors.account || "Instagram 기준"],
    ["Views", apiNum(a.views), instagramErrors.account || "Instagram 기준"],
    ["Profile Visit", apiNum(a.profileVisits), instagramErrors.account || "Instagram 기준"],
    ["Website Click", apiNum(a.websiteClicks), instagramErrors.account || "Instagram 기준"],
    ["게시물 수", `${apiNum(postCount)}개`, "선택 월 콘텐츠"],
    ["광고비", "확인 중", "Meta Ads 확인 중"],
    ["Cafe24 실제 매출", "확인 중", "Cafe24 확인 중"],
    ["ROAS", "확인 중", "Meta 기준"]
  ];
  $("#kpiGrid").innerHTML = items.map(([label, value, delta]) => (
    `<article class="kpi"><span>${label}</span><strong>${value}</strong><p class="delta">${delta}</p></article>`
  )).join("");
}

async function renderOverviewLiveData(data) {
  const target = $("#overviewLiveData");
  if (!target) return;
  target.innerHTML = `<article class="action-item"><strong>이번 달 변화 확인 중</strong><p>전월 대비 증감 신호를 확인합니다.</p></article>`;
  $("#actions").innerHTML = `<article class="action-item"><strong>Action Center 확인 중</strong><p>오늘 확인할 일을 정리합니다.</p></article>`;
  $("#insightList").innerHTML = `<article class="action-item"><strong>이번 달 인사이트 확인 중</strong><p>성과 변화와 판매 신호를 정리합니다.</p></article>`;
  $("#nextActions").innerHTML = `<article class="action-item"><strong>다음 추천 행동 확인 중</strong><p>이번 주 실행할 일을 정리합니다.</p></article>`;

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const [status, meta, cafe] = await Promise.all([
    getJson("/api/status", 6000),
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=500`, 7000)
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

  $("#kpiGrid").innerHTML = [
    ["Followers", apiNum(a.followers), `@${a.username || data.accountIdentity?.username || "samplaskr"}`],
    ["Reach", apiNum(a.reach), "Instagram"],
    ["Views", apiNum(a.views), "Instagram"],
    ["Profile Visit", apiNum(a.profileVisits), "Instagram"],
    ["Website Click", apiNum(a.websiteClicks), "Instagram"],
    ["게시물 수", `${apiNum(postCount)}개`, data.postsScope === "recent_media_fallback" ? "최근 미디어 기준" : "선택 월 기준"],
    ["광고비", meta.error ? "확인 필요" : apiWon(metaTotals.spend), "Meta Ads"],
    ["Cafe24 실제 매출", cafe.error ? "확인 필요" : apiWon(cafeTotals.orderAmount), "Cafe24"],
    ["ROAS", roas === null ? "-" : multiple(roas), "Meta 기준 추정 구매값 / 광고비"]
  ].map(([label, value, delta]) => (
    `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><p class="delta">${esc(delta)}</p></article>`
  )).join("");

  target.innerHTML = [
    changeCard("Reach", a.reachDelta),
    changeCard("Views", a.viewsDelta),
    changeCard("Profile Visit", a.profileVisitDelta),
    changeCard("Website Click", a.websiteClickDelta)
  ].filter(Boolean).join("") || `<article class="action-item"><strong>이번 달 변화</strong><p>전월 대비 증감 데이터가 아직 없습니다. 월간 확정 데이터가 쌓이면 변화가 표시됩니다.</p></article>`;

  const actions = buildOverviewActions({ data, meta, cafe, account: a, topSaved, roas });
  $("#actions").innerHTML = actions.map((item) => actionCard(item)).join("");

  $("#insightList").innerHTML = [
    insightCard("Reach", Number(a.reachDelta) < 0 ? `이번 달 Reach는 전월보다 ${pct(Math.abs(Number(a.reachDelta)))} 감소했습니다.` : Number(a.reachDelta) > 0 ? `이번 달 Reach는 전월보다 ${pct(Number(a.reachDelta))} 증가했습니다.` : "이번 달 Reach 변화 데이터가 아직 없습니다.", Number(a.reachDelta) < 0 ? "warn" : "good"),
    insightCard("저장률", topSaved ? `저장률이 가장 높은 콘텐츠는 "${topSaved.title || "Untitled"}"입니다. 평균 저장률은 ${pct(avgSaveRate)}입니다.` : "저장률을 판단할 콘텐츠 데이터가 아직 부족합니다.", topSaved ? "good" : "warn"),
    insightCard("광고 효율", roas === null ? "광고 효율을 판단할 구매값이 아직 없습니다." : `이번 달 ROAS는 ${multiple(roas)}입니다. 광고비 대비 구매 신호를 유지하고 있습니다.`, roas !== null && roas >= 2 ? "good" : "warn"),
    insightCard("판매 상품", topProduct ? `이번 달 가장 많이 판매된 상품은 "${topProduct.productName}"입니다.` : "이번 달 판매 상품 데이터가 아직 없습니다.", topProduct ? "good" : "warn")
  ].join("");

  $("#nextActions").innerHTML = buildNextActions({ account: a, topSaved, topCampaign, roas }).map((item) => actionCard(item)).join("");
}

function buildOverviewActions({ data, meta, cafe, account, topSaved, roas }) {
  const urgent = [
    meta.error ? { level: "urgent", label: "긴급", title: "광고 연결 확인 필요", text: "광고 성과를 불러오지 못했습니다. Settings에서 연결 상태를 확인하세요." } : null,
    cafe.error ? { level: "urgent", label: "긴급", title: "주문 데이터 확인 필요", text: "실제 매출을 불러오지 못했습니다. Sales에서 상태를 확인하세요." } : null,
    data.error ? { level: "urgent", label: "긴급", title: "인스타그램 데이터 확인 필요", text: "콘텐츠와 계정 성과를 불러오지 못했습니다." } : null
  ].filter(Boolean);
  const watch = [
    Number(account.reachDelta) < 0 ? { level: "warn", label: "확인", title: "Reach 감소", text: `Reach가 ${pct(Math.abs(Number(account.reachDelta)))} 감소했습니다. 도달 TOP 콘텐츠를 확인하세요.` } : null,
    roas !== null && roas < 1 ? { level: "warn", label: "확인", title: "광고 효율 확인", text: "광고비 대비 구매 신호가 약합니다. 캠페인별 성과를 확인하세요." } : null
  ].filter(Boolean);
  const good = [
    Number(account.followerDelta) > 0 ? { level: "good", label: "좋음", title: "팔로워 증가", text: `팔로워가 ${apiNum(account.followerDelta)}명 증가했습니다.` } : null,
    topSaved ? { level: "good", label: "좋음", title: "저장 반응 확인", text: `"${topSaved.title || "Untitled"}"의 저장률이 가장 좋습니다.` } : null,
    !urgent.length && !watch.length ? { level: "good", label: "좋음", title: "오늘 상태 정상", text: "큰 오류 없이 운영 데이터를 확인할 수 있습니다." } : null
  ].filter(Boolean);
  return [...urgent, ...watch, ...good].slice(0, 6);
}

function buildNextActions({ account, topSaved, topCampaign, roas }) {
  const items = [
    Number(account.reachDelta) < 0
      ? { level: "warn", label: "다음 행동", title: "릴스 업로드 늘리기", text: "Reach가 줄었습니다. 이번 주에는 릴스 업로드를 늘려 신규 도달을 회복하세요." }
      : null,
    topSaved
      ? { level: "good", label: "다음 행동", title: "저장률 높은 포맷 반복", text: `"${topSaved.title || "저장률 높은 콘텐츠"}"와 비슷한 카드뉴스를 2회 더 게시해보세요.` }
      : null,
    roas !== null && roas >= 2 && topCampaign
      ? { level: "good", label: "다음 행동", title: "효율 좋은 캠페인 확인", text: `"${topCampaign.campaignName || "성과 좋은 캠페인"}"의 예산 확대를 검토하세요.` }
      : null,
    roas !== null && roas < 1
      ? { level: "warn", label: "다음 행동", title: "광고 효율 점검", text: "구매 신호가 약한 캠페인은 소재나 예산을 조정하세요." }
      : null
  ].filter(Boolean);
  return (items.length ? items : [
    { level: "good", label: "다음 행동", title: "성과 좋은 콘텐츠 반복", text: "이번 주에는 저장 반응이 좋은 콘텐츠 포맷을 한 번 더 게시하세요." }
  ]).slice(0, 4);
}

function actionCard(item) {
  return `<article class="action-item ${esc(item.level)}"><span>${esc(item.label)}</span><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></article>`;
}

function insightCard(title, text, level = "good") {
  return `<article class="action-item ${esc(level)}"><strong>${esc(title)}</strong><p>${esc(text)}</p></article>`;
}

function changeCard(label, delta) {
  if (!hasApiValue(delta) || Number(delta) === 0) return "";
  const value = Number(delta);
  const direction = value > 0 ? "▲" : "▼";
  const level = value > 0 ? "good" : "warn";
  return `<article class="action-item ${level}"><strong>${esc(label)}</strong><span>${direction} ${pct(Math.abs(value))}</span><p>전월 대비</p></article>`;
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
  $("#contentRows").innerHTML = (posts || []).slice(0, 80).map((post) => {
    const metrics = postMetrics(post);
    return (
    `<tr>
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
    </tr>`
    );
  }).join("") || `<tr><td colspan="10">게시물별 데이터가 없습니다.</td></tr>`;
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

function feedCard(post, options = {}) {
  const m = postMetrics(post);
  const imageUrl = post.thumbnailUrl || post.mediaUrl || "";
  const mediaStyle = imageUrl ? ` style="background-image: linear-gradient(180deg, rgba(0,0,0,.12), rgba(0,0,0,.58)), url('${esc(imageUrl)}')"` : "";
  const stats = [
    ["Reach", apiNum(post.reach)],
    ["Views", apiNum(post.views)],
    ["Likes", apiNum(post.likes)],
    ["Comments", apiNum(post.comments)],
    ["Saves", apiNum(post.saves)],
    ["Shares", apiNum(post.shares)]
  ];
  return `<article class="feed-card">
    <a class="feed-media ${imageUrl ? "has-image" : ""}"${mediaStyle} href="${esc(post.permalink || "#")}" target="_blank" rel="noreferrer">
      <span class="feed-type">${esc(post.type || "POST")}</span>
      <strong>${esc(post.title || "Untitled")}</strong>
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
        ${miniMetric("팔로워", num(a.followers), `순증 +${num(a.followerDelta)}`)}
        ${miniMetric("도달", num(a.reach), `${pct(a.reachDelta)} 전월 대비`)}
        ${miniMetric("웹사이트 클릭", num(totalClicks), "구매 유입 후보")}
        ${miniMetric(totalSales ? "Cafe24 7일 매출" : "Meta 광고비", totalSales ? krw(totalSales) : krw(totalSpend), totalSales ? "실제 주문 기준" : "광고 캐시 기준")}
      </section>
    </div>

    <div class="signal-board">
      ${signalCard("콘텐츠 수", num(posts.length), "이번 달 분석 대상")}
      ${signalCard("좋아요", num(totalLikes), "반응 신호")}
      ${signalCard("댓글", num(totalComments), "대화 신호")}
      ${signalCard("저장 / 공유", `${num(totalSaves)} / ${num(totalShares)}`, "카드뉴스 핵심")}
    </div>

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
  $("#advertisingSummary").innerHTML = `<article class="action-item"><strong>Meta 광고 데이터 확인 중</strong><p>광고비, 도달, 클릭, 구매값, ROAS를 확인합니다.</p></article>`;
  $("#campaignPerformance").innerHTML = `<article class="action-item"><strong>캠페인 성과 확인 중</strong><p>Meta 캠페인 기준으로 불러옵니다.</p></article>`;
  $("#adOrganicContent").innerHTML = `<article class="action-item"><strong>광고 / 유기 콘텐츠 비교 확인 중</strong><p>콘텐츠의 광고 집행 여부를 기준으로 비교합니다.</p></article>`;
  renderAdvertising(data);
  $("#salesImpact").classList.add("cards");
  $("#salesImpact").classList.remove("instagram-feed");
  $("#salesImpact").innerHTML = `<article class="action-item"><strong>Cafe24 주문 데이터 확인 중</strong><p>CSV 또는 저장 캐시를 읽고 있습니다.</p></article>`;
  renderCafe24Sales(data);
  $("#adComparison").innerHTML = `<article class="action-item"><strong>Meta / Cafe24 비교 확인 중</strong><p>광고 구매값과 실제 주문 매출을 비교합니다.</p></article>`;
  renderAdComparison(data);
  $("#calendarGrid").innerHTML = ["Brand Discovery", "Product Focus", "Editorial Cardnews", "Event / Sale"].map((title, index) => (
    `<article class="action-item"><strong>${index + 1}주차</strong><span>${title}</span><p>상위 성과 콘텐츠 톤을 다음 달에 확장합니다.</p></article>`
  )).join("");
  $("#apiSetup").innerHTML = [
    ["Instagram", "1-6월은 CSV 고정 데이터, 현재 월은 API/캐시 확인"],
    ["Meta Ads", "API 차단 시 저장된 광고 캐시로 업무 지속"],
    ["Cafe24", "왼쪽 상태는 실제 health 체크 기준으로 표시"],
    ["Cafe24 재인증", "access_token / refresh_token이 모두 만료되면 OAuth 재승인이 필요합니다.", "/api/cafe24/oauth/start"]
  ].map(([title, note, href]) => `<article class="action-item"><strong>${title}</strong><p>${note}</p>${href ? `<a class="button secondary" href="${href}" target="_blank" rel="noreferrer">재인증 시작</a>` : ""}</article>`).join("");
}

async function renderAdvertising(data) {
  const summaryTarget = $("#advertisingSummary");
  const campaignTarget = $("#campaignPerformance");
  const contentTarget = $("#adOrganicContent");
  const tableTarget = $("#adPerformanceRows");
  const rankingTarget = $("#adRanking");
  if (!summaryTarget || !campaignTarget || !contentTarget || !tableTarget || !rankingTarget) return;

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  renderAdLevelTabs();
  const meta = await getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}&level=${activeAdLevel}`, 9000);
  const posts = data.posts || [];
  const adPosts = posts.filter((post) => Number(post.adSpend || 0));
  const organicPosts = posts.filter((post) => !Number(post.adSpend || 0));

  if (meta.error) {
    const status = statusTextForError(meta);
    summaryTarget.innerHTML = [
      `<article class="action-item"><strong>Meta API 상태</strong><span>${esc(status)}</span><p>${esc(meta.error)}</p></article>`,
      `<article class="action-item"><strong>권한 오류 안내</strong><p>Meta API 권한 또는 토큰 권한이 막히면 광고 성과를 불러올 수 없습니다. Settings의 Meta Ads 연결 상태를 확인하세요.</p></article>`
    ].join("");
    campaignTarget.innerHTML = `<article class="action-item"><strong>캠페인별 성과</strong><p>Meta API 오류가 해결되면 캠페인 기준 성과가 표시됩니다.</p></article>`;
    tableTarget.innerHTML = `<tr><td colspan="11">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    rankingTarget.innerHTML = `<article class="action-item"><strong>광고 순위 없음</strong><p>Meta API 오류가 해결되면 표시됩니다.</p></article>`;
    contentTarget.innerHTML = renderAdOrganicCards(adPosts, organicPosts);
    return;
  }

  const totals = meta.totals || {};
  const spend = Number(totals.spend || 0);
  const purchaseValue = Number(totals.purchaseValue || 0);
  const roas = spend ? purchaseValue / spend : null;
  const source = String(meta.source || "").includes("_cached") ? "저장된 Meta 광고 데이터" : "Meta Ads API";

  summaryTarget.innerHTML = [
    `<article class="action-item"><strong>Meta API 상태</strong><span>정상</span><p>${esc(source)} · ${esc(startDate)} ~ ${esc(endDate)}</p></article>`,
    `<article class="action-item"><strong>광고비</strong><span>${apiWon(totals.spend)}</span><p>Meta 캠페인 기준 집행 금액</p></article>`,
    `<article class="action-item"><strong>노출</strong><span>${apiNum(totals.impressions)}</span><p>선택 레벨 합계</p></article>`,
    `<article class="action-item"><strong>도달</strong><span>${apiNum(totals.reach)}</span><p>Meta 캠페인 기준</p></article>`,
    `<article class="action-item"><strong>클릭</strong><span>${apiNum(totals.clicks)}</span><p>Meta 캠페인 클릭 합계</p></article>`,
    `<article class="action-item"><strong>CTR</strong><span>${pct(Number(totals.ctr || 0) * 100)}</span><p>클릭 / 노출</p></article>`,
    `<article class="action-item"><strong>CPC</strong><span>${apiWon(totals.cpc)}</span><p>광고비 / 클릭</p></article>`,
    `<article class="action-item"><strong>CPM</strong><span>${apiWon(totals.cpm)}</span><p>1,000회 노출 비용</p></article>`,
    `<article class="action-item"><strong>Meta 구매수</strong><span>${apiNum(totals.purchases || totals.metaPurchases)}</span><p>Meta 기준 구매 이벤트</p></article>`,
    `<article class="action-item"><strong>Meta 기준 추정 구매값</strong><span>${apiWon(totals.purchaseValue)}</span><p>실제 매출이 아닌 Meta 어트리뷰션 기준 값입니다.</p></article>`,
    `<article class="action-item"><strong>Meta ROAS</strong><span>${roas === null ? "-" : multiple(roas)}</span><p>Meta 기준 추정 구매값 / 광고비</p></article>`
  ].join("");

  const rows = metaAdsRowsForLevel(meta)
    .sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0))
    .slice(0, 6);
  campaignTarget.innerHTML = rows.length ? rows.map((campaign) => (
    `<article class="action-item">
      <strong>${esc(metaAdsRowName(campaign))}</strong>
      <span>${apiWon(campaign.spend)}</span>
      <p>노출 ${apiNum(campaign.impressions)} · 도달 ${apiNum(campaign.reach)} · 클릭 ${apiNum(campaign.clicks)} · CTR ${pct(Number(campaign.ctr || 0) * 100)} · Meta ROAS ${campaign.roas === null ? "-" : multiple(campaign.roas)}</p>
    </article>`
  )).join("") : `<article class="action-item"><strong>${esc(metaAdsLevelLabel(activeAdLevel))} 데이터 없음</strong><p>선택 월에 표시할 Meta 광고 데이터가 없습니다.</p></article>`;

  tableTarget.innerHTML = renderMetaAdsRows(metaAdsRowsForLevel(meta));
  rankingTarget.innerHTML = renderMetaAdsRanking(meta);
  contentTarget.innerHTML = renderAdOrganicCards(adPosts, organicPosts);
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
        <td>${esc(metaAdsRowName(row))}</td>
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

function renderMetaAdsRanking(meta = {}) {
  const top = meta.topAds || [];
  const low = meta.lowAds || [];
  return [
    `<article class="action-item"><strong>우수 광고 TOP 5</strong><p>${top.length ? top.map((row) => `${esc(metaAdsRankingName(row))} · Meta ROAS ${row.roas === null ? "-" : multiple(row.roas || row.metaRoas)} · ${apiWon(row.purchaseValue || row.metaPurchaseValue)}`).join("<br>") : "표시할 우수 광고 데이터가 없습니다."}</p></article>`,
    `<article class="action-item"><strong>점검 광고 TOP 5</strong><p>${low.length ? low.map((row) => `${esc(metaAdsRankingName(row))} · Meta ROAS ${row.roas === null ? "-" : multiple(row.roas || row.metaRoas)} · 광고비 ${apiWon(row.spend)}`).join("<br>") : "표시할 점검 광고 데이터가 없습니다."}</p></article>`
  ].join("");
}

function metaAdsRankingName(row = {}) {
  return row.adName || row.adsetName || row.campaignName || row.label || row.adId || row.adsetId || row.campaignId || "광고";
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
  if (!target) return;
  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const sales = await getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=500`, 8000);
  if (sales.error) {
    target.classList.add("cards");
    target.classList.remove("instagram-feed");
    target.innerHTML = `<article class="action-item"><strong>Cafe24 데이터 오류</strong><p>${esc(sales.error)}</p><small>API가 실패했고 저장된 CSV/캐시도 없으면 이 영역은 비어 있습니다. 과거 월은 CSV 업로드, 현재 월은 Cafe24 재인증 또는 Render 환경변수 확인이 필요합니다.</small></article>`;
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
    `<article class="action-item"><strong>Cafe24<br>실제 매출 요약</strong><span>${apiWon(totals.orderAmount)}</span><p>${source} · ${esc(sales.startDate || startDate)} ~ ${esc(sales.endDate || endDate)}</p></article>`,
    `<article class="action-item"><strong>정상 주문 수</strong><span>${apiNum(totals.orderCount)}건</span><p>취소/환불 주문 제외 기준</p></article>`,
    `<article class="action-item"><strong>제외 주문 수</strong><span>${apiNum(totals.excludedOrderCount)}건</span><p>취소/환불로 매출 집계에서 제외</p></article>`,
    `<article class="action-item"><strong>평균 객단가</strong><span>${apiWon(totals.averageOrderAmount)}</span><p>Cafe24 실제 결제 기준</p></article>`,
    `<article class="action-item"><strong>결제수단별 매출</strong><span>${esc(payments[0]?.paymentMethod || "-")}</span><p>${payments.slice(0, 5).map((item) => `${esc(item.paymentMethod || "-")} · ${apiNum(item.orderCount)}건 · ${apiWon(item.orderAmount)}`).join("<br>") || "표시할 결제수단 데이터가 없습니다."}</p></article>`,
    `<article class="action-item"><strong>판매 상품 TOP</strong><span>${esc(topProducts[0]?.productName || "-")}</span><p>${topProducts.slice(0, 5).map((item) => `${esc(item.productName || "-")} · ${apiNum(item.quantity)}개 · ${apiWon(item.itemAmount)}`).join("<br>") || "주문 데이터에서 상품명을 찾지 못했습니다."}</p></article>`
  ].join("");
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
  const target = $("#adComparison");
  if (!target) return;
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
  target.innerHTML = [
    `<article class="action-item"><strong>Meta 기준 추정 구매값</strong><span>${meta.error ? "확인 필요" : apiWon(metaTotals.purchaseValue)}</span><p>${esc(meta.error || meta.source || "Meta Ads API")} · 캠페인 ${apiNum((meta.campaigns || []).length)}개</p></article>`,
    `<article class="action-item"><strong>Cafe24 실제 주문 매출</strong><span>${cafe.error ? "확인 필요" : apiWon(cafeTotals.orderAmount)}</span><p>${esc(cafe.error || cafe24SourceLabel(cafe))} · 정상 주문 ${apiNum(cafeTotals.orderCount)}건</p></article>`,
    `<article class="action-item"><strong>Meta 구매값과 Cafe24 실제 매출 차이</strong><span>${unmatchedValue === null ? "확인 필요" : apiWon(unmatchedValue)}</span><p>현재 Meta 데이터는 캠페인 단위이므로 상품별 구매 분석으로 해석하지 않습니다.</p></article>`
  ].join("");
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

async function updateSync(data) {
  const instagramStatus = sourceLabel(data);
  const instagramOk = !data.error;
  setSyncRow("instagramSyncRow", instagramOk, "Instagram", sourceText(data), data.error ? statusTextForError(data) : instagramStatus === "CSV" ? "CSV" : "캐시");

  const meta = await getJson(`/api/meta-ads/summary?since=${data.month}-01&until=${monthEnd(data.month)}`, 5000);
  setSyncRow("metaAdsSyncRow", !meta.error, "Meta Ads", meta.error || (String(meta.source || "").includes("_cached") ? "저장된 광고 데이터 기준" : "연결 확인"), meta.error ? statusTextForError(meta) : (String(meta.source || "").includes("_cached") ? "캐시" : "정상"));

  const cafe = await getJson("/api/cafe24/health", 5000);
  const cafeOk = cafe.ok === true && !cafe.error;
  setSyncRow("cafe24SyncRow", cafeOk, "Cafe24", cafe.error || cafe.message || "Cafe24 확인", cafeOk ? "정상" : "오류");
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
  renderGrowthChart();
  renderOtherSections(data);
  updateSync(data);
}

async function loadMonths() {
  monthlyData = [];
  for (const month of months) {
    const data = await getJson(`/api/instagram/monthly?month=${month}`, 20000);
    monthlyData.push(data.error ? errorMonth(month, data.error) : data);
  }
  monthlyData.sort((a, b) => b.month.localeCompare(a.month));
  renderMonthSelect();
  renderAll();
}

function bind() {
  $("#refreshBtn")?.addEventListener("click", async () => {
    toast("데이터를 다시 확인합니다.");
    await loadMonths();
    await renderStoryInsights();
  });
  $("#monthlyReportBtn")?.addEventListener("click", () => document.querySelector('[data-view="Reports"]')?.click());
  $("#refreshStoriesBtn")?.addEventListener("click", renderStoryInsights);
  $("#syncFixBtn")?.addEventListener("click", () => toast("Cafe24 오류는 Render Cafe24 재인증이 필요합니다."));
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

renderNav();
bind();
loadMonths();
renderStoryInsights();
