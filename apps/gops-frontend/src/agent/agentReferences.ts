import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import type { ChartState } from "../chart/types";
import {
  buildLadder,
  orderFlowWindowMinutesForInterval,
  sessionDateFromTimestamp,
  sumOrderFlowBucketLevels,
  type OrderFlowDayDto
} from "../chart/orderFlow";

export type AgentReferenceType =
  | "chart.candle"
  | "chart.orderFlow"
  | "chart.range"
  | "chart.pattern"
  | "chart.drawing"
  | "news.article"
  | "news.dailySummary"
  | "ontology.entity"
  | "financial.metric";

export type AgentReference<TData extends Record<string, unknown> = Record<string, unknown>> = {
  type: AgentReferenceType;
  sourcePanelId?: string;
  displayLabel?: string;
  data: TData;
};

export function agentReferenceKey(reference: AgentReference): string {
  return `${reference.type}:${reference.sourcePanelId ?? ""}:${reference.displayLabel ?? JSON.stringify(reference.data)}`;
}

// Synthetic key for the active chart's single candle/bar selection (semanticSelection),
// which lives outside the explicit agentReferences array but is shown as a reference chip.
export const SEMANTIC_SELECTION_REFERENCE_KEY = "semantic-selection";

export type AgentReferenceChipKind = "candle" | "news";

export type AgentReferenceChip = {
  key: string;
  kind: AgentReferenceChipKind;
  ticker: string;
};

export function agentReferenceChipKind(reference: AgentReference): AgentReferenceChipKind {
  return reference.type.startsWith("news") ? "news" : "candle";
}

export function agentReferenceTicker(reference: AgentReference): string {
  const data = reference.data as { symbol?: unknown };
  return typeof data.symbol === "string" ? data.symbol : "";
}

export function chartCandleReference(
  selection: SemanticSelectionSnapshot,
  sourcePanelId?: string
): AgentReference<Record<string, unknown>> {
  const labelTime = selection.timestamp ?? selection.from;
  return {
    type: "chart.candle",
    sourcePanelId,
    displayLabel: `${selection.symbol} ${selection.interval} ${labelTime}`,
    data: { ...selection }
  };
}

export function chartOrderFlowReference(
  selection: SemanticSelectionSnapshot,
  day: { sessionDate: string; totals: OrderFlowDayDto["totals"]; pocPriceBin: number | null } | null,
  sourcePanelId?: string
): AgentReference<Record<string, unknown>> {
  return {
    type: "chart.orderFlow",
    sourcePanelId,
    displayLabel: `${selection.symbol} ${day?.sessionDate ?? selection.from} Order Flow`,
    data: {
      ...selection,
      orderFlow: day ?? undefined,
      sideClassification: "estimated"
    }
  };
}

export function chartReferenceForSelection(
  chart: ChartState,
  selection: SemanticSelectionSnapshot,
  sourcePanelId?: string
): AgentReference<Record<string, unknown>> {
  return chart.chartType === "bidask"
    ? chartOrderFlowReference(selection, orderFlowSummaryForSelection(chart, selection), sourcePanelId)
    : chartCandleReference(selection, sourcePanelId);
}

export function newsArticleReference(
  item: {
    symbol: string;
    symbols?: string[];
    title: string;
    summary?: string;
    url?: string | null;
    source?: string | null;
    publishedAt?: string | null;
    impactDirection?: string | null;
  },
  sourcePanelId?: string
): AgentReference<Record<string, unknown>> {
  return {
    type: "news.article",
    sourcePanelId,
    displayLabel: `${item.symbol} ${item.title}`,
    data: {
      symbol: item.symbol,
      symbols: item.symbols ?? [item.symbol],
      title: item.title,
      summary: item.summary ?? "",
      url: item.url ?? undefined,
      source: item.source ?? undefined,
      publishedAt: item.publishedAt ?? undefined,
      impactDirection: item.impactDirection ?? undefined
    }
  };
}

