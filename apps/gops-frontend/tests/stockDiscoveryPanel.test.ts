import assert from "node:assert/strict";
import type { Sp500UniverseItem } from "../src/market/sp500Universe.seed";
import {
  DISCOVERY_PAGE_SIZE,
  buildDiscoveryRows,
  discoveryPage,
  effectiveRecommendationScore,
  emptyMetricRanges,
  filterDiscoveryRows,
  recommendationScoreBreakdown,
  resolveSimulationDemoRecommendationStage,
  simulationDemoRecommendationStorageKey
} from "../src/recommendations/StockDiscoveryPanel";
import type { StockRecommendationItem } from "../src/recommendations/recommendationApi";
import { rebalanceWeights } from "../src/recommendations/ScoreProfileManager";

const market = [
  stock("AAA", 100, 1),
  stock("BBB", 900, -1),
  stock("CCC", 700, 2),
  stock("DDD", 500, -2, "Health Care"),
  stock("AAA", 1, 9)
];
const recommendations = [
  recommendation("CCC", 2, 91),
  recommendation("AAA", 1, 78),
  recommendation("MISSING", 3, 99),
  recommendation("AAA", 9, 60)
];

const rows = buildDiscoveryRows(market, recommendations);
assert.equal(rows.length, 4, "same-symbol market rows are merged once");
assert.deepEqual(rows.map((row) => row.market.symbol), ["AAA", "BBB", "CCC", "DDD"]);
assert.equal(rows[0].recommendation?.score, 78, "the highest-score duplicate recommendation wins");
assert.equal(rows[0].volumeRank, 4);
assert.equal(rows[1].volumeRank, 1);
assert.equal(effectiveRecommendationScore({ ...recommendations[0], customRankScore: 94.5 }), 94.5);
assert.equal(
  resolveSimulationDemoRecommendationStage({ mode: "simulation", runId: "run-new" }, () => null),
  "baseline",
  "a simulator run without a stored interaction starts at the baseline stage"
);
assert.equal(
  resolveSimulationDemoRecommendationStage(
    { mode: "simulation", runId: "run-current" },
    (key) => key === simulationDemoRecommendationStorageKey("run-current") ? "volume_trend" : null
  ),
  "volume_trend",
  "the applied stage is restored only for the same simulator run"
);
assert.equal(
  resolveSimulationDemoRecommendationStage({ mode: "simulation", runId: "run-next" }, () => null),
  "baseline",
  "a different simulator run resets the recommendation demo"
);
assert.equal(
  resolveSimulationDemoRecommendationStage({ mode: "live", runId: null }, () => "volume_trend"),
  null,
  "live recommendations are never hardcoded"
);
assert.deepEqual(recommendationScoreBreakdown({
  ...recommendations[0],
  metricsSnapshot: {
    effectiveBlockScores: { trendStrength: 92.5, participationConfirmation: 81 },
    effectiveStyleWeights: { trendStrength: 30, participationConfirmation: 20 },
    portfolioCompatibility: 76,
    portfolioWeight: 0.25
  }
}), [
  { key: "trendStrength", label: "추세", score: 92.5, weight: 30 },
  { key: "participationConfirmation", label: "거래 참여", score: 81, weight: 20 },
  { key: "portfolioCompatibility", label: "포트폴리오 적합도", score: 76, weight: 25 }
], "score hover breakdown uses effective block scores and normalized applied weights");
const rebalanced = rebalanceWeights({ trend: 40, volume: 30, quality: 30 }, "trend", 70);
assert.deepEqual(rebalanced, { trend: 70, volume: 15, quality: 15 }, "editing one weight keeps the group total at 100%");
assert.equal(Object.values(rebalanced).reduce((sum, value) => sum + value, 0), 100);
const removedWeight = rebalanceWeights({ trend: 50, volume: 30, quality: 20 }, "volume", 0);
assert.equal(removedWeight.volume, 0, "removing a metric keeps it inactive");
assert.equal(Object.values(removedWeight).reduce((sum, value) => sum + value, 0), 100, "remaining metric blocks are rebalanced after removal");
const restoredWeight = rebalanceWeights(removedWeight, "volume", 25);
assert.equal(restoredWeight.volume, 25, "a removed metric can be restored with a direct weight");
assert.equal(Object.values(restoredWeight).reduce((sum, value) => sum + value, 0), 100, "restoring a metric keeps the group total at 100%");

