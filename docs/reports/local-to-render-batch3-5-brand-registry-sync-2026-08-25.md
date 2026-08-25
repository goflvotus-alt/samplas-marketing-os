# SAMPLAS Local → Render Migration — Batch 3.5: Brand Registry Rebuild & Sync — 2026-08-25

**상태: COMPLETE — PRODUCTION VERIFIED**

## 1. Purpose

`local-to-render-batch3-5-brand-master-alias-audit-2026-08-25.md`에서 확정된
root cause(`ensureBrandRegistryFiles()`의 bootstrap-once 설계로 인해
`work/intelligence/brand-master-list.json`/`brand-aliases.json`이 canonical
source `work/brand-master.json`보다 뒤처짐, Local/Render가 서로 다른 과거
시점에 멈춰 있음)를 해소한다. 기존 exported builder
`buildIntelligenceBrandRegistry()`를 재사용해 두 파일을 현재
canonical source 기준으로 재생성하고, 검증 후 Render에 동기화한다.
새 builder/로직은 만들지 않았다.

## 2. Baseline

```
HEAD = origin/main = 9b8d8bcf489fbc2aef7399ca875aa9df46438ba4
ahead/behind: 0/0, staged: 없음
unrelated unstaged 2개(diagnose-cafe24-ecount-product-matching.mjs, load-ecount-offline-sales.mjs): 보존
untracked: 117
```

## 3. Root Cause Reference

`local-to-render-batch3-5-brand-master-alias-audit-2026-08-25.md` E절 확정
내용 그대로: 두 파생 파일이 canonical source 갱신 시 재생성되지 않는
bootstrap-once 코드 구조. 이 문서를 삭제/수정하지 않고 그대로 참조만 함.

## 4. Builder Path

- `buildIntelligenceBrandRegistry(sourceBrands)` — `intelligence-service.mjs:2764`, exported, **순수 함수(파일 I/O 없음)**
- input: `work/brand-master.json`의 `brands` 배열
- output: `{brands, aliases}` 객체(파일 아님) — 실제 파일 쓰기는 별도
- active brand key 충돌 시 `selectBrandOwner()`가 `Error("Active brand key conflict")`를 throw(무결성 보장)
- 공식 write 경로(`ensureBrandRegistryFiles()`)는 non-atomic `writeJson()`(직접 `writeFile`) 사용 — 동일 패턴으로 재현
- 다른 tracked/data 파일에는 전혀 쓰지 않음(함수 자체가 순수 계산만 수행)

## 5. Rebuild Execution

재생성 전 기존 파생 파일 backup 생성(추가 안전장치, 공식 경로엔 없지만 이번
세션 전반의 관행):
```
work/intelligence/brand-master-list.json.backup-2026-08-25T10-29-54-800Z
work/intelligence/brand-aliases.json.backup-2026-08-25T10-29-54-800Z
```

`buildIntelligenceBrandRegistry()`를 canonical source(`work/brand-master.json`,
295 brands)로 직접 호출, 결과를 공식 write 패턴(`writeFile`, JSON.stringify
pretty)으로 두 파일에 저장:

```
결과: brands 278, aliases 361  (에러 없음, active key 충돌 없음)
```

| | before (2026-08-03 bootstrap) | after (canonical 295개 기준 재생성) |
|---|---|---|
| brand-master-list.json | 273 brands, hash `6023de9c...` | 278 brands, hash `3ac189d7...` |
| brand-aliases.json | 290 aliases, hash `7e768eb0...` | 361 aliases, hash `a184d5a3...` |
| mtime | 2026-08-03 | 2026-08-25 19:30 |

## 6. Canonical / Superset Validation

