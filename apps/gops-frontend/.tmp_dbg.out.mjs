// src/layout/panelRegistry.ts
var panelRegistry = [
  {
    kind: "chart",
    title: "\uCC28\uD2B8",
    agentPanelType: "chart",
    minSpan: { colSpan: 2, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 100
  },
  {
    kind: "compare",
    title: "\uBE44\uAD50",
    agentPanelType: "compareChart",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 80
  },
  {
    kind: "news",
    title: "\uB274\uC2A4 \uCE74\uB4DC",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 190 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "newsList",
    title: "\uB274\uC2A4 \uBAA9\uB85D",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "watchlistNews",
    title: "\uAD00\uC2EC\uC885\uBAA9 \uB274\uC2A4 \uCE74\uB4DC",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "watchlistNewsList",
    title: "\uAD00\uC2EC\uC885\uBAA9 \uB274\uC2A4 \uBAA9\uB85D",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "ontology",
    title: "\uC628\uD1A8\uB85C\uC9C0",
    agentPanelType: "ontologyGraph",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "indices",
    title: "\uC9C0\uC218",
    agentPanelType: "marketIndices",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 1, rowSpan: 1 },
    minSizePx: { width: 150, height: 100 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "popular",
    title: "\uC778\uAE30\uC885\uBAA9",
    agentPanelType: "popularStocks",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "recommendations",
    title: "\uCD94\uCC9C",
    agentPanelType: "stockRecommendations",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 45
  },
  {
    kind: "themeRadar",
    title: "\uBD84\uC57C\uCD94\uCC9C",
    agentPanelType: "themeRadar",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 2 },
    defaultLayoutWeight: 58
  },
  {
    kind: "company",
    title: "\uAE30\uC5C5\uC815\uBCF4",
    agentPanelType: "companyProfile",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "companyMulti",
    title: "\uAE30\uC5C5 \uBA40\uD2F0",
    agentPanelType: "companyMulti",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 72
  },
  {
    kind: "companyValuation",
    title: "\uAC00\uCE58\uD3C9\uAC00",
    agentPanelType: "companyValuation",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 58
  },
  {
    kind: "companyProfitability",
    title: "\uC218\uC775\uC131",
    agentPanelType: "companyProfitability",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 3 },
    defaultLayoutWeight: 58
  },
  {
    kind: "companyStability",
    title: "\uC548\uC815\uC131",
    agentPanelType: "companyStability",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 3 },
    defaultLayoutWeight: 58
  },
  {
    kind: "portfolio",
    title: "Portfolio Legacy",
    agentPanelType: "portfolioDashboard",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 35,
    insertable: false
  },
  {
    kind: "portfolioMulti",
    title: "Dual Portfolio",
    agentPanelType: "portfolioMulti",
    minSpan: { colSpan: 2, rowSpan: 3 },
    readableMinSpan: { colSpan: 2, rowSpan: 3 },
    minSizePx: { width: 320, height: 330 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    maxSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 90
  },
  {
    kind: "portfolioInvestment",
    title: "US Portfolio",
    agentPanelType: "portfolioInvestment",
    minSpan: { colSpan: 2, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 210 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 38
  },
  {
    kind: "portfolioPerformance",
    title: "Performance",
    agentPanelType: "portfolioPerformance",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 2 },
    defaultLayoutWeight: 42
  },
  {
    kind: "portfolioInvested",
    title: "Invested",
    agentPanelType: "portfolioInvested",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 36
  },
  {
    kind: "portfolioDividend",
    title: "Dividend",
    agentPanelType: "portfolioDividend",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 2 },
    defaultLayoutWeight: 34
  },
  {
    kind: "portfolioDiversification",
    title: "Diversification",
    agentPanelType: "portfolioDiversification",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 36
  },
  {
    kind: "portfolioHoldings",
    title: "Holdings \uD45C",
    agentPanelType: "portfolioHoldings",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 5, rowSpan: 3 },
    defaultLayoutWeight: 40
  },
  {
    kind: "portfolioHoldingsCards",
    title: "Holdings \uCE74\uB4DC",
    agentPanelType: "portfolioHoldingsCards",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 39
  },
  {
    kind: "orderFlow",
    title: "\uC624\uB354\uD50C\uB85C\uC6B0",
    agentPanelType: "orderFlowProfile",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 45
  },
  {
    kind: "trade",
    title: "\uC8FC\uBB38",
    agentPanelType: "orderTicket",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 280, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 35
  }
];
function panelRegistryEntry(kind) {
  return panelRegistry.find((entry) => entry.kind === kind) ?? panelRegistry[0];
}

// src/layout/workspaceMetrics.ts
var bottomNavigationHeight = 64;
var navigationGap = 0;
var treeMapHoverMetaReserve = 0;
var workspaceBottomInset = bottomNavigationHeight + treeMapHoverMetaReserve + navigationGap;

