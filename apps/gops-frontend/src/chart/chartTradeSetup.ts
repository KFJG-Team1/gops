import type {
  AnalysisAssetInterval,
  ChartAnalysisAsset,
  GeometryLevel,
  GeometryPattern,
  GeometryPatternKind,
  GeometryTradePlan
} from "./analysisAssetsApi";
import type { CandleDto, DrawingEntity } from "./types";

const bullishPatternKinds = new Set<GeometryPatternKind>([
  "ascending_triangle",
  "bullish_flag",
  "bullish_pennant",
  "bullish_rectangle",
  "falling_wedge",
  "descending_channel_breakout"
]);
const bearishPatternKinds = new Set<GeometryPatternKind>([
  "descending_triangle",
  "bearish_flag",
  "bearish_pennant",
  "bearish_rectangle",
  "rising_wedge",
  "ascending_channel_breakdown"
]);
const poleTargetKinds = new Set<GeometryPatternKind>([
  "bullish_flag",
  "bearish_flag",
  "bullish_pennant",
  "bearish_pennant"
]);
const defaultProjectionBars = 10;

export type ChartTradeSetupPriceSource = {
  label: string;
  drawingIds: string[];
  derivation: "pattern_boundary" | "pattern_measure" | "level";
};

export type ChartTradeSetup = {
  version: "chart-trade-setup-v1";
  action: "buy_candidate" | "sell_candidate";
  sourceKind: "confirmed" | "conditional";
  sourceInterval: AnalysisAssetInterval;
  entryPrice: number;
  entryTrigger: number;
  targetPrice: number;
  stopPrice: number;
  rewardRiskRatio: number;
  signalAt: string | null;
  signalIndex: number | null;
  patternId: string;
  patternKind: GeometryPatternKind | null;
  projectionBars: number;
  reasons: string[];
  drawingIds: { plan: string; signal: string };
  priceSources: {
    entry: ChartTradeSetupPriceSource;
    target: ChartTradeSetupPriceSource;
    stop: ChartTradeSetupPriceSource;
  };
  assetIdentity: {
    algorithmVersion: string;
    inputDigest: string;
    asOf: string;
  };
};

type PatternDrawingSet = {
  all: DrawingEntity[];
  upper: DrawingEntity;
  lower: DrawingEntity;
  pole: DrawingEntity | null;
};

type LevelDrawingSource = {
  level: GeometryLevel;
  drawing: DrawingEntity;
  price: number;
};

export function projectChartTradeSetup(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[],
  _availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>
): ChartTradeSetup | null {
  if (!asset || asset.sourceInterval !== asset.interval) return null;
  const latestLogicalIndex = latestClosedCandleIndex(candles);
  const latest = latestLogicalIndex >= 0 ? candles[latestLogicalIndex] : undefined;
  const asOfIndex = findCandleIndex(candles, asset.asOf, asset.interval);
  if (!latest || !positive(latest.close) || asOfIndex < 0) return null;

  return patternSetup(asset, candles, latest.close, asOfIndex)
    ?? levelSetup(asset, latest.close, latestLogicalIndex);
}

