# Category Master v1 — Barcode / Inventory Expansion

## Executive result

- Implementation: **BLOCKED by explicit safety conditions**
- Category Master reused: **YES (audit/classification projection only)**
- New category system created: **NO**
- Canonical sales calculation changed: **NO**
- Starting branch / HEAD: `main` / `21771e3`
- Commit / push / deploy: **NO / NO / NO**

The inventory barcode source is internally unique, but Product Registry currently has 178 exact prodCd/barcode keys owned by multiple canonical products. Category Master v1 also stores no permanent product-level assignments; its JSON contains only manual overrides while the deterministic rules live in the browser JavaScript. Persisting a barcode → canonicalProductId → category result now would either choose an ambiguous owner or introduce a second category authority. Both are explicit stop conditions in this task, so no data/API/UI implementation was made.

## 1. Existing Category Master v1

### Stored schema

`work/category-master.json`:

- `version: "v1"`
- `manualOverrides: []`
- no `productAssignments`
- no barcode map
- no canonical product category records

The API reader is `intelligence-service.mjs::loadCategoryMaster()`. It exposes the manual override file read-only.

### Taxonomy

The repository-authoritative taxonomy in `outputs/samplas-marketing-os.js` contains 11 categories:

| Code | Display |
|---|---|
| TOP | 상의 |
| BOTTOM | 하의 |
| OUTER | 아우터 |
| DRESS | 드레스 |
| BAG | 가방 |
| FOOTWEAR | 신발 |
| HEADWEAR | 모자 |
| JEWELRY | 주얼리 |
| ACCESSORY | 액세서리 |
| OTHER | 기타 |
| UNCLASSIFIED | 미분류 |

### Current classifier priority

`classifyEntityProductCategory()` uses:

1. manual override by product key
2. deterministic product-name keyword rule
3. audited ECOUNT prodCd suffix (`BG`, `BT`, `SH`, `JW`, `FW`, `OT`, `HW` only)
4. `UNCLASSIFIED`

There is no persisted “existing confirmed category” layer in the current Category Master JSON. No AI/LLM/fuzzy classification is used.

### Current consumers

- Brand Intelligence Category composition
- Category → SKU drawer
- Customer category breakdown
- related regression tests

These consumers calculate category in the browser. Store Intelligence currently returns a truthful `UNKNOWN/미분류` category row and does not consume a product-level category master.

## 2. Inventory and identity sources

### Inventory source

- `work/ecount-inventory/latest.json`
- 10,000 ECOUNT product/SKU rows
- 10,000 unique `productCode` values
- 2,670 rows have a known stock quantity
- 1,734 rows have positive stock
- known net stock quantity: 1,075

The upstream raw responses report:

- products `TotalCnt`: 10,000 / returned 10,000
- inventory `TotalCnt`: 3,226 / returned 3,209

The ECOUNT product endpoint is exactly at 10,000 rows, so future pagination/limit confirmation remains necessary before treating this as an eternally complete catalog.

### Barcode source

| Metric | Result |
|---|---:|
| Inventory SKU rows | 10,000 |
| Barcode populated | 9,866 |
| Barcode coverage | 98.66% |
| Unique barcodes | 9,866 |
| Duplicate barcode values inside inventory | 0 |
| Barcode equals productCode | 9,850 |

The barcode is stable and unique inside this snapshot, but in 98.50% of all inventory rows it is simply the ECOUNT product code repeated. It is therefore useful as an exact ECOUNT SKU identifier, not evidence of an independent universal barcode identity.

### Product Registry joins

`work/product-registry.json` contains 880 canonical entries.

| Join metric | Result |
|---|---:|
| Unique inventory rows with exactly one Product Registry owner | 1,235 / 10,000 (12.35%) |
| Verified + confirmed exact owners | 103 / 10,000 (1.03%) |
| Registry prodCd/barcode keys | 1,420 combined exact keys |
| Keys with multiple canonical owners | 178 |
| Trusted verified+confirmed collision keys | 0 |

The 178 collisions arise in the wider candidate/review registry. The existing Unified Identity Resolver correctly trusts only `verified:true + status:"confirmed"`, which avoids those collisions but covers only 103 inventory SKUs.

## 3. Inventory category coverage

No product-level category assignments were written. The existing deterministic classifier was applied in memory only to measure the safe upper bound.

| Coverage view | Before | After |
|---|---:|---:|
| Persisted canonical product-category coverage | 0 / 10,000 | 0 / 10,000 (no write) |
| Existing runtime classifier projection | 7,726 / 10,000 (77.26%) | 7,726 / 10,000 (unchanged) |
| UNCLASSIFIED projection | 2,274 | 2,274 |

Category projection by SKU and known net stock:

| Category | SKU count | Known-stock SKU count | Net stock quantity |
|---|---:|---:|---:|
| TOP | 2,213 | 610 | 450 |
| BOTTOM | 2,966 | 712 | 295 |
| OUTER | 1,615 | 430 | 190 |
| DRESS | 168 | 43 | 24 |
| BAG | 90 | 24 | 22 |
| FOOTWEAR | 142 | 17 | 19 |
| HEADWEAR | 227 | 71 | 52 |
| JEWELRY | 148 | 46 | 51 |
| ACCESSORY | 157 | 45 | -2 |
| OTHER | 0 | 0 | 0 |
| UNCLASSIFIED | 2,274 | 672 | -26 |

