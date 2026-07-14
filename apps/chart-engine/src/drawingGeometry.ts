import type { ChartLineExtension } from "./types";

export type DrawingPoint = { x: number; y: number };
export type DrawingLine = [DrawingPoint, DrawingPoint];

export const fibonacciRetracementLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export type RiskRewardDirection = "long" | "short";

export type RiskRewardGeometry = {
  direction: RiskRewardDirection;
  left: number;
  right: number;
  entryY: number;
  stopY: number;
  targetY: number;
  riskPolygon: DrawingPoint[];
  rewardPolygon: DrawingPoint[];
};

export type TradePlanGeometry = RiskRewardGeometry & {
  targetOneY: number;
  targetTwoY: number;
};

export type FibonacciLevelGeometry = {
  level: number;
  y: number;
  line: DrawingLine;
};

export type PlotBounds = {
  left: number;
  right: number;
  top: number;
  priceBottom: number;
};

export function normalizeLineExtension(extension: unknown): ChartLineExtension {
  return extension === "ray" || extension === "line" ? extension : "segment";
}

export function projectTrendLine(
  start: DrawingPoint,
  end: DrawingPoint,
  plot: PlotBounds,
  extension: ChartLineExtension = "segment"
): [DrawingPoint, DrawingPoint] {
  if (extension === "segment") {
    return [start, end];
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return [start, end];
  }

  const candidates = linePlotIntersections(start, dx, dy, plot);
  if (candidates.length === 0) {
    return [start, end];
  }

  if (extension === "ray") {
    const forward = candidates.filter((candidate) => candidate.t >= 0).sort((left, right) => left.t - right.t);
    const far = forward[forward.length - 1];
    return far ? [start, far.point] : [start, end];
  }

  const sorted = candidates.sort((left, right) => left.t - right.t);
  return [sorted[0].point, sorted[sorted.length - 1].point];
}

export function normalizeParallelLineCount(value: unknown, fallback = 3): number {
  return Math.max(2, Math.min(10, Math.round(typeof value === "number" && Number.isFinite(value) ? value : fallback)));
}

export function trendParallelOffsets(lineCount: number): number[] {
  const count = normalizeParallelLineCount(lineCount);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return 0;
    }
    const magnitude = Math.ceil(index / 2);
    return index % 2 === 1 ? magnitude : -magnitude;
  });
}

export function spatialTrendParallelOffsets(lineCount: number): number[] {
  return trendParallelOffsets(lineCount).slice().sort((left, right) => left - right);
}

export function trendParallelBaseLineIndex(lineCount: number): number {
  return spatialTrendParallelOffsets(lineCount).indexOf(0);
}

export function buildTrendParallelLines(
  baseStart: DrawingPoint,
  baseEnd: DrawingPoint,
  spacingPoint: DrawingPoint,
  plot: PlotBounds,
  lineCount: number
): DrawingLine[] {
  const dx = baseEnd.x - baseStart.x;
  const dy = baseEnd.y - baseStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) {
    return [];
  }
  const normal = { x: -dy / length, y: dx / length };
  const spacing = (spacingPoint.x - baseStart.x) * normal.x + (spacingPoint.y - baseStart.y) * normal.y;
  return spatialTrendParallelOffsets(lineCount).map((offset) => {
    const start = {
      x: baseStart.x + normal.x * spacing * offset,
      y: baseStart.y + normal.y * spacing * offset
    };
    return projectTrendLine(start, { x: start.x + dx, y: start.y + dy }, plot, "line");
  });
}

export function riskRewardDirection(
  entryPrice: number,
  stopPrice: number,
  targetPrice: number
): RiskRewardDirection | null {
  if (![entryPrice, stopPrice, targetPrice].every(Number.isFinite)) {
    return null;
  }
  if (stopPrice < entryPrice && targetPrice > entryPrice) {
    return "long";
  }
  if (stopPrice > entryPrice && targetPrice < entryPrice) {
    return "short";
  }
  return null;
}

