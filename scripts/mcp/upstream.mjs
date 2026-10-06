// Read-only client from the MCP module to existing Marketing OS GET routes.
// GET only, fixed path allowlist, no caller-supplied URL. Upstream bodies are never forwarded
// on error: an HTML 502 page from Render becomes a structured UPSTREAM_UNAVAILABLE.

export const ALLOWED_UPSTREAM_PATHS = new Set([
  "/api/sales/total",
  "/api/reports/monthly",
  "/api/intelligence/clients",
  "/api/intelligence/brands/resolve",
  "/api/brand-master",
  "/api/intelligence/commercial-policy",
  "/api/brands/new",
  "/api/pending-brands",
  "/api/inventory/overview",
  "/api/advertising/overview"
]);

export class ToolError extends Error {
  constructor(code, message, { retryable = false, details = {} } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
  toJSON() {
    return { ok: false, error: { code: this.code, message: this.message, retryable: this.retryable, details: this.details } };
  }
}

export function assertSafeUpstreamRequest(method, path) {
  if (method !== "GET") throw new ToolError("VALIDATION_FAILED", "MCP upstream is GET only");
  if (!ALLOWED_UPSTREAM_PATHS.has(path)) throw new ToolError("VALIDATION_FAILED", `Upstream path not allowed: ${String(path).slice(0, 80)}`);
}

export function createUpstream({ baseUrl, timeoutMs = 20_000 }) {
  async function getJson(path, params = {}) {
    assertSafeUpstreamRequest("GET", path);
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError";
      throw new ToolError("UPSTREAM_UNAVAILABLE", timedOut ? `Marketing OS timed out after ${timeoutMs} ms` : "Marketing OS is unreachable", { retryable: true, details: { path } });
    }
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON (HTML error page) */ }
    const upstreamMessage = typeof body?.error === "string" ? body.error.slice(0, 200) : null;
    if (response.status === 400) throw new ToolError("VALIDATION_FAILED", upstreamMessage || "Invalid request", { details: { path, status: 400 } });
    if (response.status === 404) throw new ToolError("NOT_FOUND", upstreamMessage || "Not found", { details: { path, status: 404 } });
    if (!response.ok || body === null || typeof body !== "object") {
      throw new ToolError("UPSTREAM_UNAVAILABLE", `Marketing OS returned ${response.ok ? "a non-JSON response" : `HTTP ${response.status}`}`, {
        retryable: response.status >= 500 || response.status === 429,
        details: { path, status: response.status }
      });
    }
    if (body.ok === false) throw new ToolError("UPSTREAM_UNAVAILABLE", upstreamMessage || "Marketing OS reported an error", { details: { path, status: response.status } });
    return body;
  }
  return { getJson };
}

// meta.completeness: COMPLETE | PARTIAL | UNAVAILABLE | UNKNOWN (no coverage info upstream).
export function envelope(tool, data, { source, dataAsOf = null, coverage = null, completeness = "UNKNOWN", requestedPeriod, availablePeriod, notes = [] }) {
  const allNotes = [...notes];
  if (completeness === "PARTIAL" || completeness === "UNAVAILABLE") allNotes.unshift(`COVERAGE_INCOMPLETE: data is ${completeness.toLowerCase()} for the requested scope`);
  const meta = { dataAsOf, source, coverage, completeness, notes: allNotes };
  if (requestedPeriod) meta.requestedPeriod = requestedPeriod;
  if (availablePeriod) meta.availablePeriod = availablePeriod;
  return { ok: true, tool, data, meta };
}

function largestArray(node, path = []) {
  let best = null;
  if (Array.isArray(node)) best = { path, length: node.length, size: JSON.stringify(node).length };
  if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      const found = largestArray(child, [...path, key]);
      if (found && (!best || found.size > best.size)) best = found;
    }
  }
  return best;
}

// Last-resort guard: halves the largest array until the serialized result fits.
export function capPayload(result, maxBytes = 200_000) {
  let out = result;
  while (JSON.stringify(out).length > maxBytes) {
    const target = largestArray(out.data, ["data"]);
    if (!target || target.length <= 1) break;
    out = structuredClone(out);
    const parent = target.path.slice(0, -1).reduce((node, key) => node[key], out);
    const key = target.path.at(-1);
    const original = out.meta.truncatedFrom?.[target.path.join(".")] ?? target.length;
    parent[key] = parent[key].slice(0, Math.floor(parent[key].length / 2));
    out.meta.truncatedFrom = { ...out.meta.truncatedFrom, [target.path.join(".")]: original };
    out.meta.notes = [...out.meta.notes.filter((n) => !n.startsWith(`truncated: ${key} `)), `truncated: ${key} ${parent[key].length} of ${original}`];
  }
  return out;
}
