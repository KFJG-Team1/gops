# czardas v1 Engine Specification

## 문서의 지위

이 문서는 czardas v1 구현의 단일 규격이다. Codex는 엔진, API, 저장, 프런트
작도 수명주기를 변경하기 전에 이 문서를 읽고, 구현과 계약이 달라지면 같은 변경에서
이 문서를 갱신한다.

- 상태: 구현 승인 전 기준안, 모든 v1 선택은 결정됨
- 동결한 구현 기준점: `16e0fa5` (원격 `dev` 병합은 czardas 구현 완료 뒤 별도 단계)
- 엔진 버전: `czardas-v1`
- 초기 설정 버전: `czardas-config-v1`
- 상위 소개: [README.md](README.md)
- 구현 순서: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

`CHART_ANALYSIS_ASSETS.md`와 `CHART_ANALYSIS_ASSETS_CODEX.md`는 현재 Geometry
구현의 사실을 설명한다. 이 문서는 그 구현을 대체할 목표 계약이다. rollout 전까지
목표 계약을 이미 배포된 동작으로 오해하지 않는다.

## 1. 제품 명제

czardas는 candle에 점수를 찍거나 선을 많이 그리는 엔진이 아니다. 최신 OHLCV의
역할별 Basis가 만든 bounded 통계·기하 Hypothesis Field에서 안정된 ridge와 mode를 찾고,
그 경계가 만들어진 뒤의 독립 반응으로 힘을 검증한 다음, 설명 가능한 소수의 편집 가능한
작도만 제시한다.

v1은 두 종류만 `Boundary`로 생성한다.

- H-Line: 같은 가격대에서 반복된 반응인 **Price Memory**
- Trend: 시간에 따라 이동하는 상·하단 경계인 **Moving Boundary**

Triangle은 Boundary가 아니라 선택된 upper/lower Trend 사이의 **Compression relation**이다.
별도 선을 생성하지 않고 두 Trend의 geometry, identity, 선택 결과를 바꾸지 않는다.

선의 개수는 품질 지표가 아니다. 근거가 부족하면 `no-draw`가 정상 결과다.

v1과 이후 확장은 다음 단방향 의미 흐름을 보존한다.

```text
Candle Fact -> Role Basis -> Statistical-Geometric Hypothesis Field
             -> Ridge / Mode -> Boundary -> Interaction / Selection
             -> Relation / Drawing
```

- 앞 단계의 관측 fact 없이 뒤 단계의 label을 만들지 않는다.
- Hypothesis Field는 candidate 선택 전 detector가 실제로 읽는 immutable intermediate다.
- geometry, strength, presentation을 서로 다른 단계로 유지한다.
- relation은 constituent Boundary를 refit, 승격, 탈락시키지 않는다.
- production Field view는 이 intermediate를 bounded 직렬화할 뿐 selected drawing에 맞춰
  다시 만들지 않는다.
- renderer visibility, serialization cap, hover와 style은 kernel Field나 selection에
  feedback하지 않는다.
- 후속 선형회귀·pattern family도 candle에 label을 바로 붙이지 않고 parameter-space
  hypothesis와 mode를 먼저 만들어야 하며, 그 근거가 Czardas chart에 pre-selection Field로
  보이지 않으면 Czardas detector로 받아들이지 않는다.

## 2. 고정된 v1 결정

| 항목 | v1 계약 |
| --- | --- |
| authoritative runtime | Python 3.12 pure kernel |
| 커널 위치 | `systems/market-data/shared/alfaka/analytics/czardas/` |
| 계산 방식 | latest completed snapshot 전체의 bounded full rebuild |
| 계산 시점 | 인증된 `작도 자산(개발)` 패널의 symbol×interval 1쌍 수동 `분석·저장` |
| 분석 범위 | 모든 지원 interval에서 최신 완료봉 240개 |
| 가격 공간 | linear price / integer bar index |
| 입력 | canonical, regular-session, split-adjusted, completed OHLCV |
| 지원 interval | `1m/5m/10m/1h/4h/1D/1W` |
| H-Line | role Basis가 만든 1D Price-Memory Field ridge + weighted median/MAD refinement |
| Trend | sparse dual-line Hypothesis Field mode + weighted Theil–Sen/one-sided refinement |
| Triangle | 선택된 formed upper/lower Trend의 read-only 사후 관계 판정 |
| 확인 | formation 2회는 hard gate, 이후 verification은 rank·설명 보조 |
| 표시 layer | H-Line과 Trend 두 개, 각각 독립 on/off, 기본 on |
| H-Line 개수 | 설정 1~4개, 기본 목표 2개, formed 후보가 없으면 0개 |
| Trend 개수 | 설정 1~3개, 기본 목표 lower 1 + upper 1 |
| Triangle 표시 | 선택된 Trend 두 선을 3px로 강조하고 plot 우측 상단에 이름 1개 표시 |
| 선 두께 | 편집 UI는 1px/2px/3px, 일반 czardas 선 기본 2px |
| chart type | 기존 `candle/line/ohlc/bidask`에 `czardas`를 추가, UI label `Czardas` |
| Czardas Field | pre-selection Basis·ridge·mode를 같은 ready pack으로 직렬화한 inference view |
| 저장 | ClickHouse candle truth, PostgreSQL pair별 latest shared asset; 수동 upsert/delete |
| 프런트 | stable-ID delta, 편집은 현재 ChartDocument 메모리에만 존재 |
| 지표 | MA120 포함 MA/EMA/WMA/BB/RSI/Stochastic/MACD는 v1 전체 추론에서 미사용 |

v1은 Web Worker, TypeScript 추론 커널, 증분 상태, Redis/S3/Kafka 기반 czardas
자산 경로를 만들지 않는다. P95 성능 게이트를 넘지 못할 때에만 Worker/WASM 또는
증분 커널을 검토한다.

Segment Tree, R-Tree, dense Hough Transform, KDE, random RANSAC도 v1 hot path에 넣지 않는다.
최대 240봉, evidence 48개, Trend anchor 12개에서는 정렬 배열, prefix feature,
exact interval sweep, 최대 66개 sparse line hypothesis와 endpoint-space mode grouping이
더 작고 결정론적이다. 데이터 규모나 도형 자유도가 실제로 커질 때 측정 근거와 함께
도입한다.

## 3. 용어와 시간 안전성

### 3.1 핵심 시간

- `asOf`: 입력에 포함된 가장 최근 완료봉의 canonical `timestamp`, UTC millisecond `Z`.
  계산 실행 시각이나 실제 session close instant가 아니다.
- `lastCandleKey`: 같은 봉의 logical key. intraday는 UTC bucket start, `1D`는 NYSE
  session date, `1W`는 market week의 Monday date다.
- `observedAt`: 사실이 발생한 봉.
- `confirmedAt`: 그 사실을 확정하는 데 필요한 미래 봉까지 모두 닫힌 시점.
- `lineageFormedAt`: 최초 revision이 처음 formed가 된 시점. drawing 생성 시각으로 고정.
- `revisionFormedAt`: 현재 revision을 만들기 위해 사용한 fit evidence와 refit admission
  fact가 모두 알려진 시점.
- `contactAt`: 고정된 경계와 독립 interaction이 시작된 시점.

모든 이름이 `*At`인 engine/DTO field는 해당 candle의 canonical `timestamp`를 UTC
millisecond `Z`로 운반한다. `confirmedAt`도 확인 봉의 timestamp이지 wall-clock 계산 시각이나
session close instant가 아니다. logical identity가 필요한 곳은 `sourceCandleKey`,
`indexOriginCandleKey`, `firstContactCandleKey`, `lastCandleKey`처럼 `*CandleKey`를 별도로 쓴다.
따라서 `1D/1W`의 `*At`을 date string으로 구현하거나 intraday bar index를 timestamp 대신
저장하지 않는다. session/date/week 의미는 대응 candleKey와 `MarketTimeContract`로 해석한다.

가장 중요한 누수 방지 규칙은 다음과 같다.

```text
revisionFormedAt(modelRevision) =
  max(
    confirmedAt of every fit episode used by that revision,
    leaveAt of any neutral interaction required to admit the refit
  )
```

`contactAt <= revisionFormedAt`인 episode는 그 revision의 verification이 될 수 없다.
선을 만든 episode를 그 선의 힘으로 다시 세지 않는다.
수식과 transport 모두 두 시각을 명시적으로 구분한다.

### 3.1.1 `MarketTimeContract`

시간대는 계산 환경의 부수 설정이 아니라 input identity다. builder 시작 때 다음 frozen
value를 한 번 만들고 audit, repair, aggregation, CandleTape와 digest에 동일하게 전달한다.

```text
MarketTimeContract = {
  version,
  instantZone: "UTC",
  marketZone: "America/New_York",
  sessionPolicy: "us-equity-regular",
  calendarVersion,
  rangeSemantics: "half-open"
}
```

- DB `TIMESTAMPTZ`, wire instant, repair range와 비교는 UTC millisecond `Z`다.
- 모든 query/repair range는 `[start,end)`다. inclusive `to` helper를 그대로 사용하지 않고
  candleKey set으로 경계 중복·누락을 재검증한다.
- 미국 정규장, 휴장, 조기폐장과 DST는 `America/New_York` IANA `ZoneInfo`와 같은
  `TradingCalendar`가 결정한다. fixed `UTC-5/UTC-4` 계산은 금지한다.
- intraday `candleKey`는 UTC session-aligned bucket start, `1D`는 NYSE session date,
  `1W`는 그 시장 주의 Monday key다. higher-timeframe 완료는 마지막 실제 session close다.
- `Asia/Seoul`과 browser timezone은 panel/label 표시 전용이다. identity, completion,
  ordering, digest와 drawing anchor를 바꾸지 않는다.
- naive datetime과 server-local timezone은 public/shared boundary에서 거부한다.
- `timeContractVersion|calendarVersion`은 config digest와 pack에 포함한다. 달력 계약이
  달라진 row는 같은 input으로 취급하지 않는다.

### 3.2 증거 역할

- `initialFormationEpisodeIds`: candidate ID를 정하는 서로 분리된 최초 두 episode. 정확히
  2개이며 lineage 수명 동안 불변이다.
- `fitEpisodeIds`: 현재 revision geometry에 실제 사용한 전체 episode. initial 두 개를
  포함하고 2개 이상이다.
- `verification`: `revisionFormedAt` 뒤 formed boundary를 시험한 새 hold/rejection episode.
- `violation`: formed boundary를 통과하거나 무효화한 episode.

observed domain, persistence, response horizon, seedQuality는 current fit set을 기준으로
계산한다. 같은 episode를 같은 revision의 fit과 verification에 동시에 세지 않는다.

refit은 아직 `formed`이고 verification이 0이며 pending Interaction이 하나도 없는
candidate에만 허용한다. 늦게 confirmed된 compatible evidence의 `observedAt`이 old
`revisionFormedAt` 뒤라면 confirmed 시점에 새 contact를 만들지 않는다. 해당 source
candle을 포함해 old revision이 이미 기록한 Interaction을 찾아 그 terminal fact를
refit admission에 사용한다.

여기서 source candle을 포함한다는 뜻은 `contactAt <= observedAt <= episodeEnd`다.
`episodeEnd`는 reset했으면 `leaveAt`, break면 `terminalAt`, 아직 pending/latched면 현재
prefix다. revision당 active episode가 하나이므로 여러 event 중 임의로 고르는 분기는 없다.
해당 구간이 없으면 contact-free다.

- `pending`: 보류.
- `neutral` 또는 contact 없음: 새 fit이 hard gate를 통과하고 `(seedQuality, integrity)`가
  기존 값보다 사전식으로 커질 때만 refit commit.
- `hold/reject`: 기존 candidate를 `verified`로 고정하고 그 evidence는 interaction으로만
  남긴다.
- `break`: candidate를 `broken`으로 끝내고 refit하지 않는다.

candidate별 refit admission queue는 `(admissionAt, episodeId)`로 안정 정렬한다.
`admissionAt`은 contact-free contribution/scale update면 evidence `confirmedAt`, neutral
Interaction과 연결되면 separation reset의 `leaveAt`이다. neutral terminal 뒤 아직 latched라
`leaveAt`이 없으면 admission도 pending이다. 하나라도 pending Interaction이나 reset-pending
latch가 있으면 compatible evidence와 contribution update를 모두 보류한다.
hold/reject terminal은 즉시 candidate를 verified로, break terminal은 즉시 broken으로
고정하고 queue를 비운다. neutral만 reset을 기다린다. 모든 queued item이 neutral-reset 또는
contact-free로 admission된 prefix에서 change를 current fit set에 누적한 **하나의 proposed revision**으로
평가해 hard gate, 사전식 품질 개선, identity tolerance를 모두 통과할 때 한 번만 commit한다.

새 독립 episode는 fit set에 추가한다. 이미 fit set에 있는 episode의 새 NMS scale 또는
같은 머무름의 새 cluster는 그 `episodeId`의 contribution 교체 proposal이며
`fitEpisodeIds`, independent touch count를 늘리지 않는다. 이 규칙으로 confirmation이 늦은
scale 13 endpoint를 confirmation 시점의 새 시장 시험으로 오해하지 않는다.

verified candidate의 geometry는 이후에도 고정한다. 더 나은 새 geometry는 별도 initial
pair에서 별도 candidate로 경쟁해야 한다. 따라서 verification을 기록하자마자 fit에 흡수해
최종 상태에서 사라지게 하지 않고, geometry와 strength도 이중 가산하지 않는다. POC는 이보다
복잡한 revision 상속이나 null comparison을 구현하지 않는다.

### 3.3 lifecycle

```text
formed ---------> verified
   \                 \
    +---------------> broken -> retired
    +--------------------------> retired
```

- `formed`: 독립 formation episode 2개로 geometry와 무효화 조건이 성립함.
- `verified`: formed 이후 새 hold/rejection interaction이 1개 이상 기록됨.
- `broken`: close-through break 규칙을 만족함.
- `retired`: 분석 구간 밖으로 사라졌거나 새 lineage가 대체함.

lifecycle은 revision 단위다. verification이 없는 `formed` candidate만 3.2의 refit으로
새 `formed` revision을 만들 수 있다. `verified`와 `broken`은 geometry를 더 refit하지
않으므로 한 candidate 안에서 상태가 되돌아가지 않는다.

`isRelevantNow`는 lifecycle이 아닌 **즉시성** boolean이다. formed/verified candidate의
as-of 거리 `<=1 ATR`이거나 최근 8봉 안에 contact가 있으면 true다. 15.1의 더 넓은
`outputRelevance` gate와 구분한다. `pending`도 candidate
lifecycle이 아니라 아직 끝나지 않은 Interaction 상태다.

기본 화면에는 geometry·integrity·현재 관련성 gate를 통과한 `formed`, `verified`가
나온다. verification은 필수 통과 조건이 아니라 rank bonus다. `broken`과
`retired`는 debug에서만 보며 아직 반응이 끝나지 않은 상태는 `pending`이다. identity
tolerance 안의 성공한 refit은 같은 lineage를 유지한다. tolerance 밖 refit은 거부하고,
새 initial pair가 별도 hard gate를 통과할 때만 새 formed candidate가 시작한다.

## 4. 현재 코드와 목표 경계

### 4.1 그대로 유지하는 기반

| 책임 | 현재 기준 코드 | czardas 사용법 |
| --- | --- | --- |
| canonical identity | `alfaka.analytics.analysis_candles` | 완료봉 선택과 digest를 재사용 |
| candle truth | ClickHouse `market_data.chart_candles` | 분석 원본 |
| manual panel | `ChartAssetOpsPanel.tsx`, `assetBuildApi.ts`, `analysisAssetsApi.ts` | Czardas pair build/poll/cancel/delete와 kind-scoped cache로 확장 |
| asset API | `app/routes/chart_assets.py` | 기존 route family에 additive `assetKind=czardas` |
| exact repair | `alfaka.analytics.analysis_repair` | 수동 job의 audit→Alpaca exact range→ClickHouse 재조회 기반 재사용 |
| time/session | `analysis_candles.py`, `session_buckets.py`, `backfill/gapfill.py` | 하나의 frozen MarketTimeContract 아래 공유 |
| estimated profile UX | `alfaka.serving.volume_profile` | 의미만 참고하고 czardas는 별도 API 없이 내부 48-bin 계산 |
| PG job lease | `gops_agents.chart_assets.job_store` | 별도 Czardas table/store에서 `SKIP LOCKED` 패턴 재사용 |
| drawing entity | `apps/chart-engine/src/types.ts`, `commands.ts` | authoritative type/normalizer에 소유권 metadata를 additive 확장 |
| frontend chart adapter | `apps/gops-frontend/src/chart/types.ts` | engine 계약과 같은 metadata를 보존 |
| chart type과 renderer | `apps/chart-engine/src/types.ts`, `commands.ts`, `capabilities.ts`; `PanelContentRenderer.tsx`, `ChartPanel.tsx`, `ChartCanvas.tsx` | 다섯 번째 `czardas` type과 명시적 Field renderer 추가 |
| chart commands | `@gops/chart-engine` | add/update/remove delta로 적용 |

### 4.2 교체하는 부분

| 현재 구현 | 교체 이유 | 목표 |
| --- | --- | --- |
| `analytics/geometry.py`의 고정 pivot H-Line | 생성과 검증이 분리되지 않음 | reaction ridge + independent interaction |
| `analytics/patterns.py`의 OLS Triangle | 독립 Trend가 없고 경계 품질이 약함 | honest upper/lower Trend를 먼저 고른 뒤 관계 판정 |
| SMA60/120 snapshot 결합 | geometry와 indicator 의미가 섞임 | 이번 구현으로 이식하지 않고 OHLCV boundary만 담당 |
| remove-all/add-all 적용 | 선택과 사용자 편집을 잃음 | stable-ID delta + ownership fork |

현재 `geometry_assets`, current Geometry worker와 API 기본 동작은 수동 검증과 rollback을
위해 삭제하지 않는다. `assetKind`를 생략한 기존 caller는 계속 Geometry를 읽는다.

### 4.3 이번 구현에서 명시적으로 하지 않는 것

- MA120을 조회·새로 계산하거나 evidence, fit, rank, gate, explanation, drawing에 사용하지
  않는다. 다른 MA/EMA/WMA/BB/RSI/Stochastic/MACD도 같다.
- 기존 candle API와 chart가 이미 제공하는 `ma` presentation 값은 바꾸지 않는다. 응답에
  함께 있더라도 kernel 입력과 `analysisInputDigest`에는 들어가지 않는다.
- MA120과 candle/H-Line/Trend의 교차·접근, 교점 engine, 알림은 다음 구현에서 논의한다.
- channel, wedge, flag, zone과 공개 화면의 full rejected-candidate debugger를 만들지 않는다.
- 후속 기능을 위한 placeholder detector, nullable contract, config switch를 미리 만들지
  않는다.
- chart open/API miss/새 candle event의 자동 build, S&P500 schedule/CronJob, active-release
  pointer, cross-client push를 만들지 않는다.

ATR14, body/wick, relative volume, 48-bin estimated price-volume은 같은 240개 OHLCV에서
엔진 내부가 파생하는 feature이므로 외부 indicator 입력과 구분한다.

## 5. 전체 데이터 흐름

```text
authenticated panel: 분석·저장(symbol, interval)
        -> PostgreSQL manual job + poll/cancel/log
        -> canonical exact-240 ClickHouse audit
        -> missing keys? bounded Alpaca repair -> ClickHouse materialize
        -> canonical exact-240 re-read + inputDigest
        -> CandleTape / FeatureTape / RoleBasis
        -> PriceMemoryField + sparse TrendHypothesisField
        -> ridge/mode -> Boundary -> Interaction -> selector
        -> Triangle relation + drawing compiler + bounded FieldView
        -> validate -> PostgreSQL pair latest CzardasPack upsert

GET /api/charts/analysis-assets?assetKind=czardas&symbol=...
        -> read-only latest pack or null; build enqueue 없음
        -> every user receives the same stored proposal
```

