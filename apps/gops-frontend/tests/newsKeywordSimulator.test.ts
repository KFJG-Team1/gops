import assert from "node:assert/strict";

import {
  newsKeywordEndpoint,
  normalizeNewsKeywordResponse
} from "../src/components/NewsKeywordPanel";


assert.equal(newsKeywordEndpoint("live"), "/api/market/news/daily");
assert.equal(newsKeywordEndpoint("simulation"), "/api/market/news/daily");

const replayDailySummary = normalizeNewsKeywordResponse({
  symbol: "NVDA",
  displayMode: "dailySummary",
  asOf: "2026-07-14T15:00:00.000Z",
  dailySummaries: [{
    date: "2026-07-14",
    symbol: "NVDA",
    summary: "가상시각 이전 뉴스 요약",
    keyPoints: ["실적 기대|positive"],
    keywordTags: [{ label: "실적 기대", direction: "positive" }],
    impactDirection: "positive",
    articleIds: ["article-1"],
    sources: []
  }]
}, "NVDA");

assert.equal(replayDailySummary?.dailySummaries.length, 1);
assert.deepEqual(replayDailySummary?.dailySummaries[0]?.keywordTags, [
  { label: "실적 기대", direction: "positive" }
]);

console.log("news keyword simulator tests passed");
