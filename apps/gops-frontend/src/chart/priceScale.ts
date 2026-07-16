const minimumDegeneratePriceSpan = 0.01;
const minimumTickStep = 1e-8;
const maximumTickStepSearchIterations = 64;
const niceStepMultipliers = [1, 2, 2.5, 5] as const;

export type PriceScaleResult = {
  dataMin: number;
  dataMax: number;
  domainMin: number;
  domainMax: number;
  tickCount: number;
  tickStep: number;
  ticks: number[];
  decimalPlaces: number;
};

export type PriceScaleHeadroom = {
  topPx: number;
  bottomPx: number;
};

export function priceTickCountForHeight(pricePaneHeight: number): number {
  const safeHeight = Number.isFinite(pricePaneHeight) ? Math.max(0, pricePaneHeight) : 0;
  return clampNumber(Math.floor((safeHeight - 24) / 64) + 1, 4, 10);
}

export function priceScaleHeadroom(pricePaneHeight: number): PriceScaleHeadroom {
  const safeHeight = Number.isFinite(pricePaneHeight) ? Math.max(1, pricePaneHeight) : 1;
  let topPx = clampNumber(safeHeight * 0.06, 14, 28);
  let bottomPx = clampNumber(safeHeight * 0.07, 16, 30);
  const available = Math.max(0, safeHeight - 1);
  const requested = topPx + bottomPx;
  if (requested > available && requested > 0) {
    const ratio = available / requested;
    topPx *= ratio;
    bottomPx *= ratio;
  }
  return { topPx, bottomPx };
}

export function resolvePriceScale(
  sourceValues: Array<number | null | undefined>,
  pricePaneHeight: number
): PriceScaleResult {
  const values = sourceValues.filter(isPositiveFinitePrice);
  const safeHeight = Number.isFinite(pricePaneHeight) ? Math.max(1, pricePaneHeight) : 1;
  const tickCount = priceTickCountForHeight(safeHeight);
  if (!values.length) {
    return priceScaleForDomain(0, 4, 0, 4, tickCount);
  }

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  let extentMin = dataMin;
  let extentMax = dataMax;
  if (extentMax <= extentMin) {
    const span = Math.max(Math.abs(extentMax) * 0.01, minimumDegeneratePriceSpan);
    extentMin = Math.max(0, extentMin - span / 2);
    extentMax += span / 2;
  }

  const { topPx, bottomPx } = priceScaleHeadroom(safeHeight);
  const contentHeight = Math.max(1, safeHeight - topPx - bottomPx);
  const pricePerPixel = Math.max(minimumTickStep, (extentMax - extentMin) / contentHeight);
  const domainMin = Math.max(0, extentMin - bottomPx * pricePerPixel);
  const domainMax = Math.max(domainMin + minimumTickStep, extentMax + topPx * pricePerPixel);
  return priceScaleForDomain(dataMin, dataMax, domainMin, domainMax, tickCount);
}

export function decimalPlacesForPriceStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 2;
  }
  for (let places = 0; places <= 8; places += 1) {
    if (Math.abs(step * 10 ** places - Math.round(step * 10 ** places)) < 1e-8) {
      return places;
    }
  }
  return 8;
}

function priceScaleForDomain(
  dataMin: number,
  dataMax: number,
  domainMin: number,
  domainMax: number,
  tickCount: number
): PriceScaleResult {
  const safeDomainMin = Math.max(0, Number.isFinite(domainMin) ? domainMin : 0);
  const safeDomainMax = Math.max(
    safeDomainMin + minimumTickStep,
    Number.isFinite(domainMax) ? domainMax : safeDomainMin + 4
  );
  const tickGrid = fixedNiceTicks(safeDomainMin, safeDomainMax, tickCount);
  return {
    dataMin,
    dataMax,
    domainMin: safeDomainMin,
    domainMax: safeDomainMax,
    tickCount,
    tickStep: tickGrid.step,
    ticks: tickGrid.ticks,
    decimalPlaces: decimalPlacesForPriceStep(tickGrid.step)
  };
}

function fixedNiceTicks(domainMin: number, domainMax: number, tickCount: number): { step: number; ticks: number[] } {
  const safeTickCount = Math.max(2, Math.round(tickCount));
  const span = Math.max(minimumTickStep, domainMax - domainMin);
  let step = niceStepFloor(span / Math.max(1, safeTickCount - 1));
  let bounds = tickIndexBounds(domainMin, domainMax, step);
  for (let iteration = 0; bounds.count < safeTickCount && iteration < maximumTickStepSearchIterations; iteration += 1) {
    step = niceStepFloor(step * (1 - 1e-10));
    bounds = tickIndexBounds(domainMin, domainMax, step);
  }

  const lastStartIndex = Math.max(bounds.first, bounds.last - safeTickCount + 1);
  const centeredStartIndex = Math.round(((domainMin + domainMax) / 2) / step - (safeTickCount - 1) / 2);
  const startIndex = clampNumber(centeredStartIndex, bounds.first, lastStartIndex);
  const decimalPlaces = decimalPlacesForPriceStep(step);
  const ticks = Array.from({ length: safeTickCount }, (_, index) => (
    Number(((startIndex + index) * step).toFixed(decimalPlaces))
  ));
  return { step, ticks };
}

function tickIndexBounds(domainMin: number, domainMax: number, step: number): { first: number; last: number; count: number } {
  const epsilon = Math.max(minimumTickStep, Math.abs(step)) * 1e-7;
  const first = Math.max(0, Math.ceil((domainMin - epsilon) / step));
  const last = Math.max(first, Math.floor((domainMax + epsilon) / step));
  return { first, last, count: last - first + 1 };
}

function niceStepFloor(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= minimumTickStep) {
    return minimumTickStep;
  }
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  let multiplier: number = niceStepMultipliers[0];
  for (const candidate of niceStepMultipliers) {
    if (candidate <= normalized + 1e-12) {
      multiplier = candidate;
    }
  }
  return Math.max(minimumTickStep, multiplier * magnitude);
}

function isPositiveFinitePrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