function patternSetup(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  currentPrice: number,
  asOfIndex: number
): ChartTradeSetup | null {
  const pattern = primaryPattern(asset);
  if (!pattern || (pattern.state !== "forming" && pattern.state !== "confirmed")) return null;
  const action = patternAction(pattern);
  const patternDrawings = action ? finalPatternDrawings(asset, pattern) : null;
  if (!action || !patternDrawings) return null;

  let sourceKind: ChartTradeSetup["sourceKind"];
  let signalIndex: number;
  let signalAt: string | null;
  let projectionBars = defaultProjectionBars;
  if (pattern.state === "confirmed") {
    const plan = asset.geometry.tradePlan;
    if (!plan || !completeDisplayedPlan(plan) || !planMatchesPattern(plan, pattern, asset) || plan.action !== action) {
      return null;
    }
    signalIndex = findCandleIndex(candles, plan.signalAt, asset.interval);
    if (signalIndex < 0) return null;
    sourceKind = "confirmed";
    signalAt = candles[signalIndex]?.timestamp ?? null;
    projectionBars = Math.max(1, Math.round(plan.projectionBars));
  } else {
    sourceKind = "conditional";
    signalIndex = asOfIndex;
    signalAt = null;
    const watchPlan = asset.geometry.tradePlan;
    if (watchPlan?.patternId && patternIds(pattern).includes(watchPlan.patternId)) {
      projectionBars = Math.max(1, Math.round(watchPlan.projectionBars));
    }
  }

  const upperPrice = linePriceAt(patternDrawings.upper, candles, signalIndex, asset.interval);
  const lowerPrice = linePriceAt(patternDrawings.lower, candles, signalIndex, asset.interval);
  const measuredMove = patternMeasuredMove(pattern, patternDrawings);
  if (!positive(upperPrice) || !positive(lowerPrice) || !measuredMove) return null;

  const entryPrice = action === "buy_candidate" ? upperPrice : lowerPrice;
  const stopPrice = action === "buy_candidate" ? lowerPrice : upperPrice;
  const targetPrice = action === "buy_candidate"
    ? entryPrice + measuredMove.value
    : entryPrice - measuredMove.value;
  if (!validScenarioPrices(action, sourceKind, currentPrice, entryPrice, targetPrice, stopPrice)) return null;

  const roundedEntry = rounded(entryPrice);
  const roundedTarget = rounded(targetPrice);
  const roundedStop = rounded(stopPrice);
  const patternId = pattern.id ?? pattern.geometryHash;
  const allPatternDrawingIds = patternDrawings.all.map((drawing) => drawing.id);
  const drawingIds = setupDrawingIds(asset, patternId, sourceKind, action);
  return {
    version: "chart-trade-setup-v1",
    action,
    sourceKind,
    sourceInterval: asset.interval,
    entryPrice: roundedEntry,
    entryTrigger: roundedEntry,
    targetPrice: roundedTarget,
    stopPrice: roundedStop,
    rewardRiskRatio: rewardRiskRatio(roundedEntry, roundedTarget, roundedStop),
    signalAt,
    signalIndex,
    patternId,
    patternKind: pattern.kind,
    projectionBars,
    reasons: sourceKind === "confirmed"
      ? ["confirmed_pattern_signal", "prices_from_final_pattern_geometry"]
      : ["forming_pattern_geometry", "prices_from_final_pattern_geometry"],
    drawingIds,
    priceSources: {
      entry: source(
        action === "buy_candidate" ? "패턴 상단" : "패턴 하단",
        [action === "buy_candidate" ? patternDrawings.upper.id : patternDrawings.lower.id],
        "pattern_boundary"
      ),
      target: source(measuredMove.label, allPatternDrawingIds, "pattern_measure"),
      stop: source(
        action === "buy_candidate" ? "패턴 하단" : "패턴 상단",
        [action === "buy_candidate" ? patternDrawings.lower.id : patternDrawings.upper.id],
        "pattern_boundary"
      )
    },
    assetIdentity: identityFromAsset(asset)
  };
}