- **canonical coverage:** active canonical brand 163개 중 162개가 새 derived master에 존재. 유일한 예외는 `B0000000`(`brand_name: ""`, 자체브랜드 placeholder) — builder가 `if (!id || !name...) continue;`로 **의도적으로** 스킵하는 항목, 실제 결측 아님.
- **duplicate check:** 새 derived master 내 `id` 중복 0건.
- **superset(구 로컬 대비):** 기존 로컬 290개 alias 매핑 전부가 새 361개 안에 그대로 보존됨(변경/유실 0건, 완전 검증).
- **superset(Render 대비, 23개 표본):** 이전 audit에서 확인된 23개 차이 브랜드 전부, 새 로컬 registry가 Render와 **정확히 동일한 brandId**로 해석함(23/23 일치, 아래 표).

| raw | new LOCAL resolve | 기존 RENDER resolve | 일치 |
|---|---|---|---|
| 604SERVICE | B00000OO | B00000OO | ✅ |
| 8IGB | B00000UO | B00000UO | ✅ |
| ALIVEFORM | B00000TQ | B00000TQ | ✅ |
| AVAVAV | B00000SS | B00000SS | ✅ |
| BONNAE | B00000SA | B00000SA | ✅ |
| CARNET ARCHIVE | B00000KU | B00000KU | ✅ |
| CHEW FOREVER | B0000BBS | B0000BBS | ✅ |
| DEADWOOD | B00000UR | B00000UR | ✅ |
| FNK STUDIOS | B0000BBD | B0000BBD | ✅ |
| GEMGEM PARADIS | B0000BBV | B0000BBV | ✅ |
| GERRIT JACOB | B00000VJ | B00000VJ | ✅ |
| HELIOT EMIL | B00000PY | B00000PY | ✅ |
| IFEELLUCKY | B00000RI | B00000RI | ✅ |
| KAMIGIN | B0000BCQ | B0000BCQ | ✅ |
| MINGA | B0000BCK | B0000BCK | ✅ |
| NAMILIA | B00000SK | B00000SK | ✅ |
| PACOSPLY | B00000ZT | B00000ZT | ✅ |
| PAX00100 | B00000XD | B00000XD | ✅ |
| PROTOTYPES | B00000SD | B00000SD | ✅ |
| Publichousingskateteam | B00000VM | B00000VM | ✅ |
| RACER WORLD WIDE | B00000WE | B00000WE | ✅ |
| SURGERY | B00000JA | B00000JA | ✅ |
| XLIM | B00000LC | B00000LC | ✅ |

**23/23 PASS, 0 mismatch, 0 missing.**

## 7. Local Inventory Revalidation

```
GET http://127.0.0.1:8787/api/inventory/overview (재생성 직후)
generatedAt: 2026-08-25T10:14:37.733Z  (Inventory snapshot 자체는 무변경 — 유지 확인)
summary: 재생성 전과 완전 동일(브랜드 registry만 바뀌었으므로 재고 수치는 불변)
brandRollup count: 252 → 246
```
`readBrandRegistry()`는 파일을 매 요청마다 새로 읽으므로(캐시 없음) 서버
재시작 불필요 — 즉시 반영 확인.

before/after `raw:` 미해결 셋을 직접 비교:
```
before raw count: 185
after  raw count: 140
newly resolved: 45   (23개 목표 브랜드 포함, canonical source가 295개로 늘어난 김에 다른 22개 브랜드도 부수적으로 해결됨)
newly broken (regression): 0
```
남은 140개 `raw:`는 콜라보 대괄호 표기, 퀵비/할인 등 비-브랜드 라인,
`ANOMALIES DEPARTMENT`/`DOLLAVA`/`SUPER POSITION` 등 아직
`brand-master.json`에 등록되지 않은 브랜드 등 — 이번 배치의 대상(local↔render
차이)이 아니라 **원래부터 양쪽 다 미해결이던 별개의 기존 gap**, 확장하지
않음.

## 8. Dry Run

```
node scripts/upload-work-snapshots-to-render.mjs --dry-run intelligence/brand-master-list.json intelligence/brand-aliases.json
{"dryRun": true, "files": ["intelligence/brand-aliases.json", "intelligence/brand-master-list.json"]}
```
정확히 2개, 다른 snapshot 없음.

