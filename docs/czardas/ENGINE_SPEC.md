# Czardas v2 Engine Specification

이 문서는 현재 코드가 구현하는 Czardas kernel, Field schema 2와 chart 계약의 기준이다.
과거 시점 replay나 revision history는 이 규격에 없다.

## 1. 고정 계약

| 항목 | 값 |
| --- | --- |
| algorithm | `czardas-v2` |
| config | `czardas-config-v2` |
| time contract | `market-time-v1` |
| calendar | `nyse-calendar-v1` |
| 입력 | 최신 canonical 완료봉 exact-240 |
| output | H-Line `0..4`, Trend `0..3`, 파생 Triangle `0..1` |
| Field schema | `2` |
| Field soft target | `77,824` bytes = `76 KiB` |
| Field hard limit | `81,920` bytes = `80 KiB` |
| pack hard limit | `98,304` bytes = `96 KiB` |

H-Line 기본 목표는 2개, Trend 기본 목표는 lower/upper 각 하나인 2개다. 목표는 quota가
아니므로 적격 후보가 없으면 0개 또는 1개가 정상이다.

## 2. PresentSnapshotContract

1. kernel input은 `asOf`에서 끝나는 완료봉 240개 하나다.
2. 240개를 동시에 본 현재 관점으로 각 candle의 의미와 현재 선을 계산한다.
3. candle `i` 뒤의 데이터도 `asOf` 이하라면 `i`의 neighborhood, 확인과 반응 해석에 쓸 수 있다.
4. live candle과 `asOf` 이후 데이터는 input digest, feature, evidence, Field, explanation과
   provenance 어디에도 들어가지 않는다.
5. snapshot이 한 봉 이동하거나 correction되면 이전 candle의 의미와 선도 다시 계산한다.
6. candle 순서는 fact confirmation, episode와 interaction의 선후관계에만 쓴다.
7. 과거 Field, candidate, rank나 엔진 상태를 복원하지 않는다.

`observedAt`은 시장 사실이 발생한 시각, `confirmedAt`은 필요한 오른쪽 문맥이 현재 snapshot
안에서 완성된 시각이다. 구조적 fact는 `observedAt <= confirmedAt <= asOf`다. 이 둘은 엔진의
판단 시각이나 revision watermark가 아니다.

우측 문맥이 부족한 extrema는 CandleMeaning에 `confirmation_pending`을 남길 수 있지만
EvidenceAtom과 RoleBasis를 만들지 않는다. snapshot 순회는 항상 index `0..239` 안에서 끝난다.

## 3. Pipeline

```text
Exact-240 CandleTape
  -> FeatureTape
  -> pre-Field CandleMeaningTape
  -> EvidenceAtom / cluster / confirmed RoleBasis
  -> current H-Line and Trend modes
  -> coherent BoundaryCandidates
  -> all-candle integrity and interaction facts
  -> selection and Triangle relation
  -> selected-boundary CandleMeaning blend
  -> boundaries, drawings and bounded FieldView
```

authoritative 계산은 Python kernel 하나다. frontend는 wire를 검증·역변환·투영하며 factor,
candidate geometry나 rank를 재계산하지 않는다.

## 4. Input과 FeatureTape

### 4.1 CandleTape

각 row는 symbol, interval, unique candle key, UTC `Z` timestamp와 finite OHLCV를 가진다.

- `low <= open/close <= high`, `volume >= 0`.
- canonical schema `v2`, adjustment `split`, session `regular`, state `closed`.
- timestamp와 candle key가 오름차순이며 exact-240이어야 한다.
- 239/241봉, duplicate, live-only 또는 malformed input은 `AnalysisUnavailable`이다.

`inputDigest`는 canonical candle identity와 OHLCV content의 digest다. `asOf`는 index 239의
timestamp다.

### 4.2 FeatureTape

한 번의 선형 scan으로 다음 SoA를 만든다.

