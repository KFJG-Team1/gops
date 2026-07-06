import type { CandleDto, ChartInterval, FootprintBucketDto } from "./types";

export type DigTargetInterval = ChartInterval | "footprint";

export type ExpansionStatus = "loading" | "ready" | "empty" | "error";

export type SemanticExpansion = {
  id: string;
  symbol: string;
  parentExpansionId?: string;
  parentNodeId: string;
  parentTimestamp: string;
  parentInterval: ChartInterval;
  parentCandle: CandleDto;
  childInterval: DigTargetInterval;
  from: string;
  to: string;
  depth: number;
  status: ExpansionStatus;
  candles: CandleDto[];
  footprintBucket?: FootprintBucketDto | null;
  message?: string;
  openedAt: string;
};

export type SemanticCandleUnit = {
  kind: "candle";
  id: string;
  symbol: string;
  interval: ChartInterval;
  timestamp: string;
  from: string;
  to: string;
  candle: CandleDto;
  depth: number;
  parentExpansionId?: string;
  sourceIndex?: number;
  slotStart: number;
  slotEnd: number;
  slotCenter: number;
};

export type SemanticPlaceholderUnit = {
  kind: "placeholder" | "footprint";
  id: string;
  symbol: string;
  interval: DigTargetInterval;
  parentExpansionId: string;
  parentNodeId: string;
  from: string;
  to: string;
  depth: number;
  status: ExpansionStatus;
  message: string;
  footprintBucket?: FootprintBucketDto | null;
  slotStart: number;
  slotEnd: number;
  slotCenter: number;
};

export type SemanticRenderUnit = SemanticCandleUnit | SemanticPlaceholderUnit;

export type SemanticExpansionRange = {
  id: string;
  parentNodeId: string;
  parentTimestamp: string;
  parentInterval: ChartInterval;
  parentCandle: CandleDto;
  childInterval: DigTargetInterval;
  from: string;
  to: string;
  depth: number;
  status: ExpansionStatus;
  message?: string;
  slotStart: number;
  slotEnd: number;
  left: number;
  right: number;
};

export type SemanticTimeline = {
  units: SemanticRenderUnit[];
  expansionRanges: Omit<SemanticExpansionRange, "left" | "right">[];
  totalSlots: number;
  occupiedSlotStart: number;
  occupiedSlotEnd: number;
  expansionExtraSlots: number;
  logicalIndexToSlot: Map<number, number>;
  timestampToSlot: Map<string, number>;
  unitById: Map<string, SemanticRenderUnit>;
};

export type SemanticSelectionSnapshot = {
  nodeId: string;
  kind: SemanticRenderUnit["kind"];
  symbol: string;
  interval: DigTargetInterval;
  timestamp?: string;
  from: string;
  to: string;
  depth: number;
  status?: ExpansionStatus;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  isClosed?: boolean;
};

type BuildSemanticTimelineInput = {
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  expansions: SemanticExpansion[];
  visibleStartIndex: number;
  visibleEndIndex: number;
  viewportStartIndex: number;
  visibleSlotCount: number;
};

const placeholderSlotWidth = 8;
const footprintSlotWidth = 12;
const intradayChildCandleSlotWidth = 0.36;
const dailyChildCandleSlotWidth = 0.5;
const weeklyChildCandleSlotWidth = 0.6;

export function nextDigTargetInterval(interval: ChartInterval): DigTargetInterval {
  switch (interval) {
    case "footprint":
      return "footprint";
    case "1M":
      return "1W";
    case "1W":
      return "1D";
    case "1D":
      return "10m";
    case "10m":
      return "1m";
    case "5m":
      return "1m";
    case "1m":
      return "footprint";
  }
}

export function semanticNodeId(symbol: string, interval: ChartInterval, timestamp: string, parentExpansionId?: string): string {
  return ["candle", parentExpansionId ?? "root", symbol, interval, timestamp].join(":");
}

export function semanticExpansionId(parentNodeId: string): string {
  return `expansion:${parentNodeId}`;
}

export function candleRange(candle: CandleDto, interval: ChartInterval): { from: string; to: string } {
  const from = parseIso(candle.timestamp);
  return {
    from: toIso(from),
    to: toIso(addInterval(from, interval))
  };
}

export function expansionLimitForInterval(interval: DigTargetInterval): number {
  if (interval === "footprint") {
    return 1;
  }
  if (interval === "10m") {
    return 80;
  }
  if (interval === "1m") {
    return 420;
  }
  return 64;
}