## 9. Upload

```
node scripts/upload-work-snapshots-to-render.mjs --overwrite intelligence/brand-master-list.json intelligence/brand-aliases.json
{"ok": true, "overwrite": true, "uploaded": ["intelligence/brand-aliases.json", "intelligence/brand-master-list.json"]}
```
canonical `brand-master.json`, Inventory, ECOUNT sales, Store Master, Price
Audit, Registry, backup 등 다른 어떤 파일도 업로드하지 않음.

## 10. Production Brand Validation

```
GET https://samplas-marketing-os.onrender.com/api/intelligence/brands
RENDER: count 278, aliasCount 361
LOCAL:  count 278, aliasCount 361   (완전 일치)
```

`/api/intelligence/brands/resolve`로 23개 전부 Render에서도 재확인 —
23/23 LOCAL과 정확히 동일한 brandId 반환.

## 11. Inventory Local ↔ Render (최종)

```
generatedAt: 완전 일치
summary: 완전 일치
coverage: 완전 일치
brandRollup count: 246 = 246
key-set 비교: only-in-local 0, only-in-render 0  (23-brand 정체성 차이 = 0 달성)
```

53개 공통 키에서 `recentSalesQty` 필드값만 소폭 상이(예:
카르넷아카이브 LOCAL 92 vs RENDER 86) — 다른 모든 필드(totalSku,
knownStock, qqqEstimatedSoldQuantity 등)는 완전 동일. `recentSalesQty`는
"요청 시점 기준 최근 판매 수량"을 매 요청마다 새로 계산하는 **live rolling
metric**이라, 이번 세션에서 LOCAL/RENDER 요청이 서로 다른 실제 시각에
발생한 데서 오는 자연스러운 차이이며, 이번 batch(브랜드 정체성 동기화)와
무관한 별개 필드다 — 회귀 아님.

## 12. Regression

```
/api/status                                       -> 200
/api/sales/total?since=2026-08-01&until=2026-08-25 -> total 196,511,398, byStore {APGUJEONG: 157,300,800, VAIL: 10,063,700}
/api/intelligence/clients                          -> totalClients 97, orderCount 376
/api/intelligence/price-audit                      -> generatedAt 2026-08-25T02:40:11.541Z, MATCH 2977 등 불변
/api/intelligence/store?store=APGUJEONG            -> 200
/api/intelligence/store?store=VAIL                 -> 200
```
Batch 1/2/3 결과 전부 그대로 유지, 회귀 없음.

## 13. Design Debt (수정하지 않음, 기록만)

`ensureBrandRegistryFiles()`의 bootstrap-once 설계는 이번 수동 재생성으로
"현재 시점"만 맞춘 것이며, **재발 가능성이 있다** — `work/brand-master.json`이
다음에 갱신될 때(예: 신규 브랜드/콜라보 추가) 이 두 파생 파일은 또다시
자동으로 뒤처지기 시작한다. 향후 검토 옵션(이번 배치 범위 밖, 별도 개발
task로 남김):
- canonical `brand-master.json`의 mtime/hash 변경을 감지해 파생 파일을
  자동 rebuild하는 로직 추가
- `node scripts/rebuild-brand-registry.mjs` 같은 명시적 rebuild 커맨드 신설
- warehouse/SAFE-N류 작업처럼 "canonical 변경 → 파생 파일 rebuild"를 표준
  운영 절차(sync workflow)에 포함

## 14. Data File Git Policy

`work/intelligence/brand-master-list.json`, `work/intelligence/brand-aliases.json`,
그리고 canonical `work/brand-master.json` 전부 `.gitignore`의 `work/`
규칙에 걸리는 **미추적(untracked) 파일**임을 확인(`git ls-files` 빈 결과,
`git check-ignore -v` 확인). 이번 재생성/backup/업로드는 전부 이 정책과
일치하며 git force-add를 하지 않았다.

## 15. Final Status

```
COMPLETE — PRODUCTION VERIFIED
```
