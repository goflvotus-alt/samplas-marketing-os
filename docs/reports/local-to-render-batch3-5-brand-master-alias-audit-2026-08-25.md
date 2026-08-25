# SAMPLAS Local → Render Migration — Batch 3.5: Brand Master / Alias Sync Root-Cause Audit — 2026-08-25

**상태: READ ONLY AUDIT COMPLETE — 수정/업로드/commit/push 없음**

## 1. Purpose

Batch 3(Inventory 재수집/업로드) 검증 중 `brandRollup`에서 발견된 23개
브랜드의 Local/Render 불일치(Local `raw:xxx` 미해결 vs Render `B0000XXX`
해결됨) 원인을 코드/데이터 기준으로 확정한다.

## A. Brand Resolution Flow

- `GET /api/inventory/overview` → `intelligence-service.mjs:930` `buildInventoryOverview()`(`scripts/inventory-overview-lib.mjs`)가 각 ECOUNT row의 브랜드를 `resolveDisplayBrand(brandRaw, brandRegistry)`로 해석
- `resolveDisplayBrand()` → `resolveEcountBrand(brandRaw, brandRegistry)`가 매칭되면 canonical `{key: brandId, name, canonical:true}` 반환, **매칭 실패 시 `{key: "raw:"+normalizeBrandKey(raw), name: raw, canonical:false}`로 fallback**(`scripts/inventory-overview-lib.mjs:131-135`)
- `brandRegistry = {brands, aliases}`는 `intelligence-service.mjs:924` `readBrandRegistry()`가 공급 → `brandMasterListFile = work/intelligence/brand-master-list.json` + `brandAliasesFile = work/intelligence/brand-aliases.json`를 읽음(`intelligence-service.mjs:60-61, 2830-2832`)
- 이 두 파일은 **`work/brand-master.json`(canonical source)과는 별개의 파생(derived) 파일**이며, `ensureBrandRegistryFiles()`(`intelligence-service.mjs:2745-2754`)가 생성을 담당:
  ```js
  async function ensureBrandRegistryFiles() {
    await mkdir(intelligenceWorkDir, { recursive: true });
    if (!existsSync(brandMasterListFile) || !existsSync(brandAliasesFile)) {
      const source = await readMarketingBrandMaster();  // work/brand-master.json
      const { brands, aliases } = buildIntelligenceBrandRegistry(source.brands);
      if (!existsSync(brandMasterListFile)) await writeJson(brandMasterListFile, brands);
      if (!existsSync(brandAliasesFile)) await writeJson(brandAliasesFile, aliases);
    }
    await readBrandRegistry();
  }
  ```
  **핵심: `if (!existsSync(...))` — 파일이 이미 존재하면 절대 다시 쓰지 않는다.** 즉 이 두 파일은 "최초 1회 bootstrap 후 영구 고정"되는 구조이며, `brand-master.json`이 그 이후 아무리 갱신돼도 재생성되지 않는다. 코드 전체를 확인한 결과 이 두 파일을 재생성하는 다른 경로는 없다.

## B. Local Sources

| path | exists | mtime | count | hash(sha256) |
|---|---|---|---|---|
| `work/intelligence/brand-master-list.json` | YES | 2026-08-03 02:14 | 273 brands | `6023de9c...` |
| `work/intelligence/brand-aliases.json` | YES | 2026-08-03 02:14 | 290 aliases | `7e768eb0...` |
| `work/brand-master.json` (canonical source) | YES | 2026-08-23 14:05 | **295 brands** | — |

`/api/intelligence/brands`(LOCAL) → `count: 273, aliasCount: 290`. 즉 local의
파생 파일은 **8월 3일에 bootstrap된 후 한 번도 재생성되지 않았고**, 그
사이 canonical source(`brand-master.json`)는 273 → 295개로 22개 이상 늘어난
상태(이번 세션에서 처리한 MEANTIME X SUNDAYOFFCLUB 콜라보 추가 포함).

## C. Render Sources

Persistent disk에 직접 접근할 수 없어, 실제 서빙되는 API 응답으로 간접 비교:

```
GET https://samplas-marketing-os.onrender.com/api/intelligence/brands
-> count: 273, aliasCount: 289
```

Local(273/290)과 거의 같은 규모이지만 **정확히 같지는 않음**(alias 1개 차이) —
즉 Render의 파생 파일도 별도로 한 번 bootstrap된 스냅샷이며, local과 같은
시점에 만들어진 것도 아니고, 현재 canonical source(295개)와도 다르다.

`/api/intelligence/brands/resolve?name=X` 직접 호출로 3개 샘플 재확인:

