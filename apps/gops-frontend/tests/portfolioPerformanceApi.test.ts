import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPortfolioPrincipalBands,
  normalizePortfolioPerformanceResponse
} from "../src/components/portfolioPerformanceApi";

const normalized = normalizePortfolioPerformanceResponse({
  status: "ready",
  range: "1M",
  portfolio: {
    points: [
      { time: "2026-07-13T00:00:00Z", returnPercent: 0, portfolioValue: 100_000, netInvestedPrincipal: 105_000 },
      { time: "2026-07-14T00:00:00Z", returnPercent: 1, portfolioValue: 106_000, netInvestedPrincipal: 105_000 }
    ]
  },
  benchmark: { points: [] }
});
assert.equal(normalized.portfolio.points[0].netInvestedPrincipal, 105_000);
assert.equal(normalized.portfolio.points[1].netInvestedPrincipal, 105_000);

const crossingBands = buildPortfolioPrincipalBands(
  [
    { time: "2026-07-13T00:00:00Z", value: 100_000 },
    { time: "2026-07-14T00:00:00Z", value: 110_000 }
  ],
  [
    { time: "2026-07-13T00:00:00Z", value: 105_000 },
    { time: "2026-07-14T00:00:00Z", value: 105_000 }
  ]
);
assert.deepEqual(crossingBands.map((band) => band.tone), ["principal-above", "portfolio-above"]);
assert.equal(crossingBands[0].end.portfolioValue, 105_000);
assert.equal(crossingBands[0].end.principalValue, 105_000);
assert.equal(crossingBands[0].end.time, "2026-07-13T12:00:00.000Z");

const gainBands = buildPortfolioPrincipalBands(
  [
    { time: "2026-07-13T00:00:00Z", value: 108_000 },
    { time: "2026-07-14T00:00:00Z", value: 110_000 }
  ],
  [{ time: "2026-07-13T00:00:00Z", value: 105_000 }]
);
assert.deepEqual(gainBands.map((band) => band.tone), ["portfolio-above"]);

const componentSource = await readFile(new URL("../src/components/PortfolioHoldingsPanel.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/PortfolioPerformanceChart.css", import.meta.url), "utf8");
assert.match(componentSource, /buildPortfolioPrincipalBands\(displayedPortfolioPoints, displayedPrincipalPoints\)/);
assert.match(componentSource, /portfolio-performance-principal-band is-\$\{band\.tone\}/);
assert.match(styles, /\.portfolio-performance-principal-band\.is-principal-above[\s\S]*?var\(--color-signal\) 22%/);
assert.match(styles, /\.portfolio-performance-principal-band\.is-portfolio-above[\s\S]*?var\(--color-down\) 18%/);

console.log("portfolio performance API tests passed");