Python kernel은 manual builder와 fixture evaluator가 공유한다. panel job만 repair, inference와
asset write를 수행한다. GET/chart open/candle event/focus/reconnect는 job을 만들지 않는다.
Field inference는 Python kernel 안에서 실행하고 FieldView도 같은 typed state에서 만든다.
프런트는 mass, mode, episode와 interaction을 재계산하지 않고 pack 검증, 좌표 투영,
drawing delta와 메모리 편집만 담당한다. live candle은 기존 chart가 계속 그리며
FieldView에서는 unscored 점선 골격으로만 표현한다.

### 5.1 bounded full rebuild의 정확한 의미

full rebuild는 latest snapshot 전체를 한 번에 입력받되 evidence를 과거에서 현재 순으로
공개한다는 뜻이다.

각 bar `t`의 순서는 고정한다.

1. `t` 이전에 formed된 candidate에 새 완료봉 `t`의 interaction/break와 terminal latch reset을
   먼저 적용한다.
2. `confirmedAt==t`인 Role Basis를 stable ID 순서로 공개하고 현재 prefix의 Price-Memory
   Field와 sparse Trend Hypothesis Field를 갱신한다.
3. Field의 ridge/mode를 추출해 공개된 Basis를 candidate의 과거 Interaction과 연결하고
   3.2의 ordered admission queue를 처리한 뒤, 새 candidate를 만들거나 허용된 formed
   candidate refit을 commit한다.
4. `t`에서 새로 생긴 candidate는 `t+1`부터 interaction을 받는다.
5. hold/rejection이 있으면 `verified`, confirmed break면 `broken`이다.
6. 같은 interaction을 fit과 verification에 중복 사용하지 않는다.

extrema/reaction의 `observedAt`이 과거라도 그 candle의 range/contact는 당시 존재하던
candidate의 FSM이 이미 읽었다. evidence가 뒤늦게 confirmed되었다는 이유로 과거 candidate
상태를 소급 생성하지 않는다.

POC는 nearby null, fatigue, 복잡한 revision 상속을 구현하지 않는다. 요청 사이의
incremental inference state도 correctness에 사용하지 않는다. 이 작은 chronological
규칙만으로 세 번째 점까지 먼저 맞춘 뒤 그 점을 검증이라고 부르는 자기확증을 막는다.

## 6. 입력 계약

### 6.1 분석 구간

| interval | 최초 render slot | czardas completed input `C` |
| --- | ---: | ---: |
| `1m`~`1D` | 120 | 240 |
| `1W` | 104 | 240 |

핵심 불변식은 다음 한 줄이다.

```text
manual build canonical snapshot == CandleTape == czardas analysis window == stored pack identity
```

화면에는 최신 120/104봉만 보이지만 client는 latest snapshot `C` 전체를 보관한다.
수동 build도 같은 canonical selection 규칙으로 `C`를 만든다. stored pack은 build 당시
`C`의 `asOf/inputDigest`를 보존하며 이후 chart snapshot과 달라질 수 있다. kernel은 `C`
보다 오래된 candle을 별도로 섞거나 client가 pan으로 누적한 store를 사용하지 않는다.

현재 candle API의 `limit`은 live row도 세므로 frontend initial transport는 최대 241개를
요청해 **latest completed 240 + optional live 1**로 정규화할 수 있다. 이 1개는 분석 문맥이나
reserve가 아니며 CandleTape와 input digest에는 들어가지 않는다. live가 없고 completed가
241개 오면 가장 오래된 한 개를 client context에서도 제거한다.

별도 `reserve`, `evaluationFrom`, `analysisSlice`는 없다. feature마다 필요한 데이터가
준비되는 시점만 다르다.

- ATR14: 최소 14개가 준비된 bar부터 사용.
- 이전 20봉 volume baseline: 20개 과거 봉이 생기기 전에는 `volumeReady=false`와 중립
  `participation=0.5`를 쓴다. volume은 optional H-Line 보조이므로 evidence 생성을 막지 않는다.
- extrema radius `r`: 좌우 `r`개가 있고 오른쪽 봉까지 닫혀 confirmed된 뒤 공개.
- ATR/extrema 준비 전 bar도 가격 문맥과 estimated price-volume histogram에는 참여하지만
  해당 구조 evidence를 만들지는 않는다. volume readiness만은 위 중립값으로 대체한다.

`C=240`은 모든 지원 interval의 단일 v1 계약이다. 현재 화면의 120봉에 같은 크기의 왼쪽
문맥 120봉을 더한다는 뜻이며, 주봉도 별도 숫자를 만들지 않는다. 240봉은 ATR14,
volume20, extrema radius 13, formation span 20, 최대 response horizon 8을 포함하고도
formation과 독립 interaction을 찾을 여유가 있다. 기존 `380/312`는 폐기한 Geometry의
warmup/evaluation 구간을 합친 값에서 왔으므로 reserve가 없는 czardas에 그대로 상속하지
않는다. 더 큰 범위는 돌출봉 내성을 보장하지 않고 서로 다른 regime를 섞을 수 있다.

v1에는 interval별 목표값, 자동 window 확장, 숨은 추가 조회, 데이터 모양에 따른 가변
window를 두지 않는다. 너무 오래된 evidence는 별도 slice로 자르지 않고 time decay,
candidate lifetime, 현재 가격과의 관련성으로 약화한다.

public czardas kernel은 `len(CandleTape)==240`만 받는다. storage snapshot selector가
241개 이상을 읽었으면 kernel 호출 전에 최신 240개만 canonicalize한다. 239개 이하거나
중간 canonical gap이 있으면
`insufficient_canonical_coverage`로 분석하지 않는다. 부분 window 추론, interval별
minimum, 자동 축소는 없다. chart는 확보한 candle만으로 계속 렌더할 수 있지만 수동
build는 실패하고 기존 stored pack을 보존한다. 결측 가격이나 거래량은 보간하지 않는다.

### 6.2 candle 불변 조건

입력은 다음을 모두 만족해야 한다.

- symbol과 interval이 한 종류다.
- candle key가 오름차순이며 중복이 없다.
- OHLC는 유한수이고 `low <= open/close <= high`다.
- volume은 유한한 0 이상의 수다.
- `canonicalVersion=v2`, `marketSession=regular`, `priceAdjustment=split`이다.
- inference에는 `isClosed=true`만 들어간다.
- 최신 live candle은 별도로 전달하며 evidence나 fit에 들어가지 않는다.

invalid row를 조용히 버려 다른 as-of를 만들지 않는다. 커널은 입력 전체를 거부하고
구체적인 `analysisUnavailable` reason을 반환한다.

공용 chart `CandleDto`는 `candleKey/canonicalVersion/priceAdjustment`를 모두 보존하지
않으므로 커널 입력으로 다시 사용하지 않는다. manual builder가 ClickHouse row를
canonicalize/validate해 내부 `CzardasCompletedSnapshot`을 만들고 그 snapshot에서만
CandleTape를 파생한다. 기본 chart는 기존 query/DTO 경로를 유지하되 같은 canonical
ClickHouse row를 읽는다. 둘의 동기화는 browser DTO를 왕복시키는 것이 아니라 canonical
candle key, `asOf`와 digest의 일치로 검증한다.

이를 위해 builder와 asset freshness read가 공유할
`ClickHouseMarketDataProvider.canonical_completed_rows()` 전용 read를 추가한다. 이 SQL은
`canonical_version`, `price_adjustment`, `market_session`,
`is_closed`, source revision field를 SELECT 결과에 포함하고 환경변수와 무관하게
`v2/split/regular/closed`를 WHERE에서 강제한다. 기존 public `candles()` 반환값이나
`CLICKHOUSE_REQUIRE_CANONICAL_CANDLES` 설정에 correctness를 의존하지 않는다. weekly
bounded aggregation도 이 method의 direct daily range read만 사용한다.

### 6.3 exact-240 repair 계약

수리는 chart render가 아니라 인증된 manual build job 안에서만 실행한다.

```text
audit -> repair_alpaca -> verify_exact_240 -> infer -> verify_identity -> upsert
```

1. `canonical_completed_rows()`가 `v2/split/regular/closed`를 SQL에서 강제하고 target
   `candleKey` 240개를 감사한다. correctness를 environment escape flag에 맡기지 않는다.
2. 누락이 있으면 공용 expected-key/missing-range planner가 `MarketTimeContract`로 최대 8개
   `[start,end)` range를 만든다.
3. Alpaca는 exact range와 explicit `adjustment=split`만 조회한다. intraday target은
   `1Min` regular-session 원본을 ClickHouse에 materialize한 뒤 같은 session bucket
   aggregator로 `5m/10m/1h/4h`를 만든다. `1W`는 canonical `1D`만 수리·집계한다.
4. repair write는 deterministic repair identity/source ID와 ClickHouse dedup token을 쓴다.
5. 같은 전용 reader로 재조회해 exact 240, gap 0, policy와 digest를 확인한다. provider
   response를 kernel에 직접 넘기지 않는다.
6. audit/repair round는 최대 2회다. 그 사이 latest completed identity가 계속 바뀌면
   `snapshot_changed_during_build`로 실패한다.

```text
CanonicalRepairResult = {
  beforeMissingKeys, requestedRanges,
  providerRows, materializedRows, afterMissingKeys,
  outcome, timeContractVersion, calendarVersion
}
```

239개 이하, 신규 상장 이력 부족, unresolved head/interior/tail gap과
`provider_confirmed_empty`는 inference에 사용할 candle을 만들지 못한 것이다. 현재
Geometry의 120봉 partial/confirmed-empty 차감 정책을 Czardas에 상속하지 않는다. 어떤
실패도 synthetic/zero-volume/carry-forward candle을 만들거나 기존 successful asset을
덮어쓰지 않는다.

기본 chart `CanonicalCandleQuery/OnDemandFillService`와 Czardas는 상위 orchestration을
서로 import하지 않는다. expected-key planner, Alpaca adapter, canonical materializer와
session aggregator만 market-data shared leaf로 추출해 공유한다. 양쪽이 쓴 canonical row는
ClickHouse를 통해 서로에게 이익이 된다.

### 6.4 manual asset API 계약

기존 route family를 additive 확장한다. `assetKind` 생략은 현재 Geometry 동작이다.

```text
GET    /api/charts/analysis-assets?symbol=NVDA&assetKind=czardas
GET    /api/charts/analysis-assets/coverage?assetKind=czardas
POST   /api/charts/analysis-assets/build
       {assetKind:"czardas", symbols:["NVDA"], intervals:["1D"], force:false}
GET    /api/charts/analysis-assets/build/{job_id}
POST   /api/charts/analysis-assets/build/{job_id}/cancel
DELETE /api/charts/analysis-assets?symbols=NVDA&intervals=1D&assetKind=czardas
```

- Czardas build/delete/status/cancel은 authenticated다. GET/coverage의 기존 auth 의미는
  바꾸지 않는다.
- Czardas build는 symbol 하나와 interval 하나의 explicit pair만 받으며 `sp500`, cross
  product와 empty list를 거부한다. panel 기본값은 현재 chart pair다.
- POST는 client가 임의 pack을 upload하는 PUT이 아니다. job을 등록할 뿐이며 server의
  canonical repair와 deterministic Python kernel을 통과한 pack만 storage가 upsert한다.
- job ID는 `cza-...`, 기존 Geometry `cab-...`를 유지한다. status route는 prefix/assetKind로
  올바른 store를 dispatch한다.
- GET miss, chart open, tick, `CANDLE_CLOSED/CORRECTED`, focus/reconnect는 build를 enqueue하지
  않는다. schedule/CronJob도 없다.
- successful terminal poll과 delete 뒤 요청한 client만 `assetKind+symbol` cache를 invalidate해
  refetch한다. 다른 열린 client로 push하는 것은 v1 범위 밖이다.
- delete는 명시한 pair의 latest Czardas row만 삭제한다. user-owned drawing과 current
  Geometry row는 수정하지 않는다.

chart candle API는 Czardas pack을 동봉하거나 `includeCzardas/proposalTarget/pending`
상태를 새로 만들지 않는다. 기존 chart loading/fill 계약은 유지하고 asset API가 pack의
`asOf/inputDigest`와 chart의 completed candle identity를 비교한다.

### 6.5 stored asset freshness와 foreground

상태는 proposal queue 상태가 아니라 저장 row와 현재 chart snapshot의 관계다.

| 상태 | drawing | Czardas Field | 동작 |
| --- | --- | --- | --- |
| `current` | 정상 | 표시 | `asOf/inputDigest`가 현재 240봉과 일치 |
| `stale` | 낮은 opacity + as-of badge | 숨김 | 더 최신 완료봉 또는 다른 digest; `수동 재분석 필요` |
| `missing` | 없음 | 없음 | 저장 asset 없음; GET은 build하지 않음 |
| `incompatible` | 없음 | 없음 | symbol/interval/policy/schema 불일치 |

stale drawing은 현재 Geometry와 같은 개발 UX로 유지하지만 Field는 다른 240봉 위에 과거
inference landscape를 겹쳐 인과를 위조하지 않는다. Field는 asset `asOf/inputDigest`와
현재 completed snapshot이 exact match일 때만 보인다. 수동 job running/failed 상태는
panel에만 나타나며 기존 successful row는 성공한 upsert 전까지 원자적으로 유지된다.

foreground GET/coverage는 PostgreSQL read-only이며 kernel, repair, asset write, job upsert가
0회다. 동일 stored identity는 모든 사용자에게 byte-identical pack을 전달하고 사용자별
toggle·편집·suppression은 request나 shared row에 포함하지 않는다.

## 7. canonical 자료구조

구현은 mutable dictionary를 단계 사이에 흘리지 않는다. 아래 이름의 frozen dataclass
또는 동등한 typed value를 사용한다.

### 7.1 `CandleTape`

```text
identity: symbol, interval, asOf, lastCandleKey, inputDigest,
          timeContractVersion, calendarVersion
time: timestamp[], candleKey[], barIndex[]
price: open[], high[], low[], close[]
participation: volume[]
coverage: targetCount, actualCount, contiguousCount, state
live: optional candle, inference와 분리
```

SoA(structure of arrays)를 사용해 반복 중 dict lookup과 중간 객체 생성을 줄인다.
public kernel에서 모든 배열 길이는 정확히 `F=240`이다.

### 7.2 `FeatureTape`

```text
trueRange, atr14
bodyLow, bodyHigh, bodySize, bodyFraction
upperWick, lowerWick, closeLocation
return1, rangeAtr
logVolumeZ20, volumeRank20, participation, volumeReady
```

`FeatureTape`에는 prefix에 따라 달라지는 recency를 저장하지 않는다.

### 7.3 `EvidenceAtom`과 `RoleBasis`

```text
evidenceId
kind: swingHigh | swingLow | rejectionHigh | rejectionLow
sourceCandleKey, observedAt, confirmedAt, barIndex
endpointPrice, bodyEdgePrice
explorationCorridor: lowPrice, highPrice
scale: 2 | 5 | 13
prominence, rejection, integrity, participation
```

base `EvidenceAtom`도 recency나 role mass를 저장하지 않는다. 순수
`EvidenceViewAt(clusterId,prefixIndex)`가 representative atom과 그 prefix에서 확인된
cluster metadata로
`recency/hlineMass/trendMass`를 호출 시 계산한다. 이를 미래 as-of 값으로 cache하지 않는다.

`swingHigh/Low`는 extrema가 `i+r`에서 확인되면 Trend용으로 생성한다.
`rejectionHigh/Low`는 같은 extrema가 8.2의 3봉 반대 방향 reaction까지 확인됐을 때
H-Line용 별도 atom으로 생성한다. kind가 ID에 들어가므로 한 candle이 두 역할을 가져도
같은 evidence로 합치지 않는다.

`RoleBasisAt(clusterId,prefixIndex,role)`는 Field에 더해지는 실제 관측 함수다.

```text
RoleBasis = {
  basisId, clusterId, role,
  observedAt, confirmedAt,
  endpointPrice, bodyEdgePrice, corridorLow, corridorHigh,
  roleMass, participation,
  effectiveScale, prefixIndex
}
```

이는 prefix에서 계산한 immutable value이며 같은 candle도 role마다 별도 Basis를 가진다.
`roleMass`는 확률이 아니라 동일 role의 robust aggregation weight다. universal candle
importance를 만들지 않는다.

multi-scale/근접 atom과 독립 접촉은 별도 typed 구조로 표현한다.

```text
EvidenceCluster = {
  clusterId, kind,
  representativeEvidenceId,
  confirmedMemberIds[], confirmedScales[], lastUpgradeConfirmedAt
}

FormationEpisode = {
  episodeId, fieldModeId, role,
  firstClusterId, memberClusterIds[],
  observedFrom, observedTo, confirmedAt,
  contributionClusterId, contributionRoleMass
}
```

`EvidenceCluster`의 endpoint, corridor, prominence, rejection, body anatomy, participation은
representative atom에 고정한다. non-representative member의 이 값을 max/mean/sum으로
합성하지 않는다. member가 보강할 수 있는 값은 현재 prefix까지 confirmed된
`effectiveScale=max(confirmedScales)`뿐이며 role mass는 representative fact와 이 scale로
다시 계산한다.

`FormationEpisode`는 provisional field mode를 기준으로 여러 cluster가 한 번의 머무름을
표현할 때 쓰며 first member가 ID를 고정한다. H-Line과 Trend 모두 9.2와 10.3의
mode-local separation pass로 episode를 만든다. 한 episode는 geometry에 정확히 하나의
contribution만 낸다. 같은 cluster가 서로 다른 mode에 참여할 수 있으므로 episode ID에는
mode ID를 포함한다.

`observedFrom/observedTo`는 member representative의 최소/최대 observedAt이고,
`confirmedAt`은 현재 contribution snapshot에 포함된 member의 최대 confirmedAt이다.

현재 prefix의 member cluster view마다 role mass를 구한 뒤 `(endpointPrice, clusterId)`의
weighted median 위치에 있는 실제 cluster를 `contributionClusterId`로 택한다.
`contributionRoleMass`는 member role mass의 산술평균이다. geometry의 time, price, corridor,
anatomy는 선택한 실제 cluster에서 가져오고 episode의 rejection, participation,
HLineGeometryScore 같은 요약은 member representative fact의 산술평균을 쓴다. 따라서 긴
머무름은 더 안정적인 대표점을 고를 수는 있어도 independent touch 수나 episode weight를
member 수만큼 늘리지 못한다. 같은 episode에 member가 추가되어 contribution이 달라지면
3.2의 contribution replacement refit일 뿐 새 episode가 아니다.

Field는 Basis를 선으로 바로 바꾸지 않는다. 먼저 detector별 hypothesis를 만들고, 가까운
hypothesis가 이루는 mode를 찾은 뒤 mode 안에서 독립 episode를 다시 한 표씩 센다.

```text
HLineFieldMode = {
  fieldModeId, fieldRevision, derivationDigest,
  role: support | resistance,
  firstSeenAt, modeState: weak | coherent | opposed,
  geometryState: provisional | refined,
  seedRidge: lowPrice, highPrice,
  centerPrice, zoneHalfWidth,
  contributorBasisIds[], episodeIds[],
  contributorCount, independentEpisodeCount,
  supportMass, oppositionMass, dispersionAtr
}

TrendHypothesis = {
  hypothesisId, role: lower | upper,
  sourceBasisIds: [string, string],
  confirmedAt, yAtWindowStart, yAtWindowEnd,
  pairSeparationBars, seedMass
}

TrendFieldMode = {
  fieldModeId, fieldRevision, derivationDigest,
  role: lower | upper,
  firstSeenAt, modeState: weak | coherent | opposed,
  geometryState: provisional | refined,
  representativeHypothesisIds[],
  medoidYAtWindowStart, medoidYAtWindowEnd,
  boundaryYAtWindowStart, boundaryYAtWindowEnd,
  startDispersionAtr, endDispersionAtr,
  contributorBasisIds[], episodeIds[],
  contributorCount, independentEpisodeCount,
  supportMass, oppositionMass
}
```

