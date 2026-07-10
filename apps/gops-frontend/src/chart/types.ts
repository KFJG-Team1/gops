import type { TradeTickData } from "@gops/chart-engine";
import type { OrderFlowIntradayResponseDto, OrderFlowMinuteDto, OrderFlowMinuteUpdate } from "./orderFlow";

export type ChartInterval = "1m" | "5m" | "10m" | "1h" | "4h" | "1D" | "1W" | "1M";

export type ChartType = "candle" | "line" | "ohlc" | "bidask";

export type CandleDto = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  marketSession?: string;
  ma5?: number;
  ma20?: number;
  ma60?: number;
};

export type IndicatorPointDto = {
  timestamp: string;
  value?: number | null;
  middle?: number | null;
  upper?: number | null;
  lower?: number | null;
  k?: number | null;
  d?: number | null;
  macd?: number | null;
  signal?: number | null;
  histogram?: number | null;
};

export type DerivedResponseState = "ready" | "failed";

export type DerivedResponseSource = "api-compute" | "redis";

export type DerivedMetadataDto = {
  state: DerivedResponseState;
  source: DerivedResponseSource;
  requestHash: string;
  generatedAt?: string;
  error?: string;
};

export type IndicatorLayerDto = {
  id: string;
  kind: string;
  placement: "overlay" | "below";
  parameters: Record<string, number>;
  points: IndicatorPointDto[];
};

export type IndicatorSeriesResponseDto = {
  symbol: string;
  interval: ChartInterval;
  calculationVersion: string;
  dataStatus?: "ready" | "empty" | "failed";
  indicators: IndicatorLayerDto[];
  series: Record<string, IndicatorPointDto[]>;
  derived?: DerivedMetadataDto;
  cache?: {
    hit: boolean;
    ttlSeconds: number;
    keyVersion: string;
  };
};

export type IndicatorSeries = Record<string, IndicatorPointDto[]>;

export type VolumeProfileBucketDto = {
  index: number;
  priceBin: number;
  priceBinSize: number;
  priceMin: number;
  priceMax: number;
  priceMid: number;
  volume: number;
  tradeCount: number;
  vwap?: number | null;
  volumePercent: number;
  isPoc: boolean;
  inValueArea: boolean;
};

export type VolumeProfileSummaryDto = {
  index: number;
  priceMin: number;
  priceMax: number;
  priceMid: number;
  volume: number;
  tradeCount: number;
};

export type VolumeProfileValueAreaDto = {
  low: number;
  high: number;
  volume: number;
  volumePercent: number;
  targetPercent: number;
  bucketIndexes: number[];
};

export type VolumeProfileResponseDto = {
  symbol: string;
  interval?: ChartInterval;
  sourceInterval?: ChartInterval;
  from: string;
  to: string;
  timeBucket: ChartInterval;
  targetBins: number;
  bucketCount: number;
  priceBinSize: number;
  sourcePriceBinSize?: number | null;
  sourceBinCount: number;
  source: string;
  feed: string;
  feedProfile?: string | null;
  calculationVersion: string;
  classificationVersion?: string;
  sideClassification?: "estimated";
  estimationMethod?: string;
  dataStatus: "ready" | "empty" | "failed";
  priceRange: {
    min?: number | null;
    max?: number | null;
    requestedMin?: number | null;
    requestedMax?: number | null;
  };
  totalVolume: number;
  totalTradeCount: number;
  sourceCandleCount?: number;
  bins: VolumeProfileBucketDto[];
  poc?: VolumeProfileSummaryDto | null;
  valueArea?: VolumeProfileValueAreaDto | null;
  derived?: DerivedMetadataDto;
  cache?: {
    hit: boolean;
    ttlSeconds: number;
    keyVersion: string;
  };
};

export type ChartSymbolDto = {
  symbol: string;
  name: string;
  sector?: string;
  isMock?: boolean;
};

export type ChartSymbolsResponseDto = {
  symbols: ChartSymbolDto[];
};

export type ChartCompareRange = "1D" | "1M" | "6M" | "1Y" | "5Y";

export type ChartComparePointDto = {
  time: string;
  price: number;
  returnPercent: number;
};

export type ChartCompareItemDto = {
  symbol: string;
  companyName?: string;
  exchange?: string | null;
  color?: string;
  basePrice?: number | null;
  lastPrice?: number | null;
  change?: number | null;
  changePercent?: number | null;
  points: ChartComparePointDto[];
  error?: string;
  message?: string;
};

export type ChartCompareResponseDto = {
  range: ChartCompareRange;
  timeframe: string;
  baseMode: "first_close";
  session: "regular";
  adjustment: "split";
  asOf: string;
  items: ChartCompareItemDto[];
  warnings?: Array<{ symbol?: string; code?: string; message?: string }>;
  cache?: {
    hit: boolean;
    ttlSeconds: number;
    key?: string;
  };
};

export type RepairStatus = "none" | "gapfill_required" | "gapfill_active" | "gapfill_failed" | "history_preload_required";

export type FillStatus = "not_needed" | "filled" | "partial" | "timeout" | "failed" | "empty";

