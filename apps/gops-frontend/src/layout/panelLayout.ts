import type { CSSProperties } from "react";
import { gridGutter } from "./grid";
import { almostEqual, clamp, rangesOverlap, rectBottom, rectRight, rectsOverlap, uniqueStrings } from "./panelGeometry";
import { panelPaletteLabel, panelRegistry, panelRegistryEntry, type PanelRegistryEntry } from "./panelRegistry";
import { workspaceBottomInset, workspaceTopInset } from "./workspaceMetrics";
import { normalizeWildPanelState, type WildPanelState } from "./wildPanel";

export type ViewportSize = {
  width: number;
  height: number;
};

export type PanelContentKind =
  | "chart"
  | "compare"
  | "company"
  | "companyMulti"
  | "companyValuation"
  | "companyProfitability"
  | "companyStability"
  | "news"
  | "newsList"
  | "watchlistNews"
  | "watchlistNewsList"
  | "indices"
  | "popular"
  | "recommendations"
  | "recommendationsList"
  | "themeRadar"
  | "ontology"
  | "portfolio"
  | "portfolioMulti"
  | "portfolioInvestment"
  | "portfolioPerformance"
  | "portfolioInvested"
  | "portfolioDividend"
  | "portfolioDiversification"
  | "portfolioHeatmap"
  | "portfolioHoldings"
  | "portfolioHoldingsFlatCards"
  | "orderFlow"
  | "quickOrder"
  | "paperQuickOrder"
  | "paperTrade"
  | "paperAccount"
  | "chartCommentary"
  | "chartAssetOps"
  | "chartPatternList"
  | "trade";

export type PanelSlotId = string;
export type PanelContentId = string;

export type PanelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type WorkspaceBounds = PanelRect;

export type PanelGridRect = {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type PanelGridCell = {
  col: number;
  row: number;
};

export type PanelGridMetrics = {
  left: number;
  top: number;
  gutter: number;
  cellWidth: number;
  cellHeight: number;
  stepX: number;
  stepY: number;
  cols: number;
  rows: number;
  workspace: WorkspaceBounds;
};

export type WorkspaceLayoutMetrics = {
  topInset?: number;
  bottomInset?: number;
  /** Render scale applied by the app shell. Pixel policies are divided by this value. */
  uiScale?: number;
  /** Small-screen floor for one rendered grid cell. */
  minCellWidthPx?: number;
  minCellHeightPx?: number;
};

export type PanelSlot = {
  id: PanelSlotId;
  contentId: PanelContentId;
  layoutPinned?: boolean;
  wildPanel?: WildPanelState;
  gridRect: PanelGridRect;
  rect: PanelRect;
  minWidth: number;
  minHeight: number;
};

export type PanelContentInstance = {
  id: PanelContentId;
  kind: PanelContentKind;
  title: string;
  instanceIndex: number;
  chartDocumentId?: string;
  layoutWeight?: number;
  props?: Record<string, unknown>;
};

export type TiledPanelState = {
  slots: PanelSlot[];
  contents: Record<PanelContentId, PanelContentInstance>;
  nextInstance: number;
};

export type PanelBoundaryOrientation = "vertical" | "horizontal";

export type PanelBoundary = {
  id: string;
  orientation: PanelBoundaryOrientation;
  position: number;
  rangeStart: number;
  rangeEnd: number;
  negativeSlotIds: PanelSlotId[];
  positiveSlotIds: PanelSlotId[];
};

export type InsertPanelOptions = {
  symbol?: string;
  slotId?: PanelSlotId;
  layoutWeight?: number;
  props?: Record<string, unknown>;
  allowOverlap?: boolean;
};

export type PanelResizeYieldSlot = {
  slotId: PanelSlotId;
  previousGridRect: PanelGridRect;
  gridRect: PanelGridRect;
};

export type PanelResizeYieldPlan = {
  valid: boolean;
  sourceSlotId: PanelSlotId;
  sourceGridRect: PanelGridRect;
  yieldedSlots: PanelResizeYieldSlot[];
  reason?: string;
};

export type PanelMovePushPlan = {
  valid: boolean;
  sourceSlotId: PanelSlotId;
  sourceGridRect: PanelGridRect;
  /** Panels shoved out of the moved panel's footprint, reusing the yield slot shape. */
  pushedSlots: PanelResizeYieldSlot[];
  reason?: string;
};

export type PanelDropGridRectPlan = {
  valid: boolean;
  gridRect: PanelGridRect;
  reason?: string;
};

export const panelGridSpec = {
  cols: 8,
  rows: 6
} as const;

export const panelLayoutStorageKey = "gops:workspace-grid-layout:v1";

const epsilon = 0.5;
const defaultViewport: ViewportSize = { width: 1280, height: 720 };

export const insertablePanelKinds: PanelContentKind[] = panelRegistry
  .filter((entry) => entry.insertable !== false)
  .map((entry) => entry.kind);

export function workspaceBounds(
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): WorkspaceBounds {
  const topInset = readLayoutMetric(layoutMetrics.topInset, workspaceTopInset);
  const bottomInset = readLayoutMetric(layoutMetrics.bottomInset, workspaceBottomInset);
  const top = Math.max(0, Math.round(topInset));
  const bottom = Math.max(top + 1, Math.round(viewport.height - bottomInset));
  const uiScale = Math.max(0.1, readLayoutMetric(layoutMetrics.uiScale, 1));
  const gutter = gridGutter(viewport.width);
  const minCellWidth = Math.max(0, readLayoutMetric(layoutMetrics.minCellWidthPx, 0)) / uiScale;
  const minCellHeight = Math.max(0, readLayoutMetric(layoutMetrics.minCellHeightPx, 0)) / uiScale;
  const minimumGridWidth = minCellWidth > 0
    ? minCellWidth * panelGridSpec.cols + gutter * (panelGridSpec.cols + 1)
    : 0;
  const minimumGridHeight = minCellHeight > 0
    ? minCellHeight * panelGridSpec.rows + gutter * (panelGridSpec.rows + 1)
    : 0;
  return {
    left: 0,
    top,
    width: Math.max(1, Math.round(viewport.width), minimumGridWidth),
    height: Math.max(1, bottom - top, minimumGridHeight)
  };
}

export function createInitialTiledPanelState(
  viewport: ViewportSize,
  options: { symbol?: string; layoutMetrics?: WorkspaceLayoutMetrics } = {}
): TiledPanelState {
  const contents: Record<PanelContentId, PanelContentInstance> = {};
  const chart = createPanelContent("chart", 1, { symbol: options.symbol?.trim().toUpperCase(), layoutWeight: 100 });
  const news = createPanelContent("news", 2, { layoutWeight: 50 });
  const ontology = createPanelContent("ontology", 3, { layoutWeight: 50 });
  [chart, news, ontology].forEach((content) => {
    contents[content.id] = content;
  });

  return {
    contents,
    nextInstance: 4,
    slots: [
      createPanelSlot("slot-news", news, { col: 1, row: 1, colSpan: 4, rowSpan: 2 }, viewport, options.layoutMetrics),
      createPanelSlot("slot-ontology", ontology, { col: 5, row: 1, colSpan: 4, rowSpan: 2 }, viewport, options.layoutMetrics),
      createPanelSlot("slot-chart", chart, { col: 1, row: 3, colSpan: 8, rowSpan: 4 }, viewport, options.layoutMetrics)
    ]
  };
}

export type PanelLayoutSpecItem = {
  kind: PanelContentKind;
  gridRect: PanelGridRect;
  symbol?: string;
  props?: Record<string, unknown>;
  layoutWeight?: number;
};

/** Build a fresh TiledPanelState from a declarative panel spec (used by layout presets). */
export function createTiledPanelStateFromSpec(
  spec: readonly PanelLayoutSpecItem[],
  viewport: ViewportSize,
  options: { symbol?: string; layoutMetrics?: WorkspaceLayoutMetrics } = {}
): TiledPanelState {
  const contents: Record<PanelContentId, PanelContentInstance> = {};
  const slots: PanelSlot[] = [];
  let instance = 1;
  spec.forEach((item) => {
    const inheritsSymbol = item.kind === "chart" || item.kind === "company" || item.kind === "compare";
    const symbol = item.symbol ?? (inheritsSymbol ? options.symbol : undefined);
    const content = createPanelContent(item.kind, instance, {
      symbol: symbol?.trim().toUpperCase(),
      layoutWeight: item.layoutWeight ?? panelRegistryEntry(item.kind).defaultLayoutWeight,
      props: item.props
    });
    contents[content.id] = content;
    slots.push(createPanelSlot(`slot-${item.kind}-${instance}`, content, item.gridRect, viewport, options.layoutMetrics));
    instance += 1;
  });
  return { contents, nextInstance: instance, slots };
}

export function panelContentTitle(kind: PanelContentKind, instanceIndex?: number): string {
  void instanceIndex;
  return panelRegistryEntry(kind).title;
}

export function detectResizablePanelBoundaries(
  state: TiledPanelState,
  viewport?: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): PanelBoundary[] {
  void layoutMetrics;
  const inferredViewport = viewport ?? viewportFromState(state);
  const gutter = panelGutter(inferredViewport);
  const raw: PanelBoundary[] = [];
  for (let leftIndex = 0; leftIndex < state.slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < state.slots.length; rightIndex += 1) {
      const a = state.slots[leftIndex]!;
      const b = state.slots[rightIndex]!;
      const vertical = sharedVerticalBoundary(a, b, gutter);
      if (vertical) {
        raw.push(vertical);
      }
      const horizontal = sharedHorizontalBoundary(a, b, gutter);
      if (horizontal) {
        raw.push(horizontal);
      }
    }
  }
  return mergeBoundarySegments(raw);
}

