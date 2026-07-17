import assert from "node:assert/strict";
import {
  createInitialTiledPanelState,
  defaultGridSpanForKind,
  gridRectsOverlap,
  panelGridMetrics,
  panelMinimumRenderedSizeForKind,
  readableMinGridSpanForKind,
  type StoredTiledPanelState,
  workspaceBounds
} from "../src/layout/panelLayout";
import {
  buildPresetLayout,
  DEFAULT_PRESETS,
  migrateCompanyComparePanelSnapshot
} from "../src/layout/layoutPresets";
import {
  compactGridCellFloorPx,
  resolveResponsivePanelLayout
} from "../src/layout/responsivePanelLayout";

const baseMetrics = { topInset: 52, uiScale: 1.6 };

const compact = resolveResponsivePanelLayout({ width: 854, height: 480 }, baseMetrics);
assert.equal(compact.mode, "compact");
const compactGrid = panelGridMetrics({ width: 854, height: 480 }, compact.metrics);
assert.ok(compactGrid.cellWidth * baseMetrics.uiScale >= compactGridCellFloorPx.width - 0.5);
assert.ok(compactGrid.cellHeight * baseMetrics.uiScale >= compactGridCellFloorPx.height - 0.5);
const compactBounds = workspaceBounds({ width: 854, height: 480 }, compact.metrics);
assert.ok(compactBounds.top + compactBounds.height + 64 > 480);

const standard = resolveResponsivePanelLayout({ width: 1200, height: 675 }, baseMetrics);
assert.equal(standard.mode, "standard");
assert.equal(standard.metrics.minCellWidthPx, undefined);
assert.equal(standard.metrics.minCellHeightPx, undefined);

const wide = resolveResponsivePanelLayout({ width: 1600, height: 900 }, baseMetrics);
assert.equal(wide.mode, "wide");

assert.deepEqual(readableMinGridSpanForKind("indices"), { colSpan: 1, rowSpan: 1 });
assert.deepEqual(readableMinGridSpanForKind("news"), { colSpan: 2, rowSpan: 2 });
assert.deepEqual(readableMinGridSpanForKind("chart"), { colSpan: 2, rowSpan: 2 });
assert.deepEqual(readableMinGridSpanForKind("trade"), { colSpan: 2, rowSpan: 2 });
assert.deepEqual(readableMinGridSpanForKind("paperQuickOrder"), { colSpan: 2, rowSpan: 2 });
assert.deepEqual(readableMinGridSpanForKind("paperTrade"), { colSpan: 2, rowSpan: 2 });
assert.deepEqual(readableMinGridSpanForKind("paperAccount"), { colSpan: 2, rowSpan: 2 });
assert.deepEqual(panelMinimumRenderedSizeForKind("paperAccount"), { width: 320, height: 220 });
assert.deepEqual(readableMinGridSpanForKind("aiCoach"), { colSpan: 2, rowSpan: 3 });
assert.deepEqual(panelMinimumRenderedSizeForKind("aiCoach"), { width: 320, height: 500 });
assert.deepEqual(readableMinGridSpanForKind("priceCondition"), { colSpan: 1, rowSpan: 1 });
assert.deepEqual(panelMinimumRenderedSizeForKind("priceCondition"), { width: 0, height: 0 });
assert.deepEqual(panelMinimumRenderedSizeForKind("chart"), { width: 320, height: 220 });
assert.deepEqual(readableMinGridSpanForKind("companyCompare"), { colSpan: 3, rowSpan: 2 });
assert.deepEqual(defaultGridSpanForKind("companyCompare"), { colSpan: 3, rowSpan: 2 });
assert.deepEqual(panelMinimumRenderedSizeForKind("companyCompare"), { width: 420, height: 220 });

const stockPreset = DEFAULT_PRESETS.find((preset) => preset.id === "stock");
assert.ok(stockPreset);
const stockLayout = buildPresetLayout(stockPreset, { width: 1280, height: 720 });
assert.ok(stockLayout);
const stockCompareContentId = Object.values(stockLayout.contents)
  .find((content) => content.kind === "companyCompare")?.id;
const stockCompareSlot = stockLayout.slots.find((slot) => slot.contentId === stockCompareContentId);
assert.deepEqual(stockCompareSlot?.gridRect, { col: 1, row: 1, colSpan: 3, rowSpan: 2 });

const legacyCompanyCompareLayout: StoredTiledPanelState = {
  version: 1,
  nextInstance: 2,
  contents: {
    "content-companyCompare-1": {
      id: "content-companyCompare-1",
      kind: "companyCompare",
      title: "기업 성향 비교",
      instanceIndex: 1
    }
  },
  slots: [{
    id: "slot-companyCompare-1",
    contentId: "content-companyCompare-1",
    gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 4 }
  }]
};
const migratedCompanyCompareLayout = migrateCompanyComparePanelSnapshot(
  legacyCompanyCompareLayout
) as StoredTiledPanelState;
assert.deepEqual(
  migratedCompanyCompareLayout.slots[0]?.gridRect,
  { col: 1, row: 1, colSpan: 3, rowSpan: 2 }
);
assert.equal(
  migratedCompanyCompareLayout.contents["content-companyCompare-1"]?.props?.companyCompareLayoutVersion,
  2
);

const initial = createInitialTiledPanelState({ width: 854, height: 480 }, {
  symbol: "NVDA",
  layoutMetrics: compact.metrics
});
assert.equal(
  Object.values(initial.contents).some((content) => ["paperQuickOrder", "paperTrade", "paperAccount"].includes(content.kind)),
  false
);
for (let leftIndex = 0; leftIndex < initial.slots.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < initial.slots.length; rightIndex += 1) {
    assert.equal(
      gridRectsOverlap(initial.slots[leftIndex]!.gridRect, initial.slots[rightIndex]!.gridRect),
      false
    );
  }
}

console.log("responsive panel layout tests passed");