export function childQueryRange(parentRange: { from: string; to: string }, childInterval: DigTargetInterval): { from: string; to: string } {
  if (childInterval === "footprint") {
    return parentRange;
  }
  return {
    from: toIso(floorInterval(parseIso(parentRange.from), childInterval)),
    to: toIso(ceilInterval(parseIso(parentRange.to), childInterval))
  };
}

export function buildSemanticTimeline(input: BuildSemanticTimelineInput): SemanticTimeline {
  const units: SemanticRenderUnit[] = [];
  const expansionRanges: SemanticTimeline["expansionRanges"] = [];
  const logicalIndexToSlot = new Map<number, number>();
  const timestampToSlot = new Map<string, number>();
  const unitById = new Map<string, SemanticRenderUnit>();
  const expansionByParent = new Map(input.expansions.map((expansion) => [expansion.parentNodeId, expansion]));
  const rootExpansionExtraByIndex = new Map<number, number>();
  const rootExpansionExtraBefore: number[] = new Array(input.candles.length + 1).fill(0);
  for (let index = 0; index < input.candles.length; index += 1) {
    const candle = input.candles[index];
    const rootNodeId = candle ? semanticNodeId(input.symbol, input.interval, candle.timestamp) : "";
    const expansion = rootNodeId ? expansionByParent.get(rootNodeId) : undefined;
    const expansionExtra = expansion ? Math.max(0, normalizeSlot(expansionSlotWidth(expansion, expansionByParent) - 1)) : 0;
    if (expansionExtra > 0) {
      rootExpansionExtraByIndex.set(index, expansionExtra);
    }
    rootExpansionExtraBefore[index + 1] = normalizeSlot(rootExpansionExtraBefore[index] + expansionExtra);
  }
  const maxExpansionWidth = Math.max(0, ...input.expansions.map((expansion) => expansionSlotWidth(expansion, expansionByParent)));
  const renderStartIndex = Math.max(0, Math.floor(input.visibleStartIndex - maxExpansionWidth - 2));
  const renderEndIndex = Math.min(input.candles.length, Math.ceil(input.visibleEndIndex + maxExpansionWidth + 2));

  const rememberUnit = (unit: SemanticRenderUnit) => {
    units.push(unit);
    unitById.set(unit.id, unit);
    if (!timestampToSlot.has(unit.from)) {
      timestampToSlot.set(unit.from, unit.slotCenter);
    }
    if (unit.kind === "candle" && !timestampToSlot.has(unit.timestamp)) {
      timestampToSlot.set(unit.timestamp, unit.slotCenter);
    }
  };

  const appendPlaceholder = (
    expansion: SemanticExpansion,
    kind: "placeholder" | "footprint",
    slotStart: number,
    message: string
  ): number => {
    const width = kind === "footprint" ? footprintSlotWidth : placeholderSlotWidthForExpansion(expansion);
    const slotEnd = normalizeSlot(slotStart + width);
    rememberUnit({
      kind,
      id: `${kind}:${expansion.id}`,
      symbol: input.symbol,
      interval: expansion.childInterval,
      parentExpansionId: expansion.id,
      parentNodeId: expansion.parentNodeId,
      from: expansion.from,
      to: expansion.to,
      depth: expansion.depth,
      status: expansion.status,
      message,
      footprintBucket: kind === "footprint" ? expansion.footprintBucket ?? null : undefined,
      slotStart,
      slotEnd,
      slotCenter: normalizeSlot((slotStart + slotEnd) / 2)
    });
    return slotEnd;
  };

  const appendExpansion = (expansion: SemanticExpansion, slotStart: number): number => {
    let cursor = slotStart;
    if (expansion.childInterval === "footprint") {
      cursor = appendPlaceholder(expansion, "footprint", cursor, "footprint");
    } else if (expansion.status === "ready" && expansion.candles.length > 0) {
      const childInterval = expansion.childInterval;
      const childSlotWidth = childCandleSlotWidthForExpansion(expansion);
      expansion.candles.forEach((childCandle) => {
        cursor = appendCandle(childCandle, childInterval, expansion.depth, expansion.id, undefined, cursor, true, childSlotWidth);
      });
    } else {
      const message = expansion.status === "loading"
        ? "loading"
        : expansion.status === "empty"
          ? expansion.message ?? "empty"
          : expansion.message ?? "error";
      cursor = appendPlaceholder(expansion, "placeholder", cursor, message);
    }
    const slotEnd = normalizeSlot(Math.max(slotStart + 1, cursor));
    const slotCenter = normalizeSlot((slotStart + slotEnd) / 2);
    if (!timestampToSlot.has(expansion.parentTimestamp)) {
      timestampToSlot.set(expansion.parentTimestamp, slotCenter);
    }
    expansionRanges.push({
      id: expansion.id,
      parentNodeId: expansion.parentNodeId,
      parentTimestamp: expansion.parentTimestamp,
      parentInterval: expansion.parentInterval,
      parentCandle: expansion.parentCandle,
      childInterval: expansion.childInterval,
      from: expansion.from,
      to: expansion.to,
      depth: expansion.depth,
      status: expansion.status,
      message: expansion.message,
      slotStart,
      slotEnd
    });
    return slotEnd;
  };

  const appendCandle = (
    candle: CandleDto,
    interval: ChartInterval,
    depth: number,
    parentExpansionId: string | undefined,
    sourceIndex: number | undefined,
    slotStart: number,
    allowExpansion: boolean,
    slotWidth = 1
  ): number => {
    const range = candleRange(candle, interval);
    const id = semanticNodeId(input.symbol, interval, candle.timestamp, parentExpansionId);
    const expansion = allowExpansion ? expansionByParent.get(id) : undefined;
    if (expansion) {
      const slotEnd = appendExpansion({ ...expansion, parentCandle: expansion.parentCandle ?? candle }, slotStart);
      if (typeof sourceIndex === "number") {
        logicalIndexToSlot.set(sourceIndex, (slotStart + Math.max(slotStart + 1, slotEnd)) / 2);
      }
      return slotEnd;
    }

    const slotEnd = normalizeSlot(slotStart + slotWidth);
    const unit: SemanticCandleUnit = {
      kind: "candle",
      id,
      symbol: input.symbol,
      interval,
      timestamp: candle.timestamp,
      from: range.from,
      to: range.to,
      candle,
      depth,
      parentExpansionId,
      sourceIndex,
      slotStart,
      slotEnd,
      slotCenter: normalizeSlot((slotStart + slotEnd) / 2)
    };
    rememberUnit(unit);
    if (typeof sourceIndex === "number") {
      logicalIndexToSlot.set(sourceIndex, unit.slotCenter);
    }

    return unit.slotEnd;
  };

  let extraSlots = rootExpansionExtraBefore[renderStartIndex] ?? 0;
  for (let index = renderStartIndex; index < renderEndIndex; index += 1) {
    const candle = input.candles[index];
    if (!candle) {
      continue;
    }
    const slotStart = index - input.viewportStartIndex + extraSlots;
    const rootNodeId = semanticNodeId(input.symbol, input.interval, candle.timestamp);
    const expansion = expansionByParent.get(rootNodeId);
    const expansionExtra = rootExpansionExtraByIndex.get(index) ?? 0;
    const width = expansion ? expansionExtra + 1 : 1;
    const rootVisible = index >= input.visibleStartIndex && index < input.visibleEndIndex;
    const overlapsViewport = slotStart < input.visibleSlotCount && slotStart + width > 0;
    if (!rootVisible && !overlapsViewport) {
      extraSlots = normalizeSlot(extraSlots + expansionExtra);
      continue;
    }
    const slotEnd = appendCandle(candle, input.interval, 0, undefined, index, slotStart, true);
    extraSlots = normalizeSlot(extraSlots + (expansion ? expansionExtra : Math.max(0, slotEnd - slotStart - 1)));
  }

  const occupiedSlotStart = units.length ? Math.min(...units.map((unit) => unit.slotStart)) : 0;
  const occupiedSlotEnd = units.length ? Math.max(...units.map((unit) => unit.slotEnd)) : input.visibleSlotCount;
  const expansionExtraSlots = Math.max(0, normalizeSlot(rootExpansionExtraBefore[input.candles.length] ?? 0));

  return {
    units,
    expansionRanges,
    totalSlots: Math.max(1, input.visibleSlotCount),
    occupiedSlotStart,
    occupiedSlotEnd,
    expansionExtraSlots,
    logicalIndexToSlot,
    timestampToSlot,
    unitById
  };
}

