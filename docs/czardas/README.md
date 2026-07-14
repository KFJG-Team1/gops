# Czardas v3

> Czardas는 `asOf`에서 끝나는 canonical 완료봉 240개를 하나의 현재 장면으로 읽고,
> 모든 candle의 통계적·기하학적 의미에서 H-Line과 Trend를 추론하는 GOPS의 유일한 자동 작도 엔진이다.

Czardas는 가격이 어디에서 기억되고(H-Line), 가격의 움직임이 어떤 경계를 만들고 있는지
(Trend)를 찾는다. 두 Trend가 실제로 수렴할 때만 Triangle 관계를 덧붙인다. 이전 Geometry
엔진, 엔진 선택 switch와 fallback은 없다. Czardas asset이 없으면 기본 차트가 자동 작도
없이 정상 동작한다.

## 1. 현재 장면을 보는 시선

`PresentSnapshotContract`는 과거 판단을 재생하지 않는다.

- 입력은 `asOf`를 포함하는 최신 완료봉 정확히 240개다.
- Czardas는 240개를 동시에 보고 각 과거 candle의 **현재적 의미**를 다시 평가한다.
- snapshot 내부의 뒤쪽 봉은 앞쪽 봉의 confirmation, response와 현재 의미에 사용할 수 있다.
- live candle과 `asOf` 이후 데이터는 inference, Sight, 설명과 provenance에 들어가지 않는다.
- 새 완료봉이나 correction으로 snapshot이 바뀌면 과거 candle의 의미와 선도 바뀔 수 있다.
- 순서는 extrema 확인, episode 분리, break/reclaim 같은 시장 사실에만 사용한다.

`observedAt`은 사실이 발생한 봉, `confirmedAt`은 필요한 오른쪽 문맥이 완성된 봉이다.
둘은 당시 Czardas의 판단 시점이 아니다. 우측 문맥이 부족한 extrema는 hover에
`confirmation_pending`으로 남지만 Basis로 승격하지 않는다.

## 2. 한 점수가 아닌 세 관점

Czardas는 모든 240봉을 세 채널로 해석한다.

| 채널 | Czardas의 질문 | 대표 근거 |
| --- | --- | --- |
| Shared | 이 봉의 형태와 주변 관계가 얼마나 두드러지는가? | ATR 대비 range/return, body/wick, R2/R5/R13 주변 관계 |
| H-Line | 이 봉이 support/resistance 가격 기억을 얼마나 설명하는가? | 끝점, rejection, volume participation, proximity, penetration, reclaim |
| Trend | 이 봉이 lower/upper 이동 경계를 얼마나 설명하는가? | 다중 반경 끝점, 구조 scale, residual, alignment, penetration |

21개 factor는 raw 값, robust-normalized 값, availability와 reason을 가진다. 준비되지 않은
ATR·volume·confirmation은 0으로 위장하지 않는다. Shared summary는 사용 가능한 factor의
RMS, H-Line은 `max(support,resistance)`, Trend는 `max(lower,upper)`다.

세 summary 합의 snapshot 내 percentile은 화면에서 `240봉 내 전체 의미 백분위`로만 사용한다.
이는 확률, 예측, 매수·매도 점수가 아니며 inference로 되먹임되지 않는다.

### 통계적 신뢰

- OHLCV는 kernel 경계에서 decimal 8자리 `ROUND_HALF_EVEN`으로 양자화된다.
- factor scale은 `max(1.4826×MAD, semanticFloor)`다. 미세한 노이즈가 0/1 극단으로
  증폭되지 않도록 일반 factor floor는 `0.001`, volume rank는 `0.025`다.
- ATR14 준비 전 13봉도 geometry에서는 첫 Wilder seed를 사용한다. 실제 zero range에서만
  effective tick을 쓴다.
- integrity의 recency weight는 합이 1인 capped simplex다. wick 손실은 최대 `0.25`이고,
  body와 close의 지속 침투는 더 엄격하게 평가한다.
- `effectiveFactCount`와 `integrityCoverage`를 노출하지만 v3에서는 rank나 hard gate를
  추가로 바꾸지 않는다.

