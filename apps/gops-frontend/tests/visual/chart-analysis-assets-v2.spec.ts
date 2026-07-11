import { expect, test, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
const eventIndex = 100;
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

test("v2 asset keeps flags on candle centers and connects focus commentary", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.locator(".chart-analysis-layer-controls")).toBeVisible();
  for (const label of ["지지·저항", "추세", "인사이트"]) {
    const toggle = page.getByRole("button", { name: `${label} 분석 레이어 끄기` });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "추세 분석 레이어 끄기" }).click();
  await expect(page.getByRole("button", { name: "추세 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "추세 분석 레이어 켜기" }).click();

  const focus = page.getByRole("region", { name: "주요 관찰" }).getByRole("button").first();
  await expect(focus).toContainText("확인 조건");
  await expect(focus).toContainText("무효화 조건");
  await focus.click();

  const flagGeometry = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (!context) return null;
    const image = context.getImageData(0, 0, target.width, target.height);
    const spans = new Map<number, { min: number; max: number }>();
    for (let index = 0; index < image.data.length; index += 4) {
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      const pixel = index / 4;
      const y = Math.floor(pixel / target.width);
      if (red >= 245 && green >= 105 && green <= 140 && blue >= 45 && blue <= 80 && image.data[index + 3] > 180) {
        const x = pixel % target.width;
        const current = spans.get(x);
        spans.set(x, current ? { min: Math.min(current.min, y), max: Math.max(current.max, y) } : { min: y, max: y });
      }
    }
    if (!spans.size) return null;
    const x = [...spans].sort((left, right) => (right[1].max - right[1].min) - (left[1].max - left[1].min) || left[0] - right[0])[0][0];
    return { x, width: target.width };
  });
  expect(flagGeometry).not.toBeNull();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (flagGeometry === null || !box) throw new Error("flag pixel geometry unavailable");
  if (testInfo.project.name === "desktop") {
    await page.mouse.move(box.x + flagGeometry.x * box.width / flagGeometry.width, box.y + box.height * 0.45);
    const expectedDate = new Date(candles[eventIndex].timestamp).toLocaleString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
    await expect(page.locator(".hover-ohlc-time dd")).toContainText(expectedDate);
  }
  await page.screenshot({ path: `/tmp/chart-assets-v2-${testInfo.project.name}.png`, fullPage: true });
});

test("asset ops wording and comma-separated input remain readable", async ({ page }, testInfo) => {
  await page.goto("/?symbol=NVDA");
  const ops = page.locator(".chart-asset-ops-panel");
  await expect(ops.getByText("콤마로 구분", { exact: true })).toBeVisible();
  await expect(ops.getByText("갱신 스킵(시간)", { exact: true })).toBeVisible();
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

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  let status = 200;
  if (url.pathname === "/api/auth/me") payload = { authEnabled: false, user: null };
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload();
  else if (url.pathname === "/api/charts/analysis-assets") payload = assetResponse();
  else if (url.pathname === "/api/charts/analysis-assets/coverage") payload = { items: [], total: 0 };
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
  return { id, type, anchors, sourceInterval: "1D", style: { color, lineWidth: 2, opacity: .95 }, label, locked: false, visible: true, createdBy: "system", sourceProposalId: "chart-asset:NVDA:1D:test", createdAt: candles.at(-1)?.timestamp, updatedAt: candles.at(-1)?.timestamp };
}

function assetResponse(): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp;
  const hline = drawing("ca-NVDA-1D-structure-level", "horizontalLine", [{ price: 164 }], "지지 164.00", "#ffffff");
  const flag = drawing("ca-NVDA-1D-structure-event", "flagMarker", [{ timestamp: candles[eventIndex].timestamp, price: candles[eventIndex].high }], "구조 이탈", "#ff7a3d");
  const trend = drawing("ca-NVDA-1D-trend-current", "trendLine", [{ timestamp: candles[10].timestamp, price: candles[10].low }, { timestamp: candles[85].timestamp, price: candles[85].low }], "상승 추세", "#0099ff");
  const insight = drawing("ca-NVDA-1D-agent-event", "flagMarker", [{ timestamp: candles[115].timestamp, price: candles[115].high }], "리테스트 확인", "#33adff");
  return { symbol: "NVDA", assets: { "1D": { assetVersion: "v2", symbol: "NVDA", interval: "1D", asOf, generatedAt: asOf, status: "ready", layers: { structure: { drawings: [hline, flag], selected: [], emptyReason: null, meta: {} }, trend: { drawings: [trend], selected: [], emptyReason: null, meta: {} }, agent: { drawings: [insight], selected: [], emptyReason: null, meta: {} } }, chartSetup: { alwaysOn: ["volume-profile", "volume"], recommended: [] }, commentary: { headline: "현재와 연결된 핵심 구조", regimeSummary: "상승 구조", focusItems: [{ drawingIds: [hline.id], candidateId: "level", featureIds: [], whatItShows: "검증된 지지 구조", whyItMatters: "현재 가격과 가깝습니다.", whatToWatch: "확인 조건: 다음 확정봉의 반응. 무효화 조건: 확정 종가 이탈.", confirmation: "다음 확정봉의 반응", invalidation: "확정 종가 이탈", horizon: "weeks" }], text: "핵심 구조를 확인하세요.", keyLevels: ["support 164.00 · 지지"], invalidation: "확정 종가가 지지 구간 아래에서 유지되면 무효입니다.", confidence: .9, enrichment: null } }, "1W": null, "1M": null }, meta: { servedAt: asOf } };
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
