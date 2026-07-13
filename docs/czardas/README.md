# czardas

> czardas는 candle에 점수를 찍는 엔진이 아니라, 최신 OHLCV가 역할별로 만든
> 통계·기하 가설장에서 안정된 ridge와 mode를 찾아 경계로 작도하는 엔진이다.

czardas는 GOPS의 차세대 자동 작도 엔진이다. 최신 완료봉 240개를 한 번에 읽고
역할 조건부 통계·기하 가설장을 만든 뒤 H-Line과 Trend를 빠르게 제안한다.
두 Trend가 삼각 수렴 관계를 이루면 같은 두 선을 강조하고 패턴 이름을 덧붙인다. 결과는
차트 위의 선·텍스트가 되며 사용자가 직접 편집할 수 있다. 다섯 번째 chart type
`Czardas`는 후보 선택 전에 엔진이 실제로 읽은 `Czardas Field`를 펼쳐, candle들이 어떤
가격 ridge와 선 가설 mode를 만들었고 최종 작도가 어디에서 나왔는지 보여준다.

이번 POC에서는 자동 갱신하지 않는다. 인증된 사용자가 기존 `작도 자산(개발)` 패널에서
종목×interval 한 쌍의 `분석·저장`을 눌렀을 때만 추론하고 PostgreSQL latest asset을
upsert한다. 삭제도 같은 패널에서 수동으로 한다. chart open, 새 완료봉, correction,
pan, zoom, resize, live tick은 build를 시작하지 않는다. 자동 갱신은 이 수동 경로와
엔진 품질이 검증된 다음 구현에서 추가한다.

current Geometry와 Czardas를 동시에 적용하지 않는다. 프런트의 비영속 release constant가
`geometry | czardas | off` 중 하나만 고르며 현재 repository 기본값은 `czardas`다. 이는
세 번째 사용자 버튼이나 저장되는 설정이 아니며 기존 Geometry는 rollback 경로로 남는다.

## czardas가 차트를 보는 시선

czardas는 candle을 단순한 시간×가격 막대로 보지 않는다. OHLCV를 다섯 관점으로
분해한다.

- 시간: 언제 생겼고 언제 확정됐으며 서로 독립된 사건인가.
- 가격: wick endpoint, body, close 중 무엇이 경계를 시험했는가.
- 변동성: 그 거리가 해당 종목과 interval에서 큰가. ATR로 정규화한다.
- 참여도: 평소보다 거래량이 컸고 어느 가격대에 누적됐는가.
- 구조: 지역 최고·최저, 반응, 수렴, 이탈 중 어떤 역할인가.

이 관점은 “중요 candle 점수” 하나로 뭉개지지 않는다. 거래량이 큰 candle은 H-Line의
가격 기억에는 유용할 수 있지만 Trend endpoint로는 약할 수 있다. 같은 사실을 목적에
따라 다른 evidence mass로 읽는다.

경계를 만났을 때는 모든 candle을 같은 **탐색–수용–반응**으로 읽는다.

- wick과 range는 시장이 경계 너머를 얼마나 탐색했는가.
- body와 close, 경계 밖 체류시간은 그 가격을 얼마나 수용했는가.
- 경계 안으로 돌아온 속도와 반대 방향 이탈은 그 시험에 시장이 어떻게 반응했는가.

따라서 돌출봉은 삭제할 예외도, 선을 그 봉까지 억지로 늘릴 이유도 아니다. 소수의
돌출은 robust geometry에 거의 영향을 주지 않고, 빠르게 복귀한 강한 시험은 경계의
사후 반응 근거가 된다. 반대로 경계 밖 종가가 지속되면 같은 모델 안에서 break가 된다.

czardas v1에는 두 boundary primitive와 하나의 파생 관계만 있다.

| 종류 | czardas의 해석 | 필수 근거 |
| --- | --- | --- |
| H-Line | Price Memory: 반복해서 반응한 가격대 | 같은 역할의 독립 reaction 2회 |
| Trend | Moving Boundary: 시간에 따라 이동하는 한쪽 경계 | 구조적 endpoint 2회 |
| Triangle relation | Compression: 선택된 상·하단 Trend의 수렴 관계 | formed upper/lower Trend와 containment/contraction |