function levelSetup(
  asset: ChartAnalysisAsset,
  currentPrice: number,
  latestLogicalIndex: number
): ChartTradeSetup | null {
  const supports = finalLevelDrawings(asset, asset.geometry.supports)
    .filter((item) => item.price < currentPrice)
    .sort((left, right) => right.price - left.price || left.drawing.id.localeCompare(right.drawing.id));
  const resistances = finalLevelDrawings(asset, asset.geometry.resistances)
    .filter((item) => item.price > currentPrice)
    .sort((left, right) => left.price - right.price || left.drawing.id.localeCompare(right.drawing.id));

  const candidates: ChartTradeSetup[] = [];
  if (supports.length >= 1 && resistances.length >= 2) {
    candidates.push(levelScenario(asset, "buy_candidate", latestLogicalIndex, {
      entry: resistances[0], target: resistances[1], stop: supports[0]
    }));
  }
  if (supports.length >= 2 && resistances.length >= 1) {
    candidates.push(levelScenario(asset, "sell_candidate", latestLogicalIndex, {
      entry: supports[0], target: supports[1], stop: resistances[0]
    }));
  }
  return candidates
    .filter((candidate) => validScenarioPrices(
      candidate.action,
      candidate.sourceKind,
      currentPrice,
      candidate.entryPrice,
      candidate.targetPrice,
      candidate.stopPrice
    ))
    .sort((left, right) => (
      Math.abs(left.entryPrice - currentPrice) - Math.abs(right.entryPrice - currentPrice)
      || left.action.localeCompare(right.action)
      || left.patternId.localeCompare(right.patternId)
    ))[0] ?? null;
}

function levelScenario(
  asset: ChartAnalysisAsset,
  action: ChartTradeSetup["action"],
  latestLogicalIndex: number,
  levels: { entry: LevelDrawingSource; target: LevelDrawingSource; stop: LevelDrawingSource }
): ChartTradeSetup {
  const entryPrice = rounded(levels.entry.price);
  const targetPrice = rounded(levels.target.price);
  const stopPrice = rounded(levels.stop.price);
  const ids = [levels.entry.drawing.id, levels.target.drawing.id, levels.stop.drawing.id];
  const patternId = `levels:${ids.join("|")}`;
  return {
    version: "chart-trade-setup-v1",
    action,
    sourceKind: "conditional",
    sourceInterval: asset.interval,
    entryPrice,
    entryTrigger: entryPrice,
    targetPrice,
    stopPrice,
    rewardRiskRatio: rewardRiskRatio(entryPrice, targetPrice, stopPrice),
    signalAt: null,
    signalIndex: latestLogicalIndex,
    patternId,
    patternKind: null,
    projectionBars: defaultProjectionBars,
    reasons: ["prices_from_selected_h_lines"],
    drawingIds: setupDrawingIds(asset, patternId, "conditional", action),
    priceSources: {
      entry: source(action === "buy_candidate" ? "저항선" : "지지선", [levels.entry.drawing.id], "level"),
      target: source(action === "buy_candidate" ? "다음 저항선" : "다음 지지선", [levels.target.drawing.id], "level"),
      stop: source(action === "buy_candidate" ? "지지선" : "저항선", [levels.stop.drawing.id], "level")
    },
    assetIdentity: identityFromAsset(asset)
  };
}

function finalPatternDrawings(asset: ChartAnalysisAsset, pattern: GeometryPattern): PatternDrawingSet | null {
  const groupIds = asset.geometry.drawingGroups?.pattern;
  const grouped = groupIds?.length
    ? asset.geometry.drawings.filter((drawing) => groupIds.includes(drawing.id))
    : asset.geometry.drawings.filter((drawing) => drawing.id.includes(pattern.geometryHash));
  const all = grouped.filter((drawing) => (
    drawing.createdBy === "system"
    && !drawing.id.startsWith("chart-plan:")
    && drawing.type === "trendLine"
    && drawing.anchors.length >= 2
  ));
  const upper = boundaryDrawing(all, pattern.geometryHash, "upper");
  const lower = boundaryDrawing(all, pattern.geometryHash, "lower");
  if (!upper || !lower) return null;
  return {
    all: [...all].sort((left, right) => left.id.localeCompare(right.id)),
    upper,
    lower,
    pole: boundaryDrawing(all, pattern.geometryHash, "pole")
  };
}

function boundaryDrawing(
  drawings: DrawingEntity[],
  geometryHash: string,
  boundary: "upper" | "lower" | "pole"
): DrawingEntity | null {
  return drawings.find((drawing) => (
    drawing.id.includes(geometryHash)
    && (drawing.id.endsWith(`-${boundary}`) || drawing.id.endsWith(`:${boundary}`))
  )) ?? null;
}

