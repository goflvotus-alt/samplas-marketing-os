# SAMPLAS Render Operating Baseline — Batch 6: Product Registry Production Alignment — 2026-08-26

**상태: COMPLETE — PRODUCTION VERIFIED**

## Purpose

Batch 5에서 발견된 gap(`work/product-registry.json`의 git-tracked SAFE-N
human-review 결과가 Render 영구 디스크에 반영되지 않음)을 정량화하고,
canonical authority를 확정한 뒤, 최소 코드 변경(allowlist 1줄×2)으로
정식 업로드 경로를 열어 Product Registry를 Local=Render로 동기화한다.

## A. BASELINE

```
branch: main
HEAD          = 9f71411e9d3f3d1daa365f9a4fd372a4f3e3984e
origin/main   = 9f71411e9d3f3d1daa365f9a4fd372a4f3e3984e  (0/0)
staged        = 없음
tracked modified = 2개(예상과 일치)
  M scripts/diagnose-cafe24-ecount-product-matching.mjs
  M scripts/load-ecount-offline-sales.mjs
untracked = 116
```
예상과 완전히 일치 — 진행.

## B. SOURCE TRACE

```
intelligence-service.mjs:57   workRoot = resolve(env.WORK_DIR || join(root, "work"))
intelligence-service.mjs:67   productRegistryFile = join(workRoot, "product-registry.json")
intelligence-service.mjs:535  readProductRegistryJson(filePath) = JSON.parse(await readFile(filePath, "utf8"))
intelligence-service.mjs:663  handleProductRegistryGet() → readProductRegistryJson(productRegistryFile) → { ok:true, registry }
intelligence-service.mjs:418  GET /api/intelligence/product-registry → handleProductRegistryGet(res)
render.yaml                    WORK_DIR=/var/data/samplas-dashboard/work (persistent disk, git 체크아웃과 완전히 분리)
```
- **Git checkout fallback 없음** — `readProductRegistryJson`은 단순
  `readFile`+`JSON.parse`, 파일이 없으면 그대로 throw(500). git 저장소의
  `work/product-registry.json`을 대체 경로로 참조하는 로직은 어디에도 없음.
- **확정**: Render는 항상 `/var/data/samplas-dashboard/work/product-registry.json`
  (persistent disk)만 읽는다. git push는 이 경로에 어떤 영향도 주지 않는다.
- **부가 발견**: `resolveCommercialPolicyOnlinePrice()`(intelligence-service.mjs:547)도
  같은 `productRegistryFile`을 런타임에 직접 읽어 Chrome extension 계열
  commercial-policy 조회(`registry_status`/`registry_verified` 필드)에
  즉시 반영된다 — Product Registry 화면뿐 아니라 이 API도 이번 gap의
  영향권.
- **Price Audit과의 경계**: `scripts/build-price-audit.mjs:196`이
  `work/product-registry.json`을 입력으로 읽어 `work/price-audit.json`을
  생성한다 — 단, 이 생성은 **Local에서 수행되는 별도 batch 스텝**이며
  Render 런타임이 요청 시점에 실시간으로 registry를 읽어 price-audit을
  재계산하는 구조가 아니다(§H에서 재확인).

## C. LOCAL REGISTRY

```
path: work/product-registry.json
sha256: dfe89ef93c0a82f6da8fcbe6d10771228b9c85ab790a790380199385c825b8b6
generatedAt: 2026-08-23T10:46:32.234Z
git 상태: git diff --stat 결과 없음(working tree == HEAD 커밋본, 완전 일치)
```
| 항목 | count |
|---|---|
| entries(총) | 3,596 |
| status: confirmed | 392 |
| status: unmatched | 169 |
| status: candidate | 12 |
| status: ambiguous | 3,023 |
| verified: true | 392 |
| verified: false | 3,204 |
| duplicate prodCd(2회 이상 참조되는 ECOUNT SKU) | 180 |