Triangle은 세 번째 detector나 drawing이 아니다. H-Line과 Trend만 독립적으로 생성·선택하고,
그 결과를 바꾸지 않은 채 선택된 두 Trend의 관계를 마지막에 해석한다.

formation 이후 새 reaction이나 hold가 있으면 `verified`가 되어 순위가 올라간다. POC는
이 검증을 작도의 필수 조건으로 강제하지 않는다.

## 앞으로도 유지할 Czardas의 중심축

```text
Candle Fact
  -> Role Basis
  -> Statistical-Geometric Hypothesis Field
  -> Ridge / Mode
  -> Boundary
  -> Interaction / Selection
  -> Relation / Drawing
```

1. candle에 이름을 먼저 붙이지 않고 OHLCV fact를 먼저 계산한다.
2. 같은 candle도 목적에 따라 H-Line reaction, Trend endpoint, opposition으로 다른 Basis를
   만든다. 하나의 만능 candle 중요도는 없다.
3. 여러 Basis가 가격축 또는 line dual space에 중첩되어 detector가 실제로 읽는 immutable
   Hypothesis Field를 만든다.
4. boundary geometry는 Field의 안정된 ridge/mode와 robust refinement가 정한다.
5. 오래 머물며 여러 봉이 닿아도 한 번의 시장 시험은 한 표다. 충분히 떠났다가 다시
   시험해야 새 evidence가 된다.
6. boundary의 힘은 형성에 쓴 점의 개수가 아니라 형성 후 시장의 수용·복귀·이탈로 평가한다.
7. 늦게 확정된 극점도 실제로 발생한 시각에 귀속한다. confirmation 시점에 과거 접촉을
   새 사건으로 만들지 않는다.
8. Triangle 같은 관계는 이미 선택된 boundary를 설명할 뿐 원래 선을 왜곡하지 않는다.
9. Czardas chart는 선택 결과를 꾸미지 않고 kernel이 후보 선택 전에 만든 Field를 보여준다.
10. 계산, 설명, Czardas Field와 debug trace는 같은 fact를 사용한다. 설명용 사후 이야기를
   덧붙이지 않는다.
11. 근거가 없으면 `no-draw`를 내는 것이 Czardas의 정상적인 판단이다. no-draw에서도 약하거나
    충돌하는 Field는 볼 수 있다.
12. Field 자체는 inference의 중간 상태다. 다만 직렬화, renderer visibility, hover와 style이
    kernel Field나 selection에 되먹임되는 경로는 만들지 않는다.

이 흐름은 v1 알고리즘의 편의가 아니라 앞으로 candle 강조, 새로운 boundary, 교차와
접근 알림을 추가할 때도 지킬 architecture다.

## 이번 구현의 경계

이번 구현은 OHLCV로 H-Line과 Trend를 생성·평가·작도하고, 선택된 Trend의 현재 Triangle
관계와 그 계산 근거인 production `Czardas Field`를 표시하는 데서 끝난다.

- MA120을 포함한 MA/EMA/WMA는 입력, evidence, gate, rank, drawing에 사용하지 않는다.
- Bollinger Bands, RSI, Stochastic, MACD도 czardas 추론에 사용하지 않는다.
- MA120과 candle/H-Line/Trend의 교차·접근 해석은 **다음 구현 단계**다.
- 다음 단계를 위한 임시 config, nullable schema, 빈 detector는 v1에 미리 만들지 않는다.
- 기존 차트가 이미 계산·표시하는 지표 기능은 그대로 두되 czardas와 결합하지 않는다.

다음 단계에서 MA120을 도입한다면 먼저 candle이나 Boundary와 구분되는 `ReferenceCurve`로
모델링한다. 그 곡선과 candle/H-Line/Trend의 접근·교차는 별도의 `Relation`으로 해석한다.
H-Line/Trend의 형성·유효 방향·break 규칙을 MA120에 억지로 재사용하지 않는다. 구체적인
입력·관계 계약은 이번 구현이 안정된 뒤 별도 문서 변경으로 결정한다.

## 어떤 데이터를 어떻게 가져오는가

czardas v1의 hot core는 canonical OHLCV만 사용한다.

