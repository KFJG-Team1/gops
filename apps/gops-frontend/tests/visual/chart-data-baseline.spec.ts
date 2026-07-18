import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const fixtureSessionDate = "2026-07-08";
let omittedCandleIndex: number | null = null;
let omittedOrderFlowMinute: number | null = null;
let alignBidAskFixtures = false;
let partialThenReadyCandles = false;
let sparseCandlesWithoutBackfill = false;
let backfillWhenPastBoundaryVisible = false;
let includeChartEventFixtures = false;
let candleRequestCount = 0;
let olderCandleRequestCount = 0;
let candleRequestUrls: string[] = [];

test.beforeEach(async ({ page }) => {
  omittedCandleIndex = null;
  omittedOrderFlowMinute = null;
  alignBidAskFixtures = false;
  partialThenReadyCandles = false;
  sparseCandlesWithoutBackfill = false;
  backfillWhenPastBoundaryVisible = false;
  includeChartEventFixtures = false;
  candleRequestCount = 0;
  olderCandleRequestCount = 0;
  candleRequestUrls = [];
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
  await expectLatestQuarterGap(chartPanel, 120);

  await expect(panel).toHaveScreenshot("chart-candle.png", { maxDiffPixelRatio: 0.015 });
  await selectChartToolbarOption(page, "Chart type", "line");
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expect(panel).toHaveScreenshot("chart-line.png", { maxDiffPixelRatio: 0.015 });

  await selectChartToolbarOption(page, "Chart type", "ohlc");
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expect(panel).toHaveScreenshot("chart-ohlc.png", { maxDiffPixelRatio: 0.015 });

  await selectChartToolbarOption(page, "Chart type", "bidask");
  for (const interval of ["1m", "10m", "1h"] as const) {
    await selectChartToolbarOption(page, "Interval", interval);
    await expect(page.locator(".chart-panel")).toHaveAttribute("data-order-flow-status", "ready");
    await expect(page.locator(".chart-panel")).toHaveAttribute("data-order-flow-minute-count", /^[1-9]\d*$/);
    await expect(page.locator(".chart-canvas")).toHaveAttribute("data-order-flow-minute-count", /^[1-9]\d*$/);
    await expectLatestQuarterGap(chartPanel);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expectNonBlankCanvas(page.locator(".chart-canvas"));
    await expect(panel).toHaveScreenshot(`chart-bidask-${interval}.png`, { maxDiffPixelRatio: 0.015 });
  }
  expect(intradayRequestCount).toBe(1);
});

test("SIM virtual session renders order flow and bidask while wall clock is weekend", async ({ page }) => {
  alignBidAskFixtures = true;
  await page.addInitScript(() => {
    const NativeDate = Date;
    const weekendNow = NativeDate.parse("2026-07-18T12:00:00.000Z");
    class WeekendDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length ? args : [weekendNow]));
      }
      static now() {
        return weekendNow;
      }
    }
    globalThis.Date = WeekendDate as DateConstructor;
  });
  await page.route("**/api/simulator/status", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      available: true,
      mode: "simulation",
      state: "paused",
      datasetId: "sp500-top20-plus-amd-mu-20260715-kst-v2",
      runId: "visual-sim-run",
      virtualTime: `${fixtureSessionDate}T14:30:00.000Z`,
      startTime: `${fixtureSessionDate}T13:30:00.000Z`,
      endTime: `${fixtureSessionDate}T20:00:00.000Z`,
      requestedSpeed: 1,
      effectiveSpeed: 0,
      processedEventCount: 100,
      totalEventCount: 1000,
      progress: 0.1,
      lagMs: 0,
      symbols: [{ symbol: "NVDA", price: 101 }]
    })
  }));

  await openFixtureLayout(page, tiledDataLayout());
  await selectChartToolbarOption(page, "Chart type", "bidask");

  await expect(page.locator(".chart-panel")).toHaveAttribute("data-order-flow-status", "ready");
  await expect(page.locator(".order-flow-panel")).toHaveAttribute("data-order-flow-status", "ready");
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  await expectNonBlankCanvas(page.locator(".order-flow-canvas"));
});