SAFE provenance(`matching.evidence[]` 배열 내 태그, 재계산 기준):
```
price_audit_safe24: 24
price_audit_safe20: 20
price_audit_safe18: 18
price_audit_safe10: 10
(합계 72)
```
`git log --oneline -- work/product-registry.json`으로 커밋 이력 확인:
```
65d6fff fix(price-audit): confirm safe10 product matches
1b1492d fix(price-audit): confirm safe20 product matches
34cf74d fix(price-audit): confirm safe18 product matches
3462ebc fix(price-audit): migrate current Cafe24 product mapping
c0351f4 fix(product-registry): repair provenance and summary drift
43ed178 data(product-registry): promote deterministic sku matches
0089059 fix(product): include cafe24-only registry anchors
f79c527 feat(product): build canonical product registry
```
(참고: SAFE24 태그가 붙은 24건은 이 커밋들 중 하나에 섞여 반영된 것으로
보이며, 그 이름 그대로의 "confirm safe24" 커밋 메시지는 없음 — 데이터
자체(§E)로 재확인했으므로 커밋 메시지 명명 불일치는 이번 판정에 영향 없음.)

## D. RENDER REGISTRY (업로드 전)

```
GET https://samplas-marketing-os.onrender.com/api/intelligence/product-registry
generatedAt: 2026-08-20T05:26:48.361Z
entries: 3,596
```
| 항목 | count |
|---|---|
| status: confirmed | 254 |
| status: unmatched | 307 |
| status: candidate | 12 |
| status: ambiguous | 3,023 |
| verified: true | 254 |
| verified: false | 3,342 |
| price_audit_safe24/20/18/10 태그 보유 entries | 0 / 0 / 0 / 0 |

Local 대비 confirmed 138건 적음(392−254=138), verified도 동일하게
138건 적음 — §E에서 정확히 이 138건을 특정.

## E. EXACT DIFF

Key: `canonicalProductId`(우선) 또는 `cafe24.productNo`(fallback) — 두
값 모두 스키마상 entry당 유일.

```
Local entries: 3,596 (unique key 3,596)
Render entries: 3,596 (unique key 3,596)
Local only: 1  (CP-C24-14887)
Render only: 1 (CP-C24-14560)
공통 key: 3,595
```

**Local only / Render only 1쌍은 같은 상품의 productNo 마이그레이션**
(브랜드 레저렉션13 "26-AC011 CREAM") — 커밋 `3462ebc fix(price-audit):
migrate current Cafe24 product mapping`에서 Cafe24 productNo가
14560→14887로 바뀐 결과. Render는 옛 productNo(14560, unmatched)를 그대로
갖고 있고, Local은 새 productNo(14887, confirmed)로 갱신됨 — 별도의
"신규/누락 상품"이 아니라 이번 gap과 동일한 stale 문제의 한 사례.

공통 3,595건 중 상태 비교(`status`/`verified`/`confidence` 3필드 기준):
```
동일(identical): 3,458
차이(diff): 137
  - status/verified/confidence 차이: 137건 (ecount matched SKU 차이나
    provenance만 다른 케이스는 0건 — 상태가 다르면 항상 verified/confidence도
    함께 다름, 부분 불일치 없음)
```
137건 + local-only 1건 = **총 138건**이 Local이 Render보다 앞서 있는
전체 규모.

138건의 원인 분해:
```
SAFE-N(human_review_approved 계열, evidence 태그 존재) 합계: 72건
  - safe24: 24 (이 중 1건이 위 productNo 마이그레이션 케이스)
  - safe20: 20
  - safe18: 18
  - safe10: 10
기타 deterministic-match 확인분(evidence: normalized_product_name,
  ecount_exact_name, uniform_sales_price, pure_brand_prefix_scope,
  sku_family_verified, size_variation_verified 등, SAFE-N 태그 없음): 66건
72 + 66 = 138 (정확히 일치, 미설명 잔여 0건)
```
**분류 6종 결과**:
1. Local only: 1건(productNo 마이그레이션)
2. Render only: 1건(위와 동일 쌍, 옛 productNo)
3. same entry / different status(verified/confidence 포함): 137건
4. same entry / different ECOUNT matches(only, status 동일): 0건
5. same entry / different provenance(only, status/ecount 동일): 0건
6. same entry / other metadata difference(그 외 완전 동일하지 않은 나머지): 0건

