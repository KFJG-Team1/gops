import assert from "node:assert/strict";
import {
  createInitialTiledPanelState,
  gridRectsOverlap,
  panelGridMetrics,
  panelMinimumRenderedSizeForKind,
  readableMinGridSpanForKind,
  workspaceBounds
} from "../src/layout/panelLayout";
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
