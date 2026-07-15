import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const layoutStorageKey = "gops:workspace-grid-layout:v1";
let failNextSave = false;
let profileSaved = false;
let savedProfile: Record<string, unknown> | null = null;
let latestSessionModes: string[] = [];
let recommendationResponseMode: "profile_required" | "empty" | "market_closed" | "error" = "profile_required";

test.beforeEach(async ({ page }) => {
  failNextSave = false;
  profileSaved = false;
  savedProfile = null;
  latestSessionModes = [];
  recommendationResponseMode = "profile_required";
  await page.routeWebSocket("**/ws/**", () => undefined);
  await page.route("**/api/**", async (route) => fulfillApi(route));
});

test("empty recommendation responses show the simulation fallback and keep Agent references", async ({ page }) => {
  recommendationResponseMode = "empty";
  await page.clock.install();
  await openRecommendationsLayout(page);

  const listPanel = page.getByRole("region", { name: "장중 매수 추천 목록" });
  const cardPanel = page.getByRole("region", { name: "장중 매수 추천", exact: true });
  const listRows = listPanel.locator(".stock-rec-list .stock-rec-row");
  const cardRows = cardPanel.locator(".stock-rec-file-stack .stock-rec-row");

  await expect(listRows).toHaveCount(10);
  await expect(cardRows).toHaveCount(10);
  await expect(listRows.nth(0)).toContainText("NVDA");
  await expect(listRows.nth(1)).toContainText("AMD");
  await expect(cardRows.nth(0)).toContainText("NVDA");
  await expect(cardRows.nth(1)).toContainText("AMD");
  await expect(listPanel.getByText("simulation", { exact: true })).toBeVisible();
  await expect(cardPanel.getByText("simulation", { exact: true })).toBeVisible();
  await expect(listPanel.getByText("추천할 종목이 없습니다")).toHaveCount(0);
  await expect(listPanel.getByText(/추천 데이터 준비 중 표시/)).toHaveCount(0);
  await expect(listRows.nth(0)).toContainText("반도체 업종 내 상대강도");
  await expect(listRows.nth(1)).toContainText("단기 하락 구간에서 매수세 유입");

  await expect(cardPanel.locator(".stock-rec-row.is-active")).toContainText("NVDA");
  await page.clock.fastForward(8_000);
  await expect(cardPanel.locator(".stock-rec-row.is-active")).toContainText("AMD");
  await cardPanel.locator(".stock-rec-file-stack").hover();
  await page.clock.fastForward(8_000);
  await expect(cardPanel.locator(".stock-rec-row.is-active")).toContainText("AMD");
  await page.locator(".workspace-top-nav").hover();
  await page.clock.fastForward(8_000);
  await expect(cardPanel.locator(".stock-rec-row.is-active")).toContainText("MSFT");

  await listRows.nth(1).click();
  await expect(page.getByRole("button", { name: "AMD 추천 참조 해제" })).toBeVisible();
  await expect(listRows.nth(1)).toHaveAttribute("aria-pressed", "true");

  await expect(listPanel).toHaveScreenshot("recommendation-list-simulation-fallback.png");
  await expect(cardPanel).toHaveScreenshot("recommendation-card-simulation-fallback.png");
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

async function openRecommendationsLayout(page: Page): Promise<void> {
  await page.addInitScript(({ storageKey, storedLayout }) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, JSON.stringify(storedLayout));
    window.localStorage.setItem("gops:last-chart-symbol", "NVDA");
  }, { storageKey: layoutStorageKey, storedLayout: recommendationsLayout() });
  await page.goto("/?symbol=NVDA");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await expect(page.locator(".canvas-workspace.view-chart")).toBeVisible();
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
    if (recommendationResponseMode === "empty") {
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
