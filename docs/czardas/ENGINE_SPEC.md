# Czardas v4 Engine Specification

이 문서는 Czardas kernel, pack, provenance, Sight, chart runtime과 수동 자산 운영의 단일 기술
기준이다. 구현의 wire 기준은 `shared/chart-contract/chart-czardas-pack.schema.json`과 Python
relational validator이며 둘을 함께 통과해야 한다.

## 1. 버전과 불변 계약

| 계약 | 값 |
| --- | --- |
| algorithm | `czardas-v4` |
| config | `czardas-config-v4` |
| input | `canonical-ohlcv-q8-v1` |
| time | `market-time-v1` |
| calendar | `nyse-calendar-v1` |
| Field schema | `4` |

Sight projection version은 inference version과 독립된 sealed config 값이며 pack schema와
frontend validator가 같은 값을 강제한다. production `CzardasConfig`는 수정할 수 없고 저장 가능한
pack은 기본 config와 정확히 같아야 한다.

- 입력은 `asOf`에서 끝나는 최신 완료봉 exact-240 하나다.
- 240봉 전체를 동시에 보는 PresentSnapshot이며 historical replay나 prefix state를 저장하지 않는다.
- live candle과 post-`asOf` row는 feature, evidence, Field, 설명과 provenance에 포함하지 않는다.
- `observedAt`은 시장 사실 발생, `confirmedAt`은 필요한 오른쪽 문맥 완성 시각이다.
- 동일 입력과 config는 canonical content bytes까지 같아야 한다.
- inference와 Sight는 순수 단계이며 LLM은 어느 단계에도 참여하지 않는다.

## 2. 입력과 시간 계약

각 candle은 symbol, interval, candle key, UTC millisecond `Z` timestamp, OHLCV와 다음 canonical
metadata를 가진다.

```text
canonicalVersion = v2
priceAdjustment = split
marketSession = regular
isClosed = true
```

지원 interval은 `1m`, `5m`, `10m`, `1h`, `4h`, `1D`, `1W`다. timestamp 범위는 `[start,end)`,
거래 세션은 code-owned NYSE calendar와 `America/New_York` 규칙으로 결정한다. 입력 개수 239/241,
중복 identity, 비정상 OHLCV, canonical flag 누락과 live row는 `AnalysisUnavailable`이다.

OHLCV는 kernel 진입 시 소수 8자리 `ROUND_HALF_EVEN`으로 양자화된다. validation, feature,
geometry와 input digest는 양자화 값만 사용한다. config의 부동소수점 값도 같은 수치 영역에서
검증한다.

## 3. 순수 데이터 흐름

```text
Canonical exact-240
  → CandleTape / FeatureTape
  → Intrinsic CandleMeaning
  → StructuralDomainTree
  → StructuralFactTape
  → PriceMemoryField + RegressionFlow
  → H-Line / Trend BoundaryMode
  → StructureRelation + PatternTrace
  → boundary/relation scene selection
  → CzardasInference
  → deterministic CzardasSightPack
```

relation은 boundary presentation selection 전에 계산한다. Pattern supporting boundary는 최종
H-Line 또는 Trend drawing으로 선택되지 않아도 relation provenance에 남을 수 있다.

## 4. 전봉 의미와 공통 사실

### FeatureTape와 CandleMeaning

FeatureTape는 ATR14, body/wick/close 형태, 절대 등락, trailing volume과 radius 2/5/13 주변 관계를
SoA로 계산한다. ATR 준비 전 factor는 unavailable이며 geometry scale에는 첫 Wilder seed를 쓴다.
실제 zero-range에서만 effective tick을 사용한다.

`CandleMeaningTape`는 정확히 240개 entry를 갖고 모두 같은 `evaluationAsOf`를 공유한다.

- Shared: range/ATR, 등락, body·wick·close 형태와 다중 반경 주변 관계.
- H-Line: support/resistance 근접, reaction, penetration, reclaim과 volume participation.
- Trend: lower/upper endpoint 관계, boundary residual, alignment와 opposition.

factor와 reason은 versioned codebook과 compact column으로 운반한다. raw 값, robust-normalized 값,
availability, reason과 실제 usage를 보존한다. 화면의 240봉 내 의미 백분위는 시각화용이며 inference에
되먹임되지 않는다. Pattern 참여는 sparse relation usage이고 candle composite에 다시 더하지 않는다.

### StructuralDomainTree와 StructuralFactTape

root domain은 `0..239`다. q8 HLC3의 piecewise-linear robust 설명 손실 감소가 복잡도 비용을
넘을 때만 분할한다. child는 최소 6봉이며 깊이는 `ceil(log2(240))`을 넘지 않는다. root, 현재
`asOf`를 포함하는 right spine과 인접 sibling이 active scale이다.

