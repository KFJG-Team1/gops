import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";

type CanvasArcCall = {
  x: number;
  y: number;
  radius: number;
};

type CanvasStrokeRectCall = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CanvasTextCall = {
  text: string;
  x: number;
  y: number;
};

type CanvasTrackingWindow = Window & {
  __gopsDrawingArcCalls?: CanvasArcCall[];
  __gopsDrawingStrokeRectCalls?: CanvasStrokeRectCall[];
  __gopsDrawingTextCalls?: CanvasTextCall[];
};

test.beforeEach(async ({ page }) => {
  await installCanvasArcTracker(page);
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillFixtureApi(route));
});

test("drawing tools use one-shot select, editable labels, range handles, and flag tags", async ({ page }) => {
  await openFixtureChart(page);
  const canvas = page.locator(".chart-canvas");
  const dock = await openDrawingDock(page);
  const selectButton = dock.getByRole("button", { name: "Select", exact: true });
  const panButton = dock.getByRole("button", { name: "Pan", exact: true });
  const editor = page.getByRole("textbox", { name: "Drawing label editor" });

  await dock.getByRole("button", { name: "H-Line", exact: true }).click();
  const horizontalLinePoint = await relativeCanvasPoint(canvas, 0.32, 0.36);
  await canvas.click({ position: horizontalLinePoint });

  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("기준선");
  await editor.fill("주요 저항선");

  // Canvas pointer-down commits before the editor unmounts, then the special
  // post-create focus exits directly to Pan.
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.82, 0.72) });
  await expect(editor).toHaveCount(0);
  await expect(panButton).toHaveClass(/\bactive\b/);

  // A completed label remains editable through its parent line.
  await selectButton.click();
  await canvas.click({ position: horizontalLinePoint });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("주요 저항선");
  await editor.press("Escape");

  const secondHorizontalLinePoint = await relativeCanvasPoint(canvas, 0.42, 0.53);
  await dock.getByRole("button", { name: "H-Line", exact: true }).click();
  await canvas.click({ position: secondHorizontalLinePoint });
  await editor.fill("보조 기준선");
  await editor.press("Enter");
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.86, 0.76) });
  await selectButton.click();

  // Switching directly between drawings commits the first editor and keeps
  // the newly selected drawing's keyed editor alive after pointer focus moves.
  await canvas.click({ position: horizontalLinePoint });
  await editor.fill("주요 저항선 수정");
  await canvas.click({ position: secondHorizontalLinePoint });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("보조 기준선");
  await editor.press("Escape");
  await canvas.click({ position: horizontalLinePoint });
  await expect(editor).toHaveValue("주요 저항선 수정");
  await editor.press("Escape");

  await dock.getByRole("button", { name: "Range", exact: true }).click();
  await resetCanvasArcCalls(page);
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.22, 0.27) });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.58, 0.62) });

  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("범위");
  await expect.poll(() => uniqueRadiusFourArcCount(page)).toBe(8);
  await editor.press("Escape");

  await dock.getByRole("button", { name: "Flag", exact: true }).click();
  const flagPoint = await relativeCanvasPoint(canvas, 0.72, 0.55);
  await canvas.click({ position: flagPoint });
  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("이벤트");
  await editor.fill("실적 이벤트");
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);

  // The background tag itself, rather than only its anchor point, reopens editing.
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await canvas.click({
    position: {
      x: Math.min((canvasBox?.width ?? 1) - 56, flagPoint.x + 24),
      y: 56
    }
  });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("실적 이벤트");
  await editor.press("Escape");
});

