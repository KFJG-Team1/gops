import { expect, test, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedSymbols: unknown = null;
let densePatternCoverage = false;
type ScenarioMode = "forming" | "pending" | "confirmed" | "hold" | "retest" | "t1";
let scenarioMode: ScenarioMode = "forming";
const scenarioScreenshotOptions = { fullPage: true, maxDiffPixelRatio: 0.008 } as const;

test.beforeEach(async ({ page }) => {
  postedSymbols = null;
  densePatternCoverage = false;
  scenarioMode = "forming";
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  await page.addInitScript(({ key, layout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(layout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { key: layoutStorageKey, layout: assetLayout() });
});

test("forming geometry scenario connects exact watch condition to commentary", async ({ page }, testInfo) => {
  await installLayout(page, scenarioLayout());
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
  await expect(page.getByText(/상승 깃발형 · 형성 중/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "시나리오 분석 레이어 끄기" })).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "작도 대응 단계" })).toBeVisible();
  await expect.poll(() => page.getByRole("navigation", { name: "작도 대응 단계" }).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("listitem").filter({ hasText: "형성" }).first()).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("완료 봉 > 178.25 · +0.25 ATR");
  await page.getByRole("button", { name: "시나리오 분석 레이어 끄기" }).click();
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "현재 해석" })).toBeVisible();
  await expect(page.getByRole("region", { name: "분석 품질" })).toBeVisible();
  await expect(page).toHaveScreenshot("chart-scenario-off.png", scenarioScreenshotOptions);
  await page.getByRole("button", { name: "시나리오 분석 레이어 켜기" }).click();
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: `/tmp/chart-assets-v2-${testInfo.project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot("chart-scenario-forming.png", scenarioScreenshotOptions);
});

test("confirmed geometry scenario renders response range and invalidation", async ({ page }, testInfo) => {
  scenarioMode = "confirmed";
  await installLayout(page, scenarioLayout());
  await page.goto("/?symbol=NVDA");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("돌파 확인 · 매수 후보");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("거래량 1.80×로 확정");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("확정 종가 E 179.00");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("T1 184.00 · 50% · 1.00R");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("T2 189.00 · 50% · 2.00R");
  await expect(page.getByRole("region", { name: "무효화 조건" })).toContainText("초기 S 174.00");
  await expect(page.getByRole("listitem").filter({ hasText: "돌파 확인" }).first()).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: `/tmp/chart-scenario-confirmed-${testInfo.project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot("chart-scenario-confirmed.png", scenarioScreenshotOptions);
});