- Wilder ATR14와 zero/준비 구간용 positive `effectiveAtr` floor.
- body low/high, lower/upper wick.
- close-to-close return.
- 직전 20봉 대비 volume rank, log-volume median/MAD z와 participation.

```text
volumeAnomaly = clamp01(.5 + volumeZ / 6)
participation = .5 * volumeRank + .5 * volumeAnomaly
recency(i) = 2^(-(239-i)/120)
```

recency는 FeatureTape column이나 prefix별 값이 아니라 현재 RoleBasis mass를 만들 때 index 239를
기준으로 한 번 계산한다.

## 5. CandleMeaningTape

### 5.1 factor catalog

Field schema 2의 raw/normalized factor key는 정확히 21개다.

| 단계 | key |
| --- | --- |
| pre-Field Shared | `rangeAtr`, `absoluteReturnAtr`, `bodyFraction`, `lowerWickFraction`, `upperWickFraction` |
| pre-Field neighborhood | `localHighR2`, `localLowR2`, `localHighR5`, `localLowR5`, `localHighR13`, `localLowR13` |
| pre-Field H-Line volume | `volumeRank`, `volumeZ`, `participation` |
| selected H-Line | `supportProximity`, `resistanceProximity`, `hlinePenetrationAtr` |
| selected Trend | `lowerResidualAtr`, `upperResidualAtr`, `trendPenetrationAtr` |
| selected shared relation | `reclaimStrength` |

현재 raw catalog에는 close-location, close-extremity 또는 recency factor가 없다. close와 recency는
각각 integrity/interaction과 RoleBasis mass 내부 계산에 쓰이며 hover factor로 가장하지 않는다.

`localHigh/LowR{r}`는 `[i-r,i+r]`를 snapshot 경계에서 clip한 가격 범위 안에서 현재 high/low의
상대 위치다. confirmed extrema 승격만 full right context를 요구한다.

### 5.2 availability와 robust normalization

availability bit은 ATR 준비, trailing-volume baseline 준비, 최대 radius 13의 오른쪽 문맥 준비를
각각 나타낸다. 없는 ATR/volume 값은 raw와 normalized 모두 null이다.

각 factor의 exact-240 available raw 값에 대해 다음을 적용한다.

```text
center = median(values)
scale  = max(1.4826 * median(abs(value-center)), 1e-12)
normalized = clamp01(.5 + (value-center)/(6*scale))
```

Shared summary는 available normalized Shared/neighborhood factor의 RMS다. H-Line과 Trend 역할은
단순 RMS가 아니라 다음 방향별 가중식이다. `localHigh`와 `localLow`는 각각 R2/R5/R13
normalized 값의 RMS이고, 식의 다른 항도 normalized 값이다.

```text
hSupport = .40*localLow  + .20*lowerWick + .15*range + .15*absReturn
hResist  = .40*localHigh + .20*upperWick + .15*range + .15*absReturn

supportPre/resistancePre =
  volume available   ? clamp(hRole + .10*participationNormalized)
                     : clamp(hRole / .90)

lowerPre = clamp(.55*localLow  + .20*lowerWick + .15*range + .10*absReturn)
upperPre = clamp(.55*localHigh + .20*upperWick + .15*range + .10*absReturn)
```

없는 ATR 기반 항은 이 역할식에서 0으로 기여한다. availability와 reason은 별도로 남으므로 0이
관측값인 것처럼 표시되지 않는다. Trend 역할식은 volume factor를 읽지 않는다.

### 5.3 RoleBasis에 대한 실제 기여

pre-Field 역할값은 visualization-only composite와 별개로 RoleBasis mass의 20%를 구성한다.

```text
hlineStructural = clamp(.40*prominence + .30*rejection
                       +.20*bodyIntegrity + .10*recency)
participationMultiplier = volume unavailable ? 1 : .90 + .10*participation
hlineRoleMass = clamp(.80*hlineStructural*participationMultiplier
                     +.20*supportPreOrResistancePre)

scaleScore(R2/R5/R13) = .35/.70/1.00
trendStructural = clamp(.50*prominence + .30*scaleScore + .20*recency)
trendRoleMass = clamp(.80*trendStructural + .20*lowerPreOrUpperPre)
```

