import assert from "node:assert/strict";
import type { AgentLayoutProposal } from "../src/layout/agentLayoutTypes";
import {
  agentLayoutApplySucceeded,
  applyTiledAgentLayoutProposalWithResult,
  buildTiledAgentLayoutContext
} from "../src/layout/tiledAgentLayout";
import type { PanelGridRect, TiledPanelState } from "../src/layout/panelLayout";

const viewport = { width: 1440, height: 900 };
const popularStocksCatalogEntry = buildTiledAgentLayoutContext({ slots: [], contents: {}, nextInstance: 1 }, viewport)
  .panelCatalog
  .find((entry) => entry.panelType === "popularStocks");
assert.deepEqual(popularStocksCatalogEntry?.minSpan, { colSpan: 1, rowSpan: 2 });
assert.deepEqual(popularStocksCatalogEntry?.defaultSpan, { colSpan: 1, rowSpan: 2 });
const quickOrderCatalogEntry = buildTiledAgentLayoutContext({ slots: [], contents: {}, nextInstance: 1 }, viewport)
  .panelCatalog
  .find((entry) => entry.panelType === "quickOrder");
assert.deepEqual(quickOrderCatalogEntry?.minSpan, { colSpan: 2, rowSpan: 2 });
assert.deepEqual(quickOrderCatalogEntry?.defaultSpan, { colSpan: 2, rowSpan: 2 });
const paperCatalog = buildTiledAgentLayoutContext({ slots: [], contents: {}, nextInstance: 1 }, viewport).panelCatalog;
assert.equal(paperCatalog.find((entry) => entry.panelType === "paperQuickOrder")?.title, "가상 빠른 주문");
assert.equal(paperCatalog.find((entry) => entry.panelType === "paperOrderTicket")?.title, "가상 주문");
assert.deepEqual(paperCatalog.find((entry) => entry.panelType === "paperAccount")?.minSpan, { colSpan: 2, rowSpan: 2 });
assert.deepEqual(paperCatalog.find((entry) => entry.panelType === "paperAccount")?.defaultSpan, { colSpan: 4, rowSpan: 3 });
const patternListCatalogEntry = buildTiledAgentLayoutContext({ slots: [], contents: {}, nextInstance: 1 }, viewport)
  .panelCatalog
  .find((entry) => entry.panelType === "chartPatternList");
assert.equal(patternListCatalogEntry?.title, "패턴 종목");
assert.deepEqual(patternListCatalogEntry?.minSpan, { colSpan: 2, rowSpan: 2 });
assert.deepEqual(patternListCatalogEntry?.defaultSpan, { colSpan: 2, rowSpan: 2 });
const priceConditionCatalogEntry = buildTiledAgentLayoutContext({ slots: [], contents: {}, nextInstance: 1 }, viewport)
  .panelCatalog
  .find((entry) => entry.panelType === "priceCondition");
assert.equal(priceConditionCatalogEntry?.title, "알림 · 관심 기업");
assert.deepEqual(priceConditionCatalogEntry?.minSpan, { colSpan: 1, rowSpan: 1 });
assert.deepEqual(priceConditionCatalogEntry?.defaultSpan, { colSpan: 1, rowSpan: 3 });

const original = stateWithRects([
  { col: 1, row: 1, colSpan: 4, rowSpan: 3 },
  { col: 5, row: 1, colSpan: 2, rowSpan: 2 }
]);

const resizeProposal = proposal([
  {
    type: "layout.panels.arrange",
    payload: {
      placements: [
        { panelId: "slot-1", placement: { group: "workspace", col: 1, row: 1, colSpan: 5, rowSpan: 4 } },
        { panelId: "slot-2", placement: { group: "workspace", col: 6, row: 1, colSpan: 2, rowSpan: 2 } }
      ]
    }
  }
]);
const resizedResult = applyTiledAgentLayoutProposalWithResult(original, resizeProposal, viewport);
const resized = resizedResult.state;
assert.equal(agentLayoutApplySucceeded(resizeProposal, resizedResult), true);
assert.deepEqual(resized.slots.find((slot) => slot.id === "slot-1")?.gridRect, {
  col: 1,
  row: 1,
  colSpan: 5,
  rowSpan: 4
});

const pinned = applyTiledAgentLayoutProposalWithResult(original, proposal([
  { type: "layout.panel.pin", payload: { panelId: "slot-1" }, target: { panelId: "slot-1" } }
]), viewport).state;
assert.equal(pinned.slots.find((slot) => slot.id === "slot-1")?.layoutPinned, true);

const unpinned = applyTiledAgentLayoutProposalWithResult(pinned, proposal([
  { type: "layout.panel.unpin", payload: { panelId: "slot-1" }, target: { panelId: "slot-1" } }
]), viewport).state;
assert.equal(Boolean(unpinned.slots.find((slot) => slot.id === "slot-1")?.layoutPinned), false);

const undone = applyTiledAgentLayoutProposalWithResult(resized, proposal([
  { type: "layout.undo", payload: {} }
]), viewport, {}, { undoState: original });
assert.equal(undone.stateChanged, true);
assert.deepEqual(undone.state.slots.map((slot) => slot.gridRect), original.slots.map((slot) => slot.gridRect));

const conflictProposal = proposal([
  {
    type: "layout.panels.arrange",
    payload: {
      placements: [
        { panelId: "slot-1", placement: { group: "workspace", col: 1, row: 1, colSpan: 4, rowSpan: 3 } },
        { panelId: "slot-2", placement: { group: "workspace", col: 1, row: 1, colSpan: 2, rowSpan: 2 } }
      ]
    }
  }
]);
const conflict = applyTiledAgentLayoutProposalWithResult(original, conflictProposal, viewport);
assert.equal(conflict.appliedWithChanges, true);
assert.match(conflict.reason ?? "", /충돌/);
assert.equal(agentLayoutApplySucceeded(conflictProposal, conflict), false);

console.log("tiled agent layout tests passed");

function proposal(commands: Array<{
  type: AgentLayoutProposal["commands"][number]["type"];
  payload: Record<string, unknown>;
  target?: { panelId?: string };
}>): AgentLayoutProposal {
  return {
    id: "proposal-test",
    title: "test",
    rationale: "test",
    autoApply: true,
    commands: commands.map((command, index) => ({
      id: `command-${index}`,
      actor: "llm",
      createdAt: "2026-07-11T00:00:00Z",
      ...command
    })),
    createdAt: "2026-07-11T00:00:00Z"
  };
}

function stateWithRects(rects: PanelGridRect[]): TiledPanelState {
  const contents: TiledPanelState["contents"] = {};
  const slots = rects.map((gridRect, index) => {
    const contentId = `content-${index + 1}`;
    contents[contentId] = {
      id: contentId,
      kind: index === 0 ? "chart" : "news",
      title: `Panel ${index + 1}`,
      instanceIndex: index + 1
    };
    return {
      id: `slot-${index + 1}`,
      contentId,
      gridRect,
      rect: { left: 0, top: 0, width: 0, height: 0 },
      minWidth: 1,
      minHeight: 1
    };
  });
  return { slots, contents, nextInstance: rects.length + 1 };
}
