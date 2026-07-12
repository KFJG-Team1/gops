import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const fixtureSessionDate = "2026-07-08";
let omittedCandleIndex: number | null = null;
let omittedOrderFlowMinute: number | null = null;
let alignBidAskFixtures = false;
let partialThenReadyCandles = false;
let candleRequestCount = 0;

test.beforeEach(async ({ page }) => {
  omittedCandleIndex = null;
  omittedOrderFlowMinute = null;
  alignBidAskFixtures = false;
  partialThenReadyCandles = false;
  candleRequestCount = 0;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillFixtureApi(route));
});

test("chart modes and bidask intervals remain visually stable", async ({ page }) => {
  alignBidAskFixtures = true;
  let intradayRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/charts/order-flow/intraday") {
      intradayRequestCount += 1;
    }
  });
  await openFixtureLayout(page, chartOnlyLayout());
  const panel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  const chartPanel = page.locator(".chart-panel");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", /^[1-9]\d*$/);
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expectLatestQuarterGap(chartPanel);

  await expect(panel).toHaveScreenshot("chart-candle.png");
  await page.getByLabel("Chart type").selectOption("line", { force: true });
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expect(panel).toHaveScreenshot("chart-line.png");

  await page.getByLabel("Chart type").selectOption("ohlc", { force: true });
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expect(panel).toHaveScreenshot("chart-ohlc.png");

  await page.getByLabel("Chart type").selectOption("bidask", { force: true });
  for (const interval of ["1m", "10m", "1h"] as const) {
    await page.getByLabel("Interval").selectOption(interval, { force: true });
    await expect(page.locator(".chart-panel")).toHaveAttribute("data-order-flow-status", "ready");
    await expect(page.locator(".chart-panel")).toHaveAttribute("data-order-flow-minute-count", /^[1-9]\d*$/);
    await expect(page.locator(".chart-canvas")).toHaveAttribute("data-order-flow-minute-count", /^[1-9]\d*$/);
    await expectLatestQuarterGap(chartPanel);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expectNonBlankCanvas(page.locator(".chart-canvas"));
    await expect(panel).toHaveScreenshot(`chart-bidask-${interval}.png`);
  }
  expect(intradayRequestCount).toBe(1);
});

test("partial retry locks zoom and keeps the latest quarter gap", async ({ page }) => {
  partialThenReadyCandles = true;
  await openFixtureLayout(page, chartOnlyLayout());
  const chartPanel = page.locator(".chart-panel");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "3");
  await expectLatestQuarterGap(chartPanel);
  const firstVisibleCount = await chartPanel.getAttribute("data-chart-visible-count");
  const firstRightOffset = await chartPanel.getAttribute("data-chart-right-offset");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "140", { timeout: 10_000 });
  await expect(chartPanel).toHaveAttribute("data-chart-visible-count", firstVisibleCount ?? "6");
  await expect(chartPanel).toHaveAttribute("data-chart-right-offset", firstRightOffset ?? "-1");
  await expectLatestQuarterGap(chartPanel);
  await expectNonBlankCanvas(chartPanel.locator(".chart-canvas"));
});

test("fixed and optional derived layers preserve chart geometry", async ({ page }) => {
  await openFixtureLayout(page, chartOnlyLayout());
  await page.getByRole("button", { name: "차트 추가 도구 열기" }).click({ force: true });
  await page.getByTitle("EMA 20").click({ force: true });
  await page.getByTitle("Volume Profile").click({ force: true });
  await page.getByTitle("RSI 14").click({ force: true });
  await page.getByRole("toolbar", { name: "Chart add tools" }).getByLabel("차트 추가 도구 닫기").evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const panel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expect(panel).toHaveScreenshot("chart-derived-layers.png");
});

test("SMA120 overlay requests derived points and remains renderable", async ({ page }) => {
  const requestedLayers: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/charts/indicators") {
      requestedLayers.push(url.searchParams.get("layers") ?? "");
    }
  });

  await openFixtureLayout(page, chartOnlyLayout());
  await page.getByRole("button", { name: "차트 추가 도구 열기" }).click({ force: true });
  await page.getByTitle("SMA 120").click({ force: true });

  await expect.poll(() => requestedLayers.some((layers) => layers.split(",").includes("sma:120"))).toBe(true);
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
});

