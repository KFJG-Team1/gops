import { expect, test, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedBuild: unknown = null;

test.beforeEach(async ({ page }) => {
  postedBuild = null;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  await page.addInitScript(({ key, layout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(layout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { key: layoutStorageKey, layout: assetLayout() });
});

test("Czardas asset renders independent H-Line and Trend layers", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "240");
  await expect(page.locator(".chart-analysis-layer-controls")).toBeVisible();
  const sightLegend = page.getByLabel("Czardas 시각 범례");
  await expect(sightLegend).toBeVisible();
  await expect(sightLegend.getByTitle("확대 상태의 캔들 진하기")).toContainText("Shared+Trend");
  await expect(sightLegend.getByTitle("확대 상태의 고점·저점 국소 수평 흔적")).toContainText("Shared+H-Line");
  await expect(sightLegend.getByTitle("축소 상태에서 켜진 채널의 전체 의미")).toContainText("전체(축소)");
  const hline = page.getByRole("button", { name: "Czardas H-Line 끄기" });
  const trend = page.getByRole("button", { name: "Czardas Trend 끄기" });
  await expect(hline).toBeEnabled();
  await expect(trend).toBeEnabled();
  await hline.click();
  await expect(page.getByRole("button", { name: "Czardas H-Line 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(sightLegend.getByText("H-Line", { exact: true })).toHaveClass(/is-muted/);
  await expect(trend).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Czardas H-Line 켜기" }).click();
  await trend.click();
  await expect(page.getByRole("button", { name: "Czardas Trend 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(sightLegend.getByText("Trend", { exact: true })).toHaveClass(/is-muted/);
  await page.getByRole("button", { name: "Czardas Trend 켜기" }).click();
  await page.getByLabel("Chart type").selectOption("czardas", { force: true });
  await expect(page.getByLabel("Interval").locator('option[value="1M"]')).toBeDisabled();
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await canvas.press("End");
  const meaningOverlay = page.getByLabel("현재 240봉 기준 Czardas 캔들 해석");
  await expect(meaningOverlay).toBeVisible();
  await expect(page.getByText("현재 240봉 기준", { exact: true })).toBeVisible();
  await expect(meaningOverlay.getByText("240봉 내 전체 의미 백분위", { exact: false })).toBeVisible();
  await expect(meaningOverlay.getByText("진하기 Shared+Trend", { exact: true })).toBeVisible();
  await expect(meaningOverlay.getByText("짧은 수평 Shared+H-Line", { exact: true })).toBeVisible();
  await expect(meaningOverlay.getByText("축소 노랑 켜진 채널 전체", { exact: true })).toBeVisible();
  await expect(meaningOverlay.locator("[data-czardas-factor-key]")).toHaveCount(21);
  await expect(meaningOverlay.locator("[data-czardas-reason-code]")).toHaveCount(1);
  await expect(meaningOverlay.locator("details")).toHaveCount(0);
  await expect(meaningOverlay.locator("summary")).toHaveCount(0);
  await expect(page.getByText("시각 강도", { exact: true })).toHaveCount(0);
  const overlayLayout = await meaningOverlay.evaluate((element) => {
    const overlay = element.getBoundingClientRect();
    const canvasElement = document.querySelector(".chart-canvas");
    const canvas = canvasElement?.getBoundingClientRect();
    const style = getComputedStyle(element);
    const factors = Array.from(element.querySelectorAll("[data-czardas-factor-key]"), (factor) => {
      const bounds = factor.getBoundingClientRect();
      return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
    });
    return {
      canvas: canvas && canvasElement ? {
        top: canvas.top,
        right: canvas.right,
        bottom: canvas.bottom,
        left: canvas.left,
        scaleX: canvas.width / canvasElement.clientWidth,
        scaleY: canvas.height / canvasElement.clientHeight
      } : null,
      overlay: { top: overlay.top, right: overlay.right, bottom: overlay.bottom, left: overlay.left },
      style: {
        backgroundColor: style.backgroundColor,
        borderStyle: style.borderStyle,
        bottomInset: Number.parseFloat(style.getPropertyValue("--czardas-meaning-bottom")),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        pointerEvents: style.pointerEvents,
        rightInset: Number.parseFloat(style.getPropertyValue("--czardas-meaning-right"))
      },
      factors
    };
  });
  expect(overlayLayout.canvas).not.toBeNull();
  expect(overlayLayout.style.pointerEvents).toBe("none");
  expect(overlayLayout.style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(overlayLayout.style.borderStyle).toBe("none");
  expect(overlayLayout.style.overflowX).toBe("visible");
  expect(overlayLayout.style.overflowY).toBe("visible");
  expect(overlayLayout.style.rightInset).toBeGreaterThanOrEqual(80);
  expect(overlayLayout.style.bottomInset).toBeGreaterThanOrEqual(34);
  expect(Math.abs(overlayLayout.overlay.right - (
    (overlayLayout.canvas?.right ?? 0)
      - overlayLayout.style.rightInset * (overlayLayout.canvas?.scaleX ?? 1)
  ))).toBeLessThanOrEqual(.75);
  expect(Math.abs(overlayLayout.overlay.bottom - (
    (overlayLayout.canvas?.bottom ?? 0)
      - overlayLayout.style.bottomInset * (overlayLayout.canvas?.scaleY ?? 1)
  ))).toBeLessThanOrEqual(.75);
  expect(overlayLayout.factors.every((factor) => (
    factor.top >= (overlayLayout.canvas?.top ?? 0) - .5
      && factor.right <= overlayLayout.overlay.right + .5
      && factor.bottom <= overlayLayout.overlay.bottom + .5
      && factor.left >= overlayLayout.overlay.left - .5
  ))).toBe(true);
  await hline.click();
  const mutedHlineMeaning = meaningOverlay.locator('[data-czardas-channel="hline"]');
  await expect(mutedHlineMeaning).toHaveClass(/is-muted/);
  await expect(mutedHlineMeaning.locator("[data-czardas-factor-key]")).toHaveCount(7);
  await page.getByRole("button", { name: "Czardas H-Line 켜기" }).click();
  await page.screenshot({ path: `/tmp/chart-assets-v3-${testInfo.project.name}.png`, fullPage: true });

  const detailVisibleCount = Number(await chart.getAttribute("data-chart-visible-count"));
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 8; index += 1) {
      element.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.55,
        clientY: rect.top + rect.height * 0.45,
        deltaY: 70
      }));
    }
  });
  await expect.poll(async () => Number(await chart.getAttribute("data-chart-visible-count"))).toBeGreaterThan(detailVisibleCount);
  await page.screenshot({ path: `/tmp/chart-assets-v3-dense-${testInfo.project.name}.png`, fullPage: true });
});

test("Czardas meaning overlay keeps all evidence visible in compact plots", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one desktop project can exercise exact container sizes");
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await page.getByLabel("Chart type").selectOption("czardas", { force: true });
  await expect(page.getByRole("button", { name: "Czardas H-Line 끄기" })).toBeEnabled();
  await canvas.focus();
  await canvas.press("End");
  const meaningOverlay = page.getByLabel("현재 240봉 기준 Czardas 캔들 해석");
  await expect(meaningOverlay).toBeVisible();

  for (const size of [{ width: 520, height: 240 }, { width: 328, height: 110 }]) {
    await chart.evaluate((element, nextSize) => {
      const chartElement = element as HTMLElement;
      chartElement.style.width = `${nextSize.width}px`;
      chartElement.style.height = `${nextSize.height}px`;
    }, size);
    await expect.poll(() => chart.evaluate((element) => ({
      width: (element as HTMLElement).clientWidth,
      height: (element as HTMLElement).clientHeight
    }))).toEqual(size);
    await expect(meaningOverlay.locator("[data-czardas-factor-key]")).toHaveCount(21);
    const layout = await meaningOverlay.evaluate((element) => {
      const canvas = document.querySelector(".chart-canvas")?.getBoundingClientRect();
      const overlay = element.getBoundingClientRect();
      const evidence = Array.from(element.querySelectorAll(
        "[data-czardas-factor-key], [data-czardas-reason-code], .czardas-meaning-state"
      ), (item) => {
        const bounds = item.getBoundingClientRect();
        return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
      });
      return {
        canvas: canvas ? { top: canvas.top, right: canvas.right, bottom: canvas.bottom, left: canvas.left } : null,
        overlay: { top: overlay.top, right: overlay.right, bottom: overlay.bottom, left: overlay.left },
        evidence
      };
    });
    expect(layout.canvas).not.toBeNull();
    expect(layout.overlay.top).toBeGreaterThanOrEqual((layout.canvas?.top ?? 0) - .5);
    expect(layout.evidence.every((item) => (
      item.top >= (layout.canvas?.top ?? 0) - .5
        && item.right <= layout.overlay.right + .5
        && item.bottom <= layout.overlay.bottom + .5
        && item.left >= layout.overlay.left - .5
    ))).toBe(true);
  }
});

test("asset ops submits exactly one Czardas symbol and interval", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const ops = page.locator(".chart-asset-ops-panel");
  await expect(ops.getByText("종목 × interval 한 쌍", { exact: true })).toBeVisible();
  await ops.getByLabel("Czardas 분석 심볼").fill("NVDA");
  await ops.getByRole("button", { name: "분석 시작" }).click();
  await expect.poll(() => postedBuild).toEqual({ symbol: "NVDA", interval: "1D", force: false });
  await page.screenshot({ path: `/tmp/chart-assets-v3-ops-${testInfo.project.name}.png`, fullPage: true });
});

test("Czardas Field paint stays within the 8ms P95 gate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one stable desktop benchmark is sufficient");
  await page.goto("/?symbol=NVDA");
  const response = czardasResponse() as any;
  const pack = response.assets["1D"].pack;
  const result = await page.evaluate(async ({ candles: fixtureCandles, pack: fixturePack }) => {
    const [{ buildChartScene }, { drawCzardasField }] = await Promise.all([
      import("/src/chart/scene.ts"),
      import("/src/chart/ChartCanvas.tsx")
    ]);
    const chart = {
      symbol: "NVDA",
      chartType: "czardas",
      interval: "1D",
      candles: fixtureCandles,
      status: "ready",
      layers: { candles: true, volume: false },
      volumeRatio: .2,
      visibleCount: 120,
      rightOffset: 0,
      toolMode: "pan",
      trendLineExtension: "segment",
      parallelLineCount: 3,
      drawings: fixturePack.drawings,
      comparisons: [],
      streamState: "idle",
      czardasField: fixturePack.czardasField,
      czardasVisibility: { hline: true, trend: true },
      czardasPattern: fixturePack.presentationPattern,
      czardasAssetState: "current"
    } as any;
    const scene = buildChartScene(chart, 960, 520);
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 520;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context unavailable");
    for (let index = 0; index < 20; index += 1) drawCzardasField(context, scene);
    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const started = performance.now();
      drawCzardasField(context, scene);
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    return { p95: samples[Math.ceil(samples.length * .95) - 1], max: samples.at(-1) ?? 0 };
  }, { candles, pack });
  testInfo.annotations.push({ type: "performance", description: `Field paint P95 ${result.p95.toFixed(3)}ms` });
  console.log(`Czardas Field paint P95 ${result.p95.toFixed(3)}ms`);
  expect(result.p95, `Field paint samples max=${result.max.toFixed(3)}ms`).toBeLessThanOrEqual(8);
});

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  let status = 200;
  if (url.pathname === "/api/auth/me") payload = { authEnabled: false, user: null };
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload();
  else if (url.pathname === "/api/charts/czardas-assets") payload = czardasResponse();
  else if (url.pathname === "/api/charts/czardas-assets/build" && request.method() === "POST") {
    const body = request.postDataJSON();
    postedBuild = body;
    status = 503;
    payload = { detail: "fixture queue disabled" };
  } else if (url.pathname === "/api/charts/indicators") payload = { symbol: "NVDA", interval: "1D", series: {} };
  else if (url.pathname === "/api/charts/volume-profile-bins") payload = { bins: [] };
  else if (url.pathname === "/api/watchlist") payload = { symbols: [] };
  else if (url.pathname === "/api/market/heatmap") payload = { items: [] };
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

