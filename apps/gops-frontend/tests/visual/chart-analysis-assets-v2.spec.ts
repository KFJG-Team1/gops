import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
const candles = fixtureCandles();
let postedBuildRequest: Record<string, unknown> | null = null;
let densePatternCoverage = false;
let includeTradePlan = true;
let includeConditionalEvidence = true;
let delayAgentAnswer = false;
let watchlistSymbols: string[] = [];
let watchlistWrites: string[][] = [];
let nearbyIntervalFallback = false;
let analysisAssetStorageUnavailable = false;
let showPaperHolding = false;

test.beforeEach(async ({ page }, testInfo) => {
  postedBuildRequest = null;
  densePatternCoverage = false;
  includeTradePlan = true;
  includeConditionalEvidence = true;
  delayAgentAnswer = false;
  watchlistSymbols = [];
  watchlistWrites = [];
  nearbyIntervalFallback = false;
  analysisAssetStorageUnavailable = false;
  showPaperHolding = false;
  await page.routeWebSocket("**/ws/charts**", () => undefined);
  await page.routeWebSocket("**/ws/paper/account**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
  const layout = testInfo.title.includes("chart questions keep current commentary")
    ? chartQuestionLayout()
    : testInfo.title.includes("support label")
      ? supportLabelLayout()
    : testInfo.title.includes("multiple order panels")
      ? multipleOrderPanelLayout()
    : testInfo.title.includes("price axis")
      ? tradeAutomationLayout()
    : testInfo.title.includes("commentary chart selection")
      ? chartLinkLayout()
    : testInfo.title.includes("five analysis layers")
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

test("five analysis layers render independently with commentary focus and cards", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const canvas = chart.locator(".chart-canvas");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await chart.hover();
  await expect(chart.locator(".chart-analysis-layer-controls")).toBeVisible();
  await expect(chart.locator(".chart-analysis-layer-controls svg")).toHaveCount(0);
  await expect(page.locator(".chart-analysis-layer-state")).toHaveCount(0);
  await expect(page.locator(".chart-analysis-asof")).toContainText(/근거 유력 후보 · 유력 후보 \d+\/2 · 전체 4/);
  const interpretationToggle = page.getByRole("button", { name: "근거 분석 레이어 켜기" });
  const levelsToggle = page.getByRole("button", { name: /^지지·저항 분석 레이어 (?:켜기|끄기)$/ });
  const trendToggle = page.getByRole("button", { name: /^추세 분석 레이어 (?:켜기|끄기)$/ });
  const patternToggle = page.getByRole("button", { name: /^패턴 분석 레이어 (?:켜기|끄기)$/ });
  const proposalToggle = page.getByRole("button", { name: "제안 분석 레이어 켜기" });
  const evidenceStep = page.locator(".chart-commentary-focus button").first();
  await expect(interpretationToggle).toBeEnabled();
  await expect(levelsToggle).toBeEnabled();
  await expect(trendToggle).toBeEnabled();
  await expect(patternToggle).toBeEnabled();
  await expect(proposalToggle).toBeEnabled();
  await expect(interpretationToggle).toHaveAttribute("data-state", "off");
  await expect(levelsToggle).toHaveAttribute("data-state", "off");
  await expect(trendToggle).toHaveAttribute("data-state", "off");
  await expect(patternToggle).toHaveAttribute("data-state", "off");
  await levelsToggle.click();
  await trendToggle.click();
  await patternToggle.click();
  await expect(levelsToggle).toHaveAttribute("data-state", "on");
  await expect(trendToggle).toHaveAttribute("data-state", "on");
  await expect(patternToggle).toHaveAttribute("data-state", "on");
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveText("상승 삼각형 · 돌파 확인");
  await expect(proposalToggle).toHaveAttribute("data-state", "off");
  await expect(page.getByText(/상승 삼각형 돌파 확인/).first()).toBeVisible();
  const commentaryPanel = page.locator(".chart-commentary-panel");
  const remoteLevelsToggle = commentaryPanel.getByRole("button", { name: "지지·저항 분석 레이어 리모컨 끄기" });
  await expect(remoteLevelsToggle).toHaveAttribute("aria-pressed", "true");
  await remoteLevelsToggle.click();
  await expect(levelsToggle).toHaveAttribute("aria-pressed", "false");
  await commentaryPanel.getByRole("button", { name: "지지·저항 분석 레이어 리모컨 켜기" }).click();
  await expect(levelsToggle).toHaveAttribute("aria-pressed", "true");
  const holdingSummary = commentaryPanel.getByLabel("실계좌 보유 현황");
  await expect(holdingSummary.getByRole("columnheader")).toHaveText(["보유 상태", "평균 매입가", "보유 수량"]);
  await expect(holdingSummary.getByRole("cell")).toHaveText(["보유", "$148.42", "18주"]);
  await expect(commentaryPanel.getByLabel("종합 해설")).toBeVisible();
  const storedCommentary = commentaryPanel.locator(".chart-commentary-generated");
  await expect(storedCommentary).toHaveAttribute("data-prompt-version", "chart-commentary.ko.v5");
  await expect(commentaryPanel.locator(".chart-commentary-reference-tag")).toHaveCount(0);
  await expect(storedCommentary).toHaveClass(/is-collapsed/);
  await expect(storedCommentary.locator(".chart-commentary-link-overview")).toBeVisible();
  await expect(storedCommentary.locator(".chart-commentary-full-text > p")).toHaveCount(0);
  const collapsedReferenceButtons = storedCommentary.locator(".chart-commentary-link-overview button.chart-commentary-inline-reference");
  await expect(collapsedReferenceButtons.first()).toBeVisible();
  await expect.poll(() => collapsedReferenceButtons.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderRadius, style.textDecorationLine, style.minHeight];
  })).toEqual(["7px", "none", "28px"]);
  const commentaryDisclosure = commentaryPanel.getByRole("button", { name: "종합 해설 보기" });
  await expect(commentaryDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect(commentaryPanel).toHaveScreenshot("chart-commentary-panel-collapsed.png", { timeout: 15_000 });
  const drawingReference = commentaryPanel.getByRole("button", { name: "상승 삼각형 돌파 확인 구조 관련 작도 강조 고정" });
  await drawingReference.click();
  await expect(drawingReference).toHaveAttribute("aria-pressed", "true");
  const indicatorRecommendation = commentaryPanel.getByRole("button", { name: "상대강도지수 차트 레이어 전환" });
  await expect(indicatorRecommendation).toHaveAttribute("aria-pressed", "false");
  await indicatorRecommendation.click();
  await expect(indicatorRecommendation).toHaveAttribute("aria-pressed", "true");
  await commentaryDisclosure.click();
  await expect(storedCommentary).toHaveClass(/is-expanded/);
  await expect(storedCommentary.locator(".chart-commentary-link-overview")).toHaveCount(0);
  await expect(storedCommentary.locator(".chart-commentary-full-text > p")).toHaveCount(3);
  await expect(commentaryPanel.getByRole("button", { name: "종합 해설 접기" })).toHaveAttribute("aria-expanded", "true");
  await expect(indicatorRecommendation).toHaveAttribute("aria-pressed", "true");
  await expect(drawingReference).toHaveAttribute("aria-pressed", "true");
  await drawingReference.click();
  await expect(drawingReference).toHaveAttribute("aria-pressed", "false");
  await indicatorRecommendation.click();
  await expect(indicatorRecommendation).toHaveAttribute("aria-pressed", "false");
  const volumeProfileRecommendation = commentaryPanel.getByRole("button", { name: "Volume Profile 차트 레이어 전환" });
  await expect(volumeProfileRecommendation).toHaveAttribute("aria-pressed", "false");
  await volumeProfileRecommendation.click();
  await expect(volumeProfileRecommendation).toHaveAttribute("aria-pressed", "true");
  await expect(chart).toHaveAttribute("data-commentary-volume-profile-status", "ready");
  await volumeProfileRecommendation.click();
  await expect(volumeProfileRecommendation).toHaveAttribute("aria-pressed", "false");
  await expect(chart).toHaveAttribute("data-commentary-volume-profile-status", "off");
  await page.locator(".chart-commentary-source").hover();
  await expect(commentaryPanel.locator(".chart-commentary-price-head").getByRole("columnheader")).toHaveText(["제안", "가격", "현재가 대비"]);
  await expect(commentaryPanel.locator(".chart-commentary-price-table > button > span:first-child")).toHaveText(["매수 검토", "수익 실현 검토", "손실 제한 검토"]);
  const scenarioCard = commentaryPanel.locator(".chart-commentary-scenario");
  await expect(scenarioCard).toHaveAttribute("aria-pressed", "false");
  await scenarioCard.click();
  await expect(scenarioCard).toHaveAttribute("aria-pressed", "true");
  await expect(commentaryPanel.getByRole("button", { name: "제안 분석 레이어 리모컨 끄기" })).toHaveAttribute("aria-pressed", "true");
  await scenarioCard.click();
  await expect(scenarioCard).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "연결", exact: true })).toHaveCount(0);
  expect(await commentaryPanel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(commentaryPanel).toHaveScreenshot("chart-commentary-panel.png", { timeout: 15_000 });
  await expect(canvas).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  });
  await expect(page).toHaveScreenshot("chart-assets-layers-both.png", { fullPage: true, maxDiffPixelRatio: 0.015, timeout: 15_000 });

  await chart.hover();
  await trendToggle.click();
  await expect(page.getByRole("button", { name: "추세 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(patternToggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "추세 분석 레이어 켜기" }).click();
  await patternToggle.click();
  await expect(page.getByRole("button", { name: "패턴 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "추세 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "패턴 분석 레이어 켜기" }).click();

  await levelsToggle.click();
  await expect(page.getByRole("button", { name: "지지·저항 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(patternToggle).toHaveAttribute("aria-pressed", "true");
  await evidenceStep.hover();
  await page.locator(".chart-commentary-summary").hover();
  await chart.hover();
  await page.getByRole("button", { name: "지지·저항 분석 레이어 켜기" }).click();

  await proposalToggle.click();
  await expect(page.getByRole("button", { name: "제안 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "제안 분석 레이어 끄기" }).click();

  await interpretationToggle.click();
  await expect(page.getByRole("button", { name: "근거 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");

  await evidenceStep.hover();
  await evidenceStep.focus();
  await expect(evidenceStep).toBeFocused();

  const glossaryTerm = page.locator(".chart-commentary-panel .glossary-term").first();
  await glossaryTerm.scrollIntoViewIfNeeded();
  await glossaryTerm.hover();
  await expect(page.locator("#gops-glossary-tooltip")).toBeVisible();
  await glossaryTerm.focus();
  await expect(glossaryTerm).toBeFocused();
  await expect(page.locator("#gops-glossary-tooltip")).toBeVisible();
  await glossaryTerm.blur();

  const commentarySteps = page.locator(".chart-commentary-focus button");
  const trendStep = commentarySteps.nth(1);
  const patternStep = commentarySteps.nth(2);
  await expect(evidenceStep).toHaveAttribute("aria-pressed", "true");
  await expect(trendStep).toHaveAttribute("aria-pressed", "true");
  await expect(patternStep).toHaveAttribute("aria-pressed", "true");
  await evidenceStep.hover();
  await expect(evidenceStep).toHaveAttribute("aria-pressed", "true");
  await evidenceStep.click();
  await expect(evidenceStep).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "지지·저항 분석 레이어 리모컨 켜기" })).toHaveAttribute("aria-pressed", "false");
  await evidenceStep.click();
  await expect(evidenceStep).toHaveAttribute("aria-pressed", "true");
  await trendStep.click();
  await expect(evidenceStep).toHaveAttribute("aria-pressed", "true");
  await expect(trendStep).toHaveAttribute("aria-pressed", "false");
  await patternStep.hover();
  await page.locator(".chart-commentary-summary").hover();
  await expect(trendStep).toHaveAttribute("aria-pressed", "false");
  await trendStep.click();
  await expect(trendStep).toHaveAttribute("aria-pressed", "true");
  await patternStep.focus();
  await patternStep.press("Enter");
  await expect(patternStep).toHaveAttribute("aria-pressed", "false");
  await patternStep.press("Enter");
  await expect(patternStep).toHaveAttribute("aria-pressed", "true");

  const candleReference = commentaryPanel.locator("button.chart-commentary-inline-reference.is-candle").filter({ hasText: "최근 완료 봉" });
  await expect(candleReference).toBeEnabled();
  await expect(candleReference).toHaveAttribute("aria-pressed", "false");
  await candleReference.click();
  await expect(candleReference).toHaveAttribute("aria-pressed", "true");
  await expect(chart.getByRole("button", { name: "선택 항목에 질문하기" })).toBeVisible();
  const centeredLatestOffset = await chart.evaluate((element) => {
    const visibleCount = Number(element.getAttribute("data-chart-visible-count"));
    const candleCount = Number(element.getAttribute("data-chart-candle-count"));
    return {
      actual: Number(element.getAttribute("data-chart-right-offset")),
      expected: candleCount - (candleCount - 1) - 0.5 - visibleCount / 2
    };
  });
  expect(Math.abs(centeredLatestOffset.actual - centeredLatestOffset.expected)).toBeLessThan(0.01);
  await candleReference.click();
  await expect(candleReference).toHaveAttribute("aria-pressed", "false");
  await expect(chart.getByRole("button", { name: "선택 항목에 질문하기" })).toHaveCount(0);

  const newsReference = commentaryPanel.locator("button.chart-commentary-inline-reference.is-news").filter({ hasText: "최근 뉴스 맥락" });
  await expect(newsReference).toHaveAttribute("aria-pressed", "false");
  await newsReference.click();
  await expect(newsReference).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-event-popover")).toBeVisible();
  const centeredNewsOffset = await chart.evaluate((element) => {
    const visibleCount = Number(element.getAttribute("data-chart-visible-count"));
    const candleCount = Number(element.getAttribute("data-chart-candle-count"));
    return {
      actual: Number(element.getAttribute("data-chart-right-offset")),
      expected: candleCount - (candleCount - 1) - 0.5 - visibleCount / 2
    };
  });
  expect(Math.abs(centeredNewsOffset.actual - centeredNewsOffset.expected)).toBeLessThan(0.01);
  await newsReference.click();
  await expect(newsReference).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".chart-event-popover")).toHaveCount(0);
  await expect(chart.locator("[data-chart-event-id^='news:NVDA:']")).toBeVisible();
});

test("five analysis layers commentary references center before opening", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const commentaryPanel = page.locator(".chart-commentary-panel");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");

  const candleReference = commentaryPanel.locator("button.chart-commentary-inline-reference.is-candle").filter({ hasText: "최근 완료 봉" });
  await candleReference.click();
  await expect(candleReference).toHaveAttribute("aria-pressed", "true");
  const candleOffset = await centeredOffsetSnapshot(chart, 139);
  expect(Math.abs(candleOffset.actual - candleOffset.expected)).toBeLessThan(0.01);
  await candleReference.click();
  await expect(candleReference).toHaveAttribute("aria-pressed", "false");
  await expect(chart).toHaveAttribute("data-chart-right-offset", String(candleOffset.actual));

  const newsReference = commentaryPanel.locator("button.chart-commentary-inline-reference.is-news").filter({ hasText: "최근 뉴스 맥락" });
  await newsReference.click();
  await expect(newsReference).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-event-popover")).toBeVisible();
  const newsOffset = await centeredOffsetSnapshot(chart, 139);
  expect(Math.abs(newsOffset.actual - newsOffset.expected)).toBeLessThan(0.01);
  await newsReference.click();
  await expect(newsReference).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".chart-event-popover")).toHaveCount(0);
  await expect(chart).toHaveAttribute("data-chart-right-offset", String(newsOffset.actual));
});

test("interpretation alone keeps broad final underlays and shortlisted candidates", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await chart.hover();
  await page.getByRole("button", { name: "근거 분석 레이어 켜기" }).click();
  await expect(page.getByRole("button", { name: "근거 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveCount(0);
  await expect(chart).toHaveScreenshot("chart-assets-interpretation-only-underlays.png", { maxDiffPixelRatio: 0.015, timeout: 15_000 });
});

test("final analysis strokes sit above their interpretation underlays", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await chart.hover();
  await page.getByRole("button", { name: "근거 분석 레이어 켜기" }).click();
  await page.getByRole("button", { name: "지지·저항 분석 레이어 켜기" }).click();
  await page.getByRole("button", { name: "추세 분석 레이어 켜기" }).click();
  await page.getByRole("button", { name: "패턴 분석 레이어 켜기" }).click();
  await expect(page.getByRole("button", { name: "지지·저항 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "추세 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "패턴 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveText("상승 삼각형 · 돌파 확인");
  await expect(chart).toHaveScreenshot("chart-assets-interpretation-with-final-strokes.png", { maxDiffPixelRatio: 0.015, timeout: 15_000 });
});

test("commentary focus highlights evidence and card clicks toggle the final layer", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await chart.hover();
  await page.getByRole("button", { name: "근거 분석 레이어 켜기" }).click();
  const focusButtons = page.locator(".chart-commentary-focus button");
  await expect(focusButtons).toHaveCount(3);
  await focusButtons.nth(0).hover();
  await expect(chart).toHaveScreenshot("chart-assets-interpretation-focused-underlays.png", { maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await focusButtons.nth(1).hover();
  await expect(chart).toHaveScreenshot("chart-assets-interpretation-focused-trend.png", { maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await focusButtons.nth(2).hover();
  await expect(chart).toHaveScreenshot("chart-assets-interpretation-focused-pattern.png", { maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await focusButtons.nth(2).click();
  await expect(focusButtons.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "패턴 분석 레이어 리모컨 끄기" })).toHaveAttribute("aria-pressed", "true");
  await focusButtons.nth(2).click();
  await expect(focusButtons.nth(2)).toHaveAttribute("aria-pressed", "false");
});

test("proposal toggle is disabled when the asset has no proposal drawings", async ({ page }) => {
  includeTradePlan = false;
  includeConditionalEvidence = false;
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await chart.hover();
  await expect(page.getByRole("button", { name: "지지·저항 분석 레이어 켜기" })).toBeEnabled();
  const unavailableProposalToggle = page.getByRole("button", { name: "제안 분석 레이어 사용 불가" });
  await expect(unavailableProposalToggle).toBeDisabled();
  await expect(unavailableProposalToggle).toHaveAttribute("data-state", "unavailable");
  await expect(unavailableProposalToggle).not.toHaveAttribute("aria-pressed", /.+/);
  await expect(chart.locator(".chart-analysis-layer-controls")).toHaveScreenshot("chart-assets-no-proposal.png", { timeout: 15_000 });
});

test("another interval never becomes a silent proposal fallback", async ({ page }) => {
  includeTradePlan = false;
  nearbyIntervalFallback = true;
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel").first();
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 사용 불가" })).toBeDisabled();
  await expect.poll(() => page.evaluate(async () => {
    const store = await import("/src/chart/chartTradeSetupStore.ts");
    return store.getChartTradeSetupSnapshot("asset-visual-chart");
  })).toBeNull();
});

test("commentary chart selection targets one chart document at a time", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const charts = page.locator(".workspace-panel-frame").filter({ has: page.locator(".chart-canvas") });
  await expect(charts).toHaveCount(2);
  const selector = page.getByRole("button", { name: "연결", exact: true });
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
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toBeEnabled();
  await page.getByLabel("Agent command").fill("차트 분석해줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();
  await expect(page.locator(".chart-commentary-pending")).toContainText("현재 해설은 그대로 유지됩니다");
  await expect(page.getByRole("button", { name: "대화", exact: true })).toBeVisible();
  await expect(page.getByLabel("종합 해설")).toBeVisible();
  await page.getByRole("button", { name: "대화", exact: true }).click();
  await expect(page.getByText("분석하고 있습니다.")).toBeVisible();
  await expect(page.getByText("기존 Geometry 자산의 지지·패턴을 기준으로 해설했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "해설", exact: true })).toBeVisible();
  const answer = page.locator(".chart-commentary-answer");
  const supportFocus = answer.locator(".chart-commentary-answer-focus").getByRole("button", { name: "지지·저항" });
  await supportFocus.hover();
  await expect(answer).toHaveScreenshot("chart-commentary-question-answer.png", { maxDiffPixelRatio: 0.015, timeout: 15_000 });
  await page.getByRole("button", { name: "해설", exact: true }).click();
  await expect(page.getByText(/지지선 1개와 저항선 0개를 관찰합니다/)).toBeVisible();
});

test("reservation buy with quantity and alternate verb asks for a price instead of chart analysis", async ({ page }) => {
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

  await page.getByLabel("Agent command").fill("AMD 예약 매수 20주 걸어줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();

  await expect(page.locator(".workspace-agent-notice")).toContainText("어느 가격에 예약할까요?");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(executionRequests).toEqual([]);
});

test("reservation buy uses a price written in the prompt without a price-axis selection", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toBeEnabled();

  await page.getByLabel("Agent command").fill("NVDA 185.50달러에 예약 매수 20주 걸어줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("NVDA · 1D");
  await expect(dialog).toContainText("$185.50");
  await expect(dialog.getByLabel("예약 수량")).toHaveValue("20");
  expect(executionRequests).toEqual([]);
});

test("reservation sell uses the prompt side even when the chart setup is a buy candidate", async ({ page }) => {
  const executionRequests: string[] = [];
  let conditionBody: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && [
      "/api/trade-conditions",
      "/api/trade-conditions/commands",
      "/api/agents/analyze"
    ].includes(pathname)) {
      executionRequests.push(pathname);
      if (pathname === "/api/trade-conditions") conditionBody = request.postDataJSON();
    }
  });
  await page.goto("/?symbol=NVDA");
  await expect(page.locator(".chart-panel")).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toBeEnabled();

  await page.getByLabel("Agent command").fill("NVDA 190달러에 예약 매도 20주 걸어줘");
  await page.getByRole("button", { name: "Agent에게 전송" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("조건부 매도 검토 확인");
  await expect(dialog).toContainText("분석 예상 하단 가격 (참고)");
  await expect(dialog).toContainText("분석 재검토 가격 (참고)");
  await expect(dialog).toContainText("$190.00");
  await dialog.getByRole("button", { name: "확인" }).click();
  await expect(page.locator(".workspace-agent-notice")).toContainText("NVDA 20주 예약매매와 가격 알림을 등록했습니다");
  expect(executionRequests).toEqual(["/api/trade-conditions"]);
  expect(conditionBody).toMatchObject({
    symbol: "NVDA",
    side: "sell",
    direction: "atOrAbove",
    triggerPrice: 190,
    limitPrice: 190,
    quantity: 20
  });
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
  await expect(page.locator(".chart-panel")).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toBeEnabled();
  const canvas = page.locator(".chart-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  const axisPoint = { x: canvasBox.width - 12, y: canvasBox.height * .48 };
  await canvas.hover({ position: axisPoint });
  await canvas.click({ position: axisPoint });

  const quickOrder = page.locator(".quick-order-panel");
  await expect(quickOrder.locator(".order-chart-price-source")).toHaveCount(0);
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
  await expect(dialog).toContainText("조건부 매수 시나리오");
  await expect(dialog).toContainText(`$${selectedPrice}`);
  await expect(dialog).toContainText("$198.00");
  await expect(dialog).toContainText("$164.00");
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

test("price axis support label snaps the order price while the remaining axis stays continuous", async ({ page }) => {
  await routeValidSimulatorStatus(page);
  const executionRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && ["/api/orders", "/api/paper/orders"].includes(pathname)) {
      executionRequests.push(pathname);
    }
  });
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const quickOrder = page.locator(".quick-order-panel");
  const levelsToggle = chart.getByRole("button", { name: "지지·저항 분석 레이어 켜기" });
  await chart.hover();
  await levelsToggle.click();

  const supportTarget = chart.locator('.chart-analysis-level-price-target[data-analysis-level-price="164.00"]');
  await expect(supportTarget).toHaveCount(1);
  await expect(supportTarget).toHaveAttribute("aria-label", "지지 가격 164.00 주문창에 적용");
  await supportTarget.click();
  await expect(quickOrder.getByLabel("빠른 주문 가격 직접 입력")).toHaveValue("164.00");
  await expect(quickOrder.getByLabel("주문 수량 직접 입력")).toHaveValue("3");
  expect(executionRequests).toEqual([]);
  await quickOrder.getByLabel("빠른 주문 가격 직접 입력").fill("170.00");
  await supportTarget.focus();
  await supportTarget.press("Enter");
  await expect(quickOrder.getByLabel("빠른 주문 가격 직접 입력")).toHaveValue("164.00");

  const canvas = chart.locator(".chart-canvas");
  const canvasBox = await canvas.boundingBox();
  const targetBox = await supportTarget.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!canvasBox || !targetBox) return;
  const targetCenterY = targetBox.y - canvasBox.y + targetBox.height / 2;
  const continuousY = targetCenterY < canvasBox.height * .5
    ? targetCenterY + 28
    : targetCenterY - 28;
  await canvas.click({ position: { x: canvasBox.width - 12, y: continuousY } });
  const continuousPrice = await quickOrder.getByLabel("빠른 주문 가격 직접 입력").inputValue();
  expect(Number(continuousPrice)).toBeGreaterThan(0);
  expect(continuousPrice).not.toBe("164.00");
  await expect(quickOrder.getByLabel("주문 수량 직접 입력")).toHaveValue("3");
  expect(executionRequests).toEqual([]);

  await chart.getByRole("button", { name: "지지·저항 분석 레이어 끄기" }).click();
  await expect(supportTarget).toHaveCount(0);
});

test("price axis and proposal labels share order selection while scenario controls only its chart", async ({ page }) => {
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel");
  const quickOrder = page.locator(".quick-order-panel");
  const scenario = page.getByRole("button", { name: "조건부 매수 시나리오 제안 레이어 전환" });
  const labels = chart.locator(".chart-trade-plan-price-label");
  await expect(chart).toHaveAttribute("data-chart-candle-count", "140");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toBeEnabled();
  await expect(labels).toHaveCount(0);

  await scenario.hover();
  await expect(labels).toHaveCount(3);
  await expect(chart.getByRole("button", { name: "매수 검토 가격 178.00 주문창에 적용" })).toHaveText("매수 검토 $178.00");
  await expect(chart.getByRole("button", { name: "수익 실현 검토 가격 198.00 주문창에 적용" })).toHaveText("수익 실현 검토 $198.00");
  await expect(chart.getByRole("button", { name: "손실 제한 검토 가격 164.00 주문창에 적용" })).toHaveText("손실 제한 검토 $164.00");
  await expect(chart).toHaveScreenshot("chart-proposal-hover-labels.png", { maxDiffPixelRatio: 0.015 });

  await chart.hover();
  await expect(labels).toHaveCount(0);
  await scenario.focus();
  await expect(labels).toHaveCount(3);
  await scenario.press("Enter");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 끄기" })).toHaveAttribute("aria-pressed", "true");
  const assertLabelsRightOfBox = async () => {
    const overlay = chart.locator(".chart-trade-plan-price-overlay");
    const boxRight = Number(await overlay.getAttribute("data-box-right"));
    const labelLefts = await labels.evaluateAll((items) => items.map((item) => Number.parseFloat((item as HTMLElement).style.left)));
    expect(Number.isFinite(boxRight)).toBe(true);
    expect(Math.min(...labelLefts)).toBeGreaterThan(boxRight);
  };
  await assertLabelsRightOfBox();
  const canvasBox = await chart.locator(".chart-canvas").boundingBox();
  if (!canvasBox) throw new Error("chart canvas missing");
  await page.mouse.move(canvasBox.x + canvasBox.width * .55, canvasBox.y + canvasBox.height * .55);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * .55 - 36, canvasBox.y + canvasBox.height * .55, { steps: 3 });
  await page.mouse.up();
  await expect(labels).toHaveCount(3);
  await assertLabelsRightOfBox();
  const targetLabel = chart.getByRole("button", { name: "수익 실현 검토 가격 198.00 주문창에 적용" });
  const patternToggle = chart.getByRole("button", { name: "패턴 분석 레이어 켜기" });
  await expect(patternToggle).toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveCount(0);
  await targetLabel.focus();
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveText("상승 삼각형 · 돌파 확인");
  await expect(targetLabel).toHaveAttribute("data-source-drawing-ids", /triangle-upper.*triangle-lower|triangle-lower.*triangle-upper/);
  await targetLabel.press("Enter");
  await expect(quickOrder.getByLabel("빠른 주문 가격 직접 입력")).toHaveValue("198.00");
  await expect(quickOrder.locator(".order-chart-price-source")).toHaveCount(0);
  await targetLabel.blur();
  await expect(chart.locator(".chart-primary-pattern-badge")).toHaveCount(0);

  await scenario.focus();
  await scenario.press("Space");
  await expect(page.getByRole("button", { name: "제안 분석 레이어 켜기" })).toHaveAttribute("aria-pressed", "false");
  await expect(labels).toHaveCount(3);
  await scenario.blur();
  await expect(labels).toHaveCount(0);
});

test("price axis targets the last interacted panel when multiple order panels exist", async ({ page }) => {
  await routeValidSimulatorStatus(page);
  await page.goto("/?symbol=NVDA");
  const orderPanels = page.locator(".quick-order-panel");
  await expect(orderPanels).toHaveCount(2);
  await orderPanels.nth(1).click({ position: { x: 12, y: 12 } });
  await page.locator(".chart-panel").hover();
  await page.getByRole("button", { name: "지지·저항 분석 레이어 켜기" }).click();
  await page.locator('.chart-analysis-level-price-target[data-analysis-level-price="164.00"]').click();
  await expect(page.locator(".order-chart-price-source")).toHaveCount(0);
  await expect(orderPanels.nth(0).getByLabel("빠른 주문 가격 직접 입력")).toHaveValue("");
  await expect(orderPanels.nth(1).getByLabel("빠른 주문 가격 직접 입력")).toHaveValue("164.00");
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
  await expect(ops.getByLabel("전체 S&P500")).toHaveCount(0);
  await expect(ops.locator(".chart-asset-ops-actions button")).toHaveCount(1);
  await ops.getByLabel("빌드 심볼").fill("NVDA,AAPL, MSFT");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("성공한 자산만 LIVE 저장본을 교체합니다");
    await dialog.accept();
  });
  await ops.getByRole("button", { name: "작도 자산 생성·갱신" }).click();
  await expect.poll(() => postedBuildRequest).toMatchObject({
    symbols: ["NVDA", "AAPL", "MSFT"],
    intervals: ["1m", "1D"],
    force: true
  });
  const universeRow = ops.locator(".chart-asset-ops-universe-row");
  const rowBox = await universeRow.boundingBox();
  const hintBox = await ops.getByText("콤마로 구분", { exact: true }).boundingBox();
  expect(rowBox).not.toBeNull();
  expect(hintBox).not.toBeNull();
  if (rowBox && hintBox) expect(Math.abs((hintBox.x + hintBox.width) - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(2);
  await expect(universeRow).toHaveScreenshot("chart-assets-ops.png", { timeout: 15_000 });
});

test("analysis asset storage failure is distinct from an absent asset", async ({ page }) => {
  analysisAssetStorageUnavailable = true;
  await page.goto("/?symbol=NVDA");
  await expect(page.locator(".chart-analysis-layer-controls").getByRole("status"))
    .toHaveText("작도 자산 저장소에 접근할 수 없습니다.");
  await expect(page.locator(".chart-asset-ops-current").getByRole("alert"))
    .toHaveText("작도 자산 저장소에 접근할 수 없습니다.");
  await expect(page.locator(".chart-asset-ops-current"))
    .not.toContainText("현재 주기의 저장 자산이 없습니다.");
});

test("average purchase price marker stays in the right-side scale lane", async ({ page }, testInfo) => {
  showPaperHolding = true;
  await page.goto("/?symbol=NVDA");
  const chart = page.locator(".chart-panel").first();
  const marker = chart.locator(".chart-holding-price-marker");
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS("left", /px/);
  await expect(marker).toHaveCSS("width", /px/);
  await expect(marker.locator(".chart-holding-price-pill")).toHaveCount(0);

  const chartBox = await chart.boundingBox();
  const markerBox = await marker.boundingBox();
  expect(chartBox).not.toBeNull();
  expect(markerBox).not.toBeNull();
  if (chartBox && markerBox) {
    expect(markerBox.x).toBeGreaterThan(chartBox.x + chartBox.width - 160);
    expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width + 1);
  }

  await marker.focus();
  const tooltip = marker.locator(".chart-holding-price-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCSS("opacity", "1");
  await chart.screenshot({ path: testInfo.outputPath("average-purchase-price-marker.png") });
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
  else if (url.pathname === "/api/paper/account") payload = paperAccountFixture(showPaperHolding);
  else if (url.pathname === "/api/account/holdings") payload = {
    status: "ok",
    source: "kis",
    asOf: candles.at(-1)?.timestamp,
    account: { currency: "USD" },
    positions: [{ symbol: "NVDA", quantity: 18, averagePrice: 148.42 }]
  };
  else if (url.pathname === "/api/charts/symbols") payload = { symbols: [{ symbol: "NVDA", tradable: true }, { symbol: "AAPL", tradable: true }] };
  else if (url.pathname === "/api/charts/candles") payload = candlePayload(url.searchParams.get("symbol") ?? "NVDA", url.searchParams.get("interval") ?? "1D");
  else if (url.pathname === "/api/charts/events") payload = commentaryChartEventsPayload(url);
  else if (url.pathname === "/api/charts/analysis-assets/commentary") {
    if (analysisAssetStorageUnavailable) {
      status = 503;
      payload = { detail: "Chart commentary asset storage is unavailable." };
    } else {
      const symbol = url.searchParams.get("symbol") ?? "NVDA";
      const interval = url.searchParams.get("interval") ?? "1D";
      const fullAsset = symbol === "NVDA"
        ? (assetResponse().assets as Record<string, any>)[interval]
        : null;
      payload = {
        symbol,
        interval,
        asset: fullAsset ? {
          assetVersion: fullAsset.assetVersion,
          algorithmVersion: fullAsset.algorithmVersion,
          asOf: fullAsset.asOf,
          generatedAt: fullAsset.generatedAt,
          inputDigest: fullAsset.inputDigest,
          drawingIds: fullAsset.geometry.drawings.map((drawing: { id: string }) => drawing.id),
          commentary: fullAsset.commentary ?? null
        } : null,
        meta: {}
      };
    }
  }
  else if (url.pathname === "/api/charts/analysis-assets") {
    if (analysisAssetStorageUnavailable) {
      status = 503;
      payload = { detail: "Chart analysis asset storage is unavailable." };
    } else {
      payload = url.searchParams.get("symbol") === "NVDA" ? assetResponse() : { symbol: url.searchParams.get("symbol"), assets: {}, meta: {} };
    }
  }
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
    postedBuildRequest = request.postDataJSON() as Record<string, unknown>;
    status = 503;
    payload = { detail: "fixture queue disabled" };
  } else if (url.pathname === "/api/charts/indicators") payload = { symbol: "NVDA", interval: "1D", series: {} };
  else if (url.pathname === "/api/charts/volume-profile-bins") payload = commentaryVolumeProfilePayload(url);
  else if (url.pathname === "/api/market/heatmap") payload = { items: [] };
  else if (url.pathname === "/api/simulator/status") payload = {
    available: true,
    mode: "live",
    state: "idle",
    datasetId: "chart-analysis-fixture",
    virtualTime: candles.at(-1)?.timestamp,
    startTime: candles[0]?.timestamp,
    endTime: candles.at(-1)?.timestamp,
    requestedSpeed: 1,
    effectiveSpeed: 1,
    processedEventCount: 0,
    totalEventCount: 0,
    progress: 0,
    lagMs: 0,
    symbols: [{ symbol: "NVDA" }, { symbol: "AAPL" }]
  };
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

async function routeValidSimulatorStatus(page: Page): Promise<void> {
  await page.route("**/api/simulator/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        mode: "live",
        state: "idle",
        datasetId: "chart-analysis-fixture",
        virtualTime: candles.at(-1)?.timestamp,
        startTime: candles[0]?.timestamp,
        endTime: candles.at(-1)?.timestamp,
        requestedSpeed: 1,
        effectiveSpeed: 1,
        processedEventCount: 0,
        totalEventCount: 0,
        progress: 0,
        lagMs: 0,
        symbols: [{ symbol: "NVDA" }, { symbol: "AAPL" }]
      })
    });
  });
}

function paperAccountFixture(withHolding: boolean) {
  const position = {
    symbol: "NVDA",
    qty: 18,
    reserved_qty: 0,
    available_qty: 18,
    average_price: 164.8,
    current_price: 167.59,
    market_value: 3_016.62,
    cost_basis: 2_966.4,
    unrealized_pnl: 50.22,
    unrealized_pnl_rate: 1.69,
    realized_pnl: 0,
    price_source: "live_trade"
  };
  return {
    source: "paper",
    execution_mode: "paper",
    account: {
      generation: 1,
      currency: "USD",
      starting_cash: 100_000,
      cash_balance: 97_328.44,
      reserved_cash: 0,
      available_cash: 97_328.44,
      market_value: withHolding ? position.market_value : 0,
      equity: withHolding ? 100_050.76 : 100_000,
      unrealized_pnl: withHolding ? position.unrealized_pnl : 0,
      realized_pnl: 0,
      total_pnl: withHolding ? position.unrealized_pnl : 0,
      total_pnl_rate: withHolding ? 0.05 : 0,
      started_at: "2026-07-01T00:00:00Z"
    },
    positions: withHolding ? [position] : [],
    open_orders: []
  };
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
        { title: "확인·재검토 조건", bullets: ["진입 178.00 / 손절 170.00 / 목표 194.00, 손익비 2.00"] }
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

function commentaryVolumeProfilePayload(url: URL): Record<string, unknown> {
  const priceMin = Number(url.searchParams.get("priceMin") ?? 150);
  const priceMax = Number(url.searchParams.get("priceMax") ?? 200);
  const targetBins = Number(url.searchParams.get("targetBins") ?? 10);
  const candleCount = Number(url.searchParams.get("candleCount") ?? candles.length);
  const width = (priceMax - priceMin) / targetBins;
  const bins = Array.from({ length: targetBins }, (_, index) => ({
    index,
    priceBin: priceMin + (index + 0.5) * width,
    priceBinSize: width,
    priceMin: priceMin + index * width,
    priceMax: priceMin + (index + 1) * width,
    priceMid: priceMin + (index + 0.5) * width,
    volume: 1000 + index * 100,
    tradeCount: 10 + index,
    volumePercent: 1 / targetBins,
    isPoc: index === Math.floor(targetBins / 2),
    inValueArea: index >= 2 && index <= 7
  }));
  const interval = url.searchParams.get("interval") ?? "1D";
  return {
    symbol: url.searchParams.get("symbol") ?? "NVDA",
    interval,
    sourceInterval: interval,
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    timeBucket: interval,
    targetBins,
    bucketCount: bins.length,
    priceBinSize: width,
    sourceBinCount: bins.length,
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
    derived: { state: "ready", source: "redis", requestHash: "fixture-commentary-vp" }
  };
}

function commentaryChartEventsPayload(url: URL): Record<string, unknown> {
  const symbol = (url.searchParams.get("symbol") ?? "NVDA").toUpperCase();
  const marketDate = candles.at(-2)?.timestamp.slice(0, 10) ?? "2026-07-08";
  return {
    symbol,
    from: url.searchParams.get("from") ?? candles[0].timestamp,
    to: url.searchParams.get("to") ?? candles.at(-1)?.timestamp,
    status: { earnings: "empty", news: "ready" },
    earnings: [],
    newsDays: [{
      id: `news:${symbol}:${marketDate}`,
      type: "news",
      date: marketDate,
      articleCount: 2,
      summary: "분석 시점의 저장 뉴스 맥락",
      keyPoints: ["차트 구조와 함께 확인"],
      impactDirection: "neutral",
      sentiment: "neutral",
      sources: []
    }],
    upcomingEarnings: null
  };
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

async function centeredOffsetSnapshot(chart: Locator, targetIndex: number) {
  return chart.evaluate((element, index) => {
    const visibleCount = Number(element.getAttribute("data-chart-visible-count"));
    const candleCount = Number(element.getAttribute("data-chart-candle-count"));
    return {
      actual: Number(element.getAttribute("data-chart-right-offset")),
      expected: candleCount - index - 0.5 - visibleCount / 2
    };
  }, targetIndex);
}

function drawing(id: string, type: string, anchors: Array<Record<string, unknown>>, label: string, color: string) {
  return { id, type, anchors, symbol: "NVDA", interval: "1D", sourceInterval: "1D", style: { color, lineWidth: 2, opacity: .95 }, label, locked: false, visible: true, createdBy: "system", sourceProposalId: "chart-asset:NVDA:1D:test", createdAt: candles.at(-1)?.timestamp, updatedAt: candles.at(-1)?.timestamp };
}

function assetResponse(): Record<string, unknown> {
  const asOf = candles.at(-1)?.timestamp;
  const commentaryMarketDate = candles.at(-2)?.timestamp.slice(0, 10) ?? "2026-07-08";
  const hline = drawing("chart-asset:NVDA:1D:support", "horizontalLine", [{ timestamp: candles[50].timestamp, price: 164 }, { timestamp: candles[100].timestamp, price: 164 }], "지지", "#22c55e");
  const upper = drawing("chart-asset:NVDA:1D:triangle-upper", "trendLine", [{ timestamp: candles[40].timestamp, price: 178 }, { timestamp: candles[139].timestamp, price: 178 }], "상승 삼각형 · 형성 중", "#22c55e");
  const lower = drawing("chart-asset:NVDA:1D:triangle-lower", "trendLine", [{ timestamp: candles[40].timestamp, price: 158 }, { timestamp: candles[139].timestamp, price: 164 }], "상승 삼각형 · 형성 중", "#22c55e");
  const trend = drawing("chart-asset:NVDA:1D:trend-primary", "trendLine", [{ timestamp: candles[25].timestamp, price: 154 }, { timestamp: candles[120].timestamp, price: 169 }], "상승 추세선", "#22c55e");
  const asset = {
    assetVersion: "geometry", algorithmVersion: "ohlcv-consensus-1", symbol: "NVDA", interval: "1D", sourceInterval: "1D",
    asOf, generatedAt: asOf, status: "ready", inputDigest: "sha256:fixture",
    coverage: { state: "partial", targetBars: 380, actualBars: 140, contiguousBars: 140, missingBars: 240 },
    geometry: {
      drawings: [hline, upper, lower, trend],
      drawingGroups: {
        levels: [hline.id],
        trend: [trend.id],
        pattern: [upper.id, lower.id]
      },
      supports: includeConditionalEvidence && !nearbyIntervalFallback
        ? [{ id: "support", role: "support", price: 164, zoneLow: 163.4, zoneHigh: 164.6, halfWidthAtr: .4, score: .8, touches: 2, anchors: hline.anchors }]
        : [],
      resistances: [], patterns: [], primaryPattern: null,
      primaryTriangle: { kind: "ascending_triangle", state: "confirmed", score: .9, touches: 5, geometryHash: "triangle" },
      historicalTriangle: null,
      analysisTrace: {
        version: "geometry-analysis-trace-v2",
        pivots: includeConditionalEvidence && !nearbyIntervalFallback ? [
          { id: "pivot-support", kind: "L", timestamp: candles[50].timestamp, confirmedAt: candles[52].timestamp, price: 164 },
          { id: "pivot-rejected", kind: "H", timestamp: candles[75].timestamp, confirmedAt: candles[77].timestamp, price: 168 },
          { id: "pivot-trend-a", kind: "L", timestamp: candles[30].timestamp, confirmedAt: candles[32].timestamp, price: 158 },
          { id: "pivot-trend-b", kind: "L", timestamp: candles[90].timestamp, confirmedAt: candles[92].timestamp, price: 166 },
          { id: "pivot-pattern-upper", kind: "H", timestamp: candles[40].timestamp, confirmedAt: candles[42].timestamp, price: 176 },
          { id: "pivot-pattern-lower", kind: "L", timestamp: candles[60].timestamp, confirmedAt: candles[62].timestamp, price: 161 }
        ] : [],
        levelCandidates: includeConditionalEvidence && !nearbyIntervalFallback ? [{
          id: "support", category: "level", role: "support", score: .8, selected: true,
          hardPass: true, evidencePass: true, activePass: true, rejectReasons: [],
          categoryRank: 1, disposition: "selected", selectionReasons: ["confirmed"],
          render: { drawingType: "horizontalLine", extension: "plot" },
          anchors: [{ timestamp: candles[50].timestamp, price: 164 }, { timestamp: candles[100].timestamp, price: 164 }],
          evidenceRefs: ["pivot-support"], touchRefs: ["touch-support"], reactionRefs: ["touch-support"],
          touches: [{ id: "touch-support", timestamp: candles[100].timestamp, price: 164, barIndex: 100, outcome: "reaction" }],
          metrics: { price: 164, touchCount: 2, reactionCount: 1, currentDistanceAtr: .5 }
        }, {
          id: "rejected-resistance", category: "level", role: "resistance", score: .42, selected: false,
          hardPass: true, evidencePass: true, activePass: true, rejectReasons: [],
          categoryRank: 2, disposition: "qualified_not_selected", selectionReasons: [],
          render: { drawingType: "horizontalLine", extension: "plot" },
          anchors: [{ timestamp: candles[75].timestamp, price: 168 }, { timestamp: candles[120].timestamp, price: 168 }],
          evidenceRefs: ["pivot-rejected"], touchRefs: ["touch-rejected"], reactionRefs: [],
          touches: [{ id: "touch-rejected", timestamp: candles[120].timestamp, price: 168, barIndex: 120, outcome: "touch" }],
          metrics: { price: 168, touchCount: 1, reactionCount: 0, currentDistanceAtr: 1.6 }
        }] : [],
        trendCandidates: includeConditionalEvidence && !nearbyIntervalFallback ? [{
          id: "rejected-uptrend", category: "trend", kind: "uptrend", direction: "up", score: .55,
          selected: false, hardPass: true, evidencePass: true, activePass: true,
          rejectReasons: [], categoryRank: 1, disposition: "qualified_not_selected", selectionReasons: [],
          render: { drawingType: "trendLine", extension: "ray", direction: "up" },
          anchors: [{ timestamp: candles[30].timestamp, price: 158 }, { timestamp: candles[90].timestamp, price: 166 }],
          evidenceRefs: ["pivot-trend-a", "pivot-trend-b"], anchorPivotIds: ["pivot-trend-a", "pivot-trend-b"],
          touchPivotIds: ["pivot-trend-a", "pivot-trend-b"], reactionPivotIds: [], touchRefs: [], reactionRefs: [], touches: [],
          metrics: { slopeAtrPerBar: .08, currentDistanceAtr: 2.2 }
        }] : [],
        patternCandidates: includeConditionalEvidence && !nearbyIntervalFallback ? [{
          id: "triangle", category: "pattern", kind: "ascending_triangle", score: .9,
          selected: true, hardPass: true, evidencePass: true, activePass: true,
          rejectReasons: [], categoryRank: 1, disposition: "selected", selectionReasons: ["ranked_primary"],
          render: { drawingType: "segments", extension: "segment", segments: [[0, 1], [2, 3]] },
          anchors: [
            { timestamp: candles[40].timestamp, price: 176 }, { timestamp: candles[139].timestamp, price: 176 },
            { timestamp: candles[40].timestamp, price: 158 }, { timestamp: candles[139].timestamp, price: 164 }
          ],
          evidenceRefs: ["pivot-pattern-upper", "pivot-pattern-lower"], anchorPivotIds: [],
          touchPivotIds: ["pivot-pattern-upper", "pivot-pattern-lower"], reactionPivotIds: [],
          touchRefs: [], reactionRefs: [], touches: [], metrics: { touchCount: 5, containment: .9 }
        }] : [],
        selections: {
          levelCandidateIds: includeConditionalEvidence && !nearbyIntervalFallback ? ["support"] : [],
          trendCandidateIds: [], patternCandidateIds: includeConditionalEvidence && !nearbyIntervalFallback ? ["triangle"] : []
        },
        omittedCounts: { levelCandidates: 0, trendCandidates: 0, patternCandidates: 0, touchEpisodes: 0 },
        completeness: {
          complete: true,
          detected: { levels: includeConditionalEvidence && !nearbyIntervalFallback ? 2 : 0, trends: includeConditionalEvidence && !nearbyIntervalFallback ? 1 : 0, patterns: includeConditionalEvidence && !nearbyIntervalFallback ? 1 : 0 },
          stored: { levels: includeConditionalEvidence && !nearbyIntervalFallback ? 2 : 0, trends: includeConditionalEvidence && !nearbyIntervalFallback ? 1 : 0, patterns: includeConditionalEvidence && !nearbyIntervalFallback ? 1 : 0 }
        }
      },
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
    indicators: { sma60: 170, sma120: 165, cross: { status: "none", direction: null } },
    commentary: {
      version: "chart-commentary.v2", status: "ready", generatedAt: asOf, model: "fixture-model",
      promptVersion: "chart-commentary.ko.v5",
      sourceIdentity: {
        geometryInputDigest: "sha256:fixture", candlesAsOf: asOf, indicatorsAsOf: asOf,
        contextDigest: "sha256:fixture-context"
      },
      paragraphs: [
        { id: "structure", segments: [
          { id: "structure-open", text: "현재 가격은 " },
          { id: "structure-pattern", text: "상승 삼각형 돌파 확인 구조", link: { kind: "drawing", referenceIds: ["drawing:pattern"] } },
          { id: "structure-close", text: "를 중심으로 읽을 수 있습니다. 패턴 상단은 돌파 기준이고 하단은 구조가 유지되는지 확인하는 반대 경계입니다." }
        ] },
        { id: "confirmation", segments: [
          { id: "confirmation-candle", text: "최근 완료 봉", link: { kind: "candle", referenceId: "candle:latest" } },
          { id: "confirmation-middle", text: "의 반응과 " },
          { id: "confirmation-rsi", text: "상대강도지수", link: { kind: "indicator", layer: "rsi:14", referenceIds: ["candle:previous"] } },
          { id: "confirmation-close", text: "를 함께 보면 경계 시험 과정에서 가격 움직임의 힘이 이어지는지 구분하는 데 도움이 됩니다. 지표는 작도를 대신하지 않고 반응의 질을 확인하는 보조 근거입니다." }
        ] },
        { id: "context", segments: [
          { id: "context-open", text: "외부 정보는 원인으로 단정하지 않고 " },
          { id: "context-news", text: "최근 뉴스 맥락", link: { kind: "news", referenceId: "news:latest" } },
          { id: "context-middle", text: "으로만 참고하며, 차트 구조와 완료 봉을 우선하고 " },
          { id: "context-volume-profile", text: "Volume Profile", link: { kind: "indicator", layer: "volume-profile", referenceIds: ["candle:previous"] } },
          { id: "context-close", text: "로 거래가 집중된 가격대를 함께 확인합니다. 다음 완료 봉이 패턴 경계 안팎에서 어떻게 마감하는지를 같은 기준으로 이어서 확인합니다." }
        ] }
      ],
      indicatorRecommendations: [
        {
          layer: "rsi:14", label: "상대강도지수", reason: "패턴 경계 부근에서 가격 움직임의 강도를 함께 확인합니다.",
          referenceIds: ["candle:previous"]
        },
        {
          layer: "volume-profile", label: "거래량 프로파일", reason: "최근 완료 봉 구간에서 거래가 집중된 가격대를 확인합니다.",
          referenceIds: ["candle:previous"]
        }
      ],
      references: [
        { id: "drawing:pattern", type: "drawing", drawingIds: [upper.id, lower.id] },
        { id: "candle:latest", type: "candle", timestamp: asOf, candleKey: asOf.slice(0, 10) },
        { id: "candle:previous", type: "candle", timestamp: candles[138].timestamp, candleKey: candles[138].timestamp.slice(0, 10) },
        { id: "news:latest", type: "news", eventId: `news:NVDA:${commentaryMarketDate}`, marketDate: commentaryMarketDate }
      ],
      limitations: []
    }
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

function supportLabelLayout(): Record<string, unknown> {
  const chart = content("chart", 1, { symbol: "NVDA", timeframe: "1D" }, "asset-visual-chart");
  const quickOrder = content("quickOrder", 2, { symbol: "NVDA", qty: 3 });
  return {
    version: 1,
    nextInstance: 3,
    contents: { [chart.id]: chart, [quickOrder.id]: quickOrder },
    slots: [slot("chart", 1, 1, 1, 6, 6), slot("quickOrder", 2, 7, 1, 2, 3)]
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
