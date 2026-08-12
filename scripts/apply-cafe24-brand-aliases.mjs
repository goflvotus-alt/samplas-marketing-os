// SAMPLAS Marketing OS — LEVEL A Cafe24 Brand Alias Apply (STEP67-10E-3)
//
// work/reports/STEP67-10E-2-BRAND-ALIAS-RECOVERY-DIAGNOSIS.md가 확정한 LEVEL A 증거
// (Cafe24 brand_code === Brand Master brand_code 정확 일치)만 name_aliases에 반영한다.
//
// 절대 하지 않는 것:
// - brand_code/brand_name/active/nameSource/instagram_tag 등 canonical 필드 변경.
// - fuzzy/transliteration/semantic 매칭, Product Registry ambiguous/LEVEL B/C/D 승격.
// - "<코드> CO" 형태의 operational group을 alias로 추가.
// - 충돌(다른 brand_code가 이미 같은 정규화 값을 쓰는 경우) 시 임의로 승자를 고르는 것 —
//   무조건 skip하고 기록만 한다(런타임 resolveBrand()의 active-priority보다 보수적으로 동작).
//
// 사용법:
//   node scripts/apply-cafe24-brand-aliases.mjs            (기본: dry-run, 아무것도 쓰지 않음)
//   node scripts/apply-cafe24-brand-aliases.mjs --apply    (실제 적용 — 백업 후 1회만 씀)
//
// 멱등성: 이미 반영된 배치를 다시 실행하면(dry-run이든 --apply든) "추가할 alias 0건"이
// 나와야 한다 — 이미 존재하는 값은 전부 "duplicate(이미 반영됨)"로 skip되기 때문이다.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBrandName, normalizeBrandKey } from "./brand-engine.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandMasterPath = join(root, "work/brand-master.json");
const backupDir = join(root, "work/backups/STEP67-10E-3-before-brand-alias-apply");
const backupPath = join(backupDir, "brand-master.json");
const cafe24BrandsUrl = "http://localhost:8787/api/cafe24/brands";

const APPLY = process.argv.includes("--apply");

// server.mjs의 loadEnv()와 동일한 최소 .env 파서(새 의존성 추가 없음).
async function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return { ...process.env };
  const text = await readFile(envPath, "utf8");
  const parsed = { ...process.env };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key]) continue;
    parsed[key] = value;
  }
  return parsed;
}

async function fetchCafe24Brands(env) {
  const headers = {};
  if (env.CAFE24_PROXY_BASIC_AUTH) {
    headers.authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  }
  const response = await fetch(cafe24BrandsUrl, { headers });
  if (!response.ok) {
    throw new Error(`Cafe24 brands fetch 실패: HTTP ${response.status} (로컬 서버가 http://localhost:8787 에서 실행 중인지 확인하세요)`);
  }
  const body = await response.json();
  if (!Array.isArray(body.brands)) throw new Error("Cafe24 brands 응답 형식이 예상과 다릅니다(brands 배열 없음)");
  return body.brands;
}

const isOperationalGroup = (value) => /\sCO$/i.test(value.trim());