export function resizeFreeformBoundary(
  state: TiledPanelState,
  boundaryId: string,
  delta: number,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const boundary = detectResizablePanelBoundaries(state, viewport, layoutMetrics).find((item) => item.id === boundaryId);
  if (!boundary) {
    return state;
  }
  const resolvedDelta = clampBoundaryDelta(state, boundary, delta, viewport, layoutMetrics);
  if (Math.abs(resolvedDelta) < epsilon) {
    return state;
  }
  const next = {
    ...state,
    slots: state.slots.map((slot) => resizeSlotRectAtBoundary(slot, boundary, resolvedDelta))
  };
  return slotRectsOverlap(next.slots) ? state : next;
}

export function removePanelSlot(
  state: TiledPanelState,
  slotId: PanelSlotId,
  viewport?: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const removed = state.slots.find((slot) => slot.id === slotId);
  if (!removed) {
    return state;
  }
  const nextContents = { ...state.contents };
  delete nextContents[removed.contentId];
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    contents: nextContents,
    slots: state.slots.filter((slot) => slot.id !== removed.id)
  }, viewport ?? viewportFromState(state), layoutMetrics);
}

export function setPanelContentProps(
  state: TiledPanelState,
  contentId: PanelContentId,
  props: Record<string, unknown>
): TiledPanelState {
  const content = state.contents[contentId];
  if (!content) {
    return state;
  }
  return {
    ...state,
    contents: {
      ...state.contents,
      [contentId]: {
        ...content,
        props: {
          ...(content.props ?? {}),
          ...props
        }
      }
    }
  };
}

export function setPanelContentLayoutWeight(
  state: TiledPanelState,
  contentId: PanelContentId,
  layoutWeight: number
): TiledPanelState {
  const content = state.contents[contentId];
  if (!content || content.layoutWeight === layoutWeight) {
    return state;
  }
  return {
    ...state,
    contents: {
      ...state.contents,
      [contentId]: {
        ...content,
        layoutWeight
      }
    }
  };
}

export function swapPanelContents(
  state: TiledPanelState,
  sourceSlotId: PanelSlotId,
  targetSlotId: PanelSlotId,
  viewport?: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  if (sourceSlotId === targetSlotId) {
    return state;
  }
  const source = state.slots.find((slot) => slot.id === sourceSlotId);
  const target = state.slots.find((slot) => slot.id === targetSlotId);
  if (!source || !target) {
    return state;
  }
  const swapped = {
    ...state,
    slots: state.slots.map((slot) => {
      if (slot.id === source.id) {
        return {
          ...slot,
          contentId: target.contentId,
          ...minPanelPixelSizeForKind(state.contents[target.contentId]?.kind ?? "news", viewport ?? viewportFromState(state), layoutMetrics)
        };
      }
      if (slot.id === target.id) {
        return {
          ...slot,
          contentId: source.contentId,
          ...minPanelPixelSizeForKind(state.contents[source.contentId]?.kind ?? "news", viewport ?? viewportFromState(state), layoutMetrics)
        };
      }
      return slot;
    })
  };
  return normalizeTiledPanelStateToWorkspace(swapped, viewport ?? viewportFromState(swapped), layoutMetrics);
}

export function scaleTiledPanelState(
  state: TiledPanelState,
  previousViewport: ViewportSize,
  nextViewport: ViewportSize,
  previousLayoutMetrics: WorkspaceLayoutMetrics = {},
  nextLayoutMetrics: WorkspaceLayoutMetrics = previousLayoutMetrics
): TiledPanelState {
  void previousViewport;
  void previousLayoutMetrics;
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    slots: state.slots.map((slot) => ({ ...slot }))
  }, nextViewport, nextLayoutMetrics);
}

export function normalizeTiledPanelStateToWorkspace(
  state: TiledPanelState,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  let changed = false;
  const slots = state.slots.map((slot) => {
    const content = state.contents[slot.contentId];
    const kind = content?.kind ?? "news";
    const gridRect = normalizePanelGridRectForKind(slot.gridRect, kind);
    const rect = panelRectForGridRect(gridRect, viewport, layoutMetrics);
    const minSize = minPanelPixelSizeForKind(kind, viewport, layoutMetrics);
    if (!gridRectEquals(gridRect, slot.gridRect) || !rectEquals(rect, slot.rect) || slot.minWidth !== minSize.minWidth || slot.minHeight !== minSize.minHeight) {
      changed = true;
      return {
        ...slot,
        gridRect,
        rect,
        ...minSize
      };
    }
    return slot;
  });
  return changed ? { ...state, slots } : state;
}

export function normalizeFreeformRectsToGridLayout(
  state: TiledPanelState,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const chosenBySlotId = new Map<PanelSlotId, PanelGridRect>();
  const ordered = state.slots
    .map((slot, index) => {
      const content = state.contents[slot.contentId];
      const kind = content?.kind ?? "news";
      return {
        slot,
        index,
        kind,
        weight: content?.layoutWeight ?? panelRegistryEntry(kind).defaultLayoutWeight
      };
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const item of ordered) {
    const preferred = preferredGridRectFromPanelRect(item.slot.rect, item.kind, viewport, layoutMetrics);
    const minSpan = minGridSpanForKind(item.kind);
    const spans = candidateSpans(preferred, minSpan);
    let chosen: PanelGridRect | null = null;
    for (const span of spans) {
      const candidates = candidateGridRectsForSpan(preferred, span);
      chosen = candidates.find((candidate) => !gridRectOverlapsPlaced(candidate, chosenBySlotId)) ?? null;
      if (chosen) {
        break;
      }
    }
    const current = normalizePanelGridRect(item.slot.gridRect, minSpan);
    if (!chosen && !gridRectOverlapsPlaced(current, chosenBySlotId)) {
      chosen = current;
    }
    if (!chosen) {
      chosen = firstNonOverlappingGridRect(item.kind, chosenBySlotId) ?? current;
    }
    chosenBySlotId.set(item.slot.id, chosen);
  }

  return normalizeTiledPanelStateToWorkspace({
    ...state,
    slots: state.slots.map((slot) => ({
      ...slot,
      gridRect: chosenBySlotId.get(slot.id) ?? slot.gridRect
    }))
  }, viewport, layoutMetrics);
}

export function layoutHasGapsOrOverlaps(
  state: TiledPanelState,
  viewport: ViewportSize,
  tolerance = 1,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): boolean {
  const workspace = workspaceBounds(viewport, layoutMetrics);
  const gutter = panelGutter(viewport);
  for (const slot of state.slots) {
    const content = state.contents[slot.contentId];
    if (!content || !gridRectMeetsMinSpan(slot.gridRect, content.kind)) {
      return true;
    }
    const slotRight = rectRight(slot.rect);
    const slotBottom = rectBottom(slot.rect);
    if (
      slot.rect.left < workspace.left + gutter - tolerance ||
      slot.rect.top < workspace.top + gutter - tolerance ||
      slotRight > rectRight(workspace) - gutter + tolerance ||
      slotBottom > rectBottom(workspace) - gutter + tolerance
    ) {
      return true;
    }
  }

  for (let leftIndex = 0; leftIndex < state.slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < state.slots.length; rightIndex += 1) {
      if (rectsOverlap(state.slots[leftIndex]!.rect, state.slots[rightIndex]!.rect, tolerance)) {
        return true;
      }
    }
  }
  return false;
}

export function panelSlotStyle(slot: PanelSlot): CSSProperties {
  return {
    left: slot.rect.left,
    top: slot.rect.top,
    width: slot.rect.width,
    height: slot.rect.height
  };
}

export function panelGutter(viewport: ViewportSize): number {
  return gridGutter(viewport.width);
}

export function panelGridMetrics(
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): PanelGridMetrics {
  const workspace = workspaceBounds(viewport, layoutMetrics);
  const gutter = panelGutter(viewport);
  const cols = panelGridSpec.cols;
  const rows = panelGridSpec.rows;
  const cellWidth = Math.max(1, (workspace.width - gutter * (cols + 1)) / cols);
  const cellHeight = Math.max(1, (workspace.height - gutter * (rows + 1)) / rows);
  return {
    left: workspace.left + gutter,
    top: workspace.top + gutter,
    gutter,
    cellWidth,
    cellHeight,
    stepX: cellWidth + gutter,
    stepY: cellHeight + gutter,
    cols,
    rows,
    workspace
  };
}

