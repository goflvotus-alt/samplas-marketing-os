// SAMPLAS SESSION DIRECTOR REST API: /api/session-director/*
// Own credentials only; the generic /api gate (loopback, Basic, operator session) and the AI audit
// token never open these routes.
//   Web app (Vercel server):  x-session-director-token = SESSION_WEB_SECRET
//                             x-session-actor          = signed, short-lived operator identity (below)
//   MCP (T4):                 x-session-mcp-token      = SESSION_MCP_SECRET, MCP path only
// Unset secrets fail closed (503). Every write is read back before success is reported.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createSessionDropboxStore } from "./session-dropbox.mjs";
import { createLocalDropboxFetch, localStoreAllowed } from "./session-local-dropbox.mjs";
import { createSessionDocument, cueSheetView, SessionError, sessionProjectView } from "./session-store.mjs";

export const SESSION_API_PREFIX = "/api/session-director/";
export const ACTOR_MAX_LIFETIME_SECONDS = 300;
const ACTOR_CONTEXT = "session-actor:v1.";
const CLOCK_SKEW_SECONDS = 30;

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const hmac = (secret, payload) => createHmac("sha256", secret).update(ACTOR_CONTEXT + payload).digest();
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
const emailList = (value) => new Set(String(value || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));

// Operator identity from the Vercel server: base64url(JSON{email, iat, exp}) "." base64url(HMAC).
// The signature binds the email to a lifetime of at most ACTOR_MAX_LIFETIME_SECONDS.
export function signActorToken({ email, secret, now = Date.now(), ttlSeconds = 120 }) {
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ email, iat, exp: iat + ttlSeconds }));
  return `${payload}.${b64url(hmac(secret, payload))}`;
}

export function verifyActorToken(token, secret, { now = Date.now() } = {}) {
  const deny = (reason) => new SessionError(401, "invalid_actor", reason);
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra !== undefined) throw deny("missing or malformed actor");
  const expected = b64url(hmac(secret, payload));
  if (!safeEqual(signature, expected)) throw deny("bad actor signature");
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw deny("unreadable actor"); }
  const nowSeconds = Math.floor(now / 1000);
  if (typeof claims.email !== "string" || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) throw deny("incomplete actor");
  if (claims.exp - claims.iat > ACTOR_MAX_LIFETIME_SECONDS) throw deny("actor lifetime too long");
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS || claims.exp <= nowSeconds) throw deny("actor expired");
  return { email: claims.email.trim().toLowerCase() };
}

// Returns { kind: "web", id: email, approver } or throws. Roles come only from Render's own env.
export function authenticateWeb(req, env, { now } = {}) {
  if (!env.SESSION_WEB_SECRET || !env.SESSION_OPERATOR_EMAILS) throw new SessionError(503, "not_configured");
  if (!safeEqual(req.headers["x-session-director-token"], env.SESSION_WEB_SECRET)) throw new SessionError(401, "unauthorized");
  const { email } = verifyActorToken(req.headers["x-session-actor"], env.SESSION_WEB_SECRET, { now });
  if (!emailList(env.SESSION_OPERATOR_EMAILS).has(email)) throw new SessionError(403, "operator_not_allowed");
  return { kind: "web", id: email, approver: emailList(env.SESSION_APPROVER_EMAILS).has(email) };
}

// Shared by REST and MCP: the same validation, version check and read-back.
export function createSessionService(store) {
  async function verified(id, expected) {
    const { doc } = await store.read(id);
    if (doc.version !== expected.version || JSON.stringify(doc) !== JSON.stringify(expected)) {
      throw new SessionError(502, "write_unverified", "the saved session did not read back as written", { currentVersion: doc.version });
    }
    return doc;
  }
  return {
    list: (options) => store.list(options),
    async project(id) { return sessionProjectView((await store.read(id)).doc); },
    async cueSheet(id, options) { return cueSheetView((await store.read(id)).doc, options); },
    async create(input, actor) {
      const doc = createSessionDocument(input, { actor: actor.id });
      await store.create(doc);
      return verified(doc.id, doc);
    },
    async update(id, version, operations, actor) {
      const result = await store.update(id, version, operations, { actor });
      const doc = result.unchanged ? result.doc : await verified(id, result.doc);
      return { doc, changed: result.changed, unchanged: result.unchanged };
    }
  };
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new SessionError(413, "request_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); } catch { throw new SessionError(400, "malformed_json"); }
}

let defaultService = null;
// The real Dropbox, or (local development only, never on Render) a directory standing in for it.
export function defaultSessionService(env) {
  if (defaultService) return defaultService;
  const store = localStoreAllowed(env)
    ? createSessionDropboxStore({ env, fetchImpl: createLocalDropboxFetch(env.SESSION_LOCAL_STORE_DIR), getToken: async () => "local" })
    : createSessionDropboxStore({ env });
  return (defaultService = createSessionService(store));
}

// options: { env, service, mcp } (service/mcp are injected by tests; mcp is the T4 handler)
export async function handleSessionDirectorRequest(req, res, url, { env = process.env, service, mcp, now } = {}) {
  try {
    const route = url.pathname.slice(SESSION_API_PREFIX.length);
    if (route === "mcp") {
      if (!mcp) throw new SessionError(404, "not_found");
      return await mcp(req, res, { env, service });
    }
    const actor = authenticateWeb(req, env, { now });
    service ||= defaultSessionService(env);
    const id = url.searchParams.get("id");
    const methods = { projects: ["GET", "POST"], project: ["GET", "PUT"], cuesheet: ["GET"] }[route];
    if (!methods) throw new SessionError(404, "not_found");
    if (!methods.includes(req.method)) {
      res.setHeader("Allow", methods.join(", "));
      throw new SessionError(405, "method_not_allowed");
    }
    if (route === "projects" && req.method === "GET") return send(res, 200, { ok: true, projects: await service.list({ includeTest: url.searchParams.get("includeTest") === "1" }) });
    if (route === "projects") {
      const body = await readBody(req);
      return send(res, 201, { ok: true, project: sessionProjectView(await service.create(body?.session, actor)) });
    }
    if (route === "cuesheet") return send(res, 200, { ok: true, cueSheet: await service.cueSheet(id, { includeAnswers: url.searchParams.get("includeAnswers") === "1" }) });
    if (req.method === "GET") return send(res, 200, { ok: true, project: await service.project(id) });
    const body = await readBody(req);
    const result = await service.update(id, body?.version, body?.operations, actor);
    return send(res, 200, { ok: true, version: result.doc.version, unchanged: result.unchanged, changed: result.changed, project: sessionProjectView(result.doc) });
  } catch (error) {
    if (error instanceof SessionError) return send(res, error.status, { ok: false, error: error.code, message: error.message, ...error.details });
    return send(res, 500, { ok: false, error: "internal_error" });
  }
}