test("parallel drawing controls expose three tools and preserve arrow-adjusted line count", async ({ page }) => {
  await openFixtureChart(page);
  const canvas = page.locator(".chart-canvas");
  const dock = await openDrawingDock(page);
  const selectButton = dock.getByRole("button", { name: "Select", exact: true });

  const priceParallelButton = dock.getByRole("button", { name: "Price Parallel", exact: true });
  const timeParallelButton = dock.getByRole("button", { name: "Time Parallel", exact: true });
  await expect(priceParallelButton).toBeVisible();
  await expect(timeParallelButton).toBeVisible();
  await expect(dock.getByRole("button", { name: "Point", exact: true })).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Risk/Reward", exact: true })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Fibonacci", exact: true })).toBeVisible();
  await expectTwoLineGlyph(priceParallelButton, "horizontal-parallel-lines");
  await expectTwoLineGlyph(timeParallelButton, "vertical-parallel-lines");
  await expectToolbarOrder(dock, [
    "Select", "Pan", "H-Line", "Price Parallel", "Marker", "Time Parallel",
    "Trend Segment", "Trend Ray", "Trend Line", "Trend Parallel", "Text", "Flag",
    "Range", "Risk/Reward", "Fibonacci"
  ]);
  const trendParallelButton = dock.getByRole("button", { name: "Trend Parallel", exact: true });
  const lineCount = dock.getByRole("combobox", { name: "Parallel line count" });
  await expect(trendParallelButton).toBeVisible();
  await expect(lineCount).toHaveValue("3");

  await priceParallelButton.click();
  await resetCanvasArcCalls(page);
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.18, 0.3) });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.62, 0.64) });
  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect(page.getByRole("textbox", { name: "Drawing label editor" })).toHaveValue("가격 구간");
  await page.getByRole("textbox", { name: "Drawing label editor" }).press("Escape");
  await expect.poll(() => uniqueRadiusFourArcCount(page)).toBe(2);

  await timeParallelButton.click();
  await resetCanvasArcCalls(page);
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.28, 0.28) });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.7, 0.66) });
  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect(page.getByRole("textbox", { name: "Drawing label editor" })).toHaveValue("시간 구간");
  await page.getByRole("textbox", { name: "Drawing label editor" }).press("Escape");
  await expect.poll(() => uniqueRadiusFourArcCount(page)).toBe(2);

  await trendParallelButton.click();
  await expect(trendParallelButton).toHaveClass(/\bactive\b/);
  await page.keyboard.press("ArrowRight");
  await expect(lineCount).toHaveValue("4");

  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.23, 0.61) });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.52, 0.38) });
  await resetCanvasArcCalls(page);
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.31, 0.28) });

  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect(lineCount).toHaveValue("4");
  await expect.poll(() => uniqueRadiusFourArcCount(page)).toBe(3);
});

test("drawing and chart-add docks show every tool without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openFixtureChart(page);

  const chartPanel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await chartPanel.hover();
  await chartPanel.getByRole("button", { name: "차트 그리기 도구 열기" }).click({ force: true });
  await chartPanel.hover();
  await chartPanel.getByRole("button", { name: "차트 추가 도구 열기" }).click({ force: true });

  const drawingDock = page.getByRole("toolbar", { name: "Chart drawing tools" });
  const chartAddDock = page.getByRole("toolbar", { name: "Chart add tools" });
  await expect(drawingDock.getByRole("button", { name: "Fibonacci", exact: true })).toBeVisible();
  await expect(chartAddDock.getByRole("button", { name: "MACD", exact: true })).toBeVisible();

  for (const dock of [drawingDock, chartAddDock]) {
    await expect.poll(() => dock.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const buttonCount = await dock.locator("button").count();
    for (let index = 0; index < buttonCount; index += 1) {
      await expect(dock.locator("button").nth(index)).toBeVisible();
    }
  }
});

test("risk reward and fibonacci draw with canonical anchor counts and one-shot Select", async ({ page }) => {
  await openFixtureChart(page);
  const canvas = page.locator(".chart-canvas");
  const dock = await openDrawingDock(page);
  const selectButton = dock.getByRole("button", { name: "Select", exact: true });

  await dock.getByRole("button", { name: "Risk/Reward", exact: true }).click();
  const entryPoint = await relativeCanvasPoint(canvas, 0.24, 0.5);
  const stopPoint = await relativeCanvasPoint(canvas, 0.68, 0.7);
  await canvas.click({ position: entryPoint });
  await resetCanvasStrokeRectCalls(page);
  await canvas.hover({ position: stopPoint });
  await expect.poll(() => nonEmptyStrokeRectCount(page)).toBeGreaterThan(0);
  await canvas.click({ position: stopPoint });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.42, 0.82) });
  await expect(dock.getByRole("button", { name: "Risk/Reward", exact: true })).toHaveClass(/\bactive\b/);
  await expect(page.getByText("Target은 Entry의 Stop 반대편에 지정하세요")).toBeVisible();
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.42, 0.28) });
  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect.poll(() => uniqueRadiusFourArcCount(page)).toBeGreaterThanOrEqual(3);

  await dock.getByRole("button", { name: "Fibonacci", exact: true }).click();
  await resetCanvasArcCalls(page);
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.3, 0.7) });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.76, 0.25) });
  await expect(selectButton).toHaveClass(/\bactive\b/);
  await expect.poll(() => uniqueRadiusFourArcCount(page)).toBe(2);
});