`weak/coherent/opposed`는 selector 결과가 아니다. `weak`는 mode는 있으나 formation gate를
통과하지 못한 상태, `coherent`는 통계·기하적으로 경계 후보가 될 수 있는 상태,
`opposed`는 refined geometry는 있으나 body/close 수용 또는 열린 break가 반대한 상태다.
selector가 무엇을 골랐는지는 별도
`selectedModeRefs`로만 표현한다. aggregate mode는 하나의 source fact인 척하지 않고
`fieldModeId + derivationDigest + contributorCount`로 full trace에서 재현한다.
`geometryState=provisional`은 seed/medoid estimate만 있다는 뜻이고 `refined`는 episode
compression과 robust refinement를 끝냈다는 뜻이다. Boundary는 `coherent+refined` mode에서만
생성한다.

상태와 opposition의 normative 계산은 다음과 같다.

```text
oppositionMass = clamp(
  0.5*(1-bodyIntegrity) + 0.5*(1-closeIntegrity),
  0, 1
)

modeState =
  weak      if geometryState=provisional OR independentEpisodeCount<2
               OR detector의 non-integrity geometry gate 실패
  opposed   if refined geometry gate는 통과했지만 body/close integrity gate
               OR formation_break_open 실패
  coherent  if 모든 formation hard gate 통과
```

위 순서가 precedence다. `supportMass`는 episode role mass의 합으로 `[0,1]` 확률이 아니며
oppositionMass와 크기를 직접 비교하지 않는다. renderer도 support/opposition을 하나의
순점수로 빼지 않고 mode contour와 hatch channel로 분리한다.
mode ID는 최초 seed에 고정되고 contributor/membership이 바뀌면 `fieldRevision`만 1씩
증가한다. `derivationDigest`는 canonical contributor Basis/hypothesis/episode ID와 그때의
role mass, tolerance/config version, refined geometry를 정렬해 hash한 값이다. 같은 full
rebuild는 같은 revision sequence와 digest를 재생해야 한다.
`firstSeenAt`은 그 seed가 처음 나타난 chronological prefix의 마지막 candle canonical UTC
timestamp다. prefix ordinal이나 sliding-window `barIndex`가 아니므로 window가 이동해도 seed가
남아 있는 동안 mode ID를 흔들지 않는다.

### 7.4 `BoundaryCandidate`

```text
candidateId, modelRevision, kind, role, lifecycle, isRelevantNow
originFieldModeId, sourceFieldModeId, sourceFieldRevision
line: y = slope*x + intercept
zoneHalfWidth
observedDomain: firstIndex, lastIndex
initialFormationEpisodeIds, fitEpisodeIds
fitContributions[]: episodeId, clusterIds, endpointPrice, effectiveScale,
                    roleMassAtFit, observedAt, confirmedAt
HLine fit contribution only: rejectionAtFit, participationAtFit
lineageFormedAt, revisionFormedAt
interactions, rank
profileConfluence
explanation, rejectReasons
```

H-Line은 `slope=0`인 Boundary다. Trend와 H-Line은 같은 평가·출력 모델을 쓰지만
후보 생성기는 공유하지 않는다.
`originFieldModeId`는 lineage를 최초로 만든 mode에 고정하고, `sourceFieldModeId +
sourceFieldRevision`은 현재 candidate revision geometry를 실제로 낳은 mode revision을
가리킨다. 사용자 편집 이후의 geometry는 이
참조를 유지한 engine revision이 아니라 user-owned copy이므로 Field source line처럼
표시하지 않는다.
`fitContributions`는 revision 생성 prefix의 immutable snapshot이다. cluster가 나중에
scale upgrade되어도 기존 revision 값을 dereference해 바꾸지 않고 3.2 refit event로만
반영한다.

### 7.5 `InteractionEvent`

```text
interactionId, candidateId, testedRevision
approachAt, contactAt, leaveAt
terminalAt
side, state, horizon
touchDepthAtr, bodyPenetrationAtr, closePenetrationAtr
explorationPressure, acceptanceMass, acceptanceRun, reclaimSpeed
responseExcursionAtr, responseScore
completed, assimilatedByRevision
```

### 7.6 `CandidatePack`

```text
algorithmVersion, configVersion, timeContractVersion, calendarVersion
symbol, interval, asOf, lastCandleKey, inputDigest
coverage, status
boundaries[], presentationPattern, drawings[]
czardasField, rejectSummary
```

이는 deterministic `CzardasPackContent`다. `generatedAt`은 builder/storage/API envelope
metadata이며 content나 content digest에 들어가지 않는다.

production JSON은 Field를 포함해 64 KiB 이하다. 선택 전에 실제 detector가 계산한 Basis와
field mode의 bounded view, 선택된 후보, compact explanation을 싣는다. 전체 raw hypothesis,
전체 거절 후보, 과거 revision과 penetration ledger는 debug 결과에만 둔다.

### 7.7 하위 ID

rolling window의 `barIndex`는 hash에 넣지 않는다. 모든 ID 입력은 UTF-8, `|` 구분,
정렬된 canonical string이고 결과는 `sha256:` prefix의 lowercase hex다.

```text
rawEvidenceId = hash(symbol|interval|kind|candleKey|scale)
nmsEvidenceId = hash("nms"|symbol|interval|kind|firstConfirmedRawEvidenceId)
roleBasisId = hash("basis"|symbol|interval|role|nmsEvidenceId)
hlineResponseSegmentId = hash("hseg"|symbol|interval|asOf|role|lowPrice|highPrice)
formationEpisodeId = hash("formation"|symbol|interval|role|fieldModeId|firstNmsEvidenceId)
hlineFieldModeId = hash("hmode"|symbol|interval|role|firstSeenAt|seedRidgeLower|seedRidgeUpper)
trendHypothesisId = hash("thyp"|symbol|interval|role|firstBasisId|secondBasisId)
trendFieldModeId = hash("tmode"|symbol|interval|role|firstSeenAt|seedHypothesisId)
interactionId = hash(candidateId|testedRevision|role|firstContactCandleKey)
triangleId = hash(symbol|interval|kind|upperCandidateId|lowerCandidateId)
```

NMS cluster와 FormationEpisode는 chronological replay에서 먼저 confirmed된 member가
ID를 고정한다. member가 늘어나도 ID는 바뀌지 않는다. 같은 `confirmedAt` 동률은 큰
scale, 큰 base prominence, candle key 사전순으로 first member를 고른다. prefix-dependent
role mass를 ID tie-break에 사용하지 않는다. interaction이 여러 bar로 늘어나도 first
contact key가 같으므로 ID는 바뀌지 않는다.

### 7.8 provenance edge

debug trace는 설명과 향후 candle 강조가 계산 근거를 역조회할 수 있도록 다음 typed edge를
보존한다. production pack에는 선택된 결과의 compact attribution만 싣는다.

```text
AttributionEdge = {
  sourceId: candleKey | evidenceId | clusterId | basisId | responseSegmentId | hypothesisId |
            fieldModeId | episodeId | interactionId | candidateId,
  targetId: evidenceId | clusterId | basisId | responseSegmentId | hypothesisId | fieldModeId |
            episodeId | candidateId | triangleId,
  relation: clusters | derives | hypothesizes | aggregates | groups | contributes |
            forms | fits | verifies | opposes | invalidates | composes,
  observedFrom, observedTo,
  contributionFacts
}
```

중요 candle은 이 edge들의 역할별 attribution vector로 설명하며 단일 importance 점수를
원본 사실처럼 저장하지 않는다. 개별 glyph는 실제 source ID를 보존한다. aggregate
ridge/mode는 가짜 단일 source ID를 붙이지 않고 derivation digest와 contributor edge
집합으로 재현한다.

## 8. OHLCV 해석 모델

czardas는 OHLCV를 실제 3차원 좌표로 억지 변환하지 않는다. 한 candle을 서로 다른
역할을 가진 관측 벡터로 본다.

- 시간: 최신성, episode 분리, confirmation 지연
- 가격: endpoint, body, wick, close-through
- 변동성: 서로 다른 종목·interval을 비교하는 ATR 단위
- 참여도: volume의 상대적 이상도와 가격대 누적 참여
- 구조: 지역 극값의 규모, prominence, 반응 방향

따라서 “중요 candle”이라는 하나의 만능 점수는 만들지 않는다. 같은 candle도
H-Line reaction에는 강하고 Trend anchor에는 약할 수 있다. 역할별 mass가 그 차이를
보존한다.

### 8.1 기본 feature

- ATR: Wilder ATR(14). 초기값은 첫 14개 true range의 산술평균.
- volume baseline: 현재 봉을 제외한 직전 20봉 `log1p(volume)`의 median/MAD.
- `volumeRank20`: 직전 20봉을 기준으로
  `(#lower + 0.5*#equal)/n`인 empirical percentile. 20봉 미만이면 `0.5`.
- `logVolumeZ20=(log1p(volume)-median)/(1.4826*MAD)`. MAD가 0이거나 20봉
  미만이면 0이다. 20봉 미만은 `volumeReady=false`이며 결과는 `[-3,3]`으로 clamp한다.
- `volumeAnomaly=clamp(0.5+logVolumeZ20/6,0,1)`,
  `participation=0.5*volumeRank20+0.5*volumeAnomaly`.
- replay prefix가 `t`, evidence bar가 `i`일 때
  `recency_i(t) = 2 ^ (-(t-i)/120)`이다. 반감기 120봉은 전체 window 240봉과 분리된
  고정값이며 interval별로 바꾸지 않는다. chronological loop에서 recency와 역할별
  mass를 사용할 때마다 현재 prefix `t`로 파생하며 evidence ID나 base fact에 저장하지
  않는다.
- replay prefix `t`의 v1 `effectiveTick_t = max(0.01, close_t*1e-6)`이다. 최종
  snapshot의 최신 종가를 과거 prefix에 소급하지 않고 외부 symbol metadata 조회도
  하지 않는다.
- 가격 거리를 ATR 단위로 바꿀 때만
  `atrScale_k=max(atr14[k],effectiveTick_k)`를 쓰며 이하 `localATR_k`는 이 값을 뜻한다.
  volume·weight·dimensionless ratio에 price tick을 섞지 않는다. weight 합이 0이면 후보를
  만들지 않고, 일반 무차원 분모만 `1e-12`로 보호한다.

이하 수식의 `tickSize`는 이 `effectiveTick`을 뜻한다.

수치 helper는 다음으로 고정한다.

- `weightedQuantile(q)`: `(value,stableId)` 오름차순에서 누적 weight가 처음
  `q*totalWeight` 이상인 value. weighted median은 `q=0.5`.
- `weightedMAD`: weighted median 중심으로부터 절대편차의 weighted median.
- `harmonicMean`: 입력 중 하나가 0이면 0, 아니면 `n/sum(1/max(x,1e-12))`.
- 중간 계산은 round하지 않고 output canonicalization에서만 소수 8자리 round.

### 8.2 extrema와 confirmation

반경 `r in {2,5,13}`에서 지역 high/low를 찾는다. plateau는 동일 방향 endpoint,
prominence, 최신 timestamp 순으로 하나만 남긴다. 양쪽 r봉이 닫혀야 extrema로
확정되므로 기본 `confirmedAt=i+r`다.

reaction은 확정 후 3봉 안의 반대 방향 close excursion을 본다. 따라서 reaction을
사용하면 `confirmedAt=max(i+r,i+3)`이다. 끝에서 아직 필요한 봉이 닫히지 않은
extrema는 pending이며 evidence가 아니다.

각 endpoint evidence는 한 점만 저장하지 않고 candle anatomy를 함께 보존한다.

```text
low-side evidence:
  endpointPrice = low
  bodyEdgePrice = bodyLow
  explorationCorridor = [low, bodyLow]

high-side evidence:
  endpointPrice = high
  bodyEdgePrice = bodyHigh
  explorationCorridor = [bodyHigh, high]
```

endpoint는 Trend와 wick rejection의 선호 좌표이고 corridor는 wick 끝이 서로 달라도
body 경계까지 시장이 탐색한 연속 가격 범위다. 둘 중 하나를 outlier 예외로 버리지 않는다.

```text
prominenceHigh = min(high_i - min(low_left), high_i - min(low_right)) / localATR_i
prominenceLow  = min(max(high_left) - low_i, max(high_right) - low_i) / localATR_i
prominence     = clamp(prominence / 1.5, 0, 1)

rejectionHigh  = clamp(max(high_i - close_{i+1..i+3}) / localATR_i, 0, 1)
rejectionLow   = clamp(max(close_{i+1..i+3} - low_i) / localATR_i, 0, 1)
```

NMS는 **exact kind별로** streaming cluster를 만든다. 새 raw atom은 representative와
bar 거리 `<=2`이고, exploration corridor가 겹치거나 endpoint 차이가
`<=0.25*max(localATR_representative,localATR_new)`일 때만 합친다. 비교 기준은 마지막
member가 아니라 representative라서 chain으로 무한 확장되지 않는다. 대표와 ID는 7.7의
first-confirmed 규칙을 따르고, 현재 prefix까지 확인된 `confirmedScales`의 최댓값만
effective scale로 보강한다. 나중 scale 확인을 과거 prefix에 소급하지 않는다.
`lastUpgradeConfirmedAt`의 scale 승격은 그 prefix의 evidence update event이며, existing
candidate를 조용히 바꾸지 않고 3.2 refit 정책을 거친다.

### 8.3 역할별 evidence mass

모든 입력은 `[0,1]`로 clamp한다.

```text
bodyIntegrityHigh = clamp((high-bodyHigh)/(0.50*localATR), 0, 1)
bodyIntegrityLow  = clamp((bodyLow-low)/(0.50*localATR), 0, 1)

scaleScore(2)=0.35, scaleScore(5)=0.70, scaleScore(13)=1.00
```

```text
HLineMass =
  0.40*prominence + 0.30*rejection + 0.20*bodyIntegrity + 0.10*recency

HLineGeometryScore =
  (0.40*prominence + 0.20*bodyIntegrity + 0.10*recency) / 0.70

TrendMass =
  0.50*prominence + 0.30*scaleScore + 0.20*recency
```

H-Line 생성 weight에는 `0.90 + 0.10*participation`을 곱한다. 이 제한된 weight가
weighted median 중심을 바꿀 수는 있으므로 geometry 영향 자체를 “20%”라고 표현하지
않는다. 최종 rank의 estimated profile 보정은 12장에서 최대 `0.05`로 제한한다.
같은 volume을 candle과 profile에서 무제한 이중 가산하지 않는다.

Trend geometry와 rank에는 volume을 사용하지 않는다. endpoint anatomy, scale,
prominence, body/close integrity가 근거다.

candidate revision을 만드는 순간의 prefix에서 `recency`, 역할 mass, geometry,
seedQuality, formation integrity를 계산해 그 revision에 고정한다. 새 완료봉마다 과거
revision의 선을 time decay만으로 미세 이동시키지 않는다. 새 compatible evidence를 흡수한
refit만 새 revision을 만들고, 그때 새 prefix 값으로 다시 계산한다. 현재성과 노화는 기존
revision을 변형하지 않고 15.1의 output relevance와 current-distance tie-break가 담당한다.

### 8.4 탐색–수용–반응과 공통 점수

czardas는 돌출봉을 별도 예외로 판정하지 않는다. 모든 H-Line과 Trend에서 candle range와
wick은 경계 너머의 **탐색**, body와 close 및 그 지속은 그 가격의 **수용**, 경계 안 복귀와
유리한 방향 이탈은 **반응**이다. geometry는 다수의 endpoint 구조가 정하고, 모든 candle은
bounded integrity와 interaction으로 그 geometry를 시험한다.

아래 값은 detector와 rank가 공통으로 쓰는 normative 정의다.

```text
formationSpanBars = max(barIndex(observedAt) of current fitContributions)
                    - min(barIndex(observedAt) of current fitContributions)
persistence = clamp(formationSpanBars/96, 0.25, 1)

localATR_k = atrScale_k
candidateMedianATR = median(localATR over ATR-ready bars from the earliest current fit
                     episode through revisionFormedAt)
zone_k = candidate zoneHalfWidth  # revision 동안 고정된 price width

weightedResidualAtr = weightedMedian(abs(endpointPrice-y)/localATR)
fitScore = exp(-weightedResidualAtr)
independentEpisodeCount = len(current fitEpisodeIds)
touchCountScore = clamp(independentEpisodeCount/4, 0, 1)
```

line의 유효 방향을 support/lower에서는 가격이 line 위, resistance/upper에서는 가격이
line 아래인 것으로 잡는다. 각 bar의 normalized penetration은 다음과 같다. 상단
경계는 부등호만 반대로 한다.

```text
wickDepth  = max(0, y-zone-low)     / localATR
bodyDepth  = max(0, y-zone-bodyLow) / localATR
closeDepth = max(0, y-zone-close)   / localATR

bounded(z) = z / (1+z)
rawPenetration     = max(1*wickDepth, 4*bodyDepth, 8*closeDepth)
boundedPenetration = bounded(rawPenetration)
bodyAcceptance     = bounded(4*bodyDepth)
closeAcceptance    = bounded(8*closeDepth)

integrityBars = bars whose range is within 1 ATR of the line zone
                OR whose wick/body/close penetrates the invalid side

normalizedWeight_k = recency_k / sum(recency over integrityBars)
influenceWeight_k  = min(normalizedWeight_k, 0.15)

integrity      = 1 - sum(influenceWeight_k*boundedPenetration_k)
bodyIntegrity  = 1 - sum(influenceWeight_k*bodyAcceptance_k)
closeIntegrity = 1 - sum(influenceWeight_k*closeAcceptance_k)
```

`integrityBars`가 비어 있으면 0으로 대체하지 않고 후보를 만들지 않는다. H-Line과 Trend의
fit episode가 정상이라면 적어도 그 evidence bar가 포함되어야 하므로 빈 집합은
수치 예외가 아니라 후보 구성 오류다.

`bounded`와 bar별 influence cap은 큰 관통 하나가 점수를 지배하지 못하게 하지만 관통
사실을 지우지 않는다. 단일 candle의 integrity 영향은 최대 0.15라서 혼자 후보를 즉시
없애지 못한다. 같은 방향의 body/close 수용이 여러 봉에서 반복되면 bounded 값도 여러 번
누적되어 integrity와 break가 함께 악화된다. outlier 여부를 판정하거나 특정 candle을
제외하는 분기는 없다. line에서 1 ATR보다 멀리 떨어져 경계를 시험하지 않은 bar는
`integrityBars`의 분모에도 들어가지 않으므로 위반을 희석하거나 strength를 높이지 않는다.

revision의 observed domain은 `min(current fitContribution.observedAt)` bar부터
`revisionFormedAt` bar까지다.
hard gate와 fit loss는 그 prefix만 사용한다. `revisionFormedAt` 뒤 bar는 interaction evaluator가
처리하며 현재 revision의 fit integrity를 과거 전체에 소급 재계산하지 않는다.

formed gate 직전에는 공통 close-through suffix도 검사한다. fit domain의 끝에서 11.3의
`fitCloseDepth>0.25`인 완료봉이 2개 연속인 열린 break가 있으면 candidate를 만들지 않는다.
과거 중간의 이탈 뒤 새 독립 formation이 다시 생긴 경우까지 영구 금지하는 규칙은 아니며,
**형성되는 순간 이미 깨져 있는 선**만 차단한다.

