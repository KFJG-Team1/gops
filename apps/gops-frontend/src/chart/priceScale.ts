const minimumDegeneratePriceSpan = 0.01;
const minimumTickStep = 1e-8;

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
  let topPx = clampNumber(safeHeight * 0.075, 18, 44);
  let bottomPx = clampNumber(safeHeight * 0.085, 22, 50);
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
  const safeTickCount = Math.max(2, Math.round(tickCount));
  const tickStep = (safeDomainMax - safeDomainMin) / (safeTickCount - 1);
  const ticks = Array.from({ length: safeTickCount }, (_, index) => (
    index === 0
      ? safeDomainMin
      : index === safeTickCount - 1
        ? safeDomainMax
        : safeDomainMin + tickStep * index
  ));
  return {
    dataMin,
    dataMax,
    domainMin: safeDomainMin,
    domainMax: safeDomainMax,
    tickCount: safeTickCount,
    tickStep,
    ticks,
    // Standard price labels use two decimals. Bid/Ask raises this from its
    // source bin precision instead of the non-terminating display tick step.
    decimalPlaces: 2
  };
}

function isPositiveFinitePrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
