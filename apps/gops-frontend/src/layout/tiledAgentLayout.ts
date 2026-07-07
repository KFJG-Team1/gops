import type { AgentLayoutPanelType, AgentLayoutProposal } from "./agentLayoutTypes";
import {
  addPanelSlotAtRect,
  detectPanelBoundaries,
  insertOptionsForBoundary,
  insertPanelAtBoundary,
  normalizeTiledPanelStateToWorkspace,
  panelGutter,
  panelContentTitle,
  removePanelSlot,
  setPanelContentLayoutWeight,
  setPanelContentProps,
  type PanelContentKind,
  type PanelRect,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics,
  workspaceBounds
} from "./panelLayout";

const kindToPanelType: Record<PanelContentKind, AgentLayoutPanelType> = {
  chart: "chart",
  company: "companyProfile",
  indices: "marketIndices",
  popular: "popularStocks",
  news: "newsFeed",
  watchlistNews: "newsFeed",
  ontology: "ontologyGraph",
  portfolio: "portfolioHoldings",
  trade: "orderTicket"
};

const panelTypeToKind: Partial<Record<AgentLayoutPanelType | string, PanelContentKind>> = {
  chart: "chart",
  companyProfile: "company",
  marketIndices: "indices",
  popularStocks: "popular",
  newsFeed: "news",
  ontologyGraph: "ontology",
  portfolioHoldings: "portfolio",
  orderTicket: "trade"
};

export function buildTiledAgentLayoutContext(
  state: TiledPanelState,
  viewport: ViewportSize,
  activeSymbol = "",
  selectedPanelId?: string,
  chartDocumentSymbols: Record<string, string | undefined> = {},
  layoutMetrics: WorkspaceLayoutMetrics = {}
) {
  return {
    version: 1,
    ...(selectedPanelId ? { selectedPanelId } : {}),
    panels: state.slots.map((slot) => {
      const content = state.contents[slot.contentId];
      const kind = content?.kind ?? "chart";
      const documentSymbol = chartDocumentSymbols[slot.id] ?? (content ? chartDocumentSymbols[content.id] : undefined);
      const symbol = kind === "chart" ? (readString(documentSymbol) || readString(content?.props?.symbol) || activeSymbol || "").toUpperCase() : undefined;
      return {
        id: slot.id,
        type: kindToPanelType[kind],
        title: content?.title || panelContentTitle(kind, content?.instanceIndex),
        placement: tiledPlacement(slot.rect, viewport, layoutMetrics),
        layoutPinned: false,
        layoutWeight: content?.layoutWeight ?? defaultLayoutWeightForKind(kind),
        minSpan: minSpanForKind(kind),
        maxSpan: maxSpanForKind(kind),
        ...(symbol ? { symbol, props: { symbol } } : {})
      };
    })
  };
}

export function applyTiledAgentLayoutProposal(
  state: TiledPanelState,
  proposal: AgentLayoutProposal,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  if (proposal.autoApply === false || proposal.commands.length === 0) {
    return state;
  }

  let next = state;
  const hasPlacementCommand = proposal.commands.some((command) =>
    command.type === "layout.panels.arrange" || command.type === "layout.panel.move"
  );
  for (const command of proposal.commands) {
    if (command.type === "layout.panel.remove") {
      const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
      next = panelId ? removePanelSlot(next, panelId, viewport, layoutMetrics) : next;
      continue;
    }
    const kind = targetKindForCommand(next, command, proposal);
    if (!kind) {
      continue;
    }
    if (command.type === "layout.panel.add") {
      next = addPanelForCommand(next, kind, command, proposal, viewport, layoutMetrics);
      continue;
    }
    if (command.type === "layout.panel.props.update") {
      next = applyPanelPropsUpdate(next, command);
      continue;
    }
    if (command.type === "layout.panels.arrange") {
      next = applyArrangement(next, command.payload.placements, viewport, layoutMetrics);
      continue;
    }
    if (command.type === "layout.panel.move") {
      const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
      const placement = readPlacement(command.payload.placement);
      next = panelId && placement ? applyPanelPlacement(next, panelId, placement, viewport, layoutMetrics) : next;
      continue;
    }
    if (command.type === "layout.panel.priority.set") {
      next = applyPrioritySet(next, command);
      if (!hasPlacementCommand) {
        next = focusPanelKind(next, kind, viewport, layoutMetrics);
      }
    }
  }
  return normalizeTiledPanelStateToWorkspace(next, viewport, layoutMetrics);
}

