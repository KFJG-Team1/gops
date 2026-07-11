import type { AgentLayoutPanelType, AgentLayoutProposal } from "./agentLayoutTypes";
import {
  addPanelSlotAtGridRect,
  firstAvailablePanelGridRect,
  gridRectsOverlap,
  layoutHasGapsOrOverlaps,
  maxGridSpanForKind,
  movePanelSlotToGridRect,
  normalizeFreeformRectsToGridLayout,
  normalizePanelGridRect,
  normalizeTiledPanelStateToWorkspace,
  panelContentTitle,
  panelGridSpec,
  readableMinGridSpanForKind,
  removePanelSlot,
  replacePanelSlotKind,
  setPanelContentLayoutWeight,
  setPanelContentProps,
  setPanelSlotPinned,
  type PanelContentKind,
  type PanelGridRect,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./panelLayout";
import { panelKindForAgentType, panelRegistry, panelRegistryEntry } from "./panelRegistry";

const kindToPanelType: Record<PanelContentKind, AgentLayoutPanelType> = {
  chart: "chart",
  compare: "compareChart",
  company: "companyProfile",
  companyMulti: "companyMulti",
  companyValuation: "companyValuation",
  companyProfitability: "companyProfitability",
  companyStability: "companyStability",
  indices: "marketIndices",
  popular: "popularStocks",
  recommendations: "stockRecommendations",
  recommendationsList: "stockRecommendations",
  themeRadar: "themeRadar",
  news: "newsFeed",
  newsList: "newsFeed",
  watchlistNews: "newsFeed",
  watchlistNewsList: "newsFeed",
  ontology: "ontologyGraph",
  portfolio: "portfolioDashboard",
  portfolioMulti: "portfolioMulti",
  portfolioInvestment: "portfolioInvestment",
  portfolioPerformance: "portfolioPerformance",
  portfolioInvested: "portfolioInvested",
  portfolioDividend: "portfolioDividend",
  portfolioDiversification: "portfolioDiversification",
  portfolioHoldings: "portfolioHoldings",
  portfolioHoldingsCards: "portfolioHoldingsCards",
  orderFlow: "orderFlowProfile",
  chartCommentary: "chartCommentary",
  chartAssetOps: "chartAssetOps",
  trade: "orderTicket"
};

export type PlacementPickCandidate = {
  id: string;
  label: string;
  placement: AgentPanelPlacement;
  arrangement: unknown[];
};

export type PendingPlacementPick = {
  panelType: AgentLayoutPanelType | string;
  panelId?: string;
  symbol?: string;
  candidates: PlacementPickCandidate[];
};

export type ApplyTiledAgentLayoutResult = {
  state: TiledPanelState;
  pendingPlacementPick?: PendingPlacementPick;
  stateChanged?: boolean;
  appliedWithChanges?: boolean;
  reason?: string;
  requestedSaveName?: string;
};

export type ApplyTiledAgentLayoutOptions = {
  undoState?: TiledPanelState;
  defaultState?: TiledPanelState;
};

export function agentLayoutApplySucceeded(
  proposal: AgentLayoutProposal,
  result: ApplyTiledAgentLayoutResult
): boolean {
  return proposal.autoApply !== false
    && proposal.commands.length > 0
    && !result.pendingPlacementPick
    && !result.reason;
}

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
    version: 2,
    grid: panelGridSpec,
    panelCatalog: buildAgentPanelCatalog(),
    ...(selectedPanelId ? { selectedPanelId } : {}),
    panels: gridState.slots.map((slot) => {
      const content = gridState.contents[slot.contentId];
      const kind = content?.kind ?? "chart";
      const documentSymbol = chartDocumentSymbols[slot.id] ?? (content ? chartDocumentSymbols[content.id] : undefined);
      const symbol = kind === "chart" || kind === "orderFlow"
        ? (readString(documentSymbol) || readString(content?.props?.symbol) || activeSymbol || "").toUpperCase()
        : undefined;
      return {
        id: slot.id,
        type: kindToPanelType[kind],
        title: content?.title || panelContentTitle(kind, content?.instanceIndex),
        placement: tiledPlacement(slot.gridRect),
        layoutPinned: Boolean(slot.layoutPinned),
        layoutWeight: content?.layoutWeight ?? defaultLayoutWeightForKind(kind),
        minSpan: minSpanForKind(kind),
        maxSpan: maxSpanForKind(kind),
        ...(symbol ? { symbol, props: { symbol } } : {})
      };
    })
  };
}

/**
 * Size/priority constraints for every insertable panel type, sourced from the
 * panel registry so the agent backend never has to hardcode them. The backend
 * placement engine (panel_spec_for) prefers this catalog over its mirror table.
 */
