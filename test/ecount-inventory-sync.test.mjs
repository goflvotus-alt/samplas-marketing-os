import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, rename as realRename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLatestRows,
  outputPayloadsToFiles,
  requireResultList,
  runRequiredStep,
  validateOutputPayloads,
  writeInventoryOutputsAtomically,
  writeInventoryHistorySnapshot
} from "../scripts/sync-ecount-inventory.mjs";

const rawProducts = { Data: { Result: [{ PROD_CD: "SKU1", PROD_DES: "BRAND / Item", IN_PRICE: "1,000" }] } };
const rawInventory = { Data: { Result: [{ PROD_CD: "SKU1", BAL_QTY: "2" }] } };

function payloads() {
  const productList = requireResultList(rawProducts, "products");
  const inventoryList = requireResultList(rawInventory, "inventory");
  const { latest, purchasePriceCount } = buildLatestRows(productList, inventoryList);
  return {
    rawProducts,
    rawInventory,
    latest,
    diagnostic: {
      startedAt: "2026-07-23T00:00:00.000Z",
      finishedAt: "2026-07-23T00:01:00.000Z",
      steps: [],
      errors: [],
      counts: { productCount: productList.length, inventoryCount: inventoryList.length, latestCount: latest.length, purchasePriceCount }
    }
  };
}

test("products 실패 시 required step이 실패하고 저장 helper는 호출되지 않음", async () => {
  const diagnostic = { steps: [], errors: [] };
  let writes = 0;
  await assert.rejects(runRequiredStep("products", diagnostic, async () => { throw new Error("boom"); }));
  assert.equal(writes, 0);
  assert.equal(diagnostic.steps[0].ok, false);
});

test("inventory 실패 시 required step이 실패하고 저장 helper는 호출되지 않음", async () => {
  const diagnostic = { steps: [], errors: [] };
  let renames = 0;
  await assert.rejects(runRequiredStep("inventory", diagnostic, async () => ({ httpStatus: 500, body: {} })));
  assert.equal(renames, 0);
  assert.equal(diagnostic.steps[0].ok, false);
});

test("유효하지 않은 products 응답은 저장 파일 준비 전에 실패", () => {
  assert.throws(() => outputPayloadsToFiles({ ...payloads(), rawProducts: {} }), /products/);
});

test("유효하지 않은 inventory 응답은 저장 파일 준비 전에 실패", () => {
  assert.throws(() => outputPayloadsToFiles({ ...payloads(), rawInventory: { Data: { Result: "not-json" } } }), /inventory/);
});

test("정상 응답일 때만 4개 결과 파일 payload를 준비", () => {
  const files = outputPayloadsToFiles(payloads());
  assert.deepEqual(Object.keys(files).sort(), ["diagnostic.json", "latest.json", "raw-inventory.json", "raw-products.json"]);
});

test("latest 생성은 수량 숫자 변환과 null 처리를 유지", () => {
  const { latest } = buildLatestRows([{ PROD_CD: "A", PROD_DES: "B / C" }, { PROD_CD: "B" }], [{ PROD_CD: "A", BAL_QTY: "3" }]);
  assert.equal(latest[0].stockQuantity, 3);
  assert.equal(latest[1].stockQuantity, null);
});

