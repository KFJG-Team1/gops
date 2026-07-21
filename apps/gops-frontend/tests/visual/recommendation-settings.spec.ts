import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
let failNextSave = false;
let profileSaved = false;
let savedProfile: Record<string, unknown> | null = null;
let latestSessionModes: string[] = [];
let recommendationResponseMode: "profile_required" | "empty" | "market_closed" | "error" | "session_specific" | "v3_direct" = "profile_required";

test.beforeEach(async ({ page }) => {
  failNextSave = false;
  profileSaved = false;
  savedProfile = null;
  latestSessionModes = [];
  recommendationResponseMode = "profile_required";
  await page.routeWebSocket("**/ws/**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
});

test("recommendation formula editor keeps every draft editable in the requested visual order", async ({ page }, testInfo) => {
  await openRecommendationsLayout(page, recommendationSyncLayout());

  const panel = page.locator(".stock-discovery-panel").first();
  await panel.getByRole("button", { name: "추천 수식 설정" }).click();

  await expect(panel.getByText("추천 점수 설계", { exact: true })).toHaveCount(0);
  const stablePreset = panel.getByRole("button", { name: "안정 기본 수식 사용" });
  await expect(stablePreset).toHaveAttribute("aria-pressed", "true");
  await expect(stablePreset).toHaveClass(/is-selected/);

  const currentName = panel.getByRole("textbox", { name: "현재 선택한 로직 이름" });
  await expect(currentName).toHaveValue("안정 조정");
  await expect(panel.getByRole("slider").first()).toBeEnabled();

  await panel.getByRole("button", { name: "균형 기본 수식 사용" }).click();
  await expect(currentName).toHaveValue("균형 조정");
  await currentName.fill("수정 중인 균형 로직");
  const reset = panel.getByRole("button", { name: "변경사항 되돌리기" });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(currentName).toHaveValue("균형 조정");

  await panel.getByRole("button", { name: "실적 뉴스와 성장성이 좋은 종목" }).click();
  await panel.getByRole("button", { name: "AI 제안" }).click();
  await expect(currentName).toHaveValue("성장 촉매 로직");
  await expect(panel.getByText("편집 중", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "초안에 적용" })).toHaveCount(0);

  const savedLogic = panel.locator(".score-profile-list-select").filter({ hasText: "내 균형" });
  await expect(savedLogic).toBeVisible();
  await savedLogic.click();
  await expect(currentName).toHaveValue("내 균형");
  await expect(panel.locator(".score-profile-list-item.is-selected")).toContainText("내 균형");
  const sectionOrder = await panel.locator(".score-profile-current-editor, .score-profile-saved-library, .score-profile-editor").evaluateAll((elements) => (
    elements.map((element) => element.className)
  ));
  expect(sectionOrder).toEqual(["score-profile-current-editor", "score-profile-saved-library", "score-profile-editor"]);
  await panel.screenshot({ path: testInfo.outputPath("recommendation-formula-editor.png") });
});