assert.deepEqual(filter({ query: "aaa" }).map(symbol), ["AAA"], "ticker search is case-insensitive");
assert.equal(filter({ mode: "volume", query: "software" }).length, 4, "industry search is supported");
assert.equal(filter({ mode: "volume", query: "정보기술" }).length, 3, "Korean canonical sector search is supported");
assert.deepEqual(filter({ mode: "recommended" }).map(symbol), ["CCC", "AAA"], "recommendation mode is ordered only by applied recommendation score");
assert.deepEqual(filter({ mode: "gainers" }).map(symbol), ["AAA", "CCC"], "gainer mode is a separate change-percent list");
assert.deepEqual(filter({ mode: "volume" }).map(symbol), ["BBB", "CCC", "DDD", "AAA"], "volume mode is ordered by raw dollar volume without another score");
assert.deepEqual(filter({ mode: "popular" }).map(symbol), ["BBB", "CCC", "DDD", "AAA"], "popular mode uses raw dollar-volume order without inventing a popularity score");
assert.deepEqual(filter({ mode: "all" }).map(symbol), ["AAA", "BBB", "CCC", "DDD"], "all-stock mode exposes the complete universe in ticker order");
assert.deepEqual(filter({ mode: "all", directions: new Set(["down"]) }).map(symbol), ["BBB", "DDD"], "all-stock mode applies direction filters");
assert.deepEqual(filter({ mode: "recommended", directions: new Set(["up"]) }).map(symbol), ["CCC", "AAA"], "direction filters apply in recommendation mode too");
assert.deepEqual(filter({ mode: "volume", limit: 2 }).map(symbol), ["BBB", "CCC"], "each list owns its top-N limit");
assert.deepEqual(filter({ mode: "volume", directions: new Set(["down"]) }).map(symbol), ["BBB", "DDD"]);
assert.deepEqual(filter({ mode: "volume", sectors: new Set(["Information Technology"]) }).map(symbol), ["BBB", "CCC", "AAA"]);
assert.equal(
  filter({ mode: "volume", sectors: new Set(["Information Technology", "Health Care"]) }).length,
  4,
  "sector choices are ORed within the group"
);
assert.equal(
  filter({ mode: "volume", metricRanges: { ...emptyMetricRanges(), recommendationScore: { min: "90", max: "" } } }).length,
  1,
  "recommendation score from the full screener applies in volume mode"
);
assert.deepEqual(
  filter({ mode: "popular", metricRanges: { ...emptyMetricRanges(), recommendationScore: { min: "90", max: "" } } }).map(symbol),
  ["CCC"],
  "the full metric screener applies inside the popular top-fifteen universe"
);
assert.deepEqual(
  filter({ metricRanges: { ...emptyMetricRanges(), rsi14: { min: "45", max: "55" } } }).map(symbol),
  ["AAA"],
  "RSI range excludes rows without matching point-in-time data"
);
assert.equal(
  filter({ mode: "volume", metricRanges: { ...emptyMetricRanges(), dollarVolumeMillion: { min: "0", max: "1" } } }).length,
  4,
  "shared metric ranges preserve rows that satisfy the selected bounds"
);
const longRows = Array.from({ length: 120 }, (_, index) => ({ ...rows[index % rows.length] }));
assert.equal(discoveryPage(longRows).length, DISCOVERY_PAGE_SIZE);
assert.equal(discoveryPage(longRows, DISCOVERY_PAGE_SIZE * 2).length, 100, "more expands by another 50 rows");
const tied = buildDiscoveryRows([stock("ZZZ", 1000, 0), stock("AAA", 1000, 0)], []);
assert.deepEqual(filterDiscoveryRows(tied, {
  mode: "volume",
  query: "",
  directions: new Set(),
  sectors: new Set(),
  metricRanges: emptyMetricRanges(),
  limit: 10
}).map(symbol), ["AAA", "ZZZ"], "equal volume is resolved by symbol");

const fullMarket = Array.from({ length: 24 }, (_, index) => stock(`S${String(index).padStart(2, "0")}`, 10_000 - index * 100, index % 2 ? 1 : -1));
const fullRecommendations = fullMarket.map((item, index) => recommendation(item.symbol, index + 1, 100 - index));
const fullRows = buildDiscoveryRows(fullMarket, fullRecommendations);
assert.equal(filterDiscoveryRows(fullRows, {
  mode: "recommended",
  query: "",
  directions: new Set(),
  sectors: new Set(),
  metricRanges: emptyMetricRanges(),
  limit: 5
}).length, 24, "recommendation mode does not truncate the scored universe to a top-N limit");
assert.equal(filterDiscoveryRows(fullRows, {
  mode: "popular",
  query: "",
  directions: new Set(),
  sectors: new Set(),
  metricRanges: emptyMetricRanges(),
  limit: 50
}).length, 15, "popular mode is fixed to the top fifteen by raw dollar volume");
assert.equal(filterDiscoveryRows(fullRows, {
  mode: "all",
  query: "",
  directions: new Set(),
  sectors: new Set(),
  metricRanges: emptyMetricRanges(),
  limit: 5
}).length, 24, "all-stock mode is not truncated before the shared 50-row pagination");

console.log("stock discovery panel tests passed");

function filter(overrides: Partial<Parameters<typeof filterDiscoveryRows>[1]>) {
  return filterDiscoveryRows(rows, {
    mode: "recommended",
    query: "",
    directions: new Set(),
    sectors: new Set(),
    metricRanges: emptyMetricRanges(),
    limit: 50,
    ...overrides
  });
}

function symbol(row: (typeof rows)[number]) {
  return row.market.symbol;
}

function stock(
  symbol: string,
  sessionDollarVolume: number,
  changePercent: number,
  sector = "Information Technology"
): Sp500UniverseItem {
  return {
    symbol,
    companyName: `${symbol} Corp`,
    sector,
    industry: "Software",
    marketCap: 1_000_000,
    sessionDollarVolume,
    lastPrice: 100,
    eps: 5,
    totalEquity: 500,
    totalAssets: 1000,
    totalLiabilities: 400,
    netIncome: 50,
    revenue: 500,
    operatingIncome: 100,
    freeCashFlow: 75,
    changePercent
  };
}

function recommendation(symbol: string, rank: number, score: number): StockRecommendationItem {
  return {
    symbol,
    action: "watch",
    rank,
    score,
    confidence: 0.8,
    reasons: [],
    riskWarnings: [],
    keyEvidence: [],
    cautions: [],
    metricsSnapshot: { rawFactors: { rsi14: 40 + rank * 10 } }
  };
}
