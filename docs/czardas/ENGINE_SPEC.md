# Czardas v3 Engine Specification

이 문서는 Czardas v3 kernel, Sight Field schema 3, asset과 chart의 authoritative 계약이다.

## 1. 고정 계약

| 항목 | 값 |
| --- | --- |
| algorithm/config | `czardas-v3` / `czardas-config-v3` |
| input contract | `canonical-ohlcv-q8-v1` |
| time/calendar | `market-time-v1` / `nyse-calendar-v1` |
| Sight projection | `czardas-sight-v2` |
| 입력 | 최신 canonical 완료봉 exact-240 |
| output | H-Line `0..4`, Trend `0..3`, 파생 Triangle `0..1` |
| Field schema | `3` |
| Field soft/hard | `77,824` / `81,920` bytes |
| pack hard | `98,304` bytes |

H-Line과 Trend 기본 선택 목표는 각각 2지만 quota가 아니다. honest abstention을 허용하며
golden test가 정확한 2/2를 요구해서는 안 된다.

## 2. PresentSnapshot와 input seal

kernel input은 `asOf`에서 끝나는 완료봉 정확히 240개다. 각 row는 다음을 명시해야 한다.

```text
symbol, interval, candleKey, timestamp, open, high, low, close, volume,
isClosed=true, canonicalVersion=v2, priceAdjustment=split, marketSession=regular
```

누락된 provenance에 기본값을 채우지 않는다. row는 timestamp/candle key 오름차순, identity
unique, finite OHLCV, `low <= open/close <= high`, `volume >= 0`이어야 한다. 239/241, live,
duplicate와 malformed input은 `AnalysisUnavailable`이다.

OHLCV는 검증 전에 decimal 8자리 `ROUND_HALF_EVEN`으로 양자화한다. validation, feature,
evidence, geometry와 input digest는 모두 양자화된 값만 사용한다. `+4e-9`처럼 같은 양자화점에
머무는 입력은 pack bytes까지 같고, quantum을 넘는 변화는 `inputDigest`를 바꾼다.

`PresentSnapshotContract`는 240개를 동시에 본 현재 평가다. `asOf` 이하의 오른쪽 문맥은 앞
candle 해석에 사용할 수 있지만 post-`asOf`는 어떤 kernel 단계에도 들어갈 수 없다.
`observedAt/confirmedAt`은 fact 발생·확인 시각이며 history/revision 상태가 아니다.

## 3. 순수 단계와 identity

```text
Exact-240
  -> FeatureTape
  -> pre-Field CandleMeaningTape
  -> EvidenceAtom / confirmed RoleBasis
  -> current H-Line / Trend mode and candidate
  -> all-candle integrity, interaction and relation
  -> selection / Triangle / final CandleMeaning
  -> CzardasInference

CzardasInference
  -> bounded Field projection / drawing / Korean explanation
  -> CzardasSightPack
```

`CzardasInference`는 표현 독립적이다. `CzardasSightPack`만 paint grammar, line width, 설명과
budget projection을 소유한다. production config는 `validate()`에서 exact-240, R2/R5/R13,
ATR14, volume20와 byte/count 범위를 봉인한다. research config는 inference만 허용하고 Sight
projection과 저장을 `research_config_not_storable`로 거부한다.

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

input/provenance identity digest는 derived float의 exact IEEE-754 의미를 보존한다. wire/content
digest는 8자리 canonical pack JSON의 SHA-256이다. 두 digest의 역할을 섞지 않는다.

## 4. Feature와 CandleMeaning

FeatureTape는 한 번의 선형 scan으로 Wilder ATR14, effective ATR, body/wick, close return,
trailing volume20 rank와 log-volume robust z/participation을 만든다.

```text
recency(i) = 2^(-(239-i)/120)
volumeAnomaly = clamp01(.5 + volumeZ/6)
participation = .5*volumeRank + .5*volumeAnomaly
```

