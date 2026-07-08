import {
  chartRuntimeReducer,
  type ChartDataStatus,
  type ChartDocument,
  type ChartRuntimePanel,
  type ChartRuntimeState,
  type StreamStatus
} from "@gops/chart-engine";
import type { PanelContentInstance, TiledPanelState } from "../layout/panelLayout";
import type { CandleDto, ChartComparisonSeries, ChartInterval, ChartState, ChartType, DrawingEntity } from "./types";

const defaultFrontendChartInterval: ChartInterval = "1D";

export function chartDocumentIdForContent(content: PanelContentInstance): string {
  return content.chartDocumentId ?? `${content.id}-document`;
}

export function chartRuntimePanelsForPanelState(
  state: TiledPanelState,
  fallbackSymbol: string
): ChartRuntimePanel[] {
  return state.slots
    .map((slot): ChartRuntimePanel | null => {
      const content = state.contents[slot.contentId];
      if (!content || content.kind !== "chart") {
        return null;
      }
      return {
        id: slot.id,
        type: "chart",
        chartDocumentId: chartDocumentIdForContent(content),
        props: {
          symbol: readString(content.props?.symbol) ?? fallbackSymbol,
          timeframe: readString(content.props?.timeframe) ?? defaultFrontendChartInterval
        }
      };
    })
    .filter((panel): panel is ChartRuntimePanel => Boolean(panel));
}

export function ensureFrontendChartDocuments(
  runtime: ChartRuntimeState,
  panelState: TiledPanelState,
  fallbackSymbol: string
): ChartRuntimeState {
  const panels = chartRuntimePanelsForPanelState(panelState, fallbackSymbol);
  const activeDocumentIds = new Set(panels.map((panel) => panel.chartDocumentId ?? `${panel.id}-chartDocument`));
  const ensured = chartRuntimeReducer(runtime, { kind: "chart.ensureDocuments", panels });
  let changed = ensured !== runtime;
  const documents = { ...ensured.documents };
  for (const id of activeDocumentIds) {
    const document = documents[id];
    if (!document) {
      continue;
    }
    if (!runtime.documents[id] && document.layers.volume) {
      documents[id] = {
        ...document,
        layers: { ...document.layers, volume: false },
        panes: document.panes.map((pane) => pane.id === "volume" ? { ...pane, heightRatio: 0.22 } : pane)
      };
      changed = true;
    }
  }
  return changed ? { ...ensured, documents } : ensured;
}

export function chartStateFromDocument(
  document: ChartDocument,
  candles: CandleDto[],
  dataStatus: ChartDataStatus,
  streamStatus: StreamStatus,
  streamMessage?: string
): ChartState {
  const interval = normalizeFrontendInterval(document.timeframe);
  return {
    symbol: document.symbol.toUpperCase(),
    chartType: normalizeFrontendChartType(document.chartType),
    interval,
    candles,
    status: dataStatus.state,
    message: streamMessage ?? dataStatus.message,
    requestedLimit: dataStatus.requestedLimit,
    hasMoreBefore: dataStatus.hasMoreBefore,
    hasMoreAfter: dataStatus.hasMoreAfter,
    layers: { ...document.layers },
    panes: document.panes.map((pane) => ({ id: pane.id, heightRatio: pane.heightRatio })),
    volumeRatio: volumeRatioFromDocument(document),
    visibleCount: document.viewport.visibleCount,
    rightOffset: document.viewport.rightOffset,
    toolMode: document.interactionState.mode,
    trendLineExtension: document.interactionState.trendLineExtension,
    drawings: document.drawings as unknown as DrawingEntity[],
    comparisons: document.comparisons.map((comparison): ChartComparisonSeries => ({
      id: comparison.id,
      symbol: comparison.symbol.toUpperCase(),
      label: comparison.label,
      scaleMode: "percent",
      base: comparison.base,
      style: comparison.style,
      candles: [],
      status: "idle"
    })),
    selectedDrawingId: document.selectedDrawingId,
    streamState: streamStatus === "stale" ? "idle" : streamStatus
  };
}

function volumeRatioFromDocument(document: ChartDocument): number {
  const volumePane = document.panes.find((pane) => pane.id === "volume");
  return typeof volumePane?.heightRatio === "number" ? volumePane.heightRatio : 0.22;
}

function normalizeFrontendInterval(value: string): ChartInterval {
  return value === "1m" || value === "footprint" || value === "5m" || value === "10m" || value === "1h" || value === "4h" || value === "1D" || value === "1W" || value === "1M"
    ? value
    : defaultFrontendChartInterval;
}

function normalizeFrontendChartType(value: string | undefined): ChartType {
  return value === "line" || value === "ohlc" || value === "candle" ? value : "candle";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
