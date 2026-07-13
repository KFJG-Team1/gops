# Czardas

> Czardas는 `asOf`에서 끝나는 최신 완료봉 240개를 하나의 현재 장면으로 읽고,
> 모든 candle의 통계적·기하학적 의미에서 H-Line과 Trend를 추론하는 GOPS의 자동 작도 엔진이다.

Czardas는 GOPS의 유일한 자동 작도 엔진이다. 이전 자동 작도 엔진, 엔진 선택 switch와
fallback은 없다. Czardas asset이 없거나 사용할 수 없으면 기본 차트는 자동 작도 없이
정상 동작한다.

현재 산출물은 H-Line, Trend와 선택된 두 Trend의 파생 Triangle 관계다. 제안은 모든
사용자에게 동일하게 전달된다. 사용자는 선을 편집하거나 삭제할 수 있지만 변경은 browser
session에만 있고 서버에는 저장되지 않는다.

## 1. 현재 관점

Czardas는 과거 시점의 판단을 재생하지 않는다. 입력 전체를 본 **현재 관점**으로 240개
candle을 매번 다시 해석한다. 이 계약을 `PresentSnapshotContract`라고 부른다.

- 입력은 `asOf` candle을 포함하는 canonical 완료봉 정확히 240개다.
- candle 뒤의 봉도 `asOf` 이하라면 그 candle의 현재 의미와 반응을 해석하는 데 쓸 수 있다.
- live candle과 `asOf` 이후 데이터는 feature, evidence, Field, drawing, 설명에 들어가지 않는다.
- 새 완료봉이나 correction으로 snapshot이 바뀌면 과거 candle의 의미와 선도 바뀔 수 있다.
- candle 순서는 extrema 확인, episode 분리, break와 response 같은 시장 사실의 순서에만 쓴다.

`observedAt`은 사실이 발생한 candle이고 `confirmedAt`은 필요한 오른쪽 문맥이 snapshot 안에서
완성된 candle이다. 두 값은 당시 Czardas의 판단 시각이 아니다. 구조적 fact는 항상
`observedAt <= confirmedAt <= asOf`다. 오른쪽 문맥이 부족한 끝단 extrema는
`confirmation_pending`으로 설명할 수 있지만 RoleBasis로 승격하지 않는다.

## 2. 모든 candle을 보는 세 관점

Czardas는 하나의 만능 점수로 candle을 서열화하지 않는다. 240개 모든 candle에 다음 세
채널의 현재 의미가 있다.

| 채널 | 질문 | 현재 구현의 factor |
| --- | --- | --- |
| Shared | 이 candle의 형태와 주변 관계가 얼마나 두드러지는가? | `rangeAtr`, `absoluteReturnAtr`, body/lower-wick/upper-wick fraction, local high/low `R2/R5/R13` |
| H-Line | support/resistance 가격 기억과 현재 선택 경계를 얼마나 설명하는가? | volume rank/z/participation, support/resistance proximity, H-Line penetration, reclaim |
| Trend | lower/upper 구조와 현재 선택 경계를 얼마나 설명하는가? | local high/low `R2/R5/R13`, lower/upper residual, Trend penetration, reclaim |

ATR14, trailing volume20 또는 오른쪽 confirmation이 준비되지 않은 값은 0으로 위장하지 않는다.
factor는 `null`과 availability/reason을 가지며, 사용 가능한 Shared factor만 Shared RMS의 분모에
들어간다.

pre-Field reason은 candle의 두드러진 관측을 설명하는 표시 근거다. 그 candle이 실제
RoleBasis로 승격된 경우에만 방향별 `geometry_input` reason을 추가한다. 선택된 H-Line/Trend
역할 경계가 없어 relation factor가 null이면 `*_boundary_unavailable` reason으로 명시한다.

### pre-Field 의미

각 raw factor는 exact-240 안에서 median/MAD로 robust-normalize된다. 다중 반경 local 값은
`R2/R5/R13` normalized 값의 RMS다. 현재 역할값은 다음 가중식으로 계산한다.