ATR availability 전 13봉은 unavailable로 남지만 geometry scale에는 첫 Wilder seed를 사용한다.
첫 seed가 실제 zero-range일 때만 `max(0.01, abs(close)*1e-6)` effective tick을 쓴다.

Field factor는 정확히 21개다.

- Shared: range/ATR, absolute return/ATR, body/lower wick/upper wick fraction,
  local high/low R2/R5/R13.
- H-Line: volume rank/z/participation, support/resistance proximity,
  H-Line penetration, reclaim.
- Trend: lower/upper residual, Trend penetration.

factor normalization은 snapshot median과 `max(1.4826×MAD, semanticFloor)`를 쓴다.
semantic floor는 일반 factor `0.001`, volume rank `0.025`다. floor 이하 차이는 normalized
중립 `0.5` 부근에 머문다. availability가 없는 값은 null sentinel과 reason으로 운반한다.

```text
Shared = RMS(available shared normalized factors)
H-Line = max(support, resistance)
Trend  = max(lower, upper)
display percentile = midrank percentile(Shared + H-Line + Trend)
```

display percentile은 visualization-only다. Trend channel, Trend Field/geometry/rank는
volume-only 변경 전후 byte-identical해야 한다.

## 5. Evidence와 FormationEpisode

R2/R5/R13 extrema는 full right context가 `asOf` 안에 있을 때만 EvidenceAtom이 된다. exact-kind
NMS와 plateau collapse 후 cluster representative가 RoleBasis를 만든다. pre-Field 역할 mass는
Basis mass의 20%에 기여한다. H-Line volume participation은 기존 mass를 `0.90..1.00`에서만
조정하며 단독 seed나 hard-gate bypass가 아니다.

FormationEpisode는 순서대로 Basis를 묶되 유효 방향 `0.75 ATR` 이탈 또는 zone 밖 close 3봉
지속 뒤 다음 Basis부터 새 episode를 허용한다. episode는 다음 canonical contribution을 가진다.

```text
contributionBasisId
contributionIndex
contributionPrice
```

Trend slope, residual, ATR, corridor와 validation timestamp/price는 반드시 같은 contribution
Basis의 index와 price를 사용한다.

## 6. H-Line

1. support/resistance Basis corridor를 elementary price segment로 sweep한다.
2. 양의 폭 segment만 사용하며 점 하나의 접촉은 seed가 아니다.
3. 실제 경계가 맞닿는 segment만 이웃이다. 빈 gap 건너편 ridge는 독립이다.
4. local plateau를 ridge 하나로 합치고 독립 cluster 두 개 이상을 요구한다.
5. episode contribution을 weighted median/MAD로 center/zone refine한다.
6. formation geometry gate를 통과한 final boundary probe에만 all-240 integrity, open break,
   response를 평가한다. gate 전의 weak search mode는 boundary가 아니므로 integrity를 만들지 않는다.
7. exact-240의 48-bin estimated profile은 rank에만 최대 `0.05`를 더한다.

H-Line `J_e`는 contribution Basis 하나의 확장 corridor이며 member corridor 합집합이 아니다.

## 7. Trend

lower/upper를 독립 bank로 만든다. 240봉을 세 시간 구간으로 나누고 방향별 각 구간 최대 4개,
전체 최대 12개 anchor를 선택한다. 최소 12봉 떨어진 pair로 sparse hypothesis를 만든다.

- mode distance: weighted L∞ window-start/window-end 거리.
- medoid: weighted L∞ 거리 합 최소, ID tie-break.
- slope: episode contribution pair의 weighted Theil–Sen median.
- intercept: seed 경계와 episode residual `±zone` 후보를 열거하고 episode anchor Huber loss,
  seed 거리, intercept 순으로 선택.
- slope 방향을 강제하지 않는다.
- formation geometry gate를 통과한 final probe에서만 all-240 integrity를 한 번 계산한다.

## 8. Integrity, response와 rank

