# BI-BATCH-C — Category Intelligence: PATH B (BLOCKED)

No source code was changed. This is a diagnosis-only report, ending in a stop-and-report per the batch's own PATH B instruction.

## Pre-Flight

```
branch = main
HEAD = 43ed1781f91d14dc2a8f80e506b8c9832093f944
```
`c9d90f4` / `92cba37` / `2c90677` / `43ed178` all present. Working tree clean except the usual untracked `docs/reports/*.md` files. No unexpected modification.

## Phase 1/2 — Source Hunt + Semantic Proof

Four candidate category signals were located and tested against real data. **None qualifies as a proven, existing, deterministic SAMPLAS category source.**

### Candidate 1 — ECOUNT `CLASS_CD` / `CLASS_CD2` / `CLASS_CD3`

`work/ecount-inventory/raw-products.json`. Every real product carries a numeric `CLASS_CD` (e.g. `140`, `002`, `006`, `011`, `014`...). **No decode table exists anywhere in this repository** — grepped `scripts/*.mjs`, `server.mjs`, `intelligence-service.mjs`, `docs/` for `CLASS_CD`: the only hits are in a prior diagnostic report (see below) stating the mapping *still does not exist*. The numeric codes alone carry no provable meaning.

CONFIDENCE: **NOT PROVEN.**

### Candidate 2 — ECOUNT product-code embedded type suffix (the task's own "BG/OT/ST/BT/AC" hint)

`prodCd` values follow `<BRAND><SEASON><TYPE><SEQ>`, e.g. `604251BG00100`, `AIV261AC01504`, `CAR253OT00702`. Extracted all 12 distinct 2-letter `TYPE` tokens present in the 10,000-row ECOUNT catalog and sampled real products per token:

| CODE | Observed products (sample) | Visual pattern |
|---|---|---|
| AC | "DRAGONRIDER SOFT NAPPA BLACK", "MARATHON BOOTS...", AIVER "LEATHER BELT"/"LEATHER BANGLE", BLACKMEANS "LEATHER Circled Pouch" | mixed footwear/leather-goods/accessories |
| BG | "VIXEN SHOPPER BAG", "DISTORTED BACKPACK", "MINI BAG" | bags |
| BT | "ZIP MICRO SHORTS", "EOS SPORTY BBALL SHORTS" | shorts/bottoms |
| ST | "ZIP APRON TOP", "EOS JERSEY TOP" | tops |
| OT | "ARMY PATCHED HOODIE ZIP" | outerwear(?) |
| LT | "TOWELLING ROBE", "ZIP UP HOODIE", "V-NECK TEE" | **mixed** — robe/hoodie/tee under one code, inconsistent |
| HD | "CAPE BARRY PANEL", "Zip-up hoodie" | hood(ie)? |
| SH | "DU BARRY SHIRT", "BLACK WIDOW SHIRT" | shirts |
| DR | "SILVER EYES DRESS" | dresses |
| HW | "EXCAVATED OILED CAP", "Filthy Rich Cap" | headwear |
| FW | "STRATUM MULE" | footwear |
| JW | "CHARM UNIT NECKLACE" | jewelry |

**Existing code/comment/master evidence: none.** This table was built by *me reading free-text product descriptions and pattern-matching them to a 2-letter code* — that is exactly the "product-name-based classification" the batch explicitly forbids ("Do NOT infer categories merely from product names unless an existing approved SAMPLAS rule already does so"), even though the code happens to be structured rather than pure text. No SAMPLAS script, comment, or master file assigns these letters a name. `LT`'s inconsistency (robe + hoodie + tee under one code) is itself evidence this is not a clean, provable taxonomy without brand-level business input.

CONFIDENCE: **NOT PROVEN** (visually suggestive only; zero existing-SAMPLAS documentation).

### Candidate 3 — Cafe24 `categoryNos`

`work/product-dashboard-proxy-2026-08-01_2026-08-31.json`: 821/824 products (99.6%) carry `categoryNos` (100+ distinct numeric IDs, multi-valued per product). Looked very promising by coverage alone — until checked against existing evidence.

CONFIDENCE: **PROVEN, but proven WRONG for this purpose.** An existing prior report (`docs/reports/STEP67-progress-audit.md`, STEP67-10F-0, 2026-08-11) already empirically confirmed: *"Cafe24 categoryNos가 실제로는 프로모션/진열 카테고리임을 실측 확인(merchandise taxonomy 아님)"* — Cafe24's `categoryNos` is a **promotion/display shelf** system (e.g. "New Arrivals," "Weekly Best," brand landing shelves), not a merchandise-type taxonomy (Tops/Bottoms/Bags/Accessories). Using it as "Category Intelligence" would have silently mislabeled every SKU. This is exactly the kind of trap the task's own constraint ("Do NOT invent arbitrary fashion categories") is guarding against, and it was already caught once before.