// src/layout/panelLayout.ts
var panelGridSpec = {
  cols: 8,
  rows: 6
};
var insertablePanelKinds = panelRegistry.filter((entry) => entry.insertable !== false).map((entry) => entry.kind);
function normalizePanelGridRect(gridRect, minSpan = { colSpan: 1, rowSpan: 1 }) {
  const colSpan = clampInt(gridRect.colSpan, minSpan.colSpan, panelGridSpec.cols);
  const rowSpan = clampInt(gridRect.rowSpan, minSpan.rowSpan, panelGridSpec.rows);
  const col = clampInt(gridRect.col, 1, panelGridSpec.cols - colSpan + 1);
  const row = clampInt(gridRect.row, 1, panelGridSpec.rows - rowSpan + 1);
  return { col, row, colSpan, rowSpan };
}
function minGridSpanForKind(kind) {
  return panelRegistryEntry(kind).minSpan;
}
function gridRectsOverlap(left, right) {
  return left.col < right.col + right.colSpan && left.col + left.colSpan > right.col && left.row < right.row + right.rowSpan && left.row + left.rowSpan > right.row;
}
function resolvePanelMoveWithPush(state, slotId, targetGridRect) {
  const source = state.slots.find((item) => item.id === slotId);
  const kind = source ? state.contents[source.contentId]?.kind : null;
  const fallbackGridRect = normalizePanelGridRect(targetGridRect);
  if (!source || !kind) {
    return {
      valid: false,
      sourceSlotId: slotId,
      sourceGridRect: fallbackGridRect,
      pushedSlots: [],
      reason: "source-not-found"
    };
  }
  const sourceGridRect = normalizePanelGridRect(targetGridRect, minGridSpanForKind(kind));
  if (!gridRectEquals(sourceGridRect, targetGridRect)) {
    return {
      valid: false,
      sourceSlotId: source.id,
      sourceGridRect,
      pushedSlots: [],
      reason: "invalid-target-grid-rect"
    };
  }
  const rows = panelGridSpec.rows;
  const positions = /* @__PURE__ */ new Map();
  for (const slot of state.slots) {
    if (slot.id !== source.id) {
      positions.set(slot.id, slot.gridRect);
    }
  }
  const queue = [sourceGridRect];
  const maxIterations = state.slots.length * (rows + 2) + 16;
  let guard = 0;
  while (queue.length > 0) {
    if (guard++ > maxIterations) {
      return {
        valid: false,
        sourceSlotId: source.id,
        sourceGridRect,
        pushedSlots: [],
        reason: "push-loop"
      };
    }
    const mover = queue.shift();
    for (const [id, rect] of [...positions]) {
      if (!gridRectsOverlap(mover, rect)) {
        continue;
      }
      const pushed = { ...rect, row: mover.row + mover.rowSpan };
      if (gridRectRowEnd(pushed) > rows + 1) {
        return {
          valid: false,
          sourceSlotId: source.id,
          sourceGridRect,
          pushedSlots: [],
          reason: "no-room"
        };
      }
      positions.set(id, pushed);
      queue.push(pushed);
    }
  }
  const pushedSlots = [];
  for (const slot of state.slots) {
    if (slot.id === source.id) {
      continue;
    }
    const next = positions.get(slot.id);
    if (!gridRectEquals(next, slot.gridRect)) {
      pushedSlots.push({ slotId: slot.id, previousGridRect: slot.gridRect, gridRect: next });
    }
  }
  const finalSlots = state.slots.map((slot) => slot.id === source.id ? { ...slot, gridRect: sourceGridRect } : { ...slot, gridRect: positions.get(slot.id) });
  if (layoutGridRectsOverlap(finalSlots)) {
    return {
      valid: false,
      sourceSlotId: source.id,
      sourceGridRect,
      pushedSlots,
      reason: "collision"
    };
  }
  return { valid: true, sourceSlotId: source.id, sourceGridRect, pushedSlots };
}
function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
function gridRectRowEnd(rect) {
  return rect.row + rect.rowSpan;
}
function gridRectEquals(left, right) {
  return left.col === right.col && left.row === right.row && left.colSpan === right.colSpan && left.rowSpan === right.rowSpan;
}
function layoutGridRectsOverlap(slots) {
  for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex += 1) {
      if (gridRectsOverlap(slots[leftIndex].gridRect, slots[rightIndex].gridRect)) {
        return true;
      }
    }
  }
  return false;
}

// .tmp_dbg.ts
function stateWithRects(rects) {
  const contents = {};
  const slots = rects.map((g, i) => {
    const c2 = `content-block-${i + 1}`;
    contents[c2] = { id: c2, kind: "news", title: `B${i + 1}`, instanceIndex: i + 1 };
    return { id: `slot-block-${i + 1}`, contentId: c2, gridRect: g, rect: { left: 0, top: 0, width: 0, height: 0 }, minWidth: 0, minHeight: 0 };
  });
  return { slots, contents, nextInstance: rects.length + 1 };
}
console.log("news min span:", JSON.stringify(minGridSpanForKind("news")));
var s = stateWithRects([{ col: 1, row: 1, colSpan: 2, rowSpan: 2 }, { col: 1, row: 3, colSpan: 2, rowSpan: 2 }]);
console.log("overlap:", JSON.stringify(resolvePanelMoveWithPush(s, "slot-block-1", { col: 1, row: 3, colSpan: 2, rowSpan: 2 })));
var c = stateWithRects([{ col: 1, row: 1, colSpan: 2, rowSpan: 2 }, { col: 1, row: 3, colSpan: 2, rowSpan: 1 }, { col: 1, row: 4, colSpan: 2, rowSpan: 1 }]);
console.log("cascade:", JSON.stringify(resolvePanelMoveWithPush(c, "slot-block-1", { col: 1, row: 2, colSpan: 2, rowSpan: 2 })));
