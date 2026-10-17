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
import { createAssetService } from "./session-assets.mjs";
import { applyParticipantOperations, hmacKeyReady, mergeSync, parseSheetRows, participantSummary, participantsView } from "./session-participants.mjs";
import { readSheetRows, sheetsConfigured } from "./session-sheets.mjs";

import { createParticipantImportService } from "./session-participant-import.mjs";

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
export function createSessionService(store, { env = process.env, fetchImpl = fetch, readRows = readSheetRows } = {}) {
  const assets = createAssetService(store, { env });
  const participantImport = createParticipantImportService(store, { env, fetchImpl, readRows });
  // Real participant data is synced only when every guard is in place (SESSION_PARTICIPANTS_SYNC=on is the switch).
  const syncAvailable = () => env.SESSION_PARTICIPANTS_SYNC === "on" && hmacKeyReady(env) && sheetsConfigured(env);
  const allowFormLink = (id) => Number(String(id).split("-").pop()) >= 3; // SESSION 001/002 never publish an application link
  async function participantsVerified(id, expected) {
    const { doc } = await store.readParticipants(id);
    if (JSON.stringify(doc) !== JSON.stringify(expected)) throw new SessionError(502, "write_unverified", "participants did not read back as written", { currentVersion: doc.version });
    return doc;
  }
  const participantsOut = (id, doc) => ({ ...participantsView(doc), syncAvailable: syncAvailable(), formLinkAllowed: allowFormLink(id), autoSync: participantImport.autoSyncStatus(id,doc) });
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
    },
    assets: (id) => assets.list(id),
    assetThumbnail: (id, path) => assets.thumbnail(id, path),
    assetLink: (id, path) => assets.link(id, path),
    participantImportReadiness: () => participantImport.readiness(),
    autoSyncParticipants: (id) => participantImport.autoSync(id),
    previewParticipantImport: (id, input, actor) => participantImport.preview(id, input, actor),
    importParticipants: (id, input, actor) => participantImport.commit(id, input, actor),
    async participantCounts(id) {
      const { doc } = await store.readParticipants(id);
      const { syncError, ...summary } = participantSummary(doc);
      return { sessionId: id, version: doc.version, capacity: doc.capacity, people: [], summary, syncAvailable: syncAvailable(), formLinkAllowed: allowFormLink(id), detailsWithheld: true };
    },
    async participants(id) { return participantsOut(id, (await store.readParticipants(id)).doc); },
    async updateParticipants(id, version, operations, actor) {
      const { doc, rev } = await store.readParticipants(id);
      if (doc.version !== version) throw new SessionError(409, "version_conflict", "participants changed since they were read", { currentVersion: doc.version });
      const next = applyParticipantOperations(doc, operations, { actor, allowFormLink: allowFormLink(id) });
      await store.writeParticipants(id, next, rev);
      return participantsOut(id, await participantsVerified(id, next));
    },
    // Reads the response sheet (read-only) and merges it. A failed read is recorded without touching people.
    async syncParticipants(id, version, actor) {
      if (!syncAvailable()) throw new SessionError(503, "participants_sync_disabled", "participant sync is off until operator sign-in, the HMAC key and the SESSION service account are set");
      const { doc, rev } = await store.readParticipants(id);
      if (doc.version !== version) throw new SessionError(409, "version_conflict", "participants changed since they were read", { currentVersion: doc.version });
      if (!doc.form.sheetId) throw new SessionError(409, "sheet_not_set", "set the response sheet first");
      const next = structuredClone(doc);
      const at = new Date().toISOString();
      let result;
      try {
        result = mergeSync(next, parseSheetRows(await readRows({ env, sheetId: doc.form.sheetId, range: doc.form.sheetRange, fetchImpl }), env, { sessionId: id }), { now: at });
      } catch (error) {
        if (!(error instanceof SessionError)) throw error;
        next.sync = { ...next.sync, lastAttemptAt: at, lastError: { code: error.code, at, ...(error.details?.missing ? { missing: error.details.missing, extra: error.details.extra } : {}) } };
        next.version += 1;
        next.updatedAt = at;
        await store.writeParticipants(id, next, rev);
        throw error;
      }
      next.version += 1;
      next.updatedAt = at;
      next.log = [...next.log, { v: next.version, at, actor: actor.id, op: "sync_participants", participantId: null, added: result.added, updated: result.updated, removed: result.removed }].slice(-500);
      await store.writeParticipants(id, next, rev);
      return { ...participantsOut(id, await participantsVerified(id, next)), result };
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
  return (defaultService = createSessionService(store, { env }));
}

// Render keeps polling without a browser; tests and Mac servers never start this implicitly.
export function startParticipantAutoSync(getService, schedule=setInterval) {
  const timer=schedule(async()=>{try{await getService().autoSyncParticipants('session-001');}catch{/* No raw errors or row data in logs. */}},60000);
  timer.unref?.();return timer;
}
if(process.env.RENDER==='true'&&process.env.IS_PULL_REQUEST==='false'&&process.env.NODE_ENV==='production')startParticipantAutoSync(()=>defaultSessionService(process.env));

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
    const methods = { projects: ["GET", "POST"], project: ["GET", "PUT"], cuesheet: ["GET"], assets: ["GET"], "asset-thumbnail": ["GET"], "asset-link": ["GET"],
      participants: ["GET", "PUT"], "participants-sync": ["POST"],
      "participants-import-status": ["GET"], "participants-import-preview": ["POST"], "participants-import": ["POST"] }[route];
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
    if (route === "assets") return send(res, 200, { ok: true, ...(await service.assets(id)) });
    if (route === "asset-link") return send(res, 200, { ok: true, ...(await service.assetLink(id, url.searchParams.get("path"))) });
    if (route === "asset-thumbnail") {
      const { bytes, type } = await service.assetThumbnail(id, url.searchParams.get("path"));
      res.writeHead(200, { "Content-Type": /^image\//.test(type) ? type : "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(bytes);
    }
    if (route === "participants-import-status") return send(res, 200, { ok: true, readiness: service.participantImportReadiness() });
    if (route === "participants-import-preview") return send(res, 200, { ok: true, preview: await service.previewParticipantImport(id, await readBody(req), actor) });
    if (route === "participants-import") return send(res, 200, { ok: true, ...(await service.importParticipants(id, await readBody(req), actor)) });
    // Operator REST (web secret + signed actor): the list with phone numbers, so signed-in operators and staff can confirm, notify and check in.
    // The public Vercel proxy refuses this route itself; MCP gets counts only (participantCounts).
    if (route === "participants" && req.method === "GET") return send(res, 200, { ok: true, participants: await service.participants(id) });
    if (route === "participants") {
      const body = await readBody(req);
      return send(res, 200, { ok: true, participants: await service.updateParticipants(id, body?.version, body?.operations, actor) });
    }
    if (route === "participants-sync") {
      const body = await readBody(req);
      // Legacy URL uses the same preview token, source checks, CAS and readback; no bypass.
      return send(res, 200, { ok: true, ...(await service.importParticipants(id, body, actor)) });
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
