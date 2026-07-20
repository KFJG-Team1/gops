import type {
  AnalysisAssetInterval,
  ChartAnalysisAsset,
  GeometryLevel,
  GeometryPattern,
  GeometryPatternKind,
  GeometryTradePlan,
  GeometryTraceCandidate,
  GeometryTracePivot
} from "./analysisAssetsApi";
import { buildAnalysisTraceOverlay } from "./analysisTraceOverlay";
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
const simulationDemoRewardRiskOverrideReason = "simulation_demo_reward_risk_override";

export type ChartTradeSetupPriceSource = {
  label: string;
  drawingIds: string[];
  derivation: "pattern_boundary" | "pattern_measure" | "level" | "channel" | "trend" | "trace_level" | "pivot";
};

export type ChartTradeSetupReferenceGuide = {
  id: string;
  price: number;
  label: string;
};

export type ChartTradeSetup = {
  version: "chart-trade-setup-v1";
  action: "buy_candidate" | "sell_candidate";
  sourceKind: "confirmed" | "conditional";
  evidenceKind: "final" | "reference";
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
  referenceGuides: ChartTradeSetupReferenceGuide[];
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

type PriceEvidence = {
  id: string;
  price: number;
  label: string;
  drawingIds: string[];
  derivation: ChartTradeSetupPriceSource["derivation"];
  final: boolean;
  guide?: ChartTradeSetupReferenceGuide;
};

export function projectChartTradeSetup(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[],
  _availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>
): ChartTradeSetup | null {
  if (!asset || asset.sourceInterval !== asset.interval) return null;
  const latestLogicalIndex = latestClosedCandleIndex(candles);
  const latest = latestLogicalIndex >= 0 ? candles[latestLogicalIndex] : undefined;
  const allowOpenDemoCandle = isNvdaSimulationDemoPlan(asset);
  const asOfIndex = findCandleIndex(candles, asset.asOf, asset.interval, allowOpenDemoCandle);
  if (!latest || !positive(latest.close) || asOfIndex < 0) return null;

  return patternSetup(asset, candles, latest.close, asOfIndex, allowOpenDemoCandle)
    ?? levelSetup(asset, latest.close, latestLogicalIndex)
    ?? channelSetup(asset, candles, latest.close, latestLogicalIndex)
    ?? referenceSetup(asset, candles, latest.close, latestLogicalIndex);
}

function patternSetup(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  currentPrice: number,
  asOfIndex: number,
  allowOpenDemoCandle: boolean
): ChartTradeSetup | null {
  const pattern = primaryPattern(asset);
  if (!pattern || (pattern.state !== "forming" && pattern.state !== "confirmed")) return null;
  const action = patternAction(pattern);
  const patternDrawings = action === "buy_candidate" ? finalPatternDrawings(asset, pattern) : null;
  if (action !== "buy_candidate" || !patternDrawings) return null;

  let sourceKind: ChartTradeSetup["sourceKind"];
  let signalIndex: number;
  let signalAt: string | null;
  let projectionBars = defaultProjectionBars;
  if (pattern.state === "confirmed") {
    const plan = asset.geometry.tradePlan;
    if (!plan || !completeDisplayedPlan(plan) || !planMatchesPattern(plan, pattern, asset) || plan.action !== action) {
      return null;
    }
    signalIndex = findCandleIndex(candles, plan.signalAt, asset.interval, allowOpenDemoCandle);
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
    evidenceKind: "final",
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
    referenceGuides: [],
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

  if (supports.length >= 1 && resistances.length >= 2) {
    const candidate = evidenceScenario(asset, latestLogicalIndex, {
      entry: finalEvidence(resistances[0], "저항선"),
      target: finalEvidence(resistances[1], "다음 저항선"),
      stop: finalEvidence(supports[0], "지지선")
    }, "prices_from_selected_h_lines");
    return validScenarioPrices(
      candidate.action, candidate.sourceKind, currentPrice,
      candidate.entryPrice, candidate.targetPrice, candidate.stopPrice
    ) ? candidate : null;
  }
  return null;
}

function evidenceScenario(
  asset: ChartAnalysisAsset,
  latestLogicalIndex: number,
  levels: { entry: PriceEvidence; target: PriceEvidence; stop: PriceEvidence },
  reason: string
): ChartTradeSetup {
  const entryPrice = rounded(levels.entry.price);
  const targetPrice = rounded(levels.target.price);
  const stopPrice = rounded(levels.stop.price);
  const ids = [levels.entry.id, levels.target.id, levels.stop.id];
  const patternId = `levels:${ids.join("|")}`;
  const referenceGuides = [levels.entry, levels.target, levels.stop]
    .flatMap((item) => item.guide ? [item.guide] : []);
  return {
    version: "chart-trade-setup-v1",
    action: "buy_candidate",
    sourceKind: "conditional",
    evidenceKind: referenceGuides.length ? "reference" : "final",
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
    reasons: [reason],
    drawingIds: setupDrawingIds(asset, patternId, "conditional", "buy_candidate"),
    priceSources: {
      entry: source(levels.entry.label, levels.entry.drawingIds, levels.entry.derivation),
      target: source(levels.target.label, levels.target.drawingIds, levels.target.derivation),
      stop: source(levels.stop.label, levels.stop.drawingIds, levels.stop.derivation)
    },
    referenceGuides,
    assetIdentity: identityFromAsset(asset)
  };
}

function channelSetup(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  currentPrice: number,
  latestLogicalIndex: number
): ChartTradeSetup | null {
  const trend = asset.geometry.primaryTrend;
  if (!trend || trend.kind !== "channel" || trend.activeInvalidation === true || trend.invalidation) return null;
  const drawing = asset.geometry.drawings.find((candidate) => (
    candidate.id === trend.drawingId
    && candidate.type === "trendParallelLines"
    && candidate.anchors.length >= 3
  ));
  if (!drawing) return null;
  const base = linePriceAt(drawing, candles, latestLogicalIndex, asset.interval);
  const offsetAnchor = drawing.anchors[2];
  const offsetIndex = anchorLogicalIndex(offsetAnchor, candles, asset.interval);
  const baseAtOffset = offsetIndex === null ? null : linePriceAt(drawing, candles, offsetIndex, asset.interval);
  if (!positive(base) || !positive(offsetAnchor?.price) || !positive(baseAtOffset)) return null;
  const parallel = base + (offsetAnchor.price - baseAtOffset);
  const lower = Math.min(base, parallel);
  const upper = Math.max(base, parallel);
  const middle = (lower + upper) / 2;
  if (!(lower < currentPrice && currentPrice <= middle && middle < upper)) return null;
  const channelEvidence = (price: number, label: string): PriceEvidence => ({
    id: `${drawing.id}:${label}`,
    price,
    label,
    drawingIds: [drawing.id],
    derivation: "channel",
    final: true
  });
  const setup = evidenceScenario(asset, latestLogicalIndex, {
    entry: channelEvidence(middle, "채널 중단"),
    target: channelEvidence(upper, "채널 상단"),
    stop: channelEvidence(lower, "채널 하단")
  }, "prices_from_active_parallel_channel");
  return validScenarioPrices(
    setup.action, setup.sourceKind, currentPrice,
    setup.entryPrice, setup.targetPrice, setup.stopPrice
  ) ? setup : null;
}

function referenceSetup(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  currentPrice: number,
  latestLogicalIndex: number
): ChartTradeSetup | null {
  const finalSupports = finalLevelDrawings(asset, asset.geometry.supports)
    .map((item) => finalEvidence(item, "지지선"));
  const finalResistances = finalLevelDrawings(asset, asset.geometry.resistances)
    .map((item) => finalEvidence(item, "저항선"));
  const finalTrends = finalTrendEvidence(asset, candles, latestLogicalIndex);
  if (!finalSupports.length && !finalResistances.length && !finalTrends.length) return null;

  const trace = asset.geometry.analysisTrace;
  const interpretationLevelIds = new Set(
    buildAnalysisTraceOverlay(asset, { visible: true })?.candidates
      .filter((candidate) => candidate.category === "levels")
      .map((candidate) => candidate.id) ?? []
  );
  const traceLevels = (trace?.levelCandidates ?? [])
    .filter((candidate) => interpretationLevelIds.has(candidate.id) && eligibleReferenceLevelCandidate(candidate))
    .map((candidate) => traceCandidateEvidence(asset, candidate))
    .filter((item): item is PriceEvidence & { role: "support" | "resistance" } => item !== null);
  const pivots = (trace?.pivots ?? [])
    .filter((pivot) => pivotIsPointInTime(pivot, asset.asOf))
    .map((pivot) => pivotEvidence(asset, pivot))
    .filter((item): item is PriceEvidence & { role: "support" | "resistance" } => item !== null);

  const supports = dedupeEvidence([
    ...finalSupports.map((item) => ({ ...item, role: "support" as const })),
    ...finalTrends.filter((item) => item.role === "support"),
    ...traceLevels.filter((item) => item.role === "support"),
    ...pivots.filter((item) => item.role === "support")
  ].filter((item) => item.price < currentPrice))
    .sort((left, right) => right.price - left.price || evidenceOrder(left, right));
  const resistances = dedupeEvidence([
    ...finalResistances.map((item) => ({ ...item, role: "resistance" as const })),
    ...finalTrends.filter((item) => item.role === "resistance"),
    ...traceLevels.filter((item) => item.role === "resistance"),
    ...pivots.filter((item) => item.role === "resistance")
  ].filter((item) => item.price > currentPrice))
    .sort((left, right) => left.price - right.price || evidenceOrder(left, right));
  if (supports.length < 1 || resistances.length < 2) return null;
  const setup = evidenceScenario(asset, latestLogicalIndex, {
    entry: { ...resistances[0], label: resistances[0].final ? "저항선" : resistances[0].label },
    target: { ...resistances[1], label: resistances[1].final ? "다음 저항선" : resistances[1].label },
    stop: { ...supports[0], label: supports[0].final ? "지지선" : supports[0].label }
  }, "prices_from_final_and_reference_geometry");
  const referenceScenario = { ...setup, evidenceKind: "reference" as const };
  return validScenarioPrices(
    referenceScenario.action, referenceScenario.sourceKind, currentPrice,
    referenceScenario.entryPrice, referenceScenario.targetPrice, referenceScenario.stopPrice
  ) ? referenceScenario : null;
}

function finalTrendEvidence(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  latestLogicalIndex: number
): Array<PriceEvidence & { role: "support" | "resistance" }> {
  const trend = asset.geometry.primaryTrend;
  if (!trend || trend.kind === "channel" || trend.activeInvalidation === true || trend.invalidation) return [];
  const drawing = asset.geometry.drawings.find((candidate) => (
    candidate.id === trend.drawingId
    && candidate.type === "trendLine"
    && candidate.anchors.length >= 2
  ));
  if (!drawing) return [];
  const price = linePriceAt(drawing, candles, latestLogicalIndex, asset.interval);
  if (!positive(price)) return [];
  const role = trend.direction === "up" ? "support" as const : "resistance" as const;
  return [{
    id: drawing.id,
    price,
    label: role === "support" ? "상승 추세선" : "하락 추세선",
    role,
    drawingIds: [drawing.id],
    derivation: "trend",
    final: true
  }];
}

function finalEvidence(item: LevelDrawingSource, label: string): PriceEvidence {
  return {
    id: item.drawing.id,
    price: item.price,
    label,
    drawingIds: [item.drawing.id],
    derivation: "level",
    final: true
  };
}

function eligibleReferenceLevelCandidate(candidate: GeometryTraceCandidate): boolean {
  if (candidate.selected || !candidate.hardPass) return false;
  const role = String(candidate.role ?? "").toLowerCase();
  if (role !== "support" && role !== "resistance") return false;
  return !(candidate.rejectReasons ?? []).some((reason) => (
    /stale|breach|invalid|role.?conflict|break.?pending/i.test(reason)
  ));
}

function traceCandidateEvidence(
  asset: ChartAnalysisAsset,
  candidate: GeometryTraceCandidate
): (PriceEvidence & { role: "support" | "resistance" }) | null {
  const metricPrice = Number(candidate.metrics?.price);
  const price = positive(metricPrice)
    ? metricPrice
    : candidate.anchors?.find((anchor) => positive(anchor.price))?.price;
  const role = candidate.role === "support" || candidate.role === "resistance" ? candidate.role : null;
  if (!positive(price) || !role) return null;
  const guideId = referenceGuideId(asset, `level-${candidate.id}`);
  const label = role === "support" ? "후보 지지선" : "후보 저항선";
  return {
    id: candidate.id,
    price,
    label,
    role,
    drawingIds: [guideId],
    derivation: "trace_level",
    final: false,
    guide: { id: guideId, price, label }
  };
}

function pivotIsPointInTime(pivot: GeometryTracePivot, asOf: string): boolean {
  const confirmedAt = Date.parse(pivot.confirmedAt ?? pivot.timestamp);
  const cutoff = Date.parse(asOf);
  return positive(pivot.price) && Number.isFinite(confirmedAt) && Number.isFinite(cutoff) && confirmedAt <= cutoff;
}

function pivotEvidence(
  asset: ChartAnalysisAsset,
  pivot: GeometryTracePivot
): (PriceEvidence & { role: "support" | "resistance" }) | null {
  const kind = String(pivot.kind ?? "").trim().toLowerCase();
  const descriptor = `${kind} ${pivot.role ?? ""}`.toLowerCase();
  const role = kind === "h" || /high|resistance|peak/.test(descriptor)
    ? "resistance" as const
    : kind === "l" || /low|support|trough/.test(descriptor)
      ? "support" as const
      : null;
  if (!role || !positive(pivot.price)) return null;
  const guideId = referenceGuideId(asset, `pivot-${pivot.id}`);
  const label = role === "support" ? "확인된 저점" : "확인된 전고점";
  return {
    id: pivot.id,
    price: pivot.price,
    label,
    role,
    drawingIds: [guideId],
    derivation: "pivot",
    final: false,
    guide: { id: guideId, price: pivot.price, label }
  };
}

function referenceGuideId(asset: ChartAnalysisAsset, sourceId: string): string {
  return `chart-plan:${asset.symbol}:${asset.interval}:reference:${sourceId.replace(/[^0-9A-Za-z:_-]/g, "-")}`;
}

function dedupeEvidence<T extends PriceEvidence>(items: T[]): T[] {
  const sorted = [...items].sort((left, right) => (
    Number(right.final) - Number(left.final) || evidenceOrder(left, right)
  ));
  return sorted.filter((item, index) => !sorted.slice(0, index).some((previous) => (
    Math.abs(previous.price - item.price) <= Math.max(0.000001, item.price * 0.00001)
  )));
}

function evidenceOrder(left: PriceEvidence, right: PriceEvidence): number {
  return Number(right.final) - Number(left.final) || left.id.localeCompare(right.id);
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

function findCandleIndex(
  candles: CandleDto[],
  timestamp: string,
  interval: AnalysisAssetInterval,
  allowOpenCandle = false
): number {
  const eligible = (candle: CandleDto) => allowOpenCandle || candle.isClosed !== false;
  const exact = candles.findIndex((candle) => candle.timestamp === timestamp && eligible(candle));
  if (exact >= 0) return exact;
  if (interval !== "1D" && interval !== "1W") return -1;
  const date = timestamp.slice(0, 10);
  return candles.findIndex((candle) => eligible(candle) && candle.timestamp.slice(0, 10) === date);
}

function isNvdaSimulationDemoPlan(asset: ChartAnalysisAsset): boolean {
  return asset.symbol.trim().toUpperCase() === "NVDA"
    && asset.interval === "1D"
    && asset.geometry.tradePlan?.reasons.includes(simulationDemoRewardRiskOverrideReason) === true;
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