test("chart toolbar dropdowns open downward and remain keyboard accessible", async ({ page }) => {
  await openFixtureLayout(page, chartOnlyLayout());
  const panel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  const chartTypeTrigger = page.getByRole("combobox", { name: "Chart type" });
  const intervalTrigger = page.getByRole("combobox", { name: "Interval" });

  await selectChartToolbarOption(page, "Chart type", "ohlc");
  await chartTypeTrigger.click();
  const chartTypeMenu = page.getByRole("listbox", { name: "Chart type options" });
  await expect(chartTypeMenu).toBeVisible();
  await expectDropdownBelowTrigger(chartTypeTrigger, chartTypeMenu);
  await expect(chartTypeMenu.getByRole("option")).toHaveText(["Candle", "Line", "OHLC", "Bid/Ask"]);
  await expect(chartTypeMenu.locator('[data-value="ohlc"]')).toHaveAttribute("aria-selected", "true");
  expect(await chartTypeMenu.evaluate((element) => element.scrollTop)).toBe(0);

  await intervalTrigger.click();
  await expect(chartTypeMenu).toBeHidden();
  const intervalMenu = page.getByRole("listbox", { name: "Interval options" });
  await expect(intervalMenu).toBeVisible();
  await expectDropdownBelowTrigger(intervalTrigger, intervalMenu);
  await expect(intervalMenu.getByRole("option")).toHaveText(["1m", "5m", "10m", "1h", "4h", "1D", "1W", "1M"]);
  expect(await intervalMenu.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(panel).toHaveScreenshot("chart-toolbar-dropdown-open.png", { maxDiffPixelRatio: 0.015 });

  await intervalTrigger.press("Escape");
  await expect(intervalMenu).toBeHidden();
  await expect(intervalTrigger).toBeFocused();

  await intervalTrigger.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Interval options" })).toBeVisible();
  await intervalTrigger.press("End");
  await intervalTrigger.press("Enter");
  await expect(intervalTrigger).toContainText("1M");
  await expectLatestQuarterGap(page.locator(".chart-panel"), 36);

  await selectChartToolbarOption(page, "Interval", "1W");
  await expectLatestQuarterGap(page.locator(".chart-panel"), 104);
  await selectChartToolbarOption(page, "Interval", "1D");
  await expectLatestQuarterGap(page.locator(".chart-panel"), 120);

  await intervalTrigger.click();
  await expect(page.getByRole("listbox", { name: "Interval options" })).toBeVisible();
  await page.locator(".chart-canvas").click({ position: { x: 12, y: 80 } });
  await expect(page.getByRole("listbox", { name: "Interval options" })).toBeHidden();
});

test("hovered candle metadata stays directly below the symbol search", async ({ page }) => {
  await openFixtureLayout(page, chartOnlyLayout());
  const chartPanel = page.locator(".chart-panel");
  const canvas = chartPanel.locator(".chart-canvas");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", /^[1-9]\d*$/);
  await expectNonBlankCanvas(canvas);
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Chart canvas is not measurable");
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.4,
    canvasBox.y + canvasBox.height * 0.35
  );

  const metadata = chartPanel.locator('[aria-label="Hovered candle data"]');
  await expect(metadata).toBeVisible();
  const [metadataBox, navigationBox, searchBox] = await Promise.all([
    metadata.boundingBox(),
    chartPanel.locator(".chart-panel-navigation").boundingBox(),
    chartPanel.locator(".chart-instance-symbol-search").boundingBox()
  ]);
  if (!metadataBox || !navigationBox || !searchBox) throw new Error("Chart hover layout is not measurable");
  expect(metadataBox.y).toBeGreaterThanOrEqual(navigationBox.y + navigationBox.height + 4);
  expect(metadataBox.y).toBeLessThanOrEqual(navigationBox.y + navigationBox.height + 10);
  expect(Math.abs(metadataBox.x - searchBox.x)).toBeLessThanOrEqual(4);
});

