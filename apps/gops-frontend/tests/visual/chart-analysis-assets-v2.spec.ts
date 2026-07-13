import { expect, test, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedSymbols: unknown = null;
let postedAssetKind: unknown = null;

test.beforeEach(async ({ page }) => {
  postedSymbols = null;
  postedAssetKind = null;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  await page.addInitScript(({ key, layout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(layout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { key: layoutStorageKey, layout: assetLayout() });
});

test("czardas asset renders independent H-Line and Trend layers", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.locator(".chart-analysis-layer-controls")).toBeVisible();
  const hline = page.getByRole("button", { name: "Czardas H-Line 끄기" });
  const trend = page.getByRole("button", { name: "Czardas Trend 끄기" });
  await expect(hline).toBeEnabled();
  await expect(trend).toBeEnabled();
  await hline.click();
  await expect(page.getByRole("button", { name: "Czardas H-Line 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(trend).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Czardas H-Line 켜기" }).click();
  await trend.click();
  await expect(page.getByRole("button", { name: "Czardas Trend 켜기" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Czardas Trend 켜기" }).click();
  await page.getByLabel("Chart type").selectOption("czardas", { force: true });
  await expect(page.getByLabel("Interval").locator('option[value="1M"]')).toBeDisabled();
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: `/tmp/chart-assets-v2-${testInfo.project.name}.png`, fullPage: true });
});

test("asset ops separates Czardas exact-pair and Geometry batch builds", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const ops = page.locator(".chart-asset-ops-panel");
  await expect(ops.getByText("콤마로 구분", { exact: true })).toBeVisible();
  await expect(ops.getByText("갱신 스킵(시간)", { exact: true })).toHaveCount(0);
  await expect(ops.getByText("신선 자산 스킵(시간)", { exact: true })).toHaveCount(0);
  await ops.getByLabel("빌드 심볼").fill("NVDA,AAPL, MSFT");
  await ops.getByRole("button", { name: "빌드 시작" }).click();
  await expect(ops.getByRole("alert")).toContainText("종목 1개와 interval 1개");
  expect(postedSymbols).toBeNull();
  await ops.getByRole("button", { name: "Geometry", exact: true }).click();
  await ops.getByRole("button", { name: "빌드 시작" }).click();
  await expect.poll(() => postedSymbols).toEqual(["NVDA", "AAPL", "MSFT"]);
  expect(postedAssetKind).toBe("geometry");
  const universeRow = ops.locator(".chart-asset-ops-universe-row");
  const rowBox = await universeRow.boundingBox();
  const hintBox = await ops.getByText("콤마로 구분", { exact: true }).boundingBox();
  expect(rowBox).not.toBeNull();
  expect(hintBox).not.toBeNull();
  if (rowBox && hintBox) expect(Math.abs((hintBox.x + hintBox.width) - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `/tmp/chart-assets-v2-ops-${testInfo.project.name}.png`, fullPage: true });
});

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  let status = 200;
  if (url.pathname === "/api/auth/me") payload = { authEnabled: false, user: null };
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload();
  else if (url.pathname === "/api/charts/analysis-assets") {
    payload = url.searchParams.get("assetKind") === "czardas" ? czardasResponse() : assetResponse();
  }
  else if (url.pathname === "/api/charts/analysis-assets/coverage") payload = { items: [], total: 0 };
  else if (url.pathname === "/api/charts/analysis-assets/build" && request.method() === "POST") {
    const body = request.postDataJSON();
    postedSymbols = body.symbols;
    postedAssetKind = body.assetKind;
    status = 503;
    payload = { detail: "fixture queue disabled" };
  } else if (url.pathname === "/api/charts/indicators") payload = { symbol: "NVDA", interval: "1D", series: {} };
  else if (url.pathname === "/api/charts/volume-profile-bins") payload = { bins: [] };
  else if (url.pathname === "/api/watchlist") payload = { symbols: [] };
  else if (url.pathname === "/api/market/heatmap") payload = { items: [] };
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

function candlePayload(): Record<string, unknown> {
  return { symbol: "NVDA", interval: "1D", request: { limit: candles.length }, status: "ready", dataStatus: "ready", source: "fixture", feed: "sip", candles, indicators: { ma: [5, 20, 60], volume: true }, requestedLimit: candles.length, returnedCount: candles.length, hasMoreBefore: false, hasMoreAfter: false, fill: { status: "not_needed", renderable: true } };
}

function fixtureCandles() {
  const start = Date.parse("2026-02-20T00:00:00.000Z");
  return Array.from({ length: 140 }, (_, index) => {
    const close = 150 + index * .12 + Math.sin(index / 5) * 2;
    return { timestamp: new Date(start + index * 86_400_000).toISOString(), open: close - .4, high: close + 1, low: close - 1, close, volume: 1_000_000 + index * 1000, isClosed: true };
  });
}

function drawing(id: string, type: string, anchors: Array<Record<string, unknown>>, label: string, color: string) {
  return { id, type, anchors, symbol: "NVDA", interval: "1D", sourceInterval: "1D", style: { color, lineWidth: 2, opacity: .95 }, label, locked: false, visible: true, createdBy: "system", sourceProposalId: "chart-asset:NVDA:1D:test", createdAt: candles.at(-1)?.timestamp, updatedAt: candles.at(-1)?.timestamp };
}

function assetResponse(): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp;
  const hline = drawing("chart-asset:NVDA:1D:support", "horizontalLine", [{ timestamp: candles[50].timestamp, price: 164 }, { timestamp: candles[100].timestamp, price: 164 }], "지지", "#22c55e");
  const upper = drawing("chart-asset:NVDA:1D:triangle-upper", "trendLine", [{ timestamp: candles[40].timestamp, price: 178 }, { timestamp: candles[139].timestamp, price: 178 }], "상승 삼각형 · 형성 중", "#22c55e");
  const lower = drawing("chart-asset:NVDA:1D:triangle-lower", "trendLine", [{ timestamp: candles[40].timestamp, price: 158 }, { timestamp: candles[139].timestamp, price: 174 }], "상승 삼각형 · 형성 중", "#22c55e");
  const asset = { assetVersion: "geometry", algorithmVersion: "ohlcv-consensus-1", symbol: "NVDA", interval: "1D", sourceInterval: "1D", asOf, generatedAt: asOf, status: "ready", inputDigest: "sha256:fixture", coverage: { state: "partial", targetBars: 380, actualBars: 140, contiguousBars: 140, missingBars: 240 }, geometry: { drawings: [hline, upper, lower], supports: [{ id: "support", role: "support", price: 164, score: .8, touches: 2, anchors: hline.anchors }], resistances: [], primaryTriangle: { kind: "ascending_triangle", state: "forming", score: .9, touches: 5, geometryHash: "triangle" }, historicalTriangle: null }, indicators: { sma60: 170, sma120: 165, cross: { status: "none", direction: null } } };
  return { symbol: "NVDA", assets: { "1D": asset }, meta: { servedAt: asOf } };
}

function czardasResponse(): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp ?? "";
  const hline = czardasDrawing("support", "hline", [
    { timestamp: candles[40].timestamp, price: 158 },
    { timestamp: asOf, price: 158 }
  ]);
  const upper = czardasDrawing("upper", "trend", [
    { timestamp: candles[40].timestamp, price: 178 },
    { timestamp: asOf, price: 176 }
  ], "triangle-fixture");
  const lower = czardasDrawing("lower", "trend", [
    { timestamp: candles[40].timestamp, price: 158 },
    { timestamp: asOf, price: 174 }
  ], "triangle-fixture");
  const pack = {
    algorithmVersion: "czardas-v1",
    configVersion: "czardas-config-v1",
    timeContractVersion: "market-time-v1",
    calendarVersion: "nyse-calendar-v1",
    symbol: "NVDA",
    interval: "1D",
    asOf,
    lastCandleKey: asOf.slice(0, 10),
    inputDigest: "sha256:czardas-fixture",
    status: "ready",
    coverage: { state: "exact", targetCompleted: 240, actualCompleted: 240, analysisBars: 240, qualityFlags: [] },
    selection: { hline: { configuredCount: 2, actualCount: 1 }, trend: { configuredCount: 2, actualCount: 2 } },
    boundaries: [],
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
      schemaVersion: 1,
      sourceBars: 240,
      basisGlyphs: [
        { basisId: "basis-h", observedAt: candles[40].timestamp, confirmedAt: candles[42].timestamp, endpointPrice: 158, corridorLow: 157.7, corridorHigh: 158.3, kind: "hline_reaction", role: "support", effectiveScale: 13, roleMassAtAsOf: .9, participation: .8 },
        { basisId: "basis-u", observedAt: candles[55].timestamp, confirmedAt: candles[57].timestamp, endpointPrice: 177.5, corridorLow: 177.2, corridorHigh: 177.8, kind: "trend_endpoint", role: "upper", effectiveScale: 5, roleMassAtAsOf: .85 },
        { basisId: "basis-l", observedAt: candles[60].timestamp, confirmedAt: candles[62].timestamp, endpointPrice: 161.2, corridorLow: 160.9, corridorHigh: 161.5, kind: "trend_endpoint", role: "lower", effectiveScale: 5, roleMassAtAsOf: .82 }
      ],
      hlineResponseSegments: [{ segmentId: "response-h", role: "support", lowPrice: 157.5, highPrice: 158.5, responseMass: 2.4, activeBasisCount: 3 }],
      hlineProfileBins: [{ lowPrice: 157, highPrice: 159, normalizedVolume: .8 }],
      hlineModes: [{ fieldModeId: "mode-support", fieldRevision: 1, role: "support", modeState: "coherent", centerPrice: 158, zoneHalfWidth: .45, ridge: { lowPrice: 157.5, highPrice: 158.5 }, supportMass: 2.4 }],
      trendModes: [
        { fieldModeId: "mode-upper", fieldRevision: 1, role: "upper", modeState: "coherent", hypothesisMedoid: { yAtWindowStart: 178, yAtWindowEnd: 176 }, ribbon: { lowerYAtWindowStart: 177.5, upperYAtWindowStart: 178.5, lowerYAtWindowEnd: 175.5, upperYAtWindowEnd: 176.5 }, representativeHypotheses: [{ hypothesisId: "hyp-upper", yAtWindowStart: 178, yAtWindowEnd: 176 }] },
        { fieldModeId: "mode-lower", fieldRevision: 1, role: "lower", modeState: "coherent", hypothesisMedoid: { yAtWindowStart: 158, yAtWindowEnd: 174 }, ribbon: { lowerYAtWindowStart: 157.5, upperYAtWindowStart: 158.5, lowerYAtWindowEnd: 173.5, upperYAtWindowEnd: 174.5 }, representativeHypotheses: [{ hypothesisId: "hyp-lower", yAtWindowStart: 158, yAtWindowEnd: 174 }] }
      ],
      selectedModeRefs: [
        { candidateId: "support", sourceFieldModeId: "mode-support", sourceFieldRevision: 1 },
        { candidateId: "upper", sourceFieldModeId: "mode-upper", sourceFieldRevision: 1 },
        { candidateId: "lower", sourceFieldModeId: "mode-lower", sourceFieldRevision: 1 }
      ],
      validationGlyphs: [],
      relationGlyph: { triangleId: "triangle-fixture", upperCandidateId: "upper", lowerCandidateId: "lower", relationFrom: candles[40].timestamp, contractionRatio: .4 }
    },
    rejectSummary: {}
  };
  return {
    assetKind: "czardas",
    symbol: "NVDA",
    assets: { "1D": { freshness: "current", generatedAt: asOf, pack } },
    meta: { servedAt: asOf }
  };
}

function czardasDrawing(
  candidateId: string,
  layer: "hline" | "trend",
  anchors: Array<{ timestamp: string; price: number }>,
  groupId?: string
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
    sourceCandidateId: candidateId,
    sourceFieldModeId: `mode-${candidateId}`,
    sourceFieldRevision: 1,
    sourceGroupId: groupId,
    engineRevision: 1,
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