## 3. H-Line, Trend와 Triangle

### H-Line — 가격 기억

support/resistance Basis의 가격 corridor를 exact interval sweep해 실제로 연결된 response
ridge를 찾는다. 빈 가격 gap 건너편 ridge는 서로 경쟁하지 않는다. 같은 시장 시험에 속한
Basis는 FormationEpisode 하나로 압축하고, 독립 episode 둘 이상이 겹친 mode만 weighted
median/MAD로 정교화한다.

모든 240봉은 최종 경계의 integrity와 relation 평가에 참여한다. 고립된 wick 돌출은 제한적으로
허용하지만 body/close 수용은 강하게 감점한다. 48-bin estimated profile은 동일 OHLCV로 만들며
이미 성립한 H-Line rank에만 최대 `0.05`를 보강한다. 거래량만으로 선을 만들거나 hard gate를
우회할 수 없다.

### Trend — 이동 경계

lower/upper Basis를 240봉의 세 시간 구간에서 방향별 각 구간 최대 4개, 전체 최대 12개
anchor로 고른다. sparse hypothesis를 weighted L∞ mode와 medoid로 압축한 뒤, episode의
`contributionIndex + contributionPrice` 쌍으로 slope·residual·corridor를 계산한다.
intercept는 episode anchor Huber loss와 deterministic tie-break만으로 고르고 all-240
integrity는 최종 probe에서 한 번 계산한다.

lower와 upper는 독립적으로 찾는다. 수렴, 평행, 발산 모두 유효하고 Triangle을 만들기 위해
geometry를 비틀거나 개수를 채우지 않는다. 선택된 두 Trend가 Triangle 조건을 만족할 때만
기존 선을 3px로 강조하고 패턴 이름을 표시한다.

### Formation과 response

Formation과 response는 과거 엔진 상태가 아니라 현재 snapshot에서 같은 evidence를 fit과
사후 반응으로 중복 계산하지 않기 위한 역할 구분이다.

- `initialFormationEpisodeIds`: candidate identity를 정하는 canonical 두 episode.
- `fitEpisodeIds`: 현재 geometry에 사용한 episode.
- `fitEvidenceConfirmedAt`: fit fact의 가장 늦은 confirmation watermark.
- `formed`: formation hard gate를 통과함.
- `response_supported`: fit과 겹치지 않는 이후 interaction이 유효한 반응을 보임.

response bonus는 최대 `0.10`이고 drawing 필수 조건은 아니다. 과거 break는 영구 상태가
아니며, 현재 exact-240 우측 끝의 연속 close break만 current reject fact다.

## 4. Inference와 Sight

```text
Exact-240 -> CzardasInference -> deterministic CzardasSightPack
```

Inference는 CandleMeaning, Basis, mode, candidate, integrity, rank, relation과 provenance를
소유한다. Sight는 Field 압축, drawing style, 한국어 설명과 visual grammar를 소유한다.
표현만 바꾸면 `sightProjectionVersion`과 `sightProjectionId`만 바뀌고 `inferenceId`는
바뀌지 않는다. LLM은 어느 단계에도 참여하지 않는다.

기본 Czardas canvas는 `czardas-sight-v2`의 세 문법만 사용한다.

- 확대: candle 전체 진하기는 Shared와 표시 중인 Trend의 평균이다. Trend upper/lower를
  candle glyph나 색으로 분리하지 않는다.
- 확대: 고점 resistance와 저점 support는 Shared와 해당 H-Line role을 합친 노란 국소 수평
  흔적이다. 흔적은 timestamp/price에 붙고 총 길이는 최대 36px다.
- 축소: 노란 candle 흔적은 Shared와 켜진 H-Line/Trend 전체 의미다.
- 선택된 H-Line zone과 Trend ribbon. Trend upper/lower ribbon과 Basis는 같은 색이다.
- 선택 derivation의 Basis와 validation.
- managed drawing과 실제 Triangle.