H-Line의 geometry score는 volume과 pre-Field 역할값을 제외한
`(.40*prominence + .20*bodyIntegrity + .10*recency)/.70`이다. Trend geometry score는
trendRoleMass와 같고 그 call graph는 volume-independent다.

### 5.4 selected-boundary blend

selection 뒤에만 현재 선택 경계와 모든 240봉의 관계를 계산한다.

```text
hlineProximity = exp(-distance(candleRange, zone)/ATR)
trendResidualAtr = max(0, abs(roleEndpoint-line)-zone)/ATR
trendAlignment = exp(-trendResidualAtr)

supportFinal/resistanceFinal = clamp(.65*pre + .35*hlineProximity)
lowerFinal/upperFinal         = clamp(.65*pre + .35*trendAlignment)
```

role에 선택 경계가 없으면 그 role의 relation은 null이다. H-Line/Trend 관계가 하나라도 있는
candle에서 반대 role의 null relation은 blend의 0 항으로 처리된다. penetration은 zone 반대편
body depth/ATR다. reclaim은 wick이 zone을 탐색했지만 종가가 유효한 쪽에 남은 깊이를 bounded
강도로 기록하며 H-Line/Trend 중 큰 값을 `reclaimStrength`로 쓴다.

Shared summary는 final 단계에서 바뀌지 않는다.

```text
hlineSummary = max(supportFinal, resistanceFinal)
trendSummary = max(lowerFinal, upperFinal)
compositePercentile = midrankPercentile(shared + hlineSummary + trendSummary)
```

Composite는 renderer 전용이다. Evidence, mode, candidate, rank와 selection에 되먹임되지 않는다.
조밀한 zoom에서도 H-Line/Trend toggle이 꺼지면 해당 channel은 합성 강도에서 제외하고 Shared는
항상 유지한다.

화면 표기는 `상대 의미도`다. 이는 exact-240 내부 percentile이라는 뜻이며 예측 확률이나 매매
점수가 아니다. hover/focus overlay는 summary와 role뿐 아니라 21개 factor의 raw/normalized 값,
모든 reason의 channel/usage, availability와 phase를 접기나 스크롤 없이 표시한다.

### 5.5 phase와 reason

phase bit은 `geometryInput`, `fit`, `integrity`, `response`, `visualizationOnly`,
`confirmationPending`이다. 실제 RoleBasis bar, selected fit Basis bar, supported-response contact와
selected-boundary relation bar에만 해당 bit을 추가한다.

reason codebook의 각 code는 channel과
`geometry_input | fit | integrity | response | visualization_only` usage를 가진다. pre-Field
factor의 대표 reason은 그 candle에서 두드러진 관측을 설명할 뿐이므로 visualization-only로
표시한다. 확인된 extrema가 RoleBasis로 승격된 bar에는 방향별
`support/resistance/lower/upper_role_basis_input`을 별도로 붙여, 해당 pre-Field 역할값이
RoleBasis 질량의 20%로 geometry에 실제 기여했음을 명시한다. RoleBasis/fit/response에 실제
사용된 bar만 해당 usage reason을 가진다.

선택된 support/resistance/lower/upper 경계가 없어서 relation factor가 null인 경우에는 모든
candle에 해당 방향의 `*_boundary_unavailable` reason을 붙인다. 이는 관측값 0이나 정렬 실패가
아니라 현재 pack에 비교할 선택 경계가 없다는 뜻이다.

## 6. Evidence와 RoleBasis

radius `2/5/13`의 centered window에서 strict 양쪽 문맥을 가진 swing high/low를 찾는다. 같은
가격의 연속 plateau는 prominence와 안정 ID로 하나를 고른다. swing fact는 `i+r`, 3봉 rejection
fact는 `max(i+r,i+3)`에서 확인된다.

