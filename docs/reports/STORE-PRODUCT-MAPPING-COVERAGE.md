# Store Product Registry Mapping Coverage

## 기준과 결론

- Branch: `main`
- Starting HEAD: `21771e3`
- Product Registry는 수정하지 않았다. SHA-256: `becd74e9b752cfd7ace48980676edfb0db2c33d9c346ed19dfbb5c42d9f5ceb9`
- 기존 confirmed exact tier에 `deterministic_registry_alias` tier를 추가했다.
- 새 tier는 기존 Product Registry의 `exact_one_to_one` 또는 `exact_one_to_many` ECOUNT 상품명+규격과 판매선이 exact normalized match이고, exact key의 canonical product가 정확히 하나일 때만 허용한다.
- raw brand가 Brand Master에서 다른 active brand로 확인되면 `brand_conflict`로 차단한다.
- fuzzy, brand-only, name-only, size 무시 매칭은 추가하지 않았다.

## BEFORE / AFTER

| Store | total lines | BEFORE resolved | BEFORE unresolved | BEFORE coverage | AFTER resolved | AFTER unresolved | AFTER coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| APGUJEONG | 493 | 13 | 480 | 2.64% | 84 | 409 | 17.04% |
| VAIL | 1 | 0 | 1 | 0.00% | 1 | 0 | 100.00% |

신규 deterministic 연결은 APGUJEONG 71 lines / 42 canonical products / 수량 53 / 매출 11,561,100원, VAIL 1 line / 1 canonical product / 수량 1 / 매출 70,200원이다. 이는 기존 매출을 재계산한 것이 아니라 기존 store salesLines에 product identity를 덧붙인 결과다.

## 새로 연결된 canonical 상품

Matching evidence는 모든 행에 동일하게 `exact normalized ECOUNT product name + exact normalized size + unique canonical candidate`가 적용됐다.