## F. SAFE-N VERIFICATION

| Batch | 건수 | Local 반영 | Render 반영(전) | production reflection |
|---|---|---|---|---|
| SAFE24 | 24 | 24/24 confirmed+verified | 0/24 | **누락 24/24** |
| SAFE20 | 20 | 20/20 confirmed+verified | 0/20 | **누락 20/20** |
| SAFE10 | 10 | 10/10 confirmed+verified | 0/10 | **누락 10/10** |
| (참고) SAFE18 | 18 | 18/18 | 0/18 | **누락 18/18**(동일 근본원인, 함께 해소) |

**합계(SAFE24+SAFE20+SAFE10 요청 범위)**: 54건 전부 production 미반영
확인. SAFE18(18건)까지 포함하면 SAFE-N 계열 전체 72건, 여기에 비-SAFE
deterministic 확인분 66건을 더하면 총 138건이 이번 gap의 전체 규모.

**Ownership 확인**: 137건 전부에서 ECOUNT matched SKU(prodCd) 소유권은
Local 쪽에만 존재(Render는 `matchedProducts: []` 또는 다른 상태) — SKU
분쟁/충돌 없음, 단순 누락.

**Render-only 사례 특별 확인**: Render only key(CP-C24-14560)는 Local의
새 productNo(14887) 이전의 옛 레코드일 뿐, **Render가 독자적으로 만든
새로운 human review 결과가 아님**(§G에서 이 판정의 근거로 재사용).

## G. CANONICAL AUTHORITY

검증 방법: 공통 3,595건 전체에 대해 "Render가 verified/confirmed인데
Local이 아닌" 역방향 케이스가 있는지 전수 스캔.

```
Render verified/confirmed but Local NOT (render-ahead 후보): 0건
Local verified/confirmed but Render NOT (local-ahead): 137건
```
**Render-only newer valid entry 없음** — 반대 방향 diff가 정확히 0건으로
확인됨. Local-only 1건도 §F에서 확인했듯 Render의 독자적 신규 검토가
아니라 옛 productNo 잔존.

```
판정: LOCAL/GIT CANONICAL
```
Overwrite 안전 — merge 불필요.

## H. PRICE AUDIT RELATION

```
scripts/build-price-audit.mjs:196  readJson(join(workDir, "product-registry.json"))
  → work/product-registry.json을 입력으로 사용해 work/price-audit.json 생성
  → 이 생성은 Local에서 명시적으로 실행하는 별도 스크립트(node
    scripts/build-price-audit.mjs), Render 런타임이 요청마다 재계산하는
    구조가 아님.

intelligence-service.mjs:handlePriceAuditGet()
  → work/price-audit.json을 그대로 읽어 반환(정적 snapshot), registry를
    다시 읽지 않음.

intelligence-service.mjs:547 resolveCommercialPolicyOnlinePrice()
  → product-registry.json을 런타임에 직접 읽음(§B 부가 발견) — Price
    Audit 화면과는 별개의 API(Chrome extension commercial-policy 조회).
```
**결론**: Registry 업로드만으로 `work/price-audit.json` snapshot 자체가
자동으로 바뀌지 않는다(별도 파일, 별도 생성 스텝) — 이번 batch에서
`build-price-audit.mjs`를 재실행하거나 `price-audit.json`을 재업로드하지
않음(지시 준수). 기존 Render Price Audit summary(MATCH 2977 등)는 그대로
유지될 것으로 예상 — §N에서 실측 확인.

## I. ALLOWLIST CHANGE