test("empty recommendation responses stay empty in live mode", async ({ page }) => {
  recommendationResponseMode = "empty";
  await openRecommendationsLayout(page);

  const listPanel = page.getByRole("region", { name: "장중 매수 추천 목록" });
  const cardPanel = page.getByRole("region", { name: "장중 매수 추천", exact: true });
  const listRows = listPanel.locator(".stock-rec-list .stock-rec-row");
  const cardRows = cardPanel.locator(".stock-rec-file-stack .stock-rec-row");

  await expect(listRows).toHaveCount(0);
  await expect(cardRows).toHaveCount(0);
  await expect(listPanel.getByText("추천할 종목이 없습니다", { exact: true })).toBeVisible();
  await expect(cardPanel.getByText("추천할 종목이 없습니다", { exact: true })).toBeVisible();
  await expect(listPanel.getByText("simulation", { exact: true })).toHaveCount(0);
  await expect(cardPanel.getByText("simulation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /추천 참조 해제/ })).toHaveCount(0);
});

test("market closed and API error states do not use the simulation fallback", async ({ page }) => {
  recommendationResponseMode = "market_closed";
  await openRecommendationsLayout(page);

  const listPanel = page.getByRole("region", { name: "장중 매수 추천 목록" });
  await expect(listPanel.getByText(/추천.*(시간|생성)/)).toBeVisible();
  await expect(listPanel.locator(".stock-rec-row")).toHaveCount(0);
  await expect(listPanel.getByText("simulation", { exact: true })).toHaveCount(0);

  recommendationResponseMode = "error";
  await page.reload();
  await expect(listPanel.getByText("recommendation unavailable")).toBeVisible();
  await expect(listPanel.locator(".stock-rec-row")).toHaveCount(0);
  await expect(listPanel.getByText("simulation", { exact: true })).toHaveCount(0);
});

test("recommendation explanation uses the exact selected list snapshot across sessions", async ({ page }) => {
  recommendationResponseMode = "session_specific";
  await openRecommendationsLayout(page, recommendationSyncLayout());

  const listPanel = page.getByRole("region", { name: "장중 매수 추천 목록" });
  await listPanel.getByRole("button", { name: "장전" }).click({ force: true });
  const amdRow = listPanel.getByRole("button", { name: "1위 AMD 추천 선택" });
  await expect(amdRow).toBeVisible();
  await amdRow.click();

  const explanation = page.getByRole("region", { name: "AMD 추천 해설" });
  await expect(explanation).toBeVisible();
  await expect(explanation.getByRole("heading", { name: "AMD" })).toBeVisible();
  await expect(explanation.getByText("장전 / 데이장", { exact: true })).toBeVisible();
  await expect(explanation.getByLabel("추천 점수 91점")).toBeVisible();
});

test("V3 explanation prioritizes the natural-language conclusion and shows every caution", async ({ page }, testInfo) => {
  recommendationResponseMode = "v3_direct";
  const narrow = testInfo.project.name === "mobile";
  await openRecommendationsLayout(page, recommendationExplainLayout(narrow ? 3 : 8));

  const explanation = page.getByRole("region", { name: "JPM 추천 해설" });
  if (narrow) {
    await page.addStyleTag({
      content: "section[aria-label='JPM 추천 해설']{width:480px!important}"
    });
  }
  const label = explanation.getByText("매수 추천", { exact: true });
  const headline = explanation.getByRole("heading", {
    name: "시장보다 강한 흐름과 활발한 거래가 이어져, 계획된 가격대에서 매수를 검토할 수 있습니다."
  });
  const score = explanation.getByLabel("종합 점수 83점");

  await expect(explanation).toBeVisible();
  await expect(label).toBeVisible();
  await expect(headline).toBeVisible();
  await expect(explanation.locator("[class*='verdictCopy'] p")).toHaveCount(0);
  await expect(score).toBeVisible();
  await expect(explanation.getByText("V3 종합 점수", { exact: true })).toHaveCount(0);
  await expect(explanation.getByText("판단 근거와 비교 기준", { exact: true })).toBeVisible();
  await expect(explanation.getByText("유의할 점", { exact: true })).toBeVisible();
  await expect(explanation.locator("[class*='sentenceEvidenceRow']")).toHaveCount(5);
  await expect(explanation.locator("[class*='evidenceMetric'][aria-label]")).toHaveCount(7);
  await expect(explanation.getByLabel("당일 상대강도 +2.10%p, SPY 대비 · 중립 0%p")).toBeVisible();
  const qualityMetric = explanation.getByLabel("60일 일간 변동성 1.84%, 균형형 기준 5.5%");
  await expect(qualityMetric).toBeVisible();
  const marketHelp = explanation.getByRole("button", { name: "시장 흐름 근거 설명" });
  const marketExplanation = explanation.getByText("시장 전체 상승에 편승한 움직임인지 구분하기 위해 SPY를 기준으로 비교했습니다. 장중과 마감 구간이 같은 방향이라 일시적인 초반 급등보다 지속된 종목 수요로 해석했습니다.", { exact: true });
  const marketBaseline = explanation.getByText("SPY 대비 · 중립 0%p", { exact: true }).first();
  await expect(marketHelp).toBeVisible();
  await expect(marketExplanation).toBeHidden();
  await expect(marketBaseline).toBeHidden();
  await expect(explanation.locator("[class*='evidenceMetric'] small")).toHaveCount(0);
  await marketHelp.focus();
  await expect(marketExplanation).toBeVisible();
  await expect(marketBaseline).toBeVisible();
  await expect(explanation.locator("[class*='cautionRow']")).toHaveCount(1);
  await expect(explanation.getByText("추격 진입 기준", { exact: true })).toBeVisible();
  await expect(explanation.getByText("돌파 매수는 $345.89까지만 검토합니다. 상한에서 무효화 기준 $339.23까지의 하락 폭은 주당 $6.66입니다.", { exact: true })).toBeVisible();
  await expect(explanation.getByText("판단 유효 범위", { exact: true })).toHaveCount(0);
  await expect(explanation.getByText("신뢰도 해석", { exact: true })).toHaveCount(0);

  if (!narrow) {
    const headlineLines = await headline.evaluate((element) => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      return Math.round(element.getBoundingClientRect().height / lineHeight);
    });
    expect(headlineLines).toBeLessThanOrEqual(2);
    expect(await headline.textContent()).toContain("계획된\u00a0가격대에서");
    const dimensions = await explanation.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
  }

  const labelBox = await label.boundingBox();
  const headlineBox = await headline.boundingBox();
  const scoreBox = await score.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(headlineBox).not.toBeNull();
  expect(scoreBox).not.toBeNull();
  if (labelBox && headlineBox) {
    expect(labelBox.y).toBeLessThan(headlineBox.y);
  }
  if (narrow && headlineBox && scoreBox) {
    expect(headlineBox.y + headlineBox.height).toBeLessThan(scoreBox.y);
  }
  await explanation.screenshot({ path: testInfo.outputPath("recommendation-explanation.png") });
});

test("recommendation settings remain available and save from the panel dialog", async ({ page }) => {
  failNextSave = true;
  await openRecommendationsLayout(page);

  const listPanel = page.getByRole("region", { name: "장중 매수 추천 목록" });
  const cardPanel = page.getByRole("region", { name: "장중 매수 추천", exact: true });
  const listSettings = listPanel.getByRole("button", { name: "추천 설정" });
  const cardSettings = cardPanel.getByRole("button", { name: "추천 설정" });

  await expect(listPanel.getByText("장중 추천 설정을 저장해 주세요")).toBeVisible();
  await expect(cardPanel.getByText("장중 추천 설정을 저장해 주세요")).toBeVisible();
  await expect(listPanel.getByText("simulation", { exact: true })).toHaveCount(0);
  await expect(cardPanel.getByText("simulation", { exact: true })).toHaveCount(0);
  await expect(listSettings).toHaveCSS("opacity", "0");
  await expect(cardSettings).toHaveCSS("opacity", "0");
  await listSettings.focus();
  await expect(listSettings).toHaveCSS("opacity", "1");

  await listPanel.hover();
  await expect(listSettings).toHaveCSS("opacity", "1");
  await expect(listPanel.getByRole("group", { name: "추천 세션" })).toHaveCSS("opacity", "1");
  await expectSettingLeftOfSession(listPanel);
  await expect(listPanel).toHaveScreenshot("recommendation-list-settings-hover.png");

  await cardPanel.hover();
  await expect(cardSettings).toHaveCSS("opacity", "1");
  await expectSettingLeftOfSession(cardPanel);
  await expect(cardPanel).toHaveScreenshot("recommendation-card-settings-hover.png");

  await listPanel.hover();
  await listSettings.click();
  const dialog = page.getByRole("dialog", { name: "추천 설정" });
  const closeButton = dialog.getByRole("button", { name: "추천 설정 닫기" });
  await expect(dialog).toBeVisible();
  await expect(closeButton).toBeFocused();
  await expect(dialog.getByRole("combobox")).toHaveValue("balanced");
  await closeButton.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "저장" })).toBeFocused();
  await closeButton.focus();
  await expect(dialog).toHaveScreenshot("recommendation-settings-dialog.png");

  await closeButton.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(listSettings).toBeFocused();

  await listSettings.click();
  await expect(dialog).toBeVisible();
  await page.locator(".recommendation-settings-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(listSettings).toBeFocused();

  await listSettings.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").selectOption("aggressive");
  await dialog.getByRole("button", { name: "저장" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("save failed")).toBeVisible();

  const requestsBeforeSuccessfulSave = latestSessionModes.length;
  await dialog.getByRole("button", { name: "저장" }).click();
  await expect(dialog).toBeHidden();
  await expect(listSettings).toBeFocused();
  await expect.poll(() => latestSessionModes.length).toBeGreaterThan(requestsBeforeSuccessfulSave);
  await expect(listPanel.getByText("simulation", { exact: true })).toHaveCount(0);
  expect(savedProfile).toMatchObject({
    riskLevel: "aggressive",
    horizon: "intraday",
    maxDrawdownPct: 6,
    preferredSectors: [],
    excludedSectors: [],
    excludedSymbols: []
  });
  const activeSessionLabel = (await listPanel.getByRole("button", { pressed: true }).textContent())?.trim();
  expect(latestSessionModes.at(-1)).toBe(activeSessionLabel === "장전" ? "pre" : "regular");
});