| Store | canonical product id | product name | brand | affected lines | qty | revenue |
|---|---|---|---|---:|---:|---:|
| APGUJEONG | CP-C24-14342 | DELTA G DAGGER EMBROIDERED SHORT SLEEVES SHIRT WHITE | 민타임 | 3 | 3 | 498,400 |
| APGUJEONG | CP-C24-13086 | Starting bigger hybrid derby Nasty | 리매진 | 2 | 2 | 909,600 |
| APGUJEONG | CP-C24-14537 | Studded Denim Blue | 레이서 월드 와이드 | 2 | 2 | 780,800 |
| APGUJEONG | CP-C24-14446 | Riot Bootcut Jeans | 밍가 | 2 | 2 | 500,400 |
| APGUJEONG | CP-C24-12616 | Unearthed Fragment Chain Oil Black | 카르넷 아카이브 | 2 | 2 | 500,400 |
| APGUJEONG | CP-C24-14431 | FALLING ANGEL SPORTS JACKET NAVY | 파코서플라이 | 2 | 2 | 426,600 |
| APGUJEONG | CP-C24-14542 | Octane Moto Gloves Black | 나밀리아 | 2 | 2 | 396,800 |
| APGUJEONG | CP-C24-12846 | FALLING ANGEL ZIP UP HOODIE NAVY | 파코서플라이 | 2 | 2 | 340,100 |
| APGUJEONG | CP-C24-10831 | 3 STITCHES - 3 METAL PLATES T-SHIRT BLACK | 카르넷 아카이브 | 2 | 2 | 307,800 |
| APGUJEONG | CP-C24-14049 | Slim Oil Print T-Shirt | 레이서 월드 와이드 | 6 | 2 | 300,800 |
| APGUJEONG | CP-C24-14568 | FRICK TANK TOP BLACK | 에프엔케이 스튜디오 | 2 | 2 | 296,000 |
| APGUJEONG | CP-C24-12608 | A Soldier’s Dog Tag Oil Black | 카르넷 아카이브 | 2 | 2 | 243,200 |
| APGUJEONG | CP-C24-13560 | LAYERED NECK TANK TOP WHITE | 카르넷 아카이브 | 2 | 2 | 230,400 |
| APGUJEONG | CP-C24-14593 | Solk Patch Tank top | OURSELVES REMAKE | 1 | 1 | 478,400 |
| APGUJEONG | CP-C24-14800 | OCEAN WAX DENIM PANTS BLUE | PHTMNE | 1 | 1 | 430,400 |
| APGUJEONG | CP-C24-14539 | Waxed Wide Rib Slim Knit Hoodie Waxed Black | 레이서 월드 와이드 | 5 | 1 | 358,400 |
| APGUJEONG | CP-C24-13027 | UNISEX - JETRON - Monogram hoodie | AESIR STUDIOS | 1 | 1 | 348,000 |
| APGUJEONG | CP-C24-13026 | UNISEX - JETRON - Rhinostone jogger | AESIR STUDIOS | 1 | 1 | 348,000 |
| APGUJEONG | CP-C24-14470 | CORDUROY HAGI WAX FLARED PANTS | LIFE IS HELL | 1 | 1 | 318,400 |
| APGUJEONG | CP-C24-13346 | Bataille Vest Bone | LIZA KEANE | 1 | 1 | 310,400 |
| APGUJEONG | CP-C24-13565 | ADJUSTABLE NAILS ON DOUBLE COLLAR POLO WHITE | 카르넷 아카이브 | 1 | 1 | 306,000 |
| APGUJEONG | CP-C24-14579 | Phanknit01 Polo-shirt | OURSELVES REMAKE | 3 | 1 | 286,400 |
| APGUJEONG | CP-C24-12059 | Slim Low-Waist Denim Blue | 레이서 월드 와이드 | 1 | 1 | 278,400 |
| APGUJEONG | CP-C24-14583 | SplitKnit02 Layered-shirt Grey | OURSELVES REMAKE | 1 | 1 | 198,400 |
| APGUJEONG | CP-C24-9618 | Nostalgia of Boyhood Denim Jacket developed ver. | 민타임 | 1 | 1 | 194,600 |
| APGUJEONG | CP-C24-14440 | Scarlett Plaid Hot Pants | 밍가 | 1 | 1 | 188,000 |
| APGUJEONG | CP-C24-14573 | EOL T-SHIRT WHITE | 에프엔케이 스튜디오 | 1 | 1 | 182,400 |
| APGUJEONG | CP-C24-14294 | ALLDAY JEANS SKY BLUE | 파코서플라이 | 1 | 1 | 179,000 |
| APGUJEONG | CP-C24-13905 | Faux two-piece layered printed T-shirt Grey | Anomalies Department | 1 | 1 | 158,400 |
| APGUJEONG | CP-C24-14545 | Pleated Mini Skirt Black | 나밀리아 | 3 | 1 | 158,000 |
| APGUJEONG | CP-C24-14550 | Heiress Handbag Corset Black | 나밀리아 | 1 | 1 | 150,400 |
| APGUJEONG | CP-C24-10832 | 3 STITCHES - 3 METAL PLATES T-SHIRT WHITE | 카르넷 아카이브 | 1 | 1 | 145,800 |
| APGUJEONG | CP-C24-13562 | BINARY STARS TATTOO HALF-SLEEVE T-SHIRT KHAKI | 카르넷 아카이브 | 1 | 1 | 145,800 |
| APGUJEONG | CP-C24-13218 | RacerPods Necklace | 레이서 월드 와이드 | 1 | 1 | 142,400 |
| APGUJEONG | CP-C24-14341 | DELTA G DAGGER EMBROIDERED SHORT SLEEVES SHIRT BLACK | 민타임 | 1 | 1 | 124,600 |
| APGUJEONG | CP-C24-14604 | FLIGHTER RAGLAN TEE BLACK / HEATHER | CLEIONER | 1 | 1 | 118,400 |
| APGUJEONG | CP-C24-12609 | A Soldier’s Dog Tag Rusty White | 카르넷 아카이브 | 1 | 1 | 115,200 |
| APGUJEONG | CP-C24-14524 | GRAPHIC T-SHIRT | 카미긴 | 1 | 1 | 106,200 |
| APGUJEONG | CP-C24-14263 | DISTRESSED SLIM BLANK T - BLACK | EMOSTANCECLUB | 1 | 1 | 59,400 |
| APGUJEONG | CP-C24-14455 | Dark Glory T-Shirt | 밍가 | 2 | 0 | 0 |
| APGUJEONG | CP-C24-13942 | Feelin' lucky tshirt pink | 아이필럭키 | 2 | 0 | 0 |
| APGUJEONG | CP-C24-14082 | WM_HALTER SLEEVELESS BLACK | AE SYNCTX | 2 | 0 | 0 |
| VAIL | CP-C24-14086 | WonderLand T-shirts BLACK | 파코서플라이 | 1 | 1 | 70,200 |

