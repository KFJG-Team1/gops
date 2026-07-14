import assert from "node:assert/strict";
import {
  addPanelSlotAtGridRect,
  defaultGridSpanForKind,
  gridRectsOverlap,
  movePanelSlotToGridRect,
  normalizePanelGridRect,
  panelPaletteEntryLabel,
  readableMinGridSpanForKind,
  applyPanelMoveWithPush,
  replacePanelSlotKind,
  resolveFirstAvailableRecommendedGridRect,
  resolvePanelDropGridRect,
  resolvePanelMoveWithPush,
  setPrimaryChartSelection,
  setPrimaryChartSymbol,
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
  ["chartPatternList", { colSpan: 2, rowSpan: 2 }],
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
assert.equal(panelPaletteEntryLabel("portfolioHoldings"), "보유 종목 표");
assert.equal(panelPaletteEntryLabel("chartPatternList"), "패턴 종목");

const selectedPatternChart = setPrimaryChartSelection(firstAvailableState, " aapl ", "4h", viewport);
const selectedPatternChartSlot = selectedPatternChart.slots.find((slot) => selectedPatternChart.contents[slot.contentId]?.kind === "chart");
const selectedPatternChartContent = selectedPatternChartSlot ? selectedPatternChart.contents[selectedPatternChartSlot.contentId] : undefined;
assert.equal(selectedPatternChartContent?.props?.symbol, "AAPL");
assert.equal(selectedPatternChartContent?.props?.timeframe, "4h");
const selectedPatternWithoutChart = setPrimaryChartSelection(emptyState, "nvda", "1m", viewport);
const createdPatternChartSlot = selectedPatternWithoutChart.slots.find((slot) => selectedPatternWithoutChart.contents[slot.contentId]?.kind === "chart");
const createdPatternChartContent = createdPatternChartSlot ? selectedPatternWithoutChart.contents[createdPatternChartSlot.contentId] : undefined;
assert.equal(createdPatternChartContent?.kind, "chart");
assert.equal(createdPatternChartContent?.props?.symbol, "NVDA");
assert.equal(createdPatternChartContent?.props?.timeframe, "1m");
const symbolOnlySelection = setPrimaryChartSymbol(selectedPatternChart, "MSFT", viewport);
const symbolOnlyChartSlot = symbolOnlySelection.slots.find((slot) => symbolOnlySelection.contents[slot.contentId]?.kind === "chart");
assert.equal(symbolOnlyChartSlot ? symbolOnlySelection.contents[symbolOnlyChartSlot.contentId]?.props?.timeframe : undefined, "1D");

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

// Push-on-move: dragging a panel onto an occupied cell shoves the sitting panel downward.
const pushState = stateWithRects([
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }, // slot-block-1 (mover)
  { col: 1, row: 3, colSpan: 2, rowSpan: 2 }  // slot-block-2 (sitting target)
]);
const overlapPush = resolvePanelMoveWithPush(pushState, "slot-block-1", { col: 1, row: 3, colSpan: 2, rowSpan: 2 });
assert.equal(overlapPush.valid, true);
assert.equal(overlapPush.pushedSlots.length, 1);
assert.deepEqual(
  overlapPush.pushedSlots.find((slot) => slot.slotId === "slot-block-2")?.gridRect,
  { col: 1, row: 5, colSpan: 2, rowSpan: 2 }
);

const appliedPush = applyPanelMoveWithPush(pushState, overlapPush, viewport);
assert.deepEqual(
  appliedPush.slots.find((slot) => slot.id === "slot-block-1")?.gridRect,
  { col: 1, row: 3, colSpan: 2, rowSpan: 2 }
);
assert.deepEqual(
  appliedPush.slots.find((slot) => slot.id === "slot-block-2")?.gridRect,
  { col: 1, row: 5, colSpan: 2, rowSpan: 2 }
);

