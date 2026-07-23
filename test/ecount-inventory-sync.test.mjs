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
  writeInventoryOutputsAtomically
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