export function panelRectForGridRect(
  gridRect: PanelGridRect,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): PanelRect {
  const metrics = panelGridMetrics(viewport, layoutMetrics);
  const normalized = normalizePanelGridRect(gridRect);
  return {
    left: metrics.left + (normalized.col - 1) * metrics.stepX,
    top: metrics.top + (normalized.row - 1) * metrics.stepY,
    width: normalized.colSpan * metrics.cellWidth + Math.max(0, normalized.colSpan - 1) * metrics.gutter,
    height: normalized.rowSpan * metrics.cellHeight + Math.max(0, normalized.rowSpan - 1) * metrics.gutter
  };
}

export function gridRectFromPanelRect(
  rect: PanelRect,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): PanelGridRect {
  return preferredGridRectFromPanelRect(rect, "news", viewport, layoutMetrics);
}

export function normalizePanelGridRect(
  gridRect: PanelGridRect,
  minSpan: Pick<PanelGridRect, "colSpan" | "rowSpan"> = { colSpan: 1, rowSpan: 1 }
): PanelGridRect {
  const colSpan = clampInt(gridRect.colSpan, minSpan.colSpan, panelGridSpec.cols);
  const rowSpan = clampInt(gridRect.rowSpan, minSpan.rowSpan, panelGridSpec.rows);
  const col = clampInt(gridRect.col, 1, panelGridSpec.cols - colSpan + 1);
  const row = clampInt(gridRect.row, 1, panelGridSpec.rows - rowSpan + 1);
  return { col, row, colSpan, rowSpan };
}

export function minGridSpanForKind(kind: PanelContentKind): Pick<PanelGridRect, "colSpan" | "rowSpan"> {
  return panelRegistryEntry(kind).minSpan;
}

export function readableMinGridSpanForKind(kind: PanelContentKind): Pick<PanelGridRect, "colSpan" | "rowSpan"> {
  return panelRegistryEntry(kind).readableMinSpan;
}

export function maxGridSpanForKind(kind: PanelContentKind): Pick<PanelGridRect, "colSpan" | "rowSpan"> {
  return panelRegistryEntry(kind).maxSpan ?? maxGridSpan();
}

export function normalizePanelGridRectForKind(gridRect: PanelGridRect, kind: PanelContentKind): PanelGridRect {
  const minSpan = minGridSpanForKind(kind);
  const maxSpan = maxGridSpanForKind(kind);
  return normalizePanelGridRect({
    ...gridRect,
    colSpan: Math.min(gridRect.colSpan, maxSpan.colSpan),
    rowSpan: Math.min(gridRect.rowSpan, maxSpan.rowSpan)
  }, minSpan);
}

export function panelMinimumRenderedSizeForKind(kind: PanelContentKind): { width: number; height: number } {
  return panelRegistryEntry(kind).minSizePx;
}

export function maxGridSpan(): Pick<PanelGridRect, "colSpan" | "rowSpan"> {
  return { colSpan: panelGridSpec.cols, rowSpan: panelGridSpec.rows };
}

export function defaultGridSpanForKind(kind: PanelContentKind): Pick<PanelGridRect, "colSpan" | "rowSpan"> {
  return panelRegistryEntry(kind).defaultSpan;
}

export function panelPaletteEntries(): readonly PanelRegistryEntry[] {
  return panelRegistry.filter((entry) => entry.insertable !== false);
}

export function panelPaletteEntryLabel(kind: PanelContentKind): string {
  return panelPaletteLabel(panelRegistryEntry(kind));
}

export function panelPaletteEntryTitle(kind: PanelContentKind): string {
  return panelRegistryEntry(kind).title;
}

export function panelGridCellFromPoint(
  viewport: ViewportSize,
  x: number,
  y: number,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): PanelGridCell | null {
  const metrics = panelGridMetrics(viewport, layoutMetrics);
  const right = metrics.left + metrics.cols * metrics.stepX - metrics.gutter;
  const bottom = metrics.top + metrics.rows * metrics.stepY - metrics.gutter;
  if (x < metrics.left || x > right || y < metrics.top || y > bottom) {
    return null;
  }
  return {
    col: clampInt(Math.floor((x - metrics.left) / metrics.stepX) + 1, 1, metrics.cols),
    row: clampInt(Math.floor((y - metrics.top) / metrics.stepY) + 1, 1, metrics.rows)
  };
}

export function gridRectFromPoint(
  viewport: ViewportSize,
  x: number,
  y: number,
  span: Pick<PanelGridRect, "colSpan" | "rowSpan">,
  layoutMetrics: WorkspaceLayoutMetrics = {},
  offset: Partial<Pick<PanelGridRect, "col" | "row">> = {}
): PanelGridRect | null {
  const cell = panelGridCellFromPoint(viewport, x, y, layoutMetrics);
  if (!cell) {
    return null;
  }
  return normalizePanelGridRect({
    col: cell.col - (offset.col ?? 0),
    row: cell.row - (offset.row ?? 0),
    colSpan: span.colSpan,
    rowSpan: span.rowSpan
  }, span);
}

export function gridRectForPanelDrag(
  sourceGridRect: PanelGridRect,
  pointerCell: PanelGridCell,
  pointerOffset: PanelGridCell
): PanelGridRect {
  const fixedSpan = {
    colSpan: sourceGridRect.colSpan,
    rowSpan: sourceGridRect.rowSpan
  };
  return normalizePanelGridRect({
    col: pointerCell.col - pointerOffset.col,
    row: pointerCell.row - pointerOffset.row,
    ...fixedSpan
  }, fixedSpan);
}

export function slotAtGridCell(state: TiledPanelState, cell: PanelGridCell, exceptSlotId?: PanelSlotId): PanelSlot | null {
  return state.slots.find((slot) => (
    slot.id !== exceptSlotId &&
    gridRectContainsCell(slot.gridRect, cell)
  )) ?? null;
}

export function resolvePanelDropGridRect(
  state: TiledPanelState,
  kind: PanelContentKind,
  cell: PanelGridCell,
  options: {
    exceptSlotId?: PanelSlotId;
    preferredSpan?: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  } = {}
): PanelDropGridRectPlan {
  const preferredSpan = options.preferredSpan ?? defaultGridSpanForKind(kind);
  const fallback = recommendedGridRectAroundCell(cell, preferredSpan);
  if (!gridCellInsideGrid(cell)) {
    return { valid: false, gridRect: fallback, reason: "outside-grid" };
  }
  const targetComponent = emptyGridComponentCellKeys(state, cell, options.exceptSlotId);
  const candidates = recommendedGridRectCandidates(
    state,
    kind,
    preferredSpan,
    options.exceptSlotId
  ).filter((candidate) => gridRectFitsCellKeys(candidate, targetComponent));
  if (!candidates.length) {
    return { valid: false, gridRect: fallback, reason: "preferred-span-unavailable" };
  }
  const [gridRect] = candidates.sort((left, right) => compareRecommendedGridRectCandidates(left, right, cell));
  return { valid: true, gridRect: gridRect ?? fallback };
}

export function resolveFirstAvailableRecommendedGridRect(
  state: TiledPanelState,
  kind: PanelContentKind
): PanelGridRect | null {
  const span = defaultGridSpanForKind(kind);
  for (let row = 1; row <= panelGridSpec.rows - span.rowSpan + 1; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols - span.colSpan + 1; col += 1) {
      const candidate = { col, row, colSpan: span.colSpan, rowSpan: span.rowSpan };
      if (canPlaceGridRect(state, candidate, { kind })) {
        return candidate;
      }
    }
  }
  return null;
}

export function gridRectsOverlap(left: PanelGridRect, right: PanelGridRect): boolean {
  return left.col < right.col + right.colSpan &&
    left.col + left.colSpan > right.col &&
    left.row < right.row + right.rowSpan &&
    left.row + left.rowSpan > right.row;
}

export function canPlaceGridRect(
  state: TiledPanelState,
  gridRect: PanelGridRect,
  options: { exceptSlotId?: PanelSlotId; kind?: PanelContentKind } = {}
): boolean {
  const normalized = options.kind ? normalizePanelGridRectForKind(gridRect, options.kind) : normalizePanelGridRect(gridRect);
  if (!gridRectEquals(normalized, gridRect)) {
    return false;
  }
  if (options.kind && !gridRectMeetsMinSpan(normalized, options.kind)) {
    return false;
  }
  return !state.slots.some((slot) => (
    slot.id !== options.exceptSlotId &&
    gridRectsOverlap(slot.gridRect, normalized)
  ));
}

