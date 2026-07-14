import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serverPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const serverUrl = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "line",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.001
    }
  },
  use: {
    baseURL: serverUrl,
    browserName: "chromium",
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
    launchOptions: existsSync(localChrome) ? { executablePath: localChrome } : undefined
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } }
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${serverPort}`,
    url: serverUrl,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
