import type {
  AnalysisAssetInterval,
  ChartAnalysisAsset,
  GeometryPattern,
  GeometryPatternKind,
  GeometryTradePlan
} from "./analysisAssetsApi";
import type { CandleDto } from "./types";

const intervalOrder: AnalysisAssetInterval[] = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"];

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
    entry: string;
    target: string;
    stop: string;
  };
  assetIdentity: {
    algorithmVersion: string;
    inputDigest: string;
    asOf: string;
  };
};

export function projectChartTradeSetup(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[],
  availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>
): ChartTradeSetup | null {
  if (!asset) return null;
  const latestLogicalIndex = latestClosedCandleIndex(candles);
  const latest = latestLogicalIndex >= 0 ? candles[latestLogicalIndex] : undefined;
  if (!latest || !positive(latest.close)) return null;

  const confirmed = confirmedSetup(asset, candles);
  if (confirmed) return confirmed;

  const candidates = orderedAssets(asset, availableAssets);
  for (const candidate of candidates) {
    const conditional = conditionalSetup(asset, candidate, latest.close, latestLogicalIndex);
    if (conditional) return conditional;
  }
  return null;
}

function confirmedSetup(asset: ChartAnalysisAsset, candles: CandleDto[]): ChartTradeSetup | null {
  const plan = asset.geometry.tradePlan;
  if (!plan || !completeDisplayedPlan(plan)) return null;
  const signalIndex = findSignalIndex(candles, plan.signalAt, asset.interval);
  if (signalIndex < 0) return null;
  const drawingIds = setupDrawingIds(asset, plan.patternId, "confirmed", plan.action);
  return {
    version: "chart-trade-setup-v1",
    action: plan.action,
    sourceKind: "confirmed",
    sourceInterval: asset.interval,
    entryPrice: plan.entryPrice,
    entryTrigger: plan.entryTrigger,
    targetPrice: plan.targetPrice,
    stopPrice: plan.stopPrice,
    rewardRiskRatio: plan.rewardRiskRatio,
    signalAt: candles[signalIndex]?.timestamp ?? plan.signalAt,
    signalIndex,
    patternId: plan.patternId,
    patternKind: plan.patternKind,
    projectionBars: plan.projectionBars,
    reasons: [...plan.reasons],
    drawingIds,
    priceSources: {
      entry: "서버 확인 신호",
      target: plan.action === "sell_candidate" ? "서버 예상 하단" : "서버 패턴 목표",
      stop: plan.action === "sell_candidate" ? "서버 재검토 기준" : "서버 손절 기준"
    },
    assetIdentity: identityFromAsset(asset)
  };
}

