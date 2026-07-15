import { expect, test, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedSymbols: unknown = null;
let densePatternCoverage = false;
let includeTradePlan = true;
let includeConditionalEvidence = true;
let delayAgentAnswer = false;
let watchlistSymbols: string[] = [];
let watchlistWrites: string[][] = [];
let nearbyIntervalFallback = false;

test.beforeEach(async ({ page }, testInfo) => {
  postedSymbols = null;
  densePatternCoverage = false;
  includeTradePlan = true;
  includeConditionalEvidence = true;
  delayAgentAnswer = false;
  watchlistSymbols = [];
  watchlistWrites = [];
  nearbyIntervalFallback = false;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  const layout = testInfo.title.includes("chart questions keep current commentary")
    ? chartQuestionLayout()
    : testInfo.title.includes("multiple order panels")
      ? multipleOrderPanelLayout()
    : testInfo.title.includes("price axis")
      ? tradeAutomationLayout()
    : testInfo.title.includes("commentary chart selection")
      ? chartLinkLayout()
    : testInfo.title.includes("evidence and proposal layers")
      ? analysisLayersLayout((page.viewportSize()?.width ?? 1440) < 900)
      : testInfo.title.includes("pattern symbol panel")
        ? patternListLayout()
        : assetLayout();
  await page.addInitScript(({ key, layout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(layout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { key: layoutStorageKey, layout });
});

test("evidence and proposal layers render independently with commentary spotlight", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.locator(".chart-analysis-layer-controls")).toBeVisible();
  const evidenceToggle = page.getByRole("button", { name: "작도 분석 레이어 끄기" });
  const proposalToggle = page.getByRole("button", { name: "제안 분석 레이어 끄기" });
  await expect(evidenceToggle).toBeEnabled();
  await expect(proposalToggle).toBeEnabled();
  await expect(page.getByText(/상승 삼각형 돌파 확인/).first()).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(page).toHaveScreenshot("chart-assets-layers-both.png", { fullPage: true, maxDiffPixelRatio: 0.015, timeout: 15_000 });

  await evidenceToggle.click();
  await expect(page.getByRole("button", { name: "작도 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(proposalToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveScreenshot("chart-assets-proposal-only.png", { fullPage: true, maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await page.getByRole("button", { name: "작도 분석 레이어 켜기" }).click();

  await proposalToggle.click();
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveScreenshot("chart-assets-evidence-only.png", { fullPage: true, maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await page.getByRole("button", { name: "제안 분석 레이어 켜기" }).click();

  const evidenceStep = page.locator(".chart-commentary-focus button").first();
  await evidenceStep.hover();
  await expect(page).toHaveScreenshot("chart-assets-spotlight.png", { fullPage: true, maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await evidenceStep.focus();
  await expect(evidenceStep).toBeFocused();

  const glossaryTerm = page.locator(".chart-commentary-panel .glossary-term").filter({ hasText: "진입가" }).first();
  await glossaryTerm.scrollIntoViewIfNeeded();
  await glossaryTerm.hover();
  await expect(page.locator("#gops-glossary-tooltip")).toBeVisible();
  await glossaryTerm.focus();
  await expect(glossaryTerm).toBeFocused();
  await expect(page.locator("#gops-glossary-tooltip")).toBeVisible();
  await glossaryTerm.blur();
});

test("proposal toggle is disabled when the asset has no proposal drawings", async ({ page }) => {
  includeTradePlan = false;
  includeConditionalEvidence = false;
  await page.goto("/?symbol=NVDA");
  await expect(page.locator(".chart-panel")).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.getByRole("button", { name: "작도 분석 레이어 끄기" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "제안 분석 레이어 끄기" })).toBeDisabled();
  await expect(page.locator(".chart-analysis-layer-controls")).toHaveScreenshot("chart-assets-no-proposal.png", { timeout: 15_000 });
});

test("nearby interval setup stays stable during crosshair and user pan", async ({ page }) => {
  includeTradePlan = false;
  nearbyIntervalFallback = true;
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel").first();
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 끄기" })).toBeEnabled();

  const initialSnapshot = await page.evaluate(async () => {
    const store = await import("/src/chart/chartTradeSetupStore.ts");
    const snapshot = store.getChartTradeSetupSnapshot("asset-visual-chart");
    let notifications = 0;
    const unsubscribe = store.subscribeChartTradeSetup("asset-visual-chart", () => {
      notifications += 1;
    });
    Object.assign(window, {
      __chartSetupNotificationCount: () => notifications,
      __chartSetupUnsubscribe: unsubscribe
    });
    return snapshot ? {
      sourceInterval: snapshot.setup.sourceInterval,
      entryPrice: snapshot.setup.entryPrice,
      targetPrice: snapshot.setup.targetPrice,
      stopPrice: snapshot.setup.stopPrice
    } : null;
  });
  expect(initialSnapshot).toEqual({ sourceInterval: "4h", entryPrice: 178, targetPrice: 206, stopPrice: 164 });

  const box = await canvas.boundingBox();
  if (!box) throw new Error("chart canvas is not visible");
  for (let index = 0; index < 60; index += 1) {
    await page.mouse.move(
      box.x + 20 + (index % 30) * Math.max(2, (box.width - 100) / 30),
      box.y + 90 + (index % 6) * 8
    );
  }
  expect(await page.evaluate(() => (window as typeof window & {
    __chartSetupNotificationCount?: () => number;
  }).__chartSetupNotificationCount?.())).toBe(0);

  const beforePan = Number(await chart.getAttribute("data-chart-right-offset"));
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await chart.getAttribute("data-chart-right-offset"))).not.toBe(beforePan);
  const pannedOffset = Number(await chart.getAttribute("data-chart-right-offset"));
  await page.waitForTimeout(500);
  expect(Number(await chart.getAttribute("data-chart-right-offset"))).toBe(pannedOffset);
  await page.evaluate(() => (window as typeof window & { __chartSetupUnsubscribe?: () => void }).__chartSetupUnsubscribe?.());
});

test("commentary chart selection targets one chart document at a time", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const charts = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await expect(charts).toHaveCount(2);
  const selector = page.getByRole("button", { name: "차트 선택", exact: true });
  await selector.click();
  await expect(charts.nth(0)).toHaveClass(/is-chart-link-current/);
  await expect(charts.nth(1)).toHaveClass(/is-chart-link-target/);
  await charts.nth(1).click({ position: { x: 16, y: 16 } });
  await expect(selector).toHaveAttribute("aria-pressed", "false");
  await selector.click();
  await expect(charts.nth(1)).toHaveClass(/is-chart-link-current/);
  await charts.nth(1).click({ position: { x: 16, y: 16 } });
});

test("chart questions keep current commentary and attach the snapshot answer to the same chart", async ({ page }) => {
  delayAgentAnswer = true;
  await page.goto("/?symbol=NVDA");
  await expect(page.locator(".chart-panel")).toHaveAttribute("data-chart-candle-count", "140");
  await page.getByLabel("Agent command").fill("차트 분석해줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();
  await expect(page.locator(".chart-commentary-pending")).toContainText("현재 해설은 그대로 유지됩니다");
  await expect(page.getByRole("button", { name: "현재 해설" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("기존 Geometry 자산의 지지·패턴을 기준으로 해설했습니다.")).toBeVisible();
  await expect(page.getByLabel("질문 답변 선택")).toHaveValue("analysis-visual-chart");
  const supportFocus = page.locator(".chart-commentary-answer-focus").getByRole("button", { name: "지지" });
  await supportFocus.hover();
  await expect(page).toHaveScreenshot("chart-commentary-question-answer.png", { fullPage: true, maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await page.getByRole("button", { name: "현재 해설" }).click();
  await expect(page.getByText(/적용된 근거·제안 작도/)).toBeVisible();
});

test("price axis reservation buy without a selected price asks for a price instead of chart analysis", async ({ page }) => {
  const executionRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && [
      "/api/trade-conditions",
      "/api/trade-conditions/commands",
      "/api/agents/analyze"
    ].includes(pathname)) executionRequests.push(pathname);
  });
  await page.goto("/?symbol=NVDA");
  await expect(page.locator(".chart-panel")).toHaveAttribute("data-chart-candle-count", "140");

  await page.getByLabel("Agent command").fill("예약 매수 해줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();

  await expect(page.locator(".workspace-agent-notice")).toContainText("어느 가격에 예약할까요?");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(executionRequests).toEqual([]);
});

test("price axis selection accepts a natural reservation buy command and creates a 20-share paper condition", async ({ page }) => {
  const executionRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && [
      "/api/orders",
      "/api/paper/orders",
      "/api/alerts",
      "/api/alerts/commands",
      "/api/trade-conditions",
      "/api/trade-conditions/commands",
      "/api/agents/analyze"
    ].includes(pathname)) executionRequests.push(pathname);
  });
  await page.goto("/?symbol=NVDA");
  const canvas = page.locator(".chart-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  const axisPoint = { x: canvasBox.width - 12, y: canvasBox.height * .48 };
  await canvas.hover({ position: axisPoint });
  await canvas.click({ position: axisPoint });

  const quickOrder = page.locator(".quick-order-panel");
  const source = quickOrder.locator(".order-chart-price-source");
  await expect(source).toContainText("NVDA 차트에서 $");
  const selectedPrice = await quickOrder.getByLabel("빠른 주문 가격 직접 입력").inputValue();
  expect(Number(selectedPrice)).toBeGreaterThan(0);
  await expect(quickOrder.getByLabel("주문 수량 직접 입력")).toHaveValue("3");
  expect(executionRequests).toEqual([]);

  const command = page.getByLabel("Agent command");
  await command.fill("예약 매수 해줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("NVDA · 1D");
  await expect(dialog).toContainText("매수 후보");
  await expect(dialog).toContainText(`$${selectedPrice}`);
  await expect(dialog).toContainText("$194.00");
  await expect(dialog).toContainText("$170.00");
  await expect(dialog.getByLabel("예약 수량")).toHaveValue("20");
  await expect(dialog).toContainText("가상계좌 예약매매와 가격 알림이 실제로 등록됩니다");
  const cancel = dialog.getByRole("button", { name: "취소" });
  const confirm = dialog.getByRole("button", { name: "확인" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(command).toBeFocused();

  await command.fill("이 때 사자");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect(page.locator(".workspace-agent-notice")).toContainText("NVDA 20주 예약매매와 가격 알림을 등록했습니다");
  expect(executionRequests).toEqual(["/api/trade-conditions"]);
});

test("price axis targets the last interacted panel when multiple order panels exist", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const orderPanels = page.locator(".quick-order-panel");
  await expect(orderPanels).toHaveCount(2);
  await orderPanels.nth(1).click({ position: { x: 12, y: 12 } });
  const canvas = page.locator(".chart-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  await canvas.click({ position: { x: canvasBox.width - 10, y: canvasBox.height * .46 } });
  await expect(orderPanels.nth(0).locator(".order-chart-price-source")).toHaveCount(0);
  await expect(orderPanels.nth(1).locator(".order-chart-price-source")).toContainText("NVDA 차트에서 $");
  await expect(orderPanels.nth(0).getByLabel("빠른 주문 가격 직접 입력")).toHaveValue("");
  await expect(orderPanels.nth(1).getByLabel("빠른 주문 가격 직접 입력")).not.toHaveValue("");
  await expect(orderPanels.nth(0).getByLabel("주문 수량 직접 입력")).toHaveValue("1");
  await expect(orderPanels.nth(1).getByLabel("주문 수량 직접 입력")).toHaveValue("7");
});

test("agent prompt adds the current chart symbol to the watchlist idempotently", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const command = page.getByLabel("Agent command");

  await command.fill("이 종목을 관심종목에 추가해줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();
  await expect(page.locator(".workspace-agent-notice")).toContainText("관심종목에 NVDA를 추가했습니다");
  await expect.poll(() => watchlistSymbols).toEqual(["NVDA"]);
  expect(watchlistWrites).toEqual([["NVDA"]]);

  await command.fill("이 종목을 관심종목에 추가해줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();
  await expect(page.locator(".workspace-agent-notice")).toContainText("관심종목에 NVDA를 추가했습니다");
  expect(watchlistWrites).toEqual([["NVDA"]]);
});

test("asset ops wording and comma-separated input remain readable", async ({ page }) => {
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
  await expect(universeRow).toHaveScreenshot("chart-assets-ops.png", { timeout: 15_000 });
});

test("pattern symbol panel filters active patterns and opens the matching chart interval", async ({ page }) => {
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
  await expect(panel).toHaveScreenshot("chart-pattern-list.png", { timeout: 15_000 });
});

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let payload: unknown = {};
  let status = 200;
  if (url.pathname === "/api/auth/me") payload = { authEnabled: false, user: null };
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }, { symbol: "AAPL", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload(url.searchParams.get("symbol") ?? "NVDA", url.searchParams.get("interval") ?? "1D");
  else if (url.pathname === "/api/charts/analysis-assets") payload = url.searchParams.get("symbol") === "NVDA" ? assetResponse() : { symbol: url.searchParams.get("symbol"), assets: {}, meta: {} };
  else if (url.pathname === "/api/charts/analysis-assets/coverage") payload = patternCoverageResponse(densePatternCoverage ? 48 : 0);
  else if (url.pathname === "/api/charts/order-flow/symbols") payload = { symbols: ["NVDA"], priceBinSize: .01 };
  else if (url.pathname === "/api/charts/order-flow/intraday") payload = { symbol: "NVDA", sessionDate: "2026-07-14", dataStatus: "ready", supportedSymbols: ["NVDA"], priceBinSize: .01, minutes: [] };
  else if (url.pathname === "/api/orders/balance") payload = { currency: "USD", orderable_cash: "10000.00" };
  else if (url.pathname === "/api/charts/watchlist" && request.method() === "GET") {
    payload = {
      source: "fixture",
      feed: "sip",
      persisted: true,
      symbols: watchlistSymbols.map((symbol) => ({ symbol, name: symbol }))
    };
  }
  else if (url.pathname === "/api/charts/watchlist" && request.method() === "PUT") {
    watchlistSymbols = request.postDataJSON().symbols;
    watchlistWrites.push([...watchlistSymbols]);
    payload = {
      source: "fixture",
      feed: "sip",
      persisted: true,
      symbols: watchlistSymbols.map((symbol) => ({ symbol, name: symbol }))
    };
  }
  else if (url.pathname === "/api/trade-conditions" && request.method() === "POST") {
    const body = request.postDataJSON();
    payload = {
      condition: {
        id: 1,
        alert_id: 11,
        symbol: body.symbol,
        side: body.side,
        direction: body.direction,
        target_price: body.triggerPrice,
        limit_price: body.limitPrice,
        quantity: body.quantity,
        status: "watching",
        execution_enabled: true,
        notifications_enabled: true,
        validity: body.validity,
        market_hours: "REGULAR"
      },
      projectionStatus: "synced"
    };
    status = 201;
  }
  else if (url.pathname === "/api/agents/analyze" && request.method() === "POST") {
    if (delayAgentAnswer) await new Promise((resolve) => setTimeout(resolve, 1_200));
    payload = chartAnalysisReport(request.postDataJSON());
  }
  else if (url.pathname === "/api/charts/analysis-assets/build" && request.method() === "POST") {
    postedSymbols = request.postDataJSON().symbols;
    status = 503;
    payload = { detail: "fixture queue disabled" };
  } else if (url.pathname === "/api/charts/indicators") payload = { symbol: "NVDA", interval: "1D", series: {} };
  else if (url.pathname === "/api/charts/volume-profile-bins") payload = { bins: [] };
  else if (url.pathname === "/api/market/heatmap") payload = { items: [] };
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

function chartAnalysisReport(requestBody: Record<string, unknown>): Record<string, unknown> {
  const chartContext = requestBody.chartContext as { chartDocument?: { chartDocumentId?: string; sourcePanelId?: string } } | undefined;
  const asOf = candles.at(-1)?.timestamp;
  const supportId = "chart-asset:NVDA:1D:support";
  const patternIds = ["chart-asset:NVDA:1D:triangle-upper", "chart-asset:NVDA:1D:triangle-lower"];
  return {
    analysisId: "analysis-visual-chart",
    symbol: "NVDA",
    status: "completed",
    summary: "NVDA 차트 해설을 완료했습니다.",
    route: { source: "chart-rules", intentType: "chart", selectedRoles: ["chart"] },
    finalAnswer: {
      title: "NVDA 차트 해설",
      summary: "기존 Geometry 자산의 지지·패턴을 기준으로 해설했습니다.",
      sections: [
        { title: "주요 관찰", bullets: ["가까운 지지 가격은 164.00입니다.", "상승 삼각형 · 돌파 확인 상태입니다."] },
        { title: "확인·무효화 조건", bullets: ["진입가 178.00 / 손절 170.00 / 목표가 194.00, 손익비 2.00"] }
      ],
      citations: [], limitations: []
    },
    finalResponse: { risk_warnings: [], data_freshness_warnings: [] },
    agentAnswers: [], findings: [], providerEvidence: [], dailySummaries: [], tradeConditionProposals: [],
    chartExplanation: {
      version: "chart-explanation.v1", symbol: "NVDA", interval: "1D", asOf,
      quality: { state: "partial", stale: false, flags: [] },
      assetIdentity: { assetVersion: "geometry", algorithmVersion: "ohlcv-consensus-1", inputDigest: "sha256:fixture", asOf },
      source: {
        chartDocumentId: chartContext?.chartDocument?.chartDocumentId,
        sourcePanelId: chartContext?.chartDocument?.sourcePanelId
      },
      facts: {
        pattern: { kind: "ascending_triangle", state: "confirmed" },
        support: { id: "support", price: 164 }, resistance: null,
        tradeScenario: { action: "buy_candidate", entryPrice: 178, stopPrice: 170, targetPrice: 194, rewardRiskRatio: 2 },
        movingAverageCross: null, selectedCandle: null
      },
      usedIndicators: ["가격 구조", "지지·저항"],
      focusIds: [supportId, ...patternIds],
      focusGroups: { evidence: [supportId, ...patternIds], pattern: patternIds, support: [supportId], resistance: [] },
      anchor: null, news: []
    }
  };
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

function assetResponse(): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp;
  const hline = drawing("chart-asset:NVDA:1D:support", "horizontalLine", [{ timestamp: candles[50].timestamp, price: 164 }, { timestamp: candles[100].timestamp, price: 164 }], "지지", "#22c55e");
  const upper = drawing("chart-asset:NVDA:1D:triangle-upper", "trendLine", [{ timestamp: candles[40].timestamp, price: 178 }, { timestamp: candles[139].timestamp, price: 178 }], "상승 삼각형 · 형성 중", "#22c55e");
  const lower = drawing("chart-asset:NVDA:1D:triangle-lower", "trendLine", [{ timestamp: candles[40].timestamp, price: 158 }, { timestamp: candles[139].timestamp, price: 174 }], "상승 삼각형 · 형성 중", "#22c55e");
  const asset = {
    assetVersion: "geometry", algorithmVersion: "ohlcv-consensus-1", symbol: "NVDA", interval: "1D", sourceInterval: "1D",
    asOf, generatedAt: asOf, status: "ready", inputDigest: "sha256:fixture",
    coverage: { state: "partial", targetBars: 380, actualBars: 140, contiguousBars: 140, missingBars: 240 },
    geometry: {
      drawings: [hline, upper, lower],
      supports: includeConditionalEvidence && !nearbyIntervalFallback
        ? [{ id: "support", role: "support", price: 164, zoneLow: 163.4, zoneHigh: 164.6, halfWidthAtr: .4, score: .8, touches: 2, anchors: hline.anchors }]
        : [],
      resistances: [], patterns: [], primaryPattern: null,
      primaryTriangle: { kind: "ascending_triangle", state: "confirmed", score: .9, touches: 5, geometryHash: "triangle" },
      historicalTriangle: null,
      ...(includeTradePlan ? { tradePlan: {
        version: "pattern-trade-timing-v1", symbol: "NVDA", interval: "1D", patternId: "triangle", patternKind: "ascending_triangle",
        patternState: "confirmed", action: "buy_candidate", direction: "long", signalAt: asOf, entryTrigger: 177.5,
        entryPrice: 178, stopPrice: 170, targetPrice: 194, riskPerShare: 8, rewardPerShare: 16, rewardRiskRatio: 2,
        minimumRewardRisk: 2, projectionBars: 10, reasons: ["confirmed_upward_breakout", "reward_risk_passed"]
      } } : nearbyIntervalFallback ? { tradePlan: {
        version: "pattern-trade-timing-v1", symbol: "NVDA", interval: "1D", patternId: "triangle", patternKind: "ascending_triangle",
        patternState: "forming", action: "watch", direction: null, signalAt: null, entryTrigger: null,
        entryPrice: null, stopPrice: null, targetPrice: null, riskPerShare: null, rewardPerShare: null,
        rewardRiskRatio: null, minimumRewardRisk: 2, projectionBars: 10, reasons: ["breakout_not_confirmed"]
      } } : {})
    },
    indicators: { sma60: 170, sma120: 165, cross: { status: "none", direction: null } }
  };
  const nearbyAsset = nearbyIntervalFallback ? {
    ...asset,
    interval: "4h",
    sourceInterval: "4h",
    inputDigest: "sha256:fixture-4h",
    geometry: {
      ...asset.geometry,
      drawings: [],
      supports: [{ id: "support-4h", role: "support", price: 164, score: .8, touches: 3, anchors: [] }],
      resistances: [{ id: "resistance-4h", role: "resistance", price: 178, score: .82, touches: 3, anchors: [] }],
      primaryPattern: null,
      primaryTriangle: null,
      tradePlan: null
    }
  } : null;
  return { symbol: "NVDA", assets: { "1D": asset, ...(nearbyAsset ? { "4h": nearbyAsset } : {}) }, meta: { servedAt: asOf } };
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

function chartQuestionLayout(): Record<string, unknown> {
  const chart = content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart");
  return {
    version: 1,
    nextInstance: 2,
    contents: { [chart.id]: chart },
    slots: [slot("chart", 1, 1, 1, 6, 4)]
  };
}

function tradeAutomationLayout(): Record<string, unknown> {
  const chart = content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart");
  const quickOrder = content("quickOrder", 2, { symbol: "NVDA", qty: 3 });
  const commentary = content("chartCommentary", 3, { chartDocumentId: "asset-visual-chart" });
  return {
    version: 1,
    nextInstance: 4,
    contents: { [chart.id]: chart, [quickOrder.id]: quickOrder, [commentary.id]: commentary },
    slots: [slot("chart", 1, 1, 1, 5, 6), slot("quickOrder", 2, 6, 1, 3, 3), slot("chartCommentary", 3, 6, 4, 3, 3)]
  };
}

function multipleOrderPanelLayout(): Record<string, unknown> {
  const chart = content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart");
  const firstOrder = content("quickOrder", 2, { symbol: "NVDA", qty: 1 });
  const secondOrder = content("quickOrder", 3, { symbol: "AAPL", qty: 7 });
  return {
    version: 1,
    nextInstance: 4,
    contents: { [chart.id]: chart, [firstOrder.id]: firstOrder, [secondOrder.id]: secondOrder },
    slots: [slot("chart", 1, 1, 1, 4, 6), slot("quickOrder", 2, 5, 1, 2, 3), slot("quickOrder", 3, 7, 1, 2, 3)]
  };
}

function chartLinkLayout(): Record<string, unknown> {
  const first = content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart-a");
  const second = content("chart", 2, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart-b");
  const commentary = content("chartCommentary", 3, { chartDocumentId: "asset-visual-chart-a" });
  return {
    version: 1,
    nextInstance: 4,
    contents: { [first.id]: first, [second.id]: second, [commentary.id]: commentary },
    slots: [
      slot("chart", 1, 1, 1, 4, 3),
      slot("chart", 2, 5, 1, 4, 3),
      slot("chartCommentary", 3, 1, 4, 4, 2)
    ]
  };
}

function analysisLayersLayout(narrow: boolean): Record<string, unknown> {
  const contents = [
    content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart"),
    content("chartCommentary", 2, {})
  ];
  return {
    version: 1,
    nextInstance: 3,
    contents: Object.fromEntries(contents.map((item) => [item.id, item])),
    slots: narrow
      ? [slot("chart", 1, 1, 1, 8, 3), slot("chartCommentary", 2, 1, 4, 8, 3)]
      : [slot("chart", 1, 1, 1, 6, 4), slot("chartCommentary", 2, 7, 1, 2, 4)]
  };
}

function patternListLayout(): Record<string, unknown> {
  const contents = [
    content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart"),
    content("chartPatternList", 2, {})
  ];
  return {
    version: 1,
    nextInstance: 3,
    contents: Object.fromEntries(contents.map((item) => [item.id, item])),
    slots: [slot("chartPatternList", 2, 1, 1, 8, 5), slot("chart", 1, 1, 6, 2, 1)]
  };
}

function content(kind: string, index: number, props: Record<string, unknown>, chartDocumentId?: string) {
  return { id: `content-${kind}-${index}`, kind, title: `${kind}-${index}`, instanceIndex: index, layoutWeight: kind === "chart" ? 100 : 50, props, ...(chartDocumentId ? { chartDocumentId } : {}) };
}

function slot(kind: string, index: number, col: number, row: number, colSpan: number, rowSpan: number) {
  return { id: `slot-${kind}-${index}`, contentId: `content-${kind}-${index}`, gridRect: { col, row, colSpan, rowSpan } };
}