test("news markers stay on the exact candle while the timeline moves", async ({ page }) => {
  includeChartEventFixtures = true;
  await openFixtureLayout(page, chartOnlyLayout());
  await selectChartToolbarOption(page, "Interval", "1m");
  const chartPanel = page.locator(".chart-panel");
  const canvas = chartPanel.locator(".chart-canvas");
  const earningsMarker = chartPanel.locator('[data-chart-event-id="fixture-earnings"]');
  const newsMarker = chartPanel.locator('[data-chart-event-id="fixture-news"]');
  await expect(earningsMarker).toBeVisible();
  await expect(newsMarker).toBeVisible();

  const assertExactCandle = async () => {
    const [earningsBox, newsBox, canvasBox] = await Promise.all([
      earningsMarker.boundingBox(),
      newsMarker.boundingBox(),
      canvas.boundingBox()
    ]);
    if (!earningsBox || !newsBox || !canvasBox) throw new Error("Chart event geometry is unavailable");
    const earningsCenter = earningsBox.x + earningsBox.width / 2;
    const newsCenter = newsBox.x + newsBox.width / 2;
    expect(Math.abs(earningsCenter - newsCenter)).toBeLessThanOrEqual(0.5);
    expect(earningsBox.y).toBeLessThan(newsBox.y);
    await page.mouse.move(newsCenter, canvasBox.y + canvasBox.height * 0.35);
    await expect(chartPanel.locator('[aria-label="Hovered candle data"] .hover-ohlc-time dd'))
      .toHaveText(/Jul 08.*03:10 PM/);
    return newsCenter;
  };

  const firstX = await assertExactCandle();
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width * 0.5,
      clientY: rect.top + rect.height * 0.45,
      deltaX: 72
    }));
  });
  await expect.poll(async () => {
    const box = await newsMarker.boundingBox();
    return box ? Math.round(box.x + box.width / 2) : Math.round(firstX);
  }).not.toBe(Math.round(firstX));
  await assertExactCandle();
});

test("partial retry locks zoom and keeps the latest quarter gap", async ({ page }) => {
  partialThenReadyCandles = true;
  await openFixtureLayout(page, chartOnlyLayout());
  const chartPanel = page.locator(".chart-panel");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "3");
  await expectLatestQuarterGap(chartPanel, 120);
  const firstVisibleCount = await chartPanel.getAttribute("data-chart-visible-count");
  const firstRightOffset = await chartPanel.getAttribute("data-chart-right-offset");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "140", { timeout: 10_000 });
  await expect(chartPanel).toHaveAttribute("data-chart-visible-count", firstVisibleCount ?? "120");
  await expect(chartPanel).toHaveAttribute("data-chart-right-offset", firstRightOffset ?? "-30");
  await expectLatestQuarterGap(chartPanel, 120);
  await expectNonBlankCanvas(chartPanel.locator(".chart-canvas"));
});

test("wheel zoom out remains available without historical backfill", async ({ page }) => {
  sparseCandlesWithoutBackfill = true;
  await openFixtureLayout(page, chartOnlyLayout());
  const chartPanel = page.locator(".chart-panel");
  const canvas = chartPanel.locator(".chart-canvas");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "3");
  await expectNonBlankCanvas(canvas);
  const initialVisibleCount = Number(await chartPanel.getAttribute("data-chart-visible-count"));

  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 6; index += 1) {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height * 0.45,
        deltaY: 70
      }));
    }
  });

  await expect.poll(async () => Number(await chartPanel.getAttribute("data-chart-visible-count")))
    .toBeGreaterThan(initialVisibleCount);
  expect(candleRequestUrls.filter((requestUrl) => new URL(requestUrl).searchParams.has("before"))).toEqual([]);
  await expectNonBlankCanvas(canvas);
  await expect(chartPanel).toHaveScreenshot("chart-standard-zoomed.png", { maxDiffPixelRatio: 0.015 });
});

