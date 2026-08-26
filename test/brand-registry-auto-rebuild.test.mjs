// Brand Registry derived-file auto-rebuild — 과거 ensureBrandRegistryFiles()의
// bootstrap-once(`if (!existsSync(...))`) 설계를 대체한 hash-gated auto-rebuild 검증.
// WORK_DIR을 이 테스트 전용 임시 디렉터리로 지정한 뒤 intelligence-service.mjs를 동적
// import하므로, 실제 로컬 work/ 데이터에는 전혀 영향을 주지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "brand-registry-rebuild-"));
process.env.WORK_DIR = workDir;

const brandMasterFile = join(workDir, "brand-master.json");
const brandMasterListFile = join(workDir, "intelligence", "brand-master-list.json");
const brandAliasesFile = join(workDir, "intelligence", "brand-aliases.json");
const buildMetaFile = join(workDir, "intelligence", "brand-registry-build-meta.json");

async function writeBrandMaster(brands) {
  await writeFile(brandMasterFile, JSON.stringify({ brands }, null, 2));
}

function brand(brand_code, brand_name, name_aliases = []) {
  return { brand_code, brand_name, active: true, name_aliases };
}

// brand-master.json이 항상 먼저 존재해야 최초 import 시(모듈 top-level의
// ensureBrandRegistryFiles() 호출) 정상적으로 첫 build가 일어난다.
await writeBrandMaster([brand("B001", "ALPHA")]);

const { readBrandRegistry } = await import("../intelligence-service.mjs");

test.after(() => rm(workDir, { recursive: true, force: true }));

test("1. derived missing → build", async () => {
  assert.ok(existsSync(brandMasterListFile), "최초 import 시 brand-master-list.json이 생성되어야 한다");
  assert.ok(existsSync(brandAliasesFile), "최초 import 시 brand-aliases.json이 생성되어야 한다");
  const registry = await readBrandRegistry();
  assert.deepEqual(registry.brands.map((b) => b.id), ["B001"]);
});

test("2. derived current(canonical 불변) → no rebuild(파일 mtime 불변)", async () => {
  const before = await readFile(brandMasterListFile, "utf8");
  await readBrandRegistry();
  await readBrandRegistry();
  const after = await readFile(brandMasterListFile, "utf8");
  assert.equal(before, after, "canonical이 바뀌지 않았으면 derived 파일 내용이 재작성되지 않아야 한다(바이트 동일)");
});

test("3. canonical changed → rebuild, 4. aliases updated", async () => {
  await writeBrandMaster([
    brand("B001", "ALPHA"),
    brand("B002", "BETA", ["베타"])
  ]);
  const registry = await readBrandRegistry();
  assert.deepEqual(registry.brands.map((b) => b.id).sort(), ["B001", "B002"]);
  assert.ok(registry.aliases.some((a) => a.alias === "베타" && a.brandId === "B002"), "새 alias가 반영되어야 한다");
  const meta = JSON.parse(await readFile(buildMetaFile, "utf8"));
  assert.equal(meta.brandCount, 2);
  // brand_code 자체도 자동으로 alias 취급되므로(B001/B002) 1(name_alias) + 2(brand_code) = 3.
  assert.equal(meta.aliasCount, 3);
});

test("5. collision behavior unchanged(buildIntelligenceBrandRegistry 직접 호출 시 여전히 throw)", async () => {
  const { buildIntelligenceBrandRegistry } = await import("../intelligence-service.mjs");
  assert.throws(
    () => buildIntelligenceBrandRegistry([
      { brand_code: "B001", brand_name: "SAME", active: true },
      { brand_code: "B002", brand_name: "SAME", active: true }
    ]),
    /Active brand key conflict/,
    "auto-rebuild wrapper와 무관하게 순수 builder 자체의 충돌 검증 로직은 그대로여야 한다"
  );
});

test("6. broken canonical(active key conflict 포함) → 기존 valid derived 보존, read는 throw하지 않음", async () => {
  await writeBrandMaster([
    brand("B001", "SAME"),
    brand("B002", "SAME")
  ]);
  // 충돌 canonical이어도 read 자체는 실패하지 않고 마지막 valid derived를 그대로 반환한다.
  const registry = await readBrandRegistry();
  assert.deepEqual(registry.brands.map((b) => b.id).sort(), ["B001", "B002"], "충돌 canonical 상태에서도 이전 valid derived(테스트 3/4 결과)를 그대로 서빙해야 한다");
  const brands = JSON.parse(await readFile(brandMasterListFile, "utf8"));
  assert.deepEqual(brands.map((b) => b.id).sort(), ["B001", "B002"], "collision으로 rebuild가 실패해도 이전 valid derived 파일이 그대로 남아있어야 한다");

  // 완전히 파싱 불가능한 canonical(malformed JSON)도 동일하게 보존되어야 한다.
  await writeFile(brandMasterFile, "{ not valid json");
  const registryAfterMalformed = await readBrandRegistry();
  assert.deepEqual(registryAfterMalformed.brands.map((b) => b.id).sort(), ["B001", "B002"], "malformed canonical에도 기존 derived가 보존되어야 한다");
});

test("7. no half-written pair(rebuild 후에도 두 파일의 brandId 참조가 항상 서로 일치)", async () => {
  await writeBrandMaster([
    brand("B003", "GAMMA", ["감마"])
  ]);
  const registry = await readBrandRegistry();
  const brands = JSON.parse(await readFile(brandMasterListFile, "utf8"));
  const aliases = JSON.parse(await readFile(brandAliasesFile, "utf8"));
  const brandIds = new Set(brands.map((b) => b.id));
  for (const alias of aliases) {
    assert.ok(brandIds.has(alias.brandId), `alias ${alias.alias}가 brand-master-list.json에 없는 brandId(${alias.brandId})를 참조 — 두 파일이 서로 다른 시점으로 쓰였을 가능성`);
  }
  assert.deepEqual(registry.brands.map((b) => b.id), ["B003"]);
});

console.log("brand registry auto-rebuild tests passed");
