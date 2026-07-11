export type CandleData = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  sourceInterval?: string;
  feedProfile?: string;
  marketSession?: string;
  updatedAt?: string;
  displayOnly?: boolean;
  synthetic?: boolean;
  ma5?: number;
  ma20?: number;
  ma60?: number;
};

export type CandleEventType = "LIVE_CANDLE_UPDATE" | "CANDLE_CLOSED" | "CANDLE_CORRECTED";
export type ChartSnapshotDataStatus = "ready" | "partial" | "empty" | "error";
export type RepairStatus = "none" | "gapfill_required" | "gapfill_active" | "gapfill_failed" | "history_preload_required";
export type ChartCoverageState = "complete" | "partial" | "empty" | "unavailable";

export type ChartGapRange = {
  start: string;
  end: string;
  missingCount?: number;
};

export type ChartCoverage = {
  state: ChartCoverageState;
  reasonCode?: string;
  message?: string;
  repairStatus?: RepairStatus;
  sourceInterval?: string;
  requestedLimit?: number;
  returnedCount?: number;
  storedCandleCount?: number;
  targetStoredCount?: number;
  targetRangeFrom?: string;
  availableFrom?: string;
  availableTo?: string;
  invalidRowCount?: number;
  renderable?: boolean;
  minimumReturnedCount?: number;
  minimumRenderableSourceBars?: number;
  returnedSpanSeconds?: number;
  maxRenderableSpanSeconds?: number;
  renderabilityReasonCode?: string;
  gapRanges?: ChartGapRange[];
};

export type CandleSnapshot = {
  symbol: string;
  interval: string;
  source: string;
  feed: string;
  feedProfile?: string;
  marketSession?: string;
  snapshotCursor?: string;
  dataStatus?: ChartSnapshotDataStatus;
  sourceInterval?: string;
  message?: string;
  requestedLimit?: number;
  returnedCount?: number;
  targetStoredCount?: number;
  targetRangeFrom?: string;
  storedCandleCount?: number;
  availableFrom?: string;
  availableTo?: string;
  oldestTimestamp?: string;
  newestTimestamp?: string;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  coverage?: ChartCoverage;
  indicators: {
    ma: number[];
    volume: boolean;
  };
  candles: CandleData[];
};

export type CandleEvent = {
  type: CandleEventType;
  eventId?: string;
  cursor?: string;
  symbol: string;
  interval: string;
  sourceInterval?: string;
  source?: string;
  feed?: string;
  feedProfile?: string;
  marketSession?: string;
  data: CandleData;
};

export type TradeTickData = {
  tradeId?: string;
  price?: number;
  size?: number;
  exchange?: string;
  conditions?: string[];
  tape?: string;
  timestamp?: string;
  updatedAt?: string;
};

export type QuoteTickData = {
  bidPrice?: number;
  bidSize?: number;
  askPrice?: number;
  askSize?: number;
  bidExchange?: string;
  askExchange?: string;
  conditions?: string[];
  timestamp?: string;
  updatedAt?: string;
};

export type RealtimeLayerEvent =
  | { type: "LIVE_TRADE_UPDATE"; symbol: string; data: TradeTickData }
  | { type: "LIVE_QUOTE_UPDATE"; symbol: string; data: QuoteTickData };

export type StreamStatus = "connecting" | "idle" | "live" | "stale" | "error";

export type ChartType = "candle" | "line" | "ohlc" | "bidask";

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

export type ChartLayerPlacement = "overlay" | "below";

export type ChartLayerMetadata = {
  id: ChartLayerKey;
  kind: "base-price" | "price-overlay" | "indicator-pane" | "volume-pane" | "volume-profile";
  label: string;
  paneId: string;
  source: "candle" | "derived" | "legacy";
  params?: Record<string, string | number | boolean>;
  placement: ChartLayerPlacement;
  supportedPlacements: ChartLayerPlacement[];
};

export type ChartSizeVariant = "compact" | "standard" | "wide" | "large";

export type ChartViewport = {
  rightOffset: number;
  visibleCount: number;
};