- source of truth: ClickHouse의 완료된 정규장·분할조정 candle.
- 지원 interval: `1m/5m/10m/1h/4h/1D/1W`.
- 모든 지원 interval: 최근 완료봉 240개.
- `1W` direct coverage가 부족하면 ClickHouse canonical 일봉 최대 1,300개만 읽어
  bounded 주봉 집계를 허용한다. 거대한 1m fallback은 허용하지 않는다.
- 수동 build는 interval과 관계없이 최신 완료봉 240개를 확정하고 그 전체를 분석한다.
  별도 reserve, partial window나 데이터 모양에 따른 가변 추론 범위는 없다.
- 화면에는 기존처럼 최신 120봉, 주봉 104봉만 보인다. 즉 표시 범위보다 로딩 범위가
  넓지만 **로딩 범위와 분석 범위는 같다**.
- 현재 API가 live row도 limit에 포함하므로 transport는 한 행을 더 받을 수 있지만 client는
  완료봉 최신 240개와 optional live 1개로 즉시 정규화한다. 이 한 행은 분석 reserve가 아니다.
- ATR14와 extrema radius는 준비되는 시점부터 evidence를 만든다. volume20이 준비되기
  전에는 중립 참여도만 쓰므로 앞쪽 구간이나 Trend evidence를 통째로 버리지 않는다.
- 오래된 evidence는 interval과 무관하게 최신 120봉 안에 다시 등장했거나 현재 가격에서 3 ATR 안에 있는
  경계를 설명할 때만 output에 기여한다. 과거에만 의미 있었던 선은 그리지 않는다.
- live candle은 기존 chart만 계속 그린다. 이번 czardas 추론·상태·작도에는 쓰지 않는다.

수동 build는 먼저 ClickHouse에서 canonical target key 240개를 감사한다. 저장 identity는
마지막 봉의 UTC `asOf`, logical `lastCandleKey`와 전체 `inputDigest`를 함께 가진다. 일부가 없으면
기존 chart-data repair의 공용 calendar·missing-range·Alpaca fetch·canonical materializer를
재사용해 **누락 range만** Alpaca에서 가져와 ClickHouse에 저장한다. 그 뒤 ClickHouse를
반드시 다시 읽어 exact 240과 digest를 확정한 경우에만 kernel을 실행한다.

기본 chart와 Czardas는 서로의 상위 service를 호출하지 않고 ClickHouse를 통해 돕는다.
기본 chart fill이 먼저 canonical candle을 채우면 Czardas audit가 통과하고, Czardas 수리가
채운 candle은 다음 chart query가 그대로 쓴다. Czardas job이 chart API의 Redis/S3/DTO와
결합된 foreground fill service를 import하지는 않는다. `5m/10m/1h/4h`는 Alpaca `1Min`
정규장 원본을 저장한 뒤 같은 session bucket 집계기로 만들며, `1W`는 canonical `1D`만
수리·집계한다.

Alpaca 인증·network·rate-limit 실패, 239개 이하, unresolved head/interior/tail gap,
신규 상장 이력 부족, provider가 확인한 빈 slot은 모두 `unavailable`이다. 빈 slot을
zero-volume이나 carry-forward candle로 만들지 않으며 실패한 build는 기존 성공 asset을
덮어쓰지 않는다.

시간은 하나의 frozen contract로 관리한다.

- 저장·전송·instant 비교와 repair 범위: UTC millisecond `Z`, 반개구간 `[start,end)`.
- 미국 시장 session, 휴장, 조기폐장과 DST: IANA `America/New_York`.
- intraday candle key: UTC bucket start. `1D`: NYSE 거래일. `1W`: 시장 주의 월요일 key.
- `Asia/Seoul`과 browser timezone: 패널과 label 표시만 담당하고 identity·digest에 미사용.
- naive datetime, 서버 local timezone, 고정 `UTC-5/UTC-4` 계산은 금지한다.

인증된 패널 action이 만든 Python job은 공통 pack을 PostgreSQL
`chart_assets.czardas_latest`의 `(symbol, interval)` latest row로 upsert한다. GET이나 chart
open은 job을 등록하지 않는다. 모든 사용자는 다음 asset read에서 같은 저장 결과를 받고,
사용자 편집은 서버에 저장하지 않는다. 새 완료봉 뒤 stored drawing은 `stale` badge와 낮은
opacity로 유지할 수 있지만, digest가 다른 과거 Czardas Field는 현재 candle 위에 겹치지
않고 `수동 재분석 필요`로 숨긴다.

