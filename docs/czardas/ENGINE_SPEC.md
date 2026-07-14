# Czardas v4 Engine Specification

이 문서가 커널, pack, provenance와 Sight의 기술 기준이다.

## 1. 불변 계약

- input: `v2 / split / regular / closed` canonical OHLCV exact-240.
- numeric: 진입 시 q8 `ROUND_HALF_EVEN`; 검증·feature·geometry·digest는 양자화 값만 사용.
- time: UTC millisecond `Z`, `[start,end)`, code-owned NYSE calendar, `asOf`는 마지막 완료봉.
- perspective: exact-240 전체를 함께 본 PresentSnapshot. runtime historical replay는 없다.
- isolation: live candle과 post-`asOf` row는 inference, Field, 설명, provenance에 0개.
- determinism: 입력 순서와 hash iteration에 독립적인 canonical JSON과 stable ID.
- Trend와 RegressionFlow는 volume-only 변경 전후 semantic slice가 byte-identical.
- inference와 Sight는 순수 단계이며 LLM은 참여하지 않는다.

## 2. 데이터 흐름

```text
CandleTape / FeatureTape
  → Intrinsic CandleMeaning
  → StructuralDomainTree
  → StructuralFactTape
  → PriceMemoryField / RegressionFlow
  → BoundaryMode landscape
  → StructureRelation hypotheses
  → boundary + relation joint selection
  → CzardasInference
  → CzardasSightPack
```

relation은 boundary presentation selection 전에 계산한다. Pattern supporting boundary는 최종
H-Line/Trend quota에 들지 않아도 Field closure에 남을 수 있다.

## 3. 구조 계층

### StructuralDomainTree

root는 0..239다. q8 HLC3의 piecewise-linear robust 설명 손실이 복잡도 비용보다 충분히
감소할 때만 분할한다. child는 최소 6봉을 가져야 하며 깊이는 `ceil(log2(240))`을 넘지 않는다.
root, 현재 `asOf`를 포함하는 right spine과 그 sibling이 active scale이다. fixed lookback detector
목록이나 장기/단기 우선순위는 없다.

### StructuralFactTape와 CandleMeaning

StructuralFactTape는 확정 endpoint/reaction `RoleBasis`와 adaptive preceding-impulse를 한 번
계산해 공유한다. touch, acceptance, break와 reclaim은 특정 boundary와의 관계이므로 해당
boundary의 Interaction fact로 한 번 계산해 Field와 설명에서 재사용한다.
`observedAt`은 사실 발생, `confirmedAt`은 필요한 오른쪽 문맥 완성 시각일 뿐 엔진 과거 상태가
아니다. 우측 문맥 부족 extrema는 `confirmation_pending`이고 Basis가 아니다.

CandleMeaning은 Intrinsic, FieldRelation, SelectedUsage를 분리한다. factor와 reason은
`czardas-factor-codebook-v4` codebook으로 운반하며 factor 이름 수는 wire 상수가 아니다.
Pattern 참여는 sparse relation glyph/episode reference로 기록하고 candle composite에 재가산하지
않는다.

### PriceMemoryField와 H-Line

각 candle의 high/low 주변 유한 interval에 body, wick rejection과 `asOf` recency를 누적하고 exact
interval event sweep으로 ridge를 만든다. 닿는 plateau만 압축하며 빈 가격 gap을 연결하지 않는다.
volume-at-price 48-bin projection은 선택적 rank boost(최대 0.05)일 뿐 ridge 존재, baseline 또는
hard gate를 만들지 않는다.

H-Line은 episode compression, weighted median/MAD refine, capped-recency all-candle integrity와
독립 response를 사용한다. wick loss는 bounded이고 body/close 지속 penetration은 더 강하다.
정상 Ready pack에 hard candidate가 없으면 dominant PriceMemory ridge를 `baseline_memory` H-Line
한 개로 제시한다. baseline은 Pattern hard evidence가 아니다.

### RegressionFlow와 Trend

active domain의 q8 HLC3에 unweighted OLS를 적용해 center line, residual MAD corridor, leverage와
구조를 만든다. 기본 Sight에는 global flow와 충분히 다른 current-local flow, 최대 두 개만
투영한다.

Trend는 radius 2/5/13 endpoint Basis에서 adaptive temporal coverage로 role당 최대 12 anchors를
고른다. hypothesis mode, weighted Theil–Sen slope와 episode anchor Huber intercept로 robust
lower/upper boundary를 fit한다. slope 방향을 강제하지 않는다. integrity는 formation domain부터
계산하며 OLS는 Trend geometry를 대체하거나 gate하지 않는다. 최종 explanation은 OLS slope
consensus/conflict를 기록한다.