업로드 전 재확인:
```
server.mjs workDataUploadPaths: product-registry.json 없음(확인)
scripts/upload-work-snapshots-to-render.mjs explicitPaths: product-registry.json 없음(확인)
```
변경(각 1줄):
```diff
# server.mjs
 const workDataUploadPaths = new Set([
   "brand-master.json",
   "price-audit.json",
   "today-product-sync-issues.json",
   "store-master.json",
+  "product-registry.json",
   ...

# scripts/upload-work-snapshots-to-render.mjs
 const explicitPaths = [
   "brand-master.json",
   "price-audit.json",
   "today-product-sync-issues.json",
   "store-master.json",
+  "product-registry.json",
   ...
```
Broad wildcard 없음, Product Registry API/loader/schema/UI 변경 없음.

## J. CODE COMMIT / DEPLOY

정적/보안 검증:
```
node --check server.mjs                                    → OK
node --check scripts/upload-work-snapshots-to-render.mjs    → OK
isAllowedWorkDataUploadPath("../../etc/passwd")             → false
isAllowedWorkDataUploadPath("product-registry.json")        → true
isAllowedWorkDataUploadPath("random-arbitrary.json")        → false
isAllowedWorkDataUploadPath("monthly/2026-08.json")         → true(기존 그대로)
```
Diff scope: 정확히 2개 파일, 각 1줄 추가(총 2 insertions), unrelated 2개
파일 미포함.

```
commit: fix(render-data): allow product registry snapshot upload
hash:   bc65017
fetch/push: 0 ahead → push 성공 → HEAD = origin/main = bc65017
```

## K. DRY RUN

Render 배포 확인(안전한 behavior probe, 실제 쓰기 없음):
```
POST /api/work-data/upload {files:[{relativePath:"product-registry.json", jsonText:"{}"}], overwrite:false}
→ HTTP 409 "기존 work 데이터가 있어 업로드를 중단합니다: product-registry.json"
```
이 409는 allowlist 통과(구코드였다면 400 "허용되지 않은 경로") 이후
conflict 체크에서 발생 — **새 allowlist가 Render에 정상 배포됐음을 실제
쓰기 없이 확인**.

Local dry-run:
```
node scripts/upload-work-snapshots-to-render.mjs --dry-run product-registry.json
{"dryRun": true, "files": ["product-registry.json"]}
```
정확히 1개, 다른 snapshot 없음.

## L. UPLOAD

Overwrite 직전 안전 기록(Production-Before Safety Record):
```
Render pre-overwrite 전체 응답 저장: work/product-registry.json.render-pre-batch6-backup-2026-08-26T04-47-56.json
  sha256: d9a54350e7b44dc99777457d19db67da033cab2da855b39fff05926b53d14827
  (gitignored, Local 전용 안전 백업 — 롤백 필요 시 이 파일을 다시 업로드)
Render 서버 자체의 자동 버전 이력/백업 메커니즘: 없음(uploadWorkDataFiles()는
  atomic write이나 이전 버전을 별도 보관하지 않음) — 위 로컬 사본이 유일한
  롤백 근거.
Canonical 판정(§G): LOCAL/GIT CANONICAL, Render-only 유효 데이터 0건 —
  overwrite 안전 근거 충분.
```
업로드 실행:
```
node scripts/upload-work-snapshots-to-render.mjs --overwrite product-registry.json
{"ok": true, "overwrite": true, "uploaded": ["product-registry.json"]}
```
금지 항목(price-audit/ECOUNT/Inventory/Store Master/Brand Registry/Monthly
archives/backup) 어느 것도 업로드하지 않음 — 정확히 1개 파일만.

## M. PRODUCT REGISTRY AFTER

```
GET /api/intelligence/product-registry (업로드 직후)
LOCAL  generatedAt: 2026-08-23T10:46:32.234Z
RENDER generatedAt: 2026-08-23T10:46:32.234Z
Local == Render (완전한 JSON 객체 비교): True
entries: 3,596 = 3,596
remaining diffs: 0
```
| Batch | before | after |
|---|---|---|
| SAFE24 | 0/24 | **24/24** |
| SAFE20 | 0/20 | **20/20** |
| SAFE10 | 0/10 | **10/10** |
| SAFE18 | 0/18 | **18/18** |
| CP-C24-14887(구 P0000LTT 계열 evidence) | unmatched | **confirmed, verified=true** |