function tiledPlacement(rect: TiledPanelState["slots"][number]["rect"], viewport: ViewportSize, layoutMetrics: WorkspaceLayoutMetrics) {
  const grid = tiledGrid(viewport, layoutMetrics);
  const col = clampInt(Math.floor((rect.left - grid.left) / grid.stepX) + 1, 1, 4);
  const row = clampInt(Math.floor((rect.top - grid.top) / grid.stepY) + 1, 1, 5);
  const colSpan = clampInt(Math.round((rect.width + grid.gutter) / grid.stepX), 1, 4 - col + 1);
  const rowSpan = clampInt(Math.round((rect.height + grid.gutter) / grid.stepY), 1, 5 - row + 1);
  return {
    group: "workspace",
    zone: col === 4 && colSpan === 1 ? "context" : col + colSpan - 1 <= 3 ? "main" : "mainContext",
    col,
    row,
    colSpan,
    rowSpan
  };
}

function targetKindForCommand(
  state: TiledPanelState,
  command: AgentLayoutProposal["commands"][number],
  proposal: AgentLayoutProposal
): PanelContentKind | null {
  const payloadPanelType = readString(command.payload.panelType);
  if (payloadPanelType && panelTypeToKind[payloadPanelType]) {
    return panelTypeToKind[payloadPanelType] ?? null;
  }

  const panelId = readString(command.target?.panelId) ?? readString(command.payload.panelId);
  if (panelId) {
    const content = contentForPanelId(state, panelId);
    if (content) {
      return content.kind;
    }
  }

  const priority = proposal.panelPriorities?.find((item) => {
    if (panelId && item.panelId === panelId) {
      return true;
    }
    return item.panelType && panelTypeToKind[item.panelType];
  });
  if (priority?.panelType) {
    return panelTypeToKind[priority.panelType] ?? null;
  }
  return null;
}

function addPanelForCommand(
  state: TiledPanelState,
  kind: PanelContentKind,
  command: AgentLayoutProposal["commands"][number],
  proposal: AgentLayoutProposal,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): TiledPanelState {
  if (kind === "chart") {
    const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
    if (panelId && contentForPanelId(state, panelId)) {
      return state;
    }
    const symbol = readPanelSymbol(command.payload);
    if (symbol && hasChartSymbol(state, symbol)) {
      return state;
    }
    const placement = readPlacement(command.payload.placement) ?? defaultPlacementForKind(kind);
    const priority = layoutWeightForPanelId(proposal, panelId) ?? readNumber(command.payload.layoutWeight) ?? defaultLayoutWeightForKind(kind);
    return addPanelSlotAtRect(state, kind, rectForPlacement(placement, viewport, layoutMetrics), {
      slotId: panelId ?? undefined,
      symbol: symbol ?? undefined,
      layoutWeight: priority
    }, viewport, layoutMetrics);
  }
  const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
  return ensurePanelKind(state, kind, viewport, layoutMetrics, {
    slotId: panelId ?? undefined,
    symbol: readPanelSymbol(command.payload) ?? undefined,
    layoutWeight: layoutWeightForPanelId(proposal, panelId) ?? readNumber(command.payload.layoutWeight) ?? undefined,
    props: readPanelProps(command.payload)
  });
}