test("visible past boundary requests older candles without horizontal pan", async ({ page }) => {
  backfillWhenPastBoundaryVisible = true;
  await openFixtureLayout(page, chartOnlyLayout());
  const chartPanel = page.locator(".chart-panel");
  const canvas = chartPanel.locator(".chart-canvas");
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "20");
  await expect(chartPanel).toHaveAttribute("data-chart-right-offset", /^-/);

  await expect.poll(() => olderCandleRequestCount).toBe(1);
  await expect(chartPanel).toHaveAttribute("data-chart-candle-count", "140");
  await expectNonBlankCanvas(canvas);
});

test("fixed and optional derived layers preserve chart geometry", async ({ page }) => {
  await openFixtureLayout(page, chartOnlyLayout());
  const addMenu = await openChartAddMenu(page);
  await page.getByRole("menuitemcheckbox", { name: "20기간 지수 이동평균선" }).click({ force: true });
  await expect(addMenu).toBeVisible();
  await page.getByRole("menuitemcheckbox", { name: "거래량 프로파일" }).click({ force: true });
  await page.getByRole("menuitemcheckbox", { name: "거래량 막대 차트" }).click({ force: true });
  await page.getByRole("menuitemcheckbox", { name: "상대강도지수 (14)" }).click({ force: true });
  await addMenu.getByLabel("차트 추가 도구 닫기").evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(addMenu).toBeHidden();
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
  await openChartAddMenu(page);
  await page.getByRole("menuitemcheckbox", { name: "120기간 단순 이동평균선" }).click({ force: true });

  await expect.poll(() => requestedLayers.some((layers) => layers.split(",").includes("sma:120"))).toBe(true);
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
  const panel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await expect(panel).toHaveScreenshot("chart-sma120-autoscale.png", { maxDiffPixelRatio: 0.015 });
});

test("bidask wheel zoom keeps one visual grammar and skips viewport history", async ({ page }) => {
  alignBidAskFixtures = true;
  await openFixtureLayout(page, chartOnlyLayout());
  await selectChartToolbarOption(page, "Chart type", "bidask");
  await selectChartToolbarOption(page, "Interval", "1m");
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
  await selectChartToolbarOption(page, "Chart type", "bidask");
  await selectChartToolbarOption(page, "Interval", "1m");
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
  await expect(chartPanel).toHaveScreenshot("chart-bidask-missing-minutes.png", {
    maxDiffPixelRatio: 0.015,
  });
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
  await expect(page.locator(".app-shell")).toHaveScreenshot("workspace-chart-compare-orderflow.png", {
    maxDiffPixelRatio: 0.015
  });
});