export type ChartCommandActor = "user" | "llm" | "system";

export type ChartCommandHistoryScope = "chartPanel" | "external";

export type ChartCommandType =
  | "chart.symbol.set"
  | "chart.timeframe.set"
  | "chart.type.set"
  | "chart.viewport.set"
  | "chart.pane.ratio.set"
  | "chart.layer.visibility.set"
  | "chart.undo"
  | "chart.redo"
  | "chart.drawing.add"
  | "chart.drawing.update"
  | "chart.drawing.remove"
  | "chart.drawing.select"
  | "chart.drawing.clearSelection"
  | "chart.preview.set"
  | "chart.preview.toggle"
  | "chart.preview.apply"
  | "chart.preview.clear"
  | "chart.comparison.add"
  | "chart.comparison.remove"
  | "chart.comparison.update";

export type ChartCommand = {
  id: string;
  type: ChartCommandType;
  actor: ChartCommandActor;
  target: {
    panelId: string;
    chartDocumentId: string;
  };
  payload: Record<string, unknown>;
  createdAt: string;
  proposalId?: string;
  historyScope?: ChartCommandHistoryScope;
};

export type ChartCommandJournalEntry = {
  id: string;
  commandType:
    | ChartCommandType
    | "chart.proposal.accept"
    | "chart.proposal.reject"
    | "chart.data.snapshot"
    | "chart.data.live"
    | "chart.layer.trade"
    | "chart.layer.quote";
  actor: ChartCommandActor;
  status: "applied" | "failed" | "proposed" | "ignored" | "undone" | "redone";
  message: string;
  chartDocumentId?: string;
  createdAt: string;
};

export type ChartDocumentSnapshot = {
  id: string;
  symbol: string;
  chartType: ChartType;
  timeframe: string;
  viewport: ChartViewport;
  panes: ChartDocument["panes"];
  layers: ChartDocument["layers"];
  style: ChartDocument["style"];
  interactionState: ChartDocument["interactionState"];
  drawings: DrawingEntity[];
  comparisons: ComparisonSeries[];
  selectedDrawingId?: string;
  updatedAt: string;
};

export type ChartHistoryEntry = {
  id: string;
  label: string;
  commandTypes: ChartCommandType[];
  actor: ChartCommandActor;
  before: ChartDocumentSnapshot;
  after: ChartDocumentSnapshot;
  createdAt: string;
  proposalId?: string;
  historyScope?: ChartCommandHistoryScope;
};

export type ChartDocument = {
  id: string;
  symbol: string;
  chartType: ChartType;
  timeframe: string;
  viewport: ChartViewport;
  panes: Array<{
    id: string;
    heightRatio: number;
  }>;
  layers: Partial<Record<ChartLayerKey, boolean>>;
  style: {
    background: string;
    surface: string;
    surfaceStrong: string;
    border: string;
    shadow: string;
    grid: string;
    axis: string;
    crosshair: string;
    text: string;
    muted: string;
    bullish: string;
    bearish: string;
    ma5: string;
    ma20: string;
    ma60: string;
    volume: string;
    drawing: string;
    preview: string;
    signal: string;
    caution: string;
    purple: string;
    pointYellow: string;
    pointOrange: string;
    pointPurple: string;
  };
  interactionState: {
    mode: ChartToolMode;
    trendLineExtension: ChartLineExtension;
    parallelLineCount: number;
  };
  drawings: DrawingEntity[];
  comparisons: ComparisonSeries[];
  selectedDrawingId?: string;
  history: ChartHistoryEntry[];
  future: ChartHistoryEntry[];
  updatedAt: string;
};

export type ChartLoadState = "loading" | "ready" | "partial" | "empty" | "error";

export type ChartDataStatus = {
  state: ChartLoadState;
  message?: string;
  source?: string;
  feed?: string;
  feedProfile?: string;
  marketSession?: string;
  sourceInterval?: string;
  requestedLimit?: number;
  returnedCount?: number;
  targetStoredCount?: number;
  targetRangeFrom?: string;
  storedCandleCount?: number;
  availableFrom?: string;
  availableTo?: string;
  oldestTimestamp?: string;
  newestTimestamp?: string;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  coverage?: ChartCoverage;
  updatedAt: string;
};