function conditionalSetup(
  displayAsset: ChartAnalysisAsset,
  evidenceAsset: ChartAnalysisAsset,
  currentPrice: number,
  latestLogicalIndex: number
): ChartTradeSetup | null {
  const pattern = primaryPattern(evidenceAsset);
  const action: ChartTradeSetup["action"] = pattern?.bias === "bearish"
    || evidenceAsset.geometry.tradePlan?.action === "sell_candidate"
    ? "sell_candidate"
    : "buy_candidate";
  const support = uniquePrices([
    ...evidenceAsset.geometry.supports.map((level) => level.price),
    boundaryPrice(pattern?.lower)
  ]).filter((price) => price < currentPrice);
  const resistance = uniquePrices([
    ...evidenceAsset.geometry.resistances.map((level) => level.price),
    boundaryPrice(pattern?.upper)
  ]).filter((price) => price > currentPrice);

  let entryPrice: number;
  let stopPrice: number;
  let targetPrice: number;
  let entrySource: string;
  let stopSource: string;
  let targetSource: string;

  if (action === "buy_candidate") {
    entryPrice = resistance[0] ?? currentPrice;
    entrySource = resistance.length ? "저장 저항·패턴 상단" : "마지막 완료 봉";
    const stops = uniquePrices([
      ...evidenceAsset.geometry.supports.map((level) => level.price),
      boundaryPrice(pattern?.lower)
    ]).filter((price) => price < entryPrice).sort((left, right) => right - left);
    if (!stops.length) return null;
    stopPrice = stops[0];
    stopSource = "저장 지지·패턴 하단";
    const targets = uniquePrices([
      ...evidenceAsset.geometry.resistances.map((level) => level.price),
      boundaryPrice(pattern?.upper)
    ]).filter((price) => price > entryPrice).sort((left, right) => left - right);
    targetPrice = targets[0] ?? entryPrice + 2 * (entryPrice - stopPrice);
    targetSource = targets.length ? "다음 저장 저항·패턴 상단" : "2R 투영";
  } else {
    entryPrice = [...support].sort((left, right) => right - left)[0] ?? currentPrice;
    entrySource = support.length ? "저장 지지·패턴 하단" : "마지막 완료 봉";
    const stops = uniquePrices([
      ...evidenceAsset.geometry.resistances.map((level) => level.price),
      boundaryPrice(pattern?.upper)
    ]).filter((price) => price > entryPrice).sort((left, right) => left - right);
    if (!stops.length) return null;
    stopPrice = stops[0];
    stopSource = "저장 저항·패턴 상단";
    const targets = uniquePrices([
      ...evidenceAsset.geometry.supports.map((level) => level.price),
      boundaryPrice(pattern?.lower)
    ]).filter((price) => price < entryPrice).sort((left, right) => right - left);
    targetPrice = targets[0] ?? entryPrice - 2 * (stopPrice - entryPrice);
    targetSource = targets.length ? "다음 저장 지지·패턴 하단" : "2R 투영";
  }

  if (![entryPrice, stopPrice, targetPrice].every(positive)) return null;
  const risk = Math.abs(entryPrice - stopPrice);
  if (risk <= 0) return null;
  const rewardRiskRatio = Math.abs(targetPrice - entryPrice) / risk;
  const patternId = pattern?.geometryHash ?? `levels-${evidenceAsset.interval}`;
  return {
    version: "chart-trade-setup-v1",
    action,
    sourceKind: "conditional",
    sourceInterval: evidenceAsset.interval,
    entryPrice: rounded(entryPrice),
    entryTrigger: rounded(entryPrice),
    targetPrice: rounded(targetPrice),
    stopPrice: rounded(stopPrice),
    rewardRiskRatio: rounded(rewardRiskRatio, 4),
    signalAt: null,
    signalIndex: latestLogicalIndex,
    patternId,
    patternKind: pattern?.kind ?? null,
    projectionBars: Math.max(10, evidenceAsset.geometry.tradePlan?.projectionBars ?? 10),
    reasons: ["stored_evidence_conditional", `source_interval_${evidenceAsset.interval}`],
    drawingIds: setupDrawingIds(displayAsset, patternId, "conditional", action),
    priceSources: { entry: entrySource, target: targetSource, stop: stopSource },
    assetIdentity: identityFromAsset(evidenceAsset)
  };
}

function orderedAssets(
  active: ChartAnalysisAsset,
  assets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>
): ChartAnalysisAsset[] {
  const activePosition = intervalOrder.indexOf(active.interval);
  const alternatives = intervalOrder
    .filter((interval) => interval !== active.interval)
    .sort((left, right) => {
      const leftDistance = Math.abs(intervalOrder.indexOf(left) - activePosition);
      const rightDistance = Math.abs(intervalOrder.indexOf(right) - activePosition);
      return leftDistance - rightDistance || intervalOrder.indexOf(right) - intervalOrder.indexOf(left);
    })
    .map((interval) => assets?.[interval])
    .filter((candidate): candidate is ChartAnalysisAsset => Boolean(candidate && candidate.symbol === active.symbol));
  return [active, ...alternatives];
}

function primaryPattern(asset: ChartAnalysisAsset): GeometryPattern | null {
  return asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle ?? null;
}

function boundaryPrice(boundary: GeometryPattern["upper"] | undefined): number | undefined {
  const price = boundary?.end?.price;
  return positive(price) ? price : undefined;
}

function uniquePrices(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter(positive).map((value) => rounded(value)))].sort((left, right) => left - right);
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

function findSignalIndex(candles: CandleDto[], signalAt: string, interval: AnalysisAssetInterval): number {
  const exact = candles.findIndex((candle) => candle.timestamp === signalAt && candle.isClosed !== false);
  if (exact >= 0) return exact;
  if (interval !== "1D" && interval !== "1W") return -1;
  const signalDate = signalAt.slice(0, 10);
  return candles.findIndex((candle) => candle.isClosed !== false && candle.timestamp.slice(0, 10) === signalDate);
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
