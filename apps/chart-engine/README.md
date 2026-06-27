# Chart Engine

팀원 차트 엔진 코드가 들어올 자리입니다.

현재 임시 프론트는 제거했습니다. 차트 엔진은 Alpaca 원본이나 Kafka Raw Topic을 직접 읽지 않고,
Chart API의 REST 응답과 WebSocket Gateway의 실시간 메시지만 사용합니다.

초기 로딩:

```text
GET /api/charts/candles?symbol=AAPL&interval=1m&startTime=...&endTime=...&ma=5,20,60
```

실시간 수신:

```text
LIVE_CANDLE_UPDATE
CANDLE_CLOSED
CANDLE_CORRECTED
TRADE_TICK
```

프론트 라우팅, canvas/WebGL/chart library 선택, interaction model은 팀원 구현에서 결정합니다.