export function tradePlanDirection(
  entryPrice: number,
  stopPrice: number,
  targetOnePrice: number,
  targetTwoPrice: number
): RiskRewardDirection | null {
  const direction = riskRewardDirection(entryPrice, stopPrice, targetTwoPrice);
  if (direction === "long" && entryPrice < targetOnePrice && targetOnePrice < targetTwoPrice) {
    return direction;
  }
  if (direction === "short" && targetTwoPrice < targetOnePrice && targetOnePrice < entryPrice) {
    return direction;
  }
  return null;
}

export function buildRiskRewardGeometry(
  entry: DrawingPoint,
  stop: DrawingPoint,
  target: DrawingPoint,
  direction: RiskRewardDirection
): RiskRewardGeometry {
  const left = Math.min(entry.x, stop.x);
  const right = Math.max(entry.x, stop.x);
  const rectangle = (firstY: number, secondY: number): DrawingPoint[] => [
    { x: left, y: Math.min(firstY, secondY) },
    { x: right, y: Math.min(firstY, secondY) },
    { x: right, y: Math.max(firstY, secondY) },
    { x: left, y: Math.max(firstY, secondY) }
  ];
  return {
    direction,
    left,
    right,
    entryY: entry.y,
    stopY: stop.y,
    targetY: target.y,
    riskPolygon: rectangle(entry.y, stop.y),
    rewardPolygon: rectangle(entry.y, target.y)
  };
}

export function buildTradePlanGeometry(
  entry: DrawingPoint,
  stop: DrawingPoint,
  targetOne: DrawingPoint,
  targetTwo: DrawingPoint,
  direction: RiskRewardDirection
): TradePlanGeometry {
  const base = buildRiskRewardGeometry(entry, stop, targetTwo, direction);
  return {
    ...base,
    targetOneY: targetOne.y,
    targetTwoY: targetTwo.y
  };
}

export function buildFibonacciLevelGeometry(
  first: DrawingPoint,
  second: DrawingPoint
): FibonacciLevelGeometry[] {
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  return fibonacciRetracementLevels.map((level) => {
    const y = first.y + (second.y - first.y) * level;
    return { level, y, line: [{ x: left, y }, { x: right, y }] };
  });
}

export function fibonacciBandPolygons(levels: FibonacciLevelGeometry[]): DrawingPoint[][] {
  return levels.slice(0, -1).map((level, index) => {
    const next = levels[index + 1];
    return [level.line[0], level.line[1], next.line[1], next.line[0]];
  });
}

export function buildHorizontalParallelLines(first: DrawingPoint, second: DrawingPoint, plot: PlotBounds): DrawingLine[] {
  return [first.y, second.y].map((y) => [{ x: plot.left, y }, { x: plot.right, y }]);
}

export function buildVerticalParallelLines(first: DrawingPoint, second: DrawingPoint, plot: PlotBounds): DrawingLine[] {
  return [first.x, second.x].map((x) => [{ x, y: plot.top }, { x, y: plot.priceBottom }]);
}

export function parallelBandPolygons(lines: DrawingLine[], plot: PlotBounds): DrawingPoint[][] {
  const plotPolygon: DrawingPoint[] = [
    { x: plot.left, y: plot.top },
    { x: plot.right, y: plot.top },
    { x: plot.right, y: plot.priceBottom },
    { x: plot.left, y: plot.priceBottom }
  ];

  return lines.slice(0, -1).flatMap((line, index) => {
    const next = lines[index + 1];
    const direction = lineDirection(line) ?? lineDirection(next);
    if (!direction) {
      return [];
    }

    const normal = { x: -direction.y, y: direction.x };
    const firstOffset = dot(normal, line[0]);
    const secondOffset = dot(normal, next[0]);
    const minimumOffset = Math.min(firstOffset, secondOffset);
    const maximumOffset = Math.max(firstOffset, secondOffset);
    if (maximumOffset - minimumOffset < 0.000001) {
      return [];
    }

    const clippedToMinimum = clipPolygonToHalfPlane(plotPolygon, normal, minimumOffset, "at-least");
    const band = clipPolygonToHalfPlane(clippedToMinimum, normal, maximumOffset, "at-most");
    return band.length >= 3 && Math.abs(polygonArea(band)) >= 0.000001 ? [band] : [];
  });
}