## 어떻게 추론하는가

```text
canonical completed OHLCV
        -> CandleTape / FeatureTape
        -> role-specific Basis
        -> H-Line Price-Memory Field
           + Trend sparse Line-Hypothesis Field
        -> ridge / mode와 robust geometry refinement
        -> H-Line / Trend Boundary candidate
        -> 형성 이후 독립 Interaction 확인
        -> formed / verified / broken 상태와 단순 rank
        -> H-Line과 Trend를 각 layer에서 선택
        -> 선택된 Trend의 Triangle 관계 판정
        -> editable drawing delta
        -> 같은 inference state의 bounded Czardas Field view
```

H-Line은 support/resistance reaction Basis가 가격축에 쌓아 올린 1차원 Price-Memory
Field에서 시작한다. 먼저 모든 Basis corridor가 exact piecewise `SeedResponse`를 만들고
endpoint sweep의 local ridge가 provisional mode가 된다. 그 mode 안에서 한 번의 머무름을
한 episode로 압축한 뒤 episode contribution으로 response를 다시 계산한다. 독립 episode
두 개가 겹친 maximum만 weighted median/MAD로 refine해 center와 zone을 정한다. 별도 Volume Profile API는 읽지 않고 같은 OHLCV의 48-bin
histogram을 보조 channel로만 사용한다. profile은 ridge를 새로 만들거나 hard gate를
통과시키지 않는다.

Trend는 lower/upper endpoint Basis의 모든 독립 pair를 최대 66개의 line hypothesis로
바꾼다. 각 선을 snapshot 처음과 끝 가격 `(y_first,y_last)`로 표현한 sparse dual space에서
서로 가까운 hypothesis가 mode를 만든다. raw pair 수가 아니라 mode가 참조한 unique
episode를 한 번씩만 세며, mode 내부 anchor를 weighted Theil–Sen과 one-sided quantile로
refine한다. wick 통과는 작은 bounded 비용으로 허용하지만 body와 종가의 지속 통과는
opposition과 break가 된다. dense Hough grid, KDE, random RANSAC이나 평균을 가로지르는
OLS에 결과를 맡기지 않는다.

H-Line의 weighted median/ridge와 Trend의 Theil–Sen/one-sided quantile은 다수 구조가
선의 위치를 정하게 한다. 모든 penetration 비용은 bounded loss로 제한한다. 그래서
한두 개의 긴 wick이나 body가 선을 끌고 가거나 후보 전체를 탈락시키지 않는다. 선을
넓혀 돌출을 포함하지도 않는다. 돌출의 의미는 geometry가 아니라 공통 interaction이
판단한다.

가장 중요한 규칙은 선의 형성과 확인을 분리하는 것이다.

```text
독립 evidence 2회 -> formed boundary
                  -> 그 이후 새 interaction으로 시험
                  -> 반응하면 verified, 이탈하면 broken
```

세 번째 interaction을 선을 맞추는 데 먼저 사용한 뒤 검증이라고 부르지 않는다. 다만
POC에서는 verified만 그리도록 강제하지 않는다. formed 선도 geometry와 현재 관련성이
충분하면 표시하고, 사후 반응은 순위와 설명을 보강한다.

선의 힘은 “몇 번 닿았는가”만 세지 않는다. core endpoint가 geometry를 만들고, 그 사이
모든 candle의 bounded body/close 수용이 integrity를 만들며, formed 이후 독립 episode의
`시험 압력 × 복귀 속도`와 유리한 이탈이 verification mass를 만든다. 깊게 돌출했다는
사실만으로는 가산하지 않는다. 실제로 돌아오고 떠났을 때만 더 설득력 있는 경계가 된다.

여기서 독립 episode는 단순 candle 수가 아니다. 같은 경계에 머무는 동안 생긴 여러
endpoint는 하나의 대표 contribution으로 압축하고, 가격이 충분히 떠난 뒤 다시 돌아온
시험만 새 표로 센다. 이 규칙이 반복 touch 과대평가와 돌출봉 예외처리를 동시에 막는다.

## 무엇을 작도하는가

출력은 서로 경쟁하지 않는 두 drawing layer다.

