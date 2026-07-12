import type { AgentReference } from "./agentReferences";
import { overlayExpiry, type AgentVisualOverlay } from "./agentVisualOverlay";
import type {
  CandleDto,
  ChartAction,
  ChartLayerKey,
  ChartState,
  DrawingEntity
} from "../chart/types";

type PriceSource = "open" | "high" | "low" | "close";

export type ChartOperation =
  | {
      type: "addHorizontalLine";
      target: "price";
      dateHint?: DateHint;
      priceSource?: PriceSource;
      explicitPrice?: number;
      applyMode: "persistent";
    }
  | {
      type: "setLayerVisibility";
      target: ChartLayerKey;
      visible: boolean;
      applyMode: "persistent";
    }
  | {
      type: "hideOtherIndicatorLayers";
      target: ChartLayerKey;
      applyMode: "persistent";
    };

export type ChartOperationIR = {
  operations: ChartOperation[];
  entities: {
    dates: string[];
    layers: ChartLayerKey[];
    priceSources: PriceSource[];
  };
  references: AgentReference[];
  ambiguities: Array<{ slot: string; candidates: unknown[]; question: string }>;
  confidence: number;
};

export type CompiledChartOperationResult = {
  handled: boolean;
  message: string;
  actions: ChartAction[];
  visualOverlays: AgentVisualOverlay[];
  operationIR?: ChartOperationIR;
};

type DateHint = {
  year?: number;
  month: number;
  day: number;
  raw: string;
};

type ResolvedCandle = {
  candle: CandleDto;
  source: "reference" | "date" | "latest";
};

const indicatorLayers: ChartLayerKey[] = [
  "ma5",
  "ma20",
  "ma60",
  "sma:5",
  "sma:20",
  "sma:60",
  "sma:120",
  "ema:20",
  "wma:20",
  "bollinger:20:2",
  "rsi:14",
  "stochastic:14:3:3",
  "macd:12:26:9",
  "volume-profile"
];

export function compileDeterministicChartOperations(input: {
  query: string;
  chart: ChartState;
  references?: AgentReference[];
}): CompiledChartOperationResult {
  const normalized = normalizeQuery(input.query);
  const references = input.references ?? [];
  const operations = extractOperations(normalized);
  if (!operations.length) {
    return { handled: false, message: "", actions: [], visualOverlays: [] };
  }
  const ir: ChartOperationIR = {
    operations,
    entities: {
      dates: operations.flatMap((operation) => operation.type === "addHorizontalLine" && operation.dateHint ? [operation.dateHint.raw] : []),
      layers: operations.flatMap((operation) => operation.type === "setLayerVisibility" || operation.type === "hideOtherIndicatorLayers" ? [operation.target] : []),
      priceSources: operations.flatMap((operation) => operation.type === "addHorizontalLine" && operation.priceSource ? [operation.priceSource] : [])
    },
    references,
    ambiguities: [],
    confidence: 0.82
  };
  const actions: ChartAction[] = [];
  const visualOverlays: AgentVisualOverlay[] = [];
  const notes: string[] = [];
  for (const operation of operations) {
    if (operation.type === "setLayerVisibility") {
      actions.push({ type: "setLayer", layer: operation.target, enabled: operation.visible });
      notes.push(`${layerLabel(operation.target)} ${operation.visible ? "표시" : "숨김"}`);
      continue;
    }
    if (operation.type === "hideOtherIndicatorLayers") {
      for (const layer of indicatorLayers) {
        if (layer !== operation.target && input.chart.layers[layer]) {
          actions.push({ type: "setLayer", layer, enabled: false });
        }
      }
      notes.push(`${layerLabel(operation.target)} 외 indicator 숨김`);
      continue;
    }
    const resolved = resolveHorizontalLine(operation, input.chart, references);
    if (!resolved) {
      ir.ambiguities.push({
        slot: "horizontalLine.priceAnchor",
        candidates: references,
        question: "수평선을 그릴 기준 날짜나 가격을 찾지 못했습니다."
      });
      continue;
    }
    actions.push({
      type: "addDrawing",
      drawing: horizontalLineDrawing({
        chart: input.chart,
        candle: resolved.candle,
        price: candlePrice(resolved.candle, operation.priceSource ?? "close"),
        priceSource: operation.priceSource ?? "close"
      })
    });
    visualOverlays.push(candleHighlightOverlay(input.chart, resolved.candle, "signal"));
    notes.push(`${formatDateLabel(resolved.candle.timestamp)} ${priceSourceLabel(operation.priceSource ?? "close")} 수평선`);
  }
  visualOverlays.push(...overlaysFromReferences(references, input.chart));
  if (ir.ambiguities.length) {
    ir.confidence = 0.38;
    return {
      handled: true,
      message: ir.ambiguities[0]?.question ?? "요청을 확정하려면 기준을 더 알려주세요.",
      actions: [],
      visualOverlays,
      operationIR: ir
    };
  }
  ir.confidence = actions.length ? 0.94 : 0.72;
  return {
    handled: true,
    message: notes.length ? `${notes.join(", ")} 처리했습니다.` : "차트 작업을 처리했습니다.",
    actions,
    visualOverlays,
    operationIR: ir
  };
}