export function addPanelSlotAtGridRect(
  state: TiledPanelState,
  kind: PanelContentKind,
  gridRect: PanelGridRect,
  options: InsertPanelOptions = {},
  viewport: ViewportSize = viewportFromState(state),
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const normalized = normalizePanelGridRectForKind(gridRect, kind);
  if (!options.allowOverlap && !canPlaceGridRect(state, normalized, { kind })) {
    return state;
  }
  const content = createPanelContent(kind, state.nextInstance, {
    symbol: options.symbol,
    layoutWeight: options.layoutWeight ?? panelRegistryEntry(kind).defaultLayoutWeight,
    props: options.props
  });
  const slot = createPanelSlot(
    uniquePanelSlotId(state, options.slotId || `slot-${kind}-${state.nextInstance}`),
    content,
    normalized,
    viewport,
    layoutMetrics
  );
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    contents: {
      ...state.contents,
      [content.id]: content
    },
    nextInstance: state.nextInstance + 1,
    slots: [...state.slots, slot]
  }, viewport, layoutMetrics);
}

export function movePanelSlotToGridRect(
  state: TiledPanelState,
  slotId: PanelSlotId,
  gridRect: PanelGridRect,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const slot = state.slots.find((item) => item.id === slotId);
  const kind = slot ? state.contents[slot.contentId]?.kind : null;
  if (!slot || !kind) {
    return state;
  }
  const normalized = normalizePanelGridRectForKind(gridRect, kind);
  if (!canPlaceGridRect(state, normalized, { exceptSlotId: slot.id, kind })) {
    return state;
  }
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    slots: state.slots.map((item) => item.id === slot.id ? { ...item, gridRect: normalized } : item)
  }, viewport, layoutMetrics);
}

export function resizePanelSlotToGridRect(
  state: TiledPanelState,
  slotId: PanelSlotId,
  gridRect: PanelGridRect,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  return movePanelSlotToGridRect(state, slotId, gridRect, viewport, layoutMetrics);
}

export function resolvePanelResizeWithYield(
  state: TiledPanelState,
  slotId: PanelSlotId,
  desiredGridRect: PanelGridRect
): PanelResizeYieldPlan {
  const source = state.slots.find((item) => item.id === slotId);
  const kind = source ? state.contents[source.contentId]?.kind : null;
  const fallbackGridRect = normalizePanelGridRect(desiredGridRect);
  if (!source || !kind) {
    return {
      valid: false,
      sourceSlotId: slotId,
      sourceGridRect: fallbackGridRect,
      yieldedSlots: [],
      reason: "source-not-found"
    };
  }
  const sourceGridRect = normalizePanelGridRectForKind(desiredGridRect, kind);
  if (!gridRectEquals(sourceGridRect, desiredGridRect)) {
    return {
      valid: false,
      sourceSlotId: source.id,
      sourceGridRect,
      yieldedSlots: [],
      reason: "invalid-source-grid-rect"
    };
  }

  const sourceColEnd = gridRectColEnd(source.gridRect);
  const sourceRowEnd = gridRectRowEnd(source.gridRect);
  const desiredColEnd = gridRectColEnd(sourceGridRect);
  const desiredRowEnd = gridRectRowEnd(sourceGridRect);
  const expansion = {
    west: sourceGridRect.col < source.gridRect.col,
    east: desiredColEnd > sourceColEnd,
    north: sourceGridRect.row < source.gridRect.row,
    south: desiredRowEnd > sourceRowEnd
  };

  const yieldedSlots: PanelResizeYieldSlot[] = [];
  const yieldedBySlotId = new Map<PanelSlotId, PanelGridRect>();
  for (const slot of state.slots) {
    if (slot.id === source.id || !gridRectsOverlap(slot.gridRect, sourceGridRect)) {
      continue;
    }
    const content = state.contents[slot.contentId];
    if (!content) {
      return invalidResizeYieldPlan(source.id, sourceGridRect, yieldedSlots, "content-not-found");
    }
    const previousGridRect = yieldedBySlotId.get(slot.id) ?? slot.gridRect;
    const nextGridRect = yieldGridRectForResizeOverlap(
      previousGridRect,
      source.gridRect,
      sourceGridRect,
      expansion
    );
    if (!nextGridRect || gridRectEquals(nextGridRect, previousGridRect)) {
      return invalidResizeYieldPlan(source.id, sourceGridRect, yieldedSlots, "non-yieldable-overlap");
    }
    if (!gridRectMeetsMinSpan(nextGridRect, content.kind)) {
      return invalidResizeYieldPlan(source.id, sourceGridRect, yieldedSlots, "minimum-span");
    }
    yieldedBySlotId.set(slot.id, nextGridRect);
    yieldedSlots.push({
      slotId: slot.id,
      previousGridRect: slot.gridRect,
      gridRect: nextGridRect
    });
  }

  const finalSlots = state.slots.map((slot) => {
    if (slot.id === source.id) {
      return { ...slot, gridRect: sourceGridRect };
    }
    const yielded = yieldedBySlotId.get(slot.id);
    return yielded ? { ...slot, gridRect: yielded } : slot;
  });
  if (layoutGridRectsOverlap(finalSlots)) {
    return invalidResizeYieldPlan(source.id, sourceGridRect, yieldedSlots, "collision");
  }
  return {
    valid: true,
    sourceSlotId: source.id,
    sourceGridRect,
    yieldedSlots
  };
}

export function applyPanelResizeWithYield(
  state: TiledPanelState,
  plan: PanelResizeYieldPlan,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  if (!plan.valid) {
    return state;
  }
  const yieldedBySlotId = new Map(plan.yieldedSlots.map((slot) => [slot.slotId, slot.gridRect]));
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    slots: state.slots.map((slot) => {
      if (slot.id === plan.sourceSlotId) {
        return { ...slot, gridRect: plan.sourceGridRect };
      }
      const yielded = yieldedBySlotId.get(slot.id);
      return yielded ? { ...slot, gridRect: yielded } : slot;
    })
  }, viewport, layoutMetrics);
}

/**
 * Resolves dropping a panel at `targetGridRect` by shoving any overlapping panels
 * downward ("push"), cascading so displaced panels push whatever sits below them.
 * The move fails (valid=false) only if a pushed panel would fall off the grid bottom,
 * so the caller can fall back to blocking the drop. When nothing overlaps, the plan is
 * still valid with an empty `pushedSlots`, i.e. it also covers plain, unobstructed moves.
 */
type PushAxis = "down" | "up" | "right" | "left";

/** Picks the push direction from a panel's displacement: dominant axis wins, sign chooses the way. */
function pushAxisForMove(from: PanelGridRect, to: PanelGridRect): PushAxis {
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;
  if (Math.abs(dRow) >= Math.abs(dCol)) {
    return dRow >= 0 ? "down" : "up";
  }
  return dCol >= 0 ? "right" : "left";
}

/** Slides `rect` clear of `mover` along the push axis, keeping it on the same perpendicular line. */
function pushedGridRectAlongAxis(rect: PanelGridRect, mover: PanelGridRect, axis: PushAxis): PanelGridRect {
  switch (axis) {
    case "down":
      return { ...rect, row: mover.row + mover.rowSpan };
    case "up":
      return { ...rect, row: mover.row - rect.rowSpan };
    case "right":
      return { ...rect, col: mover.col + mover.colSpan };
    case "left":
      return { ...rect, col: mover.col - rect.colSpan };
  }
}

function pushOverflowsGrid(rect: PanelGridRect, axis: PushAxis, cols: number, rows: number): boolean {
  switch (axis) {
    case "down":
      return gridRectRowEnd(rect) > rows + 1;
    case "up":
      return rect.row < 1;
    case "right":
      return gridRectColEnd(rect) > cols + 1;
    case "left":
      return rect.col < 1;
  }
}

export function resolvePanelMoveWithPush(
  state: TiledPanelState,
  slotId: PanelSlotId,
  targetGridRect: PanelGridRect
): PanelMovePushPlan {
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

  const cols = panelGridSpec.cols;
  const rows = panelGridSpec.rows;
  // Push panels in the direction the dragged panel is travelling: the dominant axis of
  // its displacement decides vertical vs horizontal, and the sign decides which way.
  const axis = pushAxisForMove(source.gridRect, sourceGridRect);

  const positions = new Map<PanelSlotId, PanelGridRect>();
  for (const slot of state.slots) {
    if (slot.id !== source.id) {
      positions.set(slot.id, slot.gridRect);
    }
  }

  // Each queue entry carries the id of the mover (null for the dragged panel) so a
  // pushed panel never collides with its own new position while the cascade continues.
  const queue: Array<{ moverId: PanelSlotId | null; rect: PanelGridRect }> = [
    { moverId: null, rect: sourceGridRect }
  ];
  const maxIterations = state.slots.length * (cols + rows + 4) + 16;
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
    const { moverId, rect: mover } = queue.shift()!;
    for (const [id, rect] of [...positions]) {
      if (id === moverId || !gridRectsOverlap(mover, rect)) {
        continue;
      }
      // Overlap guarantees strict movement along the push axis, so the cascade terminates.
      const pushed = pushedGridRectAlongAxis(rect, mover, axis);
      if (pushOverflowsGrid(pushed, axis, cols, rows)) {
        return {
          valid: false,
          sourceSlotId: source.id,
          sourceGridRect,
          pushedSlots: [],
          reason: "no-room"
        };
      }
      positions.set(id, pushed);
      queue.push({ moverId: id, rect: pushed });
    }
  }

  const pushedSlots: PanelResizeYieldSlot[] = [];
  for (const slot of state.slots) {
    if (slot.id === source.id) {
      continue;
    }
    const next = positions.get(slot.id)!;
    if (!gridRectEquals(next, slot.gridRect)) {
      pushedSlots.push({ slotId: slot.id, previousGridRect: slot.gridRect, gridRect: next });
    }
  }

  const finalSlots = state.slots.map((slot) => (
    slot.id === source.id
      ? { ...slot, gridRect: sourceGridRect }
      : { ...slot, gridRect: positions.get(slot.id)! }
  ));
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

