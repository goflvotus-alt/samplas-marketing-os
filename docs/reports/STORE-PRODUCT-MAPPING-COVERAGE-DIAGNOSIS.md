# Store Product Mapping Coverage Diagnosis

- Generated: 2026-08-14T09:27:19.307Z
- Product Registry는 읽기 전용이며 수정하지 않았다.
- BEFORE는 verified:true + confirmed exact identity만 사용한다.
- AFTER는 동일 exact identity와 규격이 하나의 canonical product로만 수렴하는 기존 exact_one_to_one/exact_one_to_many evidence를 추가 허용한다.

## 전체 현황

| Store | Revenue lines | BEFORE resolved | BEFORE unresolved | BEFORE coverage | AFTER resolved | AFTER unresolved | AFTER coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| APGUJEONG | 493 | 13 | 480 | 2.64% | 84 | 409 | 17.04% |
| VAIL | 1 | 0 | 1 | 0.00% | 1 | 0 | 100.00% |

## AFTER unresolved 원인

| reason | APGUJEONG | VAIL |
|---|---:|---:|
| registry_missing | 316 | 0 |
| missing_ecount_identity | 74 | 0 |
| normalization_gap | 0 | 0 |
| ambiguous | 4 | 0 |
| insufficient_identity | 15 | 0 |
| other | 0 | 0 |

## 영향도가 큰 unresolved identity

| store | raw brand | raw product name | size | quantity | revenue | candidate | count | reason | proposed action |
|---|---|---|---|---:|---:|---|---:|---|---|
| APGUJEONG | DET | CON - DET BLEV SENT / LEATHER VARET JEANS BLACK | 30 | 1 | 1852200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | QQQ 퀵 | [CARNET ARCHIVE : 카르넷 아카이브] DIPPED LUMP CARGO DENIM TROUSERS BLACK | M | 2 | 1715000 | CP-C24-11745 | 1 | missing_ecount_identity | Review existing Product Registry candidate |
| APGUJEONG | OFI | OFILES / AGED RACER SUEDE LEATHER JACKET in black | S | 1 | 1438400 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | DET | DET BLEV SENT / LEATHER ZIP VEST BLACK | L | 1 | 1348200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | HEL | HELIOT EMIL / ROAN JACKET BLACK | 50 | 1 | 1278000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | PHT | PHTMNE / RIOT PANTS WHITE | 34 | 1 | 1198400 | CP-C24-14809 | 1 | missing_ecount_identity | Review existing Product Registry candidate |
| APGUJEONG | TRO | TROUBLED WATERS / Slayer Harness Belt Black | OS | 3 | 1075200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | DET | DET BLEV SENT / WAXED HOODED CARGO BOMBER JACKET BLACK | L | 1 | 1015200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | NOF | NO FAITH STUDIOS / GRAIN SELVEDGE BOOTCUT DENIM | M | 2 | 988800 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | DET | CON - DET BLEV SENT / WAXED TAILORED BLAZER KHAKI | L | 1 | 970200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | CAR CO | CARNET ARCHIVE / EXCAVATED RIDER DENIM JACKET MELTED WHITE | S | 1 | 970000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | POP CO | SUNDAYOFFCLUB / Bat Leather Woven Chain Belt | OS | 5 | 959200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | BED | BED J.W. FORD / 26SS-B-IN02 No Stress Grey | M | 1 | 926400 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | NOF | NO FAITH STUDIOS / ITALY TWO TONE CUT DENIM | M | 2 | 924800 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | HAM | HAMCUS / LP-EHF / Twin-Shell Jacket | L | 1 | 898800 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | PHT | PHTMNE / BLK AMERIKA MOTO JACKET | M | 1 | 846400 | CP-C24-14811 | 1 | missing_ecount_identity | Review existing Product Registry candidate |
| APGUJEONG | CAR CO | CARNET ARCHIVE / HAND COATED MASS VEST RUSTY WHITE | M | 1 | 837000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | TAE | TAE GLOBAL / 3D PRINTED DETACHABLE BAG TROUSERS BALCK&WHITE | L | 1 | 835200 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | REM | REMAGINE / The CORE White | 41 | 2 | 825600 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | HYA | HYACYN / Sevar Rof Pants Waxed New Black | M | 1 | 798400 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | TRO | TROUBLED WATERS / Napoleon Varsity Jacket Washed Black | M | 2 | 796800 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | PHT | PHTMNE / STAR SELVEDGE CARPENTER DENIM | 32 | 1 | 790400 | CP-C24-14802 | 1 | missing_ecount_identity | Review existing Product Registry candidate |
| APGUJEONG | CAR CO | CARNET ARCHIVE / NAIL SHEER SCARF HOODIE BLACK | OS | 2 | 756000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | TAE | TAE GLOBAL / 3D PRINTED DETACHABLE BAG TROUSERS BALCK&WHITE | M | 1 | 742400 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | DIN | DINGYUN ZHANG / UTILITY JACKET BLACK | M | 1 | 718400 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | RAC | RACER WORLDWIDE / Blue Track Jeans | L | 2 | 716800 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | SOM | SOMAR / VEIN DENIM PANTS WASHED BLACK | 32 | 1 | 678000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | SOM | SOMAR / VEIN DENIM PANTS WASHED BLACK | 34 | 1 | 678000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | GRA | GRACE ELWOOD / CUFFS RUFFLE SHIRT OFF WHITE | 36 | 1 | 658000 | - | 0 | registry_missing | Create or source canonical product identity |
| APGUJEONG | GRA | GRACE ELWOOD / CUFFS RUFFLE SHIRT SKY BLUE | 36 | 1 | 658000 | - | 0 | registry_missing | Create or source canonical product identity |

## PACOSPLY / WonderLand T-shirts BLACK

Product Registry의 CP-C24-14086 하나에만 연결되고, size 2가 existing matchedProducts의 PAC261ST00202와 exact normalized match다. 같은 exact key를 소유한 다른 canonical product가 없고 Brand Master의 PACOSPLY가 B00000ZT로 일치하므로 AFTER에서는 deterministic_registry_alias로 안전하게 연결한다. Product Registry 자체의 ambiguous/verified 상태는 변경하지 않는다.

## Review queue

- Path: work/store-product-mapping-review-queue.json
- Aggregated unresolved identities: 242
- 동일 상품/규격 반복 판매는 한 entry로 집계했다.
