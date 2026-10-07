// REKEY_INTERNAL_IDENTITY: move a single identity off a Cafe24-format code that Marketing OS minted
// itself and Cafe24 has not issued yet (code above the live Cafe24 maximum). Unlike
// SPLIT_CODE_IDENTITY there is no second identity: the same brand keeps name, aliases, active,
// nameSource, sourcing and explicit policy, and only its key moves to SPL_<hash>. The code goes to
// formerCodes so a later Cafe24 brand on it is detected as new instead of inheriting this identity.
//
// planInternalRekey() is pure. previewInternalRekey() reads (never writes) the work dir to show
// sourcing, attribution and archive impact through the official resolver/merge/rebuild functions.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeBrandKey, parseBrandAliases } from "./brand-engine.mjs";
import { CAFE24_CODE_PATTERN, internalIdentityCode } from "./cafe24-code-reuse.mjs";
import { loadResolverContext } from "./unified-identity-resolver.mjs";
import { mergeOfflineBrandSales } from "./monthly-brand-sales.mjs";
import { rebuildArchiveBrandSales } from "./archive-brand-attribution.mjs";
import { readEcountOfflineSalesSnapshot } from "./read-ecount-offline-sales-snapshot.mjs";
import { buildBrandSourcingMaster, loadInputs as loadSourcingInputs } from "./build-brand-sourcing-master.mjs";
import { readFile } from "node:fs/promises";

export const REKEY_ACTION = "REKEY_INTERNAL_IDENTITY";

export function rekeyError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

const brandsOf = (canonical) => (Array.isArray(canonical) ? canonical : canonical?.brands || []);
const withBrands = (canonical, brands) => (Array.isArray(canonical) ? brands : { ...canonical, brands });
// Cafe24 issues codes in strictly increasing order (verified 2026-10-07: 175/175 live brands), so
// plain string order of same-length codes is issue order.
const maxLiveCode = (cafe24Brands) => cafe24Brands.map((b) => String(b.brand_code || b.brandCode || "")).filter((c) => CAFE24_CODE_PATTERN.test(c)).sort().at(-1) || null;

/**
 * @returns {{ status: "ALREADY_REKEYED", code, brandCode } | { status: "PLANNED", version, preconditions, canonical, policies, productRegistry, identity, diff }}
 */