function ensurePanelKind(
  state: TiledPanelState,
  kind: PanelContentKind,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics,
  options: { slotId?: string; symbol?: string; layoutWeight?: number; props?: Record<string, unknown> } = {}
): TiledPanelState {
  if (hasPanelKind(state, kind)) {
    const focused = focusPanelKind(state, kind, viewport, layoutMetrics);
    const slot = focused.slots.find((item) => focused.contents[item.contentId]?.kind === kind);
    if (!slot) {
      return focused;
    }
    let next = focused;
    if (options.props) {
      next = setPanelContentProps(next, slot.contentId, options.props);
    }
    if (options.symbol) {
      next = setPanelContentProps(next, slot.contentId, { ...(next.contents[slot.contentId]?.props ?? {}), symbol: options.symbol, timeframe: "1D" });
    }
    if (options.layoutWeight !== undefined) {
      next = setPanelContentLayoutWeight(next, slot.contentId, options.layoutWeight);
    }
    return next;
  }
  for (const boundary of detectPanelBoundaries(state, viewport, layoutMetrics)) {
    if (!insertOptionsForBoundary(state, boundary.id, viewport, layoutMetrics).some((option) => option.kind === kind)) {
      continue;
    }
    return insertPanelAtBoundary(state, boundary.id, kind, viewport, options, layoutMetrics);
  }
  return state;
}

function focusPanelKind(state: TiledPanelState, kind: PanelContentKind, viewport: ViewportSize, layoutMetrics: WorkspaceLayoutMetrics): TiledPanelState {
  if (kind === "chart") {
    return state;
  }
  const targetSlot = state.slots.find((slot) => state.contents[slot.contentId]?.kind === kind);
  const firstSupportSlot = state.slots.find((slot) => state.contents[slot.contentId]?.kind !== "chart");
  if (!targetSlot || !firstSupportSlot) {
    return state;
  }
  const emphasized = emphasizeSupportPanel(state, targetSlot.id, viewport, layoutMetrics);
  if (emphasized !== state) {
    return emphasized;
  }
  if (targetSlot.id === firstSupportSlot.id) {
    return state;
  }
  return {
    ...state,
    slots: state.slots.map((slot) => {
      if (slot.id === targetSlot.id) {
        return { ...slot, rect: { ...firstSupportSlot.rect } };
      }
      if (slot.id === firstSupportSlot.id) {
        return { ...slot, rect: { ...targetSlot.rect } };
      }
      return slot;
    })
  };
}

type AgentPanelPlacement = {
  group?: string;
  zone?: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

function applyArrangement(state: TiledPanelState, placements: unknown, viewport: ViewportSize, layoutMetrics: WorkspaceLayoutMetrics): TiledPanelState {
  if (!Array.isArray(placements)) {
    return state;
  }
  return placements.reduce((next, item) => {
    if (!isRecord(item)) {
      return next;
    }
    const panelId = readString(item.panelId);
    const placement = readPlacement(item.placement);
    const arranged = panelId && placement ? applyPanelPlacement(next, panelId, placement, viewport, layoutMetrics) : next;
    const layoutWeight = readNumber(item.layoutWeight);
    return panelId && layoutWeight !== null ? setPanelLayoutWeight(arranged, panelId, layoutWeight) : arranged;
  }, state);
}

function applyPanelPlacement(
  state: TiledPanelState,
  panelId: string,
  placement: AgentPanelPlacement,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): TiledPanelState {
  const slot = state.slots.find((item) => item.id === panelId || item.contentId === panelId);
  if (!slot || placement.group !== "workspace") {
    return state;
  }
  const rect = rectForPlacement(placement, viewport, layoutMetrics);
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    slots: state.slots.map((item) => item.id === slot.id ? { ...item, rect } : item)
  }, viewport, layoutMetrics);
}

