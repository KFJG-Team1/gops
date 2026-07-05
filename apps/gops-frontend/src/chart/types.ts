export type ChartInterval = "1m" | "5m" | "10m" | "1D" | "1W" | "1M";

export type CandleDto = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  ma5?: number;
  ma20?: number;
  ma60?: number;
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
  renderable?: boolean;
  minimumReturnedCount?: number;
  minimumRenderableSourceBars?: number;
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
    session: "regular";
  };
  status: "ready" | "partial" | "empty" | "pending" | "error";
  candles: CandleDto[];
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
  retryAfterMs?: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type CandleEventDto = {
  type: "LIVE_CANDLE_UPDATE" | "CANDLE_CLOSED" | "CANDLE_CORRECTED";
  symbol: string;
  interval: ChartInterval;
  data: CandleDto;
};

export type ChartLayerKey = "candles" | "volume" | "ma5" | "ma20" | "ma60";

export type ChartToolMode =
  | "select"
  | "pan"
  | "draw-horizontalLine"
  | "draw-trendLine"
  | "draw-verticalMarker"
  | "draw-textLabel"
  | "draw-pointMarker"
  | "draw-arrow"
  | "draw-rangeBox";

export type DrawingType =
  | "horizontalLine"
  | "trendLine"
  | "verticalMarker"
  | "textLabel"
  | "pointMarker"
  | "arrow"
  | "rangeBox";

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
  visible: boolean;
  createdBy: "user" | "agent";
  createdAt: string;
  updatedAt: string;
};

export type ChartAction =
  | { type: "setSymbol"; symbol: string }
  | { type: "setInterval"; interval: ChartInterval }
  | { type: "setTool"; toolMode: ChartToolMode }
  | { type: "toggleLayer"; layer: ChartLayerKey }
  | { type: "setLayer"; layer: ChartLayerKey; enabled: boolean }
  | { type: "setVolumeRatio"; ratio: number }
  | { type: "setViewport"; visibleCount: number; rightOffset: number }
  | { type: "addDrawing"; drawing: DrawingEntity }
  | { type: "updateDrawing"; drawingId: string; patch: Partial<Pick<DrawingEntity, "anchors" | "style" | "label" | "visible">> }
  | { type: "deleteDrawing"; drawingId: string }
  | { type: "selectDrawing"; drawingId?: string }
  | { type: "clearDrawings" };

export type ChartState = {
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  status: CandleQueryResponseDto["status"] | "loading";
  message?: string;
  layers: Record<ChartLayerKey, boolean>;
  volumeRatio: number;
  visibleCount: number;
  rightOffset: number;
  toolMode: ChartToolMode;
  trendLineExtension: ChartLineExtension;
  drawings: DrawingEntity[];
  selectedDrawingId?: string;
  streamState: "connecting" | "live" | "idle" | "error";
};

export const chartIntervals: ChartInterval[] = ["1m", "5m", "10m", "1D", "1W", "1M"];

export const defaultVisibleBarsByInterval: Record<ChartInterval, number> = {
  "1m": 120,
  "5m": 120,
  "10m": 120,
  "1D": 120,
  "1W": 104,
  "1M": 36
};

export function defaultVisibleBarsForInterval(interval: ChartInterval): number {
  return defaultVisibleBarsByInterval[interval];
}
