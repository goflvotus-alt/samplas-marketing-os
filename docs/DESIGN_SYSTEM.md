# SAMPLAS Marketing OS — Design System

기준 화면: **Brand Intelligence**(`outputs/samplas-marketing-os.html` 1227행,
`<section id="BrandDashboard">`, sidebar 라벨 "Brand Intelligence" — STEP65-6에서
정식 연결됨).

이 문서는 새 규칙을 발명한 것이 아니라, Brand Intelligence 화면이 실제로 쓰고 있는
CSS 값을 `outputs/samplas-marketing-os.css`에서 그대로 읽어 정리한 것이다. 값 옆의
괄호는 해당 값이 정의된 CSS 클래스/선택자다 — 검증이 필요하면 그 클래스를 grep하면
된다.

이번 문서는 **정의만** 한다. 이 규칙을 실제로 다른 화면(Promotion Intelligence/
Commerce/Clients/Product Registry/Master Data)에 적용하는 것은 이 STEP의 범위
밖이며, Today/Inventory는 아직 별도 설계가 진행 중이라 이 문서의 대상이 아니다.

---

## 1. Design Principles

Brand Intelligence를 읽으면서 확인한 4가지 원칙(10번 항목에서 근거와 함께 분석):

1. **한 화면에 하나의 주어(Selector)** — 화면 최상단에서 "무엇을 보고 있는가"를
   즉시 답한다(브랜드 선택기 → 선택된 이름). 나머지 모든 요소는 그 주어에 종속된다.
2. **숫자보다 상태가 먼저** — Health Score(원형 게이지)와 AI Summary가 원시 숫자
   나열보다 먼저 나온다. 사람은 "좋은지 나쁜지"를 먼저 알고 싶어 한다.
3. **카드는 균일하게, 강조는 테두리로** — 모든 KPI 카드가 같은 radius/padding/
   shadow를 쓰고, 우선순위는 크기가 아니라 `border-left` 색상 악센트로 표현한다.
4. **비어 있음을 숨기지 않는다** — 데이터가 없으면 "--"와 "데이터 준비 중"을
   명시적으로 보여준다(0으로 대체하지 않음). Empty State가 1급 시민이다.

---

## 2. Typography

| 이름 | 실제 크기/스타일 | CSS 근거 |
|---|---|---|
| H1 (페이지 제목) | `clamp(24px, 3.2vw, 46px)`, line-height 1.08 | `.topbar h2`(569/577행) — `#topbarTitle`, 예: "Brand Intelligence" |
| Section Title (H2) | `24px` | `.section-title h3`(654행) — 예: "Brand Intelligence" 섹션 헤딩 |
| Caption / Eyebrow | `11px`, weight 800, uppercase, letter-spacing `0.08em`, opacity `0.62` | `.eyebrow`(86행) — 예: "BRAND INTELLIGENCE" 소제목 |
| Body (보조 설명) | `13px`, color `var(--muted)` | `.hint-text` |
| Table Header | `12px`, uppercase, letter-spacing `0.05em`, color `var(--muted)` | `th`(3265행) |
| Table Cell | `14px` | `td`(3275행) |
| KPI Number | `26~30px`(화면마다 소폭 다름 — 아래 참고) | `.kpi strong`(29px)/`.ad-core-kpi-card strong`(30px)/`.sales-kpi-card strong`(26px) |
| Badge Text | `10px`, weight 900 | `.clients-tooltip-badge` |

**정직하게 기록할 기존 불일치**: KPI Number 크기가 화면마다 26/29/30px로 미세하게
다르다(통일된 토큰이 아니라 화면별로 개별 지정됨). 이 문서는 이를 숨기지 않고
기록한다 — 향후 롤아웃 시 **30px로 통일**을 권장한다(가장 최근 화면인
`.ad-core-kpi-card`, Brand Intelligence의 1차 KPI 기준).

폰트 패밀리: `Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
(body 선택자, 전 화면 공통, 변경 없음).

---

## 3. Layout

Brand Intelligence의 화면 구조(위→아래):

```
Topbar (H1 + 우측 컨트롤)
  ↓