test("bidask wheel zoom keeps one visual grammar and skips viewport history", async ({ page }) => {
  alignBidAskFixtures = true;
  await openFixtureLayout(page, chartOnlyLayout());
  await page.getByLabel("Chart type").selectOption("bidask", { force: true });
  await page.getByLabel("Interval").selectOption("1m", { force: true });
  const chartPanel = page.locator(".chart-panel");
  const canvas = chartPanel.locator(".chart-canvas");
  await expect(chartPanel).toHaveAttribute("data-order-flow-status", "ready");
  await page.waitForTimeout(250);
  const initialVisibleCount = Number(await chartPanel.getAttribute("data-chart-visible-count"));
  const initialHistoryCount = await chartPanel.getAttribute("data-chart-history-count");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("Bid/Ask canvas geometry is unavailable");
  }
  await dispatchWheelBurst(canvas, 6, 0.55);
  await expect.poll(async () => Number(await chartPanel.getAttribute("data-chart-visible-count"))).toBeLessThan(initialVisibleCount);
  await expect(chartPanel).toHaveAttribute("data-chart-history-count", initialHistoryCount ?? "0");
  await expectNonBlankCanvas(canvas);
  await expect(chartPanel).toHaveScreenshot("chart-bidask-zoomed.png");
});

test("bidask missing minutes retain candles and unknown delta", async ({ page }) => {
  alignBidAskFixtures = true;
  omittedCandleIndex = 82;
  omittedOrderFlowMinute = 88;
  await openFixtureLayout(page, chartOnlyLayout());
  await page.getByLabel("Chart type").selectOption("bidask", { force: true });
  await page.getByLabel("Interval").selectOption("1m", { force: true });
  const chartPanel = page.locator(".chart-panel");
  await expect(chartPanel).toHaveAttribute("data-order-flow-status", "ready");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "139");
  await expect(chartPanel).toHaveAttribute("data-order-flow-minute-count", "389");
  const canvas = chartPanel.locator(".chart-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("Bid/Ask missing-minute canvas geometry is unavailable");
  }
  await dispatchWheelBurst(canvas, 5, 0.52);
  await expect.poll(async () => Number(await chartPanel.getAttribute("data-chart-visible-count"))).toBeLessThan(120);
  await page.waitForTimeout(250);
  await expectNonBlankCanvas(canvas);
  await expect(chartPanel).toHaveScreenshot("chart-bidask-missing-minutes.png");
});

test("tiled chart, compare, and order-flow panels do not overlap workspace chrome", async ({ page }) => {
  await openFixtureLayout(page, tiledDataLayout());
  await expect(page.locator(".chart-panel")).toHaveAttribute("data-chart-candle-count", /^[1-9]\d*$/);
  await expect(page.locator(".order-flow-panel")).toHaveAttribute("data-order-flow-status", "ready");
  await expect(page.locator(".chart-compare-panel")).toHaveAttribute("data-compare-status", "ready");
  await expect(page.locator(".chart-compare-line")).toHaveCount(2);
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expectNonBlankCanvas(page.locator(".order-flow-canvas"));
  await expect(page.locator(".chart-compare-panel")).toBeVisible();
  await assertWorkspaceChromeDoesNotOverlap(page);
  await expect(page.locator(".app-shell")).toHaveScreenshot("workspace-chart-compare-orderflow.png");
});

test("layout edit hides the command bar and exposes chart asset panels", async ({ page }) => {
  await openFixtureLayout(page, chartOnlyLayout());
  await page.getByRole("button", { name: "레이아웃 수정모드 시작" }).click();

  await expect(page.locator(".workspace-bottom-nav")).toHaveCount(0);
  await expect(page.locator(".layout-palette-dock")).toBeVisible();
  await expect(page.getByRole("button", { name: "레이아웃 수정모드 종료" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "차트 해설" })).toBeVisible();
  await expect(page.getByRole("button", { name: "작도 자산(개발)" })).toBeVisible();
});