export function planInternalRekey({ canonical, policies = { policies: [] }, productRegistry = { entries: [] }, cafe24Brands = [], pendingCandidates = [], input, now = new Date().toISOString() }) {
  const code = String(input?.code || "");
  if (!CAFE24_CODE_PATTERN.test(code)) throw rekeyError("VALIDATION_FAILED", "code must be a Cafe24-format brand code", 400);
  const brands = brandsOf(canonical);
  const owners = brands.filter((b) => b.brand_code === code);
  const moved = brands.find((b) => b.brand_code !== code && (b.formerCodes || []).some((f) => f.code === code));
  if (!owners.length && moved) return { status: "ALREADY_REKEYED", code, brandCode: moved.brand_code };
  if (owners.length !== 1) throw rekeyError("NOT_FOUND", `Expected exactly one Brand Master entry on ${code}, found ${owners.length}`, 404);
  const owner = owners[0];

  // Eligibility: the code must still be unissued by Cafe24 and carry no second identity.
  if (!cafe24Brands.length) throw rekeyError("CAFE24_UNAVAILABLE", "Live Cafe24 brand list is required", 503);
  const max = maxLiveCode(cafe24Brands);
  if (cafe24Brands.some((b) => String(b.brand_code || b.brandCode || "") === code)) throw rekeyError("CAFE24_OWNED", `${code} is a live Cafe24 brand; use the split flow`);
  if (!(code > max)) throw rekeyError("NOT_AHEAD_OF_CAFE24", `${code} is not above the Cafe24 maximum ${max}`);
  if (owner.externalCodes?.cafe24) throw rekeyError("CAFE24_OWNED", `${code} records Cafe24 ownership`);
  if (moved) throw rekeyError("VERSION_CONFLICT", `${code} is already a former code of ${moved.brand_code}`);
  const openCandidates = pendingCandidates.filter((c) => c.status === "PENDING" && c.sourceBrandCode === code);
  if (openCandidates.length) throw rekeyError("COLLISION_PENDING", `${code} has pending candidates; a second identity may exist`);

  const splCode = internalIdentityCode(code, owner.brand_name);
  if (brands.some((b) => b.brand_code === splCode)) throw rekeyError("VERSION_CONFLICT", `Internal code ${splCode} already exists`);

  const preconditions = { code, brandName: owner.brand_name, aliases: parseBrandAliases(owner.name_aliases), active: owner.active !== false,
    nameSource: owner.nameSource ?? null, cafe24MaxCode: max, targetCode: splCode };
  const version = createHash("sha256").update(JSON.stringify(preconditions)).digest("hex").slice(0, 16);
  if (input.expectedVersion !== undefined && input.expectedVersion !== version) throw rekeyError("VERSION_CONFLICT", "State changed since the dry-run");

  const identity = {
    ...owner,
    brand_code: splCode,
    name_aliases: parseBrandAliases(owner.name_aliases).filter((alias) => normalizeBrandKey(alias) !== normalizeBrandKey(code)),
    identityCode: splCode,
    externalCodes: { cafe24: null },
    formerCodes: [...(owner.formerCodes || []), { code, source: "MARKETING_OS_MINTED", until: null }]
  };
  const nextBrands = brands.map((b) => (b === owner ? identity : b));

  const policyRows = Array.isArray(policies?.policies) ? policies.policies : [];
  const movedPolicies = policyRows.filter((p) => p.brand_code === code);
  const nextPolicies = { ...policies, policies: policyRows.map((p) => (p.brand_code === code ? { ...p, brand_code: splCode, identity_rekey: { fromBrandCode: code, action: REKEY_ACTION, at: now } } : p)) };

  // Single identity: every registry entry on the code belongs to it.
  const entries = Array.isArray(productRegistry?.entries) ? productRegistry.entries : [];
  const movedEntries = entries.filter((e) => e.brandId === code);
  const nextRegistry = { ...productRegistry, entries: entries.map((e) => (e.brandId === code ? { ...e, brandId: splCode } : e)) };

  return {
    status: "PLANNED", version, preconditions,
    canonical: withBrands(canonical, nextBrands), policies: nextPolicies, productRegistry: nextRegistry, identity,
    diff: {
      brandMaster: { before: [owner], after: [identity] },
      commercialPolicy: { before: movedPolicies, after: movedPolicies.map((p) => ({ ...p, brand_code: splCode })) },
      productRegistry: { moved: movedEntries.map((e) => ({ id: e.id ?? e.canonicalProductId ?? null, from: code, to: splCode })) }
    }
  };
}

