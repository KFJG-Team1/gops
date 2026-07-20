import assert from "node:assert/strict";
import {
  NEWS_KEYWORD_REFRESH_MS,
  normalizeNewsKeywordResponse
} from "../src/components/NewsKeywordPanel";

assert.equal(NEWS_KEYWORD_REFRESH_MS, 5 * 60_000);

const normalized = normalizeNewsKeywordResponse({
  symbol: "NVDA",
  dailySummaries: [{
    date: "2026-07-17",
    summary: "엔비디아 뉴스 요약",
    keyPoints: ["AI 수요|positive", "수출 규제|negative"],
    keywordTags: [
      { label: "AI 수요", direction: "positive" },
      { label: "수출 규제", direction: "negative" }
    ],
    impactDirection: "mixed",
    articleIds: ["nvda-1"],
    sources: []
  }]
});

assert.equal(normalized?.symbol, "NVDA");
assert.equal(normalized?.dailySummaries[0]?.keywordTags.length, 2);