test("order-flow panels stay intraday-only and keep the lower canvas wheelable", async ({ page }) => {
  let dailyRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/charts/order-flow/daily") {
      dailyRequestCount += 1;
    }
  });
  await openFixtureLayout(page, orderFlowInteractionLayout());

  const firstPanel = page.locator('[data-panel-id="slot-orderFlow-2"]');
  const secondPanel = page.locator('[data-panel-id="slot-orderFlow-3"]');
  await expectNonBlankCanvas(firstPanel.locator(".order-flow-canvas"));
  await expectNonBlankCanvas(secondPanel.locator(".order-flow-canvas"));
  await expect(firstPanel).toHaveAttribute("data-order-flow-symbol", "NVDA");
  await expect(secondPanel).toHaveAttribute("data-order-flow-symbol", "NVDA");
  await expect.poll(() => storedPanelProp(page, "content-orderFlow-2", "symbol")).toBe("NVDA");

  await firstPanel.hover();
  const controlGeometry = await firstPanel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const overlayRect = element.querySelector(".order-flow-hover-overlay")?.getBoundingClientRect();
    const buttonRects = Array.from(element.querySelectorAll(".order-flow-window-grid button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    return {
      panelHeight: panelRect.height,
      overlayHeight: overlayRect?.height ?? panelRect.height,
      buttonRects
    };
  });
  expect(controlGeometry.overlayHeight).toBeLessThan(controlGeometry.panelHeight);
  expect(controlGeometry.buttonRects).toHaveLength(4);
  expect(Math.max(...controlGeometry.buttonRects.map((rect) => rect.top)) - Math.min(...controlGeometry.buttonRects.map((rect) => rect.top))).toBeLessThan(1);

  const windowButtons = firstPanel.locator(".order-flow-window-grid button");
  expect(await windowButtons.count()).toBe(4);
  expect(await windowButtons.evaluateAll((buttons) => buttons.filter((button) => (button as HTMLButtonElement).disabled).length)).toBe(0);
  await firstPanel.getByRole("button", { name: "1h", exact: true }).click();
  await expect(firstPanel).toHaveAttribute("data-order-flow-window", "1h");
  await expect(secondPanel).toHaveAttribute("data-order-flow-window", "session");

  const panelBox = await firstPanel.boundingBox();
  const overlayBox = await firstPanel.locator(".order-flow-hover-overlay").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(overlayBox).not.toBeNull();
  if (!panelBox || !overlayBox) {
    throw new Error("Order-flow panel geometry is unavailable");
  }
  await page.mouse.move(panelBox.x + panelBox.width / 2, overlayBox.y + overlayBox.height + 12);
  await page.mouse.wheel(0, -180);
  await expect(firstPanel).not.toHaveAttribute("data-order-flow-resolution", "auto");
  await expect(secondPanel).toHaveAttribute("data-order-flow-resolution", "16");
  await expect.poll(() => storedPanelProp(page, "content-orderFlow-2", "resolution")).toEqual(expect.any(Number));

  const chartCanvas = page.locator(".chart-canvas");
  const chartBox = await chartCanvas.boundingBox();
  expect(chartBox).not.toBeNull();
  if (!chartBox) {
    throw new Error("Chart canvas geometry is unavailable");
  }
  await chartCanvas.click({ position: { x: chartBox.width * 0.6, y: chartBox.height * 0.45 } });
  await expect(page.locator(".agent-reference-chip")).toHaveCount(1);
  expect(dailyRequestCount).toBe(0);

  await firstPanel.hover();
  const symbolSearch = firstPanel.getByLabel("Symbol search");
  await symbolSearch.fill("AAPL");
  await symbolSearch.press("Enter");
  await expect(firstPanel).toHaveAttribute("data-order-flow-symbol", "AAPL");
  await expect(secondPanel).toHaveAttribute("data-order-flow-symbol", "NVDA");
  await expect.poll(() => storedPanelProp(page, "content-orderFlow-2", "symbol")).toBe("AAPL");
  await expect.poll(() => storedPanelProp(page, "content-orderFlow-3", "symbol")).toBe("NVDA");
});

