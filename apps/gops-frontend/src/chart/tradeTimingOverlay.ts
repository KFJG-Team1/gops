import type { ChartAnalysisAsset, GeometryPatternKind } from "./analysisAssetsApi";
import type { CandleDto, DrawingEntity } from "./types";
import { chartSemanticCatalog } from "./chartSemanticCatalog";
import { projectChartTradeSetup } from "./chartTradeSetup";
import { tradePlanPresentation } from "./tradePlanPresentation";

type AnalysisAssetDrawing = ChartAnalysisAsset["geometry"]["drawings"][number];

const patternNames = chartSemanticCatalog.patterns as Record<GeometryPatternKind, string>;

export function isTradeTimingDrawing(drawing: Pick<DrawingEntity, "id">): boolean {
  return drawing.id.startsWith("chart-plan:") || drawing.id.includes(":trade-timing:");
}

export function buildTradeTimingDrawings(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  _availableAssets?: Partial<Record<ChartAnalysisAsset["interval"], ChartAnalysisAsset | null>>
): AnalysisAssetDrawing[] {
  const setup = projectChartTradeSetup(asset, candles);
  if (!setup) return [];
  const ids = setup.drawingIds;
  const sourceProposalId = `chart-plan:${asset.symbol}:${asset.interval}:trade-timing`;
  const prefix = tradePlanPresentation(setup.action).scenario;
  const pattern = setup.patternKind ? patternNames[setup.patternKind] : "가격 구조";
  const label = `${prefix} · ${pattern}`;
  const common = {
    symbol: asset.symbol,
    interval: asset.interval,
    sourceInterval: asset.sourceInterval,
    locked: true,
    visible: true,
    createdBy: "system" as const,
    sourceProposalId,
    createdAt: asset.generatedAt,
    updatedAt: asset.generatedAt
  };
  const signalAnchor = {
    ...(setup.signalAt
      ? { timestamp: setup.signalAt }
      : candles[setup.signalIndex ?? candles.length - 1]?.timestamp
        ? { timestamp: candles[setup.signalIndex ?? candles.length - 1].timestamp }
        : {}),
    logicalIndex: setup.signalIndex ?? Math.max(0, candles.length - 1),
    price: setup.entryPrice,
    paneId: "price" as const,
    symbol: asset.symbol,
    interval: asset.interval
  };
  const token = setup.action === "buy_candidate" ? "bullish" : "bearish";
  const drawings: AnalysisAssetDrawing[] = setup.signalAt ? [{
    ...common, id: ids.signal, type: "flagMarker", anchors: [signalAnchor],
    style: { colorToken: token, textToken: token, lineWidth: 2, opacity: 0.98, proposalAction: setup.action, proposalKind: setup.sourceKind }, label
  }] : [];
  const latestCompletedIndex = latestClosedCandleIndex(candles);
  const projectionIndex = Math.max(0, latestCompletedIndex) + Math.max(1, Math.round(setup.projectionBars));
  setup.referenceGuides.forEach((guide) => drawings.push({
    ...common,
    id: guide.id,
    type: "horizontalLine",
    anchors: [
      { ...signalAnchor, price: guide.price },
      { logicalIndex: projectionIndex, price: guide.price, paneId: "price", symbol: asset.symbol, interval: asset.interval }
    ],
    style: {
      colorToken: token,
      lineWidth: 1.25,
      lineDash: [5, 4],
      opacity: 0.58,
      labelPlacement: "none",
      proposalAction: setup.action,
      proposalKind: setup.sourceKind
    },
    label: guide.label
  }));
  drawings.push({
    ...common,
    id: ids.plan,
    type: "riskRewardBox",
    anchors: [
      signalAnchor,
      { logicalIndex: projectionIndex, price: setup.stopPrice, paneId: "price", symbol: asset.symbol, interval: asset.interval },
      { logicalIndex: projectionIndex, price: setup.targetPrice, paneId: "price", symbol: asset.symbol, interval: asset.interval }
    ],
    style: {
      colorToken: token,
      fillToken: token,
      textToken: token,
      fillOpacity: 0.08,
      lineWidth: 1.5,
      lineDash: [6, 4],
      opacity: 0.92,
      labelPlacement: "none",
      zoneSplit: true,
      proposalAction: setup.action,
      proposalKind: setup.sourceKind
    },
    label
  });
  return drawings;
}

function latestClosedCandleIndex(candles: CandleDto[]): number {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index]?.isClosed !== false) return index;
  }
  return -1;
}