| layer | 허용 범위 | 기본 목표 | 화면 버튼 |
| --- | ---: | ---: | --- |
| H-Line | 1~4개 | 2개 | `H-Line` on/off |
| Trend | 1~3개 | 2개 | `Trend` on/off |

허용 범위의 최솟값은 강제로 채울 개수가 아니라 **선택 가능한 설정의 최솟값**이다.
formed 후보가 하나뿐이면 하나만, 하나도 없으면 `no-draw`를 출력한다. v1의 좌측
하단 UI에는 개수 조절을 넣지 않고 두 버튼만 둔다. 두 layer는 기본으로 켜며, 버튼은
이미 계산된 drawing의 표시만 바꾼다. 따라서 한쪽을 끄더라도 다른 쪽이나 엔진 추론,
API 요청에는 영향이 없다.

Trend 기본 목표 2개는 **lower 1개와 upper 1개**다. 양쪽에 formed 후보가 있으면 반드시
하나씩 선택한다. 한쪽 후보만 있으면 같은 쪽 두 개로 채우지 않고 Trend 하나만 그린다.
두 선은 평행하거나 발산해도 유효한 Trend이며, Triangle을 만들기 위해 기울기나 위치를
왜곡하지 않는다.

Triangle은 별도 세 번째 layer나 추가 선이 아니다. 선택된 Trend 중 upper/lower 두 선이
ascending, descending, symmetrical Triangle의 조건을 만족하면 그 두 선을 보통
`2px`에서 강조 `3px`로 바꾸고, plot 내부 우측 상단의 빈 공간에 패턴 이름을 한 번만
표시한다. `Trend`를 끄면 선과 이름을 함께 숨긴다.

그리기 도구의 선 두께는 `1px / 2px / 3px` 세 단계다. czardas의 일반 선은 `2px`,
Triangle을 만드는 두 Trend는 `3px`가 기본이다. 사용자가 두께를 바꾸면 다른 편집과
동일하게 user-owned drawing으로 갈라져 엔진이 다시 덮어쓰지 않는다. Triangle 관계가
표시된 동안 한 선을 편집하거나 삭제하면 두 선을 한 group으로 원자적으로 갈라낸다.

각 작도에는 다음이 함께 있다.

- 주장: czardas가 이 경계를 무엇으로 보는가.
- 근거: formation과 사후 interaction.
- 반대 증거: body/close penetration과 break.
- 상태: 현재 출력 후보라면 formed 또는 verified, 탈락했다면 그 계산 근거.
- 무효화 조건: 어떤 종가 이탈에서 더는 유효하지 않은가.
- 데이터 한계: estimated Volume Profile 등.

저장 결과는 `czardas-managed` drawing이다. stable ID가 유지되어 새 수동 upsert는 필요한
선만 add/update/remove하고 현재 선택을 보존한다. 사용자가 drag, style, text를 바꾸면
현재 ChartDocument 메모리에서만 `user-owned` drawing으로 갈라진다. 이 편집은 서버에
전송·저장되지 않으며 reload나 새 document에서는 사라지고 공통 czardas 제안이 다시
나타난다.

## Czardas 차트가 보여주는 것

현재 실제 chart type은 `Candle`, `Line`, `OHLC`, `Bid/Ask`다. 여기에 내부 값
`chartType="czardas"`, 화면 이름 `Czardas`를 다섯 번째 base renderer로 추가한다.
`Czardas Field`는 detector 뒤에 붙인 감사 로그도, indicator도, 세 번째 drawing layer도
아니다. detector가 Boundary를 만들기 **전에 실제로 읽은 통계·기하 중간 상태**다.
`Czardas chart`는 그 상태의 bounded view를 같은 240봉의 시간×가격 좌표에 그린다.
renderer는 읽기 전용이지만 underlying Field는 추론 그 자체다.

Field는 하나의 화려한 candle 중요도 heatmap을 만들지 않는다. 같은 candle이 H-Line
reaction에는 강하고 Trend endpoint에는 약할 수 있기 때문이다. 기본 화면도 선택된 선의
formation 점만 찍지 않는다. 후보 선택 전에 존재한 가설 지형을 다음 순서로 보여준다.

1. **Candle Morphology와 Role Basis**: 완료봉의 body, wick, endpoint와 corridor는 희미한
   골격과 역할별 footprint다. live candle은 점선 골격만 보이고 Basis를 만들지 않는다.