async function openFixtureLayout(page: Page, layout: Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ storageKey, storedLayout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, JSON.stringify(storedLayout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { storageKey: layoutStorageKey, storedLayout: layout });
  await page.goto("/?symbol=NVDA");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await expect(page.locator(".canvas-workspace.view-chart")).toBeVisible();
  await expect(page.locator(".workspace-bottom-nav")).toBeVisible();
}

function chartOnlyLayout(): Record<string, unknown> {
  return storedLayout([
    content("chart", 1, { symbol: "NVDA", timeframe: "1m" }, "visual-chart-document")
  ], [slot("chart", 1, 1, 1, 8, 6)]);
}

function tiledDataLayout(): Record<string, unknown> {
  return storedLayout([
    content("chart", 1, { symbol: "NVDA", timeframe: "10m" }, "visual-chart-document"),
    content("orderFlow", 2, { symbol: "NVDA", window: "10m", resolution: "auto" }),
    content("compare", 3, { baseSymbol: "NVDA", symbols: ["NVDA", "AAPL"], range: "1D" })
  ], [
    slot("chart", 1, 1, 1, 6, 6),
    slot("orderFlow", 2, 7, 1, 2, 3),
    slot("compare", 3, 7, 4, 2, 3)
  ]);
}

function orderFlowInteractionLayout(): Record<string, unknown> {
  return storedLayout([
    content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "visual-chart-document"),
    content("orderFlow", 2, { window: "10m", resolution: "auto" }),
    content("orderFlow", 3, { symbol: "NVDA", window: "session", resolution: 16 })
  ], [
    slot("chart", 1, 1, 1, 4, 6),
    slot("orderFlow", 2, 5, 1, 2, 3),
    slot("orderFlow", 3, 7, 1, 2, 3)
  ]);
}

function storedLayout(contents: Array<Record<string, unknown>>, slots: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    version: 1,
    nextInstance: contents.length + 1,
    contents: Object.fromEntries(contents.map((item) => [item.id, item])),
    slots
  };
}

function content(kind: string, index: number, props: Record<string, unknown>, chartDocumentId?: string): Record<string, unknown> {
  return {
    id: `content-${kind}-${index}`,
    kind,
    title: `${kind}-${index}`,
    instanceIndex: index,
    layoutWeight: kind === "chart" ? 100 : 50,
    props,
    ...(chartDocumentId ? { chartDocumentId } : {})
  };
}

function slot(kind: string, index: number, col: number, row: number, colSpan: number, rowSpan: number): Record<string, unknown> {
  return {
    id: `slot-${kind}-${index}`,
    contentId: `content-${kind}-${index}`,
    gridRect: { col, row, colSpan, rowSpan }
  };
}

async function storedPanelProp(page: Page, contentId: string, prop: string): Promise<unknown> {
  return page.evaluate(({ key, targetContentId, targetProp }) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as { contents?: Record<string, { props?: Record<string, unknown> }> };
    return stored.contents?.[targetContentId]?.props?.[targetProp] ?? null;
  }, { key: layoutStorageKey, targetContentId: contentId, targetProp: prop });
}

async function fulfillFixtureApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  if (url.pathname === "/api/auth/me") {
    payload = { authEnabled: false, user: null };
  } else if (url.pathname === "/api/charts/symbols") {
    payload = { symbols: fixtureSymbols() };
  } else if (url.pathname === "/api/charts/candles") {
    const symbol = url.searchParams.get("symbol") ?? "NVDA";
    const interval = url.searchParams.get("interval") ?? "1m";
    const fullPayload = candlePayload(symbol, interval);
    if (partialThenReadyCandles && candleRequestCount === 0) {
      const candles = (fullPayload.candles as Array<Record<string, unknown>>).slice(-3);
      payload = {
        ...fullPayload,
        request: { limit: 120 },
        status: "partial",
        dataStatus: "partial",
        candles,
        requestedLimit: 120,
        returnedCount: candles.length,
        fill: { status: "partial", renderable: true, backgroundFill: { state: "queued" } }
      };
    } else {
      payload = fullPayload;
    }
    candleRequestCount += 1;
  } else if (url.pathname === "/api/charts/indicators") {
    payload = indicatorPayload(url);
  } else if (url.pathname === "/api/charts/volume-profile-bins") {
    payload = volumeProfilePayload(url);
  } else if (url.pathname === "/api/charts/compare") {
    payload = comparePayload(url);
  } else if (url.pathname === "/api/charts/order-flow/symbols") {
    payload = { symbols: ["NVDA", "AAPL"], priceBinSize: 0.01 };
  } else if (url.pathname === "/api/charts/order-flow/intraday") {
    payload = orderFlowIntradayPayload(url.searchParams.get("symbol") ?? "NVDA");
  } else if (url.pathname === "/api/charts/order-flow/daily") {
    payload = orderFlowDailyPayload(url.searchParams.get("symbol") ?? "NVDA");
  } else if (url.pathname === "/api/watchlist") {
    payload = { symbols: [] };
  } else if (url.pathname === "/api/market/heatmap") {
    payload = { items: [] };
  }
  await route.fulfill({
    status: request.method() === "DELETE" ? 204 : 200,
    contentType: "application/json",
    body: request.method() === "DELETE" ? "" : JSON.stringify(payload)
  });
}

