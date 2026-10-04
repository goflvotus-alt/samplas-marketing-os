// Local-only Marketing OS helper for the ECOUNT one-click refresh. It runs on the office
// Mac's local server (127.0.0.1) and is disabled on Render: ECOUNT only accepts registered
// IPs, and Render must never call ECOUNT. It reuses runEcountProductSyncFromEnv (same lock,
// same NEW-only onboarding, same upload/verification gates as the .command file).
//
// Guards: Host must be loopback (DNS rebinding), Origin must be allowlisted when present,
// and POST needs the custom header below, so a foreign page cannot trigger it (the header
// forces a CORS preflight that only allowlisted origins pass).
export const LOCAL_ACTION_HEADER = "x-samplas-local-action";
export const LOCAL_ACTION_VALUE = "ecount-product-sync";

export function uiResult(result, summary, finishedAt = new Date().toISOString()) {
  const o = result?.onboarding || {};
  return {
    ok: Boolean(result?.ok),
    stage: result?.stage ?? null,
    error: result?.error || o.error || null,
    dryRun: Boolean(result?.dryRun),
    products: result?.productMaster?.totalProducts ?? null,
    newProducts: result?.newProducts ?? null,
    approvedCount: o.approved?.length ?? 0,
    approved: o.approved || [],
    needsReviewCount: o.needsReview?.length ?? 0,
    needsReview: o.needsReview || [],
    blocked: o.blocked || {},
    uploaded: result?.upload?.uploaded || [],
    verificationFailures: result?.verification?.failures || [],
    summary,
    finishedAt
  };
}

export function createLocalEcountProductSyncRoute({ enabled, allowedOrigins, run }) {
  const origins = new Set(allowedOrigins);
  let running = false;
  let last = null;
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  return async function handle(req, res, { isLocal }) {
    if (!enabled) return send(res, 404, { ok: false, error: "local-only: ECOUNT 최신화는 사무실 Mac의 로컬 Marketing OS에서만 실행됩니다." });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return send(res, 403, { ok: false, error: "허용되지 않은 origin입니다." });
    const cors = origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": `content-type, ${LOCAL_ACTION_HEADER}`,
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    } : {};
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (!isLocal) return send(res, 403, { ok: false, error: "localhost에서만 허용됩니다." }, cors);
    if (req.method === "GET") return send(res, 200, { ok: true, available: true, running, last }, cors);
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" }, cors);
    if (req.headers[LOCAL_ACTION_HEADER] !== LOCAL_ACTION_VALUE) return send(res, 403, { ok: false, error: "로컬 실행 헤더가 없습니다." }, cors);
    if (running) return send(res, 409, { ok: false, running: true, error: "이미 최신화가 진행 중입니다." }, cors);
    running = true;
    try {
      const { result, summary } = await run();
      last = uiResult(result, summary);
    } catch (error) {
      // e.g. the shared lock: the .command run is already in progress.
      last = uiResult({ ok: false, stage: "start", error: String(error?.message || error) }, String(error?.message || error));
    } finally {
      running = false;
    }
    return send(res, 200, { ok: last.ok, running: false, last }, cors);
  };
}
