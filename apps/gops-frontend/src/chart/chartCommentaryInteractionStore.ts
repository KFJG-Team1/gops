import type { ChartAssetCommentaryIndicatorLayer } from "./analysisAssetsApi";

export type ChartCommentaryIndicatorRuntimeStatus =
  | "off"
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "unavailable";

export type ChartCommentaryInteractionSnapshot = {
  activeCandleKey: string | null;
  activeEventId: string | null;
  candleSelectionAvailable: boolean;
  indicatorStatuses: Partial<Record<ChartAssetCommentaryIndicatorLayer, ChartCommentaryIndicatorRuntimeStatus>>;
};

const emptySnapshot: ChartCommentaryInteractionSnapshot = Object.freeze({
  activeCandleKey: null,
  activeEventId: null,
  candleSelectionAvailable: true,
  indicatorStatuses: Object.freeze({})
});

const snapshots = new Map<string, ChartCommentaryInteractionSnapshot>();
const listeners = new Map<string, Set<() => void>>();

export function getChartCommentaryInteractionSnapshot(
  chartDocumentId: string | undefined
): ChartCommentaryInteractionSnapshot {
  return chartDocumentId ? snapshots.get(chartDocumentId) ?? emptySnapshot : emptySnapshot;
}

export function subscribeChartCommentaryInteraction(
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

export function updateChartCommentaryInteraction(
  chartDocumentId: string,
  patch: Partial<ChartCommentaryInteractionSnapshot>
): void {
  const current = snapshots.get(chartDocumentId) ?? emptySnapshot;
  const next: ChartCommentaryInteractionSnapshot = {
    ...current,
    ...patch,
    indicatorStatuses: patch.indicatorStatuses ?? current.indicatorStatuses
  };
  if (interactionSnapshotsEqual(current, next)) return;
  snapshots.set(chartDocumentId, next);
  listeners.get(chartDocumentId)?.forEach((listener) => listener());
}

export function clearChartCommentaryInteraction(chartDocumentId: string): void {
  if (!snapshots.delete(chartDocumentId)) return;
  listeners.get(chartDocumentId)?.forEach((listener) => listener());
}

function interactionSnapshotsEqual(
  left: ChartCommentaryInteractionSnapshot,
  right: ChartCommentaryInteractionSnapshot
): boolean {
  if (
    left.activeCandleKey !== right.activeCandleKey
    || left.activeEventId !== right.activeEventId
    || left.candleSelectionAvailable !== right.candleSelectionAvailable
  ) return false;
  const keys = new Set([
    ...Object.keys(left.indicatorStatuses),
    ...Object.keys(right.indicatorStatuses)
  ] as ChartAssetCommentaryIndicatorLayer[]);
  return [...keys].every((key) => left.indicatorStatuses[key] === right.indicatorStatuses[key]);
}