function candlePayload(symbol: string, interval: string): Record<string, unknown> {
  const candles = fixtureCandles(interval);
  return {
    symbol: symbol.toUpperCase(),
    interval,
    request: { limit: candles.length },
    status: "ready",
    dataStatus: "ready",
    source: "fixture",
    feed: "sip",
    candles,
    indicators: { ma: [5, 20, 60], volume: true },
    requestedLimit: candles.length,
    returnedCount: candles.length,
    hasMoreBefore: false,
    hasMoreAfter: false,
    fill: { status: "not_needed", renderable: true }
  };
}

function fixtureCandles(interval: string): Array<Record<string, unknown>> {
  const stepMinutes = ({ "1m": 1, "5m": 5, "10m": 10, "1h": 60, "4h": 240, "1D": 1440, "1W": 10080, "1M": 43200 } as Record<string, number>)[interval] ?? 1;
  const count = alignBidAskFixtures && interval === "1h" ? 7 : interval === "1h" ? 28 : interval === "10m" ? 78 : 140;
  const start = Date.parse("2026-07-08T13:30:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const elapsedMinute = index * stepMinutes;
    const minutePrice = (minute: number) => 150 + minute * 0.08 + Math.sin(minute / 5) * 2.4;
    const alignedInterval = alignBidAskFixtures && (interval === "1m" || interval === "10m" || interval === "1h");
    const center = alignedInterval
      ? minutePrice(elapsedMinute)
      : 150 + index * 0.08 + Math.sin(index / 5) * 2.4;
    const end = alignedInterval
      ? minutePrice(elapsedMinute + stepMinutes - 1)
      : center;
    const open = center - Math.sin(index / 3) * 0.55;
    const close = end + Math.cos(index / 4) * 0.62;
    const sampled = alignedInterval
      ? Array.from({ length: stepMinutes }, (_, offset) => minutePrice(elapsedMinute + offset))
      : [center];
    return {
      timestamp: new Date(start + index * stepMinutes * 60_000).toISOString(),
      open,
      high: Math.max(open, close, ...sampled) + 0.8,
      low: Math.min(open, close, ...sampled) - 0.75,
      close,
      volume: 600_000 + (index % 13) * 75_000,
      isClosed: true,
      ...(alignedInterval ? { marketSession: elapsedMinute < 390 ? "regular" : "after" } : {}),
      ma5: center - 0.2,
      ma20: center - 0.65,
      ma60: center - 1.25
    };
  }).filter((_candle, index) => interval !== "1m" || index !== omittedCandleIndex);
}