H-Line과 Trend의 candidate seed quality는 서로 다른 geometry fact를 쓴다.

```text
ridgeAgreement = clamp(1-weightedMAD(projectedEndpointPrice)/zoneHalfWidth, 0, 1)
HLineSeedQuality =
  0.45*mean(HLineGeometryScore)
  + 0.30*mean(rejection)
  + 0.25*ridgeAgreement

TrendSeedQuality =
  0.45*mean(TrendMass)
  + 0.35*fitScore
  + 0.20*touchCountScore
```

seedQuality는 formation geometry만 나타낸다. persistence는 12장의 baseRank에서 한 번,
post-formation response는 verificationBonus에서 한 번만 반영한다.

role mass는 weighted median/Theil–Sen/anchor residual 같은 geometry weight에만 쓴다.
seed의 episode-level 품질 요약은 위 arithmetic mean으로 계산해 mass를 자기 자신으로
다시 가중하지 않는다. 빈 집합은 candidate를 만들지 않으며 0으로 대체하지 않는다.

## 9. H-Line detector: Price Memory

### 9.1 핵심 계약

H-Line은 “거래량이 많은 가격”만으로 만들지 않는다. 최소 2개의 독립된 support 또는
resistance reaction episode가 가격 허용 구간에서 겹쳐야 후보가 생긴다. estimated
Volume Profile은 이미 생긴 후보의 설득력을 높이거나 동률을 깨는 데만 쓴다.

### 9.2 Price-Memory Field와 ridge mode

현재 prefix에서 confirmed된 rejection `RoleBasis i`는 다음 폐구간을 만든다.

```text
tol_i = max(2*tickSize, 0.25*localATR_i)
I_i   = [corridorLow_i-tol_i, corridorHigh_i+tol_i]

SeedResponse_role,t(p) = Σ roleMass_i(t) * 1[p in I_i]
```

support와 resistance는 별도 Field다. `SeedResponse`는 균일한 가격 grid에 샘플링한 KDE가
아니라 interval endpoint 사이에서 값이 일정한 정확한 piecewise field다. endpoint를
`(price, start-before-end, basisId)`로 안정 정렬한 sweep 하나로 모든 segment와 local
ridge를 `O(E log E)`에 얻는다. wick endpoint가 조금 어긋나도 body edge까지 실제로
탐색된 corridor가 겹치면 같은 가격 기억을 만들 수 있다.

각 ridge는 다음의 순서로 `HLineFieldMode`가 된다.

1. 서로 다른 cluster가 2개 이상 활성인 maximal segment를 seed ridge로 잡는다. ridge와
   교차하는 Basis만 contributor이며 바깥 reaction을 넣어 corridor를 넓히지 않는다.
2. contributor endpoint를 ridge 안으로 clamp한 weighted median을 provisional center로,
   ridge 폭과 median ATR로 제한한 값을 provisional zone으로 둔다.

```text
provisionalMedianATR = median(
  localATR from earliest contributor observedAt through current prefix
)
provisionalCenter = weightedMedian(
  clamp(endpointPrice_i, ridgeLower, ridgeUpper), weight=roleMass_i
)
provisionalZone = max(
  2*tickSize,
  min(0.35*provisionalMedianATR,
      max((ridgeUpper-ridgeLower)/2, 0.25*provisionalMedianATR))
)
```

3. 이 provisional mode에 11.1의 separation을 시간순으로 정확히 한 번 적용해 mode-local
   `FormationEpisode`를 만든다. 충분히 떠났다가 돌아온 시험만 새 episode이고, 한 가격에
   머문 여러 cluster는 한 contribution이다.
4. episode contribution corridor `J_e`로 response를 다시 계산한다.

```text
EpisodeResponse_mode,t(p) =
  Σ contributionRoleMass_e(t) * 1[p in J_e]
```

   이 재계산이 H-Line detector가 실제로 읽는 최종 statistical field다. raw cluster 수나
   pair 수는 support mass를 늘리지 않는다. 서로 독립인 episode 두 개가 겹치는 local
   maximum이 없으면 mode는 `weak`로 남고 Boundary가 되지 않는다.
5. 최종 maximum interval 안으로 episode endpoint를 clamp하고 weighted median/MAD로
   center와 zone을 refine한다.

```text
projectedEndpoint_e = clamp(episodeContributionPrice_e, modeLower, modeUpper)
center = weightedMedian(projectedEndpoint_e, weight=contributionRoleMass_e)
residualFloor = weightedQuantile(
  abs(projectedEndpoint_e-center), 0.80,
  weight=contributionRoleMass_e
)
zoneHalfWidth = max(
  2*tickSize,
  min(0.35*candidateMedianATR,
      max(0.25*candidateMedianATR,
          1.4826*weightedMAD(
            projectedEndpoint_e, weight=contributionRoleMass_e
          ),
          residualFloor))
)
```

6. earliest contribution부터 current prefix까지의 body/close penetration을 8.4의 bounded
   integrity로 적분해 `oppositionMass`를 만든다. opposition은 mode 상태·gate·rank에 쓰지만
   center를 돌출 방향으로 이동시키거나 zone을 넓히지 않는다.
7. 중심 차이가 `<=0.35*candidateMedianATR`이고 episode Jaccard가 `>=0.5`인 mode는 seed
   quality, 더 이른 first-seen prefix, field mode ID 순으로 하나만 남긴다.

provisional pass와 mode-local episode pass는 각각 한 번뿐이며 final geometry로 반복
regroup하지 않는다. 모든 final episode corridor가 final zone과 교차하는지는 hard gate로
검사한다. weighted ridge와 median/MAD 때문에 소수의 돌출 endpoint는 center를 끌지 못하고,
돌출을 포함하려고 zone도 `0.35 ATR`보다 넓어지지 않는다. 형성된 경계를 관통한 candle의
의미는 geometry 예외처리가 아니라 11장의 탐색–수용–반응으로 평가한다.

Field는 chronological replay에서 새 reaction Basis가 confirmed된 prefix마다 갱신한다.
Boundary는 coherent mode가 처음 생긴 prefix와 그때의 가장 이른 두 episode를 formation으로
고정한다. 미래 episode를 이미 아는 상태에서 과거 mode를 더 예쁘게 다시 고르지 않는다.
production Czardas Field에는 selector 전의 coherent mode와 예산 안의 strongest weak/opposed
mode도 남는다. 따라서 no-draw에서도 약하거나 충돌한 가격 기억을 볼 수 있다.

현재 prefix의 Basis는 `observedAt desc, confirmedAt desc, basisId asc`로 정렬해 최대
48개/role만 sweep한다. `E<=48`이므로 field build는 `O(E log E)`다. cap은 새 mode/refit
검색에만 적용하고 이미 formed된 Boundary의 immutable formation fact는 exact-240 window를
벗어날 때까지 보존한다.

### 9.3 hard gate

H-Line 후보는 다음을 모두 만족해야 한다.

- 같은 역할의 독립 formation episode `>=2`.
- 8.4의 `formationSpanBars>=20`.
- 평균 rejection `>=0.35`.
- zone half-width `<=0.35*candidateMedianATR`.
- 모든 episode contribution formation interval이 final `[center-zone,center+zone]`과 교차함.
- body integrity `>=0.70`.
- seed quality `>=0.45`.
- fit domain 끝에 8.4의 열린 2봉 close-through break가 없음.

gate를 통과한 후보는 `formed`이며 output 대상이 될 수 있다. `revisionFormedAt` 뒤에 새로
접촉해 break 없이 유리한 방향으로 이탈한 첫 독립 post-fit episode가 있으면 `verified`다.
verification은 rank와 설명을 보강하지만 output hard gate는 아니다.

### 9.4 estimated Volume Profile confluence

별도 Volume Profile API나 저장 자산을 읽지 않는다. 6.1의 completed context 전체에서
48-bin estimated price-volume histogram을 한 번 계산한다. 각 candle volume은 low-high와
bucket의 겹침 비율로 분배한다.

`high==low`인 candle은 그 가격을 포함하는 한 bin에 volume 전부를 넣는다. 전체 가격
range가 0이면 effectiveTick 폭의 한 bin을 사용한다. 전체 volume 또는 최대 bin volume이
0이면 `profileConfluence=0`이다. NaN이나 0 나눗셈으로 후보 순서가 바뀌지 않는다.

각 겹치는 bin에 대해 `overlapFraction(bin,zone)*binVolume`을 구하고 그 최댓값을 전체
histogram의 `maxBinVolume`으로 나눈 `profileConfluence in [0,1]` 하나만 만든다. 겹치는
bin이 없거나 `maxBinVolume=0`이면 0이다. 여러 bin volume을 합해 1을 넘기지 않는다.
이 값은 다음에만 사용한다.

- reaction과 geometry gate를 이미 통과한 H-Line의 작은 rank 보조.
- rank가 사실상 같은 H-Line 사이의 tie-break.
- 설명의 `estimated price-volume mass` 근거.

POC에서는 POC/HVN/LVN/VAH/VAL을 별도 판정하거나 각각 다른 상수를 두지 않는다.
profile은 H-Line을 생성·통과·검증하지 않으며 Trend와 Triangle에는 사용하지 않는다.
실제 trade-at-price가 아니므로 외부 설명에는 항상 `estimated`를 붙인다.

histogram은 final exact-240 snapshot에서 한 번 계산한다. chronological candidate 생성,
hard gate, identity, dedupe, replay cap은 `profileBonus=0`으로 끝낸다. 그 뒤 살아남은 H-Line
bank에만 confluence와 최대 0.05 bonus를 붙여 final selector에 사용한다. final-window
volume이 과거 prefix의 candidate 생존을 소급 변경하면 구현 오류다.

### 9.5 역할과 break

support는 line 위쪽 가격의 하단 경계, resistance는 line 아래쪽 가격의 상단 경계로
평가한다. v1은 자동 polarity flip을 하지 않는다. break 후 반대 역할의 새 reaction
episode들이 쌓이면 별도 lineage로 생성한다.

## 10. Trend detector: Moving Boundary

### 10.1 핵심 계약

Trend는 모든 candle에 OLS를 맞춘 평균선이 아니다. 지역 최고점 또는 최저점의
endpoint family가 만드는 한쪽 경계다. wick 통과는 작은 비용으로 허용하지만 body와
close-through는 큰 비용으로 다룬다. random RANSAC은 쓰지 않는다.

### 10.2 anchor bank

- `lower`: confirmed structural swing low.
- `upper`: confirmed structural swing high.
- scale 5/13 또는 scale 2이면서 prominence `>=0.75`인 atom만 structural이다.
- 방향별 NMS 후 현재 prefix에서 confirmed된 structural cluster를
  `observedAt desc, confirmedAt desc, clusterId asc`로 정렬해 최대 12개만 유지한다.
- seed pair의 bar separation은 최소 12다.
- 방향별 pair 수는 최대 `12 choose 2 = 66`이다.

### 10.3 sparse line-hypothesis Field와 robust refine

Trend는 anchor pair마다 바로 candidate를 만들지 않는다. 먼저 같은 방향의 structural
`RoleBasis` 두 개를 잇는 최대 66개 hypothesis를 만든다. 각 선은 screen slope/intercept가
아니라 현재 snapshot 양 끝에서의 가격으로 표현한다.

```text
theta_h = (y_h(0), y_h(239))
seedMass_h = sqrt(roleMass_a*roleMass_b) * clamp(pairSeparation/96,0.25,1)
```

이 `(y_first,y_last)` 평면이 Trend의 sparse dual-space Field다. dense Hough accumulator,
KDE grid, random RANSAC은 만들지 않는다. 같은 prefix의 `dualScale`은 earliest structural
Basis부터 prefix까지 ATR-ready bar의 median이며 두 hypothesis 거리는 다음과 같다.

```text
dualDistance(h1,h2) = max(
  abs(yFirst_h1-yFirst_h2)/dualScale,
  abs(yLast_h1-yLast_h2)/dualScale
)
```

hypothesis를 `seedMass desc, confirmedAt asc, hypothesisId asc`로 정렬한다. 아직 배정되지
않은 첫 hypothesis를 seed로 삼고 `dualDistance<=0.50`인 것만 같은 mode에 넣는다. 새로
들어온 member를 중심으로 다시 확장하지 않는 **seed-centered grouping**이므로 transitive
chain이 멀리 떨어진 선을 한 mode로 합치지 않는다. 각 mode의 대표 thread는 member
hypothesis의 weighted medoid이고 시작·끝 weighted MAD가 ribbon dispersion이다.

mode는 다음 순서로 실제 Boundary geometry가 된다.

1. 대표 thread와 corridor 최단거리가 `<=0.50*localATR`인 structural Basis의 합집합을
   compatible set으로 잡는다. pair가 같은 Basis를 반복 참조해도 Basis는 한 번만 들어간다.
2. 대표 thread와
   `provisionalTrendZone=max(2*tickSize,0.25*dualScale)`을 기준으로 11.1 separation을
   시간순으로 정확히 한 번 적용해 mode-local `FormationEpisode`를 만든다.
3. 독립 episode가 2개 미만이거나 contribution 사이 `>=12`봉인 pair가 없으면 mode는
   `weak`로 남는다. raw hypothesis 수는 touch count나 support mass가 아니다.
4. episode contribution 중 `>=12`봉 떨어진 모든 pair slope를 만들고 다음 weight의
   weighted median으로 slope `m`을 refine한다.

```text
pairWeight(a,b) =
  sqrt(contributionRoleMass_a*contributionRoleMass_b)
  * clamp(separationBars/96,0.25,1)
```

5. `r_e = endpointPrice_e - m*x_e`에서 lower는 weighted 0.20 quantile, upper는 0.80
   quantile을 intercept seed로 삼는다. 이는 candle 평균을 지나는 회귀선이 아니라 관측
   family의 한쪽 경계를 만든다.
6. `trendZoneHalfWidth=max(2*effectiveTick,0.25*candidateMedianATR)`를 revision의 고정 폭으로
   둔다. intercept seed 주변 `±0.35*candidateMedianATR` 안의 `r_e`,
   `r_e±trendZoneHalfWidth`, 양 끝을 열거하고 아래 asymmetric loss가 최소인 intercept를
   선택한다.

```text
u_e = abs(endpointPrice_e - (m*x_e+b))/localATR_at_observedAt_e

Huber(u, delta=0.25) =
  0.5*u^2                 if u<=0.25
  0.25*(u-0.125)          otherwise

anchorHuber = weightedMean(Huber(u_e), weight=contributionRoleMass_e)
boundaryPenalty = 1 - integrity(proposed line over fitBars)
loss = anchorHuber + boundaryPenalty
```

`compatibleContributions`는 mode-local episode마다 정확히 한 개다. `fitBars`는 earliest
contribution부터 `revisionFormedAt`까지의 ATR-ready candle이고 `candidateMedianATR`도 그
구간에서 계산한다. anchor loss는 contribution만, one-sided body/close opposition과
integrity는 fitBars의 relevant candle만 사용한다. integrity domain이 비면 loss는
`+infinity`다. 모든 penetration은 8.4의 bounded loss이므로 한 돌출이 선을 끌어당기는
이익에는 상한이 있다.

7. final line과 모든 contribution corridor의 거리가 `<=0.50*localATR`인지 검사하고
   episode를 반복 regroup하지 않는다. mode support는 unique episode contribution을 한 번씩
   합산하고, opposition은 fitBars의 bounded body/close acceptance로 별도 보존한다.
8. 시작·끝 projected price 차이가 모두 `<=0.25*candidateMedianATR`이고 episode Jaccard가
   `>=0.5`인 mode는 support mass, 더 작은 dispersion, 더 이른 first-seen prefix,
   `fieldModeId` 순으로 하나만 남긴다.

fit 내부의 `x`는 CandleTape ordinal `0..239`다. 저장·비교할 때는 current fit의 earliest
contribution candle key를 `indexOriginCandleKey`로 정하고 그 bar의 projected price를
`interceptAtOrigin`으로 운반한다. 서로 다른 snapshot/revision의 drift는 raw intercept가
아니라 공통 candle key의 projected price로 비교한다.

Field와 mode는 confirmed anchor prefix에서만 생성한다. coherent mode가 처음 gate를
통과한 시점과 두 initial episode를 소급 변경하지 않는다. 이후 candle은 먼저 고정 revision의
Interaction으로 평가하고 refit은 3.2의 terminal-state/freeze 규칙을 따른다. production
Czardas Field는 selector 전의 mode ribbon과 제한된 representative thread를 보여주므로
평행·발산·수렴 구조와 no-draw의 충돌 상태가 최종 선 없이도 보인다.

### 10.4 접촉과 integrity

각 bar에서 `y=m*x+b`를 계산한다.

- lower wick violation: `low < y-zone`.
- lower body violation: `bodyLow < y-zone`.
- lower close violation: `close < y-zone`.
- upper는 부등호를 반대로 한다.
- zone 안 endpoint는 touch다.
- 연속 touch는 공통 episode FSM으로 하나만 센다.

Trend hard gate는 다음과 같다.

- 독립 formation episode `>=2`이고 모든 contribution corridor가 final line에서
  `<=0.50*localATR`.
- 8.4의 `formationSpanBars>=20`.
- body integrity `>=0.75`, close integrity `>=0.85`.
- seed quality `>=0.50`.
- normalized absolute slope `abs(m)/candidateMedianATR <=0.15`.
- fit domain 안의 단발 penetration은 gate에서 즉시 break로 취급하지 않음.
- fit domain 끝에서 8.4의 열린 2봉 close-through break가 없음.

gate를 통과한 Trend는 `formed`다. `revisionFormedAt` 이후 첫 독립 hold/rejection이 있으면
`verified`가 되어 rank가 올라가지만 verification이 없어도 output 후보가 될 수 있다.

### 10.5 break

11.3의 공통 break를 그대로 사용한다. Trend 전용 임계값을 별도로 두지 않는다.

## 11. 공통 Interaction Evaluator

### 11.1 episode FSM

```text
outside -> approach -> contact(pending) -> hold/reject | neutral -> latched -> outside
                                      \-> break -> candidate broken
```

- candidate revision당 active Interaction은 최대 하나다.
- `approach`: 유효 방향에 있는 candle range와 line zone 사이 최단거리가 `<=1.0 ATR`.
- `contact`: candle range와 line zone이 처음 겹치거나 wick/body/close가 invalid side를
  처음 관통함. gap으로 zone을 건너뛰어도 penetration이면 contact다.
- `hold/reject`: break 없이 최소 excursion과 response gate를 통과함.
- `neutral`: horizon이 끝났지만 break도 유의한 response도 없음.
- `break`: close-through 규칙 충족.
- `pending`: 필요한 response horizon이 아직 닫히지 않음.
- `latched`: hold/reject 또는 neutral terminal 뒤 같은 머무름을 다시 세지 않도록
  separation reset을 기다리는 evaluator 상태. Interaction outcome에는 저장하지 않는다.

approach가 contact 없이 다시 `>1.0 ATR`로 멀어지면 event를 만들지 않고 outside로
취소한다. contact 뒤 horizon 안의 이탈·재접촉은 전부 같은 episode다. terminal 뒤에는
completed close가 유효 방향 zone edge에서 `>=0.75 localATR` 떨어진 첫 bar, 또는 close가
유효 방향의 zone 밖에 3봉 연속 머문 세 번째 bar에서만 reset한다. 그 bar를 `leaveAt`으로
기록하고 **그 다음 bar부터** 새 approach/contact를 허용한다. break는 candidate를 끝내므로
reset하지 않는다. latched 중에도 11.3 break 감시는 계속한다.

