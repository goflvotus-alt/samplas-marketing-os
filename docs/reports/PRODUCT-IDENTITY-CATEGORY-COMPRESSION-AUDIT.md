# PRODUCT IDENTITY + CATEGORY UNCLASSIFIED COMPRESSION AUDIT

## Scope

- Project: `/Users/binggu/Dropbox/SAMPLAS WORK/INTELLIGENCE/SAMPLAS Marketing OS DEV`
- Branch / starting HEAD: `main` / `21771e3`
- Mode: audit only
- Canonical sales, Category Master, Product Registry, inventory source, UI: unchanged
- Audit artifact: `work/category-unclassified-model-audit.json`
- Reproducible audit script: `scripts/audit-product-identity-category-compression.mjs`

## Executive conclusion

The audit completed. The 2,274 `UNCLASSIFIED` inventory SKUs compress conservatively to **1,342 deterministic product models**. Product identity remains the larger constraint: the current trusted Registry joins only **103 inventory SKUs**, and barcode adds no independent identity for nearly all rows because **9,850 of 9,866 populated barcodes equal `productCode`**.

The currently persisted sales snapshot contains neither `prodCd` nor barcode. Therefore the proposed `sales prodCd → inventory → barcode → canonical product` route is **not available in the current snapshot contract**. No parser, Registry, Master, sales calculation, or snapshot was changed.

## 1. Inventory fields and model compression

Actual normalized inventory fields are:

- `productCode`
- `productName`
- `specification`
- `barcode`
- `purchasePrice`
- `salesPrice`
- `stockQuantity`

The source does not expose separate `brand`, `option`, `color`, `size`, or `prodCd` keys in `latest.json`. `productCode` is the normalized ECOUNT `PROD_CD`, `specification` is the source size/specification, and brand is only derivable as the exact prefix before `/` when present.

### Conservative deterministic grouping rule

1. Run the existing Category Master v1 keyword/suffix classifier exactly.
2. For an unclassified SKU, remove only the last two product-code digits when the code is structurally alphanumeric, the specification is present, and all rows sharing the prefix have the same normalized product name after removal of the exact trailing specification token.
3. If any member has a different base name, do not merge that group; retain each SKU separately.
4. No fuzzy similarity and no inferred color-family merge.

Sixteen tempting code-prefix groups were rejected because they combined different product names. This includes legacy short codes and reused code ranges; blindly stripping two digits would undercount the review workload.

### Compression result

| Metric | Count |
|---|---:|
| Inventory SKU | 10,000 |
| Classified SKU | 7,726 |
| UNCLASSIFIED SKU | 2,274 |
| All conservative unique models | 5,556 |
| Auto-classified unique models | 4,214 |
| Manual-review unique models | 1,342 |
| Average SKU per unclassified model | 1.69 |

| Unclassified model size | Models |
|---|---:|
| 1 SKU | 726 |
| 2–3 SKU | 569 |
| 4–5 SKU | 46 |
| 6+ SKU | 1 |

The model count is deliberately conservative. BLACK/WHITE variants are not merged unless the ECOUNT code itself proves a shared model; string similarity was not used.

## 2. Why the SKUs remain UNCLASSIFIED

The existing classifier has two positive routes: one unambiguous name-keyword category or one audited ECOUNT suffix (`BG/BT/SH/JW/FW/OT/HW`). The largest failure buckets are:

| Reason | SKU |
|---|---:|
| unsupported suffix `ST` | 738 |
| unsupported suffix `LT` | 468 |
| unsupported suffix `AC` | 332 |
| unsupported suffix `QQQ` | 137 |
| ambiguous name keywords | 95 |
| unsupported suffix `DOM` | 92 |
| unsupported suffix `POP` | 51 |
| unsupported suffix `HD` | 44 |
| unsupported suffix `CAR` | 41 |
| unsupported suffix `RES` | 39 |
| unsupported suffix `LOA` | 37 |
| unsupported suffix `SUN` | 33 |
| unsupported suffix `ANO` | 33 |
| other unsupported suffix/structure | 134 |

`ST`, `LT`, and `AC` account for 1,538 of 2,274 unclassified SKUs. This is expected policy behavior: those suffixes were previously withheld because actual catalog examples span multiple categories.

## 3. Highest-volume manual-review brands

| Brand label from exact product-name prefix | SKU | Unique models | Current stock qty |
|---|---:|---:|---:|
| UNASSIGNED | 189 | 182 | -352 |
| CARNET ARCHIVE | 129 | 71 | 25 |
| RESURRECITON 13 | 119 | 75 | -34 |
| AE SYNCTX | 112 | 46 | 37 |
| LOADING ROOM | 96 | 37 | -15 |
| DOMINNICO | 81 | 75 | 1 |
| NAMILIA | 77 | 32 | 12 |
| BONNAE | 76 | 43 | 14 |
| IFEELUCKY | 73 | 40 | -45 |
| ANOTHER YOUTH | 62 | 22 | -40 |
| REMAGINE | 59 | 19 | 25 |
| COZY WORLDWIDE | 51 | 25 | 10 |
| KIMYO | 47 | 47 | 7 |
| PAX00100 | 44 | 26 | 11 |
| PACOSPLY | 43 | 19 | 42 |

Negative quantities are preserved ECOUNT balances, not recalculated stock.

## 4. Product Registry identifier inventory

| Identifier | Populated rows | Unique values | Duplicate rows | Multiple-owner collisions |
|---|---:|---:|---:|---:|
| ECOUNT `prodCd` | 1,762 | 1,413 | 349 | 178 |
| ECOUNT `barcode` | 1,762 | 1,413 | 349 | 178 |
| Cafe24 `productNo` | 880 | 880 | 0 | 0 |
| Cafe24 `productCode` | 877 | 877 | 0 | 0 |
| `variantCode` | 0 | 0 | 0 | 0 |
| `itemCode` | 0 | 0 | 0 | 0 |