async function expectSettingLeftOfSession(panel: Locator): Promise<void> {
  const settingsBox = await panel.getByRole("button", { name: "추천 설정" }).boundingBox();
  const sessionBox = await panel.getByRole("group", { name: "추천 세션" }).boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(sessionBox).not.toBeNull();
  if (settingsBox && sessionBox) {
    expect(settingsBox.x + settingsBox.width).toBeLessThan(sessionBox.x);
  }
}

async function openRecommendationsLayout(page: Page, storedLayout = recommendationsLayout()): Promise<void> {
  await page.addInitScript(({ storageKey, storedLayout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, JSON.stringify(storedLayout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { storageKey: layoutStorageKey, storedLayout });
  await page.goto("/?symbol=NVDA");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await expect(page.locator(".canvas-workspace.view-chart")).toBeVisible();
}

function recommendationSyncLayout(): Record<string, unknown> {
  return {
    version: 1,
    nextInstance: 3,
    contents: {
      "content-recommendations-list-1": {
        id: "content-recommendations-list-1",
        kind: "recommendationsList",
        title: "추천 목록",
        instanceIndex: 1,
        layoutWeight: 50,
        props: { initialSessionMode: "regular" }
      },
      "content-recommendation-explain-2": {
        id: "content-recommendation-explain-2",
        kind: "recommendationExplain",
        title: "추천 해설",
        instanceIndex: 2,
        layoutWeight: 50,
        props: {}
      }
    },
    slots: [
      {
        id: "slot-recommendations-list-1",
        contentId: "content-recommendations-list-1",
        gridRect: { col: 1, row: 1, colSpan: 3, rowSpan: 6 }
      },
      {
        id: "slot-recommendation-explain-2",
        contentId: "content-recommendation-explain-2",
        gridRect: { col: 4, row: 1, colSpan: 5, rowSpan: 6 }
      }
    ]
  };
}

function recommendationsLayout(): Record<string, unknown> {
  return {
    version: 1,
    nextInstance: 3,
    contents: {
      "content-recommendations-list-1": {
        id: "content-recommendations-list-1",
        kind: "recommendationsList",
        title: "추천목록",
        instanceIndex: 1,
        layoutWeight: 70,
        props: {}
      },
      "content-recommendations-2": {
        id: "content-recommendations-2",
        kind: "recommendations",
        title: "추천 카드",
        instanceIndex: 2,
        layoutWeight: 50,
        props: {}
      }
    },
    slots: [
      {
        id: "slot-recommendations-list-1",
        contentId: "content-recommendations-list-1",
        gridRect: { col: 1, row: 1, colSpan: 5, rowSpan: 6 }
      },
      {
        id: "slot-recommendations-2",
        contentId: "content-recommendations-2",
        gridRect: { col: 6, row: 1, colSpan: 3, rowSpan: 3 }
      }
    ]
  };
}

function recommendationExplainLayout(colSpan: number): Record<string, unknown> {
  return {
    version: 1,
    nextInstance: 2,
    contents: {
      "content-recommendation-explain-1": {
        id: "content-recommendation-explain-1",
        kind: "recommendationExplain",
        title: "추천 해설",
        instanceIndex: 1,
        layoutWeight: 100,
        props: {}
      }
    },
    slots: [{
      id: "slot-recommendation-explain-1",
      contentId: "content-recommendation-explain-1",
      gridRect: { col: 1, row: 1, colSpan, rowSpan: 6 }
    }]
  };
}

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  let status = 200;
  let payload: unknown = {};

  if (url.pathname === "/api/auth/me") {
    payload = { authEnabled: false, user: null };
  } else if (url.pathname === "/api/charts/symbols") {
    payload = { symbols: [{ symbol: "NVDA", tradable: true }, { symbol: "AAPL", tradable: true }] };
  } else if (url.pathname === "/api/recommendations/stocks/latest") {
    latestSessionModes.push(url.searchParams.get("sessionMode") ?? "regular");
    if (recommendationResponseMode === "session_specific") {
      payload = sessionRecommendationPayload(url.searchParams.get("sessionMode") ?? "regular");
    } else if (recommendationResponseMode === "v3_direct") {
      payload = v3RecommendationPayload();
    } else if (recommendationResponseMode === "empty") {
      payload = { status: "ready", items: [], profile: investmentProfile() };
    } else if (recommendationResponseMode === "market_closed") {
      payload = { status: "market_closed", items: [], profile: investmentProfile() };
    } else if (recommendationResponseMode === "error") {
      status = 503;
      payload = { detail: "recommendation unavailable" };
    } else {
      payload = profileSaved
        ? readyRecommendationPayload()
        : { status: "profile_required", items: [], profile: null };
    }
  } else if (url.pathname === "/api/recommendations/profile" && request.method() === "GET") {
    payload = { status: "ready", profile: investmentProfile() };
  } else if (url.pathname === "/api/recommendations/profile" && request.method() === "PUT") {
    savedProfile = request.postDataJSON();
    if (failNextSave) {
      failNextSave = false;
      status = 500;
      payload = { detail: "save failed" };
    } else {
      profileSaved = true;
      payload = { status: "ready", profile: savedProfile };
    }
  } else if (url.pathname === "/api/recommendations/score-profiles" && request.method() === "GET") {
    payload = scoreProfileCatalog();
  } else if (url.pathname === "/api/recommendations/score-profiles/suggestions" && request.method() === "POST") {
    payload = { status: "ready", suggestion: scoreProfileSuggestion() };
  } else if (url.pathname === "/api/notification-preferences") {
    payload = { settings: { master: true }, companyOverrides: {}, thresholds: {} };
  } else if (url.pathname === "/api/notifications") {
    payload = { notifications: [], unreadCount: 0 };
  } else if (url.pathname === "/api/watchlist") {
    payload = { symbols: [] };
  } else if (url.pathname === "/api/market/heatmap") {
    payload = { items: [] };
  } else if (url.pathname === "/api/market/indices") {
    payload = { items: [] };
  } else if (url.pathname === "/api/simulator/status") {
    payload = { mode: "live", status: "idle" };
  }

  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

function scoreProfileCatalog(): Record<string, unknown> {
  const momentum = scoreProfileFixture("preset", "모멘텀", null, "momentum", 1);
  const balanced = scoreProfileFixture("preset", "균형", null, "balanced", 1);
  const stable = scoreProfileFixture("preset", "안정", null, "stable", 1);
  return {
    schemaVersion: "recommendation-score-profile.v1",
    maxCustomProfiles: 20,
    presets: [momentum, balanced, stable],
    customProfiles: [scoreProfileFixture("custom", "내 균형", 7, null, 2)],
    active: stable
  };
}

function scoreProfileFixture(type: "preset" | "custom", name: string, id: number | null, presetStyle: string | null, revision: number): Record<string, unknown> {
  return {
    type,
    id,
    name,
    ...(presetStyle ? { presetStyle } : {}),
    revision,
    schemaVersion: "recommendation-score-profile.v1",
    blockWeights: {
      trendStrength: 20,
      participationConfirmation: 20,
      priceStructure: 20,
      catalystQuality: 15,
      executionQuality: 15,
      qualityStability: 10
    },
    factorWeights: {
      trendStrength: { currentSessionRelativeStrength: 100 },
      participationConfirmation: { clockAdjustedVolumeRatio: 100 },
      priceStructure: { vwapHoldQuality: 100 },
      catalystQuality: { catalystQuality: 100 },
      executionQuality: { quotedSpreadBps: 100 },
      qualityStability: { realizedVolatility: 100 }
    },
    portfolioWeight: 20,
    portfolioFactorWeights: {
      sectorDiversification: 25,
      correlationBenefit: 25,
      marginalVariance: 25,
      liquidityCashCompatibility: 25
    }
  };
}

function scoreProfileSuggestion(): Record<string, unknown> {
  return {
    schemaVersion: "recommendation-score-suggestion.v1",
    query: "실적 뉴스와 성장성이 좋은 종목",
    name: "성장 촉매 로직",
    rationale: "실적과 성장 촉매를 중심으로 구성했습니다.",
    confidence: 0.86,
    intent: {
      matchedKeywords: ["실적", "성장"],
      documents: [{ id: "growth-catalyst", title: "성장 촉매 확인", reason: "성장과 실적을 반영합니다.", matchedKeywords: ["실적", "성장"] }]
    },
    profile: scoreProfileFixture("custom", "성장 촉매 로직", null, null, 0),
    evidence: { summary: ["고정 evidence snapshot을 사용했습니다."], news: [] },
    provenance: {
      source: "deterministic",
      promptVersion: "recommendation-score-profile-rag.ko.v1",
      generatedAt: "2026-07-21T00:00:00Z",
      retrievalDigest: "visual-score-profile-suggestion",
      evidenceRefs: ["evidence:visual"]
    }
  };
}

function investmentProfile(): Record<string, unknown> {
  return {
    riskLevel: "balanced",
    horizon: "intraday",
    maxDrawdownPct: 6,
    preferredSectors: [],
    excludedSectors: [],
    excludedSymbols: []
  };
}

function readyRecommendationPayload(): Record<string, unknown> {
  return {
    status: "ready",
    items: [{
      symbol: "AAPL",
      action: "buy",
      rank: 1,
      score: 82,
      confidence: 0.82,
      reasons: [{ type: "momentum", text: "장중 모멘텀 확인" }],
      riskWarnings: [],
      metricsSnapshot: {}
    }],
    profile: savedProfile
  };
}

function sessionRecommendationPayload(sessionMode: string): Record<string, unknown> {
  const pre = sessionMode === "pre";
  return {
    status: "ready",
    generatedAt: pre ? "2026-07-16T08:55:00-04:00" : "2026-07-16T10:15:00-04:00",
    summary: { sessionMode },
    items: [{
      symbol: pre ? "AMD" : "NVDA",
      action: "buy",
      rank: 1,
      score: pre ? 91 : 77,
      confidence: pre ? 0.9 : 0.7,
      reasons: [{ type: "momentum", text: pre ? "장전 상대강도 확인" : "본장 상대강도 확인" }],
      riskWarnings: [],
      metricsSnapshot: {}
    }],
    profile: investmentProfile()
  };
}

function v3RecommendationPayload(): Record<string, unknown> {
  return {
    status: "ready",
    items: [{
      symbol: "JPM",
      action: "buy",
      rank: 1,
      score: 83,
      confidence: 0.78,
      algorithmVersion: "deterministic-evidence-v3",
      reasons: [],
      riskWarnings: ["이 원문은 화면에 직접 노출하지 않습니다."],
      metricsSnapshot: { algorithmVersion: "deterministic-evidence-v3" },
      explanation: {
        version: "recommendation-explanation.v1",
        locale: "ko-KR",
        decisionLabel: "매수 추천",
        primary: {
          source: "deterministic",
          status: "ready",
          headline: "시장보다 강한 흐름과 활발한 거래가 이어져, 계획된\u00a0가격대에서 매수를 검토할 수 있습니다.",
          body: "",
          promptVersion: "recommendation-decision-renderer.ko.v7"
        },
        deterministic: {
          summary: "",
          evidence: [],
          risks: [],
          dataQuality: {
            sentence: "",
            evidenceReliability: 78,
            confidenceMeaning: "evidence_reliability_not_success_probability",
            missingFactors: [],
            stale: false
          }
        },
        provenance: {
          algorithmVersion: "deterministic-evidence-v3",
          ruleSetVersion: "deterministic-evidence-v3.1",
          evidenceSnapshotId: "visual-test",
          inputDigest: "visual-test"
        }
      },
      decision: {
        version: "recommendation-decision.v1",
        action: "buy",
        label: "매수 추천",
        riskLevel: "balanced",
        holdingHorizon: "intraday",
        entryRoutes: [
          { type: "pullback", entryLow: 341.39, entryHigh: 343.81 },
          { type: "breakout", trigger: 344.74, chaseLimit: 345.89 }
        ],
        invalidationPrice: 339.23,
        targetPriceByRoute: { pullback: 350.68, breakout: 355.88 },
        forceExitAt: "2026-07-15T15:50:00-04:00",
        failedConditions: []
      },
      sizing: {
        status: "ready",
        riskBudgetPct: 0.5,
        recommendedShares: 14,
        estimatedNotional: 4842,
        capReasons: []
      },
      keyEvidence: [
        {
          code: "market_strength", label: "시장 흐름", primaryValue: "SPY 대비 +2.10%p", secondaryValue: "마감 전 60분 +0.62%p", assessment: "strong",
          interpretation: "시장 전체 상승에 편승한 움직임인지 구분하기 위해 SPY를 기준으로 비교했습니다. 장중과 마감 구간이 같은 방향이라 일시적인 초반 급등보다 지속된 종목 수요로 해석했습니다.",
          metrics: [
            { label: "당일 상대강도", value: "+2.10%p", comparison: "SPY 대비 · 중립 0%p", valuePositionPct: 85, referencePositionPct: 50, tone: "positive" },
            { label: "마감 전 60분", value: "+0.62%p", comparison: "SPY 대비 · 중립 0%p", valuePositionPct: 60.33, referencePositionPct: 50, tone: "positive" }
          ]
        },
        {
          code: "participation", label: "거래 참여", primaryValue: "직전 정규장 동시간 대비 1.80배", secondaryValue: "확대 기준 1.00배", assessment: "strong",
          interpretation: "장중 거래량은 개장과 마감에 몰리는 특성이 있어 직전 정규장의 같은 시각과 비교했습니다. 평소보다 넓은 시장 참여가 가격 움직임에 동반됐는지 확인하는 근거로 사용했습니다.",
          metrics: [{ label: "동시간 거래량", value: "1.80배", comparison: "직전 정규장 동시간 · 기준 1.00배", valuePositionPct: 86.96, referencePositionPct: 48.31, tone: "positive" }]
        },
        {
          code: "execution_structure", label: "가격 구조", primaryValue: "종가 $344.21 · VWAP $341.02", secondaryValue: "스프레드 8.20bp · ATR $4.10", assessment: "strong",
          interpretation: "VWAP는 당일 거래량을 반영한 평균 체결가입니다. 종가가 그 위에 있으면 장중 평균 매수자의 손익이 상대적으로 안정적이어서 눌림 진입과 무효화 기준을 세우기 쉽습니다.",
          metrics: [{ label: "종가-VWAP 이격", value: "+0.94%", comparison: "종가 $344.21 · VWAP $341.02", valuePositionPct: 65.67, referencePositionPct: 50, tone: "positive" }]
        },
        {
          code: "execution_quality", label: "체결 여건", primaryValue: "82.0/100", secondaryValue: "", assessment: "strong",
          interpretation: "가격 신호가 좋아도 호가가 넓거나 거래대금이 부족하면 실제 체결 비용이 예상 위험을 키울 수 있습니다. 그래서 호가 상한과 최근 중앙 거래대금을 함께 통과한 경우에만 실행 가능한 근거로 사용했습니다.",
          metrics: [
            { label: "호가 스프레드", value: "8.20bp", comparison: "균형형 허용 상한 10.0bp", valuePositionPct: 65.6, referencePositionPct: 80, tone: "positive" },
            { label: "20일 중앙 거래대금", value: "$1.24B", comparison: "최소 기준 $500.0M", valuePositionPct: 90.91, referencePositionPct: 36.66, tone: "positive" }
          ]
        },
        {
          code: "quality_stability", label: "안정성·품질", primaryValue: "76.0/100", secondaryValue: "", assessment: "strong",
          interpretation: "최근 변동성과 기업 품질은 짧은 가격 신호가 계좌의 위험성향과 맞는지 확인하는 보완 근거입니다.",
          metrics: [{ label: "60일 일간 변동성", value: "1.84%", comparison: "균형형 기준 5.5%", valuePositionPct: 26.76, referencePositionPct: 80, tone: "positive" }]
        }
      ],
      counterEvidence: null,
      cautions: [
        { code: "chase_limit", label: "추격 진입 기준", severity: "warning", sentence: "돌파 매수는 $345.89까지만 검토합니다. 상한에서 무효화 기준 $339.23까지의 하락 폭은 주당 $6.66입니다." }
      ]
    }],
    profile: investmentProfile()
  };
}