test("range fill is transparent to hit-testing while its outline remains selectable", async ({ page }) => {
  await openFixtureChart(page);
  const canvas = page.locator(".chart-canvas");
  const dock = await openDrawingDock(page);
  const editor = page.getByRole("textbox", { name: "Drawing label editor" });

  await dock.getByRole("button", { name: "H-Line", exact: true }).click();
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.38, 0.48) });
  await editor.press("Escape");

  await dock.getByRole("button", { name: "Range", exact: true }).click();
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.2, 0.25) });
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.75, 0.7) });
  await editor.press("Escape");
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.9, 0.86), force: true });
  await dock.getByRole("button", { name: "Select", exact: true }).click();

  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.5, 0.48) });
  await expect(editor).toHaveValue("기준선");
  await editor.press("Escape");
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.2, 0.5) });
  await expect(editor).toHaveValue("범위");
});

test("inline label editor replaces the label and remains clipped to the price plot", async ({ page }) => {
  await openFixtureChart(page);
  const canvas = page.locator(".chart-canvas");
  const dock = await openDrawingDock(page);
  const before = await canvas.boundingBox();
  expect(before).not.toBeNull();

  await dock.getByRole("button", { name: "Text", exact: true }).click();
  await canvas.click({ position: await relativeCanvasPoint(canvas, 0.72, 0.45) });
  const editor = page.getByRole("textbox", { name: "Drawing label editor" });
  await expect(editor).toBeFocused();
  await editor.fill("편집 위치 확인");
  await resetCanvasTextCalls(page);
  await editor.press("Enter");
  await expect.poll(async () => latestCanvasTextCall(page, "편집 위치 확인")).not.toBeNull();
  const labelText = await latestCanvasTextCall(page, "편집 위치 확인");
  expect(labelText).not.toBeNull();
  await canvas.click({ position: { x: labelText?.x ?? 0, y: labelText?.y ?? 0 } });
  await expect(editor).toBeFocused();
  const initialEditorBox = await editor.boundingBox();
  const initialCanvasBox = await canvas.boundingBox();
  expect(initialEditorBox).not.toBeNull();
  expect(initialCanvasBox).not.toBeNull();
  expect(Math.abs((initialEditorBox?.x ?? 0) - (initialCanvasBox?.x ?? 0) + 4 - (labelText?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((initialEditorBox?.y ?? 0) - (initialCanvasBox?.y ?? 0) + (initialEditorBox?.height ?? 0) / 2 + 0.5 - (labelText?.y ?? 0))).toBeLessThanOrEqual(1);
  const editorMetrics = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderLeftWidth: style.borderLeftWidth, paddingLeft: style.paddingLeft, fontSize: style.fontSize };
  });
  expect(editorMetrics).toEqual({ borderLeftWidth: "0px", paddingLeft: "4px", fontSize: "14px" });
  await editor.fill("오른쪽 경계에서도 차트 폭을 바꾸지 않는 설명");
  const editorBox = await editor.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect((editorBox?.x ?? 0) + (editorBox?.width ?? 0)).toBeLessThanOrEqual((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0));
  const after = await canvas.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
});