function rectForPlacement(placement: AgentPanelPlacement, viewport: ViewportSize, layoutMetrics: WorkspaceLayoutMetrics): PanelRect {
  const grid = tiledGrid(viewport, layoutMetrics);
  const col = clampInt(placement.col, 1, 4);
  const row = clampInt(placement.row, 1, 5);
  const colSpan = clampInt(placement.colSpan, 1, 4 - col + 1);
  const rowSpan = clampInt(placement.rowSpan, 1, 5 - row + 1);
  return {
    left: grid.left + (col - 1) * grid.stepX,
    top: grid.top + (row - 1) * grid.stepY,
    width: colSpan * grid.cellWidth + Math.max(0, colSpan - 1) * grid.gutter,
    height: rowSpan * grid.cellHeight + Math.max(0, rowSpan - 1) * grid.gutter
  };
}

function applyPanelPropsUpdate(
  state: TiledPanelState,
  command: AgentLayoutProposal["commands"][number]
): TiledPanelState {
  const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
  if (!panelId) {
    return state;
  }
  const slot = slotForPanelId(state, panelId);
  if (!slot) {
    return state;
  }
  let next = state;
  const props = isRecord(command.payload.props) ? command.payload.props : command.payload;
  if (isRecord(command.payload.props)) {
    next = setPanelContentProps(next, slot.contentId, command.payload.props);
  }
  const layoutWeight = readNumber(command.payload.layoutWeight) ?? readNumber(props.layoutWeight);
  if (layoutWeight !== null) {
    next = setPanelContentLayoutWeight(next, slot.contentId, layoutWeight);
  }
  return next;
}

function applyPrioritySet(
  state: TiledPanelState,
  command: AgentLayoutProposal["commands"][number]
): TiledPanelState {
  const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
  const layoutWeight = readNumber(command.payload.layoutWeight);
  return panelId && layoutWeight !== null ? setPanelLayoutWeight(state, panelId, layoutWeight) : state;
}

function setPanelLayoutWeight(state: TiledPanelState, panelId: string, layoutWeight: number): TiledPanelState {
  const slot = slotForPanelId(state, panelId);
  return slot ? setPanelContentLayoutWeight(state, slot.contentId, layoutWeight) : state;
}

function emphasizeSupportPanel(
  state: TiledPanelState,
  targetSlotId: string,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): TiledPanelState {
  const targetSlot = state.slots.find((slot) => slot.id === targetSlotId);
  const supportSlots = state.slots
    .filter((slot) => state.contents[slot.contentId]?.kind !== "chart")
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
  if (!targetSlot || supportSlots.length < 2 || !supportSlots.some((slot) => slot.id === targetSlot.id)) {
    return state;
  }

  const workspace = workspaceBounds(viewport, layoutMetrics);
  const gutter = panelGutter(viewport);
  const supportTop = Math.min(...supportSlots.map((slot) => slot.rect.top));
  const supportBottom = Math.max(...supportSlots.map((slot) => slot.rect.top + slot.rect.height));
  const supportLeft = workspace.left + gutter;
  const supportRight = workspace.left + workspace.width - gutter;
  const supportWidth = Math.max(1, supportRight - supportLeft);
  const supportHeight = Math.max(targetSlot.minHeight, supportBottom - supportTop);
  const others = supportSlots.filter((slot) => slot.id !== targetSlot.id);
  const targetWidth = Math.min(
    supportWidth - gutter - others.length * targetSlot.minWidth,
    Math.max(targetSlot.minWidth, Math.round(supportWidth * 0.52))
  );
  const remainingWidth = supportWidth - targetWidth - gutter;
  const otherWidth = others.length > 0
    ? (remainingWidth - gutter * Math.max(0, others.length - 1)) / others.length
    : 0;
  if (targetWidth < targetSlot.minWidth || others.some((slot) => otherWidth < slot.minWidth)) {
    return state;
  }

  const rectBySlotId = new Map<string, PanelRect>();
  rectBySlotId.set(targetSlot.id, {
    left: supportLeft,
    top: supportTop,
    width: targetWidth,
    height: supportHeight
  });
  others.forEach((slot, index) => {
    rectBySlotId.set(slot.id, {
      left: supportLeft + targetWidth + gutter + index * (otherWidth + gutter),
      top: supportTop,
      width: otherWidth,
      height: supportHeight
    });
  });

  return {
    ...state,
    slots: state.slots.map((slot) => {
      const rect = rectBySlotId.get(slot.id);
      return rect ? { ...slot, rect } : slot;
    })
  };
}