같은 exact kind만 NMS cluster로 묶는다. 대표 bar 차이는 최대 2, corridor overlap 또는
`0.25 ATR` 가격 근접을 요구한다. 다른 kind를 합치지 않는다.

| atom kind | RoleBasis role |
| --- | --- |
| `rejectionLow` | support |
| `rejectionHigh` | resistance |
| `swingLow` | lower |
| `swingHigh` | upper |

각 RoleBasis는 endpoint, body edge, wick corridor, role/geometry mass, rejection, optional
participation, effective scale, observed/confirmed index를 가진다.

## 7. FormationEpisode와 integrity

Basis는 bar/confirmation 순서로 처리한다. 이전 Basis 다음부터 새 Basis 전까지 유효 방향으로
zone을 떠났으면 새 FormationEpisode를 시작한다.

- zone에서 `0.75 ATR` 이상 유효 방향으로 멀어진 close, 또는
- 유효 방향 zone 밖 close가 3봉 연속.

episode contribution은 member endpoint의 weighted median에 해당하는 canonical Basis다.
H-Line corridor는 이 contribution Basis corridor에 touch tolerance를 확장한 것이며 member
corridor 합집합이 아니다.

현재 candidate integrity는 exact-240 index `0..239`를 한 번 스캔한다. zone에서 1 ATR보다
멀고 침투가 없는 candle은 중립이라 적분에서 제외한다. 나머지는 다음 bounded loss를 쓴다.

```text
raw = max(wickDepth, 4*bodyDepth, 8*closeDepth)
factLoss = raw/(1+raw)
weight(i) proportional to 2^(-(239-i)/120), per-candle influence <= .15
integrity = clamp01(1 - sum(weight*factLoss))
```

bodyIntegrity와 closeIntegrity는 같은 방식으로 각각 `4*bodyDepth`, `8*closeDepth`를 쓴다.
최신 index 238과 239의 close depth가 모두 `0.25 ATR`를 초과하면 `hasOpenBreak=true`다.

## 8. H-Line detector

1. support/resistance별 RoleBasis를 role mass 순으로 최대 48개 유지한다.
2. 각 wick corridor에 `0.25 ATR` tolerance를 확장하고 양의 폭 elementary segment만 sweep한다.
3. 같은 response mass의 연속 segment를 plateau ridge 하나로 합친다.
4. 서로 다른 cluster 두 개 이상이 겹친 ridge만 provisional mode가 된다.
5. FormationEpisode contribution corridor를 다시 sweep한다.
6. weighted median center, weighted MAD와 80% residual floor로 zone을 refine한다.

coherent H-Line hard gate는 다음과 같다.

- fit episode `>=2`, observed span `>=20` bars.
- mean rejection `>=.35`, seed quality `>=.45`.
- zone `<=.35 × candidate median ATR`.
- body integrity `>=.70`, current open break 없음.

```text
agreement = clamp01(1 - weightedMAD/zone)
seedQuality = .45*mean(contribution geometryScore)
             +.30*meanEpisodeRejection + .25*agreement
```

동일 OHLCV로 만든 48-bin estimated profile은 coherent candidate의 rank에만 최대 `.05`를 더한다.
profile은 seed와 hard gate를 만들지 않는다.

## 9. Trend detector

lower와 upper를 완전히 독립 처리한다.

1. effective scale `>=5` 또는 geometry score `>=.75`인 RoleBasis를 anchor 후보로 쓴다.
2. `[0..79]`, `[80..159]`, `[160..239]`에서 각 최대 4개를 뽑아 role별 최대 12개를 유지한다.
   비어 있는 시간 구간의 cap을 다른 구간에서 다시 채우지 않는다.
