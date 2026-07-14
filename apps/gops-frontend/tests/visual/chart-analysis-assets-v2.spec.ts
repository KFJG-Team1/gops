import { expect, test, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedSymbols: unknown = null;

test.beforeEach(async ({ page }) => {
  postedSymbols = null;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  await page.addInitScript(({ key, layout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(layout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { key: layoutStorageKey, layout: assetLayout() });
});

test("geometry asset renders one layer and interval-bound drawings", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.locator(".chart-analysis-layer-controls")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Geometry 분석 레이어 끄기" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.getByRole("button", { name: "Geometry 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Geometry 분석 레이어 켜기" }).click();
  await expect(page.getByText(/상승 삼각형 · 형성 중/).first()).toBeVisible();
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: `/tmp/chart-assets-v2-${testInfo.project.name}.png`, fullPage: true });
});

test("asset ops wording and comma-separated input remain readable", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const ops = page.locator(".chart-asset-ops-panel");
  await expect(ops.getByText("콤마로 구분", { exact: true })).toBeVisible();
  await expect(ops.getByText("갱신 스킵(시간)", { exact: true })).toHaveCount(0);
  await expect(ops.getByText("신선 자산 스킵(시간)", { exact: true })).toHaveCount(0);
  await ops.getByLabel("빌드 심볼").fill("NVDA,AAPL, MSFT");
  await ops.getByRole("button", { name: "빌드 시작" }).click();
  await expect.poll(() => postedSymbols).toEqual(["NVDA", "AAPL", "MSFT"]);
  const universeRow = ops.locator(".chart-asset-ops-universe-row");
  const rowBox = await universeRow.boundingBox();
  const hintBox = await ops.getByText("콤마로 구분", { exact: true }).boundingBox();
  expect(rowBox).not.toBeNull();
  expect(hintBox).not.toBeNull();
  if (rowBox && hintBox) expect(Math.abs((hintBox.x + hintBox.width) - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `/tmp/chart-assets-v2-ops-${testInfo.project.name}.png`, fullPage: true });
});

test("pattern symbol panel filters active patterns and opens the matching chart interval", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const panel = page.locator(".chart-pattern-list-panel");
  await expect(panel.getByText("AAPL", { exact: true })).toBeVisible();
  await expect(panel.getByText("상승 삼각형 · 돌파 확인", { exact: true })).toBeVisible();
  await panel.getByLabel("패턴 종목 검색").fill("MSFT");
  await expect(panel.getByText("MSFT", { exact: true })).toBeVisible();
  await expect(panel.getByText("AAPL", { exact: true })).toHaveCount(0);
  await panel.getByLabel("패턴 종목 검색").fill("");
  await panel.locator('[data-pattern-symbol="AAPL"][data-pattern-interval="1m"]').click();
  await expect(page).toHaveURL(/symbol=AAPL/);
  await expect(page.getByRole("combobox", { name: "Interval" })).toContainText("1m");
  await expect(panel.locator('[data-pattern-symbol="AAPL"][data-pattern-interval="1m"]')).toHaveClass(/is-active/);
  await page.screenshot({ path: `/tmp/chart-pattern-list-${testInfo.project.name}.png`, fullPage: true });
});

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  let status = 200;
  if (url.pathname === "/api/auth/me") payload = { authEnabled: false, user: null };
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload(url.searchParams.get("symbol") ?? "NVDA", url.searchParams.get("interval") ?? "1D");
  else if (url.pathname === "/api/charts/analysis-assets") payload = url.searchParams.get("symbol") === "NVDA" ? assetResponse() : { symbol: url.searchParams.get("symbol"), assets: {}, meta: {} };
  else if (url.pathname === "/api/charts/analysis-assets/coverage") payload = patternCoverageResponse();
  else if (url.pathname === "/api/charts/analysis-assets/build" && request.method() === "POST") {
    postedSymbols = request.postDataJSON().symbols;
    status = 503;
    payload = { detail: "fixture queue disabled" };
  } else if (url.pathname === "/api/charts/indicators") payload = { symbol: "NVDA", interval: "1D", series: {} };
  else if (url.pathname === "/api/charts/volume-profile-bins") payload = { bins: [] };
  else if (url.pathname === "/api/watchlist") payload = { symbols: [] };
  else if (url.pathname === "/api/market/heatmap") payload = { items: [] };
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

function candlePayload(symbol: string, interval: string): Record<string, unknown> {
  return { symbol, interval, request: { limit: candles.length }, status: "ready", dataStatus: "ready", source: "fixture", feed: "sip", candles, indicators: { ma: [5, 20, 60], volume: true }, requestedLimit: candles.length, returnedCount: candles.length, hasMoreBefore: false, hasMoreAfter: false, fill: { status: "not_needed", renderable: true } };
}

function patternCoverageResponse(): Record<string, unknown> {
  return {
    items: [
      { symbol: "AAPL", interval: "1m", generatedAt: "2026-07-14T12:30:00.000Z", status: "ready", primaryPattern: { kind: "ascending_triangle", state: "confirmed", score: .94 } },
      { symbol: "AAPL", interval: "1D", generatedAt: "2026-07-14T12:00:00.000Z", status: "ready", primaryPattern: { kind: "bullish_flag", state: "forming", score: .82 } },
      { symbol: "MSFT", interval: "1D", generatedAt: "2026-07-14T11:30:00.000Z", status: "ready", primaryPattern: { kind: "falling_wedge", state: "forming", score: .88 } },
      { symbol: "META", interval: "1D", generatedAt: "2026-07-14T11:00:00.000Z", status: "ready", primaryPattern: { kind: "rising_wedge", state: "inactive", score: .99 } }
    ],
    total: 4
  };
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

function assetLayout(): Record<string, unknown> {
  const contents = [
    content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart"),
    content("chartCommentary", 2, {}),
    content("chartAssetOps", 3, {}),
    content("chartPatternList", 4, {})
  ];
  return { version: 1, nextInstance: 5, contents: Object.fromEntries(contents.map((item) => [item.id, item])), slots: [slot("chart", 1, 1, 1, 5, 6), slot("chartCommentary", 2, 6, 1, 3, 2), slot("chartAssetOps", 3, 6, 3, 3, 2), slot("chartPatternList", 4, 6, 5, 3, 2)] };
}

function content(kind: string, index: number, props: Record<string, unknown>, chartDocumentId?: string) {
  return { id: `content-${kind}-${index}`, kind, title: `${kind}-${index}`, instanceIndex: index, layoutWeight: kind === "chart" ? 100 : 50, props, ...(chartDocumentId ? { chartDocumentId } : {}) };
}

function slot(kind: string, index: number, col: number, row: number, colSpan: number, rowSpan: number) {
  return { id: `slot-${kind}-${index}`, contentId: `content-${kind}-${index}`, gridRect: { col, row, colSpan, rowSpan } };
}
