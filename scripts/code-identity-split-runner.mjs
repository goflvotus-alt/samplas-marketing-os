// One-click SPLIT_CODE_IDENTITY (Phase 3B). A dry-run that passes every safety check issues a
// short-lived, single-use execution token bound to that candidate and that exact dry-run result.
// Executing with the token re-validates, backs up, splits, verifies, rebuilds the affected archives
// and verifies again; any failure after the backup restores it byte for byte. Runs never overlap.
//
// Everything that touches files or the server is injected (deps), so the same runner serves the
// UI route and a future sequential batch runner.
import { createHash, randomBytes } from "node:crypto";
import { SPLIT_ACTION } from "./code-identity-split.mjs";
import { CODE_REUSE_REVIEW_REASON } from "./cafe24-code-reuse.mjs";

export const SPLIT_TOKEN_TTL_MS = 10 * 60 * 1000;
// Only a collision with a code Marketing OS minted itself is safe enough for one-click execution.
export const ONE_CLICK_CLASSIFICATIONS = new Set(["MINTED_CODE_COLLISION"]);

export function runnerError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

// Hash of everything the operator reviewed; any change between dry-run and execution invalidates the token.
export function splitResultHash(dry) {
  const { brandMaster, commercialPolicy, productRegistry, pendingQueue } = dry.diff || {};
  return createHash("sha256").update(JSON.stringify({ version: dry.version, preconditions: dry.preconditions, effectiveMonth: dry.effectiveMonth,
    oldIdentity: dry.oldIdentity, newIdentity: dry.newIdentity, diff: { brandMaster, commercialPolicy, productRegistry, pendingQueue }, attribution: dry.attribution })).digest("hex");
}

// Server-side nonce registry: the token is an opaque random id; all bound data stays on the server.
// ponytail: in-memory, so a restart invalidates outstanding tokens (the operator just dry-runs again).
export function createSplitTokenRegistry({ ttlMs = SPLIT_TOKEN_TTL_MS, now = () => Date.now() } = {}) {
  const tokens = new Map();
  const purge = () => { for (const [token, entry] of tokens) if (entry.expiresAt <= now()) tokens.delete(token); };
  return {
    issue(binding) {
      purge();
      const token = randomBytes(24).toString("hex");
      const expiresAt = now() + ttlMs;
      tokens.set(token, { binding, expiresAt, used: false });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },
    consume(token, candidateId) {
      if (!token) throw runnerError("SPLIT_TOKEN_REQUIRED", "Run the dry-run first; execution needs its token", 403);
      const entry = tokens.get(String(token));
      if (!entry) throw runnerError("SPLIT_TOKEN_INVALID", "Unknown or expired token; dry-run again", 403);
      if (entry.expiresAt <= now()) { tokens.delete(String(token)); throw runnerError("SPLIT_TOKEN_EXPIRED", "Token expired; dry-run again", 403); }
      if (entry.used) throw runnerError("SPLIT_TOKEN_USED", "Token already used; dry-run again", 403);
      if (entry.binding.candidateId !== candidateId) throw runnerError("SPLIT_TOKEN_MISMATCH", "Token was issued for another candidate", 403);
      entry.used = true;
      return entry.binding;
    }
  };
}

// Read-back after the split: both identities, policy keys, resolver and pending state must match the dry-run.
export function checkSplitReadBack(dry, { brands = [], policies = [], candidate = null, resolveName = () => null }) {
  const fail = (message) => { throw runnerError("READ_BACK_MISMATCH", message); };
  const oldCode = dry.oldIdentity.brand_code;
  const code = dry.newIdentity.brand_code;
  const oldEntry = brands.filter((b) => b.brand_code === oldCode);
  const newEntry = brands.filter((b) => b.brand_code === code);
  if (oldEntry.length !== 1 || oldEntry[0].brand_name !== dry.oldIdentity.brand_name || oldEntry[0].active !== dry.oldIdentity.active ||
      !(oldEntry[0].formerCodes || []).some((f) => f.code === code) || oldEntry[0].externalCodes?.cafe24) fail(`old identity ${oldCode} not as planned`);
  if (newEntry.length !== 1 || newEntry[0].brand_name !== dry.newIdentity.brand_name || newEntry[0].active !== true ||
      newEntry[0].externalCodes?.cafe24?.code !== code || newEntry[0].externalCodes?.cafe24?.since !== dry.effectiveMonth) fail(`new identity ${code} not as planned`);
  if (policies.some((p) => p.brand_code === code)) fail(`explicit policy left on ${code}`);
  if (policies.filter((p) => p.brand_code === oldCode).length !== (dry.diff?.commercialPolicy?.before || []).length) fail(`policy rows not moved to ${oldCode}`);
  for (const [name, expected] of [[dry.newIdentity.brand_name, code], [dry.oldIdentity.brand_name, oldCode]]) {
    const actual = resolveName(name);
    if (actual !== expected) fail(`resolver maps ${name} to ${actual ?? "nothing"}, expected ${expected}`);
  }
  if (candidate?.status !== "APPROVED" || candidate.approvalAction !== SPLIT_ACTION) fail("pending candidate not APPROVED by the split");
}