모든 관련 candle fact에 recency raw weight를 만들고 합이 1인 capped simplex로 투영한다.

```text
cap = max(0.15, 1/factCount)
nEff = 1 / sum(weight^2)
integrityCoverage = min(1, nEff/7)
```

wick loss는 최대 `0.25`; body와 close penetration은 더 엄격한 bounded loss다. integrity,
body/close integrity, fact count, effective fact count, coverage, body/close penetration count를
별도로 운반한다. coverage는 v3 rank/hard gate에 추가하지 않는다.

response는 fit episode와 겹치지 않고 `fitEvidenceConfirmedAt` 뒤에서 시작한 interaction만
보너스를 받을 수 있다. current snapshot의 마지막 두 close가 반대편 `0.25 ATR`보다 깊으면
open break다. 과거 break 뒤 reclaim은 영구 broken 상태가 아니라 relation fact다.

```text
base rank = .50*seedQuality + .30*integrity + .20*persistence
response bonus <= .10
H-Line profile bonus <= .05
```

selection formula와 기본 목표 2/2는 유지하되 threshold 미달 후보로 quota를 채우지 않는다.
H-Line/Trend selection 뒤에만 Triangle pure relation을 계산한다.

## 9. Field schema 3와 projection

pack과 Field는 다음 identity를 필수로 가진다.

```text
inputContractVersion, inferenceConfigDigest, projectionConfigDigest,
sightProjectionVersion, sightProjectionId
```

Field mandatory bundle:

1. exact-240 candle key/timestamp와 CandleMeaning 전체.
2. selected mode.
3. selected Basis, episode, interaction closure.
4. episode `contributionIndexes`.
5. selected validation/relation.
6. boundary integrity coverage/effective fact/penetration counts.

optional projection:

- role별 비선택 mode 최대 1개.
- retained Trend hypothesis 최대 1개.
- H-Line response segment role별 최대 8개.
- Volume Profile 48-bin 전부 또는 전부 생략.

전체 search mode count는 debug metric에만 있다. `projection.truncated`는 실제 byte budget 절삭이
일어났을 때만 true다. mandatory bundle이 hard limit을 넘으면 partial pack을 저장하지 않는다.

summary/role은 scale 1000 array, factor는 signed int16 big-endian base64, reason은 uint32
bitmask base64다. `-32768`은 null sentinel이고 overflow는 build failure다.

## 10. Sight와 좌표

| 공간 | 대상 |
| --- | --- |
| data-space | candle, Basis, Trend ribbon, validation, managed drawing |
| analysis-space | H-Line zone/response의 exact-240 timestamp window |
| screen-space | hover text, legend, Triangle badge |

모든 data primitive는 동일 `timestampToX/priceToY`를 쓴다. H-Line은 analysis window에 clip한다.
기본 canvas paint의 zoom 문법은 전역 slot width `6px`을 경계로 고정한다. hover로 넓어진
candle width는 이 판정에 들어가지 않는다.

- detail: candle 진하기는 Trend on이면 `(Shared+Trend)/2`, off이면 Shared다.
- detail: H-Line은 고점 resistance/저점 support에 붙는 동일 노란색 국소 수평 흔적이다.
  strength는 role이 양수일 때 `(Shared+role)/2`, 반길이는
  `clamp(slotWidth*(0.55+1.25*strength),3,18)`px다.
- dense: 노란 세로 흔적은 두 branch on이면 composite percentile, 일부 off이면 Shared와
  켜진 summary의 평균이다.
- Trend upper/lower candle glyph는 없으며 selected ribbon/Basis도 같은 Trend 색을 쓴다.

selected zone/ribbon, selected Basis/validation, drawing/Triangle은 유지한다.
response/profile/non-selected mode/hypothesis는 paint 0이다. H-Line/Trend toggle은 해당 channel의
시각 기여만 제거하고 Shared는 항상 유지한다.