3. 최소 12봉 떨어진 pair로 최대 66개 hypothesis를 만든다.
4. seed mass는 두 role mass의 기하평균에 separation weight `.25..1`을 곱한다.
5. window 시작/끝 가격의 weighted L-infinity 거리 `<=.50 ATR`인 hypothesis를 묶고 weighted
   distance sum 최소 medoid를 고른다.
6. medoid corridor에 compatible한 Basis를 episode로 압축한다.
7. episode pair slope의 weighted median으로 slope를 정하고 lower 20%/upper 80% residual
   quantile에서 intercept seed를 잡는다.
8. residual과 `residual±zone`, seed bound를 열거해 `(loss, |intercept-seed|, intercept)` 순으로
   현재 intercept를 선택한다.

coherent Trend hard gate는 다음과 같다.

- episode `>=2`, 서로 12봉 이상 떨어진 episode pair와 span `>=20`.
- contribution corridor가 line의 `.50 ATR` tolerance 안에 있음.
- seed quality `>=.50`, `abs(slope)/candidateATR <=.15`.
- body integrity `>=.75`, close integrity `>=.85`, current open break 없음.

```text
fitScore = exp(-weightedMedian(endpoint residual / ATR))
touchScore = clamp01(episodeCount/4)
seedQuality = .45*mean(contribution roleMass) + .35*fitScore + .20*touchScore
```

slope 방향은 강제하지 않는다. Trend의 factor, RoleBasis, anchor, mode, episode, interaction,
boundary rank와 drawing geometry는 volume-only 변경 전후 byte-identical해야 한다. 입력 전체를
식별하는 `inputDigest/inferenceId/sourceInferenceId`와 H-Line·Shared가 섞인 container 위치는 이
Trend-owned byte 비교에서 제외한다.

## 10. Interaction, rank와 selection

`fitEvidenceConfirmedAt`은 fit episode의 최대 `confirmedAt`이다. interaction scan은 그 다음
index부터 시작하므로 fit evidence를 response로 다시 세지 않는다.

contact 뒤 평가 horizon은 formation span `<48`, `<96`, 그 이상에 각각 `3/5/8`봉이다.
horizon이 `asOf`를 넘으면 `response_pending`이다. 완료되면 다음을 계산한다.

```text
responseScore = clamp01(
  .45*maxCloseExcursion
  +.30*(1-acceptanceMass)
  +.25*explorationPressure*reclaimSpeed*(1-acceptanceMass)
)
```

`maxCloseExcursion >=.25 ATR`이고 score `>=.45`면 `supported_response`, 아니면
`neutral_response`다. interaction scan 안에서 반대편 `0.25 ATR` 초과 close가 2봉 연속이면
`confirmed_break`다. public outcome은 이 네 값뿐이다.

candidate의 `evidenceState`는 supported response가 하나라도 있으면 `response_supported`,
그렇지 않으면 `formed`다. response는 drawing hard gate가 아니다.

```text
responseMass  = sum(supported responseScore)
responseBonus = .05 * min(responseMass, 2)          # max .10
profileBonus  = H-Line only: .05 * profileConfluence # max .05
baseRank      = .50*seedQuality + .30*integrity + .20*persistence
rankScore     = clamp01(baseRank + responseBonus + profileBonus)
```

selection eligibility는 rank `>=.45`이고, 최근 fact가 120봉 안이거나 현재 가격과의 거리가
`<=3 ATR`인 후보이다. 동일 role 근접 후보의 중복 utility를 감점한다. 두 Trend role이 모두
있고 목표가 2개 이상이면 lower와 upper를 함께 선택한다. 한쪽만 있으면 하나만 선택한다.

Triangle은 selection 이후 upper/lower Trend pair의 순수 기하 관계다. candidate geometry나
rank를 변경하지 않는다.

## 11. Identity와 provenance

```text
inferenceId = hash(
  algorithmVersion, configVersion, timeContractVersion, calendarVersion,
  symbol, interval, asOf, inputDigest
)
```