```text
support pre   = .40 localLow  + .20 lowerWick + .15 range + .15 absReturn
resistance pre= .40 localHigh + .20 upperWick + .15 range + .15 absReturn

volume available:   clamp(pre + .10 participation)
volume unavailable: clamp(pre / .90)

lower pre = clamp(.55 localLow  + .20 lowerWick + .15 range + .10 absReturn)
upper pre = clamp(.55 localHigh + .20 upperWick + .15 range + .10 absReturn)
```

이 역할값은 단순 표시 전용이 아니다. confirmed extrema가 RoleBasis가 될 때 구조적 mass의
20%로 실제 seed 추론에 참여한다. H-Line은 participation이 기존 구조 mass를 `0.90..1.00`
범위에서만 조정한다. 거래량만으로 Basis나 선을 만들 수 없다. Trend의 pre-Field, geometry,
Field와 rank는 volume-only 변경 전후 동일해야 한다.

### selected-boundary 관계

선택이 끝나면 240개 각 candle과 현재 선택 경계의 관계를 다시 계산한다.

- H-Line: support/resistance proximity, body penetration과 wick 뒤 유효 종가 reclaim.
- Trend: lower/upper endpoint residual, body penetration과 wick 뒤 유효 종가 reclaim.
- H-Line 역할값은 `0.65 × pre + 0.35 × proximity`로 갱신한다.
- Trend 역할값은 `0.65 × pre + 0.35 × exp(-residualAtr)`로 갱신한다.
- Shared는 바뀌지 않는다. integrity와 response에 실제 사용된 candle은 phase/reason으로 표시한다.

최종 H-Line summary는 `max(support, resistance)`, Trend summary는 `max(lower, upper)`다.
Composite는 `Shared + H-Line + Trend` 합의 snapshot 내부 midrank percentile이다. 화면에서는
`상대 의미도`로 표시하며, exact-240 안에서의 상대 위치일 뿐 확률, 예측, 매수·매도 점수가
아니고 추론에도 되먹임되지 않는다.

## 3. H-Line과 Trend

```text
Exact-240 Snapshot
  -> FeatureTape
  -> pre-Field CandleMeaningTape
  -> confirmed RoleBasis
  -> static H-Line / Trend modes
  -> current robust candidates
  -> all-candle integrity/relation + final CandleMeaningTape
  -> selection / Triangle / Drawing
  -> bounded FieldView
```

### H-Line: Price Memory

support/resistance RoleBasis의 가격 corridor를 exact interval sweep해 1차원 response ridge를
찾는다. 같은 시장 시험에 속한 여러 Basis는 FormationEpisode 하나로 압축한다. 서로 독립된
episode 두 개 이상이 겹치는 mode만 weighted median/MAD로 center와 zone을 정교화한다.

모든 240봉은 최종 경계 주변 integrity에 참여한다. wick, body, close 침투는 강도를 다르게
반영하고 한 candle의 영향은 제한한다. 최신 두 종가가 경계 반대편으로 각각 `0.25 ATR`보다
깊게 닫히면 current open break로 후보를 거부한다.

별도 Volume Profile API를 호출하지 않는다. 동일한 240개 OHLCV로 48-bin estimated
price-volume profile을 만들고, 이미 hard gate를 통과한 H-Line rank에만 최대 `0.05`를 더한다.

### Trend: Moving Boundary

confirmed lower/upper RoleBasis를 240봉의 세 시간 구간에서 각 최대 4개, 방향별 전체 최대
12개 anchor로 고른다. 최소 12봉 떨어진 pair가 최대 66개 hypothesis를 만든다. weighted
L-infinity grouping과 medoid, weighted pair-slope median, one-sided intercept scan으로 현재
경계를 맞춘다. 기울기 방향은 강제하지 않는다.

lower와 upper는 독립적으로 찾는다. 수렴, 평행, 발산 모두 유효하며 Triangle을 만들기 위해
선을 비틀거나 순위를 바꾸지 않는다.

### Formation, response와 break

Formation과 response는 과거 엔진 상태가 아니라 현재 snapshot에서 fit evidence를 평가
evidence로 다시 세지 않기 위한 역할 구분이다.

- `initialFormationEpisodeIds`: candidate identity를 정하는 canonical 두 episode.
- `fitEpisodeIds`: 현재 geometry에 실제 사용한 episode.
- `fitEvidenceConfirmedAt`: fit episode의 가장 늦은 확인 시각인 사실 watermark.
- `formed`: formation과 integrity hard gate를 통과함.
- `response_supported`: watermark 다음 봉부터 시작한 독립 interaction이 response gate를 통과함.

