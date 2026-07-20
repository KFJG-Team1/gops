import assert from "node:assert/strict";

import { chartEventTargetCandleIndex, upcomingDailyEventLogicalIndex, type ChartEarningsEvent, type ChartNewsDay } from "../src/chart/chartEvents";
import { viewportCenteredOnLogicalIndex, viewportCenteredOnSceneX } from "../src/chart/intervalNavigation";
import type { CandleDto } from "../src/chart/types";

const centeredRecent = viewportCenteredOnLogicalIndex(
  140,
  138,
  { visibleCount: 120, rightOffset: 0 },
  800
);
assert.deepEqual(centeredRecent, { visibleCount: 120, rightOffset: -58.5 });
assert.equal(
  viewportCenteredOnSceneX(140, centeredRecent, 450, 400, 5, 800).rightOffset,
  -68.5
);

const intradayCandles = [
  candle("2026-07-15T13:30:00.000Z"),
  candle("2026-07-15T14:30:00.000Z"),
  candle("2026-07-15T20:00:00.000Z")
];
const news: ChartNewsDay = {
  id: "news:AAPL:2026-07-15",
  type: "news",
  date: "2026-07-15",
  articleCount: 1,
  summary: "",
  keyPoints: [],
  impactDirection: "neutral",
  sentiment: "neutral",
  sources: [{ title: "", url: "https://example.com", publishedAt: "2026-07-15T14:10:00.000Z" }]
};
const earnings: ChartEarningsEvent = {
  id: "earnings:AAPL:2026-07-15",
  type: "earnings",
  eventAt: "2026-07-15T20:05:00.000Z",
  status: "reported",
  session: "after",
  eps: { actual: 1, estimate: 1, surprise: 0, surprisePercent: 0 },
  source: "test",
  sourceAsOf: "2026-07-15T21:00:00.000Z"
};
assert.equal(chartEventTargetCandleIndex(intradayCandles, "1h", news), 1);
assert.equal(chartEventTargetCandleIndex(intradayCandles, "1h", earnings), 2);
assert.equal(chartEventTargetCandleIndex([candle("2026-07-15T04:00:00.000Z")], "1D", news), 0);
assert.equal(
  upcomingDailyEventLogicalIndex([candle("2026-07-15T04:00:00.000Z")], "2026-07-20T20:00:00.000Z"),
  5
);
assert.equal(
  upcomingDailyEventLogicalIndex([candle("2026-07-15T04:00:00.000Z")], "2026-07-15T20:00:00.000Z"),
  null
);

function candle(timestamp: string): CandleDto {
  return {
    timestamp,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000,
    isClosed: true
  };
}