목표 전부 달성: exact diff = 0, SAFE24 24/24, SAFE20 20/20, SAFE10 10/10,
evidence entry 동일.

## N. PRICE AUDIT REGRESSION

```
GET /api/intelligence/price-audit (Render, 업로드 후)
generatedAt: 2026-08-25T02:40:11.541Z  (변경 없음)
summary: MATCH 2977, ECOUNT_HIGHER 75, ECOUNT_LOWER 43, MATCH_REQUIRED 169, REVIEW_REQUIRED 332
LOCAL과 완전 일치, 업로드 전 baseline과도 완전 일치
```
**예상대로 유지됨** — Registry 업로드가 Price Audit snapshot을 재생성/재업로드하지 않았음을 실측 확인(§H 코드 분석과 일치).

## O. CORE REGRESSION

```
GET /api/status                                    → 200
GET /api/sales/total?since=2026-08-01&until=2026-08-26
  → total 197,166,398, byStore {APGUJEONG:157,300,800, VAIL:10,063,700}
GET /api/reports/monthly?month=2026-08              → total 197,166,398(동일)
GET /api/intelligence/clients                       → totalClients 98, orderCount 380
GET /api/intelligence/store?store=APGUJEONG         → periodSales 157,300,800, orderCount 256(불변)
GET /api/intelligence/store?store=VAIL              → periodSales 10,063,700, orderCount 36(불변)
GET /api/inventory/overview                         → summary 완전 동일(totalKnownStock 2936 등, Batch 4/5 baseline과 일치)
GET /api/intelligence/brands                        → count 278, aliasCount 361(불변)
```
당월 online 매출/클라이언트 카운트가 하루 지남에 따라 자연 증가한 것(196.5M
→197.2M, orderCount 376→380)은 정상 live 데이터 변동이며 회귀 아님 —
byStore/Inventory/Brand Registry 등 정적 항목은 전부 이전 batch baseline과
완전 일치.

## P. OPERATING BASELINE

`docs/SAMPLAS-OPERATING-BASELINE.md` §5 갱신(기존 내용 삭제 없이 추가):
- 현재 upload allowlist 목록에 `product-registry.json` 반영
- "알려진 gap" 섹션은 원문 보존, 그 아래 "해소(Batch 6)" 문단 추가
- 신규 "Product Registry 업데이트 규칙" 4단계(Local validation → Git
  commit → 명시적 Render upload → Production verification) 추가 — 이
  gap의 재발 방지가 목적.

## Q. DEVELOPMENT REPORT

이 문서 자체가 report:
```
path: docs/reports/render-product-registry-alignment-2026-08-26.md
```

## R. DOCS COMMIT / PUSH

아래(§ 최종 실행 기록 참조) — 이 report + `docs/SAMPLAS-OPERATING-BASELINE.md`
2개 문서만 stage, commit `docs(ops): record product registry deployment
policy`로 별도 커밋 예정.

## S. WORKTREE SAFETY

```
HEAD = origin/main = bc65017(코드 커밋까지 반영)
staged = 없음(문서 커밋 전)
unrelated tracked modified 2개: 보존, 수정 없음
untracked 116건: 그대로(안전 백업 파일 1개만 work/ 아래 신규 추가, gitignore
  대상이라 untracked 목록에 +1 되지만 git 추적/커밋 대상 아님)
no cleanup, no unrelated data mutation
```

## T. VERDICT

```
PRODUCT REGISTRY PRODUCTION ALIGNMENT COMPLETE
BATCH 6 PRODUCT REGISTRY ALIGNMENT COMPLETE — PRODUCTION VERIFIED
```

72건(SAFE10/18/20/24)과 66건(기타 deterministic 확인분), 총 138건의
Product Registry 차이를 정량화하고, canonical authority를 LOCAL/GIT으로
확정(Render-only 유효 데이터 0건 실측 확인)한 뒤, allowlist 2줄 추가로
정식 업로드 경로를 열어 업로드 → Local=Render exact diff 0 확인. Price
Audit snapshot과 나머지 핵심 프로덕션 지표는 전부 회귀 없이 유지됨.