interaction은 contact 뒤 formation span에 따라 3/5/8봉을 본다. horizon이 `asOf`를 넘으면
`response_pending`이다. 그렇지 않으면 excursion, acceptance, wick exploration과 reclaim
속도로 response score를 만들고 `neutral_response` 또는 `supported_response`로 분류한다.
interaction 중 반대편 `0.25 ATR` 초과 close가 두 봉 연속이면 `confirmed_break`다.

지원 response는 rank를 최대 `0.10` 보강하지만 drawing 필수 조건은 아니다. 예전 break는
영구 `broken` 상태가 아니다. 현재 후보 거부는 exact-240 우측 끝의 open break로 판단하며,
과거 wick 탐색 뒤 유효 종가 복귀는 candle의 reclaim relation으로 남는다.

## 4. 출력과 차트

| layer | 실제 출력 | 기본 목표 | 기본 두께 |
| --- | ---: | ---: | ---: |
| H-Line | 0~4개 | 2개 | 2px |
| Trend | 0~3개 | lower 1 + upper 1 | 2px |

근거가 부족하면 목표 개수를 억지로 채우지 않는다. 선택 뒤 upper/lower Trend pair가 Triangle
조건을 만족하면 기존 두 Trend를 3px로 강조하고 우측 상단에 ascending, descending 또는
symmetrical 이름을 한 번 표시한다. Triangle은 별도 detector나 layer가 아니다.

`czardas` chart type은 현재 exact-240을 읽은 근거를 보여준다.

- Shared는 candle 명도를 조절한다.
- H-Line 의미는 둥근 capsule/corridor, Trend 의미는 각진 diamond/chevron으로 표시한다.
- 조밀한 zoom에서는 두 branch가 보일 때 per-role 장식을 Composite percentile로 축약한다.
  branch toggle이 꺼지면 Shared와 현재 보이는 branch만 다시 합성해 숨긴 의미가 명도에 남지 않게 한다.
- hover, keyboard focus와 mobile tap-lock은 plot 우측 하단에 `현재 240봉 기준` 전봉 해석
  텍스트 overlay를 표시한다.
- overlay는 카드, 접기와 스크롤 없이 상대 의미도, 세 summary, 역할값, 21개 raw/normalized
  factor, availability, phase와 모든 reason을 항상 보여준다.
- overlay의 좌우·하단 inset은 실제 plot 경계에서 계산하므로 가변 가격축과 시간축을 침범하지
  않는다. 좁은 panel에서는 정보를 생략하지 않고 글자 간격을 줄이며 아래에서 위로 확장한다.
- H-Line/Trend toggle은 해당 branch와 drawing만 숨기며 Shared 의미는 남긴다.

candle, Basis, Trend, validation은 `timestamp + price` data-space다. H-Line response와 zone은
exact-240의 `windowFromTimestamp..windowToTimestamp`에 clip한다. hover text overlay와 badge만
screen-space다.
따라서 pan/zoom 때 근거와 managed drawing은 같은 `timestampToX/priceToY` 변환으로 움직인다.

## 5. Field와 설명 가능성

Field schema 2의 `candleMeanings`는 compact SoA다.

- summary와 role은 scale 1000의 240개 integer array다.
- raw/normalized factor는 factor마다 240개 signed int16 big-endian을 base64로 저장한다.
- raw는 v2에서 1000으로 잠근 factor별 scale과 `linear | log1p` transform을 가진다. frontend는
  이 metadata를 검증한 뒤 역변환한다.
- `-32768`은 null sentinel이고 범위 초과는 clamp하지 않고 build를 실패시킨다.
- availability/phase는 240개 bitmask array다.
- reason은 candle마다 uint32 bitmask 하나를 big-endian base64로 저장한 `reasonMasks`와 최대
  32개 codebook이다.

선택된 derivation closure는 다음을 필수로 보존한다.

