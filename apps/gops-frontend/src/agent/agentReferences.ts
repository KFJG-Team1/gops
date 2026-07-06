import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import type { ChartState } from "../chart/types";

export type AgentReferenceType =
  | "chart.candle"
  | "chart.range"
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
  selection?: SemanticSelectionSnapshot | null
): Record<string, unknown> {
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
  const firstCandle = visibleCandles[0];
  const change = firstCandle && lastCandle
    ? lastCandle.close - firstCandle.close
    : undefined;
  return {
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
    selectedReference: selection ? chartCandleReference(selection) : null,
    candles: visibleCandles
  };
}
