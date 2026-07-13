import {
  getCandlesForDocument,
  getDataStatusForDocument,
  getLiveTradeForSymbol,
  getStreamMessageForDocument,
  getStreamStatusForDocument,
  makeChartCommand,
  type ChartRuntimeAction,
  type ChartRuntimeState
} from "@gops/chart-engine";
import {
  chartDocumentIdForContent
} from "../chart/chartDocumentAdapter";
import type { CandleDto } from "../chart/types";
import {
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { AgentReference } from "../agent/agentReferences";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import type { ChartSymbolDto } from "../chart/types";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  Trash2
} from "lucide-react";
import {
  applyPanelResizeWithYield,
  applyPanelMoveWithPush,
  addPanelSlotAtGridRect,
  detectResizablePanelBoundaries,
  expandGridRectForKind,
  gridRectForPanelDrag,
  movePanelSlotToGridRect,
  normalizePanelGridRect,
  panelGridMetrics,
  panelGridSpec,
  panelPaletteEntries,
  panelPaletteEntryLabel,
  panelPaletteEntryTitle,
  panelRectForGridRect,
  readableMinGridSpanForKind,
  panelSlotStyle,
  removePanelSlot,
  replacePanelSlotKind,
  resolveFirstAvailableRecommendedGridRect,
  resolvePanelDropGridRect,
  resolvePanelMoveWithPush,
  resolvePanelResizeWithYield,
  resizeFreeformBoundary,
  setPanelContentProps,
  slotAtGridCell,
  swapPanelContents,
  workspaceBounds,
  type PanelBoundary,
  type PanelContentInstance,
  type PanelContentKind,
  type PanelGridRect,
  type PanelResizeYieldSlot,
  type PanelSlot,
  type PanelSlotId,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "../layout/panelLayout";
import {
  disableWildPanel,
  enableWildPanel,
  setWildPanelActivePage,
  wildPanelBasePageId,
  wildPanelPageIds,
  wildPanelPages
} from "../layout/wildPanel";
import type { WorkspaceLayoutMode } from "../layout/responsivePanelLayout";
import { workspaceBottomInset } from "../layout/workspaceMetrics";
import { type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { boundaryStyle } from "./panelWorkspaceGeometry";
import { WorkspacePanelFrame } from "./WorkspacePanelFrame";
import { WildPanelAnswerPage } from "./WildPanelAnswerPage";

type PanelWorkspaceProps = {
  panelState: TiledPanelState;
  setPanelState: Dispatch<SetStateAction<TiledPanelState>>;
  viewportSize: ViewportSize;
  layoutMetrics: WorkspaceLayoutMetrics;
  layoutMode: WorkspaceLayoutMode;
  layoutEditMode: boolean;
  /** Exits layout-edit mode from the palette dock (the command bar is hidden while editing). */
  onExitLayoutEdit?: () => void;
  activeSymbol: string;
  symbols: ChartSymbolDto[];
  companyItems: Sp500UniverseItem[];
  marketItems: Sp500UniverseItem[];
  chartRuntime: ChartRuntimeState;
  selectedAgentReferenceKeys: string[];
  emphasizedAgentReferenceKeys: string[];
  emphasizeChartSelection: boolean;
  setSemanticSelection: (selection: SemanticSelectionSnapshot | null) => void;
  onAgentReferenceSelect: (reference: AgentReference) => void;
  onAgentAsk: () => void;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartHandleChange: (contentId: string, handle: ChartPanelHandle | null) => void;
  onSelectSymbol: (symbol: string) => void;
  selectedWildPanelSlotId: string | null;
  onSelectWildPanel: (slotId: string | null) => void;
  presetDock?: ReactNode;
  placementPickerOverlay?: ReactNode;
};

type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type LayoutDrag =
  | {
    mode: "boundary";
    boundaryId: string;
    orientation: PanelBoundary["orientation"];
    startX: number;
    startY: number;
    startState: TiledPanelState;
  }
  | {
    mode: "edit-move";
    sourceSlotId: PanelSlotId;
    offsetCol: number;
    offsetRow: number;
  }
  | {
    mode: "edit-resize";
    sourceSlotId: PanelSlotId;
    direction: ResizeDirection;
    startGridRect: PanelGridRect;
  }
  | {
    mode: "palette";
    kind: PanelContentKind;
    startX: number;
    startY: number;
    hasMoved: boolean;
  };

type LayoutPreview = {
  gridRect: PanelGridRect;
  kind?: PanelContentKind;
  sourceSlotId?: PanelSlotId;
  targetSlotId?: PanelSlotId;
  yieldedSlots?: PanelResizeYieldSlot[];
  mode: "move" | "resize" | "add" | "replace" | "swap";
  valid: boolean;
  label: string;
  secondary?: { gridRect: PanelGridRect; label: string };
};

type LogicalPointerPoint = {
  x: number;
  y: number;
};

const resizeDirections: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const paletteDragThreshold = 4;
const paletteStatusDurationMs = 2400;

export function PanelWorkspace({
  panelState,
  setPanelState,
  viewportSize,
  layoutMetrics,
  layoutMode,
  layoutEditMode,
  onExitLayoutEdit,
  activeSymbol,
  symbols,
  companyItems,
  marketItems,
  chartRuntime,
  selectedAgentReferenceKeys,
  emphasizedAgentReferenceKeys,
  emphasizeChartSelection,
  setSemanticSelection,
  onAgentReferenceSelect,
  onAgentAsk,
  onChartRuntimeAction,
  onChartHandleChange,
  onSelectSymbol,
  selectedWildPanelSlotId,
  onSelectWildPanel,
  presetDock,
  placementPickerOverlay
}: PanelWorkspaceProps) {
  const [hoveredChartSlotId, setHoveredChartSlotId] = useState<PanelSlotId | null>(null);
  const [activeBoundaryId, setActiveBoundaryId] = useState<string | null>(null);
  const [draggingSlotId, setDraggingSlotId] = useState<PanelSlotId | null>(null);
  const [movingSlotId, setMovingSlotId] = useState<PanelSlotId | null>(null);
  const [isLayoutResizing, setIsLayoutResizing] = useState(false);
  const [layoutPreview, setLayoutPreview] = useState<LayoutPreview | null>(null);
  const [paletteStatus, setPaletteStatus] = useState<string | null>(null);
  const [paletteOverflow, setPaletteOverflow] = useState({ left: false, right: false });
  const paletteScrollerRef = useRef<HTMLDivElement | null>(null);

  // Track horizontal overflow of the palette scroller so the < > arrows only
  // appear (and enable) when there is actually somewhere to scroll.
  useEffect(() => {
    if (!layoutEditMode) {
      return undefined;
    }
    const scroller = paletteScrollerRef.current;
    if (!scroller) {
      return undefined;
    }
    const updateOverflow = () => {
      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const left = scroller.scrollLeft > 1;
      const right = scroller.scrollLeft < maxScrollLeft - 1;
      setPaletteOverflow((current) => (
        current.left === left && current.right === right ? current : { left, right }
      ));
    };
    updateOverflow();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOverflow);
    resizeObserver?.observe(scroller);
    scroller.addEventListener("scroll", updateOverflow, { passive: true });
    window.addEventListener("resize", updateOverflow);
    return () => {
      resizeObserver?.disconnect();
      scroller.removeEventListener("scroll", updateOverflow);
      window.removeEventListener("resize", updateOverflow);
    };
  }, [layoutEditMode]);

  const scrollPaletteBy = useCallback((direction: -1 | 1) => {
    const scroller = paletteScrollerRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollBy({
      left: direction * Math.max(160, scroller.clientWidth * 0.7),
      behavior: "smooth"
    });
  }, []);
  const [chartHeaders, setChartHeaders] = useState<Record<string, ChartHeaderSnapshot>>({});
  const [chartAddTargetContentId, setChartAddTargetContentId] = useState<string | null>(null);
  const dragRef = useRef<LayoutDrag | null>(null);
  const panelStateRef = useRef<TiledPanelState>(panelState);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);
  const layoutMetricsRef = useRef<WorkspaceLayoutMetrics>(layoutMetrics);
  const paletteStatusTimeoutRef = useRef<number | null>(null);
  const companyItemsBySymbol = useMemo(() => (
    new Map(companyItems.map((item) => [item.symbol.toUpperCase(), item]))
  ), [companyItems]);

  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  useEffect(() => {
    layoutMetricsRef.current = layoutMetrics;
  }, [layoutMetrics]);

  useEffect(() => () => {
    if (paletteStatusTimeoutRef.current !== null) {
      window.clearTimeout(paletteStatusTimeoutRef.current);
    }
  }, []);

  const panelBoundaries = useMemo(
    () => detectResizablePanelBoundaries(panelState, viewportSize, layoutMetrics),
    [layoutMetrics, panelState, viewportSize]
  );
  const activeBoundary = useMemo(() => (
    activeBoundaryId ? panelBoundaries.find((boundary) => boundary.id === activeBoundaryId) ?? null : null
  ), [activeBoundaryId, panelBoundaries]);
  const activeBoundarySlotIds = useMemo(() => (
    new Set([...(activeBoundary?.negativeSlotIds ?? []), ...(activeBoundary?.positiveSlotIds ?? [])])
  ), [activeBoundary]);
  const setChartSlotHover = useCallback((slotId: PanelSlotId, hovered: boolean) => {
    setHoveredChartSlotId((current) => {
      if (hovered) {
        return slotId;
      }
      return current === slotId ? null : current;
    });
  }, []);

  const recordChartHeader = useCallback((content: PanelContentInstance, header: ChartHeaderSnapshot) => {
    setChartHeaders((current) => (
      chartHeaderEquals(current[content.id], header)
        ? current
        : { ...current, [content.id]: header }
    ));
  }, []);

  const commitLayoutPreview = useCallback((preview: LayoutPreview) => {
    if (!preview.valid) {
      return;
    }
    if (preview.mode === "move" && preview.sourceSlotId) {
      setPanelState((current) => {
        // Push overlapping panels out of the way; fall back to a plain move if push fails.
        const pushPlan = resolvePanelMoveWithPush(current, preview.sourceSlotId!, preview.gridRect);
        if (pushPlan.valid) {
          return applyPanelMoveWithPush(current, pushPlan, viewportSizeRef.current, layoutMetricsRef.current);
        }
        return movePanelSlotToGridRect(
          current,
          preview.sourceSlotId!,
          preview.gridRect,
          viewportSizeRef.current,
          layoutMetricsRef.current
        );
      });
      return;
    }
    if (preview.mode === "resize" && preview.sourceSlotId) {
      setPanelState((current) => applyPanelResizeWithYield(
        current,
        resolvePanelResizeWithYield(current, preview.sourceSlotId!, preview.gridRect),
        viewportSizeRef.current,
        layoutMetricsRef.current
      ));
      return;
    }
    if (preview.mode === "swap" && preview.sourceSlotId && preview.targetSlotId) {
      setPanelState((current) => swapPanelContents(
        current,
        preview.sourceSlotId!,
        preview.targetSlotId!,
        viewportSizeRef.current,
        layoutMetricsRef.current
      ));
      return;
    }
    if (preview.mode === "add" && preview.kind) {
      setPanelState((current) => addPanelAtPreview(current, preview, activeSymbol, viewportSizeRef.current, layoutMetricsRef.current));
      return;
    }
    if (preview.mode === "replace" && preview.kind && preview.targetSlotId) {
      setPanelState((current) => replacePanelSlotKind(
        current,
        preview.targetSlotId!,
        preview.kind!,
        viewportSizeRef.current,
        { symbol: preview.kind === "chart" || preview.kind === "company" ? activeSymbol : undefined },
        layoutMetricsRef.current
      ));
    }
  }, [activeSymbol, setPanelState]);

  const resolveEditDragPreview = useCallback((drag: LayoutDrag, point: LogicalPointerPoint): LayoutPreview | null => {
    if (drag.mode === "boundary") {
      return null;
    }
    const viewport = viewportSizeRef.current;
    const metrics = layoutMetricsRef.current;
    const cell = panelGridCellFromPointSafe(viewport, point.x, point.y, metrics);
    if (!cell) {
      return null;
    }
    const state = panelStateRef.current;
    if (drag.mode === "palette") {
      const target = slotAtGridCell(state, cell);
      if (target) {
        const gridRect = expandGridRectForKind(state, target.gridRect, drag.kind, target.id) ?? target.gridRect;
        const valid = Boolean(expandGridRectForKind(state, target.gridRect, drag.kind, target.id));
        return {
          gridRect,
          kind: drag.kind,
          targetSlotId: target.id,
          mode: "replace",
          valid,
          label: panelPaletteEntryTitle(drag.kind)
        };
      }
      const dropPlan = resolvePanelDropGridRect(state, drag.kind, cell);
      return {
        gridRect: dropPlan.gridRect,
        kind: drag.kind,
        mode: "add",
        valid: dropPlan.valid,
        label: panelPaletteEntryTitle(drag.kind)
      };
    }
    if (drag.mode === "edit-move") {
      const source = state.slots.find((slot) => slot.id === drag.sourceSlotId);
      const kind = source ? state.contents[source.contentId]?.kind : null;
      if (!source || !kind) {
        return null;
      }
      const sourceTitle = state.contents[source.contentId]?.title ?? "패널";
      const gridRect = gridRectForPanelDrag(source.gridRect, cell, {
        col: drag.offsetCol,
        row: drag.offsetRow
      });
      const target = slotAtGridCell(state, cell, source.id);
      if (target && panelGridRectsEqual(gridRect, target.gridRect)) {
        return {
          gridRect: target.gridRect,
          kind,
          sourceSlotId: source.id,
          targetSlotId: target.id,
          mode: "swap",
          valid: true,
          label: sourceTitle,
          secondary: {
            gridRect: source.gridRect,
            label: contentTitleForSlot(state, target.id)
          }
        };
      }
      const pushPlan = resolvePanelMoveWithPush(state, source.id, gridRect);
      return {
        gridRect,
        kind,
        sourceSlotId: source.id,
        mode: "move",
        valid: pushPlan.valid,
        yieldedSlots: pushPlan.pushedSlots,
        label: sourceTitle
      };
    }
    const source = state.slots.find((slot) => slot.id === drag.sourceSlotId);
    const kind = source ? state.contents[source.contentId]?.kind : null;
    if (!source || !kind) {
      return null;
    }
    const gridRect = normalizePanelGridRect(
      resizeGridRectFromCell(drag.startGridRect, drag.direction, cell),
      readableMinGridSpanForKind(kind)
    );
    const resizePlan = resolvePanelResizeWithYield(state, source.id, gridRect);
    return {
      gridRect: resizePlan.sourceGridRect,
      kind,
      sourceSlotId: source.id,
      yieldedSlots: resizePlan.yieldedSlots,
      mode: "resize",
      valid: resizePlan.valid,
      label: resizePlan.valid && resizePlan.yieldedSlots.length ? "크기 변경 / 자리 양보" : "크기 변경"
    };
  }, []);

  const clearPaletteStatus = useCallback(() => {
    if (paletteStatusTimeoutRef.current !== null) {
      window.clearTimeout(paletteStatusTimeoutRef.current);
      paletteStatusTimeoutRef.current = null;
    }
    setPaletteStatus(null);
  }, []);

  const showPaletteStatus = useCallback((message: string) => {
    if (paletteStatusTimeoutRef.current !== null) {
      window.clearTimeout(paletteStatusTimeoutRef.current);
    }
    setPaletteStatus(message);
    paletteStatusTimeoutRef.current = window.setTimeout(() => {
      paletteStatusTimeoutRef.current = null;
      setPaletteStatus(null);
    }, paletteStatusDurationMs);
  }, []);

  const addPalettePanelAtFirstAvailable = useCallback((kind: PanelContentKind) => {
    const gridRect = resolveFirstAvailableRecommendedGridRect(panelStateRef.current, kind);
    if (!gridRect) {
      showPaletteStatus("추천 크기로 배치할 공간이 없습니다");
      return;
    }
    clearPaletteStatus();
    setPanelState((current) => {
      const currentGridRect = resolveFirstAvailableRecommendedGridRect(current, kind);
      if (!currentGridRect) {
        return current;
      }
      return addPanelSlotAtGridRect(current, kind, currentGridRect, {
        symbol: kind === "chart" || kind === "company" ? activeSymbol : undefined
      }, viewportSizeRef.current, layoutMetricsRef.current);
    });
  }, [activeSymbol, clearPaletteStatus, setPanelState, showPaletteStatus]);

  const finishLayoutDrag = useCallback((event?: PointerEvent) => {
    const drag = dragRef.current;
    if (drag && drag.mode !== "boundary" && event) {
      const point = logicalPointFromClientPoint(event.clientX, event.clientY);
      if (
        drag.mode === "palette" &&
        !drag.hasMoved &&
        Math.hypot(point.x - drag.startX, point.y - drag.startY) < paletteDragThreshold
      ) {
        addPalettePanelAtFirstAvailable(drag.kind);
      } else {
        if (drag.mode === "palette") {
          drag.hasMoved = true;
        }
        const preview = resolveEditDragPreview(
          drag,
          point
        ) ?? layoutPreview;
        if (preview) {
          commitLayoutPreview(preview);
        }
      }
    }
    dragRef.current = null;
    setActiveBoundaryId(null);
    setDraggingSlotId(null);
    setMovingSlotId(null);
    setIsLayoutResizing(false);
    setLayoutPreview(null);
  }, [addPalettePanelAtFirstAvailable, commitLayoutPreview, layoutPreview, resolveEditDragPreview]);

  const applyLayoutDrag = useCallback((point: LogicalPointerPoint, viewport: ViewportSize) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.mode !== "boundary") {
      if (drag.mode === "palette" && !drag.hasMoved) {
        const distance = Math.hypot(point.x - drag.startX, point.y - drag.startY);
        if (distance < paletteDragThreshold) {
          setLayoutPreview(null);
          return;
        }
        drag.hasMoved = true;
      }
      setLayoutPreview(resolveEditDragPreview(drag, point));
      return;
    }
    const delta = drag.orientation === "vertical" ? point.x - drag.startX : point.y - drag.startY;
    setPanelState(resizeFreeformBoundary(drag.startState, drag.boundaryId, delta, viewport, layoutMetricsRef.current));
  }, [resolveEditDragPreview, setPanelState]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current) {
        return;
      }
      event.preventDefault();
      applyLayoutDrag(logicalPointFromClientPoint(event.clientX, event.clientY), viewportSizeRef.current);
    };
    const handlePointerUp = (event: PointerEvent) => finishLayoutDrag(event);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [applyLayoutDrag, finishLayoutDrag]);

  const beginBoundaryResize = (boundary: PanelBoundary) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    setActiveBoundaryId(boundary.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsLayoutResizing(true);
    const point = logicalPointFromClientPoint(event.clientX, event.clientY);
    dragRef.current = {
      mode: "boundary",
      boundaryId: boundary.id,
      orientation: boundary.orientation,
      startX: point.x,
      startY: point.y,
      startState: panelState
    };
  };

  const beginPanelEditMove = (slotId: PanelSlotId) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!layoutEditMode || event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".panel-edit-button")) {
      return;
    }
    const slot = panelStateRef.current.slots.find((item) => item.id === slotId);
    if (!slot) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingSlotId(slotId);
    const rect = event.currentTarget.getBoundingClientRect();
    const resizeDirection = resizeDirectionForFramePoint(rect, event.clientX, event.clientY);
    const point = logicalPointFromClientPoint(event.clientX, event.clientY);
    let drag: LayoutDrag;
    if (resizeDirection) {
      drag = {
        mode: "edit-resize",
        sourceSlotId: slotId,
        direction: resizeDirection,
        startGridRect: slot.gridRect
      };
    } else {
      const cell = panelGridCellFromPointSafe(viewportSizeRef.current, point.x, point.y, layoutMetricsRef.current);
      drag = {
        mode: "edit-move",
        sourceSlotId: slotId,
        offsetCol: cell ? Math.max(0, cell.col - slot.gridRect.col) : 0,
        offsetRow: cell ? Math.max(0, cell.row - slot.gridRect.row) : 0
      };
    }
    dragRef.current = drag;
    setMovingSlotId(drag.mode === "edit-move" ? slotId : null);
    setLayoutPreview(resolveEditDragPreview(drag, point));
  };

  const updateFrameCursor = (_slotId: PanelSlotId) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!layoutEditMode || dragRef.current) {
      return;
    }
    const target = event.currentTarget;
    if (event.target instanceof Element && event.target.closest(".panel-edit-button")) {
      target.style.cursor = "";
      return;
    }
    const rect = target.getBoundingClientRect();
    const direction = resizeDirectionForFramePoint(rect, event.clientX, event.clientY);
    // Empty string lets the `.is-layout-editing { cursor: grab }` rule take over for the interior,
    // so the cursor also resets correctly when edit mode ends.
    target.style.cursor = direction ? resizeCursorForDirection(direction) : "";
  };

  const beginPanelResize = (slotId: PanelSlotId, direction: ResizeDirection) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layoutEditMode || event.button !== 0) {
      return;
    }
    const slot = panelStateRef.current.slots.find((item) => item.id === slotId);
    if (!slot) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingSlotId(slotId);
    setMovingSlotId(null);
    const drag: LayoutDrag = {
      mode: "edit-resize",
      sourceSlotId: slotId,
      direction,
      startGridRect: slot.gridRect
    };
    dragRef.current = drag;
    setLayoutPreview(resolveEditDragPreview(drag, logicalPointFromClientPoint(event.clientX, event.clientY)));
  };

  const beginPaletteDrag = (kind: PanelContentKind) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layoutEditMode || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = logicalPointFromClientPoint(event.clientX, event.clientY);
    const drag: LayoutDrag = {
      mode: "palette",
      kind,
      startX: point.x,
      startY: point.y,
      hasMoved: false
    };
    dragRef.current = drag;
    setMovingSlotId(null);
    clearPaletteStatus();
    setLayoutPreview(null);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    applyLayoutDrag(logicalPointFromClientPoint(event.clientX, event.clientY), viewportSize);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    finishLayoutDrag(event.nativeEvent);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can be released by the browser when a drag leaves the element.
    }
  };

  const closePanel = (slotId: PanelSlotId) => {
    const closing = panelStateRef.current.slots.find((slot) => slot.id === slotId);
    setPanelState((current) => removePanelSlot(current, slotId, viewportSizeRef.current, layoutMetricsRef.current));
    if (closing) {
      setChartHeaders((current) => {
        const next = { ...current };
        delete next[closing.contentId];
        return next;
      });
      if (closing.contentId === chartAddTargetContentId) {
        setChartAddTargetContentId(null);
      }
      onChartHandleChange(closing.contentId, null);
    }
    setHoveredChartSlotId((current) => current === slotId ? null : current);
    setActiveBoundaryId(null);
  };

  const changePanelChartSymbol = (contentId: string, symbol: string) => {
    const slot = panelStateRef.current.slots.find((item) => item.contentId === contentId);
    const content = slot ? panelStateRef.current.contents[slot.contentId] : null;
    if (!slot || !content || content.kind !== "chart") {
      return;
    }
    onChartRuntimeAction({
      kind: "chart.command",
      command: makeChartCommand(
        "chart.symbol.set",
        "user",
        { panelId: slot.id, chartDocumentId: chartDocumentIdForContent(content) },
        { symbol }
      )
    });
    // Keep the panel content in sync so the symbol label and company tab follow the chart.
    updatePanelProps(contentId, { symbol });
  };

  const toggleChartAddTarget = (contentId: string) => {
    setChartAddTargetContentId((current) => current === contentId ? null : contentId);
  };

  const updatePanelProps = useCallback((contentId: string, props: Record<string, unknown>) => {
    setPanelState((current) => setPanelContentProps(current, contentId, props));
  }, [setPanelState]);

  const toggleWildPanel = useCallback((slotId: PanelSlotId) => {
    const slot = panelStateRef.current.slots.find((item) => item.id === slotId);
    if (!slot) {
      return;
    }
    if (slot.wildPanel) {
      setPanelState((current) => disableWildPanel(current, slotId));
      if (selectedWildPanelSlotId === slotId) {
        onSelectWildPanel(null);
      }
      return;
    }
    setPanelState((current) => enableWildPanel(current, slotId));
    onSelectWildPanel(slotId);
  }, [onSelectWildPanel, selectedWildPanelSlotId, setPanelState]);

  const renderPanelEditControls = (slotId: PanelSlotId, content: PanelContentInstance) => {
    if (!layoutEditMode) {
      return null;
    }
    return (
      <div className="panel-edit-overlay" aria-label={`${content.title || "차트"} 편집 컨트롤`}>
        <div className="panel-edit-snapshot-shield" aria-hidden="true" />
        {resizeDirections.map((direction) => (
          <button
            key={direction}
            type="button"
            className={`panel-edit-button panel-resize-handle ${direction}`}
            aria-label={`${content.title || "차트"} ${resizeDirectionLabel(direction)} 크기 조절`}
            title="크기 조절"
            onPointerDown={beginPanelResize(slotId, direction)}
            onPointerMove={updateDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {resizeDirectionIcon(direction)}
          </button>
        ))}
        <button
          type="button"
          className="panel-edit-button panel-delete-button"
          aria-label={`${content.title || "차트"} 패널 삭제`}
          title="패널 삭제"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => closePanel(slotId)}
        >
          <Trash2 size={22} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    );
  };

  const scrollBounds = workspaceBounds(viewportSize, layoutMetrics);
  const scrollExtentStyle: CSSProperties = {
    width: scrollBounds.width,
    height: scrollBounds.top + scrollBounds.height + (layoutMetrics.bottomInset ?? workspaceBottomInset)
  };
  const primaryChartContent = panelState.slots
    .map((slot) => panelState.contents[slot.contentId])
    .find((content) => content?.kind === "chart");
  const primaryChartDocument = primaryChartContent
    ? chartRuntime.documents[chartDocumentIdForContent(primaryChartContent)]
    : undefined;
  const primaryChartCandles = primaryChartDocument
    ? getCandlesForDocument(chartRuntime, primaryChartDocument) as CandleDto[]
    : [];
  const renderWorkspacePanel = (slot: PanelSlot) => {
    const content = panelState.contents[slot.contentId];
    if (!content) {
      return null;
    }
    const isChart = content.kind === "chart";
    const hidePanelNav = isChart || content.kind === "indices" || isPortfolioPanelKind(content.kind);
    const chartDocument = isChart ? chartRuntime.documents[chartDocumentIdForContent(content)] : undefined;
    const chartCandles = chartDocument ? getCandlesForDocument(chartRuntime, chartDocument) as CandleDto[] : [];
    const chartDataStatus = chartDocument ? getDataStatusForDocument(chartRuntime, chartDocument) : undefined;
    const chartStreamStatus = chartDocument ? getStreamStatusForDocument(chartRuntime, chartDocument) : undefined;
    const chartStreamMessage = chartDocument ? getStreamMessageForDocument(chartRuntime, chartDocument) : undefined;
    const chartLiveTrade = chartDocument ? getLiveTradeForSymbol(chartRuntime, chartDocument.symbol) : undefined;
    const contentSymbol = (readContentSymbol(content) ?? chartDocument?.symbol ?? activeSymbol).toUpperCase();
    const previewGridRect = layoutPreview?.mode === "resize"
      && layoutPreview.valid
      && layoutPreview.sourceSlotId === slot.id
      ? layoutPreview.gridRect
      : null;
    const effectiveGridRect = previewGridRect ?? slot.gridRect;
    const wildPages = wildPanelPages(slot.wildPanel);
    const wildPageIds = slot.wildPanel ? wildPanelPageIds(slot.wildPanel) : [wildPanelBasePageId];
    const activePageId = slot.wildPanel?.activePageId ?? wildPanelBasePageId;
    const activePageIndex = Math.max(0, wildPageIds.indexOf(activePageId));
    const activeWildPage = wildPages.find((page) => page.id === activePageId) ?? null;
    const activePageLabel = activeWildPage
      ? activeWildPage.kind === "chartCommentary"
        ? "차트 해설"
        : `에이전트 답변 · ${activeWildPage.role}`
      : content.title;
    const selectWildPanel = (event: ReactPointerEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest(".wild-panel-toggle")) {
        return;
      }
      if (!layoutEditMode && slot.wildPanel && selectedWildPanelSlotId !== slot.id) {
        onSelectWildPanel(slot.id);
      }
    };
    const showWildPage = (index: number) => {
      const pageId = wildPageIds[index];
      if (!pageId) {
        return;
      }
      setPanelState((current) => setWildPanelActivePage(current, slot.id, pageId));
    };
    const originalPanelContent = (
      <PanelContentRenderer
        slot={slot}
        content={content}
        symbol={contentSymbol}
        symbols={symbols}
        companyItem={companyItemsBySymbol.get(contentSymbol)}
        companyItems={companyItems}
        marketItems={marketItems}
        laneHeight={Math.max(120, slot.rect.height)}
        effectiveColSpan={effectiveGridRect.colSpan}
        effectiveRowSpan={effectiveGridRect.rowSpan}
        layoutResizeSuspended={Boolean(previewGridRect)}
        chartHeaderSnapshot={chartHeaders[content.id]}
        chartDocument={chartDocument}
        chartCandles={chartCandles}
        activeChartDocument={primaryChartDocument}
        activeChartCandles={primaryChartCandles}
        chartDataStatus={chartDataStatus}
        chartStreamStatus={chartStreamStatus}
        chartStreamMessage={chartStreamMessage}
        chartLiveTrade={chartLiveTrade}
        chartAddActive={chartAddTargetContentId === content.id}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
        emphasizeChartSelection={emphasizeChartSelection}
        setSemanticSelection={setSemanticSelection}
        onAgentReferenceSelect={onAgentReferenceSelect}
        onAgentAsk={onAgentAsk}
        onChartRuntimeAction={onChartRuntimeAction}
        onChartHoverChange={(hovered) => setChartSlotHover(slot.id, hovered)}
        onHeaderChange={isChart ? (header) => recordChartHeader(content, header) : undefined}
        onChartHandleChange={onChartHandleChange}
        onChartAddToggle={() => toggleChartAddTarget(content.id)}
        onUpdatePanelProps={updatePanelProps}
        onChangePanelChartSymbol={changePanelChartSymbol}
        onSelectSymbol={onSelectSymbol}
      />
    );
    return (
      <WorkspacePanelFrame
        key={slot.id}
        slot={slot}
        content={content}
        style={panelSlotStyle(slot)}
        className={[
          isChart && slot.rect.left > 1 ? "has-left-boundary" : "",
          isChart && slot.rect.left + slot.rect.width < viewportSize.width - 1 ? "has-right-boundary" : "",
          draggingSlotId === slot.id ? "is-panel-content-dragging" : "",
          movingSlotId === slot.id ? "is-panel-position-dragging" : "",
          isLayoutResizing ? "is-layout-resizing" : "",
          slot.wildPanel ? "is-wild-panel" : "",
          selectedWildPanelSlotId === slot.id ? "is-selected-wild-panel" : "",
          `is-layout-${layoutMode}`,
          layoutEditMode ? "is-layout-editing" : ""
        ].filter(Boolean).join(" ")}
        isBoundaryActive={activeBoundarySlotIds.has(slot.id)}
        isChartHovered={isChart && (hoveredChartSlotId === slot.id || chartAddTargetContentId === content.id)}
        showNav={!hidePanelNav}
        onFramePointerDown={layoutEditMode ? beginPanelEditMove : undefined}
        onFramePointerMove={layoutEditMode ? updateFrameCursor : undefined}
        onPointerEnter={() => isChart && setChartSlotHover(slot.id, true)}
        onPointerLeave={() => {
          if (isChart && !dragRef.current) {
            setChartSlotHover(slot.id, false);
          }
        }}
        onPointerDownCapture={selectWildPanel}
        onFocusCapture={() => {
          if (!layoutEditMode && slot.wildPanel && selectedWildPanelSlotId !== slot.id) {
            onSelectWildPanel(slot.id);
          }
        }}
        frameActions={layoutEditMode ? (
          <button
            type="button"
            className={`wild-panel-toggle ${slot.wildPanel ? "is-active" : ""}`}
            aria-label={slot.wildPanel ? `${content.title} wild 상태 해제` : `${content.title} wild 상태로 전환`}
            title={slot.wildPanel ? "Wild panel 해제" : "Wild panel로 전환"}
            aria-pressed={Boolean(slot.wildPanel)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => toggleWildPanel(slot.id)}
          >
            <Layers size={15} aria-hidden="true" />
          </button>
        ) : null}
        editControls={renderPanelEditControls(slot.id, content)}
      >
        <div className={`wild-panel-original-page ${activeWildPage ? "is-concealed" : ""}`} aria-hidden={Boolean(activeWildPage)}>
          {originalPanelContent}
        </div>
        {activeWildPage && (
          <div className="wild-panel-answer-layer">
            <WildPanelAnswerPage page={activeWildPage} />
          </div>
        )}
        {slot.wildPanel && wildPageIds.length > 1 && (
          <>
            <span className="wild-panel-page-indicator" aria-live="polite">
              {activePageLabel} · {activePageIndex + 1}/{wildPageIds.length}
            </span>
            <button
              type="button"
              className="wild-panel-page-arrow previous"
              aria-label="이전 wild panel 페이지"
              disabled={activePageIndex === 0}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => showWildPage(activePageIndex - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="wild-panel-page-arrow next"
              aria-label="다음 wild panel 페이지"
              disabled={activePageIndex === wildPageIds.length - 1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => showWildPage(activePageIndex + 1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </>
        )}
      </WorkspacePanelFrame>
    );
  };

  return (
    <>
      <div className="workspace-scroll-extent" style={scrollExtentStyle} aria-hidden="true" />
      {layoutEditMode && (
        <div className="workspace-edit-grid" aria-hidden="true">
          {workspaceGridCells(viewportSize, layoutMetrics).map((cell) => (
            <span key={`${cell.col}-${cell.row}`} className="workspace-edit-grid-cell" style={cell.style} />
          ))}
        </div>
      )}
      {panelState.slots.map((slot) => renderWorkspacePanel(slot))}
      {!layoutEditMode && panelBoundaries.map((boundary) => (
        <div
          key={boundary.id}
          className={[
            "panel-boundary",
            boundary.orientation,
            "can-resize",
            activeBoundaryId === boundary.id ? "is-active" : ""
          ].join(" ")}
          style={boundaryStyle(boundary)}
          role="separator"
          aria-orientation={boundary.orientation === "vertical" ? "vertical" : "horizontal"}
          onPointerEnter={() => setActiveBoundaryId(boundary.id)}
          onPointerLeave={() => {
            if (!dragRef.current) {
              setActiveBoundaryId(null);
            }
          }}
          onPointerDown={beginBoundaryResize(boundary)}
          onPointerMove={(event) => {
            setActiveBoundaryId(boundary.id);
            updateDrag(event);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ))}
      {layoutPreview && (
        <>
          {layoutPreview.valid && layoutPreview.yieldedSlots?.map((yielded) => (
            <div
              key={`yield-${yielded.slotId}`}
              className="layout-edit-preview is-yielded"
              style={panelRectForGridRect(yielded.gridRect, viewportSize, layoutMetrics)}
              aria-hidden="true"
            >
              <span>자리 양보</span>
            </div>
          ))}
          <div
            className={[
              "layout-edit-preview",
              layoutPreview.valid ? "is-valid" : "is-invalid",
              `mode-${layoutPreview.mode}`
            ].join(" ")}
            style={panelRectForGridRect(layoutPreview.gridRect, viewportSize, layoutMetrics)}
            aria-hidden="true"
          >
            <PanelLayoutGhost label={layoutPreview.label} />
          </div>
          {layoutPreview.valid && layoutPreview.secondary && (
            <div
              className={`layout-edit-preview is-valid mode-${layoutPreview.mode}`}
              style={panelRectForGridRect(layoutPreview.secondary.gridRect, viewportSize, layoutMetrics)}
              aria-hidden="true"
            >
              <PanelLayoutGhost label={layoutPreview.secondary.label} />
            </div>
          )}
        </>
      )}
      {layoutEditMode && (
        <div className="layout-palette-dock" aria-label="패널 추가 Dock">
          {paletteStatus && (
            <div className="layout-palette-status" role="status" aria-live="polite">
              {paletteStatus}
            </div>
          )}
          <div className="layout-palette-shell surface-raised">
            {(paletteOverflow.left || paletteOverflow.right) && (
              <button
                type="button"
                className="layout-palette-arrow"
                aria-label="이전 패널 보기"
                disabled={!paletteOverflow.left}
                onClick={() => scrollPaletteBy(-1)}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
            )}
            <div
              ref={paletteScrollerRef}
              className={[
                "layout-palette-scroller",
                paletteOverflow.left ? "has-overflow-left" : "",
                paletteOverflow.right ? "has-overflow-right" : ""
              ].filter(Boolean).join(" ")}
            >
              {panelPaletteEntries().map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className="layout-palette-button"
                  onPointerDown={beginPaletteDrag(entry.kind)}
                  onPointerMove={updateDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <span>{panelPaletteEntryLabel(entry.kind)}</span>
                </button>
              ))}
            </div>
            {(paletteOverflow.left || paletteOverflow.right) && (
              <button
                type="button"
                className="layout-palette-arrow"
                aria-label="다음 패널 보기"
                disabled={!paletteOverflow.right}
                onClick={() => scrollPaletteBy(1)}
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            )}
            {onExitLayoutEdit && (
              <>
                <span className="toolbar-separator" aria-hidden="true" />
                <button
                  type="button"
                  className="layout-palette-exit"
                  aria-label="레이아웃 수정모드 종료"
                  title="레이아웃 수정모드 종료"
                  onClick={onExitLayoutEdit}
                >
                  <Check size={14} aria-hidden="true" />
                  <span>완료</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {!layoutEditMode && presetDock}
      {!layoutEditMode && placementPickerOverlay}
    </>
  );
}

function logicalPointFromClientPoint(clientX: number, clientY: number): LogicalPointerPoint {
  if (typeof document === "undefined") {
    return { x: clientX, y: clientY };
  }
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!shell) {
    return { x: clientX, y: clientY };
  }
  const rect = shell.getBoundingClientRect();
  const scaleX = rect.width / Math.max(1, shell.offsetWidth);
  const scaleY = rect.height / Math.max(1, shell.offsetHeight);
  return {
    x: (clientX - rect.left) / (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1),
    y: (clientY - rect.top) / (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1)
  };
}

function panelGridCellFromPointSafe(
  viewport: ViewportSize,
  clientX: number,
  clientY: number,
  layoutMetrics: WorkspaceLayoutMetrics
) {
  const metrics = panelGridMetrics(viewport, layoutMetrics);
  const right = metrics.left + metrics.cols * metrics.stepX - metrics.gutter;
  const bottom = metrics.top + metrics.rows * metrics.stepY - metrics.gutter;
  if (clientX < metrics.left || clientX > right || clientY < metrics.top || clientY > bottom) {
    return null;
  }
  return {
    col: Math.max(1, Math.min(metrics.cols, Math.floor((clientX - metrics.left) / metrics.stepX) + 1)),
    row: Math.max(1, Math.min(metrics.rows, Math.floor((clientY - metrics.top) / metrics.stepY) + 1))
  };
}

function resizeGridRectFromCell(
  start: PanelGridRect,
  direction: ResizeDirection,
  cell: { col: number; row: number }
): PanelGridRect {
  const left = direction.includes("w") ? Math.min(cell.col, start.col + start.colSpan - 1) : start.col;
  const right = direction.includes("e") ? Math.max(cell.col, start.col) : start.col + start.colSpan - 1;
  const top = direction.includes("n") ? Math.min(cell.row, start.row + start.rowSpan - 1) : start.row;
  const bottom = direction.includes("s") ? Math.max(cell.row, start.row) : start.row + start.rowSpan - 1;
  return {
    col: left,
    row: top,
    colSpan: right - left + 1,
    rowSpan: bottom - top + 1
  };
}

function panelGridRectsEqual(left: PanelGridRect, right: PanelGridRect): boolean {
  return left.col === right.col &&
    left.row === right.row &&
    left.colSpan === right.colSpan &&
    left.rowSpan === right.rowSpan;
}

function PanelLayoutGhost({ label }: { label: string }) {
  return (
    <div className="panel-layout-ghost">
      <strong>{label}</strong>
    </div>
  );
}

function addPanelAtPreview(
  state: TiledPanelState,
  preview: LayoutPreview,
  activeSymbol: string,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): TiledPanelState {
  if (!preview.kind) {
    return state;
  }
  return addPanelSlotAtGridRect(state, preview.kind, preview.gridRect, {
    symbol: preview.kind === "chart" || preview.kind === "company" ? activeSymbol : undefined
  }, viewport, layoutMetrics);
}

function workspaceGridCells(
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics
): Array<{ col: number; row: number; style: CSSProperties }> {
  const cells: Array<{ col: number; row: number; style: CSSProperties }> = [];
  for (let row = 1; row <= panelGridSpec.rows; row += 1) {
    for (let col = 1; col <= panelGridSpec.cols; col += 1) {
      cells.push({
        col,
        row,
        style: panelRectForGridRect({ col, row, colSpan: 1, rowSpan: 1 }, viewport, layoutMetrics)
      });
    }
  }
  return cells;
}

const FRAME_RESIZE_EDGE = 16;
const FRAME_RESIZE_CORNER = 24;

function resizeDirectionForFramePoint(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): ResizeDirection | null {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const nearLeftCorner = x <= FRAME_RESIZE_CORNER;
  const nearRightCorner = x >= rect.width - FRAME_RESIZE_CORNER;
  const nearTopCorner = y <= FRAME_RESIZE_CORNER;
  const nearBottomCorner = y >= rect.height - FRAME_RESIZE_CORNER;
  if (nearTopCorner && nearLeftCorner) return "nw";
  if (nearTopCorner && nearRightCorner) return "ne";
  if (nearBottomCorner && nearLeftCorner) return "sw";
  if (nearBottomCorner && nearRightCorner) return "se";
  const nearLeft = x <= FRAME_RESIZE_EDGE;
  const nearRight = x >= rect.width - FRAME_RESIZE_EDGE;
  const nearTop = y <= FRAME_RESIZE_EDGE;
  const nearBottom = y >= rect.height - FRAME_RESIZE_EDGE;
  if (nearTop) return "n";
  if (nearBottom) return "s";
  if (nearLeft) return "w";
  if (nearRight) return "e";
  return null;
}

function resizeCursorForDirection(direction: ResizeDirection): string {
  switch (direction) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    default:
      return "ew-resize";
  }
}

function contentTitleForSlot(state: TiledPanelState, slotId: PanelSlotId): string {
  const slot = state.slots.find((item) => item.id === slotId);
  const content = slot ? state.contents[slot.contentId] : undefined;
  return content?.title ?? "패널";
}

function resizeDirectionLabel(direction: ResizeDirection): string {
  return {
    n: "위쪽",
    ne: "오른쪽 위",
    e: "오른쪽",
    se: "오른쪽 아래",
    s: "아래쪽",
    sw: "왼쪽 아래",
    w: "왼쪽",
    nw: "왼쪽 위"
  }[direction];
}

function resizeDirectionIcon(direction: ResizeDirection) {
  const size = 22;
  const rotation: Record<ResizeDirection, number> = {
    e: 0,
    se: 45,
    s: 90,
    sw: 135,
    w: 180,
    nw: 225,
    n: 270,
    ne: 315
  };
  return (
    <ChevronRight
      size={size}
      strokeWidth={3}
      aria-hidden="true"
      style={{ transform: `rotate(${rotation[direction]}deg)` }}
    />
  );
}

function chartHeaderEquals(a: ChartHeaderSnapshot | null | undefined, b: ChartHeaderSnapshot): boolean {
  if (!a) {
    return false;
  }
  return (
    a.symbol === b.symbol &&
    a.interval === b.interval &&
    a.name === b.name &&
    a.searchLabel === b.searchLabel &&
    a.liveQuote.priceText === b.liveQuote.priceText &&
    a.liveQuote.changeText === b.liveQuote.changeText &&
    a.liveQuote.percentText === b.liveQuote.percentText &&
    a.liveQuote.tone === b.liveQuote.tone
  );
}

function readContentSymbol(content: PanelContentInstance): string | null {
  const value = content.props?.symbol;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPortfolioPanelKind(kind: PanelContentKind): boolean {
  return kind === "portfolio"
    || kind === "portfolioInvestment"
    || kind === "portfolioMulti"
    || kind === "portfolioPerformance"
    || kind === "portfolioInvested"
    || kind === "portfolioDividend"
    || kind === "portfolioDiversification"
    || kind === "portfolioHeatmap"
    || kind === "portfolioHoldings"
    || kind === "portfolioHoldingsFlatCards";
}
