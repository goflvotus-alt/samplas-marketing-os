// "ECOUNT 상품 최신화" button. Always calls the LOCAL helper on this Mac (127.0.0.1:8787),
// never the Render API: ECOUNT is only reachable from the office Mac. Same-origin when the
// page itself is served locally; from the Production page the browser reaches loopback.
// Flow: 상태 확인 중 → 최신화 중 → Production 반영 확인 중 → 완료/실패.
(function () {
  const LOCAL_PORT = 8787;
  const PERMISSION_WAIT_MS = 4000;
  const POLL_MS = 2000;
  const isLocalPage = ["127.0.0.1", "localhost"].includes(location.hostname);
  const ENDPOINT = `${isLocalPage ? "" : `http://127.0.0.1:${LOCAL_PORT}`}/api/ecount/product-sync`;
  const OFFLINE = "로컬 ECOUNT 서비스가 실행 중이 아닙니다 — 이 Mac에서 SAMPLAS INTELLIGENCE(Launcher)를 켜거나 outputs/ECOUNT 상품 최신화.command를 실행하세요.";
  const PERMISSION = "Chrome에서 로컬 네트워크 접근 허용이 필요합니다. 주소창 또는 브라우저 권한 요청에서 허용한 뒤 다시 눌러주세요.";
  const CHECKING = "상태 확인 중…";
  const RUNNING = "최신화 중… (ECOUNT 조회 → Production 업로드 → 신규 브랜드 확인, 약 1분)";
  const VERIFYING = "Production 반영 확인 중…";
  const ALREADY = "이미 최신화가 진행 중입니다 — 잠시 후 다시 확인하세요.";

  // Never show an HTML error page; keep long or raw text out of the status line.
  function clean(text) {
    const value = String(text ?? "");
    const status = value.match(/\b([45]\d\d)\b/)?.[1];
    if (/<!doctype|<html|<head|<body/i.test(value)) return status ? `Production 응답 오류 (HTTP ${status})` : "Production 응답 오류";
    return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  function describe(last) {
    if (!last) return { state: "idle", text: "대기 — 이 Mac에서 아직 실행한 기록이 없습니다." };
    const when = last.finishedAt ? new Date(last.finishedAt).toLocaleString("ko-KR") : "-";
    if (!last.ok) {
      const reason = clean(last.error || (last.verificationFailures || []).join(" / ") || "알 수 없는 오류");
      return { state: "failed", text: `실패 (${last.stage || "-"}): ${reason} · ${when}` };
    }
    const n = typeof last.products === "number" ? last.products.toLocaleString("en-US") : "-";
    const added = typeof last.newProducts === "number" ? ` · 신규 상품 ${last.newProducts >= 0 ? "+" : ""}${last.newProducts}` : "";
    return { state: "done", text: `${n}개 최신화 완료${added} · 신규 브랜드 ${last.approvedCount} · 검토 필요 ${last.needsReviewCount} · ${when}` };
  }

  // Runner log line → user-facing progress text.
  function progressText(line) {
    const text = clean(line);
    if (!/\[5\/5\]/.test(text)) return RUNNING;
    const retry = text.match(/재시도 \(시도 (\d+)\/(\d+)/);
    return retry ? `Production 반영 확인 중 · 재시도 ${retry[1] - 1}/${retry[2] - 1}` : VERIFYING;
  }

  const CLASS = { idle: "ad-status-banner", checking: "ad-status-banner loading", running: "ad-status-banner loading", done: "ad-status-banner good", failed: "ad-status-banner urgent", offline: "ad-status-banner warn", permission: "ad-status-banner warn" };

  function init() {
    const button = document.getElementById("ecountProductSyncBtn");
    const status = document.getElementById("ecountProductSyncStatus");
    if (!button || !status) return;
    let busy = false;
    const show = (state, text) => {
      status.className = CLASS[state];
      status.dataset.state = state;
      status.textContent = text;
      button.disabled = state === "running" || state === "checking";
    };

    // Status GET. A request that neither answers nor fails is the browser waiting for the
    // local-network permission (Production page); a refused connection means the helper is off.
    function probe() {
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ kind: "permission" }); } }, PERMISSION_WAIT_MS);
        fetch(ENDPOINT, { method: "GET" })
          .then(async (response) => ({ kind: response.ok ? "ok" : "offline", response, body: await response.json().catch(() => ({})) }))
          .catch(() => ({ kind: "offline" }))
          .then((outcome) => {
            if (settled) {
              // Permission granted later: show the current state, never start a sync on our own.
              if (outcome.kind === "ok" && !busy) renderStatus(outcome.body);
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(outcome);
          });
      });
    }
    function renderStatus(body) {
      if (body.running) return show("running", progressText(body.progress));
      const d = describe(body.last);
      show(d.state, d.text);
    }
    async function refresh() {
      show("checking", CHECKING);
      const outcome = await probe();
      if (outcome.kind === "permission") return show("permission", PERMISSION);
      if (outcome.kind === "offline") return show("offline", clean(outcome.body?.error) || OFFLINE);
      renderStatus(outcome.body);
    }
    async function pollProgress() {
      while (busy) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!busy) return;
        try {
          const body = await (await fetch(ENDPOINT, { method: "GET" })).json();
          if (busy && body.running) show("running", progressText(body.progress));
        } catch { /* the POST result decides */ }
      }
    }

    button.addEventListener("click", async () => {
      if (button.disabled || busy) return;
      show("checking", CHECKING);
      const outcome = await probe(); // permission/offline are reported before any sync starts
      if (outcome.kind === "permission") return show("permission", PERMISSION);
      if (outcome.kind === "offline") return show("offline", clean(outcome.body?.error) || OFFLINE);
      if (outcome.body.running) return show("idle", ALREADY);
      busy = true;
      show("running", RUNNING);
      pollProgress();
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { "x-samplas-local-action": "ecount-product-sync" } });
        const body = await response.json();
        if (response.status === 409) return show("idle", ALREADY);
        if (!body.last) return show("failed", `실패: ${clean(body.error) || `HTTP ${response.status}`}`);
        const d = describe(body.last);
        show(d.state, d.text);
      } catch {
        show("offline", OFFLINE);
      } finally {
        busy = false;
      }
    });
    refresh();
  }

  window.SamplasEcountSync = { describe, progressText, clean, ENDPOINT, OFFLINE, PERMISSION };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