function indicatorPayload(url: URL): Record<string, unknown> {
  const interval = url.searchParams.get("interval") ?? "1m";
  const candles = fixtureCandles(interval);
  const layerIds = (url.searchParams.get("layers") ?? "ema:20").split(",").filter(Boolean);
  const series = Object.fromEntries(layerIds.map((id) => [id, candles.map((candle, index) => {
    const timestamp = String(candle.timestamp);
    const close = Number(candle.close);
    if (id.startsWith("bollinger")) {
      return { timestamp, middle: close, upper: close + 2, lower: close - 2 };
    }
    if (id.startsWith("stochastic")) {
      return { timestamp, k: 45 + Math.sin(index / 4) * 20, d: 50 + Math.cos(index / 5) * 15 };
    }
    if (id.startsWith("macd")) {
      return { timestamp, macd: Math.sin(index / 5), signal: Math.cos(index / 6), histogram: Math.sin(index / 5) - Math.cos(index / 6) };
    }
    return { timestamp, value: id.startsWith("rsi") ? 50 + Math.sin(index / 6) * 22 : close - 0.35 };
  })]));
  return {
    symbol: "NVDA",
    interval,
    calculationVersion: "fixture-v1",
    dataStatus: "ready",
    series,
    indicators: layerIds.map((id) => ({ id, kind: id.split(":")[0], placement: ["rsi", "stochastic", "macd"].some((name) => id.startsWith(name)) ? "below" : "overlay", parameters: {}, points: series[id] })),
    derived: { state: "ready", source: "redis", requestHash: "fixture-indicators" }
  };
}

function volumeProfilePayload(url: URL): Record<string, unknown> {
  const priceMin = Number(url.searchParams.get("priceMin") ?? 145);
  const priceMax = Number(url.searchParams.get("priceMax") ?? 165);
  const count = 10;
  const width = (priceMax - priceMin) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    index,
    priceBin: priceMin + (index + 0.5) * width,
    priceBinSize: width,
    priceMin: priceMin + index * width,
    priceMax: priceMin + (index + 1) * width,
    priceMid: priceMin + (index + 0.5) * width,
    volume: 1000 + (index <= 5 ? index : 10 - index) * 450,
    tradeCount: 20 + index,
    volumePercent: 0.05 + index * 0.01,
    isPoc: index === 5,
    inValueArea: index >= 3 && index <= 7
  }));
  return {
    symbol: "NVDA",
    interval: url.searchParams.get("interval") ?? "1m",
    sourceInterval: url.searchParams.get("interval") ?? "1m",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    timeBucket: url.searchParams.get("interval") ?? "1m",
    targetBins: count,
    bucketCount: count,
    priceBinSize: width,
    sourceBinCount: count,
    source: "fixture",
    feed: "sip",
    calculationVersion: "fixture-v1",
    sideClassification: "estimated",
    dataStatus: "ready",
    priceRange: { min: priceMin, max: priceMax, requestedMin: priceMin, requestedMax: priceMax },
    totalVolume: bins.reduce((sum, bin) => sum + bin.volume, 0),
    totalTradeCount: bins.reduce((sum, bin) => sum + bin.tradeCount, 0),
    bins,
    derived: { state: "ready", source: "redis", requestHash: "fixture-vp" }
  };
}

function comparePayload(url: URL): Record<string, unknown> {
  const symbols = (url.searchParams.get("symbols") ?? "NVDA,AAPL").split(",");
  const colors = ["#0052ff", "#05b169", "#cf202f"];
  return {
    range: url.searchParams.get("range") ?? "1D",
    timeframe: "1Min",
    baseMode: "first_close",
    session: "regular",
    adjustment: "split",
    asOf: "2026-07-08T20:00:00.000Z",
    warnings: [],
    items: symbols.map((symbol, symbolIndex) => ({
      symbol,
      companyName: symbol === "NVDA" ? "NVIDIA" : "Apple",
      color: colors[symbolIndex % colors.length],
      points: Array.from({ length: 60 }, (_, index) => ({
        time: new Date(Date.parse("2026-07-08T13:30:00.000Z") + index * 60_000).toISOString(),
        price: 150 + symbolIndex * 20 + index * 0.08,
        returnPercent: Math.sin(index / 8 + symbolIndex) * 2 + index * 0.025
      }))
    }))
  };
}