export function applyPanelMoveWithPush(
  state: TiledPanelState,
  plan: PanelMovePushPlan,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  if (!plan.valid) {
    return state;
  }
  const pushedBySlotId = new Map(plan.pushedSlots.map((slot) => [slot.slotId, slot.gridRect]));
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    slots: state.slots.map((slot) => {
      if (slot.id === plan.sourceSlotId) {
        return { ...slot, gridRect: plan.sourceGridRect };
      }
      const pushed = pushedBySlotId.get(slot.id);
      return pushed ? { ...slot, gridRect: pushed } : slot;
    })
  }, viewport, layoutMetrics);
}

export function replacePanelSlotKind(
  state: TiledPanelState,
  slotId: PanelSlotId,
  kind: PanelContentKind,
  viewport: ViewportSize,
  options: InsertPanelOptions = {},
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot) {
    return state;
  }
  const gridRect = expandGridRectForKind(state, slot.gridRect, kind, slot.id);
  if (!gridRect) {
    return state;
  }
  const content = createPanelContent(kind, state.nextInstance, {
    symbol: options.symbol,
    layoutWeight: options.layoutWeight ?? panelRegistryEntry(kind).defaultLayoutWeight,
    props: options.props
  });
  const contents = { ...state.contents };
  delete contents[slot.contentId];
  contents[content.id] = content;
  return normalizeTiledPanelStateToWorkspace({
    ...state,
    contents,
    nextInstance: state.nextInstance + 1,
    slots: state.slots.map((item) => item.id === slot.id ? {
      ...item,
      contentId: content.id,
      gridRect
    } : item)
  }, viewport, layoutMetrics);
}

export function expandGridRectForKind(
  state: TiledPanelState,
  start: PanelGridRect,
  kind: PanelContentKind,
  exceptSlotId?: PanelSlotId
): PanelGridRect | null {
  const minSpan = readableMinGridSpanForKind(kind);
  const base = normalizePanelGridRect({
    col: start.col,
    row: start.row,
    colSpan: Math.max(start.colSpan, minSpan.colSpan),
    rowSpan: Math.max(start.rowSpan, minSpan.rowSpan)
  }, minSpan);
  const candidates = [
    base,
    normalizePanelGridRect({ ...base, col: Math.max(1, start.col + start.colSpan - base.colSpan) }, minSpan),
    normalizePanelGridRect({ ...base, row: Math.max(1, start.row + start.rowSpan - base.rowSpan) }, minSpan),
    normalizePanelGridRect({
      ...base,
      col: Math.max(1, start.col + start.colSpan - base.colSpan),
      row: Math.max(1, start.row + start.rowSpan - base.rowSpan)
    }, minSpan)
  ];
  return candidates.find((candidate) => canPlaceGridRect(state, candidate, { exceptSlotId, kind })) ?? null;
}

export function firstAvailablePanelGridRect(state: TiledPanelState, kind: PanelContentKind): PanelGridRect | null {
  return firstAvailableGridRect(state, kind);
}

export function setPrimaryChartSymbol(
  state: TiledPanelState,
  symbol: string,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  return setPrimaryChartSelection(state, symbol, "1D", viewport, layoutMetrics);
}

export function setPrimaryChartSelection(
  state: TiledPanelState,
  symbol: string,
  timeframe: string,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedTimeframe = timeframe.trim() || "1D";
  const chartSlot = state.slots.find((slot) => state.contents[slot.contentId]?.kind === "chart");
  if (chartSlot) {
    return setPanelContentProps(state, chartSlot.contentId, {
      ...(state.contents[chartSlot.contentId]?.props ?? {}),
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe
    });
  }
  const preferredChartRects = [
    { col: 1, row: 4, colSpan: 8, rowSpan: 3 },
    { col: 1, row: 3, colSpan: 8, rowSpan: 3 }
  ];
  const gridRect = preferredChartRects.find((candidate) => (
    canPlaceGridRect(state, candidate, { kind: "chart" })
  )) ?? firstAvailableGridRect(state, "chart");
  if (!gridRect) {
    return state;
  }
  const withChart = addPanelSlotAtGridRect(state, "chart", gridRect, { symbol: normalizedSymbol }, viewport, layoutMetrics);
  const createdSlot = withChart.slots.find((slot) => !state.slots.some((existing) => existing.id === slot.id));
  return createdSlot
    ? setPanelContentProps(withChart, createdSlot.contentId, {
      ...(withChart.contents[createdSlot.contentId]?.props ?? {}),
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe
    })
    : state;
}

export type StoredTiledPanelState = {
  version: 1;
  nextInstance: number;
  contents: Record<PanelContentId, PanelContentInstance>;
  slots: Array<{
    id: PanelSlotId;
    contentId: PanelContentId;
    layoutPinned?: boolean;
    wildPanel?: WildPanelState;
    gridRect: PanelGridRect;
  }>;
};

export function serializeTiledPanelState(state: TiledPanelState): StoredTiledPanelState {
  return {
    version: 1,
    nextInstance: state.nextInstance,
    contents: state.contents,
    slots: state.slots.map((slot) => ({
      id: slot.id,
      contentId: slot.contentId,
      ...(slot.layoutPinned ? { layoutPinned: true } : {}),
      ...(slot.wildPanel ? { wildPanel: slot.wildPanel } : {}),
      gridRect: slot.gridRect
    }))
  };
}

export function restoreTiledPanelStateSnapshot(
  value: unknown,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): TiledPanelState | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.slots) || !isRecord(value.contents)) {
    return null;
  }
  const contents: Record<PanelContentId, PanelContentInstance> = {};
  for (const [contentId, rawContent] of Object.entries(value.contents)) {
    if (!isRecord(rawContent)) {
      return null;
    }
    const rawKind = readString(rawContent.kind);
    const kind = readPanelContentKind(rawContent.kind);
    const instanceIndex = typeof rawContent.instanceIndex === "number" && Number.isFinite(rawContent.instanceIndex)
      ? rawContent.instanceIndex
      : 0;
    if (!kind) {
      return null;
    }
    contents[contentId] = {
      id: contentId,
      kind,
      title: rawKind === "indices1x1" || rawKind === "indices2x2"
        ? panelContentTitle(kind)
        : readString(rawContent.title) ?? panelContentTitle(kind),
      instanceIndex,
      ...(kind === "chart" ? { chartDocumentId: readString(rawContent.chartDocumentId) ?? `${contentId}-document` } : {}),
      ...(typeof rawContent.layoutWeight === "number" ? { layoutWeight: rawContent.layoutWeight } : {}),
      ...(isRecord(rawContent.props) ? { props: rawContent.props } : {})
    };
  }

  const slots: PanelSlot[] = [];
  let restoredWildPanel = false;
  for (const rawSlot of value.slots) {
    if (!isRecord(rawSlot)) {
      return null;
    }
    const id = readString(rawSlot.id);
    const contentId = readString(rawSlot.contentId);
    const content = contentId ? contents[contentId] : null;
    const gridRect = readGridRect(rawSlot.gridRect);
    if (!id || !content || !gridRect || !gridRectMeetsMinSpan(gridRect, content.kind)) {
      return null;
    }
    if (!canPlaceGridRect({ slots, contents, nextInstance: 1 }, gridRect, { kind: content.kind })) {
      return null;
    }
    const wildPanel = restoredWildPanel ? null : normalizeWildPanelState(rawSlot.wildPanel);
    if (wildPanel) {
      restoredWildPanel = true;
    }
    slots.push({
      ...createPanelSlot(id, content, gridRect, viewport, layoutMetrics),
      ...(rawSlot.layoutPinned === true ? { layoutPinned: true } : {}),
      ...(wildPanel ? { wildPanel } : {})
    });
  }
  const nextInstance = typeof value.nextInstance === "number" && Number.isFinite(value.nextInstance)
    ? Math.max(value.nextInstance, slots.length + 1)
    : slots.length + 1;
  return { contents, slots, nextInstance };
}