function lineDirection(line: DrawingLine): DrawingPoint | null {
  const dx = line[1].x - line[0].x;
  const dy = line[1].y - line[0].y;
  const length = Math.hypot(dx, dy);
  return length >= 0.000001 ? { x: dx / length, y: dy / length } : null;
}

function clipPolygonToHalfPlane(
  polygon: DrawingPoint[],
  normal: DrawingPoint,
  boundaryOffset: number,
  side: "at-least" | "at-most"
): DrawingPoint[] {
  if (polygon.length === 0) {
    return [];
  }

  const inside = (value: number) => side === "at-least"
    ? value >= boundaryOffset - 0.000001
    : value <= boundaryOffset + 0.000001;
  const output: DrawingPoint[] = [];
  let previous = polygon[polygon.length - 1];
  let previousValue = dot(normal, previous);
  let previousInside = inside(previousValue);

  polygon.forEach((current) => {
    const currentValue = dot(normal, current);
    const currentInside = inside(currentValue);
    if (currentInside !== previousInside) {
      const denominator = currentValue - previousValue;
      if (Math.abs(denominator) >= 0.000001) {
        const ratio = (boundaryOffset - previousValue) / denominator;
        output.push({
          x: previous.x + (current.x - previous.x) * ratio,
          y: previous.y + (current.y - previous.y) * ratio
        });
      }
    }
    if (currentInside) {
      output.push(current);
    }
    previous = current;
    previousValue = currentValue;
    previousInside = currentInside;
  });

  return deduplicatePolygon(output);
}

function deduplicatePolygon(polygon: DrawingPoint[]): DrawingPoint[] {
  const result = polygon.filter((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    return Math.abs(point.x - previous.x) >= 0.000001 || Math.abs(point.y - previous.y) >= 0.000001;
  });
  if (
    result.length > 1 &&
    Math.abs(result[0].x - result[result.length - 1].x) < 0.000001 &&
    Math.abs(result[0].y - result[result.length - 1].y) < 0.000001
  ) {
    result.pop();
  }
  return result;
}

function dot(left: DrawingPoint, right: DrawingPoint): number {
  return left.x * right.x + left.y * right.y;
}

function polygonArea(polygon: DrawingPoint[]): number {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function linePlotIntersections(
  start: DrawingPoint,
  dx: number,
  dy: number,
  plot: PlotBounds
): Array<{ t: number; point: DrawingPoint }> {
  const candidates: Array<{ t: number; point: DrawingPoint }> = [];
  const addCandidate = (t: number, point: DrawingPoint) => {
    if (
      Number.isFinite(t) &&
      point.x >= plot.left - 0.5 &&
      point.x <= plot.right + 0.5 &&
      point.y >= plot.top - 0.5 &&
      point.y <= plot.priceBottom + 0.5 &&
      !candidates.some((candidate) => Math.abs(candidate.point.x - point.x) < 0.5 && Math.abs(candidate.point.y - point.y) < 0.5)
    ) {
      candidates.push({ t, point });
    }
  };

  if (dx !== 0) {
    const leftT = (plot.left - start.x) / dx;
    addCandidate(leftT, { x: plot.left, y: start.y + leftT * dy });
    const rightT = (plot.right - start.x) / dx;
    addCandidate(rightT, { x: plot.right, y: start.y + rightT * dy });
  }

  if (dy !== 0) {
    const topT = (plot.top - start.y) / dy;
    addCandidate(topT, { x: start.x + topT * dx, y: plot.top });
    const bottomT = (plot.priceBottom - start.y) / dy;
    addCandidate(bottomT, { x: start.x + bottomT * dx, y: plot.priceBottom });
  }

  return candidates;
}