Selector (Brand Selector 트리거+드롭다운)
  ↓
Period Toolbar (기간 모드 전환, 선택적)
  ↓
Hero (Health Score 게이지 + AI Summary + 추천 Action)
  ↓
System Status (연동 상태 배지 행)
  ↓
KPI Grid (1차 지표)
  ↓
Section Block(들) — 각자 section-title compact로 시작
```

각 구획은 `.section-block`(margin-top: 22px)으로 분리되고, `.section-title`
(eyebrow + h3, 필요 시 우측에 보조 컨트롤)이 각 구획의 머리말 역할을 한다. 화면
전환 시 다른 화면(Promotion Intelligence 등)에서도 이 골격(Topbar → Selector →
Header → Section Block들)을 그대로 재사용해야 "완전히 다른 앱처럼 보이지 않는다"
(STEP65-4 지시와 동일한 원칙).

---

## 4. Cards

기본 카드(`.action-item`, 2262/2266행)가 모든 카드류의 공통 조상이다:

| 속성 | 값 |
|---|---|
| Radius | `8px` |
| Border | `1px solid var(--line)` (#dedbd2) |
| Background | `var(--panel)` (#ffffff) |
| Shadow | `var(--shadow)` = `0 18px 50px rgba(25, 25, 20, 0.08)` |
| Padding | `14px`(기본) / `16px`(`.kpi`) |
| 내부 Gap | `12px`(grid-template-columns 사이) |
| Grid Gap(카드 간) | `12px`(`.cards`, `.kpi-grid`) |

변형:
- **Accent 강조**: `.ad-core-kpi-card` — `border-left: 3px solid var(--green)`,
  배경 `#fff`(기본과 동일, 좌측 테두리만 추가).
- **비활성/Empty**: `.sales-empty-card`/`.sales-kpi-card.is-disabled` —
  `border-style: dashed`, 배경 `#f1f0eb`, `box-shadow: none`(11번 Empty State
  항목 참고).

---

## 5. KPIs

Brand Intelligence는 이미 KPI를 3단계로 나눠 쓰고 있다(STEP65-4가 Promotion
Intelligence에 이식한 것과 동일 원리):

| 티어 | 용도 | 컴포넌트 | 크기 |
|---|---|---|---|
| **Primary KPI** | 가장 중요한 1~2개 지표(예: 매출) | `.ad-core-kpi-card`(좌측 green 악센트) | 30px |
| **Secondary KPI** | 보조 지표 | `.kpi`(악센트 없음) | 29px |
| **Info KPI** | 카운트성 정보(브랜드 수/상품 수 등), 카드가 아니어도 됨 | 인라인 텍스트(`.note`) 또는 `.kpi` | 13px(인라인) 또는 29px(카드) |

카드형 KPI는 공통으로 `<span>label</span><strong>value</strong>` 구조를 쓰고,
선택적으로 `<p class="delta">`로 보조 설명을 붙인다(`.delta` = 13px, `var(--green)`,
weight 800).

---

## 6. Buttons