// Cascade: one push chains into the panel below it.
const cascadeState = stateWithRects([
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }, // mover
  { col: 1, row: 3, colSpan: 2, rowSpan: 1 }, // pushed down -> row 4
  { col: 1, row: 4, colSpan: 2, rowSpan: 1 }  // shoved by the one above -> row 5
]);
const cascadePush = resolvePanelMoveWithPush(cascadeState, "slot-block-1", { col: 1, row: 2, colSpan: 2, rowSpan: 2 });
assert.equal(cascadePush.valid, true);
assert.equal(cascadePush.pushedSlots.find((slot) => slot.slotId === "slot-block-2")?.gridRect.row, 4);
assert.equal(cascadePush.pushedSlots.find((slot) => slot.slotId === "slot-block-3")?.gridRect.row, 5);

// Panels in other columns are untouched by the push.
const sideBySide = stateWithRects([
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }, // mover
  { col: 1, row: 3, colSpan: 2, rowSpan: 2 }, // pushed
  { col: 3, row: 1, colSpan: 2, rowSpan: 2 }  // different column, stays put
]);
const sidePush = resolvePanelMoveWithPush(sideBySide, "slot-block-1", { col: 1, row: 3, colSpan: 2, rowSpan: 2 });
assert.equal(sidePush.valid, true);
assert.equal(sidePush.pushedSlots.some((slot) => slot.slotId === "slot-block-3"), false);

// No room: pushing off the bottom edge fails so the caller can block the drop.
const crowdedState = stateWithRects([
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }, // mover
  { col: 1, row: 3, colSpan: 2, rowSpan: 4 }  // fills down to the bottom row
]);
const blockedPush = resolvePanelMoveWithPush(crowdedState, "slot-block-1", { col: 1, row: 3, colSpan: 2, rowSpan: 2 });
assert.equal(blockedPush.valid, false);
assert.equal(blockedPush.reason, "no-room");

// Unobstructed move: plan is valid with no pushed panels.
const freeMove = resolvePanelMoveWithPush(sideBySide, "slot-block-1", { col: 5, row: 1, colSpan: 2, rowSpan: 2 });
assert.equal(freeMove.valid, true);
assert.equal(freeMove.pushedSlots.length, 0);

// Direction-aware push: dragging UP shoves the panel above upward (into room above it).
const upState = stateWithRects([
  { col: 1, row: 5, colSpan: 2, rowSpan: 2 }, // slot-block-1 mover (bottom)
  { col: 1, row: 3, colSpan: 2, rowSpan: 2 }  // slot-block-2 sitting above
]);
const upPush = resolvePanelMoveWithPush(upState, "slot-block-1", { col: 1, row: 3, colSpan: 2, rowSpan: 2 });
assert.equal(upPush.valid, true);
assert.equal(upPush.pushedSlots.find((slot) => slot.slotId === "slot-block-2")?.gridRect.row, 1);

// Dragging RIGHT shoves the panel to the right.
const rightState = stateWithRects([
  { col: 1, row: 1, colSpan: 2, rowSpan: 2 }, // slot-block-1 mover (left)
  { col: 3, row: 1, colSpan: 2, rowSpan: 2 }  // slot-block-2 sitting to the right
]);
const rightPush = resolvePanelMoveWithPush(rightState, "slot-block-1", { col: 3, row: 1, colSpan: 2, rowSpan: 2 });
assert.equal(rightPush.valid, true);
assert.equal(rightPush.pushedSlots.find((slot) => slot.slotId === "slot-block-2")?.gridRect.col, 5);

// Dragging LEFT shoves the panel to the left (into room on the left).
const leftState = stateWithRects([
  { col: 5, row: 1, colSpan: 2, rowSpan: 2 }, // slot-block-1 mover (right)
  { col: 3, row: 1, colSpan: 2, rowSpan: 2 }  // slot-block-2 sitting to the left
]);
const leftPush = resolvePanelMoveWithPush(leftState, "slot-block-1", { col: 3, row: 1, colSpan: 2, rowSpan: 2 });
assert.equal(leftPush.valid, true);
assert.equal(leftPush.pushedSlots.find((slot) => slot.slotId === "slot-block-2")?.gridRect.col, 1);

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
