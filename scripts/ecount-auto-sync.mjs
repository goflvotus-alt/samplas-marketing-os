// Daily ECOUNT product master refresh: full sync → (canonical + product-master replaced
// atomically inside sync) → pending brand refresh with NEW-only AUTO_SAFE → sourcing refresh.
// The attempt is recorded on disk before running, so restarts never repeat a day's attempt.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ECOUNT_AUTO_SYNC_HOUR_KST = 4;
export const ECOUNT_AUTO_SYNC_STATUS_FILE = "ecount-inventory/auto-sync-status.json";

const kstParts = date => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
}).formatToParts(date).map(p => [p.type, p.value]));
export const kstDateKey = date => { const p = kstParts(date); return `${p.year}-${p.month}-${p.day}`; };
const kstHour = date => Number(kstParts(date).hour);

// One attempt per KST day, from 04:00 on. Covers both the 04:00 run and a later catch-up.
export function isEcountAutoSyncDue(now, status) {
  return kstHour(now) >= ECOUNT_AUTO_SYNC_HOUR_KST && status?.lastAttemptDate !== kstDateKey(now);
}

export function nextEcountAutoSyncAt(now, status) {
  const today = kstDateKey(now);
  const at = day => new Date(`${day}T${String(ECOUNT_AUTO_SYNC_HOUR_KST).padStart(2, "0")}:00:00+09:00`);
  if (status?.lastAttemptDate !== today) return (kstHour(now) >= ECOUNT_AUTO_SYNC_HOUR_KST ? now : at(today)).toISOString();
  return at(kstDateKey(new Date(at(today).getTime() + 24 * 60 * 60 * 1000))).toISOString();
}

export async function readEcountAutoSyncStatus(workDir) {
  try { return JSON.parse(await readFile(join(workDir, ECOUNT_AUTO_SYNC_STATUS_FILE), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
}

async function writeStatus(workDir, status) {
  const file = join(workDir, ECOUNT_AUTO_SYNC_STATUS_FILE);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(status, null, 2)}\n`);
  await rename(temp, file);
}

const message = error => String(error?.message || error).slice(0, 500);

// sync: () => syncEcountInventory result; onboard: () => { approvedCount, ... };
// refreshSourcing: () => sourcing master. Each step is injected so tests run offline.
export function createEcountAutoSync({ workDir, sync, onboard, refreshSourcing, now = () => new Date() }) {
  let running = false;
  async function run({ force = false } = {}) {
    if (running) return { ok: false, skipped: "running" };
    running = true;
    try {
      const status = await readEcountAutoSyncStatus(workDir);
      const startedAt = now();
      const today = kstDateKey(startedAt);
      if (!force && !isEcountAutoSyncDue(startedAt, status)) return { ok: false, skipped: "not-due" };
      if (status.lastSuccessDate === today) return { ok: false, skipped: "already-succeeded-today" };
      Object.assign(status, { lastAttemptAt: startedAt.toISOString(), lastAttemptDate: today, lastTrigger: force ? "manual" : "schedule" });
      await writeStatus(workDir, status);

      let result;
      try {
        result = await sync();
      } catch (error) {
        // Canonical inventory is untouched: sync throws before its atomic replace.
        Object.assign(status, { lastError: message(error), lastFailedAt: now().toISOString() });
        await writeStatus(workDir, status);
        return { ok: false, error: status.lastError };
      }
      Object.assign(status, {
        lastSuccessAt: now().toISOString(), lastSuccessDate: today, lastError: null,
        lastProductCount: result.productCount,
        lastPageCount: result.productPagination?.pageCount ?? null,
        lastDuplicateCount: result.productPagination?.duplicateCount ?? null
      });
      await writeStatus(workDir, status);

      // Inventory is already verified and committed; onboarding failures are only reported.
      try {
        const onboarding = await onboard();
        Object.assign(status, { lastOnboardingApprovedCount: onboarding.approvedCount, lastOnboardingApproved: onboarding.approved || [], lastOnboardingError: onboarding.error || null });
      } catch (error) {
        Object.assign(status, { lastOnboardingApprovedCount: 0, lastOnboardingApproved: [], lastOnboardingError: message(error) });
      }
      try {
        const sourcing = await refreshSourcing();
        Object.assign(status, { lastSourcingRefreshAt: sourcing?.generatedAt ?? now().toISOString(), lastSourcingError: null });
      } catch (error) {
        status.lastSourcingError = message(error);
      }
      await writeStatus(workDir, status);
      return { ok: true, status };
    } finally {
      running = false;
    }
  }
  async function getStatus() {
    const status = await readEcountAutoSyncStatus(workDir);
    return { ...status, running, schedule: `daily ${String(ECOUNT_AUTO_SYNC_HOUR_KST).padStart(2, "0")}:00 KST`, nextScheduledAt: nextEcountAutoSyncAt(now(), status) };
  }
  return { run, getStatus };
}
