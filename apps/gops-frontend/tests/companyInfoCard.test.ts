import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  companyInfoMissingValue,
  formatCompanyInfoChange,
  formatCompanyInfoMarketCap,
  formatCompanyInfoPrice
} from "../src/components/CompanySummaryPanel";
import { fetchMarketHeatmap } from "../src/market/heatmapApi";

assert.equal(formatCompanyInfoPrice(194.72), "US$194.72");
assert.equal(formatCompanyInfoMarketCap(4_771_640_000_000), "US$4.77조");
assert.equal(formatCompanyInfoChange(2.05), "+2.05%");
assert.equal(formatCompanyInfoChange(-2.05), "-2.05%");
assert.equal(formatCompanyInfoChange(0), "0.00%", "a flat session is real data, not a missing value");
assert.equal(formatCompanyInfoPrice(null), companyInfoMissingValue);
assert.equal(formatCompanyInfoPrice(0), companyInfoMissingValue);
assert.equal(formatCompanyInfoMarketCap(Number.NaN), companyInfoMissingValue);
assert.equal(formatCompanyInfoMarketCap(1), companyInfoMissingValue, "treemap sentinel is not a real market cap");
assert.equal(formatCompanyInfoChange(undefined), companyInfoMissingValue);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      source: "test",
      universe: "sp500",
      items: [
        {
          symbol: "NVDA",
          companyName: "NVIDIA",
          sector: "Information Technology",
          industry: "Semiconductors",
          marketCap: null,
          marketCapSource: "current-projection",
          layoutMarketCap: 4_771_640_000_000,
          layoutMarketCapSource: "cached-projection",
          changePercent: null
        },
        {
          symbol: "MSFT",
          companyName: "Microsoft",
          sector: "Information Technology",
          industry: "Software",
          marketCap: 1,
          marketCapSource: "sentinel",
          layoutMarketCap: 3_800_000_000_000,
          layoutMarketCapSource: "layout-cache",
          changePercent: null
        },
        {
          symbol: "AAPL",
          companyName: "Apple",
          sector: "Information Technology",
          industry: "Technology Hardware",
          marketCap: null,
          layoutMarketCap: null,
          changePercent: null
        }
      ]
    })
  })) as typeof fetch;

  const payload = await fetchMarketHeatmap();
  assert.equal(
    payload.items[0]?.marketCap,
    4_771_640_000_000,
    "layout market cap must remain available when the current projection is null"
  );
  assert.equal(payload.items[0]?.layoutMarketCap, 4_771_640_000_000);
  assert.equal(payload.items[0]?.marketCapSource, "cached-projection");
  assert.equal(
    payload.items[1]?.marketCap,
    3_800_000_000_000,
    "a sentinel current cap must not hide a real layout market cap"
  );
  assert.equal(payload.items[1]?.marketCapSource, "layout-cache");
  assert.equal(payload.items[2]?.marketCap, 1, "the existing minimum treemap weight remains the final fallback");
} finally {
  globalThis.fetch = originalFetch;
}

const [source, styles] = await Promise.all([
  readFile(new URL("../src/components/CompanySummaryPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8")
]);

assert.match(source, /marketMetric: "price"/);
assert.match(source, /marketMetric: "change"/);
assert.match(source, /marketMetric: "market-cap"/);
assert.match(source, /className=\{`company-info-cell\$\{marketMetric \? " company-info-market-metric"/);
assert.match(source, /data-company-info-metric=\{marketMetric\}/);
assert.match(source, /aria-label=\{missing \? "확인 중" : undefined\}/);
assert.match(source, /export const companyInfoMissingValue = "—"/);
for (const label of ["현재가", "등락률", "시가총액", "발행주식수", "거래소", "섹터", "산업", "시장"]) {
  assert.match(source, new RegExp(`label: "${label}"`), `${label} is shown in the company information card`);
}
for (const removedLabel of ["상장일", "CIK", "기업정보 원천", "데이터 기준"]) {
  assert.doesNotMatch(source, new RegExp(`label: "${removedLabel}"`), `${removedLabel} is not shown in the compact company information card`);
}
assert.match(source, /\{ label: "거래소", value: "SIP" \}/);
assert.match(source, /\(marketCap as number\) \/ \(price as number\)/, "shares outstanding can be derived from market cap and price");

assert.match(
  styles,
  /\.company-single-panel \.company-info-sheet \.company-info-cell:nth-child\(n\),[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?gap:\s*7px;/,
  "every company information cell uses the same stacked label and value alignment"
);
assert.match(
  styles,
  /\.company-single-panel \.company-info-sheet \.company-info-grid,[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
  "company information is aligned as a consistent two-column grid"
);

console.log("company info card tests passed");
