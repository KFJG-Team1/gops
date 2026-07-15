import type { ChartTradeSetupSnapshot } from "./chartTradeAutomation";

type ChartTradeSetupListener = () => void;

const snapshots = new Map<string, ChartTradeSetupSnapshot>();
const listeners = new Map<string, Set<ChartTradeSetupListener>>();

export function getChartTradeSetupSnapshot(chartDocumentId: string): ChartTradeSetupSnapshot | null {
  return snapshots.get(chartDocumentId) ?? null;
}

export function setChartTradeSetupSnapshot(
  chartDocumentId: string,
  snapshot: ChartTradeSetupSnapshot | null
): boolean {
  if (!snapshot) {
    return clearChartTradeSetupSnapshot(chartDocumentId);
  }
  const current = snapshots.get(chartDocumentId);
  if (current && chartTradeSetupSnapshotsEqual(current, snapshot)) {
    return false;
  }
  snapshots.set(chartDocumentId, snapshot);
  notify(chartDocumentId);
  return true;
}

export function clearChartTradeSetupSnapshot(chartDocumentId: string): boolean {
  if (!snapshots.delete(chartDocumentId)) {
    return false;
  }
  notify(chartDocumentId);
  return true;
}

export function subscribeChartTradeSetup(
  chartDocumentId: string,
  listener: ChartTradeSetupListener
): () => void {
  const documentListeners = listeners.get(chartDocumentId) ?? new Set<ChartTradeSetupListener>();
  documentListeners.add(listener);
  listeners.set(chartDocumentId, documentListeners);
  return () => {
    documentListeners.delete(listener);
    if (!documentListeners.size) {
      listeners.delete(chartDocumentId);
    }
  };
}

export function chartTradeSetupSnapshotsEqual(
  left: ChartTradeSetupSnapshot,
  right: ChartTradeSetupSnapshot
): boolean {
  return left.version === right.version
    && left.chartDocumentId === right.chartDocumentId
    && left.sourcePanelId === right.sourcePanelId
    && left.symbol === right.symbol
    && left.interval === right.interval
    && left.spotlightPrice === right.spotlightPrice
    && left.assetIdentity.algorithmVersion === right.assetIdentity.algorithmVersion
    && left.assetIdentity.inputDigest === right.assetIdentity.inputDigest
    && left.assetIdentity.asOf === right.assetIdentity.asOf
    && left.setup.version === right.setup.version
    && left.setup.action === right.setup.action
    && left.setup.sourceKind === right.setup.sourceKind
    && left.setup.sourceInterval === right.setup.sourceInterval
    && left.setup.entryPrice === right.setup.entryPrice
    && left.setup.entryTrigger === right.setup.entryTrigger
    && left.setup.targetPrice === right.setup.targetPrice
    && left.setup.stopPrice === right.setup.stopPrice
    && left.setup.rewardRiskRatio === right.setup.rewardRiskRatio
    && left.setup.signalAt === right.setup.signalAt
    && left.setup.signalIndex === right.setup.signalIndex
    && left.setup.patternId === right.setup.patternId
    && left.setup.patternKind === right.setup.patternKind
    && left.setup.projectionBars === right.setup.projectionBars
    && left.setup.drawingIds.plan === right.setup.drawingIds.plan
    && left.setup.drawingIds.signal === right.setup.drawingIds.signal
    && left.setup.priceSources.entry === right.setup.priceSources.entry
    && left.setup.priceSources.target === right.setup.priceSources.target
    && left.setup.priceSources.stop === right.setup.priceSources.stop
    && stringArraysEqual(left.setup.reasons, right.setup.reasons);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function notify(chartDocumentId: string): void {
  listeners.get(chartDocumentId)?.forEach((listener) => listener());
}
