import type { AnalysisAssetsResponse, ChartCommentaryAsset } from "./analysisAssetsApi";

export type ChartAnalysisAssetLoadPhase = "waiting-for-chart" | "loading" | "ready" | "error";
export type ChartCommentaryAssetLoadPhase = "loading" | "ready" | "missing" | "error";

export type ChartAnalysisAssetRuntimeSnapshot = {
  identity: string;
  phase: ChartAnalysisAssetLoadPhase;
  response: AnalysisAssetsResponse | null;
  error: string | null;
  commentaryPhase: ChartCommentaryAssetLoadPhase;
  commentaryAsset: ChartCommentaryAsset | null;
  commentaryError: string | null;
};

export type ChartAnalysisAssetLoadedCandleSnapshot = {
  requestKey: string;
  generation: number;
  latestClosedTimestamp: string;
};

const emptySnapshot: ChartAnalysisAssetRuntimeSnapshot = Object.freeze({
  identity: "",
  phase: "waiting-for-chart",
  response: null,
  error: null,
  commentaryPhase: "missing",
  commentaryAsset: null,
  commentaryError: null
});

const snapshots = new Map<string, ChartAnalysisAssetRuntimeSnapshot>();
const listeners = new Map<string, Set<() => void>>();

export function chartAnalysisAssetRuntimeIdentity(
  chartDocumentId: string,
  symbol: string,
  interval: string
): string {
  return `${chartDocumentId}|${symbol.trim().toUpperCase()}|${interval}`;
}

export function chartAnalysisAssetSceneContainsLoadedSnapshot(
  snapshot: ChartAnalysisAssetLoadedCandleSnapshot | null,
  sceneRequestKey: string,
  candles: Array<{ timestamp: string; isClosed?: boolean }>
): snapshot is ChartAnalysisAssetLoadedCandleSnapshot {
  return Boolean(
    snapshot
    && snapshot.requestKey === sceneRequestKey
    && candles.some((candle) => (
      candle.timestamp === snapshot.latestClosedTimestamp && candle.isClosed !== false
    ))
  );
}

export function getChartAnalysisAssetRuntimeSnapshot(
  chartDocumentId: string | undefined
): ChartAnalysisAssetRuntimeSnapshot {
  return chartDocumentId ? snapshots.get(chartDocumentId) ?? emptySnapshot : emptySnapshot;
}

export function subscribeChartAnalysisAssetRuntime(
  chartDocumentId: string | undefined,
  listener: () => void
): () => void {
  if (!chartDocumentId) return () => undefined;
  const documentListeners = listeners.get(chartDocumentId) ?? new Set<() => void>();
  documentListeners.add(listener);
  listeners.set(chartDocumentId, documentListeners);
  return () => {
    documentListeners.delete(listener);
    if (!documentListeners.size) listeners.delete(chartDocumentId);
  };
}

export function updateChartAnalysisAssetRuntime(
  chartDocumentId: string,
  snapshot: ChartAnalysisAssetRuntimeSnapshot
): void {
  const current = snapshots.get(chartDocumentId);
  if (current && runtimeSnapshotsEqual(current, snapshot)) return;
  snapshots.set(chartDocumentId, snapshot);
  listeners.get(chartDocumentId)?.forEach((listener) => listener());
}

export function patchChartAnalysisAssetRuntime(
  chartDocumentId: string,
  identity: string,
  patch: Partial<Omit<ChartAnalysisAssetRuntimeSnapshot, "identity">>
): void {
  const current = snapshots.get(chartDocumentId);
  updateChartAnalysisAssetRuntime(chartDocumentId, {
    ...(current?.identity === identity ? current : emptySnapshot),
    ...patch,
    identity
  });
}

export function clearChartAnalysisAssetRuntime(
  chartDocumentId: string,
  identity?: string
): void {
  const current = snapshots.get(chartDocumentId);
  if (!current || (identity && current.identity !== identity)) return;
  snapshots.delete(chartDocumentId);
  listeners.get(chartDocumentId)?.forEach((listener) => listener());
}

function runtimeSnapshotsEqual(
  left: ChartAnalysisAssetRuntimeSnapshot,
  right: ChartAnalysisAssetRuntimeSnapshot
): boolean {
  return left.identity === right.identity
    && left.phase === right.phase
    && left.response === right.response
    && left.error === right.error
    && left.commentaryPhase === right.commentaryPhase
    && left.commentaryAsset === right.commentaryAsset
    && left.commentaryError === right.commentaryError;
}