Negative net quantities are preserved as existing ECOUNT inventory integrity signals; they were not normalized or hidden. Inventory value was not calculated because this task found no approved canonical inventory-value formula to reuse.

## 4. Store sales category audit

The store sales snapshots contain product name and size but no barcode/prodCd. The existing Store Product Identity resolver therefore uses exact normalized `productName + specification` against Product Registry and refuses ambiguous candidates.

### APGUJEONG — 2026-08-01 to 2026-08-14

| Metric | Result |
|---|---:|
| Revenue lines | 493 |
| Exact canonical product-resolved lines | 95 |
| Exact resolved revenue | 13,896,700원 |
| Resolved + category-classified lines | 73 |
| Resolved + category-classified revenue | 11,543,300원 |
| Canonical product → category revenue coverage | 11.88% |
| Canonical offline revenue | 97,177,900원 |

For comparison only, applying the existing browser name/suffix classifier directly to raw sales lines would classify 330 lines / 69,424,200원 (71.44%). That is **not** accepted as the requested permanent canonical pipeline because it bypasses canonical product identity and recalculates category at the sales screen.

Projected raw-line composition, not applied to API/UI:

- TOP 12,735,200원
- BOTTOM 27,749,900원
- OUTER 17,224,000원
- DRESS 550,400원
- FOOTWEAR 1,482,000원
- HEADWEAR 864,000원
- JEWELRY 2,633,600원
- ACCESSORY 6,185,100원
- UNCLASSIFIED 27,753,700원

All projected rows sum to 97,177,900원; however they remain audit output only.

### VAIL — 2026-08-03 to 2026-08-13

| Metric | Result |
|---|---:|
| Revenue lines | 1 |
| Exact canonical product-resolved lines | 1 |
| Exact resolved revenue | 70,200원 |
| Resolved + category-classified lines | 0 |
| Canonical product → category revenue coverage | 0% |
| Canonical offline revenue | 70,200원 |

The actual sold line is `PACOSPLY / WonderLand T-shirts BLACK`, size `2`, 70,200원. Its product identity resolves, but Category Master v1 cannot deterministically classify it with the approved rules, so the correct state remains `UNCLASSIFIED 70,200원 / 100%`. The UI was not switched because there is no server-side product category authority yet.

## 5. Why implementation stopped

The task required stopping when identifier meaning conflicts or overwrite risk is material. Both conditions are present:

1. 178 Product Registry exact identifiers have multiple canonical owners outside the trusted confirmed subset.
2. Only 103 inventory rows have a trusted exact canonical product owner.
3. Category Master JSON has no permanent product assignment schema; writing 7,726 inferred results would be a schema/authority expansion and bulk classification, not a minimal connection.
4. The existing classifier lives in browser code. Copying it into `server.mjs` would create two category authorities and violate the “classify once, reuse everywhere” goal.
5. Store sales snapshots lack barcode/prodCd, so most sales lines cannot follow the required salesLine → canonical product → Category Master chain today.

No barcode map, review queue, API field, UI data, Product Registry entry, or Category Master record was created.

## 6. Manual review requirement

- Deterministic classifier projection leaves 2,274 inventory SKUs unclassified.
- These 2,274 are the minimum manual category review population after an approved permanent assignment schema exists.
- Registry collision review is separately required for 178 exact identifier keys.
- No review artifact was generated because the canonical target schema and owner selection are not yet approved; generating a queue now would encode an unresolved identity policy.

## 7. Validation

- Category/Inventory/Store targeted tests: **82/82 PASS**
- Full regression: **678/678 PASS**
- JavaScript syntax (`server.mjs`, `outputs/samplas-marketing-os.js`): **PASS**
- `git diff --check`: **PASS**
- APGUJEONG canonical offline: **97,177,900원 unchanged**
- VAIL canonical offline: **70,200원 unchanged**
- PACOSPLY: **70,200원 unchanged**
- Canonical sales formula changed: **NO**

## 8. Files changed in this batch

- `docs/reports/CATEGORY-MASTER-BARCODE-INVENTORY-EXPANSION.md` (new audit report only)

No code, test, work data, Product Registry, Category Master, inventory snapshot, sales snapshot, API, or UI file was modified.

## 9. Recommended next work

1. Resolve or explicitly exclude the 178 Product Registry identifier collisions; keep the current verified+confirmed trust rule.
2. Approve one product-level assignment extension inside Category Master v1, keyed by `canonicalProductId`, with source/status metadata and no category duplication in a barcode map.
3. Move the existing v1 classifier policy into one shared canonical module/API contract before Store Intelligence consumes it; browser and server must not own separate rule copies.
4. Extend future ECOUNT store sales snapshots additively with `prodCd` when the source export provides it, or improve exact Product Registry productName+size coverage without fuzzy matching.
5. Generate the 2,274-row manual review queue only after steps 1–2 establish an unambiguous canonical target.

## Final

Barcode availability is high, but safe permanent category linkage is not yet ready. The blocker is not missing barcode data; it is ambiguous Product Registry ownership plus the absence of a persisted product-level Category Master authority.