export function newsDailySummaryReference(
  item: {
    date: string;
    symbol?: string;
    summary: string;
    keyPoints?: string[];
    articleIds?: string[];
    sources?: unknown[];
    priceChange?: unknown;
  },
  fallbackSymbol: string,
  sourcePanelId?: string
): AgentReference<Record<string, unknown>> {
  const symbol = item.symbol ?? fallbackSymbol;
  return {
    type: "news.dailySummary",
    sourcePanelId,
    displayLabel: `${symbol} ${item.date} 뉴스`,
    data: {
      symbol,
      date: item.date,
      summary: item.summary,
      keyPoints: item.keyPoints ?? [],
      articleIds: item.articleIds ?? [],
      sources: item.sources ?? [],
      priceChange: item.priceChange ?? undefined
    }
  };
}

export function buildChartAnalysisContext(
  chart: ChartState,
  selection?: SemanticSelectionSnapshot | null,
  assetIdentity?: Record<string, unknown> | null,
  sourcePanelId?: string
): Record<string, unknown> {
  const viewportEndIndex = Math.max(0, chart.candles.length - 1 - Math.max(0, chart.rightOffset));
  const viewportStartIndex = Math.max(0, viewportEndIndex - Math.max(1, chart.visibleCount) + 1);
  const analysisStartIndex = Math.max(0, viewportStartIndex - 120);
  const analysisCandles = chart.candles.slice(analysisStartIndex, viewportEndIndex + 1);
  const viewportCandles = chart.candles.slice(viewportStartIndex, viewportEndIndex + 1);
  const lastCandle = viewportCandles[viewportCandles.length - 1];
  const high = viewportCandles.reduce<number | undefined>(
    (current, candle) => current === undefined ? candle.high : Math.max(current, candle.high),
    undefined
  );
  const low = viewportCandles.reduce<number | undefined>(
    (current, candle) => current === undefined ? candle.low : Math.min(current, candle.low),
    undefined
  );
  const firstCandle = viewportCandles[0];
  const change = firstCandle && lastCandle
    ? lastCandle.close - firstCandle.close
    : undefined;
  return {
    chartDocument: {
      symbol: chart.symbol,
      timeframe: chart.interval,
      sourcePanelId
    },
    analysisWindow: {
      viewportFrom: firstCandle?.timestamp,
      viewportTo: lastCandle?.timestamp,
      preRollBars: viewportStartIndex - analysisStartIndex,
      candleCount: analysisCandles.length
    },
    assetIdentity: assetIdentity ?? undefined,
    panel: {
      symbol: chart.symbol,
      interval: chart.interval,
      visibleCount: chart.visibleCount,
      rightOffset: chart.rightOffset,
      layers: chart.layers,
      toolMode: chart.toolMode,
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
      low,
      change: change === undefined ? undefined : `${change >= 0 ? "+" : ""}${change.toFixed(4)}`
    },
    selectedReference: selection ? chartReferenceForSelection(chart, selection, sourcePanelId) : null,
    candles: analysisCandles
  };
}

function orderFlowSummaryForSelection(
  chart: ChartState,
  selection: SemanticSelectionSnapshot
): { sessionDate: string; totals: OrderFlowDayDto["totals"]; pocPriceBin: number | null } | null {
  const orderFlow = chart.orderFlow;
  if (!orderFlow) {
    return null;
  }
  const bucketStart = selection.timestamp ?? selection.from;
  const levels = sumOrderFlowBucketLevels(
    orderFlow.minutes,
    bucketStart,
    orderFlowWindowMinutesForInterval(chart.interval)
  );
  if (!levels.length) {
    return null;
  }
  const priceStep = Math.max(0.01, orderFlow.priceBinSize);
  const ladder = buildLadder(levels, priceStep);
  return {
    sessionDate: orderFlow.sessionDate ?? sessionDateFromTimestamp(bucketStart),
    totals: ladder.totals,
    pocPriceBin: ladder.pocPriceBin
  };
}