export type CoverageRangeDto = {
  start: string;
  end: string;
  missingCount?: number;
};

export type CandleCoverageDto = {
  state?: string;
  reasonCode?: string;
  renderabilityReasonCode?: string;
  message?: string;
  repairStatus?: RepairStatus;
  sourceInterval?: ChartInterval | string;
  requestedLimit?: number;
  returnedCount?: number;
  storedCandleCount?: number;
  targetStoredCount?: number;
  targetRangeFrom?: string;
  targetRangeTo?: string;
  availableFrom?: string;
  availableTo?: string;
  invalidRowCount?: number;
  renderable?: boolean;
  minimumReturnedCount?: number;
  minimumRenderableSourceBars?: number;
  returnedSpanSeconds?: number;
  maxRenderableSpanSeconds?: number;
  gapRanges?: CoverageRangeDto[];
  missingRanges?: CoverageRangeDto[];
};

export type FillSourceTraceDto = {
  checked: boolean;
  hit: boolean;
  rowCount: number;
  durationMs: number;
  error?: string | null;
};

export type CandleFillRouteDto = {
  start?: string;
  end?: string;
  feed?: string | null;
  session?: "pre" | "regular" | "after" | "overnight" | "closed" | "all" | string;
  state?: "fetchable" | "skipped" | string;
  reason?: string | null;
  rowCount?: number;
};

export type CandleFillTraceDto = {
  status: FillStatus;
  requestedRange?: {
    start?: string;
    end?: string;
  };
  requestedLimit?: number;
  sourceInterval?: ChartInterval | string;
  sources?: Partial<Record<"redis" | "clickhouse" | "s3" | "alpaca", FillSourceTraceDto>>;
  missingRanges?: CoverageRangeDto[];
  gapRanges?: CoverageRangeDto[];
  feedRoutes?: CandleFillRouteDto[];
  renderable?: boolean;
  minimumReturnedCount?: number;
  minimumRenderableSourceBars?: number;
  backgroundFill?: {
    queued?: boolean;
    state?: "not_needed" | "queued" | "already_queued" | "disabled" | "failed" | string;
    requestId?: string | null;
    reason?: string | null;
  };
  durationMs?: number;
};