function candlePayload(): Record<string, unknown> {
  return {
    symbol: "NVDA", interval: "1D", request: { limit: candles.length }, status: "ready", dataStatus: "ready",
    source: "fixture", feed: "sip", candles, indicators: { ma: [5, 20, 60], volume: true }, requestedLimit: candles.length,
    returnedCount: candles.length, hasMoreBefore: false, hasMoreAfter: false, fill: { status: "not_needed", renderable: true },
    canonicalSnapshot: {
      inputContractVersion: "canonical-ohlcv-q8-v1", asOf: candles[239].timestamp,
      lastCandleKey: candles[239].timestamp.slice(0, 10), completedCount: 240,
      inputDigest: "sha256:3470968e8386454c083521d7452eea035f5fba92074648e7bed1d4377bd8d72c"
    }
  };
}

function fixtureCandles() {
  const start = Date.parse("2026-02-20T00:00:00.000Z");
  return Array.from({ length: 240 }, (_, index) => {
    const close = 150 + index * .12 + Math.sin(index / 5) * 2;
    return { timestamp: new Date(start + index * 86_400_000).toISOString(), open: close - .4, high: close + 1, low: close - 1, close, volume: 1_000_000 + index * 1000, isClosed: true };
  });
}

function czardasResponse(): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp ?? "";
  const windowFromTimestamp = candles[0].timestamp;
  const windowToTimestamp = candles[239].timestamp;
  const inferenceId = "sha256:czardas-v3-fixture-inference";
  const hline = czardasDrawing("support", "hline", [
    { timestamp: candles[40].timestamp, price: 158 },
    { timestamp: asOf, price: 158 }
  ], undefined, inferenceId);
  const upper = czardasDrawing("upper", "trend", [
    { timestamp: candles[40].timestamp, price: 178 },
    { timestamp: asOf, price: 176 }
  ], "triangle-fixture", inferenceId);
  const lower = czardasDrawing("lower", "trend", [
    { timestamp: candles[40].timestamp, price: 158 },
    { timestamp: asOf, price: 174 }
  ], "triangle-fixture", inferenceId);
  const trendLine = (fromPrice: number, toPrice: number) => ({
    fromTimestamp: windowFromTimestamp,
    fromPrice,
    toTimestamp: windowToTimestamp,
    toPrice
  });
  const trendMode = (candidateId: "upper" | "lower", fromPrice: number, toPrice: number) => ({
    fieldModeId: `mode-${candidateId}`,
    derivationDigest: `sha256:mode-${candidateId}`,
    role: candidateId,
    modeState: "coherent",
    viewRole: "landscape_and_selected",
    windowFromTimestamp,
    windowToTimestamp,
    hypothesisMedoid: trendLine(fromPrice, toPrice),
    boundaryEstimate: trendLine(fromPrice, toPrice),
    ribbon: {
      fromTimestamp: windowFromTimestamp,
      lowerFromPrice: fromPrice - .5,
      upperFromPrice: fromPrice + .5,
      toTimestamp: windowToTimestamp,
      lowerToPrice: toPrice - .5,
      upperToPrice: toPrice + .5
    },
    supportMass: 2.2,
    oppositionMass: .2,
    contributorBasisIndexes: [candidateId === "upper" ? 1 : 2],
    contributorCount: 1,
    representativeHypotheses: [{
      hypothesisId: `hyp-${candidateId}`,
      sourceBasisIds: [],
      ...trendLine(fromPrice, toPrice),
      seedMass: 1
    }]
  });
  const scaled = (value: number) => Array.from({ length: 240 }, () => value);
  const packed = (value: number | null) => {
    const bytes = new Uint8Array(480);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < 240; index += 1) view.setInt16(index * 2, value ?? -32768, false);
    return Buffer.from(bytes).toString("base64");
  };
  const rawFactorScales = {
    rangeAtr: 1000, absoluteReturnAtr: 1000, bodyFraction: 1000, lowerWickFraction: 1000,
    upperWickFraction: 1000, volumeRank: 1000, volumeZ: 1000, participation: 1000,
    localHighR2: 1000, localLowR2: 1000, localHighR5: 1000, localLowR5: 1000,
    localHighR13: 1000, localLowR13: 1000, supportProximity: 1000, resistanceProximity: 1000,
    lowerResidualAtr: 1000, upperResidualAtr: 1000, hlinePenetrationAtr: 1000, trendPenetrationAtr: 1000,
    reclaimStrength: 1000
  };
  const logFactorKeys = new Set(["rangeAtr", "absoluteReturnAtr", "lowerResidualAtr", "upperResidualAtr", "hlinePenetrationAtr", "trendPenetrationAtr"]);
  const rawFactorTransforms = Object.fromEntries(Object.keys(rawFactorScales).map((key) => [key, logFactorKeys.has(key) ? "log1p" : "linear"]));
  const rawFactorRanges = Object.fromEntries(Object.entries(rawFactorScales).map(([key, scale]) => {
    const limit = 32767 / scale;
    return [key, logFactorKeys.has(key) ? [0, Math.expm1(limit)] : [-limit, limit]];
  }));
  const factors = {
    rangeAtr: packed(Math.round(Math.log1p(.82) * 1000)), absoluteReturnAtr: packed(Math.round(Math.log1p(.36) * 1000)), bodyFraction: packed(520),
    lowerWickFraction: packed(240), upperWickFraction: packed(240), volumeRank: packed(650),
    volumeZ: packed(180), participation: packed(590), localHighR2: packed(320), localLowR2: packed(280),
    localHighR5: packed(350), localLowR5: packed(300), localHighR13: packed(380), localLowR13: packed(340),
    supportProximity: packed(430), resistanceProximity: packed(310), lowerResidualAtr: packed(Math.round(Math.log1p(.4) * 1000)),
    upperResidualAtr: packed(Math.round(Math.log1p(.5) * 1000)), hlinePenetrationAtr: packed(Math.round(Math.log1p(.2) * 1000)), trendPenetrationAtr: packed(Math.round(Math.log1p(.3) * 1000)),
    reclaimStrength: packed(460)
  };
  const normalizedFactors = Object.fromEntries(Object.keys(factors).map((key) => [key, packed(500)]));
  const packedReasonMasks = (codes: number[]) => {
    const bytes = new Uint8Array(960);
    const view = new DataView(bytes.buffer);
    const mask = codes.reduce((value, code) => (value | (2 ** code)) >>> 0, 0);
    for (let index = 0; index < 240; index += 1) view.setUint32(index * 4, mask, false);
    return Buffer.from(bytes).toString("base64");
  };
  const selectedRefs = [
    { candidateId: "support", sourceInferenceId: inferenceId, kind: "hline", sourceFieldModeId: "mode-support", sourceFieldDerivationDigest: "sha256:mode-support" },
    { candidateId: "upper", sourceInferenceId: inferenceId, kind: "trend", sourceFieldModeId: "mode-upper", sourceFieldDerivationDigest: "sha256:mode-upper" },
    { candidateId: "lower", sourceInferenceId: inferenceId, kind: "trend", sourceFieldModeId: "mode-lower", sourceFieldDerivationDigest: "sha256:mode-lower" }
  ];
  const boundary = (candidateId: "support" | "upper" | "lower", kind: "hline" | "trend", role: "support" | "upper" | "lower", price: number) => ({
    candidateId,
    sourceInferenceId: inferenceId,
    sourceFieldModeId: `mode-${candidateId}`,
    sourceFieldDerivationDigest: `sha256:mode-${candidateId}`,
    kind,
    role,
    evidenceState: "formed",
    isRelevantNow: true,
    formation: {
      initialFormationEpisodeIds: [`episode-${candidateId}-1`, `episode-${candidateId}-2`],
      fitEpisodeIds: [`episode-${candidateId}-1`, `episode-${candidateId}-2`],
      fitCount: 2,
      lastFitObservedAt: candles[80].timestamp, fitEvidenceConfirmedAt: candles[82].timestamp, seedQuality: .8
    },
    responses: { completedCount: 0, pendingCount: 0, lastInteractionAt: null, responseMass: 0 },
    rank: {
      rankScore: .8, responseCount: 0, responseMass: 0, responseBonus: 0, profileBonus: 0,
      integrityFactCount: 8, integrityEffectiveFactCount: 7.2, integrityCoverage: 1,
      bodyPenetrationCount: 1, closePenetrationCount: 0
    },
    line: { priceAtAsOf: price, slopePerBar: kind === "trend" ? .01 : 0, zoneHalfWidth: .5 },
    explanation: { claim: "현재 경계", because: ["구조적 근거"], against: [], state: "formed", invalidationCondition: "경계 이탈", dataQualifier: "OHLCV" }
  });
  const pack = {
    algorithmVersion: "czardas-v3",
    configVersion: "czardas-config-v3",
    inputContractVersion: "canonical-ohlcv-q8-v1",
    timeContractVersion: "market-time-v1",
    calendarVersion: "nyse-calendar-v1",
    inferenceConfigDigest: "sha256:inference-config",
    projectionConfigDigest: "sha256:projection-config",
    sightProjectionVersion: "czardas-sight-v2",
    sightProjectionId: "sha256:sight-projection",
    symbol: "NVDA",
    interval: "1D",
    asOf,
    lastCandleKey: asOf.slice(0, 10),
    // Python CandleTape canonical digest for fixtureCandles(). This keeps the
    // visual fixture subject to the same panel snapshot binding as production.
    inputDigest: "sha256:3470968e8386454c083521d7452eea035f5fba92074648e7bed1d4377bd8d72c",
    inferenceId,
    status: "ready",
    coverage: { state: "exact", targetCompleted: 240, actualCompleted: 240, analysisBars: 240, qualityFlags: [] },
    selection: { hline: { configuredCount: 2, actualCount: 1 }, trend: { configuredCount: 2, actualCount: 2 } },
    boundaries: [boundary("support", "hline", "support", 158), boundary("upper", "trend", "upper", 176), boundary("lower", "trend", "lower", 174)],
    presentationPattern: {
      triangleId: "triangle-fixture",
      kind: "ascending_triangle",
      upperCandidateId: "upper",
      lowerCandidateId: "lower",
      upperDrawingId: upper.id,
      lowerDrawingId: lower.id
    },
    drawings: [hline, upper, lower],
    czardasField: {
      schemaVersion: 3,
      inputContractVersion: "canonical-ohlcv-q8-v1",
      inferenceConfigDigest: "sha256:inference-config",
      projectionConfigDigest: "sha256:projection-config",
      sightProjectionVersion: "czardas-sight-v2",
      sightProjectionId: "sha256:sight-projection",
      sourceBars: 240,
      evaluationAsOf: asOf,
      sourceInferenceId: inferenceId,
      windowFromTimestamp,
      windowToTimestamp,
      candleMeanings: {
        evaluationAsOf: asOf,
        rawFactorScales,
        rawFactorTransforms,
        normalizedFactorScale: 1000,
        scoreScale: 1000,
        rawFactorEncoding: "int16-base64-be",
        normalizedFactorEncoding: "int16-base64-be",
        rawFactorNullSentinel: -32768,
        normalizedFactorNullSentinel: -32768,
        rawFactorRanges,
        rawFactorOverflowPolicy: "reject",
        candleKeys: candles.map((item) => item.timestamp.slice(0, 10)),
        timestamps: candles.map((item) => item.timestamp),
        summaries: { shared: scaled(520), hline: scaled(480), trend: scaled(610), compositePercentile: candles.map((_, index) => Math.round(index / 239 * 1000)) },
        roles: { support: scaled(420), resistance: scaled(280), lower: scaled(450), upper: scaled(610) },
        factors,
        normalizedFactors,
        availabilityMasks: scaled(7),
        phaseMasks: scaled(31),
        availabilityCodebook: { atr: 1, volumeBaseline: 2, rightContext: 4 },
        phaseCodebook: { geometryInput: 1, fit: 2, integrity: 4, response: 8, visualizationOnly: 16, confirmationPending: 32 },
        reasonCodebook: [{ code: 1, key: "range_expansion", label: "변동폭 확장", usage: "geometry_input", channel: "shared" }],
        reasonEncoding: "uint32-bitmask-base64-be",
        reasonMasks: packedReasonMasks([1])
      },
      basisFacts: {
        basisIds: ["basis-h", "basis-u", "basis-l"],
        roleCodes: [0, 3, 2],
        observedIndexes: [40, 55, 60],
        confirmedIndexes: [42, 57, 62],
        endpointPrices: [158, 177.5, 161.2],
        bodyEdgePrices: [158, 177, 161.5],
        corridorLows: [157.7, 177.2, 160.9],
        corridorHighs: [158.3, 177.8, 161.5],
        roleMasses: [.9, .85, .82],
        participations: [.8, null, null],
        effectiveScales: [13, 5, 5],
        roleCodebook: { support: 0, resistance: 1, lower: 2, upper: 3 }
      },
      basisGlyphs: [
        { basisId: "basis-h", observedAt: candles[40].timestamp, confirmedAt: candles[42].timestamp, endpointPrice: 158, corridorLow: 157.7, corridorHigh: 158.3, kind: "hline_reaction", role: "support", effectiveScale: 13, roleMassAtAsOf: .9, participation: .8 },
        { basisId: "basis-u", observedAt: candles[55].timestamp, confirmedAt: candles[57].timestamp, endpointPrice: 177.5, corridorLow: 177.2, corridorHigh: 177.8, kind: "trend_endpoint", role: "upper", effectiveScale: 5, roleMassAtAsOf: .85 },
        { basisId: "basis-l", observedAt: candles[60].timestamp, confirmedAt: candles[62].timestamp, endpointPrice: 161.2, corridorLow: 160.9, corridorHigh: 161.5, kind: "trend_endpoint", role: "lower", effectiveScale: 5, roleMassAtAsOf: .82 }
      ],
      hlineResponseSegments: [{ segmentId: "response-h", role: "support", lowPrice: 157.5, highPrice: 158.5, responseMass: 2.4, activeBasisCount: 3, windowFromTimestamp, windowToTimestamp }],
      hlineProfileBins: [{ lowPrice: 157, highPrice: 159, normalizedVolume: .8 }],
      hlineModes: [{ fieldModeId: "mode-support", derivationDigest: "sha256:mode-support", role: "support", modeState: "coherent", viewRole: "landscape_and_selected", centerPrice: 158, zoneHalfWidth: .45, ridge: { lowPrice: 157.5, highPrice: 158.5 }, supportMass: 2.4, oppositionMass: .1, contributorBasisIndexes: [0], contributorCount: 1, windowFromTimestamp, windowToTimestamp }],
      trendModes: [
        trendMode("upper", 178, 176),
        trendMode("lower", 158, 174)
      ],
      selectedModeRefs: selectedRefs,
      derivationEpisodes: {
        candidateIndexes: [0, 0, 1, 1, 2, 2],
        candidateEpisodeOrdinals: [0, 1, 0, 1, 0, 1],
        contributionBasisIndexes: [0, 0, 1, 1, 2, 2],
        memberBasisIndexes: [[0], [0], [1], [1], [2], [2]],
        observedFromIndexes: [40, 44, 55, 59, 60, 64],
        observedToIndexes: [40, 44, 55, 59, 60, 64],
        confirmedIndexes: [42, 46, 57, 61, 62, 66],
        contributionIndexes: [40, 44, 55, 59, 60, 64],
        contributionPrices: [158, 158, 177.5, 177.5, 161.2, 161.2],
        corridorLows: [157.7, 157.7, 177.2, 177.2, 160.9, 160.9],
        corridorHighs: [158.3, 158.3, 177.8, 177.8, 161.5, 161.5],
        initialFormationMasks: [1, 1, 1, 1, 1, 1]
      },
      validationGlyphs: [],
      relationGlyph: { triangleId: "triangle-fixture", upperCandidateId: "upper", lowerCandidateId: "lower", relationFrom: candles[40].timestamp, contractionRatio: .4 }
    },
    rejectSummary: {}
  };
  return {
    symbol: "NVDA",
    assets: { "1D": { freshness: "current", freshnessReason: "identity_match", generatedAt: asOf, pack } },
    meta: { servedAt: asOf }
  };
}

