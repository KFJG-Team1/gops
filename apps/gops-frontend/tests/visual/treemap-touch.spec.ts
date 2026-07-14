import { expect, test, type Page } from "@playwright/test";

test.describe("mobile treemap tapping", () => {
  test.beforeEach(async ({ page }) => {
    await page.routeWebSocket("**/ws/charts**", () => undefined);
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let payload: unknown = {};
      if (url.pathname === "/api/auth/me") {
        payload = { authEnabled: false, user: null };
      } else if (url.pathname === "/api/charts/symbols") {
        payload = {
          symbols: [{ symbol: "AAPL", name: "Apple", sector: "Information Technology", isMock: false }]
        };
      } else if (url.pathname === "/api/market/heatmap") {
        payload = {
          source: "mobile-tap-fixture",
          universe: "sp500",
          layoutAsOf: "2026-07-14T00:00:00.000Z",
          quoteAsOf: "2026-07-14T00:00:00.000Z",
          quoteRefreshSeconds: 3600,
          layoutRefreshSeconds: 3600,
          items: [{
            symbol: "AAPL",
            companyName: "Apple",
            sector: "Information Technology",
            industry: "Technology Hardware",
            marketCap: 3_000_000_000_000,
            lastPrice: 230,
            changePercent: 1.25
          }]
        };
      }
      await route.fulfill({
        status: request.method() === "DELETE" ? 204 : 200,
        contentType: "application/json",
        body: request.method() === "DELETE" ? "" : JSON.stringify(payload)
      });
    });
  });

  test("opens the tapped symbol without requiring pointer movement first", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The touch regression only runs in the mobile project.");
    const { canvas, center } = await openSingleSymbolHeatmap(page);

    await canvas.tap({ position: center });

    await expect(page).toHaveURL(/\?symbol=AAPL(?:&|$)/);
  });

  test("keeps desktop hover and click selection working", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The mouse regression only runs in the desktop project.");
    const { canvas, center } = await openSingleSymbolHeatmap(page);

    await canvas.click({ position: center });

    await expect(page).toHaveURL(/\?symbol=AAPL(?:&|$)/);
  });
});

async function openSingleSymbolHeatmap(page: Page) {
  const heatmapResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/market/heatmap"
  ));
  await page.goto("/?view=home");
  await heatmapResponse;

  const canvas = page.locator(".canvas-workspace.view-treemap .treemap-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => (
    element instanceof HTMLCanvasElement && element.width > 1 && element.height > 1
  ))).toBe(true);

  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Tree map canvas bounds are unavailable.");
  const center = { x: bounds.width / 2, y: bounds.height / 2 };

  await page.mouse.move(bounds.x + center.x, bounds.y + center.y);
  await expect(page.locator(".treemap-hover-featured-symbol")).toHaveText("AAPL");
  await page.mouse.move(0, 0);
  await expect(page.locator(".treemap-hover-featured-symbol")).toHaveCount(0);

  return { canvas, center };
}