const bindingOf = (dry) => ({
  candidateId: dry.preconditions.pendingId, version: dry.version, owner: dry.preconditions.previousCanonicalBrand, ownerCode: dry.preconditions.previousCanonicalCode,
  cafe24Brand: dry.preconditions.currentCafe24Brand, code: dry.preconditions.code, classification: dry.preconditions.classification,
  effectiveMonth: dry.effectiveMonth, resultHash: splitResultHash(dry)
});
const archiveMonths = (dry) => (dry.attribution?.months || []).filter((m) => m.treatment === "ARCHIVE_REBUILD").map((m) => m.month);

/**
 * deps:
 *   enabled()                          global kill switch (CODE_IDENTITY_SPLIT_WRITE)
 *   planDryRun(id)                     SPLIT_CODE_IDENTITY dryRun:true with attribution preview
 *   readCandidate(id)                  pending candidate as stored
 *   archiveCheck(month)                archive consistency dry-run (no backupId) -> { ok, changes }
 *   split(id, version)                 SPLIT_CODE_IDENTITY dryRun:false -> { backup, sourcingRefresh, ... }
 *   verifySplit(dry)                   read-back of Brand Master / policy / resolver / pending; throws on mismatch
 *   rebuild(month, backupId, dryRun)   brand-attribution-only archive rebuild
 *   archiveRows(month)                 saved commerce.brandSales after the rebuild
 *   restore(backupId)                  byte-exact restore of the split backup
 */
