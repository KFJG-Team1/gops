import { expect, test, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedSymbols: unknown = null;
let densePatternCoverage = false;
let includeTradePlan = true;
let includeConditionalEvidence = true;
let delayAgentAnswer = false;

test.beforeEach(async ({ page }, testInfo) => {
  postedSymbols = null;
  densePatternCoverage = false;
  includeTradePlan = true;
  includeConditionalEvidence = true;
  delayAgentAnswer = false;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  const layout = testInfo.title.includes("chart questions keep current commentary")
    ? chartQuestionLayout()
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
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload(url.searchParams.get("symbol") ?? "NVDA", url.searchParams.get("interval") ?? "1D");
  else if (url.pathname === "/api/charts/analysis-assets") payload = url.searchParams.get("symbol") === "NVDA" ? assetResponse() : { symbol: url.searchParams.get("symbol"), assets: {}, meta: {} };
  else if (url.pathname === "/api/charts/analysis-assets/coverage") payload = patternCoverageResponse(densePatternCoverage ? 48 : 0);
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
  else if (url.pathname === "/api/watchlist") payload = { symbols: [] };
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
      supports: includeConditionalEvidence
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
      } } : {})
    },
    indicators: { sma60: 170, sma120: 165, cross: { status: "none", direction: null } }
  };
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

function chartQuestionLayout(): Record<string, unknown> {
  const chart = content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart");
  return {
    version: 1,
    nextInstance: 2,
    contents: { [chart.id]: chart },
    slots: [slot("chart", 1, 1, 1, 6, 4)]
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
