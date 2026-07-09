export type OrderFlowLevelDto = {
  priceBin: number;
  askVolume: number;
  bidVolume: number;
  unknownVolume: number;
  askTradeCount?: number;
  bidTradeCount?: number;
  unknownTradeCount?: number;
};

export type OrderFlowDayDto = {
  sessionDate: string;
  totals: {
    askVolume: number;
    bidVolume: number;
    unknownVolume: number;
    delta: number;
    tradeCount: number;
    volume: number;
  };
  levels: OrderFlowLevelDto[];
};

export type OrderFlowDailyResponseDto = {
  symbol: string;
  priceBinSize: number;
  sideClassification: "estimated";
  classificationVersion: string;
  from: string;
  to: string;
  dataStatus: "ready" | "empty" | "unsupported";
  days: OrderFlowDayDto[];
  supportedSymbols?: string[];
};

export type OrderFlowMinuteDto = {
  eventMinute: string;
  bins: OrderFlowLevelDto[];
};

export type OrderFlowIntradayResponseDto = {
  symbol: string;
  sessionDate: string;
  priceBinSize: number;
  dataStatus: "ready" | "empty" | "unsupported";
  minutes: OrderFlowMinuteDto[];
  liveQuote: {
    bidPrice?: number;
    askPrice?: number;
    bidSize?: number;
    askSize?: number;
    timestamp?: string;
  } | null;
  supportedSymbols?: string[];
};

export type OrderFlowMinuteUpdate = {
  eventMinute: string;
  sessionDate: string;
  priceBinSize: number;
  bins: OrderFlowLevelDto[];
  updatedAt: string;
};

export type OrderFlowLadderLevel = OrderFlowLevelDto & {
  delta: number;
  totalVolume: number;
  askImbalance: boolean;
  bidImbalance: boolean;
};

export type OrderFlowLadder = {
  priceStep: number;
  levels: OrderFlowLadderLevel[];
  minPrice: number;
  maxPrice: number;
  pocPriceBin: number | null;
  totals: OrderFlowDayDto["totals"];
  maxLevelVolume: number;
  label?: string;
};

export const ORDER_FLOW_IMBALANCE_RATIO = 3.0;
export const ORDER_FLOW_IMBALANCE_MIN_SHARE = 0.05;
export const ORDER_FLOW_PRICE_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1] as const;
export const ORDER_FLOW_WINDOWS = ["1m", "10m", "1h", "session"] as const;
export const ORDER_FLOW_MIN_TARGET_ROWS = 8;
export const ORDER_FLOW_MIN_ROW_HEIGHT = 6;
export const ORDER_FLOW_AUTO_ROW_CAP = 44;

export type OrderFlowWindow = typeof ORDER_FLOW_WINDOWS[number];
export type OrderFlowPriceStep = typeof ORDER_FLOW_PRICE_STEPS[number];
export type OrderFlowPriceStepSelection = "auto" | OrderFlowPriceStep;
export type OrderFlowResolutionSelection = "auto" | number;

const orderFlowTargetRowSteps = [8, 10, 12, 16, 20, 24, 32, 44, 64, 80, 96, 128] as const;

export function autoPriceStep(priceRange: number, maxRows: number): OrderFlowPriceStep {
  const range = Math.max(0, isFiniteNumber(priceRange) ? priceRange : 0);
  const rows = Math.max(1, Math.floor(isFiniteNumber(maxRows) ? maxRows : 1));
  return ORDER_FLOW_PRICE_STEPS.find((step) => range / step <= rows)
    ?? ORDER_FLOW_PRICE_STEPS[ORDER_FLOW_PRICE_STEPS.length - 1];
}

export function maxOrderFlowTargetRowsForHeight(height: number, reservedPx = 20): number {
  const available = Math.max(0, isFiniteNumber(height) ? height - reservedPx : 0);
  return Math.max(ORDER_FLOW_MIN_TARGET_ROWS, Math.floor(available / ORDER_FLOW_MIN_ROW_HEIGHT));
}

