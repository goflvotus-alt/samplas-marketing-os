// NEW BRANDS (최근 90일) panel in Brand Intelligence. Reads /api/brands/new from the same
// origin; shows only the three operation labels returned by the server.
(function () {
  const SOURCING = { WHOLESALE: "사입", CONSIGNMENT: "위탁", HYBRID: "혼합", OWN_PRODUCTION: "자체제작", UNKNOWN: "미확인" };
  const ORDER = { NAVER_MISSING: 0, NEW_BRAND_ARRIVED: 1, COMPLETE: 2 };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

  function sortRows(brands) {
    return [...brands].sort((a, b) => (ORDER[a.operationStatus] ?? 9) - (ORDER[b.operationStatus] ?? 9) || String(b.approvedAt).localeCompare(String(a.approvedAt)));
  }
  function onboardDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).format(d).replace(/\s/g, "").replace(/\.$/, "").replace(".", "/");
  }
  function detail(b) {
    const c = b.cafe24 || {}, n = b.naver || {};
    const cafe24 = c.checked ? `Cafe24 판매 가능 ${c.sellableProductCount}/${c.productCount}` : `Cafe24 확인 불가`;
    const naver = n.checked ? (n.registered ? `NAVER 광고그룹 ${n.adgroupName}` : n.pausedOnly ? `NAVER 광고그룹 ${n.adgroupName} (OFF)` : "NAVER 광고그룹 없음") : n.skipped ? "" : "NAVER 확인 불가";
    return [cafe24, naver].filter(Boolean).join(" · ");
  }
  function summary(data) {
    const c = data.statusCounts || {};
    return `최근 90일 신규 브랜드 ${data.count} · 새브랜드 입고 ${c.NEW_BRAND_ARRIVED ?? 0} · NAVER 미등록 ${c.NAVER_MISSING ?? 0} · 완료 ${c.COMPLETE ?? 0}`;
  }
  function rowsHtml(brands) {
    if (!brands.length) return `<tr><td colspan="5">최근 90일 신규 브랜드가 없습니다.</td></tr>`;
    return sortRows(brands).map((b) => `<tr title="${esc(detail(b))}">
      <td>${esc(b.brandName)}</td>
      <td>${esc(onboardDate(b.approvedAt))}</td>
      <td>D+${esc(b.daysSinceOnboarding)}</td>
      <td>${esc(SOURCING[b.sourcingType] || b.sourcingType || "-")}</td>
      <td>${esc(b.operationStatusLabel)}</td>
    </tr>`).join("");
  }

  async function load() {
    const status = document.getElementById("newBrandsSummary");
    const body = document.getElementById("newBrandsRows");
    if (!status || !body) return;
    try {
      const response = await fetch("/api/brands/new");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      status.className = "ad-status-banner";
      status.textContent = summary(data);
      body.innerHTML = rowsHtml(data.brands || []);
    } catch (error) {
      status.className = "ad-status-banner warn";
      status.textContent = `NEW BRANDS를 불러오지 못했습니다. ${String(error.message || "").slice(0, 120)}`;
      body.innerHTML = "";
    }
  }

  window.SamplasNewBrands = { sortRows, onboardDate, summary, rowsHtml, detail };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