function patternMeasuredMove(
  pattern: GeometryPattern,
  drawings: PatternDrawingSet
): { value: number; label: "깃대 길이" | "패턴 폭" } | null {
  if (poleTargetKinds.has(pattern.kind)) {
    if (!drawings.pole) return null;
    const [start, end] = drawings.pole.anchors;
    const value = positive(start?.price) && positive(end?.price) ? Math.abs(end.price - start.price) : 0;
    return value > 0 ? { value, label: "깃대 길이" } : null;
  }
  const [upperStart, upperEnd] = drawings.upper.anchors;
  const [lowerStart, lowerEnd] = drawings.lower.anchors;
  if (![upperStart?.price, upperEnd?.price, lowerStart?.price, lowerEnd?.price].every(positive)) return null;
  const startWidth = Math.abs(upperStart.price! - lowerStart.price!);
  const endWidth = Math.abs(upperEnd.price! - lowerEnd.price!);
  const value = Math.max(startWidth, endWidth);
  return value > 0 ? { value, label: "패턴 폭" } : null;
}

function finalLevelDrawings(asset: ChartAnalysisAsset, levels: GeometryLevel[]): LevelDrawingSource[] {
  const groupIds = asset.geometry.drawingGroups?.levels;
  return levels.flatMap((level): LevelDrawingSource[] => {
    if (!positive(level.price)) return [];
    const drawing = asset.geometry.drawings.find((candidate) => (
      candidate.type === "horizontalLine"
      && candidate.createdBy === "system"
      && (!groupIds?.length || groupIds.includes(candidate.id))
      && (candidate.id === level.id || candidate.id.endsWith(`:${level.id}`))
    ));
    if (!drawing) return [];
    const drawingPrice = drawing.anchors.find((anchor) => positive(anchor.price))?.price;
    if (!positive(drawingPrice)) return [];
    const tolerance = Math.max(0.000001, level.price * 0.000001);
    if (Math.abs(drawingPrice - level.price) > tolerance) return [];
    return [{ level, drawing, price: drawingPrice }];
  });
}

function linePriceAt(
  drawing: DrawingEntity,
  candles: CandleDto[],
  targetIndex: number,
  interval: AnalysisAssetInterval
): number | null {
  const [start, end] = drawing.anchors;
  if (!positive(start?.price) || !positive(end?.price)) return null;
  const startIndex = anchorLogicalIndex(start, candles, interval);
  const endIndex = anchorLogicalIndex(end, candles, interval);
  if (startIndex === null || endIndex === null || endIndex <= startIndex) return end.price;
  return start.price + ((end.price - start.price) / (endIndex - startIndex)) * (targetIndex - startIndex);
}

function anchorLogicalIndex(
  anchor: DrawingEntity["anchors"][number],
  candles: CandleDto[],
  interval: AnalysisAssetInterval
): number | null {
  if (typeof anchor.logicalIndex === "number" && Number.isFinite(anchor.logicalIndex)) return anchor.logicalIndex;
  return anchor.timestamp ? findCandleIndex(candles, anchor.timestamp, interval) : null;
}

function patternAction(pattern: GeometryPattern): ChartTradeSetup["action"] | null {
  if (bullishPatternKinds.has(pattern.kind)) return "buy_candidate";
  if (bearishPatternKinds.has(pattern.kind)) return "sell_candidate";
  if (pattern.kind === "symmetrical_triangle") {
    if (pattern.breakoutDirection === "up") return "buy_candidate";
    if (pattern.breakoutDirection === "down") return "sell_candidate";
  }
  return null;
}