const monthsBetween = (from, to) => {
  const months = [];
  for (let month = from; month <= to;) {
    months.push(month);
    const [y, m] = month.split("-").map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return months;
};
const monthEnd = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * Read-only impact preview. For each month: offline attribution before/after through the official
 * merge, and for saved archives the brand-attribution rebuild (which first proves the saved archive
 * is reproduced exactly, then that totals are unchanged).
 */
export async function previewInternalRekey(plan, beforeCanonical, { workDir, fromMonth, toMonth, closedBefore }) {
  const from = plan.preconditions.code;
  const to = plan.identity.brand_code;
  const months = [];
  for (const month of monthsBetween(fromMonth, toMonth)) {
    const since = `${month}-01`;
    const until = monthEnd(month);
    const archive = await readFile(join(workDir, "monthly", `${month}.json`), "utf8").then(JSON.parse).catch(() => null);
    const snapshot = await readEcountOfflineSalesSnapshot(month, { workDir });
    const lines = Array.isArray(snapshot?.salesLines) ? snapshot.salesLines : [];
    const onlineCatalog = archive?.commerce ? { brands: archive.commerce.brandSales || [], products: archive.commerce.productSales || [] } : undefined;
    const [beforeCtx, afterCtx] = await Promise.all([
      loadResolverContext({ workDir, onlineCatalog, brandMaster: beforeCanonical }),
      loadResolverContext({ workDir, onlineCatalog, brandMaster: plan.canonical, productRegistry: plan.productRegistry })
    ]);
    const before = mergeOfflineBrandSales({ offlineLines: lines, since, until, identityContext: beforeCtx });
    const after = mergeOfflineBrandSales({ offlineLines: lines, since, until, identityContext: afterCtx });
    const amount = (list, code) => list.find((row) => row.brand_code === code)?.offlineSalesAmount || 0;
    const sum = (list) => list.reduce((total, row) => total + Number(row.offlineSalesAmount || 0), 0);
    // Every other bucket must be identical: only the key moves.
    const others = (list) => JSON.stringify(list.filter((row) => ![from, to].includes(row.brand_code)).map((row) => [row.brand_code, row.offlineSalesAmount]).sort());
    const row = {
      month,
      offline: { before: { [from]: amount(before, from), [to]: amount(before, to) }, after: { [from]: amount(after, from), [to]: amount(after, to) } },
      monthOfflineTotal: { before: sum(before), after: sum(after), preserved: sum(before) === sum(after) },
      balanced: amount(before, from) + amount(before, to) === amount(after, from) + amount(after, to) && amount(after, from) === 0,
      otherBrandsUnchanged: others(before) === others(after)
    };
    if (archive?.archiveStatus === "saved" && month < closedBefore) {
      try {
        const names = new Map([[to, plan.identity.brand_name]]);
        const rebuilt = rebuildArchiveBrandSales({ brandSales: archive.commerce?.brandSales || [], before, after, names });
        row.archive = { reproduction: "OK", totals: rebuilt.totals, changes: rebuilt.changes };
      } catch (error) {
        row.archive = { reproduction: "FAILED", error: error.code || "ARCHIVE_REBUILD_FAILED", message: error.message };
      }
    } else {
      row.archive = { reproduction: "NOT_APPLICABLE", reason: archive ? `archiveStatus ${archive.archiveStatus}` : "no saved archive" };
    }
    months.push(row);
  }
  let sourcing;
  try {
    const inputs = await loadSourcingInputs(workDir);
    const pick = (result, code) => result.brands.find((b) => b.brand_code === code) || null;
    sourcing = { before: pick(buildBrandSourcingMaster({ ...inputs, brandMaster: beforeCanonical }), from), after: pick(buildBrandSourcingMaster({ ...inputs, brandMaster: plan.canonical }), to) };
  } catch (error) {
    sourcing = { error: error.message };
  }
  return { months, sourcing };
}

// One-click scope: an identity with explicit policy rows still needs a reviewed plan for those rows.
// ponytail: blocks any re-key that would move policy rows; lift when such a case is reviewed.
export function rekeyReasons(dry) {
  if (dry.status !== "PLANNED") return [dry.status || "NOT_PLANNED"];
  const reasons = [];
  const months = dry.months || [];
  if (!months.length) reasons.push("NO_ATTRIBUTION_PREVIEW");
  for (const m of months) {
    if (m.monthOfflineTotal?.preserved !== true) reasons.push(`${m.month}:OFFLINE_TOTAL_NOT_PRESERVED`);
    if (m.balanced !== true) reasons.push(`${m.month}:NOT_BALANCED`);
    if (m.otherBrandsUnchanged !== true) reasons.push(`${m.month}:OTHER_BRANDS_CHANGED`);
    if (m.archive?.reproduction === "FAILED") reasons.push(`${m.month}:ARCHIVE_SOURCE_MISMATCH`);
  }
  if ((dry.diff?.commercialPolicy?.before || []).length) reasons.push("EXPLICIT_POLICY_PRESENT");
  const sourcing = dry.diff?.sourcing;
  if (!sourcing || sourcing.error || !sourcing.before || sourcing.before.sourcing_type !== sourcing.after?.sourcing_type ||
      JSON.stringify(sourcing.before.coverage) !== JSON.stringify(sourcing.after?.coverage)) reasons.push("SOURCING_CHANGED");
  return reasons;
}

// Everything the operator reviewed; any change between dry-run and execute invalidates the token.
export function rekeyResultHash(dry) {
  return createHash("sha256").update(JSON.stringify({ version: dry.version, preconditions: dry.preconditions, identity: dry.identity, diff: dry.diff,
    months: dry.months, sources: dry.sources, resolver: dry.resolver })).digest("hex");
}

const rekeyFailure = (code, message, status = 409) => rekeyError(code, message, status);

/**
 * Same safety model as createIdentitySplitRunner: dry-run issues a single-use token bound to the code,
 * version and result hash; execute re-validates, writes with a backup, verifies, rebuilds the affected
 * archives (dry-run, write, compare with the preview to the exact won), verifies again, and restores the
 * backup byte for byte on any failure. deps: enabled, busy, plan, write, verify, rebuild, archiveRows, restore.
 */
export function createIdentityRekeyRunner(deps, { registry }) {
  let running = false;
  const bindingOf = (dry) => ({ candidateId: dry.preconditions.code, version: dry.version, resultHash: rekeyResultHash(dry) });
  const archiveMonthsOf = (dry) => (dry.months || []).filter((m) => m.archive?.reproduction === "OK");

  async function dryRun(code) {
    const dry = await deps.plan(code);
    if (dry.status !== "PLANNED") return { ok: true, dryRun: true, ...dry, execution: { eligible: false, reasons: rekeyReasons(dry) } };
    const reasons = rekeyReasons(dry);
    const eligible = reasons.length === 0;
    const issued = eligible ? registry.issue(bindingOf(dry)) : null;
    return { ok: true, dryRun: true, ...dry, execution: { eligible, reasons, writeEnabled: deps.enabled() === true, ...(issued || {}) } };
  }

  async function execute(code, token) {
    if (deps.enabled() !== true) throw rekeyFailure("SPLIT_WRITE_DISABLED", "Identity writes are disabled by the global kill switch", 403);
    if (running || deps.busy?.()) throw rekeyFailure("REKEY_BUSY", "Another identity change is running");
    running = true;
    const steps = [];
    let stage = "token";
    let backupId = null;
    try {
      const binding = registry.consume(token, code);
      steps.push({ stage });

      stage = "revalidate";
      const dry = await deps.plan(code);
      const reasons = rekeyReasons(dry);
      if (reasons.length) throw rekeyFailure("PREFLIGHT_FAILED", reasons.join(","));
      const fresh = bindingOf(dry);
      if (fresh.version !== binding.version) throw rekeyFailure("VERSION_CONFLICT", "State changed since the dry-run");
      if (fresh.resultHash !== binding.resultHash) throw rekeyFailure("DRY_RUN_CHANGED", "Dry-run result changed");
      steps.push({ stage, version: dry.version });

      stage = "rekey";
      const months = archiveMonthsOf(dry);
      let result;
      try {
        result = await deps.write(code, dry.version, months.map((m) => m.month));
      } catch (error) {
        backupId = error.backup?.backupId || null;
        throw error;
      }
      backupId = result.backup?.backupId || null;
      if (!backupId) throw rekeyFailure("BACKUP_MISSING", "Re-key returned without a backup");
      if (result.sourcingRefresh?.ok !== true) throw rekeyFailure("SOURCING_REFRESH_FAILED", result.sourcingRefresh?.error || "sourcing rebuild failed");
      steps.push({ stage, backupId });

      stage = "verify";
      await deps.verify(dry);
      steps.push({ stage });

      stage = "archive";
      const archives = [];
      for (const m of months) {
        const preview = await deps.rebuild(m.month, backupId, true);
        if (!preview.ok) throw rekeyFailure("ARCHIVE_REBUILD_FAILED", `${m.month} dry-run failed`);
        const written = await deps.rebuild(m.month, backupId, false);
        if (!written.ok) throw rekeyFailure("ARCHIVE_REBUILD_FAILED", `${m.month} write failed`);
        // Every row the reviewed preview changed must land on exactly the previewed amounts, and the
        // archive totals must equal the previewed totals.
        const rows = await deps.archiveRows(m.month);
        const amount = (c) => rows.filter((r) => r.brand_code === c).reduce((s, r) => s + Number(r.salesAmount || 0), 0);
        for (const change of m.archive.changes || []) {
          if (amount(change.brand_code) !== change.after.salesAmount) {
            throw rekeyFailure("ARCHIVE_ATTRIBUTION_MISMATCH", `${m.month} ${change.brand_code} expected ${change.after.salesAmount}, got ${amount(change.brand_code)}`);
          }
        }
        if (JSON.stringify(written.totals) !== JSON.stringify(m.archive.totals)) throw rekeyFailure("ARCHIVE_TOTAL_MISMATCH", `${m.month} totals differ from the preview`);
        archives.push({ month: m.month, totals: written.totals, [dry.preconditions.code]: amount(dry.preconditions.code), [dry.identity.brand_code]: amount(dry.identity.brand_code) });
      }
      steps.push({ stage, months: archives.map((a) => a.month) });

      stage = "final";
      await deps.verify(dry);
      steps.push({ stage });
      return { ok: true, status: "COMPLETE", action: REKEY_ACTION, code, brandCode: dry.identity.brand_code, brandName: dry.identity.brand_name, backupId, version: dry.version, archives, steps };
    } catch (error) {
      const failure = { ok: false, status: "FAILED", stage, error: error.code || "REKEY_FAILED", message: error.message, code, backupId, rolledBack: false, steps };
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

  return { dryRun, execute, isRunning: () => running };
}
