import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntelligenceBrandRegistry,
  validateBrandRegistry
} from "../intelligence-service.mjs";
import { normalizeBrandKey } from "../scripts/brand-engine.mjs";

function brand(brand_code, brand_name, active, name_aliases = []) {
  return { brand_code, brand_name, active, name_aliases };
}

function build(source) {
  const registry = buildIntelligenceBrandRegistry(source);
  validateBrandRegistry(registry.brands, registry.aliases);
  return registry;
}

function owner(registry, key) {
  const normalized = normalizeBrandKey(key);
  return registry.brands.find((entry) => normalizeBrandKey(entry.name) === normalized)?.id
    || registry.aliases.find((entry) => normalizeBrandKey(entry.alias) === normalized)?.brandId;
}

test("active canonical wins over inactive canonical", () => {
  const registry = build([brand("ACTIVE", "SAME", true), brand("LEGACY", "SAME", false)]);
  assert.equal(owner(registry, "SAME"), "ACTIVE");
  assert.equal(owner(registry, "LEGACY"), "ACTIVE");
});

test("multiple active canonical owners are blocked", () => {
  assert.throws(() => build([brand("A", "SAME", true), brand("B", "SAME", true)]), /Active brand key conflict/);
});

test("single inactive canonical is retained", () => {
  assert.equal(owner(build([brand("LEGACY", "LEGACY BRAND", false)]), "LEGACY BRAND"), "LEGACY");
});

test("active alias owns an inactive canonical key", () => {
  const registry = build([brand("ACTIVE", "현재", true, ["LEGACY"]), brand("LEGACY", "LEGACY", false)]);
  assert.equal(owner(registry, "LEGACY"), "ACTIVE");
});

test("active alias and active canonical conflict is blocked", () => {
  assert.throws(() => build([brand("A", "현재", true, ["SHARED"]), brand("B", "SHARED", true)]), /Active brand key conflict/);
});

test("MEANTIME post-merge maps to B00000HM", () => {
  const registry = build([
    brand("B00000HM", "민타임", true, ["MEANTIME"]),
    brand("B00000KS", "Meantime", false)
  ]);
  assert.equal(owner(registry, "MEANTIME"), "B00000HM");
  assert.equal(owner(registry, "B00000KS"), "B00000HM");
});

test("BARRAGAN post-merge keeps B0000BCX", () => {
  const registry = build([
    brand("B0000BCX", "BARRAGAN", true),
    brand("B00000KI", "BARRAGAN", false)
  ]);
  assert.equal(owner(registry, "BARRAGAN"), "B0000BCX");
  assert.equal(owner(registry, "B00000KI"), "B0000BCX");
});

test("same brand canonical and alias are deduped", () => {
  const registry = build([brand("A", "SAME", true, ["SAME", "same"])]);
  assert.equal(registry.brands.length, 1);
  assert.equal(registry.aliases.filter((entry) => entry.alias.toLowerCase() === "same").length, 0);
});

test("missing active is treated as active", () => {
  assert.equal(owner(build([brand("A", "LEGACY")]), "LEGACY"), "A");
});

test("snapshot schema remains id, name, active and alias, brandId, source", () => {
  const registry = build([brand("A", "ALPHA", true, ["ALFA"])]);
  assert.deepEqual(Object.keys(registry.brands[0]).sort(), ["active", "id", "name"]);
  assert.deepEqual(Object.keys(registry.aliases[0]).sort(), ["alias", "brandId", "source"]);
});
