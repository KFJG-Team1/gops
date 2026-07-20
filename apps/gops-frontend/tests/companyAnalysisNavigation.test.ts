import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveCompanyAnalysisCommand } from "../src/agent/companyAnalysisNavigation";
import {
  createTiledPanelStateFromSpec,
  serializeTiledPanelState,
  synchronizeCompanyAnalysisSymbol
} from "../src/layout/panelLayout";
import { buildPresetLayout, DEFAULT_PRESETS } from "../src/layout/layoutPresets";

const entities = [
  { symbol: "NVDA", name: "NVIDIA Corporation" },
  { symbol: "AAPL", name: "Apple Inc." }
];

assert.deepEqual(resolveCompanyAnalysisCommand("nvda 기업분석하자", "TSLA", entities), {
  status: "ready",
  symbol: "NVDA"
});
assert.deepEqual(resolveCompanyAnalysisCommand("기업 분석하자", " aapl ", entities), {
  status: "ready",
  symbol: "AAPL"
});
assert.deepEqual(resolveCompanyAnalysisCommand("기업분석하자", null, entities), { status: "missing_symbol" });
assert.deepEqual(resolveCompanyAnalysisCommand("NVDA 차트분석하자", "AAPL", entities), { status: "none" });

const viewport = { width: 1440, height: 900 };
const mismatched = createTiledPanelStateFromSpec([
  { kind: "chart", symbol: "TSLA", gridRect: { col: 1, row: 1, colSpan: 2, rowSpan: 3 } },
  { kind: "company", symbol: "TSLA", gridRect: { col: 3, row: 1, colSpan: 2, rowSpan: 3 } },
  { kind: "companyJournal", symbol: "AMZN", gridRect: { col: 5, row: 1, colSpan: 2, rowSpan: 3 } },
  { kind: "compare", symbol: "AMD", gridRect: { col: 1, row: 4, colSpan: 6, rowSpan: 3 } }
], viewport);
const synchronized = synchronizeCompanyAnalysisSymbol(mismatched, "nvda");
const synchronizedContents = synchronized.slots.map((slot) => synchronized.contents[slot.contentId]);
assert.equal(synchronizedContents.find((content) => content.kind === "chart")?.props?.symbol, "NVDA");
assert.equal(synchronizedContents.find((content) => content.kind === "company")?.props?.symbol, "NVDA");
assert.equal(synchronizedContents.find((content) => content.kind === "companyJournal")?.props?.symbol, "NVDA");
assert.equal(synchronizedContents.find((content) => content.kind === "compare")?.props?.baseSymbol, "NVDA");
assert.deepEqual(synchronizedContents.find((content) => content.kind === "compare")?.props?.symbols, ["NVDA"]);

const companyPreset = DEFAULT_PRESETS.find((preset) => preset.id === "stock");
assert.ok(companyPreset);
const freshCompanyLayout = buildPresetLayout(companyPreset, viewport, { symbol: "AAPL" });
assert.ok(freshCompanyLayout);
assert.equal(
  freshCompanyLayout.slots
    .map((slot) => freshCompanyLayout.contents[slot.contentId])
    .find((content) => content.kind === "companyJournal")?.props?.symbol,
  "AAPL"
);
const restoredCompanyLayout = buildPresetLayout(
  { ...companyPreset, layout: serializeTiledPanelState(mismatched) },
  viewport,
  { symbol: "MSFT" }
);
assert.ok(restoredCompanyLayout);
for (const content of restoredCompanyLayout.slots.map((slot) => restoredCompanyLayout.contents[slot.contentId])) {
  if (content.kind === "chart" || content.kind === "company" || content.kind === "companyJournal") {
    assert.equal(content.props?.symbol, "MSFT");
  }
  if (content.kind === "compare") {
    assert.equal(content.props?.baseSymbol, "MSFT");
  }
}

const chartAnalysisPreset = DEFAULT_PRESETS.find((preset) => preset.id === "compare");
assert.ok(chartAnalysisPreset);
const chartAnalysisLayout = buildPresetLayout(chartAnalysisPreset, viewport, { symbol: "AMZN" });
assert.ok(chartAnalysisLayout);
const compareContent = chartAnalysisLayout.slots
  .map((slot) => chartAnalysisLayout.contents[slot.contentId])
  .find((content) => content.kind === "compare");
assert.equal(compareContent?.props?.baseSymbol, "AMZN");
assert.deepEqual(compareContent?.props?.symbols, ["AMZN"]);

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(appSource, /resolveCompanyAnalysisCommand\([\s\S]*?openCompanyPage\(companyAnalysisCommand\.symbol\)/);
assert.match(appSource, /applyPreparedPreset\([\s\S]*?synchronizeCompanyAnalysisSymbol\(preparedState, normalizedSymbol\)/);
assert.ok(
  appSource.indexOf("resolveCompanyAnalysisCommand(") < appSource.indexOf("isLikelyPresetLoadPrompt(prompt"),
  "explicit company-analysis commands must route before generic layout resolution"
);

console.log("company analysis symbol navigation tests passed");