function createPanelContent(
  kind: PanelContentKind,
  instanceIndex: number,
  options: { symbol?: string; layoutWeight?: number; props?: Record<string, unknown> } = {}
): PanelContentInstance {
  const id = `content-${kind}-${instanceIndex}`;
  const props = {
    ...(options.props ?? {}),
    ...(kind === "chart" && options.symbol ? { symbol: options.symbol, timeframe: "1D" } : {}),
    ...(kind === "company" && options.symbol ? { symbol: options.symbol } : {}),
    ...(kind === "compare" && options.symbol ? { baseSymbol: options.symbol, symbols: [options.symbol], range: "1D" } : {})
  };
  return {
    id,
    kind,
    title: panelContentTitle(kind, instanceIndex),
    instanceIndex,
    ...(kind === "chart" ? { chartDocumentId: `${id}-document` } : {}),
    ...(options.layoutWeight !== undefined ? { layoutWeight: options.layoutWeight } : {}),
    ...(Object.keys(props).length ? { props } : {})
  };
}

function createPanelSlot(
  id: PanelSlotId,
  content: PanelContentInstance,
  gridRect: PanelGridRect,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): PanelSlot {
  const normalized = normalizePanelGridRectForKind(gridRect, content.kind);
  return {
    id,
    contentId: content.id,
    gridRect: normalized,
    rect: panelRectForGridRect(normalized, viewport, layoutMetrics),
    ...minPanelPixelSizeForKind(content.kind, viewport, layoutMetrics)
  };
}


export function setPanelSlotPinned(state: TiledPanelState, panelId: string, layoutPinned: boolean): TiledPanelState {
  const slot = state.slots.find((item) => item.id === panelId || item.contentId === panelId);
  if (!slot || Boolean(slot.layoutPinned) === layoutPinned) {
    return state;
  }
  return {
    ...state,
    slots: state.slots.map((item) => (
      item.id === slot.id
        ? { ...item, ...(layoutPinned ? { layoutPinned: true } : { layoutPinned: undefined }) }
        : item
    ))
  };
}

function minPanelPixelSizeForKind(
  kind: PanelContentKind,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): Pick<PanelSlot, "minWidth" | "minHeight"> {
  const minSpan = readableMinGridSpanForKind(kind);
  const rect = panelRectForGridRect({ col: 1, row: 1, colSpan: minSpan.colSpan, rowSpan: minSpan.rowSpan }, viewport, layoutMetrics);
  const uiScale = Math.max(0.1, readLayoutMetric(layoutMetrics.uiScale, 1));
  const minimum = panelMinimumRenderedSizeForKind(kind);
  return {
    minWidth: Math.max(rect.width, minimum.width / uiScale),
    minHeight: Math.max(rect.height, minimum.height / uiScale)
  };
}

function preferredGridRectFromPanelRect(
  rect: PanelRect,
  kind: PanelContentKind,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): PanelGridRect {
  const metrics = panelGridMetrics(viewport, layoutMetrics);
  const minSpan = minGridSpanForKind(kind);
  const maxSpan = maxGridSpanForKind(kind);
  const colSpan = clampInt(Math.round((rect.width + metrics.gutter) / metrics.stepX), minSpan.colSpan, maxSpan.colSpan);
  const rowSpan = clampInt(Math.round((rect.height + metrics.gutter) / metrics.stepY), minSpan.rowSpan, maxSpan.rowSpan);
  const spanWidth = colSpan * metrics.cellWidth + Math.max(0, colSpan - 1) * metrics.gutter;
  const spanHeight = rowSpan * metrics.cellHeight + Math.max(0, rowSpan - 1) * metrics.gutter;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const col = Math.round((centerX - spanWidth / 2 - metrics.left) / metrics.stepX) + 1;
  const row = Math.round((centerY - spanHeight / 2 - metrics.top) / metrics.stepY) + 1;
  return normalizePanelGridRectForKind({ col, row, colSpan, rowSpan }, kind);
}

function candidateSpans(
  preferred: PanelGridRect,
  minSpan: Pick<PanelGridRect, "colSpan" | "rowSpan">
): Array<Pick<PanelGridRect, "colSpan" | "rowSpan">> {
  const spans: Array<Pick<PanelGridRect, "colSpan" | "rowSpan">> = [];
  for (let colSpan = preferred.colSpan; colSpan >= minSpan.colSpan; colSpan -= 1) {
    for (let rowSpan = preferred.rowSpan; rowSpan >= minSpan.rowSpan; rowSpan -= 1) {
      spans.push({ colSpan, rowSpan });
    }
  }
  return spans.sort((a, b) => (
    Math.abs(a.colSpan * a.rowSpan - preferred.colSpan * preferred.rowSpan) -
    Math.abs(b.colSpan * b.rowSpan - preferred.colSpan * preferred.rowSpan) ||
    b.colSpan - a.colSpan ||
    b.rowSpan - a.rowSpan
  ));
}

function candidateGridRectsForSpan(
  preferred: PanelGridRect,
  span: Pick<PanelGridRect, "colSpan" | "rowSpan">
): PanelGridRect[] {
  const candidates: PanelGridRect[] = [];
  for (let row = 1; row <= panelGridSpec.rows - span.rowSpan + 1; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols - span.colSpan + 1; col += 1) {
      candidates.push({ col, row, colSpan: span.colSpan, rowSpan: span.rowSpan });
    }
  }
  return candidates.sort((a, b) => (
    candidateDistance(a, preferred) - candidateDistance(b, preferred) ||
    a.row - b.row ||
    a.col - b.col ||
    a.rowSpan - b.rowSpan ||
    a.colSpan - b.colSpan
  ));
}

function candidateDistance(candidate: PanelGridRect, preferred: PanelGridRect): number {
  const candidateCenterCol = candidate.col + candidate.colSpan / 2;
  const candidateCenterRow = candidate.row + candidate.rowSpan / 2;
  const preferredCenterCol = preferred.col + preferred.colSpan / 2;
  const preferredCenterRow = preferred.row + preferred.rowSpan / 2;
  return Math.abs(candidateCenterCol - preferredCenterCol) + Math.abs(candidateCenterRow - preferredCenterRow);
}

function gridRectOverlapsPlaced(candidate: PanelGridRect, placedBySlotId: Map<PanelSlotId, PanelGridRect>): boolean {
  for (const placed of placedBySlotId.values()) {
    if (gridRectsOverlap(candidate, placed)) {
      return true;
    }
  }
  return false;
}

function firstNonOverlappingGridRect(kind: PanelContentKind, placedBySlotId: Map<PanelSlotId, PanelGridRect>): PanelGridRect | null {
  const span = minGridSpanForKind(kind);
  for (let row = 1; row <= panelGridSpec.rows - span.rowSpan + 1; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols - span.colSpan + 1; col += 1) {
      const candidate = { col, row, colSpan: span.colSpan, rowSpan: span.rowSpan };
      if (!gridRectOverlapsPlaced(candidate, placedBySlotId)) {
        return candidate;
      }
    }
  }
  return null;
}