export function createIdentitySplitRunner(deps, { registry = createSplitTokenRegistry() } = {}) {
  let running = false;

  async function check(id) {
    const dry = await deps.planDryRun(id);
    if (dry.status !== "PLANNED") return { dry, reasons: [dry.status || "NOT_PLANNED"], archiveChecks: [] };
    const candidate = await deps.readCandidate(id);
    const reasons = [];
    if (candidate?.status !== "PENDING") reasons.push("CANDIDATE_NOT_PENDING");
    if (candidate?.reviewReason !== CODE_REUSE_REVIEW_REASON) reasons.push("NOT_CODE_REUSE_SPLIT_REQUIRED");
    if (candidate?.requiresIdentitySplit !== true) reasons.push("NOT_REQUIRES_IDENTITY_SPLIT");
    if (!ONE_CLICK_CLASSIFICATIONS.has(dry.preconditions?.classification)) reasons.push("MANUAL_REVIEW_CLASSIFICATION");
    if (!dry.preconditions?.suggestedEffectiveMonth) reasons.push("NO_EFFECTIVE_MONTH");
    const months = dry.attribution?.months || [];
    if (!months.length) reasons.push("NO_ATTRIBUTION_PREVIEW");
    if (months.some((m) => m.monthOfflineTotal?.preserved !== true)) reasons.push("OFFLINE_TOTAL_NOT_PRESERVED");
    if (months.some((m) => m.reconciliation?.balanced !== true)) reasons.push("NOT_BALANCED");
    // Policy preview: old explicit rows must all leave the Cafe24 code for the internal identity.
    if ((dry.diff?.commercialPolicy?.after || []).some((p) => p.brand_code !== dry.oldIdentity?.brand_code)) reasons.push("POLICY_PREVIEW_MISMATCH");
    const archiveChecks = [];
    for (const month of archiveMonths(dry)) {
      try {
        const result = await deps.archiveCheck(month);
        archiveChecks.push({ month, ok: result.ok === true && (result.changes || []).length === 0 });
      } catch (error) {
        archiveChecks.push({ month, ok: false, error: error.code || "ARCHIVE_CHECK_FAILED" });
      }
    }
    if (archiveChecks.some((c) => !c.ok)) reasons.push("ARCHIVE_SOURCE_MISMATCH");
    return { dry, reasons, archiveChecks };
  }

  async function dryRun(id) {
    const { dry, reasons, archiveChecks } = await check(id);
    if (dry.status === "ALREADY_SPLIT") return { ...dry, execution: { eligible: false, reasons } };
    const eligible = reasons.length === 0;
    const issued = eligible ? registry.issue(bindingOf(dry)) : null;
    return { ...dry, execution: { eligible, reasons, archiveChecks, writeEnabled: deps.enabled() === true, ...(issued || {}) } };
  }

  async function execute(id, token) {
    if (deps.enabled() !== true) throw runnerError("SPLIT_WRITE_DISABLED", "Identity-split writes are disabled by the global kill switch", 403);
    if (running || deps.busy?.()) throw runnerError("SPLIT_BUSY", "Another identity split is running", 409);
    running = true;
    const steps = [];
    let stage = "token";
    let backupId = null;
    try {
      const binding = registry.consume(token, id);
      steps.push({ stage });

      stage = "revalidate";
      const { dry, reasons } = await check(id);
      if (reasons.length) throw runnerError("PREFLIGHT_FAILED", reasons.join(","));
      const fresh = bindingOf(dry);
      if (fresh.version !== binding.version) throw runnerError("VERSION_CONFLICT", "State changed since the dry-run");
      for (const key of Object.keys(binding)) if (fresh[key] !== binding[key]) throw runnerError("DRY_RUN_CHANGED", `Dry-run result changed (${key})`);
      steps.push({ stage, version: dry.version });

      stage = "split";
      let result;
      try {
        result = await deps.split(id, dry.version);
      } catch (error) {
        backupId = error.backup?.backupId || null;
        throw error;
      }
      backupId = result.backup?.backupId || null;
      if (!backupId) throw runnerError("BACKUP_MISSING", "Split returned without a backup");
      if (result.sourcingRefresh && result.sourcingRefresh.ok === false) throw runnerError("SOURCING_REFRESH_FAILED", result.sourcingRefresh.error || "sourcing rebuild failed");
      steps.push({ stage, backupId });

      stage = "verify";
      await deps.verifySplit(dry);
      steps.push({ stage });

      stage = "archive";
      const archives = [];
      for (const m of (dry.attribution?.months || []).filter((x) => x.treatment === "ARCHIVE_REBUILD")) {
        const preview = await deps.rebuild(m.month, backupId, true);
        if (!preview.ok) throw runnerError("ARCHIVE_REBUILD_FAILED", `${m.month} dry-run failed`);
        const written = await deps.rebuild(m.month, backupId, false);
        if (!written.ok) throw runnerError("ARCHIVE_REBUILD_FAILED", `${m.month} write failed`);
        const rows = await deps.archiveRows(m.month);
        const amount = (code) => rows.filter((r) => r.brand_code === code).reduce((s, r) => s + Number(r.salesAmount || 0), 0);
        const actual = { old: amount(dry.oldIdentity.brand_code), new: amount(dry.newIdentity.brand_code) };
        // The rebuild must land exactly where the reviewed preview said it would.
        if (actual.old !== m.after.old.total || actual.new !== m.after.new.total) {
          throw runnerError("ARCHIVE_ATTRIBUTION_MISMATCH", `${m.month} expected ${m.after.old.total}/${m.after.new.total}, got ${actual.old}/${actual.new}`);
        }
        archives.push({ month: m.month, totals: written.totals, old: actual.old, new: actual.new });
      }
      steps.push({ stage, months: archives.map((a) => a.month) });

      stage = "final";
      await deps.verifySplit(dry);
      steps.push({ stage });
      return { ok: true, status: "COMPLETE", action: SPLIT_ACTION, candidateId: id, backupId, version: dry.version,
        oldIdentity: { brand_code: dry.oldIdentity.brand_code, brand_name: dry.oldIdentity.brand_name },
        newIdentity: { brand_code: dry.newIdentity.brand_code, brand_name: dry.newIdentity.brand_name }, archives, steps };
    } catch (error) {
      const failure = { ok: false, status: "FAILED", stage, error: error.code || "SPLIT_FAILED", message: error.message, candidateId: id, backupId, rolledBack: false, steps };
      if (backupId) {
        try {
          await deps.restore(backupId);
          failure.rolledBack = true;
        } catch (restoreError) {
          failure.error = "ROLLBACK_FAILED";
          failure.rollbackError = restoreError.code || restoreError.message;
        }
      }
      const status = Number(error.status);
      failure.httpStatus = failure.rolledBack ? 409 : !backupId && status >= 400 && status < 500 ? status : 500;
      return failure;
    } finally {
      running = false;
    }
  }

  // Sequential batch: one candidate at a time, each with its own token/backup; stop at the first failure.
  async function runBatch(items) {
    const results = [];
    for (const { id, token } of items) {
      const result = await execute(id, token).catch((error) => ({ ok: false, status: "FAILED", stage: "token", error: error.code || "SPLIT_FAILED", message: error.message, candidateId: id, rolledBack: false }));
      results.push(result);
      if (!result.ok) break;
    }
    return { ok: results.length === items.length && results.every((r) => r.ok), results };
  }

  return { dryRun, execute, runBatch, isRunning: () => running };
}