export function autoOrderFlowTargetRows(height: number): number {
  const maxRows = maxOrderFlowTargetRowsForHeight(height);
  const available = Math.max(0, isFiniteNumber(height) ? height - 24 : 0);
  const comfortableRows = Math.floor(available / 13);
  return clampNumber(comfortableRows, ORDER_FLOW_MIN_TARGET_ROWS, Math.min(maxRows, ORDER_FLOW_AUTO_ROW_CAP));
}

export function resolveOrderFlowTargetRows(
  resolution: OrderFlowResolutionSelection,
  autoRows: number,
  maxRows = ORDER_FLOW_AUTO_ROW_CAP
): number {
  const source = resolution === "auto" ? autoRows : resolution;
  return clampNumber(Math.round(source), ORDER_FLOW_MIN_TARGET_ROWS, Math.max(ORDER_FLOW_MIN_TARGET_ROWS, Math.floor(maxRows)));
}

export function stepOrderFlowTargetRows(currentTargetRows: number, direction: 1 | -1, maxRows: number): number {
  const upper = Math.max(ORDER_FLOW_MIN_TARGET_ROWS, Math.floor(maxRows));
  const steps = [...orderFlowTargetRowSteps, upper]
    .filter((value, index, values) => value <= upper && values.indexOf(value) === index)
    .sort((left, right) => left - right);
  if (!steps.length) {
    return ORDER_FLOW_MIN_TARGET_ROWS;
  }
  if (direction > 0) {
    return steps.find((value) => value > currentTargetRows) ?? steps[steps.length - 1];
  }
  return [...steps].reverse().find((value) => value < currentTargetRows) ?? steps[0];
}

export function effectiveOrderFlowPriceStep(priceRange: number, targetRows: number, sourceStep: number): OrderFlowPriceStep {
  return Math.max(sourceStep, autoPriceStep(priceRange, targetRows)) as OrderFlowPriceStep;
}

export function visibleScaleMax(ladders: OrderFlowLadder[]): number {
  return Math.max(
    1,
    ...ladders.flatMap((ladder) => ladder.levels.map((level) => safeNumber(level.totalVolume)))
  );
}

export function rebinLevels(levels: OrderFlowLevelDto[], fromStep: number, toStep: number): OrderFlowLevelDto[] {
  assertRebinCompatible(fromStep, toStep);
  const aggregated = new Map<number, OrderFlowAccumulator>();
  levels.forEach((level) => {
    if (!isFiniteNumber(level.priceBin)) {
      return;
    }
    const priceBin = roundPrice(Math.round(level.priceBin / toStep) * toStep);
    const accumulator = aggregated.get(priceBin) ?? emptyAccumulator(priceBin);
    addLevel(accumulator, level);
    aggregated.set(priceBin, accumulator);
  });
  return Array.from(aggregated.values())
    .map(accumulatorToLevel)
    .sort((left, right) => right.priceBin - left.priceBin);
}

export function sumMinuteWindows(minutes: OrderFlowMinuteDto[], windowMinutes: number | "session"): OrderFlowLevelDto[] {
  const byMinute = new Map<string, OrderFlowLevelDto[]>();
  minutes.forEach((minute) => {
    if (!minute.eventMinute || !Array.isArray(minute.bins)) {
      return;
    }
    byMinute.set(minute.eventMinute, minute.bins);
  });
  const orderedMinutes = Array.from(byMinute.keys()).sort(compareMinute);
  const selected = windowMinutes === "session"
    ? orderedMinutes
    : orderedMinutes.slice(-Math.max(0, Math.floor(windowMinutes)));
  const aggregated = new Map<number, OrderFlowAccumulator>();
  selected.forEach((eventMinute) => {
    byMinute.get(eventMinute)?.forEach((level) => {
      if (!isFiniteNumber(level.priceBin)) {
        return;
      }
      const priceBin = roundPrice(level.priceBin);
      const accumulator = aggregated.get(priceBin) ?? emptyAccumulator(priceBin);
      addLevel(accumulator, level);
      aggregated.set(priceBin, accumulator);
    });
  });
  return Array.from(aggregated.values())
    .map(accumulatorToLevel)
    .sort((left, right) => right.priceBin - left.priceBin);
}

