// "ECOUNT 상품 최신화" button. Always calls the LOCAL helper on this Mac (127.0.0.1:8787),
// never the Render API: ECOUNT is only reachable from the office Mac. Same-origin when the
// page itself is served locally; from the Production page the browser reaches loopback.
(function () {
  const LOCAL_PORT = 8787;
  const isLocalPage = ["127.0.0.1", "localhost"].includes(location.hostname);
  const ENDPOINT = `${isLocalPage ? "" : `http://127.0.0.1:${LOCAL_PORT}`}/api/ecount/product-sync`;
  const OFFLINE = "로컬 ECOUNT 서비스가 실행 중이 아닙니다 — 이 Mac에서 SAMPLAS INTELLIGENCE(Launcher)를 켜거나 outputs/ECOUNT 상품 최신화.command를 실행하세요.";
  const RUNNING = "최신화 중… (ECOUNT 조회 → Production 업로드 → 신규 브랜드 확인, 약 1분)";

  function describe(last) {
    if (!last) return { state: "idle", text: "대기 — 이 Mac에서 아직 실행한 기록이 없습니다." };
    const when = last.finishedAt ? new Date(last.finishedAt).toLocaleString("ko-KR") : "-";
    if (!last.ok) return { state: "failed", text: `실패 (${last.stage || "-"}): ${last.error || (last.verificationFailures || []).join(" / ") || "알 수 없는 오류"} · ${when}` };
    const n = typeof last.products === "number" ? last.products.toLocaleString("en-US") : "-";
    const added = typeof last.newProducts === "number" ? ` · 신규 상품 ${last.newProducts >= 0 ? "+" : ""}${last.newProducts}` : "";
    return { state: "done", text: `${n}개 최신화 완료${added} · 신규 브랜드 ${last.approvedCount} · 검토 필요 ${last.needsReviewCount} · ${when}` };
  }

  const CLASS = { idle: "ad-status-banner", running: "ad-status-banner loading", done: "ad-status-banner good", failed: "ad-status-banner urgent", offline: "ad-status-banner warn" };

  function init() {
    const button = document.getElementById("ecountProductSyncBtn");
    const status = document.getElementById("ecountProductSyncStatus");
    if (!button || !status) return;
    const show = (state, text) => {
      status.className = CLASS[state];
      status.dataset.state = state;
      status.textContent = text;
      button.disabled = state === "running";
    };
    async function refresh() {
      try {
        const response = await fetch(ENDPOINT, { method: "GET" });
        const body = await response.json();
        if (!response.ok) return show("offline", body.error || OFFLINE);
        if (body.running) return show("running", RUNNING);
        const d = describe(body.last);
        show(d.state, d.text);
      } catch {
        show("offline", OFFLINE);
      }
    }
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      show("running", RUNNING);
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { "x-samplas-local-action": "ecount-product-sync" } });
        const body = await response.json();
        if (response.status === 409) return show("running", body.error || RUNNING);
        if (!body.last) return show("failed", `실패: ${body.error || response.status}`);
        const d = describe(body.last);
        show(d.state, d.text);
      } catch {
        show("offline", OFFLINE);
      }
    });
    refresh();
  }

  window.SamplasEcountSync = { describe, ENDPOINT, OFFLINE };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