한 episode는 `(candidateId, testedRevision)`에 귀속된다. lineage의 다른 revision에
중복 점수화하지 않는다. H-Line formation과 Trend formation에서 9.2/10.3이 수행하는
mode-local separation도 같은 reset 의미를 사용하되 provisional mode boundary를 기준으로
cluster 사이 candle을 replay한다.

### 11.2 response horizon

candidate의 8.4 `formationSpanBars`로 horizon을 정한다.

| `formationSpanBars` | horizon |
| --- | ---: |
| 20~47봉 | 3봉 |
| 48~95봉 | 5봉 |
| 96봉 이상 | 8봉 |

Horizon 3/5/8 checkpoint를 debug trace에 남기되 최종 판정은 해당 candidate horizon을
사용한다. as-of가 horizon보다 이르면 `pending`으로 제외한다.

`InteractionEvent.terminalAt`은 실행 가능한 계약으로 다음처럼 기록한다.

- pending: `null`.
- hold/reject 또는 neutral: break가 먼저 없었다면 `contactAt+horizon`의 완료봉 key.
- break: 11.3의 두 번째 연속 close-through 완료봉 key.
- `leaveAt`: hold/reject 또는 neutral terminal 뒤 11.1 separation reset을 처음 만족한 bar이며
  terminalAt과 별도다. pending과 break에서는 `null`이다.

latched hold/neutral이 reset 전에 break로 바뀌면 같은 episode의 최종 state와 terminalAt은
break로 갱신하고, debug transition trace에는 앞선 horizon 판정 fact도 남긴다. 새 episode로
세거나 앞선 strength를 다른 candidate에 옮기지 않는다.

완료 interaction의 평가 구간은 contact bar를 0으로 할 때
`[contactAt+1, contactAt+horizon]`의 닫힌 구간이다. Trend의 `y_k=m*k+b`는 각 bar에서
다시 계산한다. 한 interaction 안의 excursion과 penetration 정규화에는 contact bar의
확정 `atrScale_contact`를 사용한다. 8.4의 fit/integrity depth는 각 bar의 `localATR_k`를
쓰므로 둘을 섞지 않는다. support/lower에서 다음 event depth를 쓰고 상단은 부등호만
반대로 한다.

```text
eventWickDepth_k  = max(0,y_k-zone-low_k)     / atrScale_contact
eventBodyDepth_k  = max(0,y_k-zone-bodyLow_k) / atrScale_contact
eventCloseDepth_k = max(0,y_k-zone-close_k)   / atrScale_contact

eventBodyAcceptance_k  = bounded(4*eventBodyDepth_k)
eventCloseAcceptance_k = bounded(8*eventCloseDepth_k)
excursionAtr = max(0,max(close_k-y_k for k=contactAt+1..contactAt+horizon))
               / atrScale_contact

explorationPressure = max(bounded(eventWickDepth_k) from contactAt through contactAt+horizon)
acceptanceMass = mean(max(eventBodyAcceptance_k,eventCloseAcceptance_k) over the same bars)
acceptanceRun = max consecutive bars with eventCloseDepth_k>0.25

reclaimLag = first bar offset from contactAt whose close returns to the valid side of the zone
reclaimSpeed = 0                         if no reclaim exists
               1-reclaimLag/(horizon+1) otherwise

holdIntegrity = 1 - acceptanceMass

responseScore =
  0                                      if confirmed break
  clamp(
    0.45*excursionAtr
    + 0.30*holdIntegrity
    + 0.25*explorationPressure*reclaimSpeed*(1-acceptanceMass),
    0, 1
  )                                      otherwise
```

contact candle 자체가 유효한 쪽에서 닫히면 `reclaimLag=0`이다. 돌출 깊이인
`explorationPressure`는 혼자서는 점수를 올리지 않고 빠른 복귀와 낮은 acceptance가 함께
있을 때만 강한 시험 후 반응으로 인정된다. body/close 수용은 양의 pressure가 아니라
`acceptanceMass`와 break에만 기여한다. 얕은 일반 접촉, 긴 wick, body 관통, 종가 이탈을
모두 같은 수식으로 처리하며 `failed breakout` 전용 분기는 만들지 않는다.
resistance/upper의 excursion은 같은 구간에서 `max(0,max(y_k-close_k))/atrScale_contact`다.

`excursionAtr>=0.25`이고 `responseScore>=0.45`인 completed episode만 hold/reject 및
verification이다. horizon 종료 시 둘 중 하나라도 부족하면 `neutral`이며 strength를
올리지 않는다. break 감시는 response horizon과 무관하게 formed 이후 매 완료봉에서
계속된다.

### 11.3 공통 break

H-Line과 Trend 모두 같은 close-through 규칙을 쓴다. line `y_k`와 zone은 각 bar에서
평가한다.

- 각 bar의 normalized `fitCloseDepth_k=rawCloseDepth_k/localATR_k >0.25`가 완료봉
  2개 연속. 가격 거리로는 각 bar에서 `0.25*localATR_k` 초과와 같다.

단일 candle은 깊이·body 크기와 관계없이 그 자체만으로 confirmed break가 되지 않는다.
wick만 통과하거나 live candle이 통과한 것도 break가 아니다. 이는 돌출봉 전용 예외가
아니라 “탐색의 크기보다 경계 밖 종가의 지속이 가격 수용을 뜻한다”는 공통 정의다.
H-Line은 slope 0, Trend는 해당 revision의 slope로 `y_k`를 계산한다.

### 11.4 POC에서 기록할 interaction fact

POC는 nearby random/null line, fatigue, 예측 수익률을 계산하지 않는다. candidate마다
다음 관찰 사실만 남긴다.

- formation episode ID 2개 이상.
- formed 이후 verification count와 마지막 시각.
- wick/body/close penetration count.
- interaction별 exploration pressure, acceptance mass/run, reclaim speed, response score.
- confirmed break 여부와 시각.
- pending interaction 여부.

## 12. BoundaryRank

rank는 후보를 고르기 위한 단순 정렬값이지 정확도나 미래 수익 확률이 아니다.

```text
baseRank = 0.50*seedQuality + 0.30*integrity + 0.20*persistence
verificationMass = sum(responseScore of completed post-formation hold/rejection episodes)
verificationBonus = 0.05*min(verificationMass, 2)
profileBonus = 0.05*profileConfluence  # H-Line only

HLineRankScore = clamp(baseRank + verificationBonus + profileBonus, 0, 1)
TrendRankScore = clamp(baseRank + verificationBonus, 0, 1)
```

verification은 단순 횟수가 아니라 경계의 영향을 받은 독립 episode의 반응 품질을
합치며 최대 0.10이다. estimated price-volume은 H-Line에서 최대 0.05만 보강한다.
geometry와 body/close integrity가 낮은 후보를 이 bonus가 구제하지 못하도록 hard gate를
먼저 적용한다. 현재 가격과의 거리는 rank 자체가 아니라 selector의 작은 relevance
tie-break로만 사용한다. null comparison, fatigue, 자동 threshold 최적화는 POC 이후다.

## 13. Triangle relation: Compression

Triangle은 candidate, Boundary, detector lineage가 아니다. 15장에서 H-Line과 Trend
선택을 모두 끝낸 뒤, 선택된 unbroken upper/lower Trend의 현재 관계를 읽는 pure
classifier다. relation의 존재 여부가 Trend fit, rank, selector, ID, anchor, extension을
바꾸면 구현 오류다.

### 13.1 관계 gate

- 각 Trend가 `formed` 또는 `verified`이고 broken이 아님.
- `relationFrom=max(upper.observedDomain.from,lower.observedDomain.from)`,
  `relationTo=asOf`인 닫힌 `relationDomain`이 `>=24`봉.
- `relationMedianATR=median(localATR_k over ATR-ready relationDomain)`.
- 모든 bar에서 `width_k=upperY_k-lowerY_k>0`.
- close containment는
  `lowerY_k-lowerZone <= close_k <= upperY_k+upperZone`인 bar 비율.
- body containment는
  `lowerY_k-lowerZone <= bodyLow_k`이고
  `bodyHigh_k <= upperY_k+upperZone`인 bar 비율. 비교는 경계를 포함한다.
- relationDomain 내 close containment `>=0.90`.
- relationDomain 내 body containment `>=0.85`.
- `startWidth=width_relationFrom >=1.0*relationMedianATR`.
- `latestWidth=width_asOf`, `latestWidth/startWidth`가 `0.20~0.85`.
- 두 선이 as-of 이전에 교차하지 않음.
- 두 center line의 계산된 apex가 as-of 뒤 `0~1.0*relationDomainBars` 안.

### 13.2 종류

slope는 공통 `relationMedianATR/bar` 단위로 정규화한다.

- ascending: `abs(upperSlope)<=0.02`, `lowerSlope>=+0.02`.
- descending: `upperSlope<=-0.02`, `abs(lowerSlope)<=0.02`.
- symmetrical: `upperSlope<=-0.02`, `lowerSlope>=+0.02`.

다른 조합은 `null`이다. 종류는 현재 수렴 geometry의 설명이지 돌파 방향 예측이 아니다.
v1은 breakout state, frozen snapshot, invalidated/retired lifecycle을 만들지 않는다.

### 13.3 하나의 presentation relation 선택

Trend output은 최대 3개이므로 선택된 upper/lower 조합은 최대 2개다. gate를 통과한
조합마다 다음 presentation 품질만 계산한다.

```text
contractionRatio = latestWidth/startWidth
contractionQuality = clamp((0.85-contractionRatio)/0.65, 0, 1)
containmentQuality = 0.5*closeContainment + 0.5*bodyContainment
boundaryQuality = harmonicMean(upper.rankScore, lower.rankScore)
relationQuality =
  0.70*boundaryQuality + 0.20*contractionQuality + 0.10*containmentQuality
```

가장 높은 `relationQuality`, 더 큰 relationBars, `upperCandidateId|lowerCandidateId`
사전순으로 하나만 고른다. 이 점수는 pattern끼리 표시 우선순위만 정하고 Trend 선택에는
사용하지 않는다.

```text
triangleId = sha256(symbol|interval|kind|upperCandidateId|lowerCandidateId)
```

relation이 있으면 기존 두 Trend drawing의 ID와 geometry는 그대로 두고 lineWidth만 3으로
표현하며 badge 하나를 표시한다. relation이 사라지면 같은 drawing ID의 lineWidth가 2로
돌아가고 badge만 사라진다.

## 14. identity와 revision

### 14.1 stable ID

```text
candidateId = sha256(
  symbol | interval | kind | originRole | "initial" |
  sorted(initialFormationEpisodeIds)
)
```

`asOf`, 최신 가격, float geometry는 ID에 넣지 않는다. ID는 lineage를 나타내고
initial `modelRevision=1`이며 성공한 same-lineage refit에서만 1씩 증가한다.

chronological rebuild에서 lineage 귀속은 다음 규칙으로 고정한다.

1. 두 독립 episode가 처음 함께 formed gate를 통과한 prefix에서 initial lineage를 만든다.
   같은 prefix의 동률은 `(confirmedAt, episodeId)` 순으로 푼다.
2. initial formation episode ID는 lineage 수명 동안 바꾸거나 다른 lineage에 넘기지 않는다.
3. 3.2가 허용한 새 compatible episode는 기존 lineage의 **기존 fit set + 새 episode**로만
   refit한다. 다른 후보의 더 좋은 initial pair로 소급 재부모화하거나 두 lineage를 merge하지
   않는다.
4. refit이 hard gate, 사전식 `(seedQuality,integrity)` 개선, 14.2 tolerance를 모두 통과하면
   같은 ID의 `modelRevision`을 1 올린다. 하나라도 실패하면 old revision을 그대로 유지한다.
   tolerance 밖의 geometry가 필요하면 detector가 새 initial pair의 독립 candidate로 만들어
   경쟁시키며 parent history를 상속하지 않는다.
5. dedupe는 같은 prefix의 candidate bank에서 표시할 winner만 남긴다. loser의 ID,
   initial evidence, interaction history를 winner로 옮기지 않는다.
6. 모든 동률은 더 작은 geometry drift, 더 높은 pre-update rank, 더 이른
   `lineageFormedAt`, candidate ID 사전순으로 결정한다. rebuild마다 같은 event order를
   재생하므로 외부 incremental state 없이 같은 lineage와 revision을 복원해야 한다.

같은 prefix의 서로 다른 provisional seed가 동일한
`kind/role/initialFormationEpisodeIds`를 만들면 candidate를 두 개 생성하지 않는다. lifecycle
삽입 전에 같은 `candidateId`의 genesis proposal을 coalesce하고, 높은 seedQuality, 높은
integrity, 높은 persistence, 작은 zoneHalfWidth, 작은 `abs(slope)`, canonical
`(slope, priceAtOrigin, sorted(fitEpisodeIds))` 사전순으로 하나를 고른다. 이는 아직 history가
없는 같은 lineage의 생성 제안을 정규화하는 것이며 15장의 dedupe loser history transfer가
아니다.

stable ID의 보장은 initial formation episode가 최신 240봉 안에 남아 있는 동안이다. window
왼쪽에서 그 episode가 빠지면 기존 lineage는 retired되고, 뒤의 두 episode가 같은 가격선을
다시 만들더라도 새 candidate ID다. 서버의 과거 state로 이를 억지로 이어 붙이지 않는다.

### 14.2 같은 lineage 허용 범위

- H-Line center drift는 **old revision**의 `candidateMedianATR` 기준
  `<=0.35*oldCandidateMedianATR`.
- Trend는 old revision `observedDomain.from/to` 두 candle key에서 old/new projected price를
  비교하고, 각 key의 `localATR` 기준 차이가 모두 `<=0.35*localATR_at_key`여야 한다.
- 추가로 `abs(deltaSlope)*oldObservedSpan <=0.50*oldCandidateMedianATR`이어야 한다.

old domain key는 initial lineage가 exact-240 안에 있는 동안 tape에 존재한다. new revision의
더 넓어진 domain이나 새 ATR을 tolerance 기준으로 사용해 자기 drift 허용치를 키우지 않는다.

하나라도 넘으면 refit을 commit하지 않는다. detector가 새 initial pair로 hard gate를
통과시키면 그것이 별도 candidate ID로 `formed`에서 시작한다. 같은 lineage의 성공한 refit은
`fitEpisodeIds`, observed domain, `revisionFormedAt`을 다시 계산한다. 3.2에 따라 refit 가능한
candidate는 verification이 0이므로 strength 상속/reset 분기가 필요 없다.

### 14.3 drawing ID

```text
czardas:<candidateId>:line
```

H-Line과 Trend 모두 이 식 하나만 사용한다. Triangle relation이 생기거나 사라져도 두
Trend drawing ID는 바뀌지 않는다. revision도 drawing ID에 넣지 않으며
geometry/style/label만 update되어 selection이 유지된다. `triangleId`는 badge와 편집
group metadata일 뿐 drawing ID가 아니다.

## 15. selector와 출력 예산

### 15.1 replay와 candidate bank cap

chronological replay 중 살아 있는 lineage는 H-Line `16/role`, Trend `12/side`를 넘지
않는다. overflow에서는 broken/retired, formed, verified 순으로
제거한다. 같은 상태 안에서는 `rankScore`, 오래된 last interaction, ID 사전 역순으로
낮은 후보를 먼저 제거하고 debug reason `replay_lineage_cap`을 남긴다.

evidence/anchor cap은 새 seed와 refit 제안 수만 제한하고 formed candidate의 immutable
initial pair나 current fit set을 잘라내지 않는다. candidate가 retired되기 전 ID 근거를
cap eviction으로 잃으면 구현 오류다.

output selector 입력은 더 작게 제한한다.

- H-Line: support top 4, resistance top 4.
- Trend: lower top 3, upper top 3.
- Triangle relation: Trend 선택을 끝낸 뒤 upper/lower 조합 최대 2개만 평가.

hard gate와 lifecycle filter 후 bank를 만든다. display minimum `rankScore>=0.45`다.
오래된 evidence가 최신 작도를 지배하지 않도록 다음 `outputRelevance` 중 하나도
만족해야 한다.

- formation, verification, contact 중 하나가 최신 120봉 안에 있음.
- as-of projected line과 current close의 거리가 `<=3 ATR`임.

둘 다 아니면 geometry가 좋아도 production output에서는 제외한다. 전체 context는 경계를
형성하는 문맥이고, latest tail과 current distance가 실제 작도 대상을 정한다.

여기서 recent formation은 current `fitEpisodeIds`의 가장 늦은 `observedAt`, verification은
current revision의 가장 늦은 completed hold/reject, contact는 pending·neutral을 포함한
post-revision Interaction의 가장 늦은 `contactAt`이다. 최신 120봉은 exact-240 tape의
bar index `120..239`이며 화면의 120/104 render slot과 무관하다. 3.3의 `isRelevantNow`도
이 contact 정의를 사용한다.

### 15.2 제약

- H-Line과 Trend는 서로 독립적으로 선택한다. 한 layer의 후보가 다른 layer의 자리를
  차지하거나 점수를 낮추지 않는다.
- `hlineDisplayCount`는 `1..4`, 기본 `2`다. 실제 출력은 `0..hlineDisplayCount`다.
- `trendDisplayCount`는 `1..3`, 기본 `2`다. 실제 출력은 `0..trendDisplayCount`다.
- 최솟값 1은 설정값 검증의 하한이지 강제 drawing 수가 아니다. display gate를
  통과한 formed 후보가 없으면 해당 layer는 0개다.
- Trend lower와 upper는 별도 bank에서 독립 검출한다. output이 2개 이상이면 반드시
  lower와 upper를 하나 이상 포함한다.
- 기본 목표 2에서 양쪽 후보가 있으면 strongest lower 1개와 strongest upper 1개를
  고른다. 한쪽만 있으면 같은 쪽 두 개로 채우지 않고 1개만 출력한다.
- 목표 3에서는 lower 1 + upper 1을 먼저 확보한 뒤 어느 쪽이든 가장 강한 non-duplicate
  후보를 세 번째로 고른다. 목표 1에서는 양쪽 중 더 강한 하나를 고른다.
- Triangle은 추가 primitive가 아니다. 선택된 Trend의 upper/lower 두 선을 그대로
  constituent로 사용하며, 조건을 통과한 조합이 여러 개면 13.3의 relationQuality로
  하나만 presentation pattern으로 선택한다.
- 두 primary Trend는 수렴, 평행, 발산 모두 정상이다. Triangle 조건은 Trend 선택 후에
  평가하며 Trend slope/intercept/rank를 바꾸지 않는다. Trend 3개여도 유효 pair가 없으면
  `presentationPattern=null`이다.
- 낮은 품질 후보로 목표 개수를 채우지 않는다.

각 layer의 작은 capped bank에서 가능한 subset을 deterministic하게 열거한다. H-Line은
H-Line utility, Trend는 Trend utility와 위 role constraint만 본다. Triangle 가능성은
동률을 포함해 Trend 선택에 전혀 사용하지 않는다.

Boundary의 현재 거리는
`normalizedCurrentDistance = clamp(abs(current-y_asOf)/(3*localATR_asOf),0,1)`다.
selector는 각 layer의 semantic 후보를 line primitive로 확장한 뒤 layer 내부 pair
penalty를 계산한다.
같은 layer와 같은 역할인 H-Line support끼리, resistance끼리, Trend lower끼리,
upper끼리 near-duplicate similarity를 계산한다. 공통 observed domain 시작·끝에서의
projected distance ATR 평균을 `d`라 할 때 `max(0,1-d/0.75)`다. H-Line은 두 지점의
값이 같다. H-Line과 Trend 사이에는 penalty를 부과하지 않는다. 같은 Triangle 내부
upper/lower 쌍은 서로 다른 역할이므로 penalty 대상이 아니다.