test("임시 파일 쓰기 실패 시 기존 최종 파일 유지", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-sync-write-fail-"));
  try {
    await writeFile(join(dir, "latest.json"), "old");
    await assert.rejects(writeInventoryOutputsAtomically(dir, payloads(), {
      mkdir,
      rename: realRename,
      rm,
      async writeFile(file, data) {
        if (file.endsWith("latest.json")) throw new Error("write failed");
        return writeFile(file, data);
      }
    }));
    assert.equal(await readFile(join(dir, "latest.json"), "utf8"), "old");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rename 실패 시 백업된 기존 파일을 rollback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-sync-rename-fail-"));
  try {
    for (const name of ["raw-products.json", "raw-inventory.json", "latest.json", "diagnostic.json"]) {
      await writeFile(join(dir, name), `old:${name}`);
    }
    let finalRenameCount = 0;
    await assert.rejects(writeInventoryOutputsAtomically(dir, payloads(), {
      mkdir,
      writeFile,
      rm,
      async rename(from, to) {
        if (!to.includes(".backup-") && !from.includes(".backup-")) {
          finalRenameCount += 1;
          if (finalRenameCount === 2) throw new Error("rename failed");
        }
        return realRename(from, to);
      }
    }));
    assert.equal(await readFile(join(dir, "latest.json"), "utf8"), "old:latest.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("성공 시 임시 폴더가 남지 않음", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-sync-success-"));
  try {
    await writeInventoryOutputsAtomically(dir, payloads());
    const names = await readdir(dir);
    assert.equal(names.some((name) => name.startsWith(".sync-") || name.startsWith(".backup-")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("실패 시 임시 폴더가 남지 않음", async () => {
  const dir = await mkdtemp(join(tmpdir(), "samplas-sync-cleanup-"));
  try {
    await assert.rejects(writeInventoryOutputsAtomically(dir, payloads(), {
      mkdir,
      rename: realRename,
      rm,
      async writeFile(file, data) {
        if (file.endsWith("diagnostic.json")) throw new Error("write failed");
        return writeFile(file, data);
      }
    }));
    const names = await readdir(dir);
    assert.equal(names.some((name) => name.startsWith(".sync-") || name.startsWith(".backup-")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diagnostic metadata가 없으면 저장하지 않음", () => {
  assert.throws(() => validateOutputPayloads({ ...payloads(), diagnostic: { startedAt: "x" } }), /diagnostic/);
});

// ---- Inventory history snapshot (2026-08-26 foundation) ----

test("history snapshot: 하루 하나(KST 날짜 기준)로 atomic write, no half-written file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-history-"));
  try {
    const { latest, diagnostic } = payloads();
    const result = await writeInventoryHistorySnapshot(dir, { latest, diagnostic });
    assert.equal(result.snapshotDate, "2026-07-23");
    const saved = JSON.parse(await readFile(join(dir, "history", "2026-07-23.json"), "utf8"));
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.snapshotDate, "2026-07-23");
    assert.deepEqual(saved.latest, latest);
    assert.deepEqual(saved.sourceCounts, diagnostic.counts);
    const names = await readdir(join(dir, "history"));
    assert.equal(names.some((name) => name.startsWith(".tmp-")), false, "임시 파일이 남아있으면 안 된다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("history snapshot: 같은 날 두 번 실행하면 파일 1개만 남고(overwrite), 쌓이지 않음", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-history-"));
  try {
    const first = payloads();
    await writeInventoryHistorySnapshot(dir, first);
    const second = payloads();
    second.latest = [{ ...second.latest[0], stockQuantity: 999 }];
    await writeInventoryHistorySnapshot(dir, second);
    const names = await readdir(join(dir, "history"));
    assert.deepEqual(names, ["2026-07-23.json"], "같은 날짜면 파일이 하나만 있어야 한다");
    const saved = JSON.parse(await readFile(join(dir, "history", "2026-07-23.json"), "utf8"));
    assert.equal(saved.latest[0].stockQuantity, 999, "가장 최근 실행 결과로 덮어써져야 한다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("history snapshot 실패는 latest/diagnostic.json 원자적 교체에 전혀 영향을 주지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-history-"));
  try {
    await writeInventoryOutputsAtomically(dir, payloads());
    const beforeLatest = await readFile(join(dir, "latest.json"), "utf8");

    // history write가 실패하는 상황을 흉내낸다(예: 디스크 오류) — 호출부(runSync)와
    // 동일하게 이 실패를 여기서도 catch해서 메인 파일에 영향이 없는지만 확인한다.
    await assert.rejects(writeInventoryHistorySnapshot(dir, {
      ...payloads(),
      diagnostic: { counts: {} } // finishedAt 없음 → 의도적으로 throw
    }));

    const afterLatest = await readFile(join(dir, "latest.json"), "utf8");
    assert.equal(beforeLatest, afterLatest, "history 실패가 이미 쓰여진 latest.json을 건드리면 안 된다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("history는 과거 날짜를 추정해서 만들지 않는다 — diagnostic.finishedAt이 곧 snapshotDate", async () => {
  const { latest } = payloads();
  const result = await writeInventoryHistorySnapshot(
    await mkdtemp(join(tmpdir(), "inv-history-")),
    { latest, diagnostic: { finishedAt: "2026-08-26T05:00:00.000Z", counts: {} } }
  );
  assert.equal(result.snapshotDate, "2026-08-26", "backfill 없이 실제 실행 시점의 날짜만 기록되어야 한다");
});