test("price-only breakout stays pending until volume or hold confirmation", async ({ page }, testInfo) => {
  scenarioMode = "pending";
  await installLayout(page, scenarioLayout());
  await page.goto("/?symbol=NVDA");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("돌파 후보 · 추가 확인 대기");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("거래량 1.5× 또는 다음 완료 봉 유지");
  await expect(page.getByRole("listitem").filter({ hasText: "돌파 확인" }).first()).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: `/tmp/chart-scenario-pending-${testInfo.project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot("chart-scenario-pending.png", scenarioScreenshotOptions);
});

test("next completed candle hold records a distinct confirmation method", async ({ page }, testInfo) => {
  scenarioMode = "hold";
  await installLayout(page, scenarioLayout());
  await page.goto("/?symbol=NVDA");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("다음 완료 봉 1개가 경계 밖을 유지해 확정");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("확정 종가 E 179.00");
  await expect(page.getByRole("listitem").filter({ hasText: "돌파 확인" }).first()).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: `/tmp/chart-scenario-hold-${testInfo.project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot("chart-scenario-hold.png", scenarioScreenshotOptions);
});

test("retest confirmation updates entry and advances the scenario rail", async ({ page }, testInfo) => {
  scenarioMode = "retest";
  await installLayout(page, scenarioLayout());
  await page.goto("/?symbol=NVDA");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("리테스트 확인 · 진입 후보");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("리테스트 종가 E 179.00");
  await expect(page.getByRole("listitem").filter({ hasText: "리테스트" }).first()).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: `/tmp/chart-scenario-retest-${testInfo.project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot("chart-scenario-retest.png", scenarioScreenshotOptions);
});

test("T1 completion promotes entry protection and split-response state", async ({ page }, testInfo) => {
  scenarioMode = "t1";
  await installLayout(page, scenarioLayout());
  await page.goto("/?symbol=NVDA");
  await expect(page.getByRole("region", { name: "대응 시나리오" })).toContainText("T1 도달 · 잔여 50% 보호");
  await expect(page.getByRole("region", { name: "무효화 조건" })).toContainText("현재 보호 179.00");
  await expect(page.getByRole("listitem").filter({ hasText: "분할 대응" }).first()).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: `/tmp/chart-scenario-t1-${testInfo.project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot("chart-scenario-t1.png", scenarioScreenshotOptions);
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
  densePatternCoverage = true;
  await page.goto("/?symbol=NVDA");
  const panel = page.locator(".chart-pattern-list-panel");
  const groups = panel.locator(".chart-pattern-group");
  await expect(groups).toHaveCount(50);
  const firstGroupBox = await groups.nth(0).boundingBox();
  const secondGroupBox = await groups.nth(1).boundingBox();
  expect(firstGroupBox).not.toBeNull();
  expect(secondGroupBox).not.toBeNull();
  if (firstGroupBox && secondGroupBox) {
    expect(firstGroupBox.height).toBeGreaterThan(40);
    expect(secondGroupBox.y).toBeGreaterThanOrEqual(firstGroupBox.y + firstGroupBox.height);
  }
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
  else if (url.pathname === "/api/charts/analysis-assets") payload = url.searchParams.get("symbol") === "NVDA" ? assetResponse(scenarioMode) : { symbol: url.searchParams.get("symbol"), assets: {}, meta: {} };
  else if (url.pathname === "/api/charts/analysis-assets/coverage") payload = patternCoverageResponse(densePatternCoverage ? 48 : 0);
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

function patternCoverageResponse(extraSymbols = 0): Record<string, unknown> {
  const extraItems = Array.from({ length: extraSymbols }, (_, index) => ({
    symbol: `TEST${String(index + 1).padStart(2, "0")}`,
    interval: "1D",
    generatedAt: "2026-07-14T12:00:00.000Z",
    status: "ready",
    primaryPattern: { kind: "symmetrical_triangle", state: "forming", score: .8 - index / 1000 }
  }));
  const items = [
    { symbol: "AAPL", interval: "1m", generatedAt: "2026-07-14T12:30:00.000Z", status: "ready", primaryPattern: { kind: "ascending_triangle", state: "confirmed", score: .94 } },
    { symbol: "AAPL", interval: "1D", generatedAt: "2026-07-14T12:00:00.000Z", status: "ready", primaryPattern: { kind: "bullish_flag", state: "forming", score: .82 } },
    { symbol: "MSFT", interval: "1D", generatedAt: "2026-07-14T11:30:00.000Z", status: "ready", primaryPattern: { kind: "falling_wedge", state: "forming", score: .88 } },
    { symbol: "META", interval: "1D", generatedAt: "2026-07-14T11:00:00.000Z", status: "ready", primaryPattern: { kind: "rising_wedge", state: "inactive", score: .99 } },
    ...extraItems
  ];
  return {
    items,
    total: items.length
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

function assetResponse(mode: ScenarioMode): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp;
  const confirmed = mode === "confirmed" || mode === "hold" || mode === "retest" || mode === "t1";
  const patternState = confirmed ? "confirmed" : "forming";
  const phase = mode === "pending" ? "confirmation_pending" : mode === "hold" ? "confirmed" : mode === "retest" ? "retest_confirmed" : mode === "t1" ? "t1_reached" : mode;
  const signalAt = mode === "pending" ? candles[138].timestamp : mode === "hold" ? candles[136].timestamp : confirmed ? candles[135].timestamp : null;
  const entryAt = mode === "retest" ? candles[138].timestamp : mode === "hold" ? candles[136].timestamp : confirmed ? candles[135].timestamp : null;
  const hline = drawing("chart-asset:NVDA:1D:support", "horizontalLine", [{ timestamp: candles[50].timestamp, price: 164 }, { timestamp: candles[100].timestamp, price: 164 }], "지지", "#22c55e");
  const resistance = drawing("chart-asset:NVDA:1D:resistance", "horizontalLine", [{ timestamp: candles[55].timestamp, price: 178 }, { timestamp: candles[110].timestamp, price: 178 }], "저항", "#ef4444");
  const pole = drawing("chart-asset:NVDA:1D:flag-pole", "trendLine", [{ timestamp: candles[98].timestamp, price: 158 }, { timestamp: candles[116].timestamp, price: 176 }], "상승 깃발형 · 깃대", "#22c55e");
  const upper = drawing("chart-asset:NVDA:1D:flag-upper", "trendLine", [{ timestamp: candles[116].timestamp, price: 178 }, { timestamp: candles[139].timestamp, price: 176 }], `상승 깃발형 · ${confirmed ? "돌파 확인" : "형성 중"}`, "#22c55e");
  const lower = drawing("chart-asset:NVDA:1D:flag-lower", "trendLine", [{ timestamp: candles[116].timestamp, price: 174 }, { timestamp: candles[139].timestamp, price: 172 }], `상승 깃발형 · ${confirmed ? "돌파 확인" : "형성 중"}`, "#22c55e");
  const tradePlan = {
    version: "pattern-trade-timing-v3", symbol: "NVDA", interval: "1D", patternId: "pattern-bullish-flag", patternKind: "bullish_flag", patternState,
    action: confirmed ? "buy_candidate" : "watch", direction: confirmed ? "long" : null, phase,
    signalAt, entryTrigger: 178.25,
    confirmationConditions: [{ direction: "up", boundary: "upper", boundaryPrice: 178, triggerPrice: 178.25, bufferAtr: .25, rule: "completed_close_above" }],
    confirmationEvidence: mode === "forming" ? null : { direction: "up", boundaryPrice: 178, triggerPrice: 178.25, breakoutAt: candles[135].timestamp, confirmedAt: confirmed ? (mode === "hold" ? candles[136].timestamp : candles[135].timestamp) : null, method: confirmed ? (mode === "hold" ? "hold" : "volume") : null, volumeRatio: confirmed ? (mode === "hold" ? 1.1 : 1.8) : 1.2, requiredVolumeRatio: 1.5, holdBars: 1 },
    entryPlan: confirmed && entryAt ? { mode: mode === "retest" ? "retest_close" : "confirmation_close", at: entryAt, price: 179 } : null,
    stopPlan: confirmed ? { initialPrice: 174, activePrice: mode === "t1" ? 179 : 174, basis: mode === "retest" ? "retest_swing_atr" : "breakout_boundary_atr", bufferAtr: mode === "retest" ? .25 : 1 } : null,
    targets: confirmed ? [{ id: "T1", price: 184, basis: "one_r", allocationPercent: 50, rMultiple: 1 }, { id: "T2", price: 189, basis: "measured_move", allocationPercent: 50, rMultiple: 2 }] : [],
    retest: confirmed ? { state: mode === "retest" ? "confirmed" : "pending", at: mode === "retest" ? candles[138].timestamp : null, zoneLow: 177.75, zoneHigh: 178.25, observedBars: mode === "retest" ? 3 : 0, maxBars: 5 } : null,
    entryPrice: confirmed ? 179 : null, stopPrice: confirmed ? (mode === "t1" ? 179 : 174) : null, targetPrice: confirmed ? 189 : null,
    riskPerShare: confirmed ? 5 : null, rewardPerShare: confirmed ? 10 : null, rewardRiskRatio: confirmed ? 2 : null,
    minimumRewardRisk: 2, projectionBars: 10, reasons: confirmed ? ["confirmed_upward_breakout", "reward_risk_passed"] : mode === "pending" ? ["confirmation_pending"] : ["pattern_not_confirmed"]
  };
  const primaryPattern = { kind: "bullish_flag", state: patternState, bias: "bullish", breakoutDirection: confirmed ? "up" : null, breakoutAt: mode === "forming" ? null : candles[135].timestamp, confirmedAt: confirmed ? (mode === "hold" ? candles[136].timestamp : candles[135].timestamp) : null, confirmationMethod: confirmed ? (mode === "hold" ? "hold" : "volume") : null, volumeRatio: mode === "forming" ? null : (confirmed ? (mode === "hold" ? 1.1 : 1.8) : 1.2), score: .78, touches: 5, geometryHash: "flag" };
  const asset = { assetVersion: "geometry", algorithmVersion: "ohlcv-consensus-pattern-families-v5", symbol: "NVDA", interval: "1D", sourceInterval: "1D", asOf, generatedAt: asOf, status: "ready", inputDigest: "sha256:fixture", coverage: { state: "partial", targetBars: 380, actualBars: 140, contiguousBars: 140, missingBars: 240 }, geometry: { drawings: [hline, resistance, pole, upper, lower], supports: [{ id: "support", role: "support", price: 164, score: .8, touches: 4, anchors: hline.anchors }], resistances: [{ id: "resistance", role: "resistance", price: 178, score: .76, touches: 3, anchors: resistance.anchors }], patterns: [primaryPattern], primaryPattern, tradePlan, primaryTriangle: null, historicalTriangle: null }, indicators: { sma60: 170, sma120: 165, cross: { status: "none", direction: null } } };
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

function scenarioLayout(): Record<string, unknown> {
  const contents = [
    content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart"),
    content("chartCommentary", 2, {})
  ];
  return {
    version: 1,
    nextInstance: 3,
    contents: Object.fromEntries(contents.map((item) => [item.id, item])),
    slots: [slot("chart", 1, 1, 1, 6, 6), slot("chartCommentary", 2, 7, 1, 2, 6)]
  };
}

async function installLayout(page: Page, layout: Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ key, nextLayout }) => {
    window.localStorage.setItem(key, JSON.stringify(nextLayout));
  }, { key: layoutStorageKey, nextLayout: layout });
}

function content(kind: string, index: number, props: Record<string, unknown>, chartDocumentId?: string) {
  return { id: `content-${kind}-${index}`, kind, title: `${kind}-${index}`, instanceIndex: index, layoutWeight: kind === "chart" ? 100 : 50, props, ...(chartDocumentId ? { chartDocumentId } : {}) };
}

function slot(kind: string, index: number, col: number, row: number, colSpan: number, rowSpan: number) {
  return { id: `slot-${kind}-${index}`, contentId: `content-${kind}-${index}`, gridRect: { col, row, colSpan, rowSpan } };
}