export type CandleQueryResponseDto = {
  symbol: string;
  interval: ChartInterval;
  request: {
    limit: number;
    before?: string;
    from?: string;
    to?: string;
    session?: "regular";
  };
  status: "ready" | "partial" | "empty" | "pending" | "error";
  candles: CandleDto[];
  indicators?: {
    ma?: number[];
    volume?: boolean;
  };
  dataStatus?: CandleQueryResponseDto["status"];
  message?: string;
  fill?: CandleFillTraceDto;
  sourceInterval?: ChartInterval | string;
  coverage?: CandleCoverageDto;
  requestedLimit?: number;
  returnedCount?: number;
  storedCandleCount?: number;
  targetStoredCount?: number;
  targetRangeFrom?: string;
  targetRangeTo?: string;
  availableFrom?: string;
  availableTo?: string;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  previousClose?: number | null;
  retryAfterMs?: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type CandleEventDto =
  | {
      type: "LIVE_CANDLE_UPDATE" | "CANDLE_CLOSED" | "CANDLE_CORRECTED";
      symbol: string;
      interval: ChartInterval;
      data: CandleDto;
    }
  | {
      type: "LIVE_TRADE_UPDATE" | "LIVE_QUOTE_UPDATE";
      symbol: string;
      interval?: "trades" | "quotes";
      data: Record<string, unknown>;
    }
  | {
      type: "ORDER_FLOW_BINS_UPDATE";
      symbol: string;
      interval?: string;
      data: OrderFlowMinuteUpdate;
    };

export type ChartLayerKey =
  | "candles"
  | "volume"
  | "ma5"
  | "ma20"
  | "ma60"
  | "sma:5"
  | "sma:20"
  | "sma:60"
  | "ema:20"
  | "wma:20"
  | "bollinger:20:2"
  | "rsi:14"
  | "stochastic:14:3:3"
  | "macd:12:26:9"
  | "volume-profile";

export type ChartPaneState = {
  id: string;
  heightRatio: number;
};

export type ChartToolMode =
  | "select"
  | "pan"
  | "draw-horizontalLine"
  | "draw-horizontalParallelLines"
  | "draw-trendLine"
  | "draw-trendParallelLines"
  | "draw-verticalMarker"
  | "draw-verticalParallelLines"
  | "draw-textLabel"
  | "draw-flagMarker"
  | "draw-rangeBox"
  | "draw-riskRewardBox"
  | "draw-fibonacciRetracement";

export type DrawingType =
  | "horizontalLine"
  | "horizontalParallelLines"
  | "trendLine"
  | "trendParallelLines"
  | "verticalMarker"
  | "verticalParallelLines"
  | "textLabel"
  | "flagMarker"
  | "rangeBox"
  | "riskRewardBox"
  | "fibonacciRetracement";

export type DrawingAnchor = {
  timestamp?: string;
  logicalIndex?: number;
  price?: number;
  paneId?: "price" | "volume";
  symbol?: string;
  interval?: ChartInterval;
};

export type ChartLineExtension = "segment" | "ray" | "line";

export type DrawingStyle = {
  color?: string;
  colorToken?: string;
  lineWidth?: number;
  lineDash?: number[];
  fillColor?: string;
  fillToken?: string;
  fillOpacity?: number;
  textColor?: string;
  textToken?: string;
  fontSize?: number;
  opacity?: number;
  extension?: ChartLineExtension;
};

export type DrawingEntity = {
  id: string;
  type: DrawingType;
  anchors: DrawingAnchor[];
  sourceInterval?: ChartInterval;
  style: DrawingStyle;
  label?: string;
  parallelLineCount?: number;
  locked?: boolean;
  visible: boolean;
  createdBy: "user" | "agent" | "system" | "llm";
  sourceProposalId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ComparisonBase = {
  mode: "visibleRangeStart" | "timestamp";
  timestamp?: string;
};

export type ChartComparisonStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type ChartComparisonCandleScope = {
  key: string;
  interval: ChartInterval;
  from?: string;
  to?: string;
  parentExpansionId?: string;
  candles: CandleDto[];
  status: ChartComparisonStatus;
  message?: string;
};

export type ChartComparisonSeries = {
  id: string;
  symbol: string;
  label?: string;
  scaleMode: "percent";
  base?: ComparisonBase;
  style: DrawingStyle;
  candles: CandleDto[];
  scopes?: ChartComparisonCandleScope[];
  interval?: ChartInterval;
  status: ChartComparisonStatus;
  message?: string;
};

export type ChartAction =
  | { type: "setSymbol"; symbol: string }
  | { type: "setInterval"; interval: ChartInterval }
  | { type: "setChartType"; chartType: ChartType }
  | { type: "setTool"; toolMode: ChartToolMode }
  | { type: "toggleLayer"; layer: ChartLayerKey }
  | { type: "setLayer"; layer: ChartLayerKey; enabled: boolean }
  | { type: "setVolumeRatio"; ratio: number }
  | { type: "setViewport"; visibleCount: number; rightOffset: number }
  | { type: "addDrawing"; drawing: DrawingEntity }
  | { type: "updateDrawing"; drawingId: string; patch: Partial<Pick<DrawingEntity, "anchors" | "style" | "label" | "parallelLineCount" | "visible">> }
  | { type: "deleteDrawing"; drawingId: string }
  | { type: "selectDrawing"; drawingId?: string }
  | { type: "clearDrawings" };

export type ChartState = {
  symbol: string;
  chartType: ChartType;
  interval: ChartInterval;
  candles: CandleDto[];
  liveTrade?: TradeTickData;
  status: CandleQueryResponseDto["status"] | "loading";
  message?: string;
  requestedLimit?: number;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  layers: Partial<Record<ChartLayerKey, boolean>>;
  indicatorSeries?: IndicatorSeries;
  volumeProfile?: VolumeProfileResponseDto | null;
  orderFlow?: {
    dataStatus: OrderFlowIntradayResponseDto["dataStatus"];
    supportedSymbols?: string[];
    priceBinSize: number;
    sessionDate: string | null;
    minutes: Map<string, OrderFlowMinuteDto>;
  } | null;
  panes?: ChartPaneState[];
  volumeRatio: number;
  visibleCount: number;
  rightOffset: number;
  toolMode: ChartToolMode;
  trendLineExtension: ChartLineExtension;
  parallelLineCount: number;
  drawings: DrawingEntity[];
  comparisons: ChartComparisonSeries[];
  selectedDrawingId?: string;
  streamState: "connecting" | "live" | "idle" | "error";
};

export const chartTypes: ChartType[] = ["candle", "line", "ohlc", "bidask"];

export const chartIntervals: ChartInterval[] = ["1m", "5m", "10m", "1h", "4h", "1D", "1W", "1M"];

export const bidAskChartIntervals: ChartInterval[] = ["1m", "10m", "1h"];

export const defaultBidAskInterval: ChartInterval = "10m";

export const defaultVisibleBarsByInterval: Record<ChartInterval, number> = {
  "1m": 120,
  "5m": 120,
  "10m": 120,
  "1h": 120,
  "4h": 120,
  "1D": 120,
  "1W": 104,
  "1M": 36
};

export function defaultVisibleBarsForInterval(interval: ChartInterval): number {
  return defaultVisibleBarsByInterval[interval];
}

export function isBidAskChartInterval(value: unknown): value is ChartInterval {
  return value === "1m" || value === "10m" || value === "1h";
}

export function normalizeBidAskChartInterval(value: unknown): ChartInterval {
  return isBidAskChartInterval(value) ? value : defaultBidAskInterval;
}

export function defaultVisibleBarsForBidAskInterval(interval: ChartInterval): number {
  if (interval === "10m") {
    return 39;
  }
  if (interval === "1h") {
    return 7;
  }
  return defaultVisibleBarsForInterval(interval);
}
