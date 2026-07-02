const navItems = [
  "Overview",
  "Monthly Report",
  "Content Performance",
  "Reels Report",
  "Cardnews Report",
  "Story Insights",
  "Follower Growth",
  "Website Click / Conversion",
  "Ad + Organic Comparison",
  "Cafe24 Sales Impact",
  "Content Calendar",
  "API Setup",
  "Action Items"
];

const months = ["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01"];
let monthlyData = [];
let storyData = { stories: [], totals: {} };
let activeContentFilter = "All";

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

function instagramApiErrors(data = {}) {
  const errors = data.apiErrors || [];
  const account = errors.find((item) => item.source === "instagram_account_insights")?.message || "";
  const media = errors.find((item) => item.source === "instagram_media_insights")?.message || "";
  return {
    account: account ? `API 오류: ${account}` : "",
    media: media ? `API 오류: ${media}` : ""
  };
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
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
  if (data.source === "csv_required") return "CSV 필요";
  if (String(data.source || "").startsWith("csv_import")) return "CSV";
  if (String(data.source || "").includes("_cached")) return "캐시";
  if (String(data.source || "").includes("graph_api")) return "API";
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
      ["API 오류", status, data.error],
      ["월", data.month || "-", "Render API 로그를 확인하세요"],
      ["표시 상태", "0으로 대체 안 함", "실제 데이터가 없으면 원인을 표시합니다."]
    ].map(([label, value, delta]) => (
      `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><p class="delta">${esc(delta)}</p></article>`
    )).join("");
    return;
  }
  const a = data.account || {};
  const postCount = (data.posts || []).length;
  const adSpend = (data.posts || []).reduce((sum, post) => sum + Number(post.adSpend || 0), 0);
  const instagramErrors = instagramApiErrors(data);
  const postsScopeNote = data.postsScope === "recent_media_fallback"
    ? "월 게시물 0개 · 최근 미디어 표시"
    : `최근 미디어 ${apiNum(data.mediaFetched)}개 · 월 필터 ${apiNum(data.monthMediaCount)}개`;
  const items = [
    ["팔로워", apiNum(a.followers), `@${a.username || data.accountIdentity?.username || "samplaskr"} · media_count ${apiNum(a.mediaCount ?? data.accountIdentity?.mediaCount)}`],
    ["도달", apiNum(a.reach), instagramErrors.account || `전월 대비 ${pct(a.reachDelta)}`],
    ["조회", apiNum(a.views), instagramErrors.account || `전월 대비 ${pct(a.viewsDelta)}`],
    ["프로필 방문", apiNum(a.profileVisits), instagramErrors.account || `전월 대비 ${pct(a.profileVisitDelta)}`],
    ["웹사이트 클릭", apiNum(a.websiteClicks), instagramErrors.account || `전월 대비 ${pct(a.websiteClickDelta)}`],
    ["계정 참여", apiNum(a.accountEngagement), instagramErrors.media || "게시물별 인사이트 기준"],
    ["월간 콘텐츠", `${apiNum(postCount)}개`, postsScopeNote],
    ["광고비", krw(adSpend), "게시물 매핑 기준"]
  ];
  $("#kpiGrid").innerHTML = items.map(([label, value, delta]) => (
    `<article class="kpi"><span>${label}</span><strong>${value}</strong><p class="delta">${delta}</p></article>`
  )).join("");
}

