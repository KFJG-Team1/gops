import type { AgentLayoutPanelType, AgentLayoutProposal } from "./agentLayoutTypes";
import {
  addPanelSlotAtGridRect,
  firstAvailablePanelGridRect,
  gridRectsOverlap,
  maxGridSpan,
  minGridSpanForKind,
  movePanelSlotToGridRect,
  normalizeFreeformRectsToGridLayout,
  normalizePanelGridRect,
  normalizeTiledPanelStateToWorkspace,
  panelContentTitle,
  panelGridSpec,
  removePanelSlot,
  replacePanelSlotKind,
  setPanelContentLayoutWeight,
  setPanelContentProps,
  type PanelContentKind,
  type PanelGridRect,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./panelLayout";
import { panelKindForAgentType, panelRegistryEntry } from "./panelRegistry";

const kindToPanelType: Record<PanelContentKind, AgentLayoutPanelType> = {
  chart: "chart",
  compare: "compareChart",
  company: "companyProfile",
  indices: "marketIndices",
  popular: "popularStocks",
  recommendations: "stockRecommendations",
  news: "newsFeed",
  watchlistNews: "newsFeed",
  ontology: "ontologyGraph",
  portfolio: "portfolioHoldings",
  trade: "orderTicket"
};

export function buildTiledAgentLayoutContext(
  state: TiledPanelState,
  viewport: ViewportSize,
  activeSymbol = "",
  selectedPanelId?: string,
  chartDocumentSymbols: Record<string, string | undefined> = {},
  layoutMetrics: WorkspaceLayoutMetrics = {}
) {
  const gridState = normalizeFreeformRectsToGridLayout(state, viewport, layoutMetrics);
  return {
    version: 1,
    ...(selectedPanelId ? { selectedPanelId } : {}),
    panels: gridState.slots.map((slot) => {
      const content = gridState.contents[slot.contentId];
      const kind = content?.kind ?? "chart";
      const documentSymbol = chartDocumentSymbols[slot.id] ?? (content ? chartDocumentSymbols[content.id] : undefined);
      const symbol = kind === "chart" ? (readString(documentSymbol) || readString(content?.props?.symbol) || activeSymbol || "").toUpperCase() : undefined;
      return {
        id: slot.id,
        type: kindToPanelType[kind],
        title: content?.title || panelContentTitle(kind, content?.instanceIndex),
        placement: tiledPlacement(slot.gridRect),
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
    if (command.type === "layout.panel.replace") {
      const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
      next = panelId
        ? replacePanelSlotKind(next, panelId, kind, viewport, {
          symbol: readPanelSymbol(command.payload) ?? undefined,
          layoutWeight: layoutWeightForPanelId(proposal, panelId) ?? readNumber(command.payload.layoutWeight) ?? undefined,
          props: readPanelProps(command.payload)
        }, layoutMetrics)
        : next;
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

function tiledPlacement(gridRect: PanelGridRect) {
  const col = clampInt(gridRect.col, 1, panelGridSpec.cols);
  const row = clampInt(gridRect.row, 1, panelGridSpec.rows);
  const colSpan = clampInt(gridRect.colSpan, 1, panelGridSpec.cols - col + 1);
  const rowSpan = clampInt(gridRect.rowSpan, 1, panelGridSpec.rows - row + 1);
  return {
    group: "workspace",
    zone: col >= 7 ? "context" : col + colSpan - 1 <= 6 ? "main" : "mainContext",
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
  const payloadKind = panelKindForAgentType(payloadPanelType ?? undefined);
  if (payloadKind) {
    return payloadKind;
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
    return Boolean(item.panelType && panelKindForAgentType(item.panelType));
  });
  if (priority?.panelType) {
    return panelKindForAgentType(priority.panelType) ?? null;
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
  const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
  if (panelId && contentForPanelId(state, panelId)) {
    return ensurePanelKind(state, kind, viewport, layoutMetrics, {
      slotId: panelId,
      symbol: readPanelSymbol(command.payload) ?? undefined,
      layoutWeight: layoutWeightForPanelId(proposal, panelId) ?? readNumber(command.payload.layoutWeight) ?? undefined,
      props: readPanelProps(command.payload)
    });
  }
  const symbol = readPanelSymbol(command.payload);
  if (kind === "chart" && symbol && hasChartSymbol(state, symbol)) {
    return state;
  }
  const placement = readPlacement(command.payload.placement);
  const gridRect = placement ?? firstAvailablePanelGridRect(state, kind) ?? defaultPlacementForKind(kind);
  return addPanelSlotAtGridRect(state, kind, gridRect, {
    slotId: panelId ?? undefined,
    symbol: symbol ?? undefined,
    layoutWeight: layoutWeightForPanelId(proposal, panelId) ?? readNumber(command.payload.layoutWeight) ?? undefined,
    props: readPanelProps(command.payload),
    allowOverlap: proposal.commands.some((item) => item.type === "layout.panels.arrange")
  }, viewport, layoutMetrics);
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
  const gridRect = firstAvailablePanelGridRect(state, kind) ?? defaultPlacementForKind(kind);
  return addPanelSlotAtGridRect(state, kind, gridRect, options, viewport, layoutMetrics);
}

function focusPanelKind(state: TiledPanelState, kind: PanelContentKind, viewport: ViewportSize, layoutMetrics: WorkspaceLayoutMetrics): TiledPanelState {
  void viewport;
  void layoutMetrics;
  if (kind === "chart") {
    return state;
  }
  return state;
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
  const gridRectsBySlotId = new Map<string, PanelGridRect>();
  let next = state;
  for (const item of placements) {
    if (!isRecord(item)) {
      continue;
    }
    const panelId = readString(item.panelId);
    const placement = readPlacement(item.placement);
    const slot = panelId ? slotForPanelId(next, panelId) : null;
    const content = slot ? next.contents[slot.contentId] : null;
    if (slot && content && placement?.group === "workspace") {
      gridRectsBySlotId.set(slot.id, normalizePanelGridRect(placement, minGridSpanForKind(content.kind)));
    }
    const layoutWeight = readNumber(item.layoutWeight);
    if (panelId && layoutWeight !== null) {
      next = setPanelLayoutWeight(next, panelId, layoutWeight);
    }
  }
  if (!gridRectsBySlotId.size) {
    return next;
  }
  const nextSlots = next.slots.map((slot) => (
    gridRectsBySlotId.has(slot.id) ? { ...slot, gridRect: gridRectsBySlotId.get(slot.id)! } : slot
  ));
  for (let leftIndex = 0; leftIndex < nextSlots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nextSlots.length; rightIndex += 1) {
      if (gridRectsOverlap(nextSlots[leftIndex]!.gridRect, nextSlots[rightIndex]!.gridRect)) {
        return next;
      }
    }
  }
  return normalizeTiledPanelStateToWorkspace({ ...next, slots: nextSlots }, viewport, layoutMetrics);
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
  return movePanelSlotToGridRect(state, slot.id, placement, viewport, layoutMetrics);
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

function minSpanForKind(kind: PanelContentKind) {
  return minGridSpanForKind(kind);
}

function maxSpanForKind(_kind: PanelContentKind) {
  return maxGridSpan();
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
  return panelRegistryEntry(kind).defaultLayoutWeight;
}

function defaultPlacementForKind(kind: PanelContentKind): AgentPanelPlacement {
  const span = panelRegistryEntry(kind).defaultSpan;
  return { group: "workspace", col: 1, row: 1, colSpan: span.colSpan, rowSpan: span.rowSpan };
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
