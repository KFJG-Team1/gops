import type {
  ChartAction,
  ChartInterval,
  ChartLayerKey,
  ChartState,
  DrawingAnchor,
  DrawingEntity,
  DrawingStyle,
  DrawingType
} from "../chart/types";

type ChartAgentRequest = {
  prompt: string;
  chart: ChartState;
};

export type ChartAgentResponse = {
  message: string;
  actions: ChartAction[];
  insights: string[];
};

const allowedActionTypes = new Set<ChartAction["type"]>([
  "setSymbol",
  "setInterval",
  "setTool",
  "toggleLayer",
  "setViewport",
  "addDrawing",
  "updateDrawing",
  "deleteDrawing",
  "selectDrawing",
  "clearDrawings"
]);

const chartIntervals = new Set<ChartInterval>(["1m", "5m", "10m", "1D", "1W", "1M"]);
const chartLayers = new Set<ChartLayerKey>(["candles", "volume", "ma5", "ma20", "ma60"]);
const drawingTypes = new Set<DrawingType>([
  "horizontalLine",
  "trendLine",
  "verticalMarker",
  "textLabel",
  "pointMarker",
  "arrow",
  "rangeBox",
  "measurement"
]);

export async function requestChartAgentActions(request: ChartAgentRequest): Promise<ChartAgentResponse> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toAgentPayload(request))
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `차트 에이전트 요청 실패: ${response.status}`;
    throw new Error(message);
  }
  return normalizeAgentResponse(payload);
}

function toAgentPayload({ prompt, chart }: ChartAgentRequest) {
  const lookback = Math.max(80, chart.visibleCount + Math.max(0, chart.rightOffset) + 80);
  const visibleCandles = chart.candles.slice(-Math.min(chart.candles.length, lookback));
  const lastCandle = visibleCandles[visibleCandles.length - 1];
  const high = visibleCandles.reduce<number | undefined>(
    (current, candle) => current === undefined ? candle.high : Math.max(current, candle.high),
    undefined
  );
  const low = visibleCandles.reduce<number | undefined>(
    (current, candle) => current === undefined ? candle.low : Math.min(current, candle.low),
    undefined
  );
  return {
    agentIds: ["agent-01"],
    messages: [{ role: "user", content: prompt }],
    context: {
      chartDocument: {
        symbol: chart.symbol,
        timeframe: chart.interval
      },
      panel: {
        symbol: chart.symbol,
        interval: chart.interval,
        visibleCount: chart.visibleCount,
        rightOffset: chart.rightOffset,
        layers: chart.layers,
        toolMode: chart.toolMode,
        trendLineExtension: chart.trendLineExtension,
        drawings: chart.drawings
      },
      dataStatus: {
        state: chart.status,
        candleCount: chart.candles.length
      },
      streamStatus: chart.streamState,
      visibleSummary: {
        lastPrice: lastCandle?.close,
        high,
        low
      },
      candles: visibleCandles,
      availableActions: Array.from(allowedActionTypes)
    }
  };
}

function normalizeAgentResponse(payload: unknown): ChartAgentResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("차트 에이전트 응답이 올바르지 않습니다.");
  }
  const source = payload as Record<string, unknown>;
  const actions = Array.isArray(source.actions)
    ? source.actions.filter(isChartAction)
    : normalizeCommandActions(source.commands);
  return {
    message: readString(source.message) ?? readString(source.reply) ?? readString(source.summary) ?? "차트 에이전트가 작업을 제안했습니다.",
    actions,
    insights: Array.isArray(source.insights) ? source.insights.filter((item): item is string => typeof item === "string") : []
  };
}

function normalizeCommandActions(commands: unknown): ChartAction[] {
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.map(commandToAction).filter((action): action is ChartAction => Boolean(action));
}