function czardasDrawing(
  candidateId: string,
  layer: "hline" | "trend",
  anchors: Array<{ timestamp: string; price: number }>,
  groupId?: string,
  inferenceId = "sha256:czardas-v3-fixture-inference"
) {
  return {
    id: `czardas:${candidateId}:line`,
    type: layer === "hline" ? "horizontalLine" : "trendLine",
    anchors,
    symbol: "NVDA",
    interval: "1D",
    sourceInterval: "1D",
    style: { colorToken: "drawing", lineWidth: groupId ? 3 : 2, extension: layer === "hline" ? "line" : "ray" },
    label: "",
    locked: false,
    visible: true,
    createdBy: "system",
    ownership: "czardas-managed",
    czardasLayer: layer,
    sourceInferenceId: inferenceId,
    sourceCandidateId: candidateId,
    sourceFieldModeId: `mode-${candidateId}`,
    sourceFieldDerivationDigest: `sha256:mode-${candidateId}`,
    sourceGroupId: groupId,
    createdAt: candles[40].timestamp,
    updatedAt: candles.at(-1)?.timestamp
  };
}

function assetLayout(): Record<string, unknown> {
  const contents = [
    content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart"),
    content("chartCommentary", 2, {}),
    content("chartAssetOps", 3, {})
  ];
  return { version: 1, nextInstance: 4, contents: Object.fromEntries(contents.map((item) => [item.id, item])), slots: [slot("chart", 1, 1, 1, 5, 6), slot("chartCommentary", 2, 6, 1, 3, 3), slot("chartAssetOps", 3, 6, 4, 3, 3)] };
}

function content(kind: string, index: number, props: Record<string, unknown>, chartDocumentId?: string) {
  return { id: `content-${kind}-${index}`, kind, title: `${kind}-${index}`, instanceIndex: index, layoutWeight: kind === "chart" ? 100 : 50, props, ...(chartDocumentId ? { chartDocumentId } : {}) };
}

function slot(kind: string, index: number, col: number, row: number, colSpan: number, rowSpan: number) {
  return { id: `slot-${kind}-${index}`, contentId: `content-${kind}-${index}`, gridRect: { col, row, colSpan, rowSpan } };
}