hover text는 21개 factor, 모든 reason, availability와 phase를 항상 표시한다. `240봉 내 전체
의미 백분위`는 probability가 아니다. same-candle pointer movement는 overlay rerender를 만들지 않고
전체 overlay에 `aria-live`를 두지 않는다.

`Czardas 해설`과 focus event는 `inferenceId+asOf+inputDigest`가 일치해야 한다. focus에는
candidate provenance도 포함한다. stale/mismatch면 Field, hover와 해설을 숨긴다.

## 11. API, queue와 저장

```text
GET    /api/charts/czardas-assets?symbol=AAPL[&interval=1D]
POST   /api/charts/czardas-assets/build   (Idempotency-Key 필수)
GET    /api/charts/czardas-assets/build/{cza-id}
POST   /api/charts/czardas-assets/build/{cza-id}/cancel
DELETE /api/charts/czardas-assets?symbol=AAPL&interval=1D
```

GET은 mutation-free다. optional interval이면 그 entry만 PostgreSQL/ClickHouse에서 읽는다.
entry는 freshness와 `identity_match|input_changed|identity_unavailable|asset_missing|
contract_incompatible` reason을 가진다. candle response의 exact completed-240에는 server-derived
`canonicalSnapshot` metadata를 붙인다.

build는 모든 로그인 사용자가 할 수 있지만 status/cancel은 owner에게만 보이며 타인은 404다.
동일 owner/idempotency/body는 같은 job, 동일 owner/pair/force active job은 coalesce한다. force가
다르거나 다른 owner가 같은 pair를 실행 중이면 `409 czardas_pair_busy`다. terminal cancel은
no-op이고 active build 중 DELETE는 409다.

`submit_once()`는 idempotency 판단과 job/item insertion을 한 PostgreSQL transaction에서 한다.
unexpected exception 원문은 DB/API에 저장하지 않는다. lease, 최대 2회 claim, repair,
pre-commit snapshot audit, cancel-safe save와 기존 successful asset 보존 계약을 유지한다.

PostgreSQL migration은 `004 -> 005`다. v2/null identity row는 보존하지만 incompatible다.

## 12. Offline evaluator

`evaluation.py`는 runtime replay가 아니다. 선택한 historical index마다 별도 exact-240을 kernel에
전달한다. future horizon은 `_future_outcomes`에만 전달한다. evaluator는 다음을 보고한다.

- adjacent H-Line/Trend ATR-normalized drift와 timestamp-aligned Field churn.
- future contact, reclaim, body/close penetration과 2-close invalidation.
- geometry overlap과 fit episode Jaccard 기반 marginal information.
- response/profile rank ablation, neutral-volume, flat-recency, single-radius R2/R5/R13 research inference.
- latest confirmed radius-5 pivot baseline.
- output/search counts, Field/pack bytes와 stage latency.

research config는 Sight projection과 저장이 금지되고 evaluator는 production threshold를 자동
조정하지 않는다.

## 13. 완료 gate

- 같은 exact-240 100회 content bytes/digest 동일.
- q8 같은 양자화점 동일, quantum 초과 input digest 변경.
- canonical provenance 누락과 239/241 production input/config 거부.
- flat MAD와 sub-resolution factor가 0/1로 포화되지 않음.
- 초기 13봉 geometry가 artificial one-cent ATR을 쓰지 않음.
- isolated wick 제한, persistent body/close 침투 강한 감점.
- disconnected H-Line ridge 독립.
- Trend contribution index/price가 같은 Basis와 일치.
- volume-only Trend inference slice byte-identical.
- selected derivation orphan 0; Field/pack `<=80/96 KiB`.
- kernel P95/P99 `<=50/80ms`; frontend parse/delta와 Field paint 각각 P95 `<=8ms`.
- canvas response/profile/non-selected paint 0; pan/zoom 오차 `<=0.5px`.
- manual submit enqueue 1, idempotency/coalesce/owner/terminal/delete race.
- chart-open, GET, candle-event와 Cron이 만든 build job 0.