function uniquePanelSlotId(state: TiledPanelState, preferredId: string): PanelSlotId {
  const base = preferredId.trim() || `slot-${state.nextInstance}`;
  if (!state.slots.some((slot) => slot.id === base)) {
    return base;
  }
  let suffix = 2;
  while (state.slots.some((slot) => slot.id === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPanelContentKind(value: unknown): PanelContentKind | null {
  if (value === "indices1x1" || value === "indices2x2") {
    return "indices";
  }
  return typeof value === "string" && insertablePanelKinds.includes(value as PanelContentKind)
    ? value as PanelContentKind
    : null;
}

function readGridRect(value: unknown): PanelGridRect | null {
  if (!isRecord(value)) {
    return null;
  }
  const col = readFiniteNumber(value.col);
  const row = readFiniteNumber(value.row);
  const colSpan = readFiniteNumber(value.colSpan);
  const rowSpan = readFiniteNumber(value.rowSpan);
  if (col === null || row === null || colSpan === null || rowSpan === null) {
    return null;
  }
  const rect = normalizePanelGridRect({ col, row, colSpan, rowSpan });
  return rect.col === Math.round(col) &&
    rect.row === Math.round(row) &&
    rect.colSpan === Math.round(colSpan) &&
    rect.rowSpan === Math.round(rowSpan)
    ? rect
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLayoutMetric(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function invalidResizeYieldPlan(
  sourceSlotId: PanelSlotId,
  sourceGridRect: PanelGridRect,
  yieldedSlots: PanelResizeYieldSlot[],
  reason: string
): PanelResizeYieldPlan {
  return {
    valid: false,
    sourceSlotId,
    sourceGridRect,
    yieldedSlots,
    reason
  };
}

function yieldGridRectForResizeOverlap(
  gridRect: PanelGridRect,
  sourceGridRect: PanelGridRect,
  desiredGridRect: PanelGridRect,
  expansion: { west: boolean; east: boolean; north: boolean; south: boolean }
): PanelGridRect | null {
  let next = { ...gridRect };
  let changed = false;
  const sourceColEnd = gridRectColEnd(sourceGridRect);
  const sourceRowEnd = gridRectRowEnd(sourceGridRect);
  const desiredColEnd = gridRectColEnd(desiredGridRect);
  const desiredRowEnd = gridRectRowEnd(desiredGridRect);

  if (
    expansion.west &&
    rangesOverlap(next.row, gridRectRowEnd(next), sourceGridRect.row, sourceRowEnd) &&
    rangesOverlap(next.col, gridRectColEnd(next), desiredGridRect.col, sourceGridRect.col)
  ) {
    next = {
      ...next,
      colSpan: desiredGridRect.col - next.col
    };
    changed = true;
  }

  if (
    expansion.east &&
    rangesOverlap(next.row, gridRectRowEnd(next), sourceGridRect.row, sourceRowEnd) &&
    rangesOverlap(next.col, gridRectColEnd(next), sourceColEnd, desiredColEnd)
  ) {
    const previousColEnd = gridRectColEnd(next);
    next = {
      ...next,
      col: desiredColEnd,
      colSpan: previousColEnd - desiredColEnd
    };
    changed = true;
  }

  if (
    expansion.north &&
    rangesOverlap(next.col, gridRectColEnd(next), sourceGridRect.col, sourceColEnd) &&
    rangesOverlap(next.row, gridRectRowEnd(next), desiredGridRect.row, sourceGridRect.row)
  ) {
    next = {
      ...next,
      rowSpan: desiredGridRect.row - next.row
    };
    changed = true;
  }

  if (
    expansion.south &&
    rangesOverlap(next.col, gridRectColEnd(next), sourceGridRect.col, sourceColEnd) &&
    rangesOverlap(next.row, gridRectRowEnd(next), sourceRowEnd, desiredRowEnd)
  ) {
    const previousRowEnd = gridRectRowEnd(next);
    next = {
      ...next,
      row: desiredRowEnd,
      rowSpan: previousRowEnd - desiredRowEnd
    };
    changed = true;
  }

  return changed ? next : null;
}

function gridCellInsideGrid(cell: PanelGridCell): boolean {
  return cell.col >= 1 &&
    cell.col <= panelGridSpec.cols &&
    cell.row >= 1 &&
    cell.row <= panelGridSpec.rows;
}

function recommendedGridRectCandidates(
  state: TiledPanelState,
  kind: PanelContentKind,
  span: Pick<PanelGridRect, "colSpan" | "rowSpan">,
  exceptSlotId?: PanelSlotId
): PanelGridRect[] {
  const candidates: PanelGridRect[] = [];
  for (let row = 1; row <= panelGridSpec.rows - span.rowSpan + 1; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols - span.colSpan + 1; col += 1) {
      const candidate = { col, row, colSpan: span.colSpan, rowSpan: span.rowSpan };
      if (canPlaceGridRect(state, candidate, { exceptSlotId, kind })) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function emptyGridComponentCellKeys(
  state: TiledPanelState,
  start: PanelGridCell,
  exceptSlotId?: PanelSlotId
): Set<string> {
  const occupied = new Set<string>();
  state.slots.forEach((slot) => {
    if (slot.id === exceptSlotId) {
      return;
    }
    for (let row = slot.gridRect.row; row < slot.gridRect.row + slot.gridRect.rowSpan; row += 1) {
      for (let col = slot.gridRect.col; col < slot.gridRect.col + slot.gridRect.colSpan; col += 1) {
        occupied.add(panelGridCellKey({ col, row }));
      }
    }
  });
  if (occupied.has(panelGridCellKey(start))) {
    return new Set();
  }
  const connected = new Set<string>();
  const queue: PanelGridCell[] = [start];
  while (queue.length) {
    const cell = queue.shift()!;
    const key = panelGridCellKey(cell);
    if (!gridCellInsideGrid(cell) || occupied.has(key) || connected.has(key)) {
      continue;
    }
    connected.add(key);
    queue.push(
      { col: cell.col - 1, row: cell.row },
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row - 1 },
      { col: cell.col, row: cell.row + 1 }
    );
  }
  return connected;
}

function gridRectFitsCellKeys(gridRect: PanelGridRect, cells: Set<string>): boolean {
  for (let row = gridRect.row; row < gridRect.row + gridRect.rowSpan; row += 1) {
    for (let col = gridRect.col; col < gridRect.col + gridRect.colSpan; col += 1) {
      if (!cells.has(panelGridCellKey({ col, row }))) {
        return false;
      }
    }
  }
  return true;
}

function panelGridCellKey(cell: PanelGridCell): string {
  return `${cell.col}:${cell.row}`;
}

function compareRecommendedGridRectCandidates(
  left: PanelGridRect,
  right: PanelGridRect,
  targetCell: PanelGridCell
): number {
  const leftContainsTarget = gridRectContainsCell(left, targetCell) ? 1 : 0;
  const rightContainsTarget = gridRectContainsCell(right, targetCell) ? 1 : 0;
  return rightContainsTarget - leftContainsTarget ||
    dropGridRectDistance(left, targetCell) - dropGridRectDistance(right, targetCell) ||
    left.row - right.row ||
    left.col - right.col;
}

function dropGridRectDistance(rect: PanelGridRect, targetCell: PanelGridCell): number {
  const centerCol = rect.col + (rect.colSpan - 1) / 2;
  const centerRow = rect.row + (rect.rowSpan - 1) / 2;
  return Math.abs(centerCol - targetCell.col) + Math.abs(centerRow - targetCell.row);
}

function recommendedGridRectAroundCell(
  cell: PanelGridCell,
  span: Pick<PanelGridRect, "colSpan" | "rowSpan">
): PanelGridRect {
  return normalizePanelGridRect({
    col: cell.col - Math.floor((span.colSpan - 1) / 2),
    row: cell.row - Math.floor((span.rowSpan - 1) / 2),
    colSpan: span.colSpan,
    rowSpan: span.rowSpan
  }, span);
}

function gridRectContainsCell(rect: PanelGridRect, cell: PanelGridCell): boolean {
  return cell.col >= rect.col &&
    cell.col < rect.col + rect.colSpan &&
    cell.row >= rect.row &&
    cell.row < rect.row + rect.rowSpan;
}

function gridRectColEnd(rect: PanelGridRect): number {
  return rect.col + rect.colSpan;
}

function gridRectRowEnd(rect: PanelGridRect): number {
  return rect.row + rect.rowSpan;
}

function gridRectEquals(left: PanelGridRect, right: PanelGridRect): boolean {
  return left.col === right.col &&
    left.row === right.row &&
    left.colSpan === right.colSpan &&
    left.rowSpan === right.rowSpan;
}

function gridRectMeetsMinSpan(rect: PanelGridRect, kind: PanelContentKind): boolean {
  const minSpan = minGridSpanForKind(kind);
  return rect.colSpan >= minSpan.colSpan && rect.rowSpan >= minSpan.rowSpan;
}

function layoutGridRectsOverlap(slots: PanelSlot[]): boolean {
  for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex += 1) {
      if (gridRectsOverlap(slots[leftIndex]!.gridRect, slots[rightIndex]!.gridRect)) {
        return true;
      }
    }
  }
  return false;
}

function firstAvailableGridRect(state: TiledPanelState, kind: PanelContentKind): PanelGridRect | null {
  const span = defaultGridSpanForKind(kind);
  for (let row = 1; row <= panelGridSpec.rows - span.rowSpan + 1; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols - span.colSpan + 1; col += 1) {
      const candidate = { col, row, colSpan: span.colSpan, rowSpan: span.rowSpan };
      if (canPlaceGridRect(state, candidate, { kind })) {
        return candidate;
      }
    }
  }
  const minSpan = readableMinGridSpanForKind(kind);
  for (let row = 1; row <= panelGridSpec.rows - minSpan.rowSpan + 1; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols - minSpan.colSpan + 1; col += 1) {
      const candidate = { col, row, colSpan: minSpan.colSpan, rowSpan: minSpan.rowSpan };
      if (canPlaceGridRect(state, candidate, { kind })) {
        return candidate;
      }
    }
  }
  return null;
}

function sharedVerticalBoundary(a: PanelSlot, b: PanelSlot, gutter: number): PanelBoundary | null {
  const aRight = rectRight(a.rect);
  const bRight = rectRight(b.rect);
  if (almostEqual(b.rect.left - aRight, gutter)) {
    return boundaryFromOverlap("vertical", aRight + gutter / 2, a, b, verticalOverlap(a, b));
  }
  if (almostEqual(a.rect.left - bRight, gutter)) {
    return boundaryFromOverlap("vertical", bRight + gutter / 2, b, a, verticalOverlap(a, b));
  }
  return null;
}

function sharedHorizontalBoundary(a: PanelSlot, b: PanelSlot, gutter: number): PanelBoundary | null {
  const aBottom = rectBottom(a.rect);
  const bBottom = rectBottom(b.rect);
  if (almostEqual(b.rect.top - aBottom, gutter)) {
    return boundaryFromOverlap("horizontal", aBottom + gutter / 2, a, b, horizontalOverlap(a, b));
  }
  if (almostEqual(a.rect.top - bBottom, gutter)) {
    return boundaryFromOverlap("horizontal", bBottom + gutter / 2, b, a, horizontalOverlap(a, b));
  }
  return null;
}

function boundaryFromOverlap(
  orientation: PanelBoundaryOrientation,
  position: number,
  negative: PanelSlot,
  positive: PanelSlot,
  overlap: { start: number; end: number }
): PanelBoundary | null {
  if (overlap.end - overlap.start <= epsilon) {
    return null;
  }
  return withBoundaryId({
    id: "",
    orientation,
    position,
    rangeStart: overlap.start,
    rangeEnd: overlap.end,
    negativeSlotIds: [negative.id],
    positiveSlotIds: [positive.id]
  });
}

function mergeBoundarySegments(boundaries: PanelBoundary[]): PanelBoundary[] {
  const sorted = [...boundaries].sort((a, b) => (
    a.orientation.localeCompare(b.orientation) ||
    a.position - b.position ||
    a.rangeStart - b.rangeStart ||
    a.rangeEnd - b.rangeEnd
  ));
  const merged: PanelBoundary[] = [];
  for (const boundary of sorted) {
    const mergeIndex = merged.findIndex((item) => shouldMergeBoundarySegments(item, boundary));
    if (mergeIndex >= 0) {
      merged[mergeIndex] = mergeBoundarySegment(merged[mergeIndex]!, boundary);
    } else {
      merged.push(withBoundaryId({ ...boundary }));
    }
  }
  return coalesceBoundarySegments(merged);
}

function coalesceBoundarySegments(boundaries: PanelBoundary[]): PanelBoundary[] {
  const merged = [...boundaries];
  let changed = true;
  while (changed) {
    changed = false;
    for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex += 1) {
        if (shouldMergeBoundarySegments(merged[leftIndex]!, merged[rightIndex]!)) {
          merged[leftIndex] = mergeBoundarySegment(merged[leftIndex]!, merged[rightIndex]!);
          merged.splice(rightIndex, 1);
          changed = true;
          break;
        }
      }
      if (changed) {
        break;
      }
    }
  }
  return merged.sort((a, b) => (
    a.orientation.localeCompare(b.orientation) ||
    a.position - b.position ||
    a.rangeStart - b.rangeStart ||
    a.rangeEnd - b.rangeEnd
  ));
}