export function buildLadder(levels: OrderFlowLevelDto[], priceStep: number, label?: string): OrderFlowLadder {
  const aggregated = new Map<number, OrderFlowAccumulator>();
  levels.forEach((level) => {
    if (!isFiniteNumber(level.priceBin)) {
      return;
    }
    const priceBin = roundPrice(level.priceBin);
    const accumulator = aggregated.get(priceBin) ?? emptyAccumulator(priceBin);
    addLevel(accumulator, level);
    aggregated.set(priceBin, accumulator);
  });

  const baseLevels = Array.from(aggregated.values())
    .map(accumulatorToLevel)
    .sort((left, right) => right.priceBin - left.priceBin);
  const volumeForLevel = (level: OrderFlowLevelDto) => safeNumber(level.askVolume) + safeNumber(level.bidVolume) + safeNumber(level.unknownVolume);
  const maxLevelVolume = Math.max(1, ...baseLevels.map(volumeForLevel));
  const levelByPrice = new Map(baseLevels.map((level) => [priceKey(level.priceBin), level]));
  let pocPriceBin: number | null = null;
  let pocVolume = Number.NEGATIVE_INFINITY;
  baseLevels.forEach((level) => {
    const totalVolume = volumeForLevel(level);
    if (
      totalVolume > pocVolume ||
      (totalVolume === pocVolume && (pocPriceBin === null || level.priceBin < pocPriceBin))
    ) {
      pocVolume = totalVolume;
      pocPriceBin = level.priceBin;
    }
  });
  const floorVolume = ORDER_FLOW_IMBALANCE_MIN_SHARE * maxLevelVolume;
  const ladderLevels = baseLevels.map((level): OrderFlowLadderLevel => {
    const totalVolume = volumeForLevel(level);
    const lower = levelByPrice.get(priceKey(level.priceBin - priceStep));
    const higher = levelByPrice.get(priceKey(level.priceBin + priceStep));
    return {
      ...level,
      delta: safeNumber(level.askVolume) - safeNumber(level.bidVolume),
      totalVolume,
      askImbalance: isAskImbalanced(level, lower, totalVolume, floorVolume),
      bidImbalance: isBidImbalanced(level, higher, totalVolume, floorVolume)
    };
  });

  return {
    priceStep,
    levels: ladderLevels,
    minPrice: ladderLevels.length ? Math.min(...ladderLevels.map((level) => level.priceBin)) : 0,
    maxPrice: ladderLevels.length ? Math.max(...ladderLevels.map((level) => level.priceBin)) : 0,
    pocPriceBin,
    totals: totalsForLevels(baseLevels),
    maxLevelVolume,
    ...(label ? { label } : {})
  };
}

export function orderFlowDayFromMinutes(
  symbol: string,
  sessionDate: string,
  minutes: Iterable<OrderFlowMinuteDto>
): OrderFlowDayDto {
  void symbol;
  const levels = sumMinuteWindows(Array.from(minutes), "session");
  return {
    sessionDate,
    totals: totalsForLevels(levels),
    levels
  };
}

export function replaceOrderFlowMinute(
  current: Map<string, OrderFlowMinuteDto>,
  update: OrderFlowMinuteUpdate
): Map<string, OrderFlowMinuteDto> {
  const next = new Map(current);
  next.set(update.eventMinute, {
    eventMinute: update.eventMinute,
    bins: Array.isArray(update.bins) ? update.bins : []
  });
  return next;
}

export function sessionDateFromTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return timestamp.slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

type OrderFlowAccumulator = {
  priceBin: number;
  askVolume: number;
  bidVolume: number;
  unknownVolume: number;
  askTradeCount: number;
  bidTradeCount: number;
  unknownTradeCount: number;
  hasAskTradeCount: boolean;
  hasBidTradeCount: boolean;
  hasUnknownTradeCount: boolean;
};

function assertRebinCompatible(fromStep: number, toStep: number): void {
  if (!isFiniteNumber(fromStep) || !isFiniteNumber(toStep) || fromStep <= 0 || toStep <= 0) {
    throw new RangeError("Order flow price steps must be positive finite numbers.");
  }
  if (toStep + 1e-9 < fromStep) {
    throw new RangeError("Order flow target price step must be greater than or equal to the source step.");
  }
  const ratio = toStep / fromStep;
  if (Math.abs(Math.round(ratio) - ratio) > 1e-6) {
    throw new RangeError("Order flow target price step must be a multiple of the source step.");
  }
}