test("parallel arrow shortcut only affects the active chart", async ({ page }) => {
  await openFixtureCharts(page);

  let dock = await openDrawingDockForPanel(page, 0);
  await dock.getByRole("button", { name: "Trend Parallel", exact: true }).click();
  await expect(dock.getByRole("combobox", { name: "Parallel line count" })).toHaveValue("3");

  dock = await openDrawingDockForPanel(page, 1);
  await dock.getByRole("button", { name: "Trend Parallel", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(dock.getByRole("combobox", { name: "Parallel line count" })).toHaveValue("4");

  dock = await openDrawingDockForPanel(page, 0);
  await expect(dock.getByRole("combobox", { name: "Parallel line count" })).toHaveValue("3");
});

async function openDrawingDock(page: Page): Promise<Locator> {
  const chartPanel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await chartPanel.hover();
  await page.getByRole("button", { name: "차트 그리기 도구 열기" }).click({ force: true });
  const dock = page.getByRole("toolbar", { name: "Chart drawing tools" });
  await expect(dock).toBeVisible();
  return dock;
}

async function expectToolbarOrder(dock: Locator, labels: string[]): Promise<void> {
  const actual = await dock.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const indices = labels.map((label) => actual.indexOf(label));
  expect(indices.every((index) => index >= 0)).toBe(true);
  expect(indices).toEqual([...indices].sort((left, right) => left - right));
}

async function expectTwoLineGlyph(button: Locator, className: string): Promise<void> {
  const glyph = button.locator(`.${className}`);
  await expect(glyph).toHaveCount(1);
  const shadow = await glyph.evaluate((element) => getComputedStyle(element, "::before").boxShadow);
  expect(shadow).not.toBe("none");
  expect((shadow.match(/rgb\(/g) ?? []).length).toBe(1);
}

async function openDrawingDockForPanel(page: Page, index: number): Promise<Locator> {
  const chartPanel = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") }).nth(index);
  await chartPanel.hover();
  await chartPanel.getByRole("button", { name: "차트 그리기 도구 열기" }).click({ force: true });
  const dock = page.getByRole("toolbar", { name: "Chart drawing tools" });
  await expect(dock).toBeVisible();
  return dock;
}

async function openFixtureChart(page: Page): Promise<void> {
  await page.addInitScript(({ storageKey, storedLayout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, JSON.stringify(storedLayout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { storageKey: layoutStorageKey, storedLayout: chartOnlyLayout() });
  await page.goto("/?symbol=NVDA");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;}" });
  await expect(page.locator(".canvas-workspace.view-chart")).toBeVisible();
  await expectNonBlankCanvas(page.locator(".chart-canvas"));
}

async function openFixtureCharts(page: Page): Promise<void> {
  await page.addInitScript(({ storageKey, storedLayout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, JSON.stringify(storedLayout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { storageKey: layoutStorageKey, storedLayout: twoChartLayout() });
  await page.goto("/?symbol=NVDA");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;}" });
  const canvases = page.locator(".chart-canvas");
  await expect(canvases).toHaveCount(2);
  await expectNonBlankCanvas(canvases.nth(0));
  await expectNonBlankCanvas(canvases.nth(1));
}

function chartOnlyLayout(): Record<string, unknown> {
  return {
    version: 1,
    nextInstance: 2,
    contents: {
      "content-chart-1": {
        id: "content-chart-1",
        kind: "chart",
        title: "chart-1",
        instanceIndex: 1,
        layoutWeight: 100,
        props: { symbol: "NVDA", timeframe: "1m" },
        chartDocumentId: "drawing-tools-chart-document"
      }
    },
    slots: [{
      id: "slot-chart-1",
      contentId: "content-chart-1",
      gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 6 }
    }]
  };
}

function twoChartLayout(): Record<string, unknown> {
  return {
    version: 1,
    nextInstance: 3,
    contents: {
      "content-chart-1": {
        id: "content-chart-1",
        kind: "chart",
        title: "chart-1",
        instanceIndex: 1,
        layoutWeight: 50,
        props: { symbol: "NVDA", timeframe: "1m" },
        chartDocumentId: "drawing-tools-chart-document-1"
      },
      "content-chart-2": {
        id: "content-chart-2",
        kind: "chart",
        title: "chart-2",
        instanceIndex: 2,
        layoutWeight: 50,
        props: { symbol: "AAPL", timeframe: "1m" },
        chartDocumentId: "drawing-tools-chart-document-2"
      }
    },
    slots: [
      {
        id: "slot-chart-1",
        contentId: "content-chart-1",
        gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 6 }
      },
      {
        id: "slot-chart-2",
        contentId: "content-chart-2",
        gridRect: { col: 5, row: 1, colSpan: 4, rowSpan: 6 }
      }
    ]
  };
}

async function fulfillFixtureApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  if (url.pathname === "/api/auth/me") {
    payload = { authEnabled: false, user: null };
  } else if (url.pathname === "/api/charts/symbols") {
    payload = { symbols: [{ symbol: "NVDA", name: "NVIDIA" }, { symbol: "AAPL", name: "Apple" }] };
  } else if (url.pathname === "/api/charts/candles") {
    payload = candlePayload(url.searchParams.get("symbol") ?? "NVDA", url.searchParams.get("interval") ?? "1m");
  } else if (url.pathname === "/api/charts/indicators") {
    payload = indicatorPayload(url);
  } else if (url.pathname === "/api/watchlist") {
    payload = { symbols: [] };
  } else if (url.pathname === "/api/market/heatmap") {
    payload = { items: [] };
  } else if (url.pathname === "/api/market/indices") {
    payload = { items: [], refreshSeconds: 60, cacheStatus: "ready" };
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

function indicatorPayload(url: URL): Record<string, unknown> {
  const interval = url.searchParams.get("interval") ?? "1m";
  const candles = fixtureCandles(interval);
  const layerIds = (url.searchParams.get("layers") ?? "sma:5,sma:20,sma:60").split(",").filter(Boolean);
  const series = Object.fromEntries(layerIds.map((id) => [id, candles.map((candle) => ({
    timestamp: candle.timestamp,
    value: candle.close
  }))]));
  return {
    symbol: "NVDA",
    interval,
    calculationVersion: "drawing-fixture-v1",
    dataStatus: "ready",
    series,
    indicators: layerIds.map((id) => ({
      id,
      kind: id.split(":")[0],
      placement: "overlay",
      parameters: {},
      points: series[id]
    })),
    derived: { state: "ready", source: "redis", requestHash: "drawing-fixture-indicators" }
  };
}

function fixtureCandles(interval: string): Array<Record<string, number | string | boolean>> {
  const stepMinutes = ({ "1m": 1, "5m": 5, "10m": 10, "1h": 60, "4h": 240, "1D": 1_440, "1W": 10_080, "1M": 43_200 } as Record<string, number>)[interval] ?? 1;
  const start = Date.parse("2026-07-08T13:30:00.000Z");
  return Array.from({ length: 140 }, (_, index) => {
    const center = 150 + index * 0.075 + Math.sin(index / 5) * 2.2;
    const open = center - Math.sin(index / 3) * 0.52;
    const close = center + Math.cos(index / 4) * 0.58;
    return {
      timestamp: new Date(start + index * stepMinutes * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.75,
      close,
      volume: 600_000 + (index % 13) * 75_000,
      isClosed: true,
      ma5: center - 0.2,
      ma20: center - 0.65,
      ma60: center - 1.25
    };
  });
}

async function expectNonBlankCanvas(canvas: Locator): Promise<void> {
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

async function relativeCanvasPoint(canvas: Locator, xRatio: number, yRatio: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  return {
    x: Math.max(1, (box?.width ?? 1) * xRatio),
    y: Math.max(1, (box?.height ?? 1) * yRatio)
  };
}

async function installCanvasArcTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const trackedWindow = window as CanvasTrackingWindow;
    trackedWindow.__gopsDrawingArcCalls = [];
    trackedWindow.__gopsDrawingStrokeRectCalls = [];
    trackedWindow.__gopsDrawingTextCalls = [];
    const originalArc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function trackedArc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean
    ): void {
      if (this.canvas.classList.contains("chart-canvas")) {
        trackedWindow.__gopsDrawingArcCalls?.push({ x, y, radius });
      }
      originalArc.call(this, x, y, radius, startAngle, endAngle, counterclockwise);
    };
    const originalStrokeRect = CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect = function trackedStrokeRect(
      x: number,
      y: number,
      width: number,
      height: number
    ): void {
      if (this.canvas.classList.contains("chart-canvas")) {
        trackedWindow.__gopsDrawingStrokeRectCalls?.push({ x, y, width, height });
      }
      originalStrokeRect.call(this, x, y, width, height);
    };
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function trackedFillText(
      text: string,
      x: number,
      y: number,
      maxWidth?: number
    ): void {
      if (this.canvas.classList.contains("chart-canvas")) {
        trackedWindow.__gopsDrawingTextCalls?.push({ text, x, y });
      }
      if (maxWidth === undefined) {
        originalFillText.call(this, text, x, y);
      } else {
        originalFillText.call(this, text, x, y, maxWidth);
      }
    };
  });
}

async function resetCanvasTextCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as CanvasTrackingWindow).__gopsDrawingTextCalls = [];
  });
}

async function latestCanvasTextCall(page: Page, text: string): Promise<CanvasTextCall | null> {
  return page.evaluate((targetText) => {
    const calls = (window as CanvasTrackingWindow).__gopsDrawingTextCalls ?? [];
    return [...calls].reverse().find((call) => call.text === targetText) ?? null;
  }, text);
}

async function resetCanvasArcCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as CanvasTrackingWindow).__gopsDrawingArcCalls = [];
  });
}

async function uniqueRadiusFourArcCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const calls = (window as CanvasTrackingWindow).__gopsDrawingArcCalls ?? [];
    return new Set(
      calls
        .filter((call) => Math.abs(call.radius - 4) < 0.05)
        .map((call) => `${call.x.toFixed(1)}:${call.y.toFixed(1)}`)
    ).size;
  });
}

async function resetCanvasStrokeRectCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as CanvasTrackingWindow).__gopsDrawingStrokeRectCalls = [];
  });
}

async function nonEmptyStrokeRectCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    (window as CanvasTrackingWindow).__gopsDrawingStrokeRectCalls ?? []
  ).filter((call) => Math.abs(call.width) > 4 && Math.abs(call.height) > 4).length);
}