| brand | LOCAL 결과 | RENDER 결과 |
|---|---|---|
| 604SERVICE | `null`(미해결) | `{brandId: "B00000OO", name: "604SERVICE"}` |
| CARNET ARCHIVE | `null` | `{brandId: "B00000KU", name: "CARNET ARCHIVE"}` |
| XLIM | `null` | `{brandId: "B00000LC", name: "XLIM"}` |

## D. Differing Brands (23/23 전체)

`work/brand-master.json`의 `brand_code`→`brand_name` 매핑으로 23개 전부의
identity를 교차 확인 — 완전히 1:1로 대응됨(추측 아님, 직접 매칭):

| raw brand (LOCAL 미해결) | Render 해결 코드 | canonical 이름 | Local 근거 | Render 근거 |
|---|---|---|---|---|
| 604SERVICE | B00000OO | 604서비스 | `raw:604service` fallback | resolve API 성공 |
| 8IGB | B00000UO | 에잇아이쥐비 | 동일 | 동일 |
| ALIVEFORM | B00000TQ | 얼라이브폼 | 동일 | 동일 |
| AVAVAV | B00000SS | 아바바브 | 동일 | 동일 |
| BONNAE | B00000SA | 본네 | 동일 | 동일 |
| CARNET ARCHIVE | B00000KU | 카르넷 아카이브 | 동일 | 동일 |
| CHEW FOREVER | B0000BBS | 츄 포에버 | 동일 | 동일 |
| DEADWOOD | B00000UR | 데드우드 | 동일 | 동일 |
| FNK STUDIOS | B0000BBD | 에프엔케이 스튜디오 | 동일 | 동일 |
| GEMGEM PARADIS | B0000BBV | 젬젬 파라디스 | 동일 | 동일 |
| GERRIT JACOB | B00000VJ | 게릿 제이콥 | 동일 | 동일 |
| HELIOT EMIL | B00000PY | 엘리엇 에밀 | 동일 | 동일 |
| IFEELLUCKY | B00000RI | 아이필럭키 | 동일 | 동일 |
| KAMIGIN | B0000BCQ | 카미긴 | 동일 | 동일 |
| MINGA | B0000BCK | 밍가 | 동일 | 동일 |
| NAMILIA | B00000SK | 나밀리아 | 동일 | 동일 |
| PACOSPLY | B00000ZT | 파코서플라이 | 동일 | 동일 |
| PAX00100 | B00000XD | 팩스00100 | 동일 | 동일 |
| PROTOTYPES | B00000SD | 프로토타입스 | 동일 | 동일 |
| Publichousingskateteam | B00000VM | 퍼블릭하우징스케이트팀 | 동일 | 동일 |
| RACER WORLD WIDE | B00000WE | 레이서 월드 와이드 | 동일 | 동일 |
| SURGERY | B00000JA | 써저리 | 동일 | 동일 |
| XLIM | B00000LC | 엑슬림 | 동일 | 동일 |

전부 `work/brand-master.json`에 `brand_name`(한글) + `name_aliases`(영문)로
이미 등록돼 있는 브랜드들이며, Render의 파생 파일 bootstrap 시점에는
반영돼 있었으나 Local의 파생 파일 bootstrap 시점(8/3)에는 아직
`brand-master.json`에 없었던 것으로 보인다.

## E. Root Cause

**확정: "4. code difference" — 정확히는 `ensureBrandRegistryFiles()`의
bootstrap-once-if-missing 설계 결함으로 인해 (1)과 (2) 둘 다 stale해진
결과.**

- `intelligence/brand-master-list.json`, `intelligence/brand-aliases.json`
  둘 다 **canonical source(`work/brand-master.json`, 현재 295개)보다
  뒤처져 있음**(local 273개, render 273개 — 둘 다 stale, 서로 다른 시점에
  stale해짐).
- 이건 "누가 업로드를 깜빡했다"는 단순 데이터 stale이 아니라, **재생성
  메커니즘 자체가 코드에 없다**는 구조적 문제 — `brand-master.json`이
  아무리 갱신돼도 이 두 파생 파일은 삭제 후 재부트스트랩하지 않는 한 절대
  갱신되지 않는다.
- Local과 Render가 서로 다른 값을 갖게 된 이유는, 두 환경이 이 bootstrap을
  서로 다른 시점(각자 다른 시점의 `brand-master.json` 상태)에 실행했기
  때문 — 단순 "한쪽이 최신, 한쪽이 구식"이 아니라 **둘 다 최신이 아니고,
  서로 다른 과거 시점에 멈춰 있는 두 개의 독립적인 snapshot**.