- H-Line `fieldModeId`: role과 canonical origin seed Basis IDs.
- Trend `fieldModeId`: role과 medoid hypothesis ID.
- `derivationDigest`: current contributors, episode set, geometry, mass와 opposition의 digest.
- `candidateId`: kind, role과 canonical initial two episode IDs.
- drawing provenance: `sourceInferenceId`, `sourceCandidateId`, `sourceFieldModeId`,
  `sourceFieldDerivationDigest`.

같은 stable candidate ID가 새 snapshot에 다시 나타나도 history revision이 아니다. drawing의
`createdAt/updatedAt`은 wall clock이 아니라 pack `asOf`다. public pack에는 revision, lineage,
first-seen 또는 replay field가 없다.

## 12. Field schema 2

### 12.1 CandleMeaning wire

`candleMeanings`는 같은 index가 같은 candle을 가리키는 compact SoA다.

- `candleKeys[240]`, `timestamps[240]`.
- `summaries`와 `roles`: score scale 1000의 integer arrays.
- `factors`와 `normalizedFactors`: factor별 240개 signed int16 big-endian base64 blob.
- `availabilityMasks[240]`, `phaseMasks[240]`와 bit codebooks.
- `reasonMasks`: candle별 uint32 big-endian reason mask 240개를 합친 base64 blob.
- `reasonCodebook`: code `0..31`, key, label, usage와 channel.

raw factor encode/decode는 metadata에 의해 결정된다.

```text
qRaw = round(transform(raw) * rawFactorScales[key])
raw  = linear ? qRaw/scale : expm1(qRaw/scale)

qNormalized = round(normalized * normalizedFactorScale) # scale=1000
normalized  = qNormalized/1000
```

`rangeAtr`, `absoluteReturnAtr`, lower/upper residual, H-Line/Trend penetration은 `log1p`; 나머지는
`linear`다. v2 factor scale은 모두 1000으로 잠그며 wire의 factor별 map도 이 값을 명시한다.
frontend는 상수를 가정해 재계산하지 않고 검증된 map으로 역변환한다. null sentinel은
`-32768`, 유효 int16 범위는 `-32767..32767`이다. `rawFactorRanges`를
함께 보내고 overflow는 clamp하지 않고 `factor_encoding_overflow`로 build를 실패시킨다.

factor blob 하나는 480 bytes/640 base64 chars, reason mask는 960 bytes/1280 base64 chars다.

### 12.2 mandatory selected closure

Field의 필수 의미 bundle은 다음이다.

1. exact-240 `candleMeanings` 전체.
2. `basisFacts`: selected mode contributor와 selected fit episode member/contribution Basis의 SoA.
3. selected mode의 `contributorBasisIndexes`: `basisFacts`를 가리키는 모든 contributor index.
4. `selectedModeRefs`와 source inference/mode/derivation digest.
5. `derivationEpisodes`: candidate별 fit episode closure.

`derivationEpisodes.candidateIndexes`는 `selectedModeRefs` index를 가리킨다.
`candidateEpisodeOrdinals`는 해당 candidate boundary의 `fitEpisodeIds` ordinal을 가리킨다.
`contributionBasisIndexes`와 각 `memberBasisIndexes`는 `basisFacts` index를 가리킨다. 모든 SoA
column 길이는 같아야 하고 selected closure에 orphan이 없어야 한다.

`basisGlyphs`는 대표 Basis를 바로 그리기 위한 optional projection이다. 생략되어도
`basisFacts`와 index closure는 남는다. H-Line profile/response segment, 비선택 mode, 추가
representative hypothesis와 대표 glyph도 optional이다.

### 12.3 budget projection

Field가 soft target 76 KiB를 넘으면 canonical 순서로 다음을 줄인다.

1. profile 전체 생략.
2. Trend representative hypothesis를 mode당 하나까지 축소.
3. optional `basisGlyphs`.
4. H-Line response segments.
5. 비선택 Trend/H-Line modes.

