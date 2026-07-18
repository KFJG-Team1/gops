import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [styles, source] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/companyCompare/CompanyComparePanelV2.tsx", import.meta.url), "utf8")
]);

assert.match(
  styles,
  /\.compare-cockpit-matrix-v2\s*\{[\s\S]*?flex:\s*1;[\s\S]*?grid-template-rows:\s*auto repeat\(var\(--row-count\), minmax\(min-content, 1fr\)\);/,
  "business and risk matrices distribute surplus panel height across their rows"
);
assert.match(
  styles,
  /\.compare-cockpit-pair-grid\s*\{[\s\S]*?flex:\s*1;[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);[\s\S]*?grid-auto-rows:\s*minmax\(min-content, 1fr\);[\s\S]*?overflow:\s*auto;/,
  "relationship cards fill available height and scroll only when their content is taller"
);
assert.match(
  styles,
  /\.compare-cockpit-pair-grid\[data-card-count="1"\] > \.compare-cockpit-pair-card\s*\{[\s\S]*?grid-column:\s*span 6;/,
  "a single relationship card fills the panel width"
);
assert.match(
  styles,
  /\.compare-cockpit-pair-grid\[data-card-count="2"\] > \.compare-cockpit-pair-card,[\s\S]*?\[data-card-count="4"\][\s\S]*?grid-column:\s*span 3;/,
  "two and four relationship cards use balanced two-column rows"
);
assert.match(
  styles,
  /\[data-card-count="5"\][\s\S]*?:nth-last-child\(-n \+ 2\),[\s\S]*?\[data-card-count="8"\][\s\S]*?grid-column:\s*span 3;/,
  "partially filled three-column rows expand their final two cards"
);
assert.match(
  styles,
  /\[data-card-count="7"\] > \.compare-cockpit-pair-card:last-child\s*\{[\s\S]*?grid-column:\s*span 6;/,
  "a lone final relationship card expands across the remaining row"
);
assert.match(
  styles,
  /\.compare-cockpit-issue-timeline\s*\{[\s\S]*?flex:\s*1;[\s\S]*?position:\s*relative;[\s\S]*?overflow:\s*auto;/,
  "recent issues form one scrollable date timeline"
);
assert.match(
  styles,
  /\.compare-cockpit-issue-day\s*\{[\s\S]*?grid-template-columns:\s*var\(--compare-issue-dot-column\) minmax\(0, 1fr\);/,
  "each recent-issue date group aligns to the timeline rail"
);
assert.match(
  styles,
  /\.compare-cockpit-v2 \.compare-cockpit-trend-chart\s*\{[\s\S]*?max-height:\s*none;/,
  "earnings charts are not capped at a fixed height"
);
assert.match(
  styles,
  /\.compare-cockpit-company-values\s*\{[\s\S]*?height:\s*var\(--company-list-height\);[\s\S]*?grid-template-rows:\s*repeat\(var\(--company-count\), var\(--company-row-height\)\);[\s\S]*?gap:\s*var\(--company-row-gap\);/,
  "quantitative company rows use count-aware density variables"
);
assert.match(
  styles,
  /\[data-company-count="2"\]\s*\{[\s\S]*?--company-row-height:\s*36px;[\s\S]*?--company-row-gap:\s*10px;[\s\S]*?--company-list-height:\s*82px;/,
  "two-company comparisons keep their rows close together"
);
assert.match(
  styles,
  /\[data-company-count="10"\]\s*\{[\s\S]*?--company-row-height:\s*24px;[\s\S]*?--company-row-gap:\s*2px;[\s\S]*?--company-list-height:\s*258px;/,
  "ten-company comparisons use the densest supported layout"
);
assert.match(
  styles,
  /\.compare-cockpit-company-value\s*\{[\s\S]*?grid-template-columns:\s*minmax\(48px, 56px\) minmax\(0, 1fr\) minmax\(96px, 12%\);[\s\S]*?column-gap:\s*12px;/,
  "company labels keep a dedicated gutter before comparison bars"
);
assert.match(
  styles,
  /@container \(max-width: 620px\) or \(max-height: 360px\)[\s\S]*?\.compare-cockpit-v2 \.compare-cockpit-company-value\s*\{[\s\S]*?column-gap:\s*8px;/,
  "compact panels retain a visible gutter between company labels and bars"
);
assert.match(
  styles,
  /\.compare-cockpit-company-value > b\s*\{[\s\S]*?padding-left:\s*12px;/,
  "numeric values keep a readable gutter after their comparison bars"
);
assert.match(
  styles,
  /\.compare-cockpit-company-value > div\s*\{[\s\S]*?height:\s*clamp\(8px, 32%, 14px\);/,
  "comparison bars grow with each row while retaining readable limits"
);
assert.match(
  styles,
  /\.compare-cockpit-brief-v2-lead\s*\{[^}]*font:\s*var\(--type-title-sm\);[^}]*letter-spacing:\s*var\(--type-title-sm-letter-spacing\);/,
  "AI report conclusions use the prominent result-title typography role"
);
assert.match(
  styles,
  /\.compare-cockpit-brief-v2-eyebrow\s*\{[^}]*font:\s*var\(--type-label-md\);[^}]*letter-spacing:\s*var\(--type-label-md-letter-spacing\);/,
  "the AI service label uses the readable panel-label typography role"
);
assert.match(
  styles,
  /\.compare-cockpit-brief-v2-lines li > p\s*\{[^}]*font:\s*var\(--type-label-md\);[^}]*letter-spacing:\s*var\(--type-label-md-letter-spacing\);/,
  "company summaries use the readable compact-row typography role"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-card > header > strong\s*\{[^}]*font:\s*var\(--type-title-sm\);/,
  "metric card titles use the prominent result-title typography role"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-card-value > b\s*\{[^}]*font:\s*var\(--type-title-sm\);/,
  "metric values use the prominent result-title typography role"
);
assert.match(
  styles,
  /\.compare-cockpit-brief-v2-lead-row\s*\{[^}]*grid-template-columns:\s*minmax\(180px, 0\.26fr\) minmax\(0, 1fr\);/,
  "the AI report label and conclusion share one horizontal row"
);
assert.match(
  styles,
  /\.compare-cockpit-brief-v2-lines\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(220px, 1fr\)\);/,
  "company summaries form a horizontal responsive row"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-cards\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--metric-count\), minmax\(0, 1fr\)\);/,
  "quantitative metrics render as equal-width cards"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-card-values\s*\{[^}]*flex:\s*1 1 auto;[^}]*grid-template-rows:\s*repeat\(var\(--company-count\), minmax\(46px, 1fr\)\);[^}]*padding:\s*10px 0 14px;/,
  "company metric rows distribute the card's available height instead of clustering at the top"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-card-values\[data-company-count="2"\] \.compare-cockpit-metric-card-value\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*grid-template-rows:\s*auto 18px;[^}]*row-gap:\s*16px;[^}]*padding:\s*18px 4px;/,
  "two-company comparisons use substantial label-value rows with a dedicated thick bar"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-card-values\[data-company-count="2"\] \.compare-cockpit-metric-card-value > div\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;[^}]*height:\s*18px;/,
  "two-company comparison bars span the row and use the thicker treatment"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-card\[data-company-count="2"\] > footer\s*\{[^}]*font:\s*var\(--type-label-md\);/,
  "two-company card summaries use the readable label role"
);
assert.match(
  styles,
  /@container \(max-width: 620px\) or \(max-height: 360px\)[\s\S]*?\.compare-cockpit-v2 \.compare-cockpit-metric-card-values\s*\{[^}]*flex:\s*0 0 auto;[^}]*grid-template-rows:\s*none;[^}]*padding:\s*0;/,
  "compact comparison cards retain their dense intrinsic-height metric rows"
);
assert.match(
  styles,
  /\.compare-cockpit-metric-row-v2\s*\{[\s\S]*?grid-template-columns:\s*minmax\(132px, 164px\) minmax\(0, 1fr\);[\s\S]*?gap:\s*16px;/,
  "wide panels cap the metric-heading column instead of expanding it fractionally"
);
assert.match(source, /new ResizeObserver/, "earnings SVG observes its rendered size");
assert.match(
  source,
  /viewBox=\{`0 0 \$\{chartSize\.width\} \$\{chartSize\.height\}`\}/,
  "earnings SVG coordinates follow the rendered chart dimensions"
);
assert.match(source, /groupRecentIssuesByDate\(entries\)/, "recent issues are grouped by date before rendering");
assert.doesNotMatch(source, /\.slice\(0,\s*2\)/, "recent issues are no longer truncated to two items per company");
assert.match(
  source,
  /useState<CompanyCompareSectionId>\("growth_style"\)/,
  "company comparison opens on the first growth axis"
);
assert.doesNotMatch(source, /\{axis\.index\}\s*\{axis\.tab\}/, "company comparison tabs omit numeric prefixes");
assert.match(source, />\s*\{axis\.tab\}\s*<\/button>/, "company comparison tabs show only their titles");
assert.match(source, /data-company-count=\{symbols\.length\}/, "company count is exposed to the responsive row-density rules");
assert.match(
  source,
  /data-card-count=\{compareSymbols\.length\}/,
  "relationship layout receives the current comparison-card count"
);
assert.doesNotMatch(
  source,
  /compare-reference-surface|referenceSurfaceProps|compareContextReference|compareAxisReference|compareMetricReference/,
  "company comparison surfaces do not add references to the agent chat when clicked"
);
assert.doesNotMatch(source, /비교 전체 참조|ContextualAgentAskButton/, "company comparison no longer exposes reference affordances");
assert.match(source, /AI 기업 비교 리포트/, "the AI report uses the user-facing Korean service label");
assert.match(source, /<QuantitativeMetricCards metrics=\{metrics\}/, "quantitative axes use metric cards");
assert.match(
  source,
  /"--company-count":\s*symbols\.length/,
  "metric cards expose the company count to their vertical row distribution"
);
assert.match(
  source,
  /className="compare-cockpit-metric-card-values" data-company-count=\{symbols\.length\}/,
  "metric rows expose their company count for the two-company layout"
);
assert.match(
  source,
  /buildBriefStructure\(brief, symbols, metrics\)/,
  "quantitative evidence is available when the narrative cannot be split by company"
);
assert.match(
  source,
  /function buildMetricBriefStructure[\s\S]*?facts\.join\(" · "\)/,
  "metric fallback builds one concise summary per company"
);

console.info("company comparison responsive fill tests passed");