공통 domain은 `from=max(two starts)`, `to=min(two ends)`다. `from>to`이면 서로 비교할
시간대가 없으므로 similarity는 0이다. 공통 domain이 있으면 정확히 그 from/to 두 candle
key에서 projected distance와 각 line의 localATR 평균을 사용한다.

```text
candidateUtility(c) = c.rankScore
                    + (0.05 if c.isRelevantNow else 0)
                    + 0.03*(1-c.normalizedCurrentDistance)

U_hline(S) = sum(candidateUtility(c) for c in S)
           - 0.10*sum(in-layer nearDuplicateSimilarity(a,b))

U_trend(S) = sum(candidateUtility(c) for c in S)
           - 0.10*sum(in-layer nearDuplicateSimilarity(a,b))
```

동률은 위 Trend role constraint, primitive 수가 적은 집합, semantic ID 사전순으로
푼다. 두 layer를 모두 최대로 설정했을 때 transport line은 파생적으로 최대 7개지만,
이것은 payload validation 상한일 뿐 두 layer를 서로 경쟁시키는 전역 product budget이
아니다.

## 16. drawing compiler와 소유권

### 16.1 primitive

- H-Line: 기존 `horizontalLine`, pack과 digest가 같은 240봉 snapshot의 첫 완료봉과
  as-of 완료봉 timestamp anchor 2개, extension `line`. formation timestamp는 설명
  metadata에만 남긴다.
- Trend: 기존 `trendLine`, 첫 fit timestamp와 as-of anchor, extension `ray`.
- apex는 future timestamp anchor를 만들지 않고 group metadata와
  `presentationPattern` payload에 둔다.
- 일반 H-Line과 Trend의 `style.lineWidth=2`다. Triangle relation이 선택한 두 Trend는
  같은 drawing의 presentation `style.lineWidth=3`만 적용한다.
- Trend drawing label은 비운다. Triangle 이름을 두 선에 중복해서 쓰지 않는다.
- 모든 engine drawing은 `locked=false`여서 사용자가 편집할 수 있다.
- managed drawing의 `createdAt=lineageFormedAt`, `updatedAt=asOf`로 두어 engine 실행 시각이
  content digest를 바꾸지 않게 한다. pack의 `generatedAt`만 wall-clock envelope다.

H-Line은 가격이 핵심인 무한 수평선이므로 과거 formation anchor가 화면 store 밖이라는
이유로 drawing을 버리지 않는다. czardas pack은 현재 240봉 snapshot과 digest가 일치할
때만 적용되므로 compiler가 그 snapshot 양 끝을 presentation anchor로 사용한다. Trend와
Triangle relation의 constituent는 시간 geometry가 의미이므로 이런 투영을 적용하지 않는다.

### 16.2 두 presentation layer와 패턴 badge

czardas production 화면의 좌측 하단에는 다음 두 toggle만 둔다.

```text
H-Line  -> czardasLayer == "hline"
Trend   -> czardasLayer == "trend" + triangle pattern badge
```

- 두 toggle은 기본 `on`이며 서로 독립적이다.
- toggle은 현재 ChartDocument/client session의 presentation state다. inference, API
  refetch, candidate selection을 다시 실행하지 않고 해당 drawing과 Czardas chart에서 같은
  역할의 Field branch visibility만 바꾼다.
  서버나 local persistence에 쓰지 않으며 새 document/reload에서는 둘 다 다시 `on`이다.
- `Trend=off`면 Trend drawing, Trend Field branch와 Triangle region/badge를 함께 숨긴다.
  `H-Line`에는 영향이 없다.
- `H-Line=off`면 H-Line drawing과 H-Line Field branch만 숨기고 Trend와 badge는 그대로
  보인다.
- 현재 단일 `geometry` visibility key를 drawing type으로 추측해 쪼개지 않는다.
  transport가 명시한 `czardasLayer`를 authoritative하게 사용한다.
- 두 Trend가 여러 Triangle을 만들 수 있어도 화면에는 15.2에서 고른 strongest pattern
  하나만 표시한다.
- 패턴 이름은 plot 내부 우측 상단에 `상승 삼각형`, `하락 삼각형`, `대칭 삼각형` 중
  하나로 표시한다. badge는 `DrawingEntity`가 아닌 overlay presentation이므로 line count,
  선택, undo/redo 대상이 아니다.
- constituent를 사용자가 편집하거나 삭제해 managed group이 fork/suppress되면 원래
  geometry에 대한 자동 패턴 주장을 유지할 수 없으므로 badge를 즉시 숨긴다. suppression
  등으로 두 managed 구성선 중 하나라도 실제 document에 없으면 남은 선도 강조하지 않고
  일반 2px로 렌더한다.

그리기 도구의 선 두께 UI는 모든 line drawing에 `1px/2px/3px` 세 단계만 노출한다.
authoritative `style.lineWidth`와 JSON schema는 기존 numeric 계약을 유지한다. 선택 시
정확히 1, 2, 3을 기록한다. 기존 문서의 다른 숫자는 그대로 렌더하고 UI에서 가장 가까운
단계를 표시하되, 사용자가 선택하기 전에는 값을 바꾸지 않는다. managed drawing의
두께 변경도 raw update가 아니라 `chart.czardas.forkManaged`를 사용한다.

### 16.3 `Czardas` chart type과 Field renderer

현재 authoritative chart type `candle | line | ohlc | bidask`에 `czardas`를 추가한다.
UI label은 `Czardas`, 내부 시각화 이름은 `Czardas Field`다. 이는 indicator pane이나
drawing이 아니라 동일 time×price 좌표를 쓰는 다섯 번째 base renderer다.

chart type 전환의 계약은 다음과 같다.

- 현재 viewport, interval, candle snapshot과 `CzardasPackContent`를 그대로 사용한다.
- kernel 실행, API refetch, candidate selection, drawing delta와 ChartDocument mutation을
  일으키지 않는다.
- 지원 interval은 engine과 같은 `1m/5m/10m/1h/4h/1D/1W`다. 일반 chart가 지원하는
  `1M`에서는 option을 disabled로 보이고 interval을 자동 변경하지 않는다. persisted
  `chartType=czardas + interval=1M`은 document load에서 `candle`로 normalize한다.
- standard MA·indicator·Volume Profile·comparison과 below-chart pane은 Czardas renderer에서
  그리지만 않을 뿐 사용자의 visibility 설정을 바꾸거나 저장하지 않는다.
- user-owned drawing은 계속 보인다. 다만 managed 원본에서 fork된 copy에는 engine Field의
  causal focus나 attribution connector를 연결하지 않는다.
- current asset의 `inputDigest`가 현재 completed snapshot과 일치할 때만 Field를 그린다.
  stale asset이면 저장 drawing은 `stale` badge와 낮은 opacity로 남길 수 있지만 과거 Field를
  최신 candle 위에 재투영하지 않는다. Czardas chart에는 Candle Fact와 `수동 재분석 필요`를
  보인다. missing/incompatible도 Candle Fact와 asset state만 보인다. exact input/repair 실패의
  unavailable reason은 chart asset GET 상태가 아니라 manual job panel에 표시한다.
- current `no-draw`는 정상 상태다. Basis와 weak/opposed mode는 보일 수 있지만 selected mode
  reference, Boundary와 managed drawing은 없다.

Field는 **후보 선택 전 detector가 읽은 상태**를 그린다. 계산 순서와 시각 문법은 다음처럼
1:1로 대응한다.

| inference state | renderer primitive | 의미 |
| --- | --- | --- |
| completed candle morphology | 낮은 opacity hollow body + wick | kernel이 읽은 OHLC anatomy |
| live candle | dashed outline | 화면에는 있으나 Basis를 만들지 않음 |
| H-Line `RoleBasis` | endpoint capsule + corridor footprint | 가격축 response에 더해진 관측 함수 |
| H-Line `SeedResponse` segments | horizontal response band + price-axis marginal | 선택 전 support/resistance landscape |
| H-Line mode | ridge contour와 dispersion 폭 | 독립 episode가 만든 가격 mode |
| H-Line opposition/profile | hatch notch / 얇은 별도 texture | body·close 수용 / estimated volume 보조 channel |
| Trend `RoleBasis` | endpoint diamond와 방향 ring | lower/upper 가설의 구조 anchor |
| `TrendHypothesis` | 가는 line thread | dual space에 실제로 놓인 pair hypothesis |
| `TrendFieldMode` | hypothesis medoid 주위 ribbon + refined contour | 가까운 가설의 dispersion과 실제 경계 geometry |
| selected mode reference | mode contour의 outline 강화 | selector가 읽은 source; mode 자체를 새로 만들지 않음 |
| Boundary / managed drawing | source mode 위의 zone과 2px/3px line | gate 결과와 편집 가능한 최종 제안 |
| Validation focus | episode, confirmation tether, residual, interaction trace | 선택한 경계를 검사하는 보조 overlay |
| Triangle relation | 두 selected Trend 사이 compression region | 새 가설·선이 아닌 사후 relation |

H-Line response band는 `hlineResponseSegments`의 exact interval field segment를 pixel로
옮긴 것이며 임의 KDE나 부드러운 heatmap이 아니다. profile texture도 운반된 effective bin 값만
쓴다. seed band의 농도는 raw Basis response라는 **provisional landscape**이며 독립 touch
수나 경계 strength로 표시하지 않는다. episode-compressed support와 dispersion은 mode
contour에만 표현한다. Trend ribbon은 mode의 weighted medoid와 시작·끝 dispersion을 잇고, raw
hypothesis를 합한 가짜 평균선을 만들지 않는다. 대표 thread는 bounded view일 뿐 full trace의
모든 member는 derivation digest로 재현된다. 선이 선택되지 않아도 예산 안의 strongest
weak/coherent/opposed mode를 그려야 하므로 selector를 제거한 실행에서도 pre-selection
Field가 byte-identical해야 한다.

색만으로 role을 구분하지 않는다. H-Line/Trend는 capsule/diamond, 위·아래 역할은 방향,
mode 상태는 contour/dash/hatch를 함께 쓴다. `roleMass`는 같은 role 안에서만 glyph 크기나
band 밀도로 표현하며 보편 candle importance, 확률, 매수·매도 강도로 바꾸지 않는다.
`rankScore`도 opacity나 퍼센트 gauge가 아니다.

formation, residual, 탐색–수용–반응과 lifecycle은 중요한 검증 정보지만 기본 landscape를
대신하지 않는다. hover/focus에서 저장된 validation glyph만 펼치며 프런트가 새 episode나
점수를 계산하지 않는다. 선택된 source mode가 일반 projection cap 밖이어도 해당 mode와
derivation metadata는 반드시 보존한다. 반대로 current Field를 selected drawing에 맞춰
warping하거나 selected fact만 남기는 것은 금지한다.

verified/frozen Boundary의 source revision이 current landscape mode revision과 다르면 둘을
합치지 않는다. current mode ribbon은 그대로 그리고 frozen `selected_source` contour를
별도 outline으로 겹쳐 drawing의 실제 기원을 보인다. 같은 revision이면 하나의
`landscape_and_selected` mode로 그린다.
전역 `BasisGlyphDto.roleMassAtAsOf`는 current landscape용이다. frozen source를 focus할 때는
mode의 `representativeContributions.roleMassAtRevision`을 사용하며 current Basis glyph의
크기를 과거 값처럼 다시 칠하지 않는다.

`H-Line` toggle은 H-Line Basis/response/mode/managed drawing을, `Trend` toggle은 Trend
Basis/hypothesis/mode/managed drawing과 Triangle relation을 함께 숨긴다. Candle morphology는
항상 남는다. 이는 presentation filter이며 재추론하지 않는다.

renderer의 허용 책임은 DTO validation, candle key/price의 pixel 변환,
clipping/theme/accessibility와 위 primitive의 painting뿐이다. field segment, mode grouping,
role mass, dispersion, episode, residual, outcome을 OHLCV에서 재계산하지 않는다. 선택된
`sourceFieldModeId+sourceFieldRevision` geometry와 drawing의 화면 오차는 동일 viewport에서
`<=0.5 device pixel`이어야 한다.

### 16.4 설명 payload

각 semantic candidate는 다음을 제공한다.

```json
{
  "claim": "최근 가격대에서 지지 경계가 형성됨",
  "because": ["독립 형성 2회", "형성 이후 반응 1회", "OHLCV 추정 거래량 밀집도 0.72"],
  "against": ["몸통 관통 1봉"],
  "state": "verified",
  "invalidationCondition": "경계 반대편 0.25 ATR 초과 종가 이탈 2봉",
  "dataQualifier": "OHLCV 기반 추정 volume-at-price"
}
```

설명은 계산된 fact와 reason code에서 다음 고정 template으로 만든다. LLM을 호출하거나
자유 문장을 생성하지 않는다.

- claim은 다음 exact string 표만 사용한다.

| role | formed | verified |
| --- | --- | --- |
| support | 최근 가격대에서 지지 경계가 형성됨 | 최근 가격대에서 지지 경계가 형성되고 이후 반응으로 확인됨 |
| resistance | 최근 가격대에서 저항 경계가 형성됨 | 최근 가격대에서 저항 경계가 형성되고 이후 반응으로 확인됨 |
| lower | 최근 저점들이 하단 추세 경계를 형성함 | 최근 저점들이 하단 추세 경계를 형성하고 이후 반응으로 확인됨 |
| upper | 최근 고점들이 상단 추세 경계를 형성함 | 최근 고점들이 상단 추세 경계를 형성하고 이후 반응으로 확인됨 |

- `because`는 `독립 형성 {fitCount}회`, verification이 있으면
  `형성 이후 반응 {completedCount}회`, H-Line profile bonus가 양수면
  `OHLCV 추정 거래량 밀집도 {profileConfluence:.2f}` 순이다.
- `against`는 current fit domain과 completed post-revision interaction의 unique bar 중
  depth가 0보다 큰 수를 세어 `몸통 관통 {n}봉`, `종가 관통 {n}봉` 순으로 넣고 0인 항목은
  생략한다.
- invalidation string은 모든 role에서
  `경계 반대편 0.25 ATR 초과 종가 이탈 2봉`이다.
- data qualifier는 H-Line `OHLCV 기반 추정 volume-at-price`, Trend
  `OHLCV 구조적 endpoint`다.

숫자는 locale 없는 ASCII decimal이고 위 배열 순서는 고정한다. 이 규칙과 21장의 reason
priority가 production payload와 debug explanation을 함께 결정한다.

### 16.5 managed와 user-owned

- rollout presentation mode는 `geometry | czardas | off` 중 하나이며 current Geometry와
  czardas managed effect를 동시에 fetch/apply하지 않는다. mode 전환은 이전 engine의
  managed prefix만 제거하고 user-owned drawing은 보존한다.
- 새 formed 결과는 `ownership=czardas-managed`다.
- managed drawing은 stable ID delta로 add/update/remove한다.
- 현재 layer 전체 remove-all/add-all은 금지한다.
- frontend apply key는 `algorithmVersion|configVersion|inputDigest`이며 `generatedAt`을
  사용하지 않는다.
- 사용자가 anchor, style, text를 처음 바꾸면 하나의 chart command transaction이
  managed 원본 제거, 새 ID의 `user-owned` copy 생성, source lineage suppression 생성을
  원자적으로 수행한다.
- suppression은
  `{suppressionSetId, sourceKind:candidate|group, sourceId, sourceGroupId|null,
  reason:forked|deleted, createdAt}`이며 다음 snapshot에서 같은 candidate/group의 managed
  drawing 재추가를 막는다.
- user-owned copy는 자기 `sourceCandidateId`를 항상 보존하고 relation group이면
  `sourceGroupId`도 보존하되 이후 engine update 대상에서 제외한다.
- 사용자가 managed delete를 누르면 copy 없이 `reason=deleted` suppression을 만든다.
- user-owned drawing을 나중에 삭제해도 suppression은 유지한다.
- 명시적인 “자동 작도 복원” action만 suppression을 제거한다.
- selector에서 후보가 자연스럽게 빠져 engine이 managed drawing을 제거하는 경우에는
  suppression을 만들지 않는다.
- Triangle의 첫 constituent 편집은 두 선을 atomically user-owned로 copy하고 managed 두
  선을 제거한다. 사용자가 준 patch는 선택한 선 copy에만 적용하고 다른 copy는 기존
  geometry/style을 유지한다.
- Triangle relation 상태의 managed fork/delete는 group ID와 두 constituent candidate ID,
  총 3개 suppression을 같은 `suppressionSetId`로 기록한다. delete는 copy 없이 두 managed
  선을 모두 제거한다.
- undo/redo snapshot은 drawing과 suppression을 함께 되돌린다.

chart-engine에는 다음 user command를 additive로 등록한다.

```text
chart.czardas.forkManaged   {drawingId, drawingPatch}
chart.czardas.deleteManaged {drawingId}
chart.czardas.restoreManaged {sourceId}
```

첫 두 command는 drawing의 `sourceGroupId`가 있으면 위 group transaction으로 적용한다.
`forkManaged`는 copy/removal/suppression을 한 history entry로 만들고 기존 일반
`chart.drawing.update`가 managed drawing을 직접 수정하지 못하게 한다. group restore는
찾은 `suppressionSetId` 전체를 한 transaction으로 제거한다.

v1 user-owned copy와 suppression의 수명은 현재 `ChartDocument` runtime뿐이다.
`ChartDocument`와 `ChartDocumentSnapshot`에 `czardasSuppressions[]`를 추가해 같은
document의 undo/redo와 symbol/interval refresh 동안만 보존한다. 서버에는 shared
czardas-managed proposal만 저장하며 user-owned drawing, toggle, suppression은 API로
전송하거나 PostgreSQL에 저장하지 않는다. reload나 새 document에서는 편집이 사라지고
서버의 공통 proposal이 다시 적용된다.

## 17. output 계약

API가 전달하는 envelope 요약은 다음과 같다. `generatedAt`을 제외한 필드가 저장되는
deterministic `CzardasPackContent`이며 필드 이름은 구현 중 이 의미를 보존해야 한다.

```json
{
  "algorithmVersion": "czardas-v1",
  "configVersion": "czardas-config-v1",
  "timeContractVersion": "market-time-v1",
  "calendarVersion": "nyse-calendar-v1",
  "symbol": "NVDA",
  "interval": "1D",
  "asOf": "2026-07-10T04:00:00.000Z",
  "lastCandleKey": "2026-07-10",
  "generatedAt": "2026-07-13T00:00:00.000Z",
  "inputDigest": "sha256:...",
  "status": "ready",
  "coverage": {
    "state": "exact",
    "targetCompleted": 240,
    "actualCompleted": 240,
    "analysisBars": 240,
    "qualityFlags": []
  },
  "selection": {
    "hline": {"configuredCount": 2, "actualCount": 0},
    "trend": {"configuredCount": 2, "actualCount": 0}
  },
  "boundaries": [],
  "presentationPattern": null,
  "drawings": [],
  "czardasField": {
    "schemaVersion": 1,
    "sourceBars": 240,
    "basisGlyphs": [],
    "hlineResponseSegments": [],
    "hlineProfileBins": [],
    "hlineModes": [],
    "trendModes": [],
    "selectedModeRefs": [],
    "validationGlyphs": [],
    "relationGlyph": null,
    "projection": {
      "truncated": true,
      "omittedBasisCount": 0,
      "omittedHlineResponseSegmentCount": 0,
      "profileBinsOmitted": true,
      "omittedHlineModeCount": 0,
      "omittedTrendModeCount": 0,
      "omittedHypothesisCount": 0,
      "omittedValidationCount": 0
    }
  },
  "rejectSummary": {}
}
```

위 축약 예시는 profile bin을 생략했으므로 `profileBinsOmitted=true`이고
`projection.truncated=true`다. 실제 pack에서 profile을 싣는 경우 effective bin 전체가
`hlineProfileBins`에 들어가고 두 값은 다른 생략이 없을 때 `false`다.