### StructureRelation과 PatternTrace

Pattern은 기존 hard-valid boundary, contact sequence, containment, contraction과 impulse를 읽는다.
별도 pivot/OLS/refit chain은 없다.

- Triangle: 두 경계의 수렴과 교대 접촉.
- Channel: 방향성 평행 경계와 containment.
- Rectangle: 두 수평 PriceMemory 경계의 반복 반응.
- Wedge: 같은 방향 두 경계의 수렴.
- Flag: impulse 뒤 반대 또는 횡보 평행 consolidation.
- Pennant: impulse 뒤 수렴 consolidation.

family 우선순위는 없다. relation quality, domain scale과 provenance 중복으로 최대 두 관계를
선택하고 같은 boundary는 한 presented relation에만 쓴다. PatternTrace는 실제 fact를 시간순으로
압축한 3~16 anchors다. synthetic corner, 미래 apex와 screen 좌표는 금지한다. 감지 relation과
managed polyline은 1:1이다.

hard gate를 통과하지 못한 관계 가운데 provenance가 닫힌 대표 하나는 `PatternEvidence`가 될 수
있다. 이것은 실제 contact fact를 국소 marker와 짧은 connector로 보여줄 뿐 완성 외곽선, Pattern
이름 또는 managed drawing을 만들지 않는다. evidence와 그 boundary/mode/episode closure는
원자적으로 투영하며 80 KiB Field 예산을 넘으면 전부 생략한다.

## 4. 선택과 개수

- H-Line `1..4`, configured preference 2.
- Trend `0..3`, configured preference 2. hard-valid가 있으면 최소 하나, 없으면 abstain.
- Pattern `0..2`, quota 없음.
- boundary 최대 7, 전체 managed drawing 최대 9.

Pattern 관계는 scene selection 전 평가된다. Tactical 무효화·목표·risk/reward는 inference 뒤
설명일 뿐 detector와 rank 입력이 아니며 v4 drawing 범위에도 포함하지 않는다.

## 5. identity와 provenance

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

Boundary drawing은 `sourceInferenceId + sourceCandidateId + sourceFieldModeId +
sourceFieldDerivationDigest`, Pattern drawing은 `sourceInferenceId + sourceRelationId +
sourceRelationDerivationDigest`를 가진다. Pattern anchor는 PatternTrace와 정확히 같아야 한다.
`sourceGroupId`와 Triangle atomic group은 없다. user/LLM은 managed provenance나 `czardas:` ID를
생성·덮어쓸 수 없고 LLM polyline proposal은 허용하지 않는다.

## 6. pack과 Sight

- algorithm/config: `czardas-v4` / `czardas-config-v4`.
- Field schema: `4`; Sight: `czardas-sight-v3`.
- Field `<=80 KiB`; pack `<=96 KiB`.
- mandatory: 240 CandleMeaning, selected boundary closure, selected Pattern closure와 drawing provenance.
- optional: 대표 PatternEvidence 1과 그 원자적 closure, role별 비선택 mode 1, Trend hypothesis 1,
  H-Line response role별 8, profile 전체.
- mandatory bundle 초과 시 partial pack을 저장하지 않는다.

data-space는 candle, Basis, OLS, Trend, validation과 PatternTrace의 `timestamp+price`다. H-Line
window는 analysis-space이며 overlay/label만 screen-space다. 모든 data primitive와 managed
drawing은 같은 `timestampToX/priceToY` 변환을 쓴다.

세 toggle은 H-Line, Trend, Pattern이다. Pattern은 다른 두 layer가 꺼져도 독립 표시된다.
Pattern relation 근거조차 없으면 버튼은 disabled다. 최종 Pattern 이름은 polyline에 연결된
label이며 Triangle badge와 Trend 굵기 표현은 없다. 최종 relation이 없어도 PatternEvidence가
투영되면 버튼은 활성화되고 완성 Pattern처럼 표시하지 않는다.

## 7. 운영 계약

API는 `/api/charts/czardas-assets` 전용 GET/build/status/cancel/delete다. build POST는
Idempotency-Key와 단일 pair를 요구한다. GET은 mutation-free다. 수동 panel 이외 자동 enqueue
경로는 없다. exact-240을 만들지 못하면 기존 successful asset을 유지한다.