### Candidate 4 — Cafe24 native `/admin/categories` (name resolution for candidate 3, or any future taxonomy)

`GET /api/cafe24/categories` exists in `server.mjs:210` with a working dual-path implementation (`fetchCafe24CategoryList()`, proxy-first then direct-mode fallback, `server.mjs:2031-2066`) — but its own code comment already disclosed: *"Proxy 쪽에 /api/cafe24/categories... 라우트가 아직 없으면(이번 STEP 실측 결과 404) 이 함수는 그대로 에러를 던진다"*. **Re-confirmed live this session**: `curl` with correct internal auth (`x-samplas-internal-token` / Basic auth from `.env`) against the running local server → `404 Not Found`. The Render-hosted proxy this local instance depends on for all Cafe24 catalog access (per BI-BATCH-B2's finding that direct local Cafe24 auth is structurally disabled) simply has not deployed this route.

## Phase 3 — Decision Gate: PATH B

**No deterministic, existing-SAMPLAS-approved category source exists.** This is not a new finding — it independently reconfirms three prior, separate investigations already on record:

| STEP | Result |
|---|---|
| STEP67-9I-0 | BLOCKED — Category canonical source 없음(6개 후보 전부 조사, 전부 부적합) |
| STEP67-10A | BLOCKED(재확인) — Cafe24 categories 라우트 여전히 404, ECOUNT CLASS_CD 매핑 여전히 없음 |
| STEP67-10F-0 | BLOCKED(독립 재확인) — Cafe24 categoryNos는 프로모션/진열 카테고리(merchandise taxonomy 아님), ECOUNT CLASS_CD 매핑 부재 재확인 |

`entityCategoryRows` remains `const entityCategoryRows = [];` in `outputs/samplas-marketing-os.js:14581` — unchanged, correctly, because nothing has changed upstream since those three prior confirmations.

**Per instruction: do not invent a source. Do not implement fake Category Intelligence. STOP here — Phases 4–15 (adapter, aggregation, UI, drawer, Customer Workspace, tests, Chrome QA) were not attempted, correctly, because they all depend on a canonical category source that does not exist.**

## Exactly What Is Missing

Any ONE of these three would unblock Category Intelligence (not all three — any one is sufficient to start):

1. **Cafe24 category route deployed on the Render proxy** (`/api/products/dashboard`-equivalent for `/admin/categories`) — an infrastructure/deployment task, not something this repo's code can fix. *Even if deployed, Candidate 3's own data (promotion/display shelves) is the wrong taxonomy for merchandise category — this alone would not be sufficient without also addressing #2 or #3.*
2. **A human merchandising decision mapping ECOUNT's `CLASS_CD` (or the product-code type suffix) to real category names** — e.g. a small reference table: `CLASS_CD "002" = "상의(Tops)"`, `CLASS_CD "140" = "..."`, etc., approved by whoever owns SAMPLAS's product taxonomy. Nothing in this repository can supply this without guessing.
3. **An explicit taxonomy integration policy** — if both Cafe24 (promotion shelves) and ECOUNT (`CLASS_CD`, once mapped) end up as separate, non-reconcilable systems, someone needs to decide which one (or how a merge) constitutes "Category" for Brand Intelligence purposes.

## Smallest Input Needed From the User

A merchandising-team-approved decode table for ECOUNT `CLASS_CD` values (or the product-code type suffix, e.g. `AC`/`BG`/`BT`/`ST`/`OT`/`HD`/`SH`/`DR`/`HW`/`FW`/`JW`/`LT`) → real category names, is the smallest, most self-contained unblock: it needs no external deployment, and ECOUNT already covers both online and offline sales once joined through Product Registry (unlike Cafe24's `categoryNos`, which is the wrong signal entirely). Once supplied, BI-BATCH-C's Phase 4 onward (canonical adapter → aggregation → UI → Drawer → Customer Workspace → tests → Chrome QA → commit) can proceed as a single batch exactly as originally planned, reusing BATCH B's existing sales/stock join architecture.

## Files Changed

None. `git status --short` is unchanged except this new untracked report.

## Commit

None — no source or master-data change was made or is warranted (per "If no source/master-data change is required: no artificial commit").

## Limitations / Scope Note

Per instruction, the following were deliberately **not** touched in reaching this conclusion: the 402-entry Product Registry ambiguous queue, CARNET's 3 unconfirmed SKU matches, any AI/fuzzy product-name classification, and any new fashion taxonomy invention.
