import {
  getCandlesForDocument,
  getDataStatusForDocument,
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
import type { ChartDocument } from "@gops/chart-engine";
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
  ChevronRight,
  Trash2,
  X
} from "lucide-react";
import {
  applyPanelResizeWithYield,
  addPanelSlotAtGridRect,
  detectResizablePanelBoundaries,
  expandGridRectForKind,
  movePanelSlotToGridRect,
  panelGridMetrics,
  panelGridSpec,
  panelPaletteEntries,
  panelPaletteEntryLabel,
  panelPaletteEntryTitle,
  panelRectForGridRect,
  panelSlotStyle,
  removePanelSlot,
  replacePanelSlotKind,
  resolvePanelDropGridRect,
  resolvePanelResizeWithYield,
  resizeFreeformBoundary,
  setPanelContentProps,
  slotAtGridCell,
  swapPanelContents,
  type PanelBoundary,
  type PanelContentInstance,
  type PanelContentKind,
  type PanelGridRect,
  type PanelResizeYieldSlot,
  type PanelSlotId,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "../layout/panelLayout";
import { ChartAddDock, ChartDrawingDock, type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { boundaryStyle } from "./panelWorkspaceGeometry";
import { WorkspacePanelFrame } from "./WorkspacePanelFrame";

type PanelWorkspaceProps = {
  panelState: TiledPanelState;
  setPanelState: Dispatch<SetStateAction<TiledPanelState>>;
  viewportSize: ViewportSize;
  layoutMetrics: WorkspaceLayoutMetrics;
  layoutEditMode: boolean;
  activeSymbol: string;
  symbols: ChartSymbolDto[];
  companyItems: Sp500UniverseItem[];
  marketItems: Sp500UniverseItem[];
  chartRuntime: ChartRuntimeState;
  selectedAgentReferenceKeys: string[];
  emphasizedAgentReferenceKeys: string[];
  emphasizeChartSelection: boolean;
  semanticSelection: SemanticSelectionSnapshot | null;
  setSemanticSelection: (selection: SemanticSelectionSnapshot | null) => void;
  onAgentReferenceSelect: (reference: AgentReference) => void;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartHandleChange: (contentId: string, handle: ChartPanelHandle | null) => void;
  onSyncPageSymbolFromChart: (contentId: string) => void;
  onSelectSymbol: (symbol: string) => void;
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

const resizeDirections: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function PanelWorkspace({
  panelState,
  setPanelState,
  viewportSize,
  layoutMetrics,
  layoutEditMode,
  activeSymbol,
  symbols,
  companyItems,
  marketItems,
  chartRuntime,
  selectedAgentReferenceKeys,
  emphasizedAgentReferenceKeys,
  emphasizeChartSelection,
  semanticSelection,
  setSemanticSelection,
  onAgentReferenceSelect,
  onChartRuntimeAction,
  onChartHandleChange,
  onSyncPageSymbolFromChart,
  onSelectSymbol,
  presetDock,
  placementPickerOverlay
}: PanelWorkspaceProps) {
  const [hoveredChartSlotId, setHoveredChartSlotId] = useState<PanelSlotId | null>(null);
  const [activeBoundaryId, setActiveBoundaryId] = useState<string | null>(null);
  const [draggingSlotId, setDraggingSlotId] = useState<PanelSlotId | null>(null);
  const [isLayoutResizing, setIsLayoutResizing] = useState(false);
  const [layoutPreview, setLayoutPreview] = useState<LayoutPreview | null>(null);
  const [chartHeaders, setChartHeaders] = useState<Record<string, ChartHeaderSnapshot>>({});
  const [drawingTargetContentId, setDrawingTargetContentId] = useState<string | null>(null);
  const [chartAddTargetContentId, setChartAddTargetContentId] = useState<string | null>(null);
  const dragRef = useRef<LayoutDrag | null>(null);
  const panelStateRef = useRef<TiledPanelState>(panelState);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);
  const layoutMetricsRef = useRef<WorkspaceLayoutMetrics>(layoutMetrics);
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

  const panelBoundaries = useMemo(() => detectResizablePanelBoundaries(panelState, viewportSize, layoutMetrics), [layoutMetrics, panelState, viewportSize]);
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
      setPanelState((current) => movePanelSlotToGridRect(
        current,
        preview.sourceSlotId!,
        preview.gridRect,
        viewportSizeRef.current,
        layoutMetricsRef.current
      ));
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

  const resolveEditDragPreview = useCallback((drag: LayoutDrag, clientX: number, clientY: number): LayoutPreview | null => {
    if (drag.mode === "boundary") {
      return null;
    }
    const viewport = viewportSizeRef.current;
    const metrics = layoutMetricsRef.current;
    const cell = panelGridCellFromPointSafe(viewport, clientX, clientY, metrics);
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
      const target = slotAtGridCell(state, cell, source.id);
      if (target) {
        return {
          gridRect: target.gridRect,
          sourceSlotId: source.id,
          targetSlotId: target.id,
          mode: "swap",
          valid: true,
          label: state.contents[source.contentId]?.title ?? "패널",
          secondary: {
            gridRect: source.gridRect,
            label: contentTitleForSlot(state, target.id)
          }
        };
      }
      const dropPlan = sourceGridRectContainsCell(source.gridRect, cell)
        ? { valid: true, gridRect: source.gridRect }
        : resolvePanelDropGridRect(state, kind, cell, {
          exceptSlotId: source.id,
          preferredSpan: { colSpan: source.gridRect.colSpan, rowSpan: source.gridRect.rowSpan }
        });
      return {
        gridRect: dropPlan.gridRect,
        sourceSlotId: source.id,
        mode: "move",
        valid: dropPlan.valid,
        label: state.contents[source.contentId]?.title ?? "패널"
      };
    }
    const source = state.slots.find((slot) => slot.id === drag.sourceSlotId);
    const kind = source ? state.contents[source.contentId]?.kind : null;
    if (!source || !kind) {
      return null;
    }
    const gridRect = resizeGridRectFromCell(drag.startGridRect, drag.direction, cell);
    const resizePlan = resolvePanelResizeWithYield(state, source.id, gridRect);
    return {
      gridRect: resizePlan.sourceGridRect,
      sourceSlotId: source.id,
      yieldedSlots: resizePlan.yieldedSlots,
      mode: "resize",
      valid: resizePlan.valid,
      label: resizePlan.valid && resizePlan.yieldedSlots.length ? "크기 변경 / 자리 양보" : "크기 변경"
    };
  }, []);

  const finishLayoutDrag = useCallback((event?: PointerEvent) => {
    const drag = dragRef.current;
    if (drag && drag.mode !== "boundary" && event) {
      const preview = layoutPreview ?? resolveEditDragPreview(drag, event.clientX, event.clientY);
      if (preview) {
        commitLayoutPreview(preview);
      }
    }
    dragRef.current = null;
    setActiveBoundaryId(null);
    setDraggingSlotId(null);
    setIsLayoutResizing(false);
    setLayoutPreview(null);
  }, [commitLayoutPreview, layoutPreview, resolveEditDragPreview]);

  const applyLayoutDrag = useCallback((clientX: number, clientY: number, viewport: ViewportSize) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.mode !== "boundary") {
      setLayoutPreview(resolveEditDragPreview(drag, clientX, clientY));
      return;
    }
    const delta = drag.orientation === "vertical" ? clientX - drag.startX : clientY - drag.startY;
    setPanelState(resizeFreeformBoundary(drag.startState, drag.boundaryId, delta, viewport, layoutMetricsRef.current));
  }, [resolveEditDragPreview, setPanelState]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current) {
        return;
      }
      event.preventDefault();
      applyLayoutDrag(event.clientX, event.clientY, viewportSizeRef.current);
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
    dragRef.current = {
      mode: "boundary",
      boundaryId: boundary.id,
      orientation: boundary.orientation,
      startX: event.clientX,
      startY: event.clientY,
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
    let drag: LayoutDrag;
    if (resizeDirection) {
      drag = {
        mode: "edit-resize",
        sourceSlotId: slotId,
        direction: resizeDirection,
        startGridRect: slot.gridRect
      };
    } else {
      const cell = panelGridCellFromPointSafe(viewportSizeRef.current, event.clientX, event.clientY, layoutMetricsRef.current);
      drag = {
        mode: "edit-move",
        sourceSlotId: slotId,
        offsetCol: cell ? Math.max(0, cell.col - slot.gridRect.col) : 0,
        offsetRow: cell ? Math.max(0, cell.row - slot.gridRect.row) : 0
      };
    }
    dragRef.current = drag;
    setLayoutPreview(resolveEditDragPreview(drag, event.clientX, event.clientY));
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
    const drag: LayoutDrag = {
      mode: "edit-resize",
      sourceSlotId: slotId,
      direction,
      startGridRect: slot.gridRect
    };
    dragRef.current = drag;
    setLayoutPreview(resolveEditDragPreview(drag, event.clientX, event.clientY));
  };

  const beginPaletteDrag = (kind: PanelContentKind) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layoutEditMode || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const drag: LayoutDrag = {
      mode: "palette",
      kind
    };
    dragRef.current = drag;
    setLayoutPreview(resolveEditDragPreview(drag, event.clientX, event.clientY));
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    applyLayoutDrag(event.clientX, event.clientY, viewportSize);
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
      if (closing.contentId === drawingTargetContentId) {
        setDrawingTargetContentId(null);
      }
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

  const resetDrawingTargetTool = (contentId: string) => {
    const slot = panelStateRef.current.slots.find((item) => item.contentId === contentId);
    const content = slot ? panelStateRef.current.contents[slot.contentId] : null;
    if (!slot || !content || content.kind !== "chart") {
      return;
    }
    onChartRuntimeAction({
      kind: "chart.command",
      command: makeChartCommand(
        "chart.drawing.clearSelection",
        "user",
        { panelId: slot.id, chartDocumentId: chartDocumentIdForContent(content) },
        { mode: "pan" }
      )
    });
  };

  const toggleDrawingTarget = (contentId: string) => {
    setDrawingTargetContentId((current) => {
      if (current === contentId) {
        resetDrawingTargetTool(contentId);
        return null;
      }
      if (current) {
        resetDrawingTargetTool(current);
      }
      return contentId;
    });
  };

  const toggleChartAddTarget = (contentId: string) => {
    setChartAddTargetContentId((current) => current === contentId ? null : contentId);
  };

  const updatePanelProps = useCallback((contentId: string, props: Record<string, unknown>) => {
    setPanelState((current) => setPanelContentProps(current, contentId, props));
  }, [setPanelState]);

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

  const drawingTarget = drawingTargetContentId
    ? targetChartForContentId(panelState, chartRuntime, drawingTargetContentId)
    : null;
  const chartAddTarget = chartAddTargetContentId
    ? targetChartForContentId(panelState, chartRuntime, chartAddTargetContentId)
    : null;

  return (
    <>
      {layoutEditMode && (
        <div className="workspace-edit-grid" aria-hidden="true">
          {workspaceGridCells(viewportSize, layoutMetrics).map((cell) => (
            <span key={`${cell.col}-${cell.row}`} className="workspace-edit-grid-cell" style={cell.style} />
          ))}
        </div>
      )}
      {panelState.slots.map((slot) => {
        const content = panelState.contents[slot.contentId];
        const isChart = content.kind === "chart";
        const hidePanelNav = isChart || content.kind === "indices" || isPortfolioPanelKind(content.kind);
        const chartDocument = isChart ? chartRuntime.documents[chartDocumentIdForContent(content)] : undefined;
        const chartCandles = chartDocument ? getCandlesForDocument(chartRuntime, chartDocument) as CandleDto[] : [];
        const chartDataStatus = chartDocument ? getDataStatusForDocument(chartRuntime, chartDocument) : undefined;
        const chartStreamStatus = chartDocument ? getStreamStatusForDocument(chartRuntime, chartDocument) : undefined;
        const chartStreamMessage = chartDocument ? getStreamMessageForDocument(chartRuntime, chartDocument) : undefined;
        const contentSymbol = (readContentSymbol(content) ?? chartDocument?.symbol ?? activeSymbol).toUpperCase();
        const previewGridRect = layoutPreview?.mode === "resize"
          && layoutPreview.valid
          && layoutPreview.sourceSlotId === slot.id
          ? layoutPreview.gridRect
          : null;
        const effectiveGridRect = previewGridRect ?? slot.gridRect;
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
              isLayoutResizing ? "is-layout-resizing" : "",
              layoutEditMode ? "is-layout-editing" : ""
            ].filter(Boolean).join(" ")}
            isBoundaryActive={activeBoundarySlotIds.has(slot.id)}
            isChartHovered={isChart && (hoveredChartSlotId === slot.id || drawingTargetContentId === content.id || chartAddTargetContentId === content.id)}
            showNav={!hidePanelNav}
            onFramePointerDown={layoutEditMode ? beginPanelEditMove : undefined}
            onFramePointerMove={layoutEditMode ? updateFrameCursor : undefined}
            onPointerEnter={() => isChart && setChartSlotHover(slot.id, true)}
            onPointerLeave={() => {
              if (isChart && !dragRef.current) {
                setChartSlotHover(slot.id, false);
              }
            }}
            editControls={renderPanelEditControls(slot.id, content)}
          >
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
              chartDataStatus={chartDataStatus}
              chartStreamStatus={chartStreamStatus}
              chartStreamMessage={chartStreamMessage}
              chartDrawingActive={drawingTargetContentId === content.id}
              chartAddActive={chartAddTargetContentId === content.id}
              selectedAgentReferenceKeys={selectedAgentReferenceKeys}
              emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
              emphasizeChartSelection={emphasizeChartSelection}
              semanticSelection={semanticSelection}
              setSemanticSelection={setSemanticSelection}
              onAgentReferenceSelect={onAgentReferenceSelect}
              onChartRuntimeAction={onChartRuntimeAction}
              onChartHoverChange={(hovered) => setChartSlotHover(slot.id, hovered)}
              onHeaderChange={isChart ? (header) => recordChartHeader(content, header) : undefined}
              onChartHandleChange={onChartHandleChange}
              onChartDrawingToggle={() => toggleDrawingTarget(content.id)}
              onChartAddToggle={() => toggleChartAddTarget(content.id)}
              onSyncPageSymbolFromChart={() => onSyncPageSymbolFromChart(content.id)}
              onUpdatePanelProps={updatePanelProps}
              onChangePanelChartSymbol={changePanelChartSymbol}
              onSelectSymbol={onSelectSymbol}
            />
          </WorkspacePanelFrame>
        );
      })}
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
            <span>
              {!layoutPreview.valid && <X size={12} aria-hidden="true" />}
              {layoutPreview.label}
            </span>
          </div>
          {layoutPreview.valid && layoutPreview.secondary && (
            <div
              className={`layout-edit-preview is-valid mode-${layoutPreview.mode}`}
              style={panelRectForGridRect(layoutPreview.secondary.gridRect, viewportSize, layoutMetrics)}
              aria-hidden="true"
            >
              <span>{layoutPreview.secondary.label}</span>
            </div>
          )}
        </>
      )}
      {layoutEditMode && (
        <div className="layout-palette-dock" aria-label="패널 추가 Dock">
          {panelPaletteEntries().map((entry) => (
            <button
              key={entry.kind}
              type="button"
              className="layout-palette-button surface-raised"
              onPointerDown={beginPaletteDrag(entry.kind)}
              onPointerMove={updateDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span>{panelPaletteEntryLabel(entry.kind)}</span>
            </button>
          ))}
        </div>
      )}
      {!layoutEditMode && (drawingTarget || chartAddTarget) && (
        <div className="chart-tool-dock-row" aria-label="Chart tool docks">
          {chartAddTarget && (
            <ChartAddDock
              document={chartAddTarget.document}
              panelId={chartAddTarget.slot.id}
              laneHeight={Math.max(120, chartAddTarget.slot.rect.height)}
              onChartRuntimeAction={onChartRuntimeAction}
              onClose={() => setChartAddTargetContentId(null)}
            />
          )}
          {drawingTarget && (
            <ChartDrawingDock
              document={drawingTarget.document}
              panelId={drawingTarget.slot.id}
              onChartRuntimeAction={onChartRuntimeAction}
              onClose={() => setDrawingTargetContentId(null)}
            />
          )}
        </div>
      )}
      {!layoutEditMode && !drawingTarget && !chartAddTarget && presetDock}
      {!layoutEditMode && placementPickerOverlay}
    </>
  );
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

function sourceGridRectContainsCell(rect: PanelGridRect, cell: { col: number; row: number }): boolean {
  return cell.col >= rect.col &&
    cell.col < rect.col + rect.colSpan &&
    cell.row >= rect.row &&
    cell.row < rect.row + rect.rowSpan;
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

function targetChartForContentId(
  panelState: TiledPanelState,
  chartRuntime: ChartRuntimeState,
  contentId: string
): { slot: NonNullable<TiledPanelState["slots"][number]>; content: PanelContentInstance; document: ChartDocument } | null {
  const slot = panelState.slots.find((item) => item.contentId === contentId);
  const content = slot ? panelState.contents[slot.contentId] : null;
  if (!slot || !content || content.kind !== "chart") {
    return null;
  }
  const document = chartRuntime.documents[chartDocumentIdForContent(content)];
  return document ? { slot, content, document } : null;
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
    || kind === "portfolioPerformance"
    || kind === "portfolioInvested"
    || kind === "portfolioDividend"
    || kind === "portfolioDiversification"
    || kind === "portfolioHoldings";
}