2. **H-Line Landscape**: support와 resistance의 1차원 response field를 plot의 수평 band와
   가격축 marginal profile로 그린다. 희미한 seed band는 raw Basis mass인 provisional
   landscape이고, mode contour의 농도와 폭만 episode-compressed support mass와 dispersion을
   뜻한다. 따라서 오래 머문 봉 수를 경계의 표 수처럼 보이지 않는다. body/close 수용은
   notch/hatch인 opposition channel, volume은 별도 얇은 texture로만 보인다. 선택 전의 여러
   ridge가 모두 존재한다.
3. **Trend Landscape**: lower와 upper의 sparse line hypotheses를 가는 thread로, 가까운
   hypothesis가 모인 mode를 ribbon으로 그린다. ribbon 중심과 시작·끝 폭은 consensus와
   dispersion을 뜻한다. raw pair가 많아져도 같은 episode를 여러 표로 보이지 않는다.
4. **Boundary와 Drawing**: gate를 통과한 mode의 contour 위에 candidate를 표시하고, 선택된
   H-Line/Trend만 기존 편집 가능한 2px/3px drawing으로 정확히 겹친다. 모든 drawing은 자신을
   만든 `fieldModeId+fieldRevision`을 가진다.
5. **Validation Overlay**: formation episode, confirmation 지연, residual, contact,
   exploration·acceptance·response·break는 기본 지형을 대신하지 않는다. 선택한 boundary를
   hover/focus할 때 보조 layer로 펼친다. Triangle도 두 Trend의 결과 relation overlay다.

`no-draw`에서도 Basis와 약하거나 서로 충돌하는 ridge/mode는 보인다. selector와 drawing을
숨겨도 pre-selection Field가 그대로 남아야 한다. 이것이 Czardas chart가 최종 결정을
사후에 그린 그림이 아니라 엔진이 실제로 차트를 본 방식이라는 가장 중요한 검증이다.

chart type 전환은 viewport, candle snapshot, build job, kernel 실행, 후보 선택, drawing
ID를 바꾸지 않는다. 저장한 같은 pack을 다른 renderer로 볼 뿐이다. Czardas 화면에서는 인과로
오해할 수 있는 기존 MA·indicator·Volume Profile·comparison을 **렌더 단계에서만** 숨기고
사용자 설정은 보존한다. 사용자 drawing은 그대로 보이지만, 편집되어 `user-owned`로 갈라진
자동 선에는 더 이상 engine causal trace를 연결하지 않는다.

`H-Line`과 `Trend` 버튼은 각 managed drawing뿐 아니라 대응하는 Field branch도 함께
숨긴다. Triangle은 Trend에 속한다. 일반 chart interval에는 `1M`이 있지만 v1 분석 지원은
`1m~1W`이므로 `1M`에서는 Czardas 선택을 비활성화하며 interval을 몰래 바꾸지 않는다.

Field는 장식이 아니라 설계 검증 조건이다. 개별 Basis는 source candle/episode로 역조회되고,
집계 ridge/mode는 `fieldModeId`, derivation digest와 contributor count로 full trace에서
수치 재현되어야 한다. 최종 선은 frozen source mode revision의 geometry 위에 놓이며 current
landscape revision과 달라졌다면 둘을 합치지 않고 별도 contour로 보인다. 이 연결을 표현하려고
프런트에서 새 점수나 이야기를 만들어야 한다면 renderer 문제가 아니라 kernel의 관점이
불명확한 것이다.
같은 시각 문법을 fixture evaluator에서는 no-lookahead·episode 중복·outlier 영향의 개발
진단으로, 제품에서는 시장이 어떤 경계를 어떻게 시험했는지 읽는 GOPS 고유의 insight
chart로 사용한다. 다만 어느 화면에서도 매수·매도 신호나 미래 확률로 이름 붙이지 않는다.

## 왜 섹시한가

czardas의 매력은 복잡한 기법의 개수가 아니라 한 증거 흐름의 밀도에 있다.