Normalized product names exist as descriptive matching evidence, not a unique persisted identity field. The Phase 1 Registry is Cafe24-anchored; it does not cover the full 10,000-row ECOUNT catalog.

## 5. Inventory barcode comparison

- Barcode-populated inventory: **9,866 / 10,000 (98.66%)**
- Inventory-internal duplicate barcode: **0**
- Barcode equals ECOUNT product code: **9,850**
- Exact unique Registry owner: **1,235**
- Exact multiple-owner collision: **178**
- Inventory barcode with no Registry barcode value match: **8,453**
- Inventory barcode missing: **134**
- Formatting-only recoverable matches: **0**
- Registry matched-product rows missing barcode: **0**

Leading zero preservation, numeric/string conversion, whitespace, hyphen removal, and scientific-notation-style normalization did not recover additional joins. The low join rate is a Registry coverage/ownership problem, not an Excel-formatting problem.

## 6. The 178 Registry collisions

The audit classified only what exact evidence proves:

| Bucket | Identifier values |
|---|---:|
| SAME PRODUCT DUPLICATE | 12 |
| VARIANT RECORD DUPLICATION | 0 |
| TRUE IDENTIFIER COLLISION | 0 |
| LEGACY / STALE RECORD | 0 |
| UNKNOWN | 166 |

`TRUE IDENTIFIER COLLISION = 0` does not prove that no true collision exists. It means no identifier has two simultaneously verified+confirmed owners. The 166 unknown values point to different unverified Cafe24 candidates and cannot be safely merged without review.

Representative unknowns include:

- `POP263RES01204`: `24-AC006 BLACK` vs `24-B009 BLACK`
- `RES253LT01302`: `25-T011 BLACK` vs `26-T011 BLACK`
- `MIN261ST01301`: three different MINGA product candidates

The 12 exact same-name/brand duplicates could raise safe coverage by only 12 SKUs after an explicit cleanup decision. No automatic merge was performed.

## 7. Potential deterministic coverage

| Route | Inventory SKU | Coverage |
|---|---:|---:|
| CURRENT PRODUCT JOIN — verified+confirmed | 103 | 1.03% |
| BARCODE DIRECT POTENTIAL — exact unique owner | 1,235 | 12.35% |
| `prodCd → inventory → barcode` potential | 1,235 | 12.35% |
| Deterministic union | 1,235 | 12.35% |
| After 12 exact same-product duplicate cleanups | 1,247 | 12.47% |
| Unresolved after all currently safe routes | 8,753 | 87.53% |

Barcode direct and prodCd bridge produce the same coverage because barcode duplicates productCode for 9,850 rows and the Registry stores the same values in both ECOUNT fields.

The intersection of a safely joinable canonical product and an existing non-`UNCLASSIFIED` category is **906 / 10,000 (9.06%)**. Independently of Product Registry identity, the current deterministic classifier can label **7,726 / 10,000 (77.26%)** inventory SKUs.

## 8. Sales bridge assessment

The current normalized ECOUNT sales snapshots contain product name, specification, brand group, amount, and store, but not `prodCd` or barcode. The current XLSX loader header contract also does not read either identifier. Inspection of the current August sales source header found no item-code/barcode column exposed to the loader.

Therefore:

```text
sales prodCd → ECOUNT inventory → barcode → canonical product
```

is not currently executable. It would require an independently approved loader/snapshot contract change and proof that the source export actually contains a stable item code. The existing exact product-name + specification resolver remains the only current sales route.

## 9. Category funnel

```text
10,000 inventory SKUs
→ 5,556 conservative deterministic product models
→ 4,214 auto-classified models
→ 1,342 manual-review models
```

The manual workload is therefore 1,342 models, not 2,274 individual SKUs. This does not include speculative color-family collapsing.

## 10. Canonical reconciliation

- APGUJEONG offline total: **97,177,900** — unchanged
- VAIL offline total: **70,200** — unchanged
- VAIL PACOSPLY revenue: **70,200** — unchanged
- Canonical sales calculation modified: **NO**

## 11. Recommended next two implementation batches

### A. PRODUCT IDENTITY FIX

1. Review the 166 unknown collision identifiers; approve only explicit owner decisions.
2. Collapse the 12 exact same-name/brand duplicate ownership records after representative review.
3. Expand Product Registry coverage from the full ECOUNT product master instead of treating barcode as a new key; barcode is mostly an alias of `PROD_CD` here.
4. Do not add the sales bridge until a source export with a stable item code is confirmed and the snapshot schema change is separately approved.

### B. CATEGORY MASTER EXPANSION

1. Use the 1,342-model artifact as the review unit.
2. Review by brand batches, starting with the high-volume table above.
3. Persist approved canonical-product/category assignments once, rather than duplicating the frontend classifier.
4. Keep `ST`, `LT`, and `AC` unapproved until model-level evidence supports deterministic sub-rules.

## Validation status

- Audit script syntax: PASS
- Audit JSON parse: PASS
- Targeted Category/Product/Inventory/Store tests: **82/82 PASS**
- Full regression: **678/678 PASS**
- `git diff --check`: PASS
- Expected sandbox-only Cafe24/network and diagnostic-log write warnings occurred during the full suite; no test failed.
- Source data overwritten: NO
- Product Registry modified: NO
- Category Master modified: NO
- Canonical sales modified: NO
- Commit / push / deploy: NO
