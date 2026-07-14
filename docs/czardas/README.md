# Czardas v4

Czardas는 최신 완료봉 exact-240을 하나의 현재 장면으로 보고, 가격 기억·회귀 흐름·robust
경계와 구조 관계를 같은 Field에서 해석해 H-Line, Trend와 Pattern을 제안하는 GOPS의
결정론적 통계·기하 엔진이다.

## 제품 정체성

- 모든 candle은 현재 240봉 안에서 Shared, H-Line, Trend 의미를 가진다.
- 과거 candle의 의미도 해당 candle 당시의 판단이 아니라 현재 `asOf`에서 본 해석이다.
- Pattern은 별도 candle 점수가 아니라 가격 기억, 회귀 흐름, 경계와 접촉 사실의 관계다.
- Field, hover, 해설과 최종 drawing은 같은 inference와 provenance를 사용한다.
- 결과가 약하면 과장하지 않는다. Trend와 Pattern은 abstain할 수 있고 약한 H-Line은
  `baseline_memory`임을 드러낸다.
- 결과는 확률, 매수·매도 신호 또는 수익 보장이 아니다.

## 엔진이 제안하는 것

| 결과 | 현재 계약 |
| --- | --- |
| H-Line | `1..4`, 선호 2. 거래량 없이 성립하는 dominant PriceMemory를 최소 한 개 포함한다. |
| Trend | `0..3`, 선호 2. endpoint fact에 robust fit한 가격 경계만 제안한다. |
| Pattern | `0..2`. Triangle, Channel, Rectangle, Wedge, Flag, Pennant 관계 중 승격된 것만 그린다. |
| Field | 240개 candle 의미, PriceMemory, OLS 흐름, 경계 근거, relation fact와 선택 closure를 보여준다. |

감지된 Pattern은 실제 contact·turn·impulse fact 3~16개를 시간순으로 이은 managed polyline
하나와 이름 하나를 가진다. 승격되지 않은 대표 관계는 국소 marker와 짧은 connector로만
표현될 수 있으며 Pattern 이름이나 drawing을 만들지 않는다.

## Czardas 차트

좌측 하단의 H-Line, Trend, Pattern 토글은 독립적이며 Shared 의미는 항상 남는다.

- 확대 상태: candle 진하기는 Shared+Trend, 고점·저점 주변의 짧은 수평 흔적은
  Shared+H-Line 의미다.
- 축소 상태: 노란 강도는 활성 채널을 합친 240봉 내 의미 백분위다.
- OLS 중심 흐름, robust 경계 후보, relation 근거와 최종 drawing은 명확한 시각적 위계를 가진다.
- hover는 `현재 240봉 기준`으로 factor raw/normalized 값, reason, availability와 usage를
  오른쪽 아래 text overlay에 펼쳐 보여준다.
- candle, Basis, OLS, Trend와 PatternTrace는 모두 `timestamp+price` 좌표를 사용한다.
  pan, zoom과 semantic expansion에서 근거와 drawing이 함께 이동한다.

managed drawing은 사용자가 편집·삭제·복원할 수 있다. 최초 편집은 해당 boundary 또는
relation의 session fork를 만들며 서버 inference와 공용 자산은 바뀌지 않는다. H-Line과 Trend는
일반 선 도구, Pattern은 3~32 anchors를 지원하는 공용 polyline 도구로 계속 편집할 수 있다.

## 데이터와 운영

- 지원 interval: `1m`, `5m`, `10m`, `1h`, `4h`, `1D`, `1W`.
- 입력: `canonicalVersion=v2`, `priceAdjustment=split`, `marketSession=regular`, 완료봉 exact-240.
- live candle과 `asOf` 이후 row는 inference, Field, 설명과 provenance에 들어가지 않는다.
- 입력 OHLCV와 production config는 q8 `ROUND_HALF_EVEN` 영역에서 검증·계산·digest된다.
- Trend와 OLS는 volume-only 변경으로 geometry, rank 또는 Field 의미가 바뀌지 않는다.
- 자산은 PostgreSQL에 `(symbol, interval)` 단위로 저장하며 모든 사용자가 같은 deterministic
  content를 받는다.
- build와 delete는 `작도 자산(개발)` 패널에서 한 번에 한 `symbol×interval`만 수동 실행한다.
  chart-open, GET, candle event와 Cron은 build를 만들지 않는다.
- ClickHouse coverage가 부족하면 neutral canonical repair가 Alpaca로 누락 범위를 보충한 뒤
  exact-240을 다시 읽는다. 완전한 snapshot을 만들지 못하면 기존 successful asset을 보존한다.

stale 또는 input digest mismatch 자산은 현재 candle 위에 Field, hover와 해설을 표시하지 않는다.
버전·크기·provenance 검증을 통과하지 못한 pack도 저장하거나 전달하지 않는다.

## 강점과 제약

Czardas의 강점은 같은 통계·기하 근거가 전봉 의미, 후보, 경계, Pattern, drawing과 설명까지
닫힌다는 점이다. q8 결정론, bounded 이상치 영향, volume-independent Trend, 정직한 abstention과
편집 가능한 provenance가 제품 계약이다.

입력은 완료된 OHLCV 240봉으로 제한된다. tick/order-book Volume Profile, 뉴스, 재무, 주문 흐름과
미래 데이터는 inference에 사용하지 않는다. 내부 estimated Volume Profile은 H-Line 후보를 최대
0.05 보강할 뿐 선을 만들거나 hard gate를 우회하지 않는다. Pattern 이름은 구조 관계의 요약이고
`baseline_memory`는 확정 지지·저항을 뜻하지 않는다.

## 기준 문서

- [ENGINE_SPEC.md](ENGINE_SPEC.md): kernel, pack, provenance, chart runtime과 API의 기술 기준.
- [VERIFICATION.md](VERIFICATION.md): 영구 회귀 gate, 성능·크기 한도와 수동 build 운영 검증.