production `boundaries`에는 selector가 고른 H-Line과 Trend만 들어간다. broken/retired와
거절 후보는 들어가지 않는다. 배열 필드는 항상 존재하고 nullable로 표시한 필드는 값이
없을 때 생략하지 않고 `null`을 쓴다.

```text
BoundaryDto = {
  candidateId: string,
  modelRevision: int,
  originFieldModeId: string,
  sourceFieldModeId: string,
  sourceFieldRevision: int,
  kind: "hline" | "trend",
  layer: "hline" | "trend",
  role: "support" | "resistance" | "lower" | "upper",
  lifecycle: "formed" | "verified",
  isRelevantNow: bool,
  line: {
    priceSpace: "linear",
    indexOriginCandleKey: string,
    slopePerBar: number,
    interceptAtOrigin: number,
    priceAtAsOf: number,
    zoneHalfWidth: number
  },
  observedDomain: {from: string, to: string, bars: int},
  formation: {
    initialEpisodeIds: [string, string],
    fitCount: int,
    lastFitObservedAt: string,
    seedQuality: number
  },
  verification: {
    completedCount: int,
    pendingCount: int,
    lastInteractionAt: string | null
  },
  lineageFormedAt: string,
  revisionFormedAt: string,
  normalizedCurrentDistance: number,
  rank: BoundaryRankDto,
  confluence: {
    estimatedProfile: number | null,
    volumeParticipation: number | null
  },
  explanation: ExplanationDto
}

BoundaryRankDto = {
  seedQuality: number,
  integrity: number,
  persistence: number,
  verificationCount: int,
  verificationMass: number,
  verificationBonus: number,
  profileBonus: number,
  rankScore: number
}

PresentationPatternDto = {
  triangleId: string,
  kind: "ascending_triangle" | "descending_triangle" | "symmetrical_triangle",
  displayName: "상승 삼각형" | "하락 삼각형" | "대칭 삼각형",
  upperCandidateId: string,
  lowerCandidateId: string,
  upperDrawingId: string,
  lowerDrawingId: string,
  relationFrom: string,
  relationBars: int,
  apexBarsFromAsOf: number,
  contractionRatio: number,
  closeContainment: number,
  bodyContainment: number,
  relationQuality: number,
  lineWidth: 3
} | null

ExplanationDto = {
  claim: string,
  because: string[],
  against: string[],
  state: string,
  invalidationCondition: string,
  dataQualifier: string
}
```

`czardasField`는 같은 content 안에 항상 존재하며 별도 lazy endpoint를 만들지 않는다.
ready no-draw에서도 Basis와 weak/opposed mode를 표시할 수 있고, chart type 전환이 새 동기화 상태나 요청을
만들지 않게 하기 위해서다.

```text
CzardasFieldDto = {
  schemaVersion: 1,
  sourceBars: 240,
  basisGlyphs: BasisGlyphDto[],
  hlineResponseSegments: HLineResponseSegmentDto[],
  hlineProfileBins: EstimatedProfileBinDto[],
  hlineModes: HLineFieldModeDto[],
  trendModes: TrendFieldModeDto[],
  selectedModeRefs: SelectedModeRefDto[],
  validationGlyphs: ValidationGlyphDto[],
  relationGlyph: RelationGlyphDto | null,
  projection: {
    truncated: bool,
    omittedBasisCount: int,
    omittedHlineResponseSegmentCount: int,
    profileBinsOmitted: bool,
    omittedHlineModeCount: int,
    omittedTrendModeCount: int,
    omittedHypothesisCount: int,
    omittedValidationCount: int
  }
}

BasisGlyphDto = {
  basisId: string,
  clusterId: string,
  observedAt: string,
  confirmedAt: string,
  endpointPrice: number,
  bodyEdgePrice: number,
  corridorLow: number,
  corridorHigh: number,
  kind: "hline_reaction" | "trend_endpoint",
  role: "support" | "resistance" | "lower" | "upper",
  effectiveScale: 2 | 5 | 13,
  roleMassAtAsOf: number,
  participation: number | null
}

HLineResponseSegmentDto = {
  segmentId: string,
  derivationDigest: string,
  role: "support" | "resistance",
  lowPrice: number,
  highPrice: number,
  responseMass: number,
  activeBasisCount: int
}

EstimatedProfileBinDto = {
  binIndex: int,
  lowPrice: number,
  highPrice: number,
  normalizedVolume: number
}

HLineFieldModeDto = {
  fieldModeId: string,
  fieldRevision: int,
  viewRole: "landscape" | "selected_source" | "landscape_and_selected",
  derivationDigest: string,
  role: "support" | "resistance",
  modeState: "weak" | "coherent" | "opposed",
  geometryState: "provisional" | "refined",
  firstSeenAt: string,
  ridge: {lowPrice: number, highPrice: number},
  centerPrice: number,
  zoneHalfWidth: number,
  supportMass: number,
  oppositionMass: number,
  dispersionAtr: number,
  contributorCount: int,
  independentEpisodeCount: int,
  representativeContributions: [{
    basisId: string,
    roleMassAtRevision: number
  }]  # max 6
}

TrendFieldModeDto = {
  fieldModeId: string,
  fieldRevision: int,
  viewRole: "landscape" | "selected_source" | "landscape_and_selected",
  derivationDigest: string,
  role: "lower" | "upper",
  modeState: "weak" | "coherent" | "opposed",
  geometryState: "provisional" | "refined",
  firstSeenAt: string,
  hypothesisMedoid: {yAtWindowStart: number, yAtWindowEnd: number},
  boundaryEstimate: {yAtWindowStart: number, yAtWindowEnd: number},
  dispersion: {startAtr: number, endAtr: number},
  supportMass: number,
  oppositionMass: number,
  contributorCount: int,
  independentEpisodeCount: int,
  representativeContributions: [{
    basisId: string,
    roleMassAtRevision: number
  }],  # max 6
  representativeHypotheses: [{
    hypothesisId: string,
    sourceBasisIds: [string, string],
    yAtWindowStart: number,
    yAtWindowEnd: number,
    seedMass: number
  }]
}

SelectedModeRefDto = {
  candidateId: string,
  modelRevision: int,
  kind: "hline" | "trend",
  sourceFieldModeId: string,
  sourceFieldRevision: int
}

ValidationGlyphDto = {
  validationId: string,
  candidateId: string,
  sourceFieldModeId: string,
  sourceFieldRevision: int,
  kind: "formation" | "fit" | "interaction",
  observedAt: string,
  confirmedAt: string | null,
  episodeId: string | null,
  clusterId: string | null,
  endpointPrice: number | null,
  bodyEdgePrice: number | null,
  corridorLow: number | null,
  corridorHigh: number | null,
  interactionId: string | null,
  initialFormation: bool,
  residualAtr: number | null,
  explorationPressure: number | null,
  acceptanceMass: number | null,
  responseScore: number | null,
  outcome: "response_pending" | "neutral_response" |
           "verified_response" | "confirmed_break" | null
}

RelationGlyphDto = {
  triangleId: string,
  upperCandidateId: string,
  lowerCandidateId: string,
  relationFrom: string,
  contractionRatio: number
} | null
```

`HLineResponseSegmentDto.derivationDigest`는 그 segment에서 활성인 정렬된
`basisId+roleMassAtAsOf`와 segment bounds를 hash한다. `responseMass`는 그 mass의 합이며
독립 episode count나 strength가 아니다. profile bin은 9.4의 최대 48-bin histogram을 global
max bin으로 정규화한 `[0,1]` 값이다.
formation/fit validation은 endpoint/body/corridor를 채우고 interaction validation은 이 네
필드를 `null`로 둔다. renderer는 cluster lookup이 생략됐다는 이유로 OHLCV에서 이를
재구성하지 않는다.

production Field view는 detector의 full pre-selection Field를 결정론적으로 줄인 것이다.
우선순위와 cap은 다음과 같다.

1. H-Line `SeedResponse` 중 active Basis가 2개 이상인 segment를 role별 최대 48개 고른다.
   cap 선택은 `responseMass desc, lowPrice, segmentId`, serialization은 role과 lowPrice 순이다.
2. role별 Basis를 `roleMass desc, observedAt desc, basisId asc`로 채우되 Field 전체 최대 64개다.
3. H-Line mode는 role별 최대 8개, Trend mode는 side별 최대 6개다. state priority
   `coherent -> weak -> opposed`, support mass, 작은 dispersion, first-seen prefix, mode ID
   순으로 고른다. selector 결과를 이 정렬에 넣지
   않는다.
4. estimated profile은 9.4가 만든 effective bin `1..48`개 전체를 가격순으로 싣거나 전부 생략하고
   `profileBinsOmitted=true`로 둔다. 일부 bin만 골라 profile 모양을 왜곡하지 않는다.
5. 각 mode의 representative contribution은 최대 6개이며 mode revision 당시의
   `roleMassAtRevision`을 함께 싣는다. Trend mode의 representative hypothesis는
   medoid와 양 극단을 포함해 최대 3개다.
6. selected Boundary의 `sourceFieldModeId+sourceFieldRevision`이 current landscape cap 밖이거나
   같은 mode의 과거 frozen revision이면 같은 role의 마지막 mode를 교체해
   `viewRole=selected_source`로 반드시 싣는다. current revision과 같으면
   `landscape_and_selected`다. 이는 current Field를 selected geometry로 바꾸는 것이 아니라
   drawing-source referential integrity를 보존하는 projection 규칙이다.
7. selected source mode의 모든 `representativeContributions.basisId`는 `basisGlyphs` cap에서
   같은 role의 마지막 항목을 교체해 반드시 싣는다. immutable endpoint/corridor는 Basis
   glyph에서, source 시점 weight는 contribution의 `roleMassAtRevision`에서 읽는다.
8. selected boundary별 최초 formation 2개, 최신 non-initial fit 최대 4개, 최신 completed
   Interaction 최대 3개와 pending 최대 1개만 `validationGlyphs`에 싣는다.

생략된 사실은 projection count에 명시하고 가짜 대표점으로 합치지 않는다. non-selected
mode의 representative contribution과 validation의 `clusterId`는 보이는 Basis에 들어가지 못할 수
있지만 full trace의 derivation edge로 역조회되어야 한다. selected source mode,
그 representative Basis와 initial
formation 두 개는 생략하지 않는다. no-draw에서도 Basis와 mode가 존재할 수 있고
`selectedModeRefs/validationGlyphs/drawings`만 비어 있을 수 있다. Field canonical JSON은
32 KiB 이하, 전체 pack은 64 KiB 이하를 동시에 만족한다.
위 array cap은 상한이지 목표치가 아니다. canonical byte 예산이 먼저 차면 같은 안정 정렬의
뒤 항목을 생략하고 count를 올린다. selected source mode와 initial formation을 넣고도 byte
예산을 넘으면 pack을 자르지 말고 `payload_limit_exceeded`로 build를 실패시킨다.

H-Line의 `confluence.volumeParticipation`은 current fit contribution별 episode
participation 산술평균이고 `estimatedProfile`은 9.4의 값이다. Trend는 volume을 쓰지
않으므로 두 필드 모두 `null`이다. `rejectSummary`는 production selector까지 도달한
거절 후보를 `{namespacedReason: count}`로 센 object이며 key는 사전순, 0 count는 생략한다.
선택 후보가 없고 거절 후보도 없으면 `{}`다.

`DrawingDto`는 현재 `DrawingEntity`의 필드를 모두 유지하고 다음을 필수로 더한다.

```text
ownership: "czardas-managed"
czardasLayer: "hline" | "trend"
sourceCandidateId: string
sourceFieldModeId: string
sourceFieldRevision: int
sourceGroupId: string | null
engineRevision: int
sourceProposalId: "czardas:" + candidateId
```

`engineRevision`은 source candidate의 `modelRevision`과 정확히 같다. 별도 drawing revision
counter를 만들지 않는다.

H-Line과 Trend 모두 `sourceCandidateId`가 non-null이고 candidate 기반 drawing ID를
쓴다. Triangle relation에 포함된 두 Trend만 같은 `sourceGroupId=triangleId`를 추가로
가진다. relation이 사라지면 sourceGroupId만 null이 되고 sourceCandidateId와 drawing ID는
그대로다.
transport `DrawingDto`는 현재 geometry contract처럼 symbol, interval, sourceInterval도
포함한다. frontend는 pack identity를 검증한 뒤 chart command를 만들 때 symbol과
interval을 벗겨내며 authoritative `DrawingEntity`에는 기존처럼 `sourceInterval`만
남긴다. 가격·점수 float는 finite 검증 후 최대 소수 8자리로 canonical round한다.

pack content의 `status`는 `ready` 하나다. 정확한 240봉 분석을 실행하지 못하면 manual job
item이 stable `AnalysisUnavailableReason`으로 실패하고 새 pack을 만들지 않는다. 기존 성공
asset은 그대로 남는다. `ready`여도 drawing 배열은 비어 있을 수 있다. 후보가 없다는 사실과
데이터가 부족하다는 사실을 구분한다.

asset GET envelope는 content와 별도로 `freshness=current|stale|missing|incompatible`를 가진다.
`current/stale`은 stored pack과 `generatedAt`을 반환하고 `missing/incompatible`은 pack을
`null`로 둔다. stale pack 안의 Field를 삭제해 저장 digest를 바꾸지 않고 client가 freshness에
따라 Field만 렌더하지 않는다. build running/failed reason은 panel job status에만 있다.

production pack의 `coverage.state`도 `exact` 하나이며 세 count는 모두 240이다. coverage
부족은 pack 변형이 아니라 manual job의 unavailable failure다.

## 18. PostgreSQL shared proposal과 수동 build

ClickHouse가 OHLCV source of truth이고 PostgreSQL은 모든 사용자에게 전달할 종목×interval별
latest CzardasPack과 수동 job 상태만 저장한다. v1에서는 기존 `작도 자산(개발)` 패널의
명시적 action만 build를 시작한다. chart open, GET miss, 새 완료봉, correction, schedule,
market event는 job을 만들지 않는다.

### 18.1 latest asset과 job table

기존 Geometry table을 건드리지 않고 Czardas 전용 table을 둔다.

```text
chart_assets.czardas_assets
  PRIMARY KEY (symbol, interval)
  algorithm_version, config_version
  time_contract_version, calendar_version
  as_of, last_candle_key, generated_at
  input_digest, payload_digest
  coverage_state, payload_bytes
  payload JSONB

chart_assets.czardas_build_jobs
chart_assets.czardas_build_items       # v1 job당 item은 정확히 한 symbol×interval
```

`geometry_assets`, `geometry_build_jobs/items`에 Czardas payload나 상태를 섞지 않는다. 현재
job store의 lease, cancel, polling, `FOR UPDATE SKIP LOCKED`를 asset-kind parameter로
추출해 재사용할 수 있지만 table과 worker 책임은 분리한다. Czardas job ID는 `cza-`, 기존
Geometry job은 `cab-` prefix로 dispatch한다.

DB와 application validation은 exact coverage 240, Field 32 KiB, pack 64 KiB, H-Line
`<=4`, Trend `<=3`, transport line `<=7`을 함께 검사한다. `payload`에는 `generatedAt`을
제외한 canonical `CzardasPackContent`를 넣고 bytes/digest는 PostgreSQL JSONB 내부 표현이
아니라 공용 canonical serializer의 UTF-8 결과로 계산한다.

latest upsert 규칙은 다음과 같다.

- 더 오래된 `asOf` 결과는 거부한다.
- 동일한 full identity와 payload digest는 no-op다.
- 동일한 `algorithm/config/time/calendar/asOf/lastCandleKey/inputDigest`에서 payload digest가 다르면
  `determinism_violation`으로 저장하지 않는다.
- 더 최신 `asOf/lastCandleKey`, 같은 logical key correction의 새 input digest, 또는 수동으로 실행한 새
  algorithm/config/time/calendar version만 latest row를 교체할 수 있다.
- build 실패, 취소, 불완전 repair는 기존 성공 asset을 삭제하거나 덮지 않는다.

active-release pointer, inactive prebuild row와 자동 TTL은 v1에 만들지 않는다. 현재 실행
중인 수동 worker의 frozen version이 저장 identity가 되고 다음 성공적인 수동 build가 latest를
교체한다.

### 18.2 기존 패널을 통한 수동 API

기존 analysis-assets route를 additive하게 확장한다. `assetKind`를 생략하면 현재 Geometry
동작을 유지한다.

```text
GET    /api/charts/analysis-assets?symbol=NVDA&assetKind=czardas
GET    /api/charts/analysis-assets/coverage?assetKind=czardas
POST   /api/charts/analysis-assets/build
       {assetKind:"czardas", symbols:["NVDA"], intervals:["1D"], force:false}
GET    /api/charts/analysis-assets/build/{job_id}
POST   /api/charts/analysis-assets/build/{job_id}/cancel
DELETE /api/charts/analysis-assets?symbols=NVDA&intervals=1D&assetKind=czardas
```

Czardas build request는 `symbols`와 `intervals`가 각각 길이 1인 경우만 허용한다. index
universe, S&P500, symbol×interval cross product는 v1에 없다. manual upsert는 브라우저가
임의 JSON pack을 PUT한다는 뜻이 아니라, 인증된 패널이 deterministic server job 하나를
등록한다는 뜻이다. delete는 해당 pair의 Czardas latest asset만 지우며 Geometry와 사용자
메모리 drawing에는 쓰지 않는다.

### 18.3 exact-240 repair와 build transaction

수동 item 하나는 다음 순서를 지킨다.

1. frozen `MarketTimeContract`와 calendar version으로 최신 완료 target key 240개를 만든다.
2. ClickHouse를 `v2/split/regular/closed` policy로 읽고 head/interior/tail missing key를
   감사한다. SQL은 실행 환경 기본값과 관계없이 이 policy를 명시한다.
3. 누락이 있으면 기존 `AnalysisCandleRepairService` 계열의 expected-key, missing-range,
   Alpaca fetch, canonical materialize, session aggregation leaf primitive를 재사용해 **정확한
   missing range만** 보충한다.
4. Alpaca 원본은 split-adjusted regular-session으로 요청한다. `5m/10m/1h/4h`는 1Min을
   canonical materialize한 뒤 실제 session bucket으로 집계하고, 조기폐장을 고정 `+240m`로
   계산하지 않는다. `1W`는 canonical `1D`로만 수리·집계한다.
5. ClickHouse를 반드시 다시 읽어 newest exact 240, contiguous keys, `asOf/inputDigest`를
   확정한다. synthetic, carry-forward, zero-volume filler는 금지한다.
6. 같은 snapshot으로 Basis→Field→Boundary→drawing pack을 계산한다.
7. upsert 직전에 ClickHouse identity를 다시 감사한다. build 중 snapshot이 바뀌면 결과를
   버리고 audit부터 한 번만 더 수행한다. 두 번째에도 바뀌면
   `snapshot_changed_during_build`로 실패한다.
8. frozen version과 snapshot identity가 모두 같을 때만 PostgreSQL latest row를 upsert하고
   job item을 완료한다.

audit/repair round는 최대 2회다. 신규 상장 이력 부족, provider-confirmed empty, Alpaca
credential/network/rate-limit failure, unresolved gap, 239개 이하 결과는 unavailable이다.
repair 성공 여부를 Alpaca 응답으로 추측하지 않고 canonical ClickHouse 재조회로만 확정한다.
repair identity/range는 결정론적으로 만들어 retry가 같은 candle을 중복 materialize하지
않게 한다.