net 수량과 net 매출이 모두 0인 세 상품은 identity coverage에는 포함되지만 기존 정책대로 TOP 상품 표시에서는 제외된다.

## Unresolved

| reason | APGUJEONG | VAIL |
|---|---:|---:|
| registry_missing | 316 | 0 |
| missing_ecount_identity | 74 | 0 |
| normalization_gap | 0 | 0 |
| ambiguous | 4 | 0 |
| insufficient_identity | 15 | 0 |
| other | 0 | 0 |

상세 TOP unresolved 및 후보는 [진단 보고서](./STORE-PRODUCT-MAPPING-COVERAGE-DIAGNOSIS.md)에 기록했다.

## Review queue

- `work/store-product-mapping-review-queue.json`
- 409 unresolved sales lines를 242개 store/product/size identity로 집계했다.
- 각 entry에는 raw identity, 수량, 매출, canonical 후보, evidence, reason, suggested action이 포함된다.
- Product Registry 및 기존 review queue는 수정하지 않았다.

## PACOSPLY 검증

`PACOSPLY / WonderLand T-shirts BLACK`, size `2`는 Product Registry `CP-C24-14086`의 `PAC261ST00202`와 exact normalized name+size가 일치한다. 동일 exact key를 가진 canonical 후보는 하나이며 PACOSPLY는 Brand Master에서 `B00000ZT`로 일치한다. 따라서 `deterministic_registry_alias`로 연결했다. Product Registry의 기존 `ambiguous / verified:false` 상태는 변경하지 않았다.

## Store Intelligence

- `buildStoreProductIntelligence()`는 새 identity resolver 결과를 사용한다.
- 응답의 기존 fields는 유지했고 `matchingEvidence`, `coverage.resolvedBy`, `coverage.unresolvedBy`만 additive하게 제공한다.
- 판매선은 `line.storeCode === requested storeCode`로 한 번 더 제한해 APGUJEONG/VAIL 혼입을 차단했다.
- 정렬은 수량 DESC → 매출 DESC → 상품명 ASC를 유지한다.

## 안전성

- canonical sales calculation changed: NO
- global API contract changed: NO
- store routing changed: NO
- inventory logic changed: NO
- sell-through logic changed: NO
- category inference added: NO
- Product Registry modified: NO
- Brand Master modified: NO

## 테스트

- JavaScript syntax: PASS
- Targeted resolver/store/UI tests: 38/38 PASS
- Full regression: 678/678 PASS
- `git diff --check`: PASS
- exact confirmed, deterministic normalization, case, whitespace, punctuation: PASS
- size conflict, duplicate ambiguity, brand conflict, unknown/insufficient identity: PASS
- APGUJEONG/VAIL store isolation: PASS

## 변경 파일

- `scripts/store-product-identity.mjs` (new)
- `scripts/build-store-product-mapping-review-queue.mjs` (new)
- `server.mjs`
- `test/store-product-identity.test.mjs` (new)
- `test/store-intelligence-live-data.test.mjs`
- `docs/reports/STORE-PRODUCT-MAPPING-COVERAGE-DIAGNOSIS.md` (new)
- `docs/reports/STORE-PRODUCT-MAPPING-COVERAGE.md` (new)
- `work/store-product-mapping-review-queue.json` (new, gitignored operational review artifact)

## 다음 작업

Review queue의 매출 영향도 순으로 canonical product 생성 또는 기존 Product Registry 후보 승인을 진행한다. 자동 fuzzy 승격은 계속 금지한다.

## Git

- Commit: NO
- Push: NO
- Deploy: NO
- Staged: 없음