function extractOperations(query: string): ChartOperation[] {
  const operations: ChartOperation[] = [];
  const layer = extractLayer(query);
  if (layer) {
    const visible = !hasAny(query, ["숨겨", "숨김", "꺼", "끄", "제거", "hide", "off"]);
    operations.push({ type: "setLayerVisibility", target: layer, visible, applyMode: "persistent" });
    if (visible && hasAny(query, ["만", "only"])) {
      operations.push({ type: "hideOtherIndicatorLayers", target: layer, applyMode: "persistent" });
    }
  }
  if (hasAny(query, ["수평선", "horizontal line", "horizontal-line"])) {
    operations.push({
      type: "addHorizontalLine",
      target: "price",
      dateHint: extractDateHint(query),
      priceSource: extractPriceSource(query),
      explicitPrice: extractExplicitPrice(query),
      applyMode: "persistent"
    });
  }
  return operations;
}

function resolveHorizontalLine(operation: Extract<ChartOperation, { type: "addHorizontalLine" }>, chart: ChartState, references: AgentReference[]): ResolvedCandle | null {
  const referenceCandle = candleFromReferences(references);
  if (referenceCandle && !operation.dateHint) {
    return { candle: referenceCandle, source: "reference" };
  }
  if (operation.dateHint) {
    const candle = findCandleByDateHint(chart.candles, operation.dateHint);
    return candle ? { candle, source: "date" } : null;
  }
  if (operation.explicitPrice !== undefined) {
    const latest = latestCandle(chart);
    return latest ? { candle: { ...latest, close: operation.explicitPrice }, source: "latest" } : null;
  }
  return referenceCandle
    ? { candle: referenceCandle, source: "reference" }
    : latestCandle(chart)
      ? { candle: latestCandle(chart)!, source: "latest" }
      : null;
}

function candleFromReferences(references: AgentReference[]): CandleDto | null {
  const ref = references.find((item) => item.type === "chart.candle");
  const data = ref?.data;
  if (!data) {
    return null;
  }
  const timestamp = readString(data.timestamp) ?? readString(data.from);
  const open = readNumber(data.open);
  const high = readNumber(data.high);
  const low = readNumber(data.low);
  const close = readNumber(data.close);
  const volume = readNumber(data.volume) ?? 0;
  if (!timestamp || open === undefined || high === undefined || low === undefined || close === undefined) {
    return null;
  }
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    isClosed: Boolean(data.isClosed ?? true)
  };
}

function findCandleByDateHint(candles: CandleDto[], hint: DateHint): CandleDto | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    const date = parseTimestampDate(candle.timestamp);
    if (!date) {
      continue;
    }
    if (date.month === hint.month && date.day === hint.day && (hint.year === undefined || date.year === hint.year)) {
      return candle;
    }
  }
  return null;
}

function latestCandle(chart: ChartState): CandleDto | null {
  return chart.candles[chart.candles.length - 1] ?? null;
}

