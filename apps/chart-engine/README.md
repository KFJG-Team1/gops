# GOPS Chart Engine

조현호 담당 차트 엔진 패키지입니다. React 화면 코드와 분리된 브라우저 TypeScript 엔진으로 두며, 프론트는 `@gops/chart-engine/*` 경로로 import합니다.

## 책임

- `ChartDocument`, viewport, drawing, indicator display state 관리
- candle snapshot/live event 정규화
- command/proposal validation과 reducer
- scale 계산, render scene 생성, Canvas 2D renderer
- symbol/watchlist 클라이언트 정규화

React hook과 화면 component는 `apps/gops-frontend/`에 둡니다.

## 수정 가능

```text
apps/chart-engine/src/
apps/chart-engine/package.json
apps/chart-engine/tsconfig.json
shared/chart-contract/
```

## 수정 전 협의

```text
apps/gops-frontend/src/components/
services/07-api-websocket/
packages/alfaka/
infra/
```

차트 엔진은 Alpaca, Kafka, S3를 직접 읽지 않습니다. 초기 과거 데이터는 GOPS backend의 REST API가 내려주고, 실시간 데이터는 WebSocket event로 받습니다.