async function renderOverviewLiveData(data) {
  const target = $("#overviewLiveData");
  if (!target) return;
  target.innerHTML = `<article class="action-item"><strong>실시간 데이터 확인 중</strong><p>Render API 연결 상태와 이번 달 요약을 확인합니다.</p></article>`;

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const [status, meta, cafe] = await Promise.all([
    getJson("/api/status", 6000),
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=500`, 7000)
  ]);

  const a = data.account || {};
  const missing = status.environment || {};
  const metaTotals = meta.totals || {};
  const cafeTotals = cafe.totals || {};
  const cafeSource = cafe.error ? cafe.error : (cafe.source === "csv_required" ? "CSV 업로드 필요" : cafe.source || "Cafe24 연결");
  const metaSource = isPermissionBlocked(meta) ? "권한 차단: Meta 앱 권한 또는 토큰 권한 확인 필요" : meta.error ? meta.error : meta.source || "Meta Ads 연결";
  const instagramDetail = status.instagram
    ? `IG Business ${status.instagramBusinessAccountId || "-"}`
    : `누락: ${(missing.instagram?.missing || []).join(", ") || "확인 필요"}`;
  const instagramBlocked = isPermissionBlocked(data);
  const instagramErrors = instagramApiErrors(data);
  const instagramMessage = instagramBlocked
    ? data.error
    : instagramErrors.account || instagramErrors.media || instagramDetail;

  target.innerHTML = [
    `<article class="action-item"><strong>Instagram API</strong><span>${instagramBlocked ? "권한 차단" : status.instagram ? (data.apiStatus === "partial" ? "부분 연결" : "연결됨") : "환경변수 필요"}</span><p>${esc(instagramMessage)} · 도달 ${apiNum(a.reach)} / 조회 ${apiNum(a.views)} / 게시물 ${apiNum((data.posts || []).length)}개</p></article>`,
    `<article class="action-item"><strong>Meta Ads</strong><span>${isPermissionBlocked(meta) ? "권한 차단" : meta.error ? "확인 필요" : krw(metaTotals.spend)}</span><p>${esc(metaSource)} · 캠페인 ${num((meta.campaigns || []).length)}개</p></article>`,
    `<article class="action-item"><strong>Cafe24 매출</strong><span>${cafe.error ? "확인 필요" : apiWon(cafeTotals.orderAmount)}</span><p>${esc(cafeSource)} · totals.orderAmount</p></article>`,
    `<article class="action-item"><strong>Cafe24 주문 수</strong><span>${cafe.error ? "확인 필요" : `${apiNum(cafeTotals.orderCount)}건`}</span><p>totals.orderCount${hasApiValue(cafeTotals.excludedOrderCount) ? ` · 제외 ${apiNum(cafeTotals.excludedOrderCount)}건` : ""}</p></article>`,
    `<article class="action-item"><strong>Cafe24 객단가</strong><span>${cafe.error ? "확인 필요" : apiWon(cafeTotals.averageOrderAmount)}</span><p>totals.averageOrderAmount</p></article>`
  ].join("");
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

function renderContentTable(posts, filter = "All") {
  const filtered = filter === "All" ? posts : (posts || []).filter((post) => post.tag === filter || post.type === filter || (filter === "Reels" && post.type === "릴스"));
  $("#contentRows").innerHTML = filtered.slice(0, 80).map((post) => (
    `<tr>
      <td>${esc(post.date || "-")}</td>
      <td><strong>${esc(post.tag || "-")}</strong><br>${esc(post.title || "-")}</td>
      <td>${esc(post.type || "-")}</td>
      <td>${esc(post.objective || "-")}</td>
      <td>좋아요 ${apiNum(post.likes)}<br>댓글 ${apiNum(post.comments)}<br>저장 ${apiNum(post.saves)} / 공유 ${apiNum(post.shares)}</td>
      <td>${esc(post.unavailableReason ? `API 오류: ${post.unavailableReason}` : explainPost(post))}</td>
    </tr>`
  )).join("") || `<tr><td colspan="6">게시물별 데이터가 없습니다.</td></tr>`;
}

function metricCard(post) {
  return `<article class="report-panel">
    <h4>${esc(post.title || "Untitled")}</h4>
    <p>${esc(post.date || "-")} · ${esc(post.tag || post.type || "-")}</p>
    <div class="report-metrics">
      <span>도달 <strong>${apiNum(post.reach)}</strong></span>
      <span>조회 <strong>${apiNum(post.views)}</strong></span>
      <span>상호작용 <strong>${apiNum(postInteractionValue(post))}</strong></span>
      <span>클릭 <strong>${apiNum(post.websiteClicks)}</strong></span>
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
  const statMode = options.statMode || "default";
  const stats = statMode === "cardnews"
    ? [
        ["좋아요", apiNum(post.likes)],
        ["댓글", apiNum(post.comments)],
        ["공유", apiNum(post.shares)],
        ["저장", apiNum(post.saves)]
      ]
    : [
        ["도달", apiNum(post.reach)],
        ["조회", apiNum(post.views)],
        ["저장", apiNum(post.saves)],
        ["공유", apiNum(post.shares)]
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
        <span class="chip">저장률 ${pct(m.saveRate)}</span>
        <span class="chip">공유율 ${pct(m.shareRate)}</span>
      </div>
    </div>
  </article>`;
}

function renderCards(id, posts, mode = "metric") {
  const target = $(`#${id}`);
  if (mode === "feed" || mode === "cardnews") {
    target.classList.add("instagram-feed");
    target.classList.remove("cards");
    target.innerHTML = posts.length ? posts.map((post) => feedCard(post, { statMode: mode === "cardnews" ? "cardnews" : "default" })).join("") : `<article class="feed-card"><div class="feed-body"><h4>데이터 없음</h4><p class="feed-caption">해당 월에 표시할 콘텐츠가 없습니다.</p></div></article>`;
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
  $("#actions").innerHTML = [
    "월말 CSV로 과거 월 확정",
    "현재 월 API/캐시 점검",
    "Cafe24 invalid refresh_token 발생 시 Render Cafe24 재인증",
    "Meta API access blocked는 토큰/권한 별도 점검"
  ].map((item) => `<label class="action-item"><input type="checkbox" /> ${esc(item)}</label>`).join("");
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
  const topProducts = sales.topProducts || [];
  const payments = sales.paymentMethods || [];
  const source = cafe24SourceLabel(sales);
  target.classList.add("cards");
  target.classList.remove("instagram-feed");
  target.innerHTML = [
    `<article class="action-item"><strong>실제 결제금액</strong><span>${apiWon(totals.orderAmount)}</span><p>${source} · totals.orderAmount</p></article>`,
    `<article class="action-item"><strong>주문 수</strong><span>${apiNum(totals.orderCount)}건</span><p>totals.orderCount · ${esc(sales.startDate || startDate)} ~ ${esc(sales.endDate || endDate)}</p></article>`,
    `<article class="action-item"><strong>객단가</strong><span>${apiWon(totals.averageOrderAmount)}</span><p>totals.averageOrderAmount</p></article>`,
    `<article class="action-item"><strong>상품 판매가 합계</strong><span>${apiWon(totals.itemAmount)}</span><p>totals.itemAmount · 품목 ${apiNum(totals.itemCount)}개 · 수량 ${apiNum(totals.quantity)}</p></article>`,
    `<article class="action-item"><strong>상위 결제수단</strong><span>${esc(payments[0]?.paymentMethod || "-")}</span><p>${payments.slice(0, 3).map((item) => `${esc(item.paymentMethod || "-")} ${apiWon(item.orderAmount)}`).join("<br>") || "데이터 없음"}</p></article>`,
    `<article class="action-item"><strong>상위 판매 상품</strong><span>${esc(topProducts[0]?.productName || "-")}</span><p>${topProducts.slice(0, 3).map((item) => `${esc(item.productName || "-")} · ${apiNum(item.quantity)}개 · ${apiWon(item.itemAmount)}`).join("<br>") || "상품 상세 응답 없음"}</p></article>`
  ].join("");
}

async function renderAdComparison(data) {
  const target = $("#adComparison");
  if (!target) return;
  const posts = data.posts || [];
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
    `<article class="action-item"><strong>Meta 구매값</strong><span>${meta.error ? "확인 필요" : apiWon(metaTotals.purchaseValue)}</span><p>${esc(meta.error || meta.source || "Meta Ads API")}</p></article>`,
    `<article class="action-item"><strong>Cafe24 실제 결제</strong><span>${cafe.error ? "확인 필요" : apiWon(cafeTotals.orderAmount)}</span><p>${esc(cafe.error || cafe24SourceLabel(cafe))} · 주문 ${apiNum(cafeTotals.orderCount)}건</p></article>`,
    `<article class="action-item"><strong>미매칭 Meta 구매</strong><span>${unmatchedValue === null ? "확인 필요" : apiWon(unmatchedValue)}</span><p>상품 ID 매칭 전 비교값입니다. Cafe24 표시는 API totals를 그대로 사용합니다.</p></article>`,
    `<article class="action-item"><strong>광고 집행 콘텐츠</strong><span>${num(posts.filter((post) => Number(post.adSpend || 0)).length)}개</span><p>유기적 콘텐츠 ${num(posts.filter((post) => !Number(post.adSpend || 0)).length)}개</p></article>`
  ].join("");
}

function cafe24SourceLabel(data = {}) {
  if (data.source === "csv_required") return "CSV 필요";
  if (data.cacheMode === "fallback_after_error") return `Cafe24 캐시 대체${data.cacheWarning ? ` · ${data.cacheWarning}` : ""}`;
  if (String(data.source || "").includes("csv")) return "Cafe24 CSV";
  if (String(data.source || "").includes("admin_api")) return "Cafe24 주문 API";
  if (String(data.source || "").includes("cached")) return "Cafe24 캐시";
  return data.source || "Cafe24";
}

async function renderStoryInsights() {
  storyData = await getJson("/api/instagram/stories", 6000);
  const stories = storyData.stories || [];
  $("#storyStatus").innerHTML = [
    ["스토리", `${num(stories.length)}개`, storyData.source || "-"],
    ["도달", num(storyData.totals?.reach), storyData.cacheWarning || "저장 데이터 기준"],
    ["답장", num(storyData.totals?.replies), "스토리 인사이트"]
  ].map(([title, value, note]) => `<article class="action-item"><strong>${title}</strong><span>${value}</span><p>${esc(note)}</p></article>`).join("");
  $("#storyBoard").innerHTML = stories.slice(0, 12).map((story) => (
    `<article class="report-panel"><h4>${esc(story.date || "-")}</h4><p>도달 ${num(story.reach)} / 답장 ${num(story.replies)} / 이탈 ${num(story.exits)}</p></article>`
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
  renderPurposeRadar(data.posts || []);
  renderInsights(data);
  renderMonthlyDashboard(data);
  renderContentTable(data.posts || [], activeContentFilter);
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
  $("#monthlyReportBtn")?.addEventListener("click", () => document.querySelector('[data-view="Monthly Report"]')?.click());
  $("#refreshStoriesBtn")?.addEventListener("click", renderStoryInsights);
  $("#syncFixBtn")?.addEventListener("click", () => toast("Cafe24 오류는 Render Cafe24 재인증이 필요합니다."));
  $$(".segment[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeContentFilter = button.dataset.filter || "All";
      $$(".segment[data-filter]").forEach((node) => node.classList.toggle("active", node === button));
      renderContentTable(selectedMonth().posts || [], activeContentFilter);
    });
  });
}

renderNav();
bind();
loadMonths();
renderStoryInsights();