function horizontalLineDrawing(input: {
  chart: ChartState;
  candle: CandleDto;
  price: number;
  priceSource: PriceSource;
}): DrawingEntity {
  const now = new Date().toISOString();
  return {
    id: `agent-horizontal-line-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    type: "horizontalLine",
    anchors: [{
      timestamp: input.candle.timestamp,
      price: input.price,
      paneId: "price",
      symbol: input.chart.symbol,
      interval: input.chart.interval
    }],
    sourceInterval: input.chart.interval,
    style: {
      colorToken: "signal",
      lineWidth: 1.5
    },
    label: `${priceSourceLabel(input.priceSource)} ${formatPrice(input.price)}`,
    visible: true,
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function candlePrice(candle: CandleDto, source: PriceSource): number {
  return candle[source];
}

function candleHighlightOverlay(chart: ChartState, candle: CandleDto, styleToken: AgentVisualOverlay["styleToken"]): AgentVisualOverlay {
  return {
    id: `agent-overlay-candle-${candle.timestamp}-${Date.now().toString(36)}`,
    kind: "candleHighlight",
    anchors: [{
      symbol: chart.symbol,
      interval: chart.interval,
      timestamp: candle.timestamp
    }],
    styleToken,
    expiresAt: overlayExpiry(),
    label: candle.timestamp.slice(0, 10)
  };
}

function overlaysFromReferences(references: AgentReference[], chart: ChartState): AgentVisualOverlay[] {
  const overlays: AgentVisualOverlay[] = [];
  references.forEach((reference, index) => {
    const data = reference.data;
    if (reference.type === "chart.candle") {
      const timestamp = readString(data.timestamp) ?? readString(data.from);
      const symbol = readString(data.symbol) ?? chart.symbol;
      const interval = readString(data.interval) as ChartState["interval"] | undefined;
      if (timestamp) {
        overlays.push({
          id: `agent-overlay-ref-candle-${index}-${timestamp}`,
          kind: "candleHighlight",
          anchors: [{
            symbol,
            interval: interval ?? chart.interval,
            timestamp
          }],
          styleToken: "preview",
          expiresAt: overlayExpiry()
        });
      }
    }
    if (reference.type === "chart.range") {
      const from = readString(data.from);
      const to = readString(data.to);
      const symbol = readString(data.symbol) ?? chart.symbol;
      const interval = readString(data.interval) as ChartState["interval"] | undefined;
      if (from && to) {
        overlays.push({
          id: `agent-overlay-ref-range-${index}-${from}-${to}`,
          kind: "rangeHighlight",
          anchors: [{
            symbol,
            interval: interval ?? chart.interval,
            from,
            to
          }],
          styleToken: "preview",
          expiresAt: overlayExpiry()
        });
      }
    }
  });
  return overlays;
}

function extractLayer(query: string): ChartLayerKey | null {
  if (hasAny(query, ["볼린저", "볼밴", "bollinger", "bb"])) {
    return "bollinger:20:2";
  }
  if (hasAny(query, ["rsi", "알에스아이"])) {
    return "rsi:14";
  }
  if (hasAny(query, ["macd", "맥디"])) {
    return "macd:12:26:9";
  }
  if (hasAny(query, ["스토캐스틱", "stochastic"])) {
    return "stochastic:14:3:3";
  }
  if (hasAny(query, ["거래량 프로파일", "volume profile", "vpvr"])) {
    return "volume-profile";
  }
  if (hasAny(query, ["거래량", "volume"])) {
    return "volume";
  }
  const ma = query.match(/(?:ma|sma|이평|이동평균)\s*([0-9]{1,3})/);
  if (ma?.[1] === "5") {
    return "sma:5";
  }
  if (ma?.[1] === "20") {
    return "sma:20";
  }
  if (ma?.[1] === "60") {
    return "sma:60";
  }
  if (ma?.[1] === "120") {
    return "sma:120";
  }
  if (/(?:^|\s)120\s*일선(?:\s|$)/.test(query)) {
    return "sma:120";
  }
  return null;
}

function extractPriceSource(query: string): PriceSource | undefined {
  if (hasAny(query, ["종가", "close"])) {
    return "close";
  }
  if (hasAny(query, ["시가", "open"])) {
    return "open";
  }
  if (hasAny(query, ["고가", "high"])) {
    return "high";
  }
  if (hasAny(query, ["저가", "low"])) {
    return "low";
  }
  return undefined;
}

function extractDateHint(query: string): DateHint | undefined {
  const korean = query.match(/(?:(20[0-9]{2})\s*년\s*)?([0-9]{1,2})\s*월\s*([0-9]{1,2})\s*일/);
  if (korean) {
    return {
      year: korean[1] ? Number(korean[1]) : undefined,
      month: Number(korean[2]),
      day: Number(korean[3]),
      raw: korean[0]
    };
  }
  const slash = query.match(/(?:(20[0-9]{2})[./-])?([0-9]{1,2})[./-]([0-9]{1,2})/);
  if (slash) {
    return {
      year: slash[1] ? Number(slash[1]) : undefined,
      month: Number(slash[2]),
      day: Number(slash[3]),
      raw: slash[0]
    };
  }
  return undefined;
}

function extractExplicitPrice(query: string): number | undefined {
  const price = query.match(/(?:가격|price|@|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!price?.[1]) {
    return undefined;
  }
  return Number(price[1].replaceAll(",", ""));
}

function parseTimestampDate(timestamp: string): { year: number; month: number; day: number } | null {
  const match = timestamp.match(/^(20[0-9]{2})-([0-9]{2})-([0-9]{2})/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasAny(query: string, tokens: string[]): boolean {
  return tokens.some((token) => query.includes(token));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function priceSourceLabel(source: PriceSource): string {
  switch (source) {
    case "open":
      return "시가";
    case "high":
      return "고가";
    case "low":
      return "저가";
    case "close":
      return "종가";
  }
}

function layerLabel(layer: ChartLayerKey): string {
  if (layer === "bollinger:20:2") {
    return "볼린저 밴드";
  }
  if (layer === "rsi:14") {
    return "RSI";
  }
  if (layer === "macd:12:26:9") {
    return "MACD";
  }
  if (layer === "volume-profile") {
    return "거래량 프로파일";
  }
  return layer;
}

function formatDateLabel(timestamp: string): string {
  return timestamp.slice(0, 10) || timestamp;
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