selected mode, `basisFacts`, derivation episodes, CandleMeaning과 selected validation은 제거하지
않는다. projection은 omitted count와 `truncated`를 기록한다. projection 후 Field가 hard
80 KiB를 넘거나 전체 pack이 96 KiB를 넘으면 partial Ready를 만들지 않고
`payload_limit_exceeded`가 된다.

## 13. 좌표와 frontend

| 공간 | 대상 | 변환 |
| --- | --- | --- |
| data-space | candle, Basis, Trend mode/hypothesis/ribbon, validation, drawing | `timestampToX` + `priceToY` |
| analysis-space | H-Line response, ridge와 zone | exact window timestamp 범위 + `priceToY` |
| screen-space | hover text overlay, legend, Triangle badge | viewport CSS pixel |

H-Line primitive는 `windowFromTimestamp..windowToTimestamp`에서 clip한다. Field는 price autoscale
source가 아니다. pan, zoom과 resize는 DTO geometry를 재계산하지 않고 동일 data transform만
다시 적용한다.

frontend는 pack version, exact 240 lengths, int16/reason blob 길이, provenance와 stale identity를
검증한다. hover는 factor metadata로 raw를 역변환한다. text overlay는 실제 `plot.left`,
`plot.right`, `plot.bottom`에서 inset을 계산하여 가격축·시간축 바깥에 놓고, 배경이나 hit-test
surface를 만들지 않는다. stale 또는 inputDigest mismatch이면 Field와 hover를 현재 candle 위에
표시하지 않는다.

H-Line/Trend toggle은 해당 Field branch와 managed drawing만 숨긴다. Shared는 유지한다.
`czardas-managed` drawing은 system actor만 만들 수 있다. 첫 사용자 편집은 user-owned copy와
session suppression을 하나의 transaction으로 만들며 서버에는 저장하지 않는다.

## 14. Asset API와 저장

```text
GET    /api/charts/czardas-assets?symbol=AAPL
POST   /api/charts/czardas-assets/build
GET    /api/charts/czardas-assets/build/{cza-job-id}
POST   /api/charts/czardas-assets/build/{cza-job-id}/cancel
DELETE /api/charts/czardas-assets?symbol=AAPL&interval=1D
```

build body는 한 symbol×interval만 받는다. GET은 PostgreSQL과 read-only candle identity만 읽고
repair, kernel, enqueue 또는 write를 하지 않는다. freshness는
`current | stale | missing | incompatible`다. v1 asset은 incompatible이며 자동 변환·fallback
또는 자동 rebuild하지 않는다.

PostgreSQL에는 deterministic pack content만 저장한다. `generatedAt`은 envelope에만 있다.
build 시작 뒤 source snapshot identity가 바뀌면 pre-commit audit가
`snapshot_changed_during_build`로 write를 거부한다.

## 15. 검증 gate

- 동일 exact-240 100회 content bytes와 digest 동일.
- CandleMeaning/summary/role/mask 길이 240, factor blob 480 bytes, reason blob 960 bytes.
- 오른쪽 in-snapshot 문맥 변경이 앞 candle의 현재 의미를 바꿀 수 있음.
- post-asOf isolation, observed/confirmed time invariant, pending extrema Basis 미생성.
- selected mode→`basisFacts`→episode→interaction closure orphan 0.
- volume-only 변경 전후 Trend channel/Field/geometry/rank bytes 동일.
- 가격 평행이동·양수배, zero ATR/volume, isolated wick, persistent penetration, break/reclaim.
- H-Line `<=4`, Trend `<=3`, drawing `<=7`; no-draw도 240 CandleMeaning 유지.
- Field soft projection deterministic, Field `<=80 KiB`, pack `<=96 KiB`.
- kernel production P95 `<=50ms`, P99 `<=80ms`.
- frontend parse+delta와 Field paint 각각 P95 `<=8ms`.
- pan/zoom/right-empty-space source coordinate 오차 `<=0.5 device pixel`.
