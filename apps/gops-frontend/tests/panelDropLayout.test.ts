import assert from "node:assert/strict";
import {
  addPanelSlotAtGridRect,
  defaultGridSpanForKind,
  gridRectsOverlap,
  movePanelSlotToGridRect,
  normalizePanelGridRect,
  panelPaletteEntryLabel,
  readableMinGridSpanForKind,
  replacePanelSlotKind,
  resolveFirstAvailableRecommendedGridRect,
  resolvePanelDropGridRect,
  type PanelContentKind,
  type PanelGridRect,
  type TiledPanelState
} from "../src/layout/panelLayout";

const viewport = { width: 1280, height: 720 };
const emptyState: TiledPanelState = { slots: [], contents: {}, nextInstance: 1 };

const recommendedSpans: Array<[PanelContentKind, Pick<PanelGridRect, "colSpan" | "rowSpan">]> = [
  ["chart", { colSpan: 2, rowSpan: 2 }],
  ["compare", { colSpan: 4, rowSpan: 2 }],
  ["news", { colSpan: 2, rowSpan: 2 }],
  ["themeRadar", { colSpan: 3, rowSpan: 2 }],
  ["portfolioHoldings", { colSpan: 5, rowSpan: 3 }]
];

for (const [kind, expectedSpan] of recommendedSpans) {
  assert.deepEqual(defaultGridSpanForKind(kind), expectedSpan);
  const plan = resolvePanelDropGridRect(emptyState, kind, { col: 4, row: 3 });
  assert.equal(plan.valid, true);
  assert.deepEqual(
    { colSpan: plan.gridRect.colSpan, rowSpan: plan.gridRect.rowSpan },
    expectedSpan
  );
}

const centeredChartPlan = resolvePanelDropGridRect(emptyState, "chart", { col: 4, row: 3 });
assert.deepEqual(centeredChartPlan.gridRect, { col: 3, row: 2, colSpan: 2, rowSpan: 2 });

const blockedTargetState = stateWithRects([
  { col: 2, row: 1, colSpan: 1, rowSpan: 1 }
]);
const nearestChartPlan = resolvePanelDropGridRect(blockedTargetState, "chart", { col: 1, row: 1 });
assert.equal(nearestChartPlan.valid, true);
assert.deepEqual(nearestChartPlan.gridRect, { col: 1, row: 2, colSpan: 2, rowSpan: 2 });
assert.equal(gridRectsOverlap(nearestChartPlan.gridRect, blockedTargetState.slots[0]!.gridRect), false);

const fullState = stateWithRects([
  { col: 1, row: 1, colSpan: 8, rowSpan: 6 }
]);
const unavailableChartPlan = resolvePanelDropGridRect(fullState, "chart", { col: 4, row: 3 });
assert.equal(unavailableChartPlan.valid, false);
assert.equal(unavailableChartPlan.reason, "preferred-span-unavailable");
assert.deepEqual(
  { colSpan: unavailableChartPlan.gridRect.colSpan, rowSpan: unavailableChartPlan.gridRect.rowSpan },
  { colSpan: 2, rowSpan: 2 }
);

const firstAvailableState = stateWithRects([
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }
]);
assert.deepEqual(
  resolveFirstAvailableRecommendedGridRect(firstAvailableState, "chart"),
  { col: 3, row: 1, colSpan: 2, rowSpan: 2 }
);
assert.equal(resolveFirstAvailableRecommendedGridRect(fullState, "chart"), null);
assert.equal(panelPaletteEntryLabel("compare"), "비교");
assert.equal(panelPaletteEntryLabel("portfolioHoldings"), "Holdings 표");

const committedState = addPanelSlotAtGridRect(
  blockedTargetState,
  "chart",
  nearestChartPlan.gridRect,
  { symbol: "NVDA" },
  viewport
);
const addedSlot = committedState.slots.find((slot) => (
  !blockedTargetState.slots.some((existing) => existing.id === slot.id)
));
assert.ok(addedSlot);
assert.deepEqual(addedSlot.gridRect, nearestChartPlan.gridRect);
assert.equal(committedState.contents[addedSlot.contentId]?.props?.symbol, "NVDA");

const sourceSlot = firstAvailableState.slots[0]!;
const movedState = movePanelSlotToGridRect(
  firstAvailableState,
  sourceSlot.id,
  { col: 3, row: 1, colSpan: 2, rowSpan: 2 },
  viewport
);
assert.deepEqual(
  movedState.slots.find((slot) => slot.id === sourceSlot.id)?.gridRect,
  { col: 3, row: 1, colSpan: 2, rowSpan: 2 }
);

const replacedState = replacePanelSlotKind(
  firstAvailableState,
  sourceSlot.id,
  "chart",
  viewport,
  { symbol: "AAPL" }
);
const replacedSlot = replacedState.slots.find((slot) => slot.id === sourceSlot.id);
assert.ok(replacedSlot);
assert.deepEqual(replacedSlot.gridRect, sourceSlot.gridRect);
assert.equal(replacedState.contents[replacedSlot.contentId]?.kind, "chart");
assert.equal(replacedState.contents[replacedSlot.contentId]?.props?.symbol, "AAPL");

const readableNewsSpan = readableMinGridSpanForKind("news");
assert.deepEqual(
  normalizePanelGridRect({ col: 1, row: 1, colSpan: 1, rowSpan: 1 }, readableNewsSpan),
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }
);

console.log("panel drop layout tests passed");

function stateWithRects(rects: PanelGridRect[]): TiledPanelState {
  const contents: TiledPanelState["contents"] = {};
  const slots: TiledPanelState["slots"] = rects.map((gridRect, index) => {
    const contentId = `content-block-${index + 1}`;
    contents[contentId] = {
      id: contentId,
      kind: "news",
      title: `Block ${index + 1}`,
      instanceIndex: index + 1
    };
    return {
      id: `slot-block-${index + 1}`,
      contentId,
      gridRect,
      rect: { left: 0, top: 0, width: 0, height: 0 },
      minWidth: 0,
      minHeight: 0
    };
  });
  return { slots, contents, nextInstance: rects.length + 1 };
}