response density, profile, 비선택 mode와 대표 hypothesis는 제한적으로 pack에 남지만 기본
canvas에는 그리지 않는다. H-Line/Trend 두 toggle만 제공하며 Shared는 항상 남는다. 두 toggle
옆의 짧은 범례와 hover는 같은 세 문법을 설명한다.

hover·keyboard focus·tap-lock은 plot 우측 하단의 배경 없는 text overlay를 사용한다.
21개 factor의 raw/normalized 값, 모든 reason, availability와 phase를 생략·접기·스크롤 없이
보여준다. 같은 candle 내부 pointer 이동은 overlay를 다시 만들지 않으며, 전체 overlay는
`aria-live`가 아니다. keyboard/tap-lock에는 별도의 짧은 안내만 제공한다.

`Czardas 해설`은 claim, because, against, invalidation과 data qualifier를 모두 표시한다.
`강도` 대신 `구조 우선순위`를 쓰고 확률·매매 신호가 아님을 명시한다. chart·해설·focus는
`inferenceId + asOf + inputDigest`가 같아야 한다. 선택 drawing은 `Czardas 원본` 또는
`내 수정본`으로 구분한다.

## 5. Identity와 asset

v3 identity는 역할을 분리한다.

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

- algorithm/config: `czardas-v3` / `czardas-config-v3`.
- input contract: `canonical-ohlcv-q8-v1`.
- Field schema: `3`.
- Field hard limit: `80 KiB`; pack hard limit: `96 KiB`.
- v2/null identity asset은 보존하지만 `incompatible`이며 자동 fallback하지 않는다.

source of truth는 ClickHouse의 `v2/split/regular/closed` canonical candle이다. 누락 구간은
중립 `CanonicalCandleRepairRunner`가 Alpaca로 보충한 뒤 ClickHouse를 다시 읽는다. exact-240을
만들 수 없으면 기존 successful asset을 유지한다.

개발 단계에서는 자동 build가 없다. chart-open, GET, candle event와 Cron은 job을 만들지
않는다. `작도 자산(개발)` 패널에서 한 번에 정확히 한 symbol×interval만 수동 build/delete한다.
모든 로그인 사용자가 공용 asset을 조작할 수 있지만 status/cancel은 제출자만 볼 수 있다.

```text
GET    /api/charts/czardas-assets?symbol=AAPL[&interval=1D]
POST   /api/charts/czardas-assets/build          (Idempotency-Key 필수)
GET    /api/charts/czardas-assets/build/{cza-job-id}
POST   /api/charts/czardas-assets/build/{cza-job-id}/cancel
DELETE /api/charts/czardas-assets?symbol=AAPL&interval=1D
```

freshness는 `current|stale|missing|incompatible`, 이유는 `identity_match|input_changed|
identity_unavailable|asset_missing|contract_incompatible`다. candle API가 전달한
`canonicalSnapshot`을 frontend가 pack identity와 비교하며 브라우저에서 Python digest를
재구현하지 않는다. stale/digest mismatch면 Field, hover와 해설을 현재 inference처럼
표시하지 않는다.

## 6. Offline 평가와 한계

runtime historical replay는 없다. offline evaluator가 각 historical `asOf`마다 독립 exact-240을
구성하고 future rows는 결과 평가에만 쓴다. drift, Field churn, contact/reclaim/penetration,
marginal information, response/profile/volume/recency/multi-radius ablation, simple pivot baseline,
output/search/bytes/latency를 보고한다. evaluator는 threshold를 자동 조정하거나 asset을 저장하지
않는다.

Czardas는 240봉 밖의 장기 구조, 실제 체결별 Volume Profile, 주문장, 뉴스와 fundamental을
모른다. 특정 종목 한 사례에 맞춰 threshold를 조정하지 않는다. 현재 범위는 H-Line, Trend와
파생 Triangle이며 MA120, 추가 detector, preset, Agent typed reference와 자동 freshness는
포함하지 않는다.

## 문서

1. 이 문서: 제품 관점과 사용자 경험.
2. [ENGINE_SPEC.md](ENGINE_SPEC.md): 수학, 자료구조, wire와 운영 계약.
3. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): 구현 경계와 검증 gate.