## F. Upload Support

```
scripts/upload-work-snapshots-to-render.mjs explicitPaths: "intelligence/brand-master-list.json" YES, "intelligence/brand-aliases.json" YES
server.mjs workDataUploadPaths: 동일 두 경로 YES
```
**업로드 경로 자체는 이미 지원됨(YES/YES).** 문제는 업로드 여부가 아니라
"무엇을 업로드할 것인가"다 — 현재 LOCAL 파일을 그대로 업로드하면 안 된다
(아래 G 참조).

## G. Minimal Fix Plan (제안만, 이번 단계에서 실행하지 않음)

**단순 재업로드는 금지 — Local 파일을 그대로 Render에 올리면 Render가 이미
정상 해결 중인 23개 브랜드가 다시 `raw:` 미해결 상태로 퇴행(regression)한다.**

올바른 최소 수정 순서:
1. 로컬에서 `work/intelligence/brand-master-list.json`,
   `work/intelligence/brand-aliases.json` 두 파일을 현재
   `work/brand-master.json`(295개) 기준으로 **재생성**한다. 코드상 이미
   존재하는 `buildIntelligenceBrandRegistry(source.brands)`(exported
   함수, `intelligence-service.mjs:2764`)를 그대로 재사용하면 새 로직을
   짤 필요가 없다 — `ensureBrandRegistryFiles()`와 동일한 변환을 두 파일이
   이미 존재하는 상태에서도 강제로 다시 실행하기만 하면 된다.
2. 재생성된 로컬 파일이 이번에 발견된 23개 브랜드를 전부 해결하는지,
   그리고 Render가 현재 이미 갖고 있는 값을 후퇴시키지 않는지(즉
   superset인지) 먼저 검증한다.
3. 검증 통과 후에만 두 파일을 함께(같은 스냅샷이어야 하므로 반드시 동시에)
   Render에 업로드한다.
4. 이 bootstrap-once 설계 자체가 반복적으로 stale을 유발하는 구조이므로,
   `brand-master.json`이 갱신될 때마다 이 두 파일도 함께 재생성하도록
   운영 절차(또는 후속 코드 변경)를 별도로 검토할 필요가 있음 — 단, 이건
   이번 fix plan 범위를 넘는 별도 논의 대상.

## H. Impact Scope

`readBrandRegistry()`(따라서 이번 stale 파일) 호출부 전수 확인
(`intelligence-service.mjs` 내 8개 호출 지점):

| 호출부 | 라우트/기능 | 영향 |
|---|---|---|
| line 355 | `GET /api/intelligence/brands` | 직접 영향 |
| line 364 | `GET /api/intelligence/brands/resolve` | 직접 영향 |
| line 924 | `GET /api/inventory/overview` (`buildInventoryOverview`) | **영향(이번에 발견된 증상)** — `brandRollup`의 브랜드 식별/그룹핑만, `summary`/`coverage`/재고 수량 자체는 무관 |
| line 1298 | `buildBrandIntelligenceInput` (Brand Intelligence 상세 화면) | 영향 가능성 있음(미검증) |
| line 1359 | `buildMissions` (Missions/액션 아이템) | 영향 가능성 있음(미검증) |
| line 1710/1778/1789/1800 | 브랜드 Decision/Timeline/Learning-DB 워크플로 | 영향 가능성 있음(미검증), 고객 대시보드 아님 |

**영향 없음(확인됨):** Today(`/api/sales/total`), Clients(`/api/intelligence/clients`),
Store Intelligence(`/api/intelligence/store`), Price Audit
(`scripts/build-price-audit.mjs`)는 이 파생 파일이 아니라 `work/brand-master.json`을
`scripts/brand-engine.mjs`의 `buildBrandRegistry()`로 **직접** 읽는 별도
경로를 쓴다 — Batch 1~3에서 이 API들이 Local/Render 완전 일치했던 것과
정합적이다. Product Registry는 이 두 파일을 아예 참조하지 않는다(별도
매칭 파이프라인).

## I. Development Report

이 문서 자체가 report입니다:
```
path: docs/reports/local-to-render-batch3-5-brand-master-alias-audit-2026-08-25.md
```

## J. Verdict

```
BRAND MASTER / ALIAS GAP CONFIRMED — READY FOR MINIMAL SYNC
```

단, G절에서 명시했듯 **"Local 파일을 그대로 업로드"는 승인 대상이 아님** —
재생성(regenerate) → 검증(superset 확인) → 동시 업로드 순서로 별도 Batch
승인이 필요하다.