기본 chart와 Czardas는 서로의 상위 orchestration service를 호출하지 않는다. expected key,
range planner, Alpaca fetch, canonical materializer와 aggregation 같은 leaf primitive만
공유하고 ClickHouse를 협업 지점으로 쓴다. 어느 쪽이 먼저 누락을 채워도 다른 쪽의 다음
canonical query가 그대로 이득을 본다.

### 18.4 read, freshness와 패널 반영

asset GET은 read-only이며 miss/stale에서도 job을 enqueue하지 않는다. API는 저장 asset과
현재 canonical snapshot identity를 비교해 다음을 반환한다.

```text
current       stored asOf/inputDigest와 현재 exact-240 identity가 같음
stale         지원 version이지만 candle identity가 달라 수동 재분석 필요
missing       저장 row 없음
incompatible  schema/algorithm/config/time/calendar version을 현재 reader가 해석하지 못함
```

`current`일 때만 Czardas Field를 현재 candle 위에 표시한다. `stale` drawing은 badge와 낮은
opacity로 유지할 수 있지만 stale Field는 숨긴다. 성공 upsert/delete 뒤 패널은 요청한
client의 해당 `assetKind+symbol+interval` cache만 invalidate/refetch한다. 다른 client에게
push하지 않으며 모든 사용자는 다음 GET에서 같은 shared row를 읽는다.

### 18.5 금지 사항

- Czardas asset GET/chart open/miss가 Czardas kernel·repair·job enqueue·PG asset write를
  수행하는 것. 기본 chart candle query의 기존 on-demand fill은 이 금지에 포함하지 않는다.
- `CANDLE_CLOSED/CORRECTED`, reconnect, focus, schedule/Cron으로 자동 build하는 것.
- stale Field를 최신 candle 좌표에 맞춰 늘이거나 다시 계산해 표시하는 것.
- candle, raw hypothesis, rejected candidate ledger를 PostgreSQL에 대량 저장하는 것.
- Czardas 전용 Redis/S3/Kafka, active-release pointer, cross-client push를 추가하는 것.
- user-owned drawing, toggle, suppression을 shared proposal에 저장하는 것.

시장데이터 upstream 자체가 기존 Redis/Kafka/S3를 사용하는 것은 이 금지와 별개다.

## 19. inference Field, production Field view와 debug trace

세 층은 같은 것이 아니다.

- **Inference Field**: H-Line response segments와 Trend hypotheses/modes다. detector가 ridge와
  Boundary를 얻기 위해 실제로 읽는 authoritative intermediate이며 kernel 내부 계산이다.
- **Production Field view**: 같은 pack에 넣는 bounded serialization이다. Inference Field를
  바꾸지 않고 Basis, mode landscape, selected source reference와 최소 validation을 운반한다.
- **Full debug trace**: 모든 raw hypothesis, contributor edge, 거절 mode, revision과 interaction
  ledger를 보존하는 fixture/evaluator artifact다. PostgreSQL production payload에는 넣지 않는다.

full trace는 `Candle -> Evidence -> RoleBasis -> Hypothesis -> FieldMode -> Boundary ->
Interaction/Relation` edge, `observedAt/confirmedAt`, mode derivation input과 stable reason을
모두 보존한다. aggregate mode는 `derivationDigest`로 contributor set, 정렬, tolerance와
geometry를 byte-stable하게 재현할 수 있어야 한다.

Field view projector는 17장의 cap과 정렬만 수행한다. kernel의 response, grouping, mode,
dispersion, role mass나 selection을 다시 계산하지 않는다. 브라우저도 좌표와 style만 계산한다.
다음 검사는 필수다.

- selector를 disabled하거나 output count를 0으로 바꿔도 pre-selection Inference Field와
  mode digest가 동일하다.
- no-draw에서도 실제로 존재한 weak/coherent/opposed mode가 cap 안에서 보인다.
- 모든 개별 glyph의 source가 존재하고 aggregate mode가 derivation digest로 재현된다.
- selected Boundary와 drawing의 `sourceFieldModeId+sourceFieldRevision`이 같은 geometry를
  만들며 orphan ref가 0다.
- 같은 FormationEpisode는 support, fit, glyph에서 member 수만큼 중복 가산되지 않는다.
- `observedAt/confirmedAt`가 confirmation 지연을 숨기지 않는다.
- volume 변화는 Trend Field와 geometry를 바꾸지 않고 H-Line profile은 별도 channel에만 있다.
- renderer visibility/hover/style과 projection cap이 Inference Field, rank, selection을 바꾸지
  않는다.
- stale asset에서는 Field view가 숨고 과거 mode를 최신 candle에 맞춰 warping하지 않는다.

시각화 가능성은 Czardas 관점의 명료성과 auditability를 검증하지만 미래 예측 정확성을
증명하지 않는다. 차트를 그리기 위해 kernel에 없는 종합 점수, density, 곡선이나 인과
이야기가 필요하다면 renderer를 꾸미지 말고 Inference Field의 수학·자료구조를 고친다.

## 20. 기본 config

| key | value |
| --- | ---: |
| `atrPeriod` | 14 |
| `volumeBaseline` | 20 |
| `extremaRadii` | `[2,5,13]` |
| `hlineEvidenceCapPerRole` | 48 |
| `trendAnchorCapPerSide` | 12 |
| `trendMinPairSeparation` | 12 |
| `trendPairFullWeightBars` | 96 |
| `trendHypothesisModeToleranceAtr` | 0.50 |
| `hlineReplayLineageCapPerRole` | 16 |
| `trendReplayLineageCapPerSide` | 12 |
| `touchToleranceAtr` | 0.25 |
| `maxZoneAtr` | 0.35 |
| `approachAtr` | 1.00 |
| `episodeLeaveAtr` | 0.75 |
| `breakCloseAtr` | 0.25 |
| `breakConsecutiveCloses` | 2 |
| `maxSingleBarIntegrityInfluence` | 0.15 |
| `verificationMinExcursionAtr` | 0.25 |
| `verificationMinResponse` | 0.45 |
| `maxCurrentDistanceAtr` | 3.00 |
| `recentEvidenceBars` | 120 |
| `profileTargetBins` | 48 |
| `targetCompletedBars` | 240 |
| `recencyHalfLifeBars` | 120 |
| `weeklyDailySourceCap` | 1300 |
| `repairAuditRoundMax` | 2 |
| `manualBuildPairMax` | 1 |
| `hlineDisplayCountMin` | 1 |
| `hlineDisplayCount` | 2 |
| `hlineDisplayCountMax` | 4 |
| `trendDisplayCountMin` | 1 |
| `trendDisplayCount` | 2 |
| `trendDisplayCountMax` | 3 |
| `lineWidthThin` | 1 |
| `lineWidthNormal` | 2 |
| `lineWidthEmphasis` | 3 |
| `maxTransportLineCount` | 7 |
| `fieldBasisGlyphMax` | 64 |
| `hlineResponseSegmentMaxPerRole` | 48 |
| `hlineProfileBinMax` | 48 |
| `hlineFieldModeMaxPerRole` | 8 |
| `trendFieldModeMaxPerSide` | 6 |
| `fieldRepresentativeContributionMaxPerMode` | 6 |
| `trendRepresentativeHypothesisMaxPerMode` | 3 |
| `fieldFitValidationMaxPerBoundary` | 6 |
| `fieldCompletedInteractionMaxPerBoundary` | 3 |
| `fieldPendingInteractionMaxPerBoundary` | 1 |
| `maxFieldBytes` | 32768 |
| `maxPayloadBytes` | 65536 |
| `displayMinRankScore` | 0.45 |

값 조정은 `configVersion`을 올리고 fixture/benchmark를 다시 통과해야 한다. config를
환경변수의 임의 문자열로 흩뜨리지 않고 한 frozen config object와 canonical JSON
digest로 관리한다.

## 21. reason namespace

서로 다른 상태를 한 enum으로 섞지 않는다. transport/debug의 stable reason은 다음
namespace별 enum을 쓴다.

```text
AnalysisUnavailableReason =
  unsupported_interval | invalid_candle_identity | invalid_ohlcv |
  insufficient_canonical_coverage | noncontiguous_input | live_only |
  insufficient_listing_history | alpaca_credentials_unavailable |
  alpaca_rate_limited | alpaca_request_failed | provider_confirmed_empty |
  repair_incomplete | calendar_contract_mismatch | snapshot_changed_during_build

AssetFreshness = current | stale | missing | incompatible

CandidateRejectReason =
  no_confirmed_extrema | no_independent_seed | empty_integrity_domain |
  ridge_too_weak | zone_too_wide | span_too_short |
  episode_contribution_incompatible | formation_break_open |
  body_integrity_failed | close_integrity_failed | slope_out_of_bounds

InteractionOutcome =
  response_pending | neutral_response | verified_response | confirmed_break

RelationRejectReason =
  triangle_not_converging | triangle_containment_failed | triangle_apex_out_of_range

SelectionReason =
  display_score_below_threshold | output_relevance_failed |
  layer_count_excluded | replay_lineage_cap

ClientSuppressionReason = forked | deleted
StorageInvariantReason =
  determinism_violation | stale_build_identity | incompatible_time_contract |
  payload_limit_exceeded
```

wire/debug 문자열은 `candidate.zone_too_wide`처럼 namespace를 붙인다. `no-draw`는 오류
reason이 아니라 ready pack의 빈 selection이다. production은 집계 count와 선택된 후보의
주요 reason만 반환하고 evaluation trace는 각 후보의 전체 reason을 보존한다.

## 22. 결정론·복잡도·성능

### 22.1 결정론

같은 `algorithmVersion + configVersion + timeContractVersion + calendarVersion + symbol +
interval + asOf + lastCandleKey + inputDigest`는 byte-stable canonical candidate payload를 만든다. `generatedAt`처럼
계산 시점에 의존하는 envelope 필드는 payload digest에서 제외한다.

- random 사용 금지.
- float serialization 자릿수와 rounding helper를 한 곳에서 정의.
- 모든 sort에 마지막 stable ID tie-break 포함.
- timezone과 candle key는 canonical helper만 사용.
- dict/set iteration order에 결과를 의존시키지 않음.

canonical content JSON은 object key 사전순, whitespace 없는 UTF-8, UTC millisecond `Z`
timestamp, finite float 소수 최대 8자리, `-0 -> 0`을 쓴다. `boundaries`와 `drawings`는
`layer order(hline,trend) -> selector order -> ID`, ID 집합과 quality flag는 사전순,
explanation reason은 고정된 reason priority 순이다. Field Basis는
`role order -> roleMass desc -> observedAt desc -> basisId`, mode는
`role order -> modeState -> supportMass desc -> dispersion -> fieldModeId`, selected ref는
boundary selector order, response segment와 profile bin은 role/price order, validation은
candidate order와 시간순이다.
DB write와 read verification, fixture digest, API byte 비교가 모두 이 serializer 하나를
사용한다.

### 22.2 hard bounds

- public kernel candle `==240`.
- weekly derivation source daily row `<=1300`, derived weekly kernel row `==240`.
- H-Line evidence `<=48/role`.
- Trend anchor `<=12/side`, pair `<=66/side`.
- profile bucket `<=48`.
- replay lineage: H-Line `<=16/role`, Trend `<=12/side`.
- candidate bank: H-Line `<=8`, Trend `<=6`; selected Trend relation pair `<=2`.
- output H-Line `<=4`, Trend `<=3`, transport line `<=7`.
- Field Basis glyph `<=64`, H-Line response segment `<=48/role`, profile bin `<=48`, H-Line
  mode `<=8/role`, Trend mode `<=6/side`, 대표 contribution
  `<=6/mode`, 대표 Trend hypothesis `<=3/mode`, boundary별 fit validation `<=6`, completed
  interaction glyph `<=3`, pending interaction glyph `<=1`.
- Field canonical JSON `<=32 KiB`.
- output JSON `<=64 KiB`.

### 22.3 acceptance gate

측정 환경은 Python 3.12 production container, 1 vCPU, debug off, warm process다.

| 구간 | acceptance | stretch |
| --- | ---: | ---: |
| kernel full rebuild `F=240` | P95 <= 50ms, P99 <= 80ms | P95 <= 25ms |
| additional process memory | <=16 MiB | <=8 MiB |
| current Czardas asset GET | P95 <=100ms | P95 <=60ms |
| manual build, exact CH hit·repair 없음·queue 제외 | P95 <=750ms | P95 <=400ms |
| frontend parse + delta apply | P95 <=8ms, long task 0 | P95 <=5ms |
| Czardas Field coordinate projection + paint | P95 <=8ms, long task 0 | P95 <=5ms |
| 완료 job을 panel이 관측한 뒤 kind-scoped refetch + apply | P95 <=500ms | P95 <=250ms |

Alpaca repair는 provider/network latency에 좌우되므로 고정 latency 합격선을 두지 않는다.
대신 exact missing ranges, 최대 2 audit/repair round, 호출·row 수와 postwrite canonical
re-read를 측정한다. benchmark는 실제 고변동/저변동/저유동 종목과 모든 interval fixture를
포함하고 재현 명령을 저장소에 고정한다.

## 23. 반드시 지켜야 할 불변 조건

1. live candle은 fit, verification, break confirmation에 들어가지 않는다.
2. `revisionFormedAt`은 해당 geometry의 모든 fit episode confirmation보다 빠를 수 없다.
3. 한 episode를 같은 revision의 fit과 verification에 함께 세지 않는다.
4. H-Line은 profile만으로 생성되지 않는다.
5. Trend는 volume만으로 생성·기각되지 않는다.
6. Triangle constituent는 independently formed upper/lower Trend여야 한다.
7. no-draw는 성공 결과다.
8. missing candle을 합성하거나 보간하지 않는다.
9. Czardas asset path의 chart open, GET, miss/mismatch는 Czardas repair, kernel, job enqueue,
   PostgreSQL **asset** write를 하지 않는다. 기본 chart의 기존 fill은 유지하며 인증된
   `작도 자산(개발)` panel action만 Czardas 수동 job을 만든다.
10. 동일 입력 결과는 결정론적이다.
11. output은 H-Line 4개와 Trend 3개를 각각 넘지 않는다.
12. user-owned drawing은 engine이 수정하거나 삭제하지 않는다.
13. managed update는 remove-all/add-all이 아니다.
14. 설명은 계산된 fact보다 강한 인과·예측 표현을 사용하지 않는다.
15. current Geometry API·DB·worker는 Czardas 구현과 수동 검증 동안 변경·제거하지 않는다.
16. current Geometry와 czardas managed layer를 동시에 적용하지 않는다.
17. H-Line과 Trend visibility는 독립이며 toggle이 inference나 refetch를 일으키지 않는다.
18. Triangle badge는 선택된 Trend 두 선이 모두 visible한 managed constituent일 때만
    표시한다.
19. Trend가 2개 이상이면 lower와 upper를 모두 포함하며 Triangle을 위해 Trend geometry를
    왜곡하지 않는다.
20. user-owned drawing과 suppression은 서버에 저장하거나 다른 사용자에게 전달하지 않는다.
21. 지원 interval별 target count나 데이터 모양에 따른 가변 분석 window를 만들지 않는다.
22. penetration loss는 bounded이며 비core 돌출 candle이 line/zone을 포함하도록 geometry를
    늘리는 데 사용되지 않는다.
23. 단일 완료봉은 깊이와 body 크기에 관계없이 confirmed break가 될 수 없다.
24. exploration pressure는 reclaim 없이 verification strength를 올릴 수 없다.
25. `failed breakout`, `wick outlier` 같은 candle 종류별 예외 분기를 만들지 않고 모든
    candle을 탐색–수용–반응 fact로 평가한다.
26. 한 번의 머무름인 FormationEpisode는 geometry, seed, touch count에 contribution 하나만
    내며 member cluster 수로 표를 늘리지 않는다.
27. late-confirmed evidence는 observed 시점의 old-revision Interaction을 재사용하고
    confirmed 시점에 가짜 contact를 만들지 않는다.
28. candidate revision당 active Interaction은 최대 하나이고 terminal 뒤 separation reset
    전 재접촉은 새 episode가 아니다.
29. fit domain 끝에 열린 2봉 close-through가 있는 boundary를 formed로 만들지 않는다.
30. Inference Field는 ridge/mode와 Boundary geometry의 실제 입력이다. 다만 Field view
    serialization, renderer, visibility, hover와 style은 kernel에 되먹임되지 않는다.
31. visible 개별 primitive는 실제 candle/evidence/Basis/hypothesis/episode/interaction provenance로,
    aggregate mode는 derivation digest로 역조회되어야 하며 orphan을 허용하지 않는다.
32. universal candle importance를 만들지 않고 H-Line/Trend role mass를 분리한다.
33. Trend Field glyph와 geometry는 volume 변화에 독립이며 H-Line participation halo를
    Trend에 표시하지 않는다.
34. current completed snapshot과 pack digest가 다르면 stale Field를 표시하지 않는다.
35. chart type 전환은 API 요청, kernel 실행, drawing delta, viewport나 ChartDocument
    mutation을 만들지 않는다.
36. selected Boundary의 `sourceFieldModeId+sourceFieldRevision`, Field geometry와 managed drawing은 동일
    viewport에서 `<=0.5 device pixel`로 일치한다.
37. selected source mode와 initial formation 두 validation glyph는 production projection에서
    생략하지 않는다.
38. 모든 interval은 repair 후에도 newest completed candle 정확히 240개만 추론하며 partial,
    reserve, 가변 window를 만들지 않는다.
39. instant와 wire는 UTC, session/calendar는 `America/New_York`, KST/browser timezone은
    표시만 담당한다. naive datetime과 고정 UTC offset은 identity에 들어갈 수 없다.
40. repair는 exact missing range만 materialize하고 ClickHouse exact-240 재조회 없이 성공으로
    간주하거나 asset을 upsert하지 않는다.
41. selector와 output count를 제거해도 pre-selection Field mode와 derivation digest는 같다.
42. hypothesis pair와 같은 episode의 member 수는 mode support mass나 touch count를 부풀리지
    않는다.
43. stale asset의 drawing은 명시적으로 stale일 수 있지만 Field는 최신 candle 위에 표시하지
    않는다.

## 24. 현재 코드 migration map

| 목표 모듈 | 책임 | 현재 코드 관계 |
| --- | --- | --- |
| `czardas/config.py` | frozen config와 version | 신규 |
| `czardas/types.py` | typed tapes/candidates/events | 신규 |
| `czardas/tape.py` | input validation/SoA | `analysis_candles` 재사용 |
| `czardas/features.py` | ATR/body/wick/volume | 기존 feature 계산에서 순수 부분 추출 |
| `czardas/evidence.py` | extrema/NMS/role mass | `pivots.py` 교체 |
| `czardas/hline.py` | exact price response Field/ridge/profile confluence | `geometry._horizontal_levels` 교체 |
| `czardas/trend.py` | sparse dual-space mode와 one-sided robust refine | 신규 독립 Trend |
| `czardas/interactions.py` | formed 이후 hold/break fact | 신규 |
| `czardas/rank.py` | 단순 BoundaryRank | 신규 |
| `czardas/relations.py` | 선택된 Trend의 Triangle 관계 판정 | `patterns.compute_triangles` 교체 |
| `czardas/select.py` | 독립 layer와 lower/upper selection | 현재 slice/greedy 교체 |
| `czardas/compiler.py` | explanation/drawing output | 현재 drawing helpers 교체 |
| `czardas/field.py` | authoritative H-Line/Trend hypothesis Field와 mode | 신규 |
| `czardas/field_view.py` | bounded production Field DTO projection | 신규 |
| `czardas/kernel.py` | 유일한 public analyze entry | `analyze_geometry` 후계 |

rollout adapter가 현재 `assetVersion=geometry` 계약을 잠시 변환할 수는 있지만,
authoritative 내부 모델을 현재 payload 형태에 맞춰 왜곡하지 않는다.