function main() {
  return (async () => {
    const env = await loadEnv();
    const cafe24Brands = await fetchCafe24Brands(env);

    const brandMasterRaw = await readFile(brandMasterPath, "utf8");
    const brandMaster = JSON.parse(brandMasterRaw);
    const brands = brandMaster.brands;
    const byCode = new Map(brands.map((b) => [b.brand_code, b]));

    // 1) 기존 소유권 맵(정규화 키 -> Set(brand_code)) — brand_name + 기존 name_aliases 전부.
    const ownership = new Map();
    const addOwnership = (key, code) => {
      if (!key) return;
      if (!ownership.has(key)) ownership.set(key, new Set());
      ownership.get(key).add(code);
    };
    for (const b of brands) {
      addOwnership(normalizeBrandKey(b.brand_name), b.brand_code);
      for (const alias of b.name_aliases || []) addOwnership(normalizeBrandKey(alias), b.brand_code);
    }

    // 2) Cafe24 후보 생성 + 분류
    const toAdd = new Map(); // brand_code -> [alias strings]
    const duplicatesSkipped = [];
    const conflictsSkipped = [];
    const operationalSkipped = [];
    let matchedBrandCodes = 0;
    let candidateStringsTotal = 0;
    let unmatchedCafe24Codes = 0;

    for (const c of cafe24Brands) {
      const target = byCode.get(c.brand_code);
      if (!target) { unmatchedCafe24Codes++; continue; }
      matchedBrandCodes++;

      const rawCandidates = [
        c.brand_name,
        ...(c.search_keyword ? String(c.search_keyword).split(",") : [])
      ];

      for (const raw of rawCandidates) {
        const trimmed = String(raw ?? "").trim();
        if (!trimmed) continue;
        candidateStringsTotal++;

        if (isOperationalGroup(trimmed)) {
          operationalSkipped.push({ brand_code: target.brand_code, candidate: trimmed, reason: "operational_co_group" });
          continue;
        }

        const stored = normalizeBrandName(trimmed); // 엔티티/공백 정리만, 철자/대소문자 보존
        const key = normalizeBrandKey(stored);
        if (!key) continue;

        const canonicalKey = normalizeBrandKey(target.brand_name);
        const pending = toAdd.get(target.brand_code) || [];
        const existingKeys = new Set([
          ...(target.name_aliases || []).map(normalizeBrandKey),
          ...pending.map(normalizeBrandKey)
        ]);

        if (key === canonicalKey || existingKeys.has(key)) {
          duplicatesSkipped.push({ brand_code: target.brand_code, candidate: stored, reason: "already_represented" });
          continue;
        }

        const owners = ownership.get(key);
        if (owners && (owners.size > 1 || !owners.has(target.brand_code))) {
          conflictsSkipped.push({
            brand_code: target.brand_code,
            candidate: stored,
            conflicting_brand_codes: [...owners].filter((code) => code !== target.brand_code)
          });
          continue;
        }

        pending.push(stored);
        toAdd.set(target.brand_code, pending);
        addOwnership(key, target.brand_code);
      }
    }

    const brandsUpdated = [...toAdd.keys()].length;
    const aliasesAppliedCount = [...toAdd.values()].reduce((sum, list) => sum + list.length, 0);

    const summary = {
      mode: APPLY ? "APPLY" : "DRY-RUN",
      cafe24BrandsTotal: cafe24Brands.length,
      matchedBrandCodes,
      unmatchedCafe24Codes,
      candidateStringsTotal,
      aliasesToApply: aliasesAppliedCount,
      brandsUpdated,
      duplicatesSkipped: duplicatesSkipped.length,
      conflictsSkipped: conflictsSkipped.length,
      operationalSkipped: operationalSkipped.length
    };

    console.log(JSON.stringify(summary, null, 2));
    console.log();
    console.log("=== Aliases to apply (brand_code: brand_name -> [new aliases]) ===");
    for (const [code, aliases] of toAdd.entries()) {
      console.log(` ${code}: ${byCode.get(code).brand_name} -> ${JSON.stringify(aliases)}`);
    }
    console.log();
    console.log("=== Conflicts skipped ===");
    for (const c of conflictsSkipped) console.log(` ${c.brand_code} candidate="${c.candidate}" conflicts_with=${JSON.stringify(c.conflicting_brand_codes)}`);
    console.log();
    console.log(`Duplicates skipped (already represented): ${duplicatesSkipped.length}`);
    console.log(`Operational CO candidates skipped: ${operationalSkipped.length}`);

    if (!APPLY) {
      console.log();
      console.log("Dry-run only — no files written. Re-run with --apply to write changes.");
      return;
    }

    if (existsSync(backupPath)) {
      throw new Error(`백업이 이미 존재합니다: ${backupPath} — 덮어쓰지 않고 중단합니다.`);
    }
    await mkdir(backupDir, { recursive: true });
    await writeFile(backupPath, brandMasterRaw, "utf8");
    console.log(`Backup written: ${backupPath}`);

    for (const [code, aliases] of toAdd.entries()) {
      const brand = byCode.get(code);
      brand.name_aliases = [...(brand.name_aliases || []), ...aliases];
    }
    brandMaster.updatedAt = new Date().toISOString();

    await writeFile(brandMasterPath, JSON.stringify(brandMaster, null, 2), "utf8");
    console.log(`Brand Master written: ${brandMasterPath}`);
    console.log(`Brands updated: ${brandsUpdated}, aliases applied: ${aliasesAppliedCount}`);
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