function shouldMergeBoundarySegments(left: PanelBoundary, right: PanelBoundary): boolean {
  return left.orientation === right.orientation &&
    almostEqual(left.position, right.position) &&
    (boundaryRangesTouchOrOverlap(left, right) || boundarySegmentsShareSameSideSlot(left, right));
}

function boundaryRangesTouchOrOverlap(left: PanelBoundary, right: PanelBoundary): boolean {
  return left.rangeEnd + epsilon >= right.rangeStart && right.rangeEnd + epsilon >= left.rangeStart;
}

function boundarySegmentsShareSameSideSlot(left: PanelBoundary, right: PanelBoundary): boolean {
  return arraysIntersect(left.negativeSlotIds, right.negativeSlotIds) ||
    arraysIntersect(left.positiveSlotIds, right.positiveSlotIds);
}

function mergeBoundarySegment(left: PanelBoundary, right: PanelBoundary): PanelBoundary {
  return withBoundaryId({
    ...left,
    rangeStart: Math.min(left.rangeStart, right.rangeStart),
    rangeEnd: Math.max(left.rangeEnd, right.rangeEnd),
    negativeSlotIds: uniqueStrings([...left.negativeSlotIds, ...right.negativeSlotIds]),
    positiveSlotIds: uniqueStrings([...left.positiveSlotIds, ...right.positiveSlotIds])
  });
}

function withBoundaryId(boundary: PanelBoundary): PanelBoundary {
  return {
    ...boundary,
    id: [
      "shared",
      boundary.orientation,
      Math.round(boundary.position),
      Math.round(boundary.rangeStart),
      Math.round(boundary.rangeEnd),
      boundary.negativeSlotIds.join("."),
      boundary.positiveSlotIds.join(".")
    ].join(":")
  };
}

function clampBoundaryDelta(
  state: TiledPanelState,
  boundary: PanelBoundary,
  delta: number,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): number {
  let minDelta = Number.NEGATIVE_INFINITY;
  let maxDelta = Number.POSITIVE_INFINITY;
  const negativeSlots = boundary.negativeSlotIds.map((id) => requiredSlot(state, id));
  const positiveSlots = boundary.positiveSlotIds.map((id) => requiredSlot(state, id));
  if (boundary.orientation === "vertical") {
    negativeSlots.forEach((slot) => {
      const minWidth = minPixelSizeForSlot(state, slot, viewport, layoutMetrics).minWidth;
      minDelta = Math.max(minDelta, minWidth - slot.rect.width);
    });
    positiveSlots.forEach((slot) => {
      const minWidth = minPixelSizeForSlot(state, slot, viewport, layoutMetrics).minWidth;
      maxDelta = Math.min(maxDelta, slot.rect.width - minWidth);
    });
  } else {
    negativeSlots.forEach((slot) => {
      const minHeight = minPixelSizeForSlot(state, slot, viewport, layoutMetrics).minHeight;
      minDelta = Math.max(minDelta, minHeight - slot.rect.height);
    });
    positiveSlots.forEach((slot) => {
      const minHeight = minPixelSizeForSlot(state, slot, viewport, layoutMetrics).minHeight;
      maxDelta = Math.min(maxDelta, slot.rect.height - minHeight);
    });
  }
  if (minDelta > maxDelta) {
    return 0;
  }
  const resolvedDelta = clamp(delta, minDelta, maxDelta);
  return delta !== 0 && resolvedDelta !== 0 && Math.sign(resolvedDelta) !== Math.sign(delta)
    ? 0
    : resolvedDelta;
}

function resizeSlotRectAtBoundary(slot: PanelSlot, boundary: PanelBoundary, delta: number): PanelSlot {
  if (boundary.negativeSlotIds.includes(slot.id)) {
    return boundary.orientation === "vertical"
      ? { ...slot, rect: { ...slot.rect, width: slot.rect.width + delta } }
      : { ...slot, rect: { ...slot.rect, height: slot.rect.height + delta } };
  }
  if (boundary.positiveSlotIds.includes(slot.id)) {
    return boundary.orientation === "vertical"
      ? { ...slot, rect: { ...slot.rect, left: slot.rect.left + delta, width: slot.rect.width - delta } }
      : { ...slot, rect: { ...slot.rect, top: slot.rect.top + delta, height: slot.rect.height - delta } };
  }
  return slot;
}

function slotRectsOverlap(slots: PanelSlot[]): boolean {
  for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex += 1) {
      if (rectsOverlap(slots[leftIndex]!.rect, slots[rightIndex]!.rect, epsilon)) {
        return true;
      }
    }
  }
  return false;
}

function arraysIntersect(left: string[], right: string[]): boolean {
  return left.some((item) => right.includes(item));
}

function minPixelSizeForSlot(
  state: TiledPanelState,
  slot: PanelSlot,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): Pick<PanelSlot, "minWidth" | "minHeight"> {
  return minPanelPixelSizeForKind(state.contents[slot.contentId]?.kind ?? "news", viewport, layoutMetrics);
}

function requiredSlot(state: TiledPanelState, slotId: PanelSlotId): PanelSlot {
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot) {
    throw new Error(`Unknown panel slot: ${slotId}`);
  }
  return slot;
}

function verticalOverlap(a: PanelSlot, b: PanelSlot): { start: number; end: number } {
  return {
    start: Math.max(a.rect.top, b.rect.top),
    end: Math.min(rectBottom(a.rect), rectBottom(b.rect))
  };
}

function horizontalOverlap(a: PanelSlot, b: PanelSlot): { start: number; end: number } {
  return {
    start: Math.max(a.rect.left, b.rect.left),
    end: Math.min(rectRight(a.rect), rectRight(b.rect))
  };
}

function rectEquals(a: PanelRect, b: PanelRect): boolean {
  return almostEqual(a.left, b.left) &&
    almostEqual(a.top, b.top) &&
    almostEqual(a.width, b.width) &&
    almostEqual(a.height, b.height);
}

function viewportFromState(state: TiledPanelState): ViewportSize {
  if (!state.slots.length) {
    return defaultViewport;
  }
  const width = Math.max(...state.slots.map((slot) => rectRight(slot.rect)), defaultViewport.width);
  const height = Math.max(...state.slots.map((slot) => rectBottom(slot.rect) + workspaceBottomInset), defaultViewport.height);
  return { width, height };
}
