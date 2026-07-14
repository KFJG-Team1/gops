# Czardas v4

> Czardas v4는 exact-240의 모든 candle을 현재 시점에서 함께 보며, 가격 기억·회귀
> 흐름·robust 경계와 그 관계를 하나의 Field로 해석해 H-Line, Trend와 편집 가능한
> Pattern 꺾은선을 제안하는 결정론적 통계·기하 엔진이다.

## 무엇을 보는가

Czardas는 미래를 맞히는 점수기가 아니다. 최신 완료봉 240개를 하나의 현재 장면으로 보고
각 candle의 형태, 주변 구조, 가격 기억 참여와 경계 관계를 설명한다. 새 봉이나 correction으로
snapshot이 바뀌면 과거 candle의 현재적 의미도 바뀔 수 있다. live candle과 `asOf` 뒤 데이터는
어느 단계에도 들어가지 않는다.

모든 candle에는 Shared, H-Line, Trend 의미가 있다. 화면용 `240봉 내 의미 백분위`는 세
채널의 상대적 시각 강도를 합친 값이며 확률·매수·매도 점수가 아니고 inference에 되먹임되지
않는다. Pattern은 네 번째 candle 점수가 아니라 Field primitive 사이의 관계다.

## 하나의 Field

```text
canonical exact-240
  → 전봉 Intrinsic Meaning
  → adaptive StructuralDomainTree
  → Structural Facts
  → PriceMemoryField + RegressionFlow
  → H-Line / Trend Boundary modes
  → StructureRelation + PatternTrace
  → joint scene selection
  → CzardasInference
  → deterministic CzardasSightPack
```

- PriceMemory는 OHLC 가격 점유, endpoint와 reaction을 연속 가격 구간에 누적한다.
- OLS는 candle 집합의 중심 흐름을 설명한다. 최종 Trend를 대신하지 않는다.
- Trend는 endpoint fact에 robust fit한 실제 상·하단 경계다.
- Pattern은 기존 흐름·경계·접촉·impulse의 관계다. 별도 detector가 선을 다시 계산하지 않는다.
- robust Trend와 OLS의 합의와 충돌은 모두 설명 가능한 사실이다.

## 결과와 화면

- H-Line: `1..4`, 선호 2. 정상 Ready snapshot에는 volume 없이도 성립하는 dominant
  PriceMemory가 최소 한 개 있다. 약하면 `baseline_memory`라고 솔직히 표시한다.
- Trend: `0..3`, 선호 2. hard-valid 후보가 없으면 그리지 않는다.
- Pattern: `0..2`. Triangle, Channel, Rectangle, Wedge, Flag, Pennant 관계를 수용하되
  이름 수가 목표가 아니다. 감지된 relation만 실제 fact 3~16개를 이은 polyline 하나로 그린다.
- 승격되지 않은 관계도 대표 접촉 순서 하나는 `PatternEvidence`로 남길 수 있다. 이는 국소 점과
  짧은 connector일 뿐 Pattern 이름이나 managed polyline을 만들지 않는다.
- managed drawing은 최대 9개이며 사용자가 편집·삭제·복원할 수 있다. 편집은 session fork이고
  서버 inference를 바꾸지 않는다.

좌측 아래의 H-Line, Trend, Pattern 세 토글은 독립적이다. Shared 의미는 항상 남는다. 확대
상태의 candle 진하기는 Shared+Trend, 짧은 수평 흔적은 Shared+H-Line, 축소 상태의 노랑은
켜진 채널 전체 의미다. OLS, 후보 경계, Pattern fact, 최종 drawing은 실제 provenance와 같은
timestamp+price 좌표를 사용한다.
최종 Pattern이 없어도 투영 가능한 PatternEvidence가 있으면 Pattern 토글은 활성화된다. evidence
closure가 Field 예산에 들어오지 않으면 고립된 일부만 남기지 않고 evidence 전체를 생략한다.

hover는 pack의 versioned factor/reason codebook을 읽어 모든 현재 근거를 접지 않고 표시한다.
factor 목록은 프런트 상수가 아니다. stale 또는 input digest mismatch에서는 Field·hover·해설을
현재 결과처럼 보여주지 않는다.

## 운영

Czardas 자산은 PostgreSQL에 저장하며 모든 사용자에게 동일한 deterministic content를 보낸다.
개발 단계에서는 `작도 자산(개발)` 패널로 정확히 한 `symbol×interval`만 수동 build/delete한다.
chart-open, GET, candle event, Cron은 build를 만들지 않는다. ClickHouse exact-240이 부족하면
중립 canonical repair가 Alpaca로 보충한 뒤 다시 읽는다.

버전은 algorithm `czardas-v4`, config `czardas-config-v4`, Field `4`, Sight
`czardas-sight-v3`다. v3 pack은 incompatible이며 필요한 pair만 수동 재분석한다.

## 강점과 한계

강점은 같은 통계·기하 근거가 candle 의미, 후보, 경계, Pattern, drawing과 설명까지 닫히는
것이다. 결정론, 이상치에 대한 bounded 영향, volume-independent Trend와 정직한 abstention을
제품 계약으로 가진다.

한계는 OHLCV 240봉의 현재 snapshot만 본다는 점이다. tick/order-book Volume Profile, 뉴스,
재무와 미래 데이터는 사용하지 않는다. Pattern 이름은 구조 관계의 요약이지 예측 보증이 아니며,
baseline H-Line도 확정 지지·저항을 뜻하지 않는다.