1. **작다.** 모든 interval의 분석은 정확히 240봉과 제한된 evidence/candidate만 본다.
2. **빠르다.** bounded full rebuild 결과 하나를 저장해 모든 사용자에게 공유한다.
3. **정직하다.** 선을 만든 evidence와 선을 시험한 evidence를 분리한다.
4. **일관된다.** H-Line과 Trend가 같은 interaction, rank, lifecycle을 공유한다.
5. **설명된다.** 선이 되기 전의 가격 ridge와 line mode가 candle Basis로 다시 펼쳐진다.
6. **만질 수 있다.** 결과가 이미지가 아니라 사용자가 소유할 수 있는 chart object다.
7. **절제한다.** 빈 차트가 근거를 맞추려고 억지로 그은 선보다 낫다는 원칙을 가진다.
8. **겹쳐 보인다.** pre-selection 가설장과 최종 작도가 같은 좌표와 같은 snapshot에서 만나므로
   결과와 근거 사이의 연결을 눈으로 감사할 수 있다.

고급 알고리즘을 나열한 엔진이 아니라, 적은 연산으로 후보 생성·검증·설명·시각화를
같은 자료구조에 연결한 엔진이라는 점이 czardas의 핵심이다.

## 강점

- OHLCV만으로 모든 지원 interval에서 같은 의미를 유지한다.
- deterministic하므로 같은 입력에서 같은 결과와 stable ID를 얻는다.
- ATR 정규화로 가격대와 변동성이 다른 종목을 같은 규칙으로 처리한다.
- reaction-first H-Line이 거래량 많은 가격을 지지·저항으로 오인하는 일을 줄인다.
- H-Line과 Trend가 각각 가격축 ridge와 line dual-space mode라는 명확한 통계·기하 문법을
  가지며, 향후 회귀 기반 pattern도 같은 Basis→Field→Mode 구조로 확장할 수 있다.
- robust one-sided boundary가 소수 돌출과 지속적인 가격 수용을 다르게 취급한다.
- 같은 탐색–수용–반응 모델이 H-Line과 Trend의 실패 돌파·복귀를 자연스럽게 평가한다.
- 시간순 formation/verification으로 같은 반응을 만들기와 확인에 중복 사용하지 않는다.
- no-draw와 unavailable을 정상 상태로 구분한다.
- Python 커널 하나를 API, evaluator, builder가 공유해 언어 간 parity 문제가 없다.
- Basis와 aggregate mode가 provenance/derivation에 연결되어 개발 중 누수·중복·잘못된
  consensus를 화면에서도 찾을 수 있다.

## 약점

- OHLCV 기반 Volume Profile은 실제 체결별 volume-at-price가 아니라 근사치다.
- 최신 240봉보다 오래된 역사적 가격 기억을 놓칠 수 있다.
- core endpoint가 두 개뿐이고 그중 하나가 비정상인지 구분할 추가 구조가 없으면 robust
  통계도 정답을 복원할 수 없다. 이런 구간은 낮은 rank 또는 no-draw가 안전하다.
- 극단적 gap, 거래정지, 매우 낮은 유동성에서는 local extrema 의미가 약해진다.
- 최신 endpoint는 extrema confirmation을 기다리므로 짧은 지연이 있다.
- linear boundary는 곡선 추세와 regime 전환을 충분히 표현하지 못한다.
- 깨진 resistance가 support가 되는 polarity flip은 v1에서 자동 상속하지 않고 새
  evidence lineage를 기다린다.
- 점수는 예측 확률도, 원인도, 매매 신호도 아니다.
- Field가 명쾌하다는 사실은 auditability의 증거이지 미래 예측 정확도의 증거는 아니다.
- Field의 mass, tolerance와 mode threshold는 설명 가능한 heuristic이지 학습된 확률이나
  시장의 유일한 구조가 아니다.
- production Field는 가벼운 pack을 위해 bounded Basis와 provisional mode를 보여준다.
  모든 raw hypothesis, 탈락 후보와 과거 revision은 개발용 full trace에서만 볼 수 있다.
- 역할 Basis와 hypothesis가 조밀한 구간은 시각적으로 복잡할 수 있어 stable mode와
  representative thread로 압축한다.
- 사용자 편집은 의도적으로 메모리 수명이며 서버나 다른 사용자에게 전파되지 않는다.
- 강한 추세로 접촉 기회가 없으면 좋은 선인지 나쁜 선인지 평가할 수 없어
  verification 없는 `formed`로 남는다.

## 후속 가능성 — 이번 구현 범위 아님

