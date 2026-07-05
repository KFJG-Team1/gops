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
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import type { ChartSymbolDto } from "../chart/types";
import {
  canInsertPanelAtBoundary,
  detectPanelBoundaries,
  insertOptionsForBoundary,
  insertPanelAtBoundary,
  panelGutter,
  panelSlotStyle,
  removePanelSlot,
  resizePanelBoundary,
  swapPanelContents,
  type BoundaryInsertOption,
  type PanelBoundary,
  type PanelContentInstance,
  type PanelSlotId,
  type TiledPanelState,
  type ViewportSize
} from "../layout/panelLayout";
import { ChartDrawingDock, type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import { PanelContentRenderer } from "./PanelContentRenderer";
import {
  boundaryAddMenuPosition,
  boundaryStyle,
  hitTestSwappableSlot,
  panelNavHeight
} from "./panelWorkspaceGeometry";
import { WorkspacePanelFrame } from "./WorkspacePanelFrame";

type PanelWorkspaceProps = {
  panelState: TiledPanelState;
  setPanelState: Dispatch<SetStateAction<TiledPanelState>>;
  viewportSize: ViewportSize;
  activeSymbol: string;
  symbols: ChartSymbolDto[];
  chartRuntime: ChartRuntimeState;
  chartCommandTargetContentId: string | null;
  canUseChartCommand: boolean;
  setSemanticSelection: (selection: SemanticSelectionSnapshot | null) => void;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartCommandTargetChange: (contentId: string | null) => void;
  onChartHandleChange: (contentId: string, handle: ChartPanelHandle | null) => void;
  onSyncPageSymbolFromChart: (contentId: string) => void;
  onSelectSymbol: (symbol: string) => void;
};

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
    mode: "swap";
    sourceSlotId: PanelSlotId;
  };

type BoundaryAddMenu = {
  boundaryId: string;
  left: number;
  top: number;
  options: BoundaryInsertOption[];
};

