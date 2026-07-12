import { defaultVisibleBarsForInterval, normalizeChartInterval, type ChartInterval } from "./intervals";
import type { ChartDocument, ChartDocumentSnapshot, DrawingEntity } from "./types";
import { DEFAULT_CHART_SYMBOL } from "./symbols";
import { getDefaultChartStyle, normalizeChartStyle } from "./theme";
import { latestCandleRightOffset } from "./viewport";

export function createChartDocument(id: string, symbol = DEFAULT_CHART_SYMBOL, timeframe: ChartInterval | string = "1m"): ChartDocument {
  const resolvedTimeframe = normalizeChartInterval(timeframe) ?? "1m";
  const visibleCount = defaultVisibleBarsForInterval(resolvedTimeframe);
  return {
    id,
    symbol,
    chartType: "candle",
    timeframe: resolvedTimeframe,
    viewport: {
      rightOffset: latestCandleRightOffset(visibleCount),
      visibleCount
    },
    panes: [
      { id: "price", heightRatio: 0.74 },
      { id: "volume", heightRatio: 0.26 }
    ],
    layers: {
      candles: true,
      volume: true,
      ma5: true,
      ma20: true,
      ma60: true,
      "sma:5": true,
      "sma:20": true,
      "sma:60": true,
      "sma:120": false,
      "ema:20": false,
      "wma:20": false,
      "bollinger:20:2": false,
      "rsi:14": false,
      "stochastic:14:3:3": false,
      "macd:12:26:9": false,
      "volume-profile": false
    },
    style: getDefaultChartStyle(),
    interactionState: {
      mode: "pan",
      trendLineExtension: "segment",
      parallelLineCount: 3
    },
    drawings: [],
    comparisons: [],
    history: [],
    future: [],
    updatedAt: new Date().toISOString()
  };
}

export function normalizeChartDocument(document: ChartDocument): ChartDocument {
  const interactionState = normalizeChartInteractionState(document.interactionState);
  const drawings = sanitizeRemovedDrawings(document.drawings);
  const history = document.history.map(normalizeHistoryEntry);
  const future = document.future.map(normalizeHistoryEntry);
  const selectedDrawingId = document.selectedDrawingId && drawings.some((drawing) => drawing.id === document.selectedDrawingId)
    ? document.selectedDrawingId
    : undefined;
  const changed = interactionState !== document.interactionState ||
    drawings !== document.drawings ||
    history.some((entry, index) => entry !== document.history[index]) ||
    future.some((entry, index) => entry !== document.future[index]) ||
    selectedDrawingId !== document.selectedDrawingId;
  return changed ? { ...document, interactionState, drawings, history, future, selectedDrawingId } : document;
}

export function cloneChartDocument(document: ChartDocument): ChartDocument {
  return structuredClone(normalizeChartDocument(document)) as ChartDocument;
}

export function snapshotChartDocument(document: ChartDocument): ChartDocumentSnapshot {
  const drawings = sanitizeRemovedDrawings(document.drawings);
  return {
    id: document.id,
    symbol: document.symbol,
    chartType: document.chartType ?? "candle",
    timeframe: document.timeframe,
    viewport: { ...document.viewport },
    panes: structuredClone(document.panes) as ChartDocument["panes"],
    layers: { ...document.layers },
    style: normalizeChartStyle(document.style),
    interactionState: { ...normalizeChartInteractionState(document.interactionState) },
    drawings: structuredClone(drawings) as ChartDocument["drawings"],
    comparisons: structuredClone(document.comparisons) as ChartDocument["comparisons"],
    selectedDrawingId: document.selectedDrawingId && drawings.some((drawing) => drawing.id === document.selectedDrawingId)
      ? document.selectedDrawingId
      : undefined,
    updatedAt: document.updatedAt
  };
}

export function restoreChartDocumentSnapshot(
  current: ChartDocument,
  snapshot: ChartDocumentSnapshot
): ChartDocument {
  const normalizedSnapshot = normalizeSnapshotDrawings(snapshot);
  return {
    ...current,
    symbol: normalizedSnapshot.symbol,
    chartType: normalizedSnapshot.chartType ?? "candle",
    timeframe: normalizedSnapshot.timeframe,
    viewport: { ...normalizedSnapshot.viewport },
    panes: structuredClone(normalizedSnapshot.panes) as ChartDocument["panes"],
    layers: { ...normalizedSnapshot.layers },
    style: normalizeChartStyle(normalizedSnapshot.style),
    interactionState: { ...normalizeChartInteractionState(normalizedSnapshot.interactionState) },
    drawings: structuredClone(normalizedSnapshot.drawings) as ChartDocument["drawings"],
    comparisons: structuredClone(normalizedSnapshot.comparisons) as ChartDocument["comparisons"],
    selectedDrawingId: normalizedSnapshot.selectedDrawingId,
    updatedAt: new Date().toISOString()
  };
}

function normalizeChartInteractionState(
  interactionState: ChartDocument["interactionState"]
): ChartDocument["interactionState"] {
  const legacyMode = (interactionState as { mode?: unknown }).mode;
  const mode = legacyMode === "draw-pointMarker" ? "pan" : interactionState.mode;
  const current = interactionState.parallelLineCount;
  const parallelLineCount = normalizeParallelLineCount(current);
  return current === parallelLineCount && mode === interactionState.mode
    ? interactionState
    : { ...interactionState, mode, parallelLineCount };
}

function sanitizeRemovedDrawings(drawings: DrawingEntity[]): DrawingEntity[] {
  const filtered = drawings.filter((drawing) => (drawing as { type?: unknown }).type !== "pointMarker");
  return filtered.length === drawings.length ? drawings : filtered;
}

function normalizeHistoryEntry(entry: ChartDocument["history"][number]): ChartDocument["history"][number] {
  const before = normalizeSnapshotDrawings(entry.before);
  const after = normalizeSnapshotDrawings(entry.after);
  return before === entry.before && after === entry.after ? entry : { ...entry, before, after };
}

function normalizeSnapshotDrawings(snapshot: ChartDocumentSnapshot): ChartDocumentSnapshot {
  const drawings = sanitizeRemovedDrawings(snapshot.drawings);
  const selectedDrawingId = snapshot.selectedDrawingId && drawings.some((drawing) => drawing.id === snapshot.selectedDrawingId)
    ? snapshot.selectedDrawingId
    : undefined;
  return drawings === snapshot.drawings && selectedDrawingId === snapshot.selectedDrawingId
    ? snapshot
    : { ...snapshot, drawings, selectedDrawingId };
}

function normalizeParallelLineCount(value: unknown): number {
  return Math.max(2, Math.min(10, Math.round(
    typeof value === "number" && Number.isFinite(value) ? value : 3
  )));
}