function emptyAccumulator(priceBin: number): OrderFlowAccumulator {
  return {
    priceBin,
    askVolume: 0,
    bidVolume: 0,
    unknownVolume: 0,
    askTradeCount: 0,
    bidTradeCount: 0,
    unknownTradeCount: 0,
    hasAskTradeCount: false,
    hasBidTradeCount: false,
    hasUnknownTradeCount: false
  };
}

function addLevel(accumulator: OrderFlowAccumulator, level: OrderFlowLevelDto): void {
  accumulator.askVolume += safeNumber(level.askVolume);
  accumulator.bidVolume += safeNumber(level.bidVolume);
  accumulator.unknownVolume += safeNumber(level.unknownVolume);
  if (isFiniteNumber(level.askTradeCount)) {
    accumulator.askTradeCount += level.askTradeCount;
    accumulator.hasAskTradeCount = true;
  }
  if (isFiniteNumber(level.bidTradeCount)) {
    accumulator.bidTradeCount += level.bidTradeCount;
    accumulator.hasBidTradeCount = true;
  }
  if (isFiniteNumber(level.unknownTradeCount)) {
    accumulator.unknownTradeCount += level.unknownTradeCount;
    accumulator.hasUnknownTradeCount = true;
  }
}

function accumulatorToLevel(accumulator: OrderFlowAccumulator): OrderFlowLevelDto {
  return {
    priceBin: accumulator.priceBin,
    askVolume: accumulator.askVolume,
    bidVolume: accumulator.bidVolume,
    unknownVolume: accumulator.unknownVolume,
    ...(accumulator.hasAskTradeCount ? { askTradeCount: accumulator.askTradeCount } : {}),
    ...(accumulator.hasBidTradeCount ? { bidTradeCount: accumulator.bidTradeCount } : {}),
    ...(accumulator.hasUnknownTradeCount ? { unknownTradeCount: accumulator.unknownTradeCount } : {})
  };
}

function totalsForLevels(levels: OrderFlowLevelDto[]): OrderFlowDayDto["totals"] {
  const askVolume = levels.reduce((sum, level) => sum + safeNumber(level.askVolume), 0);
  const bidVolume = levels.reduce((sum, level) => sum + safeNumber(level.bidVolume), 0);
  const unknownVolume = levels.reduce((sum, level) => sum + safeNumber(level.unknownVolume), 0);
  const tradeCount = levels.reduce((sum, level) => (
    sum +
    safeNumber(level.askTradeCount) +
    safeNumber(level.bidTradeCount) +
    safeNumber(level.unknownTradeCount)
  ), 0);
  return {
    askVolume,
    bidVolume,
    unknownVolume,
    delta: askVolume - bidVolume,
    tradeCount,
    volume: askVolume + bidVolume + unknownVolume
  };
}

function isAskImbalanced(
  level: OrderFlowLevelDto,
  lower: OrderFlowLevelDto | undefined,
  totalVolume: number,
  floorVolume: number
): boolean {
  const askVolume = safeNumber(level.askVolume);
  const opposingBid = safeNumber(lower?.bidVolume);
  if (totalVolume < floorVolume || askVolume <= 0) {
    return false;
  }
  return opposingBid <= 0
    ? true
    : askVolume >= ORDER_FLOW_IMBALANCE_RATIO * opposingBid;
}

function isBidImbalanced(
  level: OrderFlowLevelDto,
  higher: OrderFlowLevelDto | undefined,
  totalVolume: number,
  floorVolume: number
): boolean {
  const bidVolume = safeNumber(level.bidVolume);
  const opposingAsk = safeNumber(higher?.askVolume);
  if (totalVolume < floorVolume || bidVolume <= 0) {
    return false;
  }
  return opposingAsk <= 0
    ? true
    : bidVolume >= ORDER_FLOW_IMBALANCE_RATIO * opposingAsk;
}

function compareMinute(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.localeCompare(right);
}

function priceKey(value: number): number {
  return roundPrice(value);
}

function roundPrice(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