function orderFlowIntradayPayload(symbol: string): Record<string, unknown> {
  const start = Date.parse(`${fixtureSessionDate}T13:30:00.000Z`);
  return {
    symbol: symbol.toUpperCase(),
    sessionDate: fixtureSessionDate,
    priceBinSize: 0.01,
    dataStatus: "ready",
    supportedSymbols: ["NVDA", "AAPL"],
    liveQuote: { bidPrice: 159.98, askPrice: 160.02, bidSize: 12, askSize: 10, timestamp: "2026-07-08T19:59:59.000Z" },
    minutes: Array.from({ length: 390 }, (_, minute) => ({
      eventMinute: new Date(start + minute * 60_000).toISOString(),
      bins: Array.from({ length: 9 }, (_, level) => ({
        priceBin: alignBidAskFixtures
          ? 150 + minute * 0.08 + Math.sin(minute / 5) * 2.4 + (level - 4) * 0.05
          : 156 + minute * 0.01 + level * 0.05,
        askVolume: 20 + ((minute + level * 3) % 35),
        bidVolume: 18 + ((minute * 2 + level) % 31),
        unknownVolume: (minute + level) % 4,
        askTradeCount: 2 + (level % 4),
        bidTradeCount: 2 + ((level + 1) % 4)
      }))
    })).filter((_minute, minute) => minute !== omittedOrderFlowMinute)
  };
}

function orderFlowDailyPayload(symbol: string): Record<string, unknown> {
  const levels = Array.from({ length: 20 }, (_, index) => ({
    priceBin: 150 + index * 0.5,
    askVolume: 1_000 + index * 80,
    bidVolume: 1_200 + (20 - index) * 65,
    unknownVolume: 20
  }));
  return {
    symbol: symbol.toUpperCase(),
    priceBinSize: 0.01,
    classificationVersion: "fixture-v1",
    from: fixtureSessionDate,
    to: fixtureSessionDate,
    dataStatus: "ready",
    supportedSymbols: ["NVDA", "AAPL"],
    days: [{
      sessionDate: fixtureSessionDate,
      totals: { askVolume: 32_000, bidVolume: 34_000, unknownVolume: 400, delta: -2_000, tradeCount: 2_400, volume: 66_400 },
      levels
    }]
  };
}

function fixtureSymbols(): Array<Record<string, string>> {
  return [
    { symbol: "NVDA", name: "NVIDIA" },
    { symbol: "AAPL", name: "Apple" },
    { symbol: "MSFT", name: "Microsoft" }
  ];
}

async function expectNonBlankCanvas(canvas: ReturnType<Page["locator"]>): Promise<void> {
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (!context || target.width < 10 || target.height < 10) {
      return 0;
    }
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let colored = 0;
    for (let index = 3; index < pixels.length; index += 16) {
      if (pixels[index] > 0) {
        colored += 1;
      }
    }
    return colored;
  })).toBeGreaterThan(100);
}

async function expectLatestQuarterGap(chartPanel: Locator): Promise<void> {
  await expect.poll(async () => {
    const visibleCount = Number(await chartPanel.getAttribute("data-chart-visible-count"));
    const rightOffset = Number(await chartPanel.getAttribute("data-chart-right-offset"));
    return Number.isFinite(visibleCount) && rightOffset === -Math.floor(visibleCount / 4);
  }).toBe(true);
}

async function dispatchWheelBurst(canvas: Locator, count: number, anchorRatio: number): Promise<void> {
  await canvas.evaluate((element, input) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < input.count; index += 1) {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * input.anchorRatio,
        clientY: rect.top + rect.height * 0.45,
        deltaY: -70
      }));
    }
  }, { count, anchorRatio });
}

async function assertWorkspaceChromeDoesNotOverlap(page: Page): Promise<void> {
  const bottom = await page.locator(".workspace-bottom-nav").boundingBox();
  const preset = await page.locator(".layout-preset-dock").boundingBox();
  expect(bottom).not.toBeNull();
  expect(preset).not.toBeNull();
  const panels = await page.locator(".workspace-panel-frame").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  if (bottom) {
    for (const panel of panels) {
      expect(panel.bottom).toBeLessThanOrEqual(bottom.y + 4);
    }
  }
  for (let leftIndex = 0; leftIndex < panels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < panels.length; rightIndex += 1) {
      const left = panels[leftIndex]!;
      const right = panels[rightIndex]!;
      const overlaps = left.left < right.right - 1 && left.right > right.left + 1 && left.top < right.bottom - 1 && left.bottom > right.top + 1;
      expect(overlaps).toBe(false);
    }
  }
}