| 종류 | 정의 | CSS 근거 |
|---|---|---|
| Primary | 배경 `var(--black)`(#101010), 글자 `#fff` | `.button.primary` |
| Secondary | 배경 투명, 기본 테두리 유지 | `.button.secondary` |
| 공통 기본값 | `min-height: 38px`, `border-radius: 6px`, `border: 1px solid var(--line)`, `padding: 8px 11px`, `font-weight: 800` | `.button`(600-613행) |
| Ghost | **정의돼 있지 않음(갭)** | — |
| Danger | **정의돼 있지 않음(갭)** | — |

**정직하게 기록할 갭**: 현재 코드베이스에는 Ghost/Danger 버튼 변형이 없다 —
지금까지 위험한 동작(삭제 등)을 버튼 색으로 구분한 화면이 없었기 때문으로 보인다.
이 문서는 없는 것을 지어내지 않는다. 향후 필요해지면 `.button.ghost`(테두리 없이
텍스트만, hover 시 배경 `var(--paper)`), `.button.danger`(배경 `var(--red)`,
글자 `#fff`)를 **기존 `.button` 기본값 위에** 추가하는 것을 권장한다(새 컴포넌트
체계를 만들지 않고 기존 `.button`을 확장).

---

## 7. Badges

기본 배지(`.clients-tooltip-badge`)가 공통 조상이다:

| 속성 | 값 |
|---|---|
| Radius | `999px`(pill) |
| Padding | `2px 8px` |
| Border | `1px solid rgba(23, 23, 23, 0.14)` |
| Font | `10px`, weight `900` |
| 기본 색 | `var(--muted)`(Neutral) |

색상 변형은 배지 자체가 아니라 **내부 `.status-dot`의 배경색**으로 표현한다
(`.ad-status-banner .status-dot`, 2084-2100행) — 8번 Status Color 항목과 동일한
색 체계를 그대로 재사용:

| Badge 의미 | 색 |
|---|---|
| Success | `var(--green)` |
| Warning | `var(--yellow)` |
| Danger | `var(--red)` |
| Info | `var(--blue)`(현재 상태 배지에는 미사용, 색 토큰만 존재) |
| Neutral | `var(--muted)`(기본값) |

---

## 8. Status Colors

`.ad-status-banner`의 3-state 체계(`.loading`/`.good`/`.error`, 여기에 `.warn`
추가)가 실질적인 Status Color 표준이다:

| 상태 | 색 | 실사용 예(화면에서 관측된 라벨) |
|---|---|---|
| **Healthy** | `var(--green)` #206f54 | "Cafe24 · Healthy", "ECOUNT · Healthy" |
| **Warning** | `var(--yellow)` #d7a642 | `.ad-status-banner.warn` |
| **Critical / Danger** | `var(--red)` #a9423d | "Sales Health · 주의", `.ad-status-banner.error` |
| **Delay** | `var(--yellow)` #d7a642(Warning과 동일 색 재사용) | "Instagram · Delay" |
| **Pending / Neutral** | `var(--muted)` #6d6a62 | `.ad-status-banner` 기본값(로딩 중) |

**정직하게 기록할 관찰**: "Delay"는 별도 색이 없고 Warning(yellow)과 같은 색을
공유한다 — 실사용 화면(사이드바 Data Refresh Center)에서 실측 확인. 이는 의도된
재사용으로 보인다(Delay도 "주의가 필요하지만 치명적이지 않음"이라는 같은 의미
범주). 이 문서는 이를 그대로 규칙화한다 — 새 색을 만들지 않는다.

---

## 9. Spacing

Brand Intelligence에서 실측한 값과, `.section-block`처럼 이미 스케일에 가까운
값을 정리하면:

| 실제 값 | 사용처 |
|---|---|
| `12px` | 카드 grid gap(`.cards`, `.kpi-grid`), `.action-item` 내부 grid gap |
| `14px` | `.action-item` padding |
| `16px` | `.kpi` padding |
| `22px` | `.section-block` margin-top |
| `26px` | `.topbar` margin-bottom |

지시된 8/16/24/32/48 스케일과 대조하면: `12`/`16`은 스케일과 정확히 일치하지만,
`14`/`22`/`26`은 스케일에서 살짝 벗어나 있다(각각 8·16 스케일의 근사치로 보인다).
**정직하게 기록**: 이는 엄격한 8pt 그리드가 아니라 "대략 8의 배수"에 가까운
느슨한 관행이다. 향후 새 화면(Promotion Intelligence 등)을 이 시스템에 맞출 때는
아래 **권장 스케일**을 우선 적용할 것을 제안한다(기존 화면을 소급 수정하지는
않음 — 이번 STEP은 "CSS 대규모 수정 금지"):

```
8  — 아이콘/뱃지 내부 여백처럼 가장 작은 간격
16 — 카드 padding, 카드 간 gap
24 — Section 간 margin(기존 22px을 24px로 반올림 권장)
32 — 큰 블록 간 여백(예: Hero와 KPI Grid 사이, 필요시)
48 — 페이지 상단 여백처럼 가장 큰 간격(현재 26px 대비 향후 확장 여지)
```

---

## 10. Brand Intelligence Analysis — 왜 이 화면이 읽기 쉬운가

Brand Intelligence(`#BrandDashboard`)를 실제로 열어(Chrome QA, 12번 항목) 분석한
근거:

**Header 구조**: `.eyebrow`("BRAND INTELLIGENCE") → Selector 트리거 → H3(선택된
브랜드명 또는 "브랜드를 선택하세요") 순서로 쌓인다. Eyebrow가 "이 화면이 무엇에
관한 것인지"를 먼저 말하고, Selector가 "어떤 개체를 보고 있는지"를 바로 이어서
확정한다 — 사용자가 스크롤 없이 두 가지 질문(무엇을/누구를)에 동시에 답을 얻는다.

**Selector 위치**: 화면 최상단, Header 안에 통합돼 있다(별도 페이지/모달이
아님). 브랜드를 바꾸는 행위가 "새로운 화면으로 이동"이 아니라 "같은 화면의
주어만 교체"로 느껴지게 만든다 — 이 패턴을 STEP65-4에서 Promotion Selector에
그대로 이식한 이유이기도 하다.

**KPI 위치**: Health Score 게이지 + AI Summary가 원시 KPI 숫자보다 먼저
나온다(2. 원칙과 동일). 숫자 그리드는 그 아래, "판단"을 먼저 제공한 다음
"근거"를 제공하는 순서다 — 뉴스 기사의 역피라미드 구조와 같은 원리.

**Card 배치**: 모든 KPI 카드가 같은 높이(`.kpi min-height: 126px`)를 강제해
그리드가 들쭉날쭉하지 않다. 3열/4열 그리드가 `repeat(N, minmax(0,1fr))`로
균등 분배돼, 카드 개수가 바뀌어도 레이아웃이 깨지지 않는다.

**Whitespace**: `.section-block`(22px)과 카드 gap(12px)의 비율이 대략 2:1이다 —
"섹션 간 여백 > 카드 간 여백"이 시각적으로 그룹을 명확히 구분한다. 만약 이
비율이 1:1에 가까웠다면 어디까지가 한 그룹인지 눈으로 구분하기 어려웠을 것이다.

**Visual Hierarchy**: 크기가 아니라 **위치 + 좌측 악센트 색**으로 우선순위를
표현한다(5번 KPI 항목과 동일). 이는 "글자를 계속 키우는" 흔한 실수를 피한다 —
글자 크기 차이가 크지 않아도(29px vs 30px, 사실상 거의 같음) 순서와 색으로 이미
충분한 위계가 만들어진다.

---

## 11. Future Rollout Plan

이번 STEP은 정의만 한다. 실제 적용은 각 화면을 다루는 별도 STEP에서 수행해야
한다. 우선순위 제안(위험도 낮은 순):

1. **Promotion Intelligence** — 이미 이 문서의 대부분 패턴(Selector/KPI Tier/
   Insight 박스/rank row)을 STEP65-4에서 선반영했다. 남은 작업: KPI Number
   크기를 30px로 통일(현재 29px `.kpi` 사용 중인 2차 KPI는 문제 없음, 이미
   Tier 구분과 일치).
2. **Commerce** — 이미 `.kpi`/`.ad-status-banner` 등 동일 토큰을 쓰고 있어
   충돌 위험이 낮다. Header/Selector 패턴만 점검 필요.
3. **Clients** — `.ad-status-banner`/카드 패턴 이미 사용 중, Empty State
   일관성만 점검.
4. **Product Registry** — 표 중심 화면이라 4번(Table) 정의 적용 여부만 확인.
5. **Master Data** — 가장 설정 화면에 가까워 우선순위 낮음.

Today/Inventory는 **이 목록에 포함하지 않는다** — 지시대로 별도 설계 진행 중이며
이번 문서·향후 롤아웃 어느 쪽 대상도 아니다.

---

*이 문서는 코드가 아니라 관찰 결과다. CSS 값이 바뀌면 이 문서도 다시 검증해야
한다 — grep 대상 클래스명을 각 표에 남긴 이유다.*
