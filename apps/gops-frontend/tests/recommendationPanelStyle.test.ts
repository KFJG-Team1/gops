import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspaceStyles, panelSource, profileSource, apiSource, panelWorkspaceSource] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/StockDiscoveryPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/ScoreProfileManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/recommendationApi.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PanelWorkspace.tsx", import.meta.url), "utf8")
]);

assert.match(panelSource, /종목 목록/, "the unified panel exposes a discovery tab");
assert.match(panelSource, /급등주/, "gainers are a first-class list mode");
assert.match(panelSource, /거래대금/, "dollar volume is a first-class list mode");
assert.match(panelSource, /인기 Top 15/, "popular stocks are a fixed top-fifteen list mode");
assert.match(panelSource, /전체 종목/, "the complete market universe is a first-class searchable list mode");
assert.doesNotMatch(panelSource, /stock-discovery-results|filteredRows\.length\}개|modeLabel\(/, "the list omits mode and result-count helper text");
assert.match(panelSource, /추천 수식 설정/, "recommendation formula settings are a first-class panel tab");
assert.match(panelSource, /stock-discovery-logic-page/, "the logic editor is a full in-panel tab");
assert.doesNotMatch(panelSource, /stock-discovery-logic-sidebar|stock-discovery-logic-backdrop|aria-controls="recommendation-logic-sidebar"/, "the logic editor is not an overlay or side rail");
assert.match(panelSource, /<ScoreProfileManager/, "the logic tab renders the score profile editor directly");
assert.match(panelSource, /effectiveRecommendationScore/, "recommendations display and sort by the applied score");
assert.doesNotMatch(panelSource, /popularityPercentileScore|popularityScore|거래활성/, "non-recommendation lists do not invent a second score");
assert.match(panelSource, /const showsRank = mode !== "all"/, "recommendation, popular, gainer, and volume modes expose their ordered list position");
assert.match(panelSource, /\{showsRank && <span className="stock-discovery-rank">\{index \+ 1\}<\/span>\}/, "ranked modes render a dedicated leading rank column");
assert.doesNotMatch(panelSource, /추천 선택|stock-discovery-reference/, "row selection does not use a separate recommendation button");
assert.match(panelSource, /onSelectSymbol\(row\.market\.symbol\)/, "selecting any discovery row also updates its linked chart symbol");
assert.match(panelWorkspaceSource, /changeLinkedRecommendationChartSymbol[\s\S]*changePanelChartSymbol\(target\.contentId, symbol\)/, "recommendation rows target the nearest chart panel in the current layout");
assert.match(panelSource, /stock-discovery-price[\s\S]*row\.market\.lastPrice/, "discovery rows show the current price");
assert.match(panelSource, /stock-discovery-dollar-volume[\s\S]*row\.market\.sessionDollarVolume/, "discovery rows show compact session dollar volume");
assert.match(panelSource, /stock-discovery-market-cap[\s\S]*row\.market\.marketCap/, "discovery rows show compact market capitalization");
assert.doesNotMatch(panelSource, /stock-discovery-metric-summary|매수.?비율|매도.?비율|거래.?비율/, "discovery rows omit the trading-ratio column");
assert.doesNotMatch(panelSource, /stock-discovery-mode-group|>사용자</, "the list header does not invent user and market groupings");
assert.match(panelSource, /<summary><Filter size=\{13\} \/>필터/, "the screen conditions use the concise filter label");
assert.match(panelSource, /<strong>상세 지표<\/strong>[\s\S]*screenerMetricDefinitions\.map/, "every list mode exposes the complete metric screener");
assert.doesNotMatch(panelSource, /contextualMetrics|modeMetricKeys/, "metric filters are not hidden or ignored by list mode");
assert.doesNotMatch(panelSource, /장전|본장|sessionMode/, "the panel no longer exposes session selection");
assert.doesNotMatch(apiSource, /RecommendationSessionMode|sessionMode/, "the frontend recommendation API has one sessionless contract");
assert.match(profileSource, /type="range"/, "factor weights have visible sliders");
assert.match(profileSource, /score-profile-preset-shelf/, "immutable defaults are presented only as starting presets");
assert.doesNotMatch(profileSource, /로직 라이브러리|시작 프리셋/, "the formula editor omits jargon-heavy section headings");
assert.doesNotMatch(profileSource, /현재 기준|>불러오기</, "preset cards omit status helper labels");
assert.match(profileSource, /customProfiles\.map/, "saved user logic is separated from preset templates");
assert.match(profileSource, /aria-label="추천 로직 요청"/, "the custom logic library accepts a natural-language profile request");
assert.match(profileSource, /suggestScoreProfile/, "the natural-language request calls the grounded suggestion API");
assert.match(profileSource, /score-profile-ai-suggestion[\s\S]*제안 근거/, "the proposed preset exposes its grounded rationale on hover or focus");
assert.match(profileSource, /초안에 적용/, "an AI proposal remains an explicit editable draft before persistence");
assert.doesNotMatch(profileSource, /ScoreGraphCanvas|GraphEdge|startNodeDrag|startPan/, "weight editing does not use a graph canvas interaction");
assert.match(profileSource, /ScoreWeightMixer/, "recommendation factors are edited in one direct weight mixer");
assert.match(profileSource, /score-profile-allocation-bar/, "the mixer summarizes the complete 100-percent allocation");
assert.match(panelSource, /recommendationScoreBreakdown/, "recommendation score pills expose effective block score details");
assert.match(profileSource, /score-profile-mixer-card/, "all signal groups remain directly visible as mixer cards");
assert.match(profileSource, /신호 추가|지표 추가/, "removed signals and factors can be restored directly");
assert.match(profileSource, /신호 제거/, "active signal groups can be removed directly");
assert.match(profileSource, /factorLabels\[factor\].*제거/, "active parameters can be removed inside their nodes");
assert.doesNotMatch(profileSource, /<small>/, "the weight editor omits muted helper descriptions");
assert.doesNotMatch(profileSource, /아직 저장한 로직이 없습니다|읽기 전용 시작점|변경사항 있음|현재 추천에 적용 중|저장된 설정/, "the weight editor omits muted state helper text");
assert.doesNotMatch(panelSource, /<small>/, "the recommendation panel omits muted helper descriptions");
assert.doesNotMatch(panelSource, /고정 안전 규칙|stock-discovery-fixed-rules/, "the logic editor omits the fixed-rule helper block");
assert.doesNotMatch(panelSource, /전체 배분을 보면서 신호와 세부 지표 비중을 바로 조절합니다/, "the logic tab omits its muted helper description");
assert.match(panelSource, /RSI\(14\)/, "RSI is available as a numeric screen");
assert.match(panelSource, /PER\(공시 EPS\)/, "PER is available as a numeric screen with provenance-aware labeling");
assert.match(panelSource, /PBR/, "PBR is available as a numeric screen");
assert.match(panelSource, /ROE/, "ROE is available as a numeric screen");
assert.match(workspaceStyles, /\.stock-discovery-tabs/, "recommendation tabs have dedicated responsive styling");
assert.match(workspaceStyles, /\.stock-discovery-mode-switcher/, "list modes use a dedicated segmented switcher");
assert.match(workspaceStyles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/, "all five list modes share one switcher");
assert.match(workspaceStyles, /\.stock-discovery-select-row[\s\S]*justify-items: start;/, "stock row columns use left alignment");
assert.match(workspaceStyles, /minmax\(180px, 2fr\) repeat\(5, minmax\(96px, 1fr\)\)/, "company uses two units while the five market columns share equal tracks");
assert.match(workspaceStyles, /\.stock-discovery-price,[\s\S]*text-align: right;[\s\S]*justify-self: stretch;/, "price, change, volume, and market-cap values share aligned right edges");
assert.match(workspaceStyles, /\.stock-discovery-select-row\.has-score \{[\s\S]*minmax\(110px, 1\.5fr\) repeat\(5, minmax\(60px, 1fr\)\) 58px;[\s\S]*column-gap: 8px;/, "scored rows use a compact recommendation-only grid that keeps the score visible without horizontal scrolling");
assert.match(workspaceStyles, /@container stock-discovery \(max-width: 620px\)[\s\S]*\.stock-discovery-select-row\.has-score \{[\s\S]*minmax\(80px, 1fr\) 60px 56px 66px 62px 54px;/, "recommendation score remains visible at the medium panel boundary");
assert.match(workspaceStyles, /@container stock-discovery \(max-width: 520px\)[\s\S]*\.stock-discovery-select-row\.has-score \{[\s\S]*minmax\(70px, 1fr\) 56px 52px 62px 52px;/, "recommendation score remains visible at the narrow panel boundary");
assert.match(workspaceStyles, /\.stock-discovery-rank \{[\s\S]*font: var\(--type-title-sm\);/, "rank text moves one design-system size step above label-md");
assert.match(workspaceStyles, /\.stock-discovery-company > strong \{[\s\S]*font: var\(--type-title-sm\);/, "ticker text moves one design-system size step above label-md");
assert.match(workspaceStyles, /\.stock-discovery-company > span,[\s\S]*font: var\(--type-label-md\);/, "company and sector metadata move one visual size step above caption");
assert.match(workspaceStyles, /\.stock-discovery-price,[\s\S]*font: var\(--type-label-md\);/, "market values move one visual size step above caption");
assert.match(workspaceStyles, /\.stock-discovery-badges > em \{[\s\S]*font: var\(--type-label-md\);/, "recommendation score text moves one visual size step above caption");
assert.match(workspaceStyles, /\.stock-discovery-rank \{[\s\S]*text-align: right;/, "rank values align to the shared right edge");
assert.match(workspaceStyles, /\.stock-discovery-sector \{[\s\S]*justify-self: stretch;[\s\S]*text-align: right;/, "sector labels align with the numeric market columns");
assert.match(workspaceStyles, /\.stock-discovery-badges \{[\s\S]*align-items: flex-end;[\s\S]*justify-self: stretch;/, "recommendation scores align to the right edge of their full grid track");
assert.match(workspaceStyles, /\.stock-discovery-badges > em \{[\s\S]*padding: 0;[\s\S]*text-align: right;[\s\S]*white-space: nowrap;/, "recommendation scores remain readable on one line without pill padding");
assert.match(workspaceStyles, /\.stock-discovery-badges \.is-recommended \{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*color: var\(--color-signal\);/, "recommendation scores use plain blue text without a white fill");
assert.match(workspaceStyles, /\.stock-discovery-row\.is-selected \.stock-discovery-badges \.is-recommended \{[\s\S]*background: transparent;[\s\S]*color: var\(--color-signal\);/, "selected recommendation rows keep the same blue score text");
assert.match(workspaceStyles, /\.stock-discovery-score-breakdown/, "score composition appears in a compact hover breakdown");
assert.match(workspaceStyles, /\.stock-discovery-company,[\s\S]*align-items: flex-start;/, "company and score content align to the left edge of their columns");
assert.match(workspaceStyles, /\.stock-discovery-company \{[\s\S]*width: 100%;[\s\S]*overflow: hidden;/, "long company names stay inside their own grid column");
assert.match(workspaceStyles, /\.stock-discovery-row\.is-selected \{ background: #fff;/, "the selected row uses the white selection contract");
assert.match(workspaceStyles, /\.stock-discovery-logic-page/, "the detailed weight editor fills its panel tab");
assert.match(workspaceStyles, /\.stock-discovery-logic-page \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;[\s\S]*scrollbar-gutter: stable;/, "the complete logic page owns one predictable vertical scrollbar");
assert.match(workspaceStyles, /\.stock-discovery-logic-scroll \{[\s\S]*flex: 0 0 auto;[\s\S]*overflow: visible;/, "the logic content wrapper does not create a nested scroll region");
assert.match(workspaceStyles, /\.score-profile-editor \{[\s\S]*flex: 0 0 auto;[\s\S]*overflow: visible;/, "the weight editor expands into the page scrollbar instead of scrolling independently");
assert.doesNotMatch(workspaceStyles, /\.stock-discovery-logic-sidebar|\.stock-discovery-logic-backdrop/, "legacy side rail styling is removed");
assert.match(workspaceStyles, /\.stock-discovery-metric-filters/, "detailed metric ranges use a responsive grid");
assert.match(workspaceStyles, /\.score-profile-weight-input/, "weight sliders and numeric inputs share an explicit control layout");
assert.match(workspaceStyles, /\.score-profile-mixer/, "the weight editor has a dedicated mixer layout");
assert.match(workspaceStyles, /\.score-profile-allocation-bar/, "the weight mixer has a proportional allocation overview");
assert.match(workspaceStyles, /\.stock-discovery-logic-page > header strong \{[\s\S]*font: var\(--type-title-lg\);/, "logic-page title moves one design-system step above title-md");
assert.match(workspaceStyles, /\.score-profile-manager \{[\s\S]*font: var\(--type-label-md\);/, "logic-page body and inherited weight controls move one visual step above compact body text");
assert.match(workspaceStyles, /\.score-profile-manager-head strong \{[\s\S]*font: var\(--type-title-sm\);/, "logic library labels move one design-system step above label-md");
assert.match(workspaceStyles, /\.score-profile-editor-head > strong \{ font: var\(--type-title-md\);/, "selected logic heading preserves hierarchy after the one-step increase");
assert.match(workspaceStyles, /\.score-profile-ai-query textarea \{[\s\S]*font: var\(--type-label-md\);/, "logic prompt text moves one visual step above body-md");
assert.match(workspaceStyles, /\.score-profile-editor-head button,[\s\S]*font: var\(--type-title-sm\);/, "logic action labels move one design-system step above button text");
assert.match(workspaceStyles, /\.score-profile-mixer-primary > span,[\s\S]*font: var\(--type-label-md\);/, "weight labels move one visual step above caption");
assert.match(workspaceStyles, /var\(--color-signal\)[\s\S]*var\(--color-up\)[\s\S]*var\(--color-caution\)[\s\S]*var\(--color-danger\)[\s\S]*#8b5cf6[\s\S]*#14b8a6/, "allocation segments retain the original muted signal palette");
assert.match(workspaceStyles, /\.score-profile-preset-shelf button\.is-selected \{[\s\S]*background: #ffffff;[\s\S]*color: #000000;/, "the selected starting preset uses a white fill");
assert.match(workspaceStyles, /\.score-profile-ai-suggestion:hover \.score-profile-ai-rationale/, "profile suggestion evidence appears on hover");
assert.match(workspaceStyles, /\.score-profile-mixer-grid/, "signal controls use a responsive direct-edit grid");

const recommendationStyles = workspaceStyles.slice(
  workspaceStyles.indexOf("/* Unified S&P 500 recommendation discovery */"),
  workspaceStyles.indexOf("/* Company analysis panels:")
);
assert.match(recommendationStyles, /font: var\(--type-title-md\)/, "recommendation headings use the shared title role");
assert.match(recommendationStyles, /font: var\(--type-label-md\)/, "recommendation row and utility titles use the shared label role");
assert.match(recommendationStyles, /font: var\(--type-button\)/, "recommendation actions and tabs use the shared button role");
assert.match(recommendationStyles, /font: var\(--type-body-md\)/, "recommendation descriptions and inputs use the shared body role");
assert.match(recommendationStyles, /font: var\(--type-caption\)/, "recommendation metrics and metadata use the shared caption role");
assert.doesNotMatch(recommendationStyles, /font-size\s*:/, "recommendation UI does not declare one-off font sizes");
assert.doesNotMatch(recommendationStyles, /font-weight\s*:/, "recommendation UI does not mix arbitrary font weights into semantic roles");
assert.doesNotMatch(recommendationStyles, /font\s*:\s*\d/, "recommendation UI does not use local font shorthands");
assert.doesNotMatch(workspaceStyles, /Panel content is intentionally one typography step larger/, "workspace panels do not redefine the design-system role scale");

console.info("recommendation panel style tests passed");