function tiledGrid(viewport: ViewportSize, layoutMetrics: WorkspaceLayoutMetrics) {
  const workspace = workspaceBounds(viewport, layoutMetrics);
  const gutter = panelGutter(viewport);
  const cellWidth = Math.max(1, (workspace.width - gutter * 5) / 4);
  const cellHeight = Math.max(1, (workspace.height - gutter * 6) / 5);
  return {
    left: workspace.left + gutter,
    top: workspace.top + gutter,
    gutter,
    cellWidth,
    cellHeight,
    stepX: cellWidth + gutter,
    stepY: cellHeight + gutter
  };
}

function minSpanForKind(kind: PanelContentKind) {
  if (kind === "chart") {
    return { colSpan: 2, rowSpan: 2 };
  }
  if (kind === "portfolio" || kind === "trade") {
    return { colSpan: 1, rowSpan: 2 };
  }
  return { colSpan: 1, rowSpan: 1 };
}

function maxSpanForKind(_kind: PanelContentKind) {
  return { colSpan: 4, rowSpan: 5 };
}

function hasPanelKind(state: TiledPanelState, kind: PanelContentKind): boolean {
  return state.slots.some((slot) => state.contents[slot.contentId]?.kind === kind);
}

function contentForPanelId(state: TiledPanelState, panelId: string) {
  const slot = slotForPanelId(state, panelId);
  return slot ? state.contents[slot.contentId] : null;
}

function slotForPanelId(state: TiledPanelState, panelId: string) {
  return state.slots.find((item) => item.id === panelId || item.contentId === panelId);
}

function hasChartSymbol(state: TiledPanelState, symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return state.slots.some((slot) => {
    const content = state.contents[slot.contentId];
    return content?.kind === "chart" && readString(content.props?.symbol)?.toUpperCase() === normalized;
  });
}

function readPanelSymbol(payload: Record<string, unknown>): string | null {
  const props = isRecord(payload.props) ? payload.props : null;
  return readString(props?.symbol) ?? readString(payload.symbol);
}

function readPanelProps(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(payload.props) ? payload.props : undefined;
}

function layoutWeightForPanelId(proposal: AgentLayoutProposal, panelId: string | null): number | null {
  if (!panelId) {
    return null;
  }
  const priority = proposal.panelPriorities?.find((item) => item.panelId === panelId);
  return priority ? priority.layoutWeight : null;
}

function defaultLayoutWeightForKind(kind: PanelContentKind): number {
  if (kind === "chart") {
    return 100;
  }
  if (kind === "portfolio" || kind === "trade") {
    return 35;
  }
  return 50;
}

function defaultPlacementForKind(kind: PanelContentKind): AgentPanelPlacement {
  if (kind === "chart") {
    return { group: "workspace", col: 1, row: 4, colSpan: 4, rowSpan: 2 };
  }
  return { group: "workspace", col: 4, row: 1, colSpan: 1, rowSpan: 1 };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readPlacement(value: unknown): AgentPanelPlacement | null {
  if (!isRecord(value)) {
    return null;
  }
  const group = readString(value.group);
  const col = readNumber(value.col);
  const row = readNumber(value.row);
  const colSpan = readNumber(value.colSpan);
  const rowSpan = readNumber(value.rowSpan);
  if (!group || col === null || row === null || colSpan === null || rowSpan === null) {
    return null;
  }
  return {
    group,
    zone: readString(value.zone) ?? undefined,
    col,
    row,
    colSpan,
    rowSpan
  };
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