export type ChartProposalStatus = "pending" | "applied" | "rejected" | "failed";

export type ChartProposal = {
  id: string;
  title: string;
  rationale: string;
  summary: string;
  target: {
    panelId: string;
    chartDocumentId: string;
  };
  commands: ChartCommand[];
  insights: string[];
  status: ChartProposalStatus;
  createdAt: string;
  createdByAgentId: string;
  error?: string;
};

export type ChartCapability = {
  id: string;
  label: string;
  description: string;
  commandTypes: ChartCommandType[];
  payloadSchema: Record<string, unknown>;
  requiredContext: string[];
  previewable: boolean;
  autoApplyEligible: boolean;
  undoScope: "chart" | "none";
  conflictsWith: string[];
  recommendedWith: string[];
  validationRules: string[];
};

export type ChartRuntimeError = {
  id: string;
  message: string;
  chartDocumentId?: string;
  createdAt: string;
};

export type ChartRuntimeState = {
  documents: Record<string, ChartDocument>;
  candlesByKey: Record<string, CandleData[]>;
  candleKeyAccessOrder: string[];
  liveTradesBySymbol?: Record<string, TradeTickData>;
  liveQuotesBySymbol?: Record<string, QuoteTickData>;
  dataStatusByKey: Record<string, ChartDataStatus>;
  streamStatusByKey: Record<string, StreamStatus>;
  streamMessageByKey?: Record<string, string>;
  pendingPreviewByDocumentId: Record<string, ChartPendingPreview>;
  pendingProposals: ChartProposal[];
  journal: ChartCommandJournalEntry[];
  errors: ChartRuntimeError[];
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
  | "ellipse"
  | "riskRewardBox"
  | "fibonacciRetracement";

export type DrawingAnchor = {
  timestamp?: string;
  price?: number;
  paneId?: "price" | "volume" | string;
  symbol?: string;
  logicalIndex?: number;
  value?: number;
  interval?: string;
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
  sourceInterval?: string;
  style: DrawingStyle;
  label?: string;
  parallelLineCount?: number;
  locked?: boolean;
  visible: boolean;
  createdBy: ChartCommandActor;
  sourceProposalId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ComparisonSeries = {
  id: string;
  symbol: string;
  label?: string;
  scaleMode: "percent";
  base?: {
    mode: "visibleRangeStart" | "timestamp";
    timestamp?: string;
  };
  style: DrawingStyle;
};

export type ChartPendingPreview = {
  id: string;
  sourceProposalId?: string;
  drawings: DrawingEntity[];
  comparisons: ComparisonSeries[];
  rationale?: string;
  confidence?: number;
  visible: boolean;
  createdAt: string;
};

export type ChartCrosshair = {
  x: number;
  y: number;
  candleIndex: number;
  candle: CandleData;
  price: number;
};

export type RenderScene = {
  state: ChartLoadState;
  message?: string;
  width: number;
  height: number;
  document: ChartDocument;
  candles: CandleData[];
  allCandles: CandleData[];
  visibleStartIndex: number;
  visibleEndIndex: number;
  pendingPreview?: ChartPendingPreview;
  variant: ChartSizeVariant;
  crosshair?: ChartCrosshair;
  plot: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    priceBottom: number;
    volumeTop: number;
  };
  scales: {
    minPrice: number;
    maxPrice: number;
    maxVolume: number;
    minPercent: number;
    maxPercent: number;
    candleWidth: number;
    gap: number;
  };
  comparisonSeries: Array<{
    comparison: ComparisonSeries;
    candles: CandleData[];
    points: Array<{ x: number; y: number; percent: number; candle: CandleData }>;
  }>;
  labels: {
    symbol: string;
    timeframe: string;
    lastPrice?: string;
    range?: string;
    change?: string;
    visibleHigh?: string;
    visibleLow?: string;
    streamStatus?: StreamStatus;
  };
};