- `basisFacts`: 선택 mode와 fit episode가 참조하는 Basis의 compact SoA.
- 선택 mode의 `contributorBasisIndexes`: `basisFacts`를 가리키는 전 contributor index.
- `derivationEpisodes.candidateEpisodeOrdinals`: 각 flattened episode를 해당 candidate의
  `fitEpisodeIds` ordinal에 연결한다.
- `contributionBasisIndexes`, `memberBasisIndexes`, selected mode refs와 validation facts.

`basisGlyphs`는 화면용 대표 subset이며 optional이다. 생략되어도 `basisFacts`와 index closure로
선택 선의 유도 관계를 복원할 수 있어야 한다. profile, response segment, 비선택 mode와 대표
hypothesis도 budget에 따라 줄일 수 있다.

- Field soft target: `76 KiB` (`77,824` bytes).
- Field hard limit: `80 KiB` (`81,920` bytes).
- 전체 pack hard limit: `96 KiB` (`98,304` bytes).

필수 bundle이 hard limit을 넘으면 partial pack을 저장하지 않고 build를 실패시킨다.

한 inference의 identity는 다음과 같다.

```text
inferenceId = hash(
  algorithmVersion, configVersion, timeContractVersion, calendarVersion,
  symbol, interval, asOf, inputDigest
)
```

mode는 current contributor와 geometry의 `derivationDigest`를 가진다. candidate와 drawing은
`sourceInferenceId`, `sourceCandidateId`, `sourceFieldModeId`,
`sourceFieldDerivationDigest`로 같은 pack의 근거를 역추적한다. revision/history field는 없다.

## 6. 데이터와 asset lifecycle

- source of truth: ClickHouse의 split-adjusted, regular-session, closed canonical candle.
- interval: `1m/5m/10m/1h/4h/1D/1W`; 모든 interval exact-240.
- `1W`: canonical `1D` 최대 1,300개를 NYSE session 기준으로 집계.
- 시간: UTC millisecond `Z`, `[start,end)`, `America/New_York`, code-owned NYSE calendar.
- transport가 live 최대 한 개를 함께 받아도 kernel에는 완료봉 240개만 전달한다.

canonical key가 빠졌으면 `CanonicalCandleRepairRunner`가 missing range를 Alpaca에서 보충하고
ClickHouse canonical 데이터를 다시 읽는다. exact-240을 만들 수 없으면 `Unavailable`이며 기존
성공 asset을 덮어쓰지 않는다. 자동 갱신은 없고 개발 패널에서 한 symbol×interval을 수동
분석·삭제한다.

```text
GET    /api/charts/czardas-assets?symbol=AAPL
POST   /api/charts/czardas-assets/build
GET    /api/charts/czardas-assets/build/{cza-job-id}
POST   /api/charts/czardas-assets/build/{cza-job-id}/cancel
DELETE /api/charts/czardas-assets?symbol=AAPL&interval=1D
```

GET은 mutation-free다. asset은 `current | stale | missing | incompatible`다. v1은 incompatible이고
자동 fallback하지 않는다. stale 또는 input-digest mismatch에서는 과거 Field와 hover를 현재
candle 위에 표시하지 않는다. 서버는 deterministic pack content만 PostgreSQL에 저장하고
`generatedAt`은 API envelope에만 둔다.

## 7. 강점과 한계

Czardas의 강점은 exact-240 고정 비용, 설명 가능한 통계·기하 구조, robust candidate fitting,
전봉 현재 해석과 결정론이다. 선, Field와 hover가 같은 source fact를 공유하므로 detector와
표현 문제를 구분해 진단할 수 있다.

한계는 240봉 바깥의 장기 구조와 주문장·뉴스·fundamental을 모른다는 점이다. OHLCV estimated
profile은 실제 체결별 Volume Profile이 아니다. Composite와 rank는 예측 확률이나 매매 신호가
아니다. 특정 종목 한 사례에 맞춰 threshold를 조정하지 않는다.

현재 범위에는 MA120, 다른 indicator detector, 선형회귀 pattern 확장, 자동 build, Cron과 AWS
배포가 없다.

## 문서

1. 이 문서: 제품 관점과 사용자 경험.
2. [ENGINE_SPEC.md](ENGINE_SPEC.md): 실제 수학, 자료구조와 wire 계약.
3. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): 구현 경계, 검증 순서와 gate.