export function PanelWorkspace({
  panelState,
  setPanelState,
  viewportSize,
  activeSymbol,
  symbols,
  chartRuntime,
  chartCommandTargetContentId,
  canUseChartCommand,
  setSemanticSelection,
  onChartRuntimeAction,
  onChartCommandTargetChange,
  onChartHandleChange,
  onSyncPageSymbolFromChart,
  onSelectSymbol
}: PanelWorkspaceProps) {
  const [hoveredChartSlotId, setHoveredChartSlotId] = useState<PanelSlotId | null>(null);
  const [activeBoundaryId, setActiveBoundaryId] = useState<string | null>(null);
  const [draggingSlotId, setDraggingSlotId] = useState<PanelSlotId | null>(null);
  const [addMenu, setAddMenu] = useState<BoundaryAddMenu | null>(null);
  const [chartHeaders, setChartHeaders] = useState<Record<string, ChartHeaderSnapshot>>({});
  const [drawingTargetContentId, setDrawingTargetContentId] = useState<string | null>(null);
  const dragRef = useRef<LayoutDrag | null>(null);
  const panelStateRef = useRef<TiledPanelState>(panelState);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);

  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  const panelBoundaries = useMemo(() => detectPanelBoundaries(panelState, viewportSize), [panelState, viewportSize]);
  const activeBoundary = useMemo(() => (
    activeBoundaryId ? panelBoundaries.find((boundary) => boundary.id === activeBoundaryId) ?? null : null
  ), [activeBoundaryId, panelBoundaries]);
  const activeBoundarySlotIds = useMemo(() => (
    new Set([...(activeBoundary?.negativeSlotIds ?? []), ...(activeBoundary?.positiveSlotIds ?? [])])
  ), [activeBoundary]);
  const layoutGutter = panelGutter(viewportSize);

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

  const finishLayoutDrag = useCallback((event?: PointerEvent) => {
    const drag = dragRef.current;
    if (drag?.mode === "swap" && event) {
      const target = hitTestSwappableSlot(panelStateRef.current, event.clientX, event.clientY, drag.sourceSlotId);
      if (target) {
        setPanelState((current) => swapPanelContents(current, drag.sourceSlotId, target.id, viewportSizeRef.current));
      }
    }
    dragRef.current = null;
    setActiveBoundaryId(addMenu?.boundaryId ?? null);
    setDraggingSlotId(null);
  }, [addMenu?.boundaryId, setPanelState]);

  const applyLayoutDrag = useCallback((clientX: number, clientY: number, viewport: ViewportSize) => {
    const drag = dragRef.current;
    if (!drag || drag.mode === "swap") {
      return;
    }
    const delta = drag.orientation === "vertical" ? clientX - drag.startX : clientY - drag.startY;
    setPanelState(resizePanelBoundary(drag.startState, drag.boundaryId, delta, viewport));
  }, [setPanelState]);

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

  useEffect(() => {
    if (!addMenu) {
      return;
    }

    const closeAddMenuOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        (event.target.closest(".panel-add-menu") || event.target.closest(".panel-boundary-add"))
      ) {
        return;
      }
      setAddMenu(null);
      setActiveBoundaryId(null);
    };

    window.addEventListener("pointerdown", closeAddMenuOnOutsidePointer, true);
    return () => {
      window.removeEventListener("pointerdown", closeAddMenuOnOutsidePointer, true);
    };
  }, [addMenu]);

  const beginBoundaryResize = (boundary: PanelBoundary) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    setAddMenu(null);
    setActiveBoundaryId(boundary.id);
    if (boundary.interaction !== "resize") {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      mode: "boundary",
      boundaryId: boundary.id,
      orientation: boundary.orientation,
      startX: event.clientX,
      startY: event.clientY,
      startState: panelState
    };
  };

  const beginPanelSwap = (slotId: PanelSlotId) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setAddMenu(null);
    setDraggingSlotId(slotId);
    dragRef.current = {
      mode: "swap",
      sourceSlotId: slotId
    };
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

  const openBoundaryAddMenu = (boundary: PanelBoundary, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const options = insertOptionsForBoundary(panelState, boundary.id, viewportSize);
    if (!options.length) {
      return;
    }
    const position = boundaryAddMenuPosition(boundary, options.length, viewportSize, layoutGutter);
    setAddMenu({
      boundaryId: boundary.id,
      left: position.left,
      top: position.top,
      options
    });
    setActiveBoundaryId(boundary.id);
  };

  const insertPanel = (option: BoundaryInsertOption) => {
    if (!addMenu) {
      return;
    }
    setPanelState((current) => insertPanelAtBoundary(
      current,
      addMenu.boundaryId,
      option.kind,
      viewportSizeRef.current,
      { symbol: option.kind === "chart" ? activeSymbol : undefined }
    ));
    setAddMenu(null);
    setActiveBoundaryId(null);
  };

  const closePanel = (slotId: PanelSlotId) => {
    const closing = panelStateRef.current.slots.find((slot) => slot.id === slotId);
    setPanelState((current) => removePanelSlot(current, slotId, viewportSizeRef.current));
    if (closing) {
      setChartHeaders((current) => {
        const next = { ...current };
        delete next[closing.contentId];
        return next;
      });
      if (closing.contentId === chartCommandTargetContentId) {
        onChartCommandTargetChange(null);
      }
      if (closing.contentId === drawingTargetContentId) {
        setDrawingTargetContentId(null);
      }
      onChartHandleChange(closing.contentId, null);
    }
    setHoveredChartSlotId((current) => current === slotId ? null : current);
    setAddMenu(null);
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

  const drawingTarget = drawingTargetContentId
    ? targetChartForContentId(panelState, chartRuntime, drawingTargetContentId)
    : null;

  return (
    <>
      {panelState.slots.map((slot) => {
        const content = panelState.contents[slot.contentId];
        const isChart = content.kind === "chart";
        const isLastPanel = panelState.slots.length <= 1;
        const chartDocument = isChart ? chartRuntime.documents[chartDocumentIdForContent(content)] : undefined;
        const chartCandles = chartDocument ? getCandlesForDocument(chartRuntime, chartDocument) as CandleDto[] : [];
        const chartDataStatus = chartDocument ? getDataStatusForDocument(chartRuntime, chartDocument) : undefined;
        const chartStreamStatus = chartDocument ? getStreamStatusForDocument(chartRuntime, chartDocument) : undefined;
        const chartStreamMessage = chartDocument ? getStreamMessageForDocument(chartRuntime, chartDocument) : undefined;
        return (
          <WorkspacePanelFrame
            key={slot.id}
            slot={slot}
            content={content}
            style={panelSlotStyle(slot)}
            className={[
              isChart && slot.rect.left > 1 ? "has-left-boundary" : "",
              isChart && slot.rect.left + slot.rect.width < viewportSize.width - 1 ? "has-right-boundary" : "",
              draggingSlotId === slot.id ? "is-panel-content-dragging" : ""
            ].filter(Boolean).join(" ")}
            isBoundaryActive={activeBoundarySlotIds.has(slot.id)}
            isChartHovered={isChart && (hoveredChartSlotId === slot.id || drawingTargetContentId === content.id)}
            showNav={!isChart}
            canSwap
            canClose={!isChart && !isLastPanel}
            onClose={closePanel}
            onSwapPointerDown={beginPanelSwap}
            onPointerEnter={() => isChart && setChartSlotHover(slot.id, true)}
            onPointerLeave={() => {
              if (isChart && !dragRef.current) {
                setChartSlotHover(slot.id, false);
              }
            }}
          >
            <PanelContentRenderer
              slot={slot}
              content={content}
              symbol={chartDocument?.symbol ?? activeSymbol}
              symbols={symbols}
              laneHeight={Math.max(120, isChart ? slot.rect.height : slot.rect.height - panelNavHeight)}
              chartHeaderSnapshot={chartHeaders[content.id]}
              chartDocument={chartDocument}
              chartCandles={chartCandles}
              chartDataStatus={chartDataStatus}
              chartStreamStatus={chartStreamStatus}
              chartStreamMessage={chartStreamMessage}
              canClose={!isLastPanel}
              canUseChartCommand={canUseChartCommand}
              chartCommandActive={chartCommandTargetContentId === content.id}
              chartDrawingActive={drawingTargetContentId === content.id}
              setSemanticSelection={setSemanticSelection}
              onChartRuntimeAction={onChartRuntimeAction}
              onChartHoverChange={(hovered) => setChartSlotHover(slot.id, hovered)}
              onHeaderChange={isChart ? (header) => recordChartHeader(content, header) : undefined}
              onChartHandleChange={onChartHandleChange}
              onChartCommandToggle={() => onChartCommandTargetChange(chartCommandTargetContentId === content.id ? null : content.id)}
              onChartDrawingToggle={() => toggleDrawingTarget(content.id)}
              onSyncPageSymbolFromChart={() => onSyncPageSymbolFromChart(content.id)}
              onClosePanel={closePanel}
              onChangePanelChartSymbol={changePanelChartSymbol}
              onSelectSymbol={onSelectSymbol}
              onChartSwapPointerDown={beginPanelSwap(slot.id)}
            />
          </WorkspacePanelFrame>
        );
      })}
      {panelBoundaries.map((boundary) => {
        const canAdd = canInsertPanelAtBoundary(panelState, boundary.id, viewportSize);
        return (
          <div
            key={boundary.id}
            className={[
              "panel-boundary",
              boundary.orientation,
              boundary.interaction === "resize" ? "can-resize" : "is-insert-only",
              canAdd ? "has-add" : "",
              boundary.pageEdge ? "is-page-edge" : "",
              activeBoundaryId === boundary.id ? "is-active" : ""
            ].join(" ")}
            style={boundaryStyle(boundary)}
            role="separator"
            aria-orientation={boundary.orientation === "vertical" ? "vertical" : "horizontal"}
            onPointerEnter={() => setActiveBoundaryId(boundary.id)}
            onPointerLeave={() => {
              if (!dragRef.current && addMenu?.boundaryId !== boundary.id) {
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
          >
            {canAdd && (
              <button
                type="button"
                className="panel-boundary-add"
                aria-label="패널 추가"
                title="패널 추가"
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => setActiveBoundaryId(boundary.id)}
                onPointerMove={() => setActiveBoundaryId(boundary.id)}
                onClick={(event) => openBoundaryAddMenu(boundary, event)}
              >
                <span className="panel-boundary-add-glyph" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
      {addMenu && (
        <div className="panel-add-menu surface-floating" style={{ left: addMenu.left, top: addMenu.top }} onPointerDown={(event) => event.stopPropagation()}>
          {addMenu.options.map((option) => (
            <button key={option.kind} type="button" onClick={() => insertPanel(option)}>
              {option.title}
            </button>
          ))}
        </div>
      )}
      {drawingTarget && (
        <ChartDrawingDock
          document={drawingTarget.document}
          panelId={drawingTarget.slot.id}
          onChartRuntimeAction={onChartRuntimeAction}
          onClose={() => setDrawingTargetContentId(null)}
        />
      )}
    </>
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