function expansionSlotWidth(
  expansion: SemanticExpansion,
  expansionByParent: Map<string, SemanticExpansion>,
  visited = new Set<string>()
): number {
  if (visited.has(expansion.id)) {
    return 1;
  }
  const nextVisited = new Set(visited).add(expansion.id);
  const childInterval = expansion.childInterval;
  if (childInterval === "footprint") {
    return footprintSlotWidth;
  }
  if (expansion.status === "ready" && expansion.candles.length > 0) {
    const childCandleSlotWidth = childCandleSlotWidthForExpansion(expansion);
    return normalizeSlot(Math.max(1, expansion.candles.reduce((total, candle) => {
      const childNodeId = semanticNodeId(expansion.symbol, childInterval, candle.timestamp, expansion.id);
      const childExpansion = expansionByParent.get(childNodeId);
      return total + (childExpansion ? expansionSlotWidth(childExpansion, expansionByParent, nextVisited) : childCandleSlotWidth);
    }, 0)));
  }
  return placeholderSlotWidthForExpansion(expansion);
}

function normalizeSlot(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function childCandleSlotWidthForExpansion(expansion: SemanticExpansion): number {
  if (expansion.childInterval === "1W") {
    return weeklyChildCandleSlotWidth;
  }
  if (expansion.childInterval === "1D") {
    return dailyChildCandleSlotWidth;
  }
  return intradayChildCandleSlotWidth;
}

function placeholderSlotWidthForExpansion(expansion: SemanticExpansion): number {
  if (expansion.status !== "loading") {
    return placeholderSlotWidth;
  }
  return estimatedLoadingExpansionSlotWidth(expansion);
}

function estimatedLoadingExpansionSlotWidth(expansion: SemanticExpansion): number {
  if (expansion.parentInterval === "1M" && expansion.childInterval === "1W") {
    return normalizeSlot(Math.max(1, 4 * childCandleSlotWidthForExpansion(expansion)));
  }
  if (expansion.parentInterval === "1W" && expansion.childInterval === "1D") {
    return normalizeSlot(Math.max(1, 5 * childCandleSlotWidthForExpansion(expansion)));
  }
  if (expansion.parentInterval === "1D" && expansion.childInterval === "10m") {
    return normalizeSlot(Math.max(1, 39 * childCandleSlotWidthForExpansion(expansion)));
  }
  if (expansion.parentInterval === "10m" && expansion.childInterval === "1m") {
    return normalizeSlot(Math.max(1, 10 * childCandleSlotWidthForExpansion(expansion)));
  }
  if (expansion.parentInterval === "5m" && expansion.childInterval === "1m") {
    return normalizeSlot(Math.max(1, 5 * childCandleSlotWidthForExpansion(expansion)));
  }
  return placeholderSlotWidth;
}

export function snapshotFromSemanticUnit(unit: SemanticRenderUnit): SemanticSelectionSnapshot {
  if (unit.kind !== "candle") {
    return {
      nodeId: unit.id,
      kind: unit.kind,
      symbol: unit.symbol,
      interval: unit.interval,
      from: unit.from,
      to: unit.to,
      depth: unit.depth,
      status: unit.status
    };
  }
  return {
    nodeId: unit.id,
    kind: unit.kind,
    symbol: unit.symbol,
    interval: unit.interval,
    timestamp: unit.timestamp,
    from: unit.from,
    to: unit.to,
    depth: unit.depth,
    open: unit.candle.open,
    high: unit.candle.high,
    low: unit.candle.low,
    close: unit.candle.close,
    volume: unit.candle.volume,
    isClosed: unit.candle.isClosed
  };
}

export function formatSemanticTimestamp(value: string, interval: DigTargetInterval): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const options: Intl.DateTimeFormatOptions = interval === "1M"
    ? { month: "short", year: "numeric" }
    : interval === "1W" || interval === "1D"
      ? { month: "short", day: "2-digit" }
      : { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function parseIso(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function addInterval(date: Date, interval: ChartInterval): Date {
  const next = new Date(date.getTime());
  switch (interval) {
    case "footprint":
    case "1m":
      next.setUTCMinutes(next.getUTCMinutes() + 1);
      return next;
    case "5m":
      next.setUTCMinutes(next.getUTCMinutes() + 5);
      return next;
    case "10m":
      next.setUTCMinutes(next.getUTCMinutes() + 10);
      return next;
    case "1D":
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case "1W":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "1M":
      return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1));
  }
}

function floorInterval(date: Date, interval: ChartInterval): Date {
  const next = new Date(date.getTime());
  next.setUTCSeconds(0, 0);
  switch (interval) {
    case "footprint":
    case "1m":
      return next;
    case "5m":
      next.setUTCMinutes(Math.floor(next.getUTCMinutes() / 5) * 5);
      return next;
    case "10m":
      next.setUTCMinutes(Math.floor(next.getUTCMinutes() / 10) * 10);
      return next;
    case "1D":
      next.setUTCHours(0, 0, 0, 0);
      return next;
    case "1W": {
      next.setUTCHours(0, 0, 0, 0);
      const day = next.getUTCDay();
      const mondayOffset = day === 0 ? 6 : day - 1;
      next.setUTCDate(next.getUTCDate() - mondayOffset);
      return next;
    }
    case "1M":
      return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1));
  }
}

function ceilInterval(date: Date, interval: ChartInterval): Date {
  const floored = floorInterval(date, interval);
  return floored.getTime() === date.getTime() ? floored : addInterval(floored, interval);
}

function toIso(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}