test("layout edit hides the command bar and exposes chart asset panels", async ({ page }) => {
  await openFixtureLayout(page, chartOnlyLayout());
  await page.getByRole("button", { name: "레이아웃 수정모드 시작" }).click();

  await expect(page.locator(".workspace-bottom-nav")).toHaveCount(0);
  await expect(page.locator(".layout-palette-dock")).toBeVisible();
  await expect(page.locator(".workspace-top-nav").getByRole("button", { name: "레이아웃 수정모드 종료" })).toHaveCount(1);
  await expect(page.locator(".layout-palette-dock").getByRole("button", { name: "레이아웃 수정모드 종료" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "차트 해설" })).toBeVisible();
  await expect(page.getByRole("button", { name: "작도 자산(개발)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "빠른 주문", exact: true })).toBeVisible();
});

test("quick order keeps analysis context ahead of explicit submit", async ({ page }) => {
  const submittedOrders: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/orders" && request.method() === "POST") {
      submittedOrders.push({ headers: request.headers(), body: request.postDataJSON() });
    }
  });
  await openFixtureLayout(page, quickOrderLayout());
  const panel = page.locator(".quick-order-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("데이터 기준")).toHaveCount(0);
  await expect(panel.locator(".quick-order-shortcuts button")).toHaveCount(4);
  await expect(panel.getByRole("button", { name: "매수 우위 후보가" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "매도 우위 후보가" })).toBeVisible();
  const symbolPicker = panel.locator(".quick-order-symbol-picker");
  await expect.poll(() => panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft, style.borderRadius];
  })).toEqual(["8px", "8px", "8px", "8px", "8px"]);
  await expect.poll(() => panel.locator(".quick-order-symbol-search").evaluate((element) => getComputedStyle(element).borderRadius)).toBe("6px");
  await expect.poll(() => panel.locator(".quick-order-submit").evaluate((element) => getComputedStyle(element).borderRadius)).toBe("6px");
  await expect.poll(() => panel.locator(".quick-order-status-layer").evaluate((element) => getComputedStyle(element).position)).toBe("absolute");
  await expect.poll(async () => {
    const [panelBox, pickerBox] = await Promise.all([panel.boundingBox(), symbolPicker.boundingBox()]);
    return panelBox && pickerBox ? panelBox.x + panelBox.width - pickerBox.x - pickerBox.width : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(16);
  const selectedNvda = panel.locator(".quick-order-selected-symbol", { hasText: "NVDA" });
  await expect(selectedNvda).toBeVisible();
  const selectedSymbolLayout = await selectedNvda.evaluate((element) => {
    const style = getComputedStyle(element);
    const tickerStyle = getComputedStyle(element.querySelector("strong")!);
    return [style.display, style.paddingLeft, style.paddingRight, tickerStyle.justifySelf, tickerStyle.whiteSpace];
  });
  expect(selectedSymbolLayout).toEqual(["grid", "8px", "8px", "end", "nowrap"]);
  await expect(selectedNvda).not.toContainText(/Nvidia/i);
  await selectedNvda.click();
  const symbolSearch = panel.getByLabel("빠른 주문 종목 검색");
  await expect(symbolSearch).toHaveAttribute("placeholder", "종목 검색");
  await symbolSearch.fill("Apple");
  await expect(panel.locator(".quick-order-symbol-search")).toHaveClass(/is-searching/);
  await expect(panel.getByRole("option", { name: /AAPL Apple/i })).toBeVisible();
  await panel.getByRole("option", { name: /AAPL Apple/i }).click();
  const selectedApple = panel.locator(".quick-order-selected-symbol", { hasText: "AAPL" });
  await expect(selectedApple).toBeVisible();
  await selectedApple.click();
  await expect(symbolSearch).toBeVisible();
  await symbolSearch.fill("NVDA");
  await panel.getByRole("option", { name: /NVDA Nvidia/i }).click();
  await expect(panel.locator(".quick-order-selected-symbol", { hasText: "NVDA" })).toBeVisible();
  await expect(panel.getByText("직접 입력하거나 주문 가능 금액 비율을 선택하세요.")).toHaveCount(0);
  const bestBidButton = panel.getByRole("button", { name: /최우선 매수호가/ });
  await expect(bestBidButton).toBeEnabled();
  await expect.poll(() => bestBidButton.locator(":scope > span").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(34, 197, 94)");
  await expect.poll(() => bestBidButton.locator(".quick-order-quote-price strong").evaluate((element) => getComputedStyle(element).fontSize)).toBe("32px");
  await expect.poll(() => bestBidButton.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Asta Sans");
  await expect(panel.locator(".quick-order-center-metrics .quick-order-metric")).toHaveCount(2);
  await expect.poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await expect(panel.getByRole("button", { name: "주문 전송" })).toBeDisabled();

  const bidOffsetButton = panel.getByRole("button", { name: /매수호가 - 1틱/ });
  const askOffsetButton = panel.getByRole("button", { name: /매도호가 \+ 1틱/ });
  const buySignalButton = panel.getByRole("button", { name: "매수 우위 후보가" });
  const priceEditor = panel.locator(".quick-order-price-editor");
  const priceInput = panel.getByLabel("빠른 주문 가격 직접 입력");
  const quantityEditor = panel.locator(".quick-order-quantity-editor");
  const ratioButtons = panel.locator(".quick-order-ratio-buttons");
  await expect(priceEditor).toBeVisible();
  await expect(quantityEditor).toBeVisible();
  await expect(ratioButtons).toBeVisible();
  await expect(priceInput).toBeDisabled();
  await expect.poll(() => bidOffsetButton.locator("span").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(34, 197, 94)");
  await expect.poll(() => askOffsetButton.locator("span").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 85, 119)");
  await expect.poll(() => panel.getByRole("button", { name: "매수 우위 후보가" }).locator("span").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(34, 197, 94)");
  await expect.poll(() => panel.getByRole("button", { name: "매도 우위 후보가" }).locator("span").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 85, 119)");
  await expect(buySignalButton).toBeEnabled();
  const buySignalPrice = (await buySignalButton.locator("strong").innerText()).replace("$", "");
  await buySignalButton.click();
  await expect(priceInput).toHaveValue(buySignalPrice);
  await bidOffsetButton.click();
  await expect(priceInput).toHaveValue("159.97");
  await expect.poll(() => bidOffsetButton.locator("strong").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(34, 197, 94)");
  await expect.poll(() => bidOffsetButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await askOffsetButton.click();
  await expect(priceInput).toHaveValue("160.03");
  await expect.poll(() => panel.locator(".quick-order-submit").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 85, 119)");
  await expect.poll(() => askOffsetButton.locator("strong").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 85, 119)");
  await expect.poll(() => askOffsetButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  const bestAskButton = panel.getByRole("button", { name: /최우선 매도호가/ });
  await bestAskButton.click();
  await expect(priceInput).toHaveValue("160.02");
  await expect(bestAskButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => bestAskButton.locator(".quick-order-quote-price strong").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 85, 119)");
  await expect.poll(() => bestAskButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  await bestBidButton.click();
  await expect(priceInput).toHaveValue("159.98");
  await expect.poll(() => panel.locator(".quick-order-submit").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(34, 197, 94)");
  await expect(bestBidButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => bestBidButton.locator(".quick-order-quote-price strong").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(34, 197, 94)");
  await expect.poll(() => bestBidButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect(panel.getByText("예상 주문액")).toBeVisible();
  const reviewCompany = panel.locator(".quick-order-review-company");
  await expect(reviewCompany).toHaveText(/Nvidia/i);
  await expect.poll(() => reviewCompany.evaluate((element) => getComputedStyle(element).fontSize)).toBe("20px");
  await expect.poll(async () => {
    const [companyBox, amountBox] = await Promise.all([reviewCompany.boundingBox(), panel.getByText("예상 주문액").boundingBox()]);
    return companyBox && amountBox ? companyBox.y < amountBox.y : false;
  }).toBe(true);
  await expect(panel.locator(".quick-order-total-value")).toHaveText("$159.98");
  await expect(panel.getByText(/체결 보장 없음|주문 가능 조회 중|실시간 호가 기준/)).toHaveCount(0);
  await expect(panel.getByText("유효한 최우선 매수·매도호가를 기다리는 중입니다.")).toHaveCount(0);
  await expect(panel.getByText("이전 주문의 접수 결과를 기다리는 중입니다.")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "주문 전송" })).toBeEnabled();

  await priceInput.fill("159.95");
  await expect(priceInput).toHaveValue("159.95");
  await expect(bestBidButton).toHaveAttribute("aria-pressed", "false");
  await expect(panel.locator(".quick-order-total-value")).toHaveText("$159.95");

  const qtyInput = panel.getByLabel("주문 수량 직접 입력");
  await qtyInput.fill("7");
  await expect(qtyInput).toHaveValue("7");
  await expect.poll(() => storedPanelProp(page, "content-quickOrder-2", "qty")).toBe(7);
  await expect(panel.getByText("리스크 점검 통과")).toHaveCount(0);

  await panel.getByRole("button", { name: "10%" }).click();
  await expect(qtyInput).toHaveValue("6");
  await expect.poll(() => storedPanelProp(page, "content-quickOrder-2", "qty")).toBe(6);

  await panel.getByRole("button", { name: "주문 전송" }).click();
  await expect.poll(() => submittedOrders.length).toBe(1);
  expect(submittedOrders[0]?.headers["idempotency-key"]).toBeTruthy();
  expect(submittedOrders[0]?.body).toMatchObject({ symbol: "NVDA", side: "buy", qty: "6", price: "159.95", order_division: "00" });
  await expect(panel.getByText("NVDA 주문이 접수되었습니다.")).toBeVisible();
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

async function selectChartToolbarOption(page: Page, ariaLabel: "Chart type" | "Interval", value: string): Promise<void> {
  const trigger = page.getByRole("combobox", { name: ariaLabel });
  await trigger.click({ force: true });
  const listbox = page.getByRole("listbox", { name: `${ariaLabel} options` });
  await expect(listbox).toBeVisible();
  await listbox.locator(`[data-value="${value}"]`).click();
  await expect(listbox).toBeHidden();
}

async function expectDropdownBelowTrigger(trigger: Locator, listbox: Locator): Promise<void> {
  const triggerBox = await trigger.boundingBox();
  const listboxBox = await listbox.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(listboxBox).not.toBeNull();
  if (!triggerBox || !listboxBox) {
    return;
  }
  expect(listboxBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height + 5);
  expect(listboxBox.y + listboxBox.height).toBeLessThanOrEqual(await listbox.evaluate(() => window.innerHeight - 7));
}

async function openChartAddMenu(page: Page): Promise<Locator> {
  const panel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await panel.hover();
  await panel.getByRole("button", { name: "차트 추가 도구 열기" }).click();
  const menu = panel.getByRole("menu", { name: "차트 추가 도구" });
  await expect(menu).toBeVisible();
  return menu;
}

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

function quickOrderLayout(): Record<string, unknown> {
  return storedLayout([
    content("chart", 1, { symbol: "NVDA", timeframe: "1m" }, "visual-chart-document"),
    content("quickOrder", 2, { symbol: "NVDA", qty: 1 })
  ], [
    slot("chart", 1, 1, 1, 6, 6),
    slot("quickOrder", 2, 7, 1, 2, 2)
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
  let status = request.method() === "DELETE" ? 204 : 200;
  if (url.pathname === "/api/auth/me") {
    payload = { authEnabled: false, user: null };
  } else if (url.pathname === "/api/charts/symbols") {
    payload = { symbols: fixtureSymbols() };
  } else if (url.pathname === "/api/charts/candles") {
    candleRequestUrls.push(url.toString());
    const symbol = url.searchParams.get("symbol") ?? "NVDA";
    const interval = url.searchParams.get("interval") ?? "1m";
    const fullPayload = candlePayload(symbol, interval);
    if (backfillWhenPastBoundaryVisible) {
      const allCandles = fullPayload.candles as Array<Record<string, unknown>>;
      const isOlderRequest = url.searchParams.has("before");
      const candles = isOlderRequest ? allCandles.slice(0, -20) : allCandles.slice(-20);
      if (isOlderRequest) {
        olderCandleRequestCount += 1;
      }
      payload = {
        ...fullPayload,
        request: { limit: candles.length },
        candles,
        requestedLimit: candles.length,
        returnedCount: candles.length,
        hasMoreBefore: !isOlderRequest
      };
    } else if (sparseCandlesWithoutBackfill) {
      const candles = (fullPayload.candles as Array<Record<string, unknown>>).slice(-3);
      payload = {
        ...fullPayload,
        request: { limit: candles.length },
        candles,
        requestedLimit: candles.length,
        returnedCount: candles.length,
        hasMoreBefore: false
      };
    } else if (partialThenReadyCandles && candleRequestCount === 0) {
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
      if (partialThenReadyCandles && candleRequestCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      payload = fullPayload;
    }
    candleRequestCount += 1;
  } else if (url.pathname === "/api/charts/events") {
    payload = chartEventsPayload(url);
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
  } else if (url.pathname === "/api/risk/pretrade") {
    payload = { risk: { verdict: "allow", requestedQty: "1", adjustedQty: null, triggeredRules: [] } };
  } else if (url.pathname === "/api/orders/balance") {
    payload = { currency: "USD", orderable_cash: "10000.00", orderable_qty: "62" };
  } else if (url.pathname === "/api/orders" && request.method() === "POST") {
    status = 202;
    payload = { order_id: "ord-quick-fixture", status: "received", symbol: "NVDA", side: "buy", qty: "2", price: "159.98", simulation: true };
  } else if (url.pathname === "/api/watchlist") {
    payload = { symbols: [] };
  } else if (url.pathname === "/api/market/heatmap") {
    payload = { items: [] };
  }
  await route.fulfill({
    status,
    contentType: "application/json",
    body: request.method() === "DELETE" ? "" : JSON.stringify(payload)
  });
}

function chartEventsPayload(url: URL): Record<string, unknown> {
  const symbol = (url.searchParams.get("symbol") ?? "NVDA").toUpperCase();
  const from = url.searchParams.get("from") ?? "2026-07-08T13:30:00.000Z";
  const to = url.searchParams.get("to") ?? "2026-07-08T15:49:59.999Z";
  if (!includeChartEventFixtures) {
    return {
      symbol,
      from,
      to,
      status: { earnings: "empty", news: "empty" },
      earnings: [],
      newsDays: [],
      upcomingEarnings: null
    };
  }
  const eventAt = "2026-07-08T15:10:00.000Z";
  return {
    symbol,
    from,
    to,
    status: { earnings: "ready", news: "ready" },
    earnings: [{
      id: "fixture-earnings",
      type: "earnings",
      eventAt,
      status: "reported",
      session: "regular",
      eps: { actual: 1.2, estimate: 1.1, surprise: 0.1, surprisePercent: 9.09 },
      source: "fixture",
      sourceAsOf: eventAt
    }],
    newsDays: [{
      id: "fixture-news",
      type: "news",
      date: fixtureSessionDate,
      articleCount: 2,
      summary: "Fixture news marker alignment",
      keyPoints: ["Exact candle alignment"],
      impactDirection: "positive",
      sentiment: "positive",
      sources: [{
        articleId: "fixture-article",
        title: "Fixture article",
        name: "Fixture",
        url: "https://example.com/fixture",
        publishedAt: eventAt
      }]
    }],
    upcomingEarnings: null
  };
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
  const candleCount = Number(url.searchParams.get("candleCount") ?? fixtureCandles(url.searchParams.get("interval") ?? "1m").length);
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
    sourceCandleCount: candleCount,
    requestedCandleCount: candleCount,
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
  const semanticPixelCount = () => canvas.evaluate((element) => {
    const target = (element.parentElement?.querySelector(".chart-canvas-base") ?? element) as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (!context || target.width < 10 || target.height < 10) {
      return 0;
    }
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let semanticDataPixels = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      const isUp = alpha > 0 && green > 100 && green > red + 30 && green > blue + 20;
      const isDown = alpha > 0 && red > 150 && red > green + 40 && red > blue + 30;
      if (isUp || isDown) {
        semanticDataPixels += 1;
      }
    }
    return semanticDataPixels;
  });
  await expect.poll(async () => {
    const first = await semanticPixelCount();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = await semanticPixelCount();
    return Math.min(first, second);
  }).toBeGreaterThan(50);
}

async function expectLatestQuarterGap(chartPanel: Locator, expectedVisibleCount?: number): Promise<void> {
  await expect.poll(async () => {
    const visibleCount = Number(await chartPanel.getAttribute("data-chart-visible-count"));
    const rightOffset = Number(await chartPanel.getAttribute("data-chart-right-offset"));
    return Number.isFinite(visibleCount)
      && (expectedVisibleCount === undefined || visibleCount === expectedVisibleCount)
      && rightOffset === -Math.floor(visibleCount / 4);
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