StructuralFactTape는 확정 endpoint `RoleBasis`와 adaptive preceding impulse를 한 번 계산해
H-Line, Trend와 Pattern이 공유한다. 우측 확인 문맥이 부족한 extrema는
`confirmation_pending`으로만 설명되고 Basis가 되지 않는다. touch, acceptance, break, reclaim은
각 boundary에 대한 Interaction fact로 계산해 integrity, response, Field와 설명에서 재사용한다.

## 5. Field 원시 요소

### PriceMemoryField와 H-Line

PriceMemory는 각 candle의 high/low 주변 유한 interval에 body, wick rejection과 `asOf` recency를
누적한다. exact interval event sweep으로 response를 만들고, 실제로 맞닿는 plateau만 하나의 ridge로
압축한다. 빈 가격 gap은 연결하지 않는다.

H-Line은 formation episode compression, weighted median/MAD refine, capped-recency all-candle
integrity와 독립 response를 사용한다. isolated wick의 손실은 bounded이고 지속 body/close
penetration은 더 큰 손실을 받는다. hard-valid H-Line이 없어도 dominant PriceMemory ridge를
`baseline_memory` 한 개로 제시한다.

OHLCV 기반 estimated Volume Profile은 선택적인 48-bin projection이다. profile은 H-Line 후보의
rank를 최대 0.05 보강할 수 있지만 ridge 존재, baseline, geometry와 hard gate를 결정하지 않는다.

### RegressionFlow와 Trend

RegressionFlow는 active domain의 q8 HLC3에 대한 unweighted OLS 중심선이다. residual MAD
corridor, leverage와 influence를 제공하며 volume과 recency로 geometry를 움직이지 않는다. 기본
Sight에는 global flow와 충분히 비중복인 local flow를 합쳐 최대 두 개를 투영한다.

Trend는 radius 2/5/13 endpoint Basis를 adaptive temporal coverage로 고르고 role당 최대 12개
anchor를 사용한다. sparse hypothesis는 weighted Theil–Sen slope와 episode anchor Huber intercept로
robust lower/upper boundary를 fit하며 slope 방향을 강제하지 않는다. integrity는 formation domain부터
계산한다. OLS는 Trend를 대신하거나 gate하지 않고 slope consensus/conflict를 설명한다.

Trend inference slice와 RegressionFlow는 volume-only 입력 변경 전후 byte-identical해야 한다.

## 6. StructureRelation과 PatternTrace

Pattern은 hard-valid boundary, contact sequence, containment, contraction과 impulse의 관계다.
Pattern별 pivot, OLS 또는 boundary refit을 실행하지 않는다.

| kind | 관계 |
| --- | --- |
| Triangle | 두 경계의 수렴과 교대 접촉 |
| Channel | 방향성 평행 경계와 containment |
| Rectangle | 두 수평 PriceMemory 경계의 반복 반응 |
| Wedge | 같은 방향 두 경계의 수렴 |
| Flag | impulse 뒤 반대 방향 또는 횡보 평행 consolidation |
| Pennant | impulse 뒤 수렴 consolidation |

family 우선순위는 없다. relation quality, domain scale과 provenance 중복으로 최대 두 관계를
선택하고 같은 boundary는 하나의 presented relation에만 사용한다. Flag와 Pennant의 impulse는
consolidation보다 앞서야 한다.

PatternTrace는 실제 contact·turn·impulse fact를 timestamp 순으로 압축한 3~16개의
`timestamp+price` anchor다. synthetic corner, future apex와 screen 좌표는 anchor가 될 수 없다.
승격된 relation 하나는 managed polyline 하나와 1:1로 대응한다.

hard gate를 넘지 못한 관계 중 provenance가 닫힌 대표 하나는 `PatternEvidence`로 투영할 수 있다.
이는 국소 marker와 짧은 connector만 가지며 이름, selected relation 또는 drawing을 만들지 않는다.
evidence closure는 Field 예산에서 원자적으로 포함하거나 전부 생략한다.

## 7. 선택, identity와 provenance

- H-Line: `1..4`, configured preference 2.
- Trend: `0..3`, configured preference 2. hard-valid 후보가 있으면 최소 하나를 선택한다.
- Pattern: `0..2`, configured quota 없음.
- boundary drawing 최대 7, 전체 managed drawing 최대 9.

```text
inferenceId = hash(
  algorithmVersion, configVersion, inputContractVersion,
  timeContractVersion, calendarVersion, inferenceConfigDigest,
  symbol, interval, asOf, inputDigest
)

sightProjectionId = hash(
  inferenceId, sightProjectionVersion, projectionConfigDigest
)
```

Boundary drawing은 `sourceInferenceId`, `sourceCandidateId`, `sourceFieldModeId`와 field derivation
digest를 가진다. Pattern drawing은 `sourceInferenceId`, `sourceRelationId`와 relation derivation
digest를 가진다. 모든 Pattern anchor는 PatternTrace fact와 일치해야 한다. managed drawing의
`createdAt/updatedAt`은 pack `asOf`다.

사용자와 LLM은 `czardas:` ID, `czardas-managed` ownership 또는 managed provenance를 생성하거나
덮어쓸 수 없다. LLM chart proposal에는 polyline 생성 capability를 노출하지 않는다.