function commandToAction(command: unknown): ChartAction | null {
  if (!command || typeof command !== "object") {
    return null;
  }
  const source = command as { type?: unknown; payload?: unknown };
  const payload = source.payload && typeof source.payload === "object" ? source.payload as Record<string, unknown> : {};
  switch (source.type) {
    case "chart.symbol.set": {
      const symbol = readString(payload.symbol);
      return symbol ? { type: "setSymbol", symbol } : null;
    }
    case "chart.timeframe.set": {
      const interval = normalizeInterval(payload.timeframe);
      return interval ? { type: "setInterval", interval } : null;
    }
    case "chart.viewport.set": {
      const visibleCount = readNumber(payload.visibleCount);
      const rightOffset = readNumber(payload.rightOffset) ?? 0;
      return visibleCount ? { type: "setViewport", visibleCount, rightOffset } : null;
    }
    case "chart.layer.visibility.set": {
      const layer = normalizeLayer(payload.layer);
      const enabled = typeof payload.visible === "boolean" ? payload.visible : null;
      return layer && enabled !== null ? { type: "setLayer", layer, enabled } : null;
    }
    case "chart.drawing.add":
      return drawingCommandToAction(payload, normalizeDrawingType(payload.drawingType));
    case "chart.measurement.add":
      return drawingCommandToAction(payload, "measurement");
    default:
      return null;
  }
}

function drawingCommandToAction(payload: Record<string, unknown>, fallbackType: DrawingType | null): ChartAction | null {
  const type = fallbackType ?? normalizeDrawingType(payload.drawingType);
  const anchors = normalizeAnchors(payload.anchors);
  if (!type || anchors.length === 0) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    type: "addDrawing",
    drawing: {
      id: readString(payload.id) ?? `agent-drawing-${crypto.randomUUID()}`,
      type,
      anchors,
      style: normalizeDrawingStyle(payload.style),
      label: readString(payload.label) ?? undefined,
      visible: true,
      createdBy: "agent",
      createdAt: now,
      updatedAt: now
    }
  };
}

function isChartAction(action: unknown): action is ChartAction {
  if (!action || typeof action !== "object") {
    return false;
  }
  const candidate = action as ChartAction;
  if (!allowedActionTypes.has(candidate.type)) {
    return false;
  }
  if (candidate.type === "addDrawing") {
    return isDrawingEntity(candidate.drawing);
  }
  return true;
}

function isDrawingEntity(value: unknown): value is DrawingEntity {
  if (!value || typeof value !== "object") {
    return false;
  }
  const drawing = value as DrawingEntity;
  return (
    typeof drawing.id === "string" &&
    typeof drawing.type === "string" &&
    Array.isArray(drawing.anchors) &&
    typeof drawing.style === "object" &&
    typeof drawing.createdAt === "string" &&
    typeof drawing.updatedAt === "string"
  );
}

function normalizeInterval(value: unknown): ChartInterval | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value === "1d" ? "1D" : value === "1w" ? "1W" : value === "1mo" || value === "1MO" || value === "1month" ? "1M" : value;
  return chartIntervals.has(normalized as ChartInterval) ? normalized as ChartInterval : null;
}

function normalizeLayer(value: unknown): ChartLayerKey | null {
  return typeof value === "string" && chartLayers.has(value as ChartLayerKey) ? value as ChartLayerKey : null;
}

function normalizeDrawingType(value: unknown): DrawingType | null {
  return typeof value === "string" && drawingTypes.has(value as DrawingType) ? value as DrawingType : null;
}

function normalizeAnchors(value: unknown): DrawingAnchor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<DrawingAnchor[]>((anchors, item) => {
    if (!item || typeof item !== "object") {
      return anchors;
    }
    const anchor = item as Record<string, unknown>;
    anchors.push({
      timestamp: readString(anchor.timestamp) ?? undefined,
      logicalIndex: readNumber(anchor.logicalIndex) ?? undefined,
      price: readNumber(anchor.price) ?? readNumber(anchor.value) ?? undefined,
      paneId: anchor.paneId === "volume" ? "volume" : "price",
      symbol: readString(anchor.symbol) ?? undefined
    });
    return anchors;
  }, []);
}

function normalizeDrawingStyle(value: unknown): DrawingStyle {
  if (!value || typeof value !== "object") {
    return {};
  }
  const source = value as Record<string, unknown>;
  return {
    color: readString(source.color) ?? undefined,
    fillColor: readString(source.fillColor) ?? undefined,
    lineWidth: readNumber(source.lineWidth) ?? undefined,
    textColor: readString(source.textColor) ?? undefined,
    lineDash: Array.isArray(source.lineDash) ? source.lineDash.filter((item): item is number => typeof item === "number") : undefined
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