function planMatchesPattern(
  plan: GeometryTradePlan,
  pattern: GeometryPattern,
  asset: ChartAnalysisAsset
): boolean {
  return plan.symbol?.trim().toUpperCase() === asset.symbol.trim().toUpperCase()
    && plan.interval === asset.interval
    && plan.patternKind === pattern.kind
    && plan.patternState === pattern.state
    && patternIds(pattern).includes(plan.patternId);
}

function patternIds(pattern: GeometryPattern): string[] {
  return [...new Set([pattern.id, pattern.geometryHash].filter((value): value is string => Boolean(value)))];
}

function primaryPattern(asset: ChartAnalysisAsset): GeometryPattern | null {
  return asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle ?? null;
}

function source(
  label: string,
  drawingIds: string[],
  derivation: ChartTradeSetupPriceSource["derivation"]
): ChartTradeSetupPriceSource {
  return { label, drawingIds: [...new Set(drawingIds)], derivation };
}

function validScenarioPrices(
  action: ChartTradeSetup["action"],
  sourceKind: ChartTradeSetup["sourceKind"],
  currentPrice: number,
  entryPrice: number,
  targetPrice: number,
  stopPrice: number
): boolean {
  if (![currentPrice, entryPrice, targetPrice, stopPrice].every(positive)) return false;
  if (action === "buy_candidate") {
    return stopPrice < entryPrice
      && entryPrice < targetPrice
      && currentPrice > stopPrice
      && currentPrice < targetPrice
      && (sourceKind === "confirmed" || currentPrice <= entryPrice);
  }
  return targetPrice < entryPrice
    && entryPrice < stopPrice
    && currentPrice > targetPrice
    && currentPrice < stopPrice
    && (sourceKind === "confirmed" || currentPrice >= entryPrice);
}

function rewardRiskRatio(entryPrice: number, targetPrice: number, stopPrice: number): number {
  const risk = Math.abs(entryPrice - stopPrice);
  return risk > 0 ? rounded(Math.abs(targetPrice - entryPrice) / risk, 4) : 0;
}

function completeDisplayedPlan(plan: GeometryTradePlan): plan is GeometryTradePlan & {
  action: "buy_candidate" | "sell_candidate";
  signalAt: string;
  entryTrigger: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rewardRiskRatio: number;
} {
  const actionMatches = (plan.action === "buy_candidate" && plan.direction === "long")
    || (plan.action === "sell_candidate" && plan.direction === "exit_long");
  return actionMatches
    && typeof plan.signalAt === "string"
    && [plan.entryTrigger, plan.entryPrice, plan.stopPrice, plan.targetPrice, plan.rewardRiskRatio].every(positive);
}

function findCandleIndex(candles: CandleDto[], timestamp: string, interval: AnalysisAssetInterval): number {
  const exact = candles.findIndex((candle) => candle.timestamp === timestamp && candle.isClosed !== false);
  if (exact >= 0) return exact;
  if (interval !== "1D" && interval !== "1W") return -1;
  const date = timestamp.slice(0, 10);
  return candles.findIndex((candle) => candle.isClosed !== false && candle.timestamp.slice(0, 10) === date);
}

function latestClosedCandleIndex(candles: CandleDto[]): number {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index]?.isClosed !== false) return index;
  }
  return -1;
}

function setupDrawingIds(
  asset: Pick<ChartAnalysisAsset, "symbol" | "interval">,
  patternId: string,
  sourceKind: ChartTradeSetup["sourceKind"],
  action: ChartTradeSetup["action"]
): { plan: string; signal: string } {
  const safePattern = patternId.replace(/[^0-9A-Za-z:_-]/g, "-");
  const base = `chart-plan:${asset.symbol}:${asset.interval}:${sourceKind}:${action}:${safePattern}`;
  return { plan: `${base}:risk`, signal: `${base}:signal` };
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function rounded(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function identityFromAsset(asset: ChartAnalysisAsset): ChartTradeSetup["assetIdentity"] {
  return {
    algorithmVersion: asset.algorithmVersion,
    inputDigest: asset.inputDigest,
    asOf: asset.asOf
  };
}