## 8. pack과 Field projection

pack은 algorithm/config/input/time/calendar identity, exact coverage, selection counts, boundaries,
`patternRelations`, drawings, `czardasField`와 reject summary를 포함한다. Field schema 4의 필수
bundle은 다음과 같다.

- 240 CandleMeaning과 factor/reason codebook.
- selected boundary의 mode, Basis, episode, interaction과 validation closure.
- selected Pattern의 relation, trace, supporting boundary와 drawing provenance closure.
- structural domains, selected OLS flow와 PriceMemory projection.

투영된 structural domain은 참조된 domain에서 root까지의 모든 `parentId` 조상을 포함해야 한다.
interaction validation glyph의 가격 corridor가 적용되지 않으면 `corridorLow`와 `corridorHigh`를
생략하지 않고 명시적인 `null`로 전송한다.

role별 비선택 mode 하나, representative Trend hypothesis 하나, H-Line response role별 8개,
PatternEvidence 하나와 48-bin profile은 선택 projection이다. profile과 PatternEvidence closure는
각각 전부 포함하거나 전부 생략한다.

- Field target: `77,824 bytes`.
- Field hard limit: `81,920 bytes` (`80 KiB`).
- pack hard limit: `98,304 bytes` (`96 KiB`).

예산 절삭은 선택 projection부터 수행한다. 필수 bundle이 hard limit을 넘으면 partial pack을
저장하지 않고 `AnalysisUnavailable`을 반환한다. canonical JSON content digest는 wire bytes를,
input digest는 양자화된 exact-240 identity를 식별한다.

## 9. chart runtime 계약

- chart type `czardas`는 지원 interval에서만 선택할 수 있다.
- H-Line, Trend, Pattern 세 toggle은 독립적이며 Shared candle 의미는 항상 보인다.
- H-Line toggle은 PriceMemory 흔적·zone·drawing, Trend toggle은 Trend 의미·OLS·ribbon·drawing,
  Pattern toggle은 relation fact·trace·polyline·label을 제어한다.
- candle, Basis, OLS, Trend, validation과 PatternTrace는 `timestamp+price` data-space다.
- H-Line response와 zone은 exact-240 analysis window에 clip한다.
- hover text와 충돌 회피 label만 screen-space다.
- 모든 data primitive와 managed drawing은 같은 `timestampToX/priceToY` 변환을 쓴다.
- stale 또는 input digest mismatch이면 Field, hover와 해설을 현재 inference처럼 표시하지 않는다.

managed drawing의 최초 편집은 해당 candidate 또는 relation을 session fork/suppress한다. user
polyline은 3~32 anchors, Czardas Pattern polyline은 3~16 anchors다. vertex/path drag, hit-test,
undo/redo와 snapshot serialization은 공용 chart-engine 계약을 사용한다.

## 10. API, 저장과 repair

```text
GET    /api/charts/czardas-assets?symbol=AAPL[&interval=1D]
POST   /api/charts/czardas-assets/build
GET    /api/charts/czardas-assets/build/{cza-job-id}
POST   /api/charts/czardas-assets/build/{cza-job-id}/cancel
DELETE /api/charts/czardas-assets?symbol=AAPL&interval=1D
```

`GET /api/charts/candles`의 Czardas 지원 interval 응답은 명시적인 canonical provenance로 계산한
exact-240 `canonicalSnapshot`을 제공해야 하며, 그 identity는 같은 시점의 저장 pack과 일치해야 한다.

build는 `Idempotency-Key`와 정확히 한 `symbol×interval`을 요구한다. 동일 owner/key/body는 같은
job을 반환하고 같은 owner/pair/force active 요청은 coalesce한다. 다른 owner 또는 force가 다른
active pair 요청과 active build 중 DELETE는 `409`다. status/cancel은 submitter만 조회하며 terminal
cancel은 no-op이다.

GET은 PostgreSQL과 read-only ClickHouse identity만 읽으며 repair, kernel, enqueue와 write를
수행하지 않는다. entry freshness는 `current|stale|missing|incompatible`다. 수동 개발 패널 외에
chart-open, GET, candle event와 Cron이 build를 생성하는 경로는 없다.

worker는 neutral `alfaka.candles` 계약으로 ClickHouse exact-240을 읽는다. 결측이면 연속 range를
Alpaca에서 보충하고 ClickHouse를 canonical re-read한다. lease, same-pair advisory lock, 최대 2회
claim과 pre-commit snapshot audit를 적용한다. cancel, repair 실패 또는 build 중 snapshot 변경 시
새 pack을 저장하지 않고 이전 successful asset을 유지한다.

PostgreSQL의 `czardas_latest`, `czardas_build_jobs`, `czardas_build_items`만 활성 자산·queue 저장소다.
pack에는 deterministic content만 저장하고 `generatedAt`은 DB/API envelope에만 둔다.