같은 evidence graph는 다음 기능으로 확장할 수 있다.

- H-Line, Trend, candle, 이동평균 사이의 교점과 접근 알림.
- channel, wedge, flag, zone처럼 Boundary 조합으로 표현되는 도형.
- 선형회귀와 다른 bounded parametric family를 같은 Basis→Hypothesis Field→Mode 문법으로
  해석하는 새로운 pattern. 각 pattern의 근거도 Czardas chart에 먼저 나타나야 한다.
- lower-timeframe candle 또는 실제 trade data를 이용한 더 정밀한 Volume Profile.
- verified 반응과 break/retest를 시간축 그래프로 표현.
- 탈락 후보, 과거 revision, 전체 penetration ledger를 탐색하는 개발자 진단 mode.
- 역할 evidence를 선택해 설명과 원본 candle로 이동하는 typed inspector.
- 작도와 사용자 편집을 agent의 차트 설명·시나리오 입력으로 사용.

이 확장은 v1의 Basis/Field/Mode/interaction/identity 계약을 재사용해야 한다. 새 패턴마다
별도의 불투명 detector와 점수 체계를 추가하는 방향은 피한다.

## 한계선

czardas가 완벽하게 할 수 없는 일도 명시한다.

- 미래 가격이나 돌파 방향을 보장하지 않는다.
- news, fundamentals, order flow의 원인을 OHLCV만으로 알아내지 않는다.
- 사용자의 투자 기간과 위험 성향을 geometry만으로 결정하지 않는다.
- 오래된 모든 지지·저항을 짧은 latest window 안에 보존하지 않는다.
- 설명 가능한 evidence가 없는 차트에서 그럴듯한 선을 만들어내지 않는다.

v1의 성공 기준은 미래를 맞히는 마술이 아니라, 최신 구간에서 무엇을 중요하게 봤고
왜 그 선을 남겼는지를 빠르고 반복 가능하게 설명하는 것이다.

## 동결 기준 코드와의 관계

동결한 구현 기준점 `16e0fa5`에는 이미 PostgreSQL 기반 Geometry asset, H-Line, 세 Triangle 종류,
canonical candle loader, builder/job, frontend drawing 경로가 있다.

해당 기준 코드의 현재 화면은 Geometry를 하나의 toggle로 다룬다. 과거 화면의 세 버튼을
유지하거나 현재의 단일 Geometry 버튼을 확장하는 것이 아니라, czardas 목표 화면은
`H-Line`과 `Trend` 두 버튼으로 고정한다.

czardas는 다음 자원을 수용한다.

- canonical regular-session split-adjusted OHLCV와 ClickHouse truth.
- `analysis_repair`의 exact-range Alpaca→ClickHouse repair와 canonical 재조회 기반.
- `작도 자산(개발)` 패널의 authenticated build/poll/cancel/delete UX와 별도 asset-kind cache.
- PostgreSQL latest shared proposal과 수동 요청 전용 `SKIP LOCKED` job pattern.
- 현재 chart drawing primitive와 command 경계.
- ascending/descending/symmetrical Triangle 제품 범위.

다음 로직은 전면 교체한다.

- 고정 pivot/greedy H-Line.
- 독립 Trend 없이 Triangle에만 쓰이는 regression line.
- 형성과 검증이 섞인 score.
- chart asset 전체 remove-all/add-all과 편집 소실.

이번 POC는 current Geometry와 별도 `czardas_latest` table을 사용한다. 자동
`CANDLE_CLOSED/CORRECTED` build, chart miss enqueue, S&P500 schedule/CronJob, active-release
pointer와 cross-client push는 구현하지 않는다. 현재 Geometry는 수동 검증과 rollback이
끝날 때까지 보존한다.

## 문서 읽는 순서

1. 이 문서: 제품 관점, 데이터 흐름, 강점과 한계.
2. [ENGINE_SPEC.md](ENGINE_SPEC.md): 자료구조, 수식, 알고리즘, API, 저장의 유일한 규격.
3. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): 파일, 테스트, 성능 gate, rollout 순서.

별도 decision log, 아이디어 모음, 오래된 설계 archive를 만들지 않는다. 논의 결과는
세 문서의 현재 계약에 녹여 쓰고 변경 이력은 Git이 보존한다.