function buildAgentPanelCatalog() {
  const seen = new Set<string>();
  const catalog: Array<{
    panelType: AgentLayoutPanelType;
    title: string;
    minSpan: { colSpan: number; rowSpan: number };
    defaultSpan: { colSpan: number; rowSpan: number };
    maxSpan?: { colSpan: number; rowSpan: number };
    layoutWeight: number;
  }> = [];
  for (const entry of panelRegistry) {
    if (entry.insertable === false || seen.has(entry.agentPanelType)) {
      continue;
    }
    seen.add(entry.agentPanelType);
    catalog.push({
      panelType: entry.agentPanelType,
      title: entry.title,
      minSpan: { ...entry.readableMinSpan },
      defaultSpan: { ...entry.defaultSpan },
      ...(entry.maxSpan ? { maxSpan: { ...entry.maxSpan } } : {}),
      layoutWeight: entry.defaultLayoutWeight
    });
  }
  return catalog;
}

export function applyTiledAgentLayoutProposal(
  state: TiledPanelState,
  proposal: AgentLayoutProposal,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {},
  options: ApplyTiledAgentLayoutOptions = {}
): TiledPanelState {
  return applyTiledAgentLayoutProposalWithResult(state, proposal, viewport, layoutMetrics, options).state;
}

export function applyTiledAgentLayoutProposalWithResult(
  state: TiledPanelState,
  proposal: AgentLayoutProposal,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {},
  options: ApplyTiledAgentLayoutOptions = {}
): ApplyTiledAgentLayoutResult {
  const pendingPlacementPick = readPendingPlacementPick(proposal);
  if (pendingPlacementPick) {
    return { state, pendingPlacementPick };
  }
  if (proposal.autoApply === false || proposal.commands.length === 0) {
    return { state };
  }

  let next = state;
  let requestedSaveName: string | undefined;
  const feedbackReasons: string[] = [];
  const hasPlacementCommand = proposal.commands.some((command) =>
    command.type === "layout.panels.arrange" || command.type === "layout.panel.move"
  );
  for (const command of proposal.commands) {
    if (command.type === "layout.undo") {
      if (options.undoState) {
        next = options.undoState;
      } else {
        feedbackReasons.push("되돌릴 레이아웃 기록이 없습니다.");
      }
      continue;
    }
    if (command.type === "layout.default.restore" || command.type === "layout.reset") {
      if (options.defaultState) {
        next = options.defaultState;
      } else {
        feedbackReasons.push("기본 레이아웃 상태를 불러오지 못했습니다.");
      }
      continue;
    }
    if (command.type === "layout.save") {
      requestedSaveName = readString(command.payload.presetName) ?? readString(command.payload.name) ?? undefined;
      continue;
    }
    if (command.type === "layout.panel.remove") {
      const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
      next = panelId ? removePanelSlot(next, panelId, viewport, layoutMetrics) : next;
      continue;
    }
    if (command.type === "layout.panel.pin" || command.type === "layout.panel.unpin") {
      const panelId = readString(command.payload.panelId) ?? readString(command.target?.panelId);
      next = panelId ? setPanelSlotPinned(next, panelId, command.type === "layout.panel.pin") : next;
      continue;
    }
    if (command.type === "layout.reflow") {
      continue;
    }
    if (command.type === "layout.panels.arrange") {
      const arrangement = applyArrangement(next, command.payload.placements, viewport, layoutMetrics);
      next = arrangement.state;
      if (arrangement.reason) {
        feedbackReasons.push(arrangement.reason);
      }
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
  const normalized = normalizeTiledPanelStateToWorkspace(next, viewport, layoutMetrics);
  const stateChanged = !samePanelState(state, normalized);
  return {
    state: normalized,
    stateChanged,
    ...(feedbackReasons.length ? { appliedWithChanges: true, reason: [...new Set(feedbackReasons)].join(" ") } : {}),
    ...(requestedSaveName ? { requestedSaveName } : {})
  };
}

export function applyPlacementPickCandidate(
  state: TiledPanelState,
  pick: PendingPlacementPick,
  candidate: PlacementPickCandidate,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const kind = panelKindForAgentType(pick.panelType);
  if (!kind) {
    return state;
  }
  const panelId = pick.panelId;
  const now = new Date().toISOString();
  const proposal: AgentLayoutProposal = {
    id: `placement-pick-${candidate.id}`,
    title: "Placement picker",
    rationale: candidate.label,
    autoApply: true,
    panelPriorities: panelId ? [{ panelId, panelType: pick.panelType, layoutWeight: 120 }] : undefined,
    commands: [
      {
        id: `placement-pick-add-${candidate.id}`,
        type: "layout.panel.add",
        actor: "llm",
        payload: {
          panelId,
          panelType: pick.panelType,
          placement: candidate.placement,
          props: pick.symbol ? { symbol: pick.symbol } : undefined,
          symbol: pick.symbol,
          layoutWeight: 120
        },
        target: panelId ? { panelId } : undefined,
        createdAt: now
      },
      {
        id: `placement-pick-arrange-${candidate.id}`,
        type: "layout.panels.arrange",
        actor: "llm",
        payload: { placements: candidate.arrangement },
        target: panelId ? { panelId } : undefined,
        createdAt: now
      }
    ],
    createdAt: now
  };
  return applyTiledAgentLayoutProposal(state, proposal, viewport, layoutMetrics);
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
  const minimumSpan = readableMinGridSpanForKind(kind);
  const gridRect = normalizePanelGridRect(
    placement ?? firstAvailablePanelGridRect(state, kind) ?? defaultPlacementForKind(kind),
    minimumSpan
  );
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

export type AgentPanelPlacement = {
  group?: string;
  zone?: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

function applyArrangement(
  state: TiledPanelState,
  placements: unknown,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): { state: TiledPanelState; reason?: string } {
  if (!Array.isArray(placements)) {
    return { state, reason: "패널 배치 정보가 올바르지 않아 적용하지 않았습니다." };
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
      gridRectsBySlotId.set(slot.id, normalizePanelGridRect(placement, readableMinGridSpanForKind(content.kind)));
    }
    const layoutWeight = readNumber(item.layoutWeight);
    if (panelId && layoutWeight !== null) {
      next = setPanelLayoutWeight(next, panelId, layoutWeight);
    }
  }
  if (!gridRectsBySlotId.size) {
    return { state: next, reason: "적용할 수 있는 패널 배치를 찾지 못했습니다." };
  }
  const skippedIds = new Set<string>();
  const acceptedSlotIds = new Set(gridRectsBySlotId.keys());
  const arrangedSlots = next.slots.map((slot) => (
    gridRectsBySlotId.has(slot.id) ? { ...slot, gridRect: gridRectsBySlotId.get(slot.id)! } : slot
  ));
  for (let leftIndex = 0; leftIndex < arrangedSlots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < arrangedSlots.length; rightIndex += 1) {
      const left = arrangedSlots[leftIndex]!;
      const right = arrangedSlots[rightIndex]!;
      if (gridRectsOverlap(left.gridRect, right.gridRect)) {
        const skipId = gridRectsBySlotId.has(right.id) ? right.id : left.id;
        acceptedSlotIds.delete(skipId);
        skippedIds.add(skipId);
        console.warn(`Skipped conflicting layout arrangement for panel '${skipId}'.`);
      }
    }
  }
  const nextSlots = next.slots.map((slot) => (
    acceptedSlotIds.has(slot.id) ? { ...slot, gridRect: gridRectsBySlotId.get(slot.id)! } : slot
  ));
  const normalized = normalizeTiledPanelStateToWorkspace({ ...next, slots: nextSlots }, viewport, layoutMetrics);
  let normalizedAway = false;
  for (const slotId of acceptedSlotIds) {
    const requested = gridRectsBySlotId.get(slotId);
    const applied = normalized.slots.find((slot) => slot.id === slotId)?.gridRect;
    if (requested && (!applied || !sameGridRect(requested, applied))) {
      normalizedAway = true;
      break;
    }
  }
  if (layoutHasGapsOrOverlaps(normalized, viewport, 1, layoutMetrics)) {
    console.warn("Applied layout arrangement with residual gaps or overlaps.");
    normalizedAway = true;
  }
  const reasons = [
    ...(skippedIds.size ? ["일부 배치는 충돌로 적용되지 않았습니다."] : []),
    ...(normalizedAway ? ["일부 배치는 화면 제약에 맞게 조정되었습니다."] : [])
  ];
  return { state: normalized, ...(reasons.length ? { reason: reasons.join(" ") } : {}) };
}


function sameGridRect(left: PanelGridRect, right: PanelGridRect): boolean {
  return left.col === right.col
    && left.row === right.row
    && left.colSpan === right.colSpan
    && left.rowSpan === right.rowSpan;
}


function samePanelState(left: TiledPanelState, right: TiledPanelState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const content = state.contents[slot.contentId];
  const minimumSpan = readableMinGridSpanForKind(content?.kind ?? "chart");
  return movePanelSlotToGridRect(
    state,
    slot.id,
    normalizePanelGridRect(placement, minimumSpan),
    viewport,
    layoutMetrics
  );
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
  return readableMinGridSpanForKind(kind);
}

function maxSpanForKind(kind: PanelContentKind) {
  return maxGridSpanForKind(kind);
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

function readPendingPlacementPick(proposal: AgentLayoutProposal): PendingPlacementPick | undefined {
  const command = proposal.commands.find((item) => item.type === "layout.placement.pick");
  if (!command) {
    return undefined;
  }
  const panelType = readString(command.payload.panelType);
  if (!panelType) {
    return undefined;
  }
  const candidatesRaw = Array.isArray(command.payload.candidates) ? command.payload.candidates : [];
  const candidates = candidatesRaw.flatMap((item): PlacementPickCandidate[] => {
    if (!isRecord(item)) {
      return [];
    }
    const id = readString(item.id);
    const label = readString(item.label);
    const placement = readPlacement(item.placement);
    if (!id || !label || !placement) {
      return [];
    }
    return [{
      id,
      label,
      placement,
      arrangement: Array.isArray(item.arrangement) ? item.arrangement : []
    }];
  });
  if (!candidates.length) {
    return undefined;
  }
  return {
    panelType,
    panelId: readString(command.payload.panelId) ?? readString(command.target?.panelId) ?? undefined,
    symbol: readString(command.payload.symbol) ?? undefined,
    candidates
  };
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
