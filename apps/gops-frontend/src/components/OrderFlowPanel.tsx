import { type WheelEvent as ReactWheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CandleEventDto, ChartSymbolDto } from "../chart/types";
import { openChartSocket } from "../chart/cdcClient";
import {
  fetchOrderFlowDaily,
  fetchOrderFlowIntraday,
  fetchOrderFlowSymbols,
  subscribeOrderFlowDemoTicks
} from "../chart/orderFlowClient";
import {
  autoOrderFlowTargetRows,
  buildLadder,
  ORDER_FLOW_WINDOWS,
  effectiveOrderFlowPriceStep,
  maxOrderFlowTargetRowsForHeight,
  rebinLevels,
  replaceOrderFlowMinute,
  resolveOrderFlowTargetRows,
  sessionDateFromTimestamp,
  stepOrderFlowTargetRows,
  sumMinuteWindows,
  type OrderFlowDayDto,
  type OrderFlowIntradayResponseDto,
  type OrderFlowLadder,
  type OrderFlowMinuteDto,
  type OrderFlowResolutionSelection,
  type OrderFlowWindow
} from "../chart/orderFlow";
import { drawOrderFlowPanelLadder } from "../chart/orderFlowRender";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import { readThemeColors } from "../theme/colors";
import type { ThemeColors } from "../theme/colors";
import { applyCanvasTypography } from "../theme/typography";
import { SymbolSearch } from "./SymbolSearch";

type OrderFlowPanelProps = {
  panelId: string;
  symbol: string;
  defaultToPinnedSymbol?: boolean;
  savedWindow?: OrderFlowWindow;
  savedResolution?: OrderFlowResolutionSelection;
  onSymbolChange?: (symbol: string) => void;
  onWindowChange?: (windowKey: OrderFlowWindow) => void;
  onResolutionChange?: (resolution: OrderFlowResolutionSelection) => void;
  semanticSelection: SemanticSelectionSnapshot | null;
};

type LiveQuote = NonNullable<OrderFlowIntradayResponseDto["liveQuote"]>;
type PanelMode = "live" | "selected";
type StreamState = "connecting" | "live" | "idle" | "error";
type WheelFeedback = { x: number; y: number; expiresAt: number } | null;

const defaultWindow: OrderFlowWindow = "10m";
const defaultResolution: OrderFlowResolutionSelection = "auto";
const preferredDefaultSymbol = "NVDA";
const wheelNotchThreshold = 90;

export function OrderFlowPanel({
  panelId,
  symbol,
  defaultToPinnedSymbol = false,
  savedWindow = defaultWindow,
  savedResolution = defaultResolution,
  onSymbolChange,
  onWindowChange,
  onResolutionChange,
  semanticSelection
}: OrderFlowPanelProps) {
  const requestedSymbol = symbol.trim().toUpperCase();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scheduleDrawRef = useRef<(() => void) | null>(null);
  const overlayIntentRef = useRef<number | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const feedbackTimerRef = useRef<number | null>(null);
  const resolutionMetricsRef = useRef({
    autoRows: 12,
    maxRows: 12,
    targetRows: 12,
    effectiveStep: 0.01
  });
  const drawStateRef = useRef<{
    ladder: OrderFlowLadder | null;
    liveQuote: LiveQuote | null;
    lastPrice: number | null;
    clippedHint: boolean;
    mode: PanelMode;
    streamState: StreamState;
    loading: boolean;
    supported: boolean;
    symbol: string;
    supportedSymbols: string[];
    effectiveStep: number;
    targetRows: number;
    resolution: OrderFlowResolutionSelection;
    wheelFeedback: WheelFeedback;
  }>({
    ladder: null,
    liveQuote: null,
    lastPrice: null,
    clippedHint: false,
    mode: "live",
    streamState: "idle",
    loading: true,
    supported: false,
    symbol: "",
    supportedSymbols: [],
    effectiveStep: 0.01,
    targetRows: 12,
    resolution: "auto",
    wheelFeedback: null
  });
  const [supportedSymbols, setSupportedSymbols] = useState<string[]>([]);
  const [sourcePriceStep, setSourcePriceStep] = useState(0.01);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [windowKey, setWindowKeyState] = useState<OrderFlowWindow>(savedWindow);
  const [resolution, setResolutionState] = useState<OrderFlowResolutionSelection>(savedResolution);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [minutes, setMinutes] = useState<Map<string, OrderFlowMinuteDto>>(new Map());
  const [liveSessionDate, setLiveSessionDate] = useState("");
  const [liveStatus, setLiveStatus] = useState<OrderFlowIntradayResponseDto["dataStatus"]>("empty");
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [selectedDay, setSelectedDay] = useState<OrderFlowDayDto | null>(null);
  const [fallbackDay, setFallbackDay] = useState<OrderFlowDayDto | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [wheelFeedback, setWheelFeedback] = useState<WheelFeedback>(null);

  useEffect(() => {
    setWindowKeyState(savedWindow);
  }, [savedWindow]);

  useEffect(() => {
    setResolutionState(savedResolution);
  }, [savedResolution]);

  useEffect(() => () => {
    if (overlayIntentRef.current !== null) {
      window.clearTimeout(overlayIntentRef.current);
    }
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  const setWindowKey = useCallback((nextWindow: OrderFlowWindow) => {
    setWindowKeyState(nextWindow);
    onWindowChange?.(nextWindow);
  }, [onWindowChange]);

  const updateResolution = useCallback((update: OrderFlowResolutionSelection | ((current: OrderFlowResolutionSelection) => OrderFlowResolutionSelection)) => {
    setResolutionState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      onResolutionChange?.(next);
      return next;
    });
  }, [onResolutionChange]);

  const showWheelFeedback = useCallback((x: number, y: number) => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setWheelFeedback({ x, y, expiresAt: Date.now() + 800 });
    feedbackTimerRef.current = window.setTimeout(() => {
      setWheelFeedback(null);
      feedbackTimerRef.current = null;
    }, 820);
  }, []);

  const normalizedSymbol = useMemo(() => {
    if (defaultToPinnedSymbol && supportedSymbols.length > 0 && !supportedSymbols.includes(requestedSymbol)) {
      return supportedSymbols.includes(preferredDefaultSymbol) ? preferredDefaultSymbol : supportedSymbols[0];
    }
    return requestedSymbol;
  }, [defaultToPinnedSymbol, requestedSymbol, supportedSymbols]);
  const supported = supportedSymbols.includes(normalizedSymbol);
  const selectedDate = useMemo(() => {
    if (!semanticSelection || semanticSelection.symbol.toUpperCase() !== normalizedSymbol || semanticSelection.interval !== "1D") {
      return null;
    }
    return sessionDateFromTimestamp(semanticSelection.timestamp ?? semanticSelection.from);
  }, [normalizedSymbol, semanticSelection]);
  const mode: PanelMode = selectedDate ? "selected" : "live";

  useEffect(() => {
    const controller = new AbortController();
    setSymbolsLoading(true);
    fetchOrderFlowSymbols(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setSupportedSymbols(response.symbols);
        setSourcePriceStep(response.priceBinSize);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSupportedSymbols([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSymbolsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!normalizedSymbol || !supported) {
      setMinutes(new Map());
      setLiveSessionDate("");
      setLiveStatus(supported ? "empty" : "unsupported");
      setLiveQuote(null);
      return;
    }
    const controller = new AbortController();
    fetchOrderFlowIntraday(normalizedSymbol, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setLiveSessionDate(response.sessionDate);
        setLiveStatus(response.dataStatus);
        setLiveQuote(response.liveQuote);
        setMinutes(new Map(response.minutes.map((minute) => [minute.eventMinute, minute])));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLiveStatus("empty");
          setMinutes(new Map());
          setLiveQuote(null);
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol, supported]);

  useEffect(() => {
    if (!normalizedSymbol || !supported) {
      setStreamState("idle");
      return undefined;
    }
    const handleEvent = (event: CandleEventDto) => {
      if (event.type === "ORDER_FLOW_BINS_UPDATE" && event.symbol.toUpperCase() === normalizedSymbol) {
        setLiveSessionDate(event.data.sessionDate);
        setLiveStatus("ready");
        setMinutes((current) => replaceOrderFlowMinute(current, event.data));
        return;
      }
      if (event.type === "LIVE_QUOTE_UPDATE" && event.symbol.toUpperCase() === normalizedSymbol) {
        setLiveQuote(normalizeLiveQuote(event));
      }
    };
    const demoCleanup = subscribeOrderFlowDemoTicks(
      normalizedSymbol,
      handleEvent,
      (state) => setStreamState(state === "connecting" || state === "live" || state === "error" ? state : "idle")
    );
    if (demoCleanup) {
      return demoCleanup;
    }
    return openChartSocket(
      normalizedSymbol,
      "1m",
      handleEvent,
      (state) => setStreamState(state === "connecting" || state === "live" || state === "error" ? state : "idle")
    );
  }, [normalizedSymbol, supported]);

  useEffect(() => {
    if (!selectedDate || !supported) {
      setSelectedDay(null);
      return;
    }
    const controller = new AbortController();
    fetchOrderFlowDaily({
      symbol: normalizedSymbol,
      from: selectedDate,
      to: selectedDate,
      limitDays: 1
    }, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setSelectedDay(response.days.find((day) => day.sessionDate === selectedDate) ?? null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSelectedDay(null);
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol, selectedDate, supported]);

  useEffect(() => {
    if (!supported || liveStatus !== "empty") {
      setFallbackDay(null);
      return;
    }
    const controller = new AbortController();
    const to = sessionDateFromTimestamp(new Date().toISOString());
    const from = sessionDateDaysBefore(to, 7);
    fetchOrderFlowDaily({
      symbol: normalizedSymbol,
      from,
      to,
      limitDays: 1
    }, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setFallbackDay(response.days[response.days.length - 1] ?? null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFallbackDay(null);
        }
      });
    return () => controller.abort();
  }, [liveStatus, normalizedSymbol, supported]);

  const activeDay = useMemo(() => {
    if (mode === "selected") {
      return selectedDay;
    }
    if (fallbackDay) {
      return fallbackDay;
    }
    const windowMinutes = windowToMinuteCount(windowKey);
    const levels = sumMinuteWindows(Array.from(minutes.values()), windowMinutes);
    return {
      sessionDate: liveSessionDate,
      totals: buildLadder(levels, sourcePriceStep).totals,
      levels
    };
  }, [fallbackDay, liveSessionDate, minutes, mode, selectedDay, sourcePriceStep, windowKey]);

  const maxTargetRows = useMemo(() => maxOrderFlowTargetRowsForHeight(canvasSize.height), [canvasSize.height]);
  const autoTargetRows = useMemo(() => autoOrderFlowTargetRows(canvasSize.height), [canvasSize.height]);
  const effectiveTargetRows = useMemo(() => (
    resolveOrderFlowTargetRows(resolution, autoTargetRows, maxTargetRows)
  ), [autoTargetRows, maxTargetRows, resolution]);
  const lastPrice = useMemo(() => latestPanelPrice(minutes, liveQuote), [liveQuote, minutes]);
  const priceRange = useMemo(() => {
    if (!activeDay?.levels.length) {
      return sourcePriceStep;
    }
    const prices = activeDay.levels.map((level) => level.priceBin).filter((price) => Number.isFinite(price));
    return prices.length ? Math.max(...prices) - Math.min(...prices) : sourcePriceStep;
  }, [activeDay, sourcePriceStep]);
  const resolvedPriceStep = useMemo(() => {
    if (!activeDay?.levels.length) {
      return sourcePriceStep;
    }
    return effectiveOrderFlowPriceStep(priceRange, effectiveTargetRows, sourcePriceStep);
  }, [activeDay, effectiveTargetRows, priceRange, sourcePriceStep]);
  const fullLadder = useMemo(() => {
    if (!activeDay?.levels.length) {
      return null;
    }
    return buildLadder(rebinLevels(activeDay.levels, sourcePriceStep, resolvedPriceStep), resolvedPriceStep, activeDay.sessionDate);
  }, [activeDay, resolvedPriceStep, sourcePriceStep]);
  const clipped = useMemo(() => (
    fullLadder ? clipPanelLadder(fullLadder, maxTargetRows, fullLadder.levels.length > maxTargetRows, lastPrice) : { ladder: null, clipped: false }
  ), [fullLadder, lastPrice, maxTargetRows]);
  const ladder = clipped.ladder;

  useEffect(() => {
    resolutionMetricsRef.current = {
      autoRows: autoTargetRows,
      maxRows: maxTargetRows,
      targetRows: effectiveTargetRows,
      effectiveStep: resolvedPriceStep
    };
  }, [autoTargetRows, effectiveTargetRows, maxTargetRows, resolvedPriceStep]);

  useEffect(() => {
    drawStateRef.current = {
      ladder,
      liveQuote,
      lastPrice,
      clippedHint: clipped.clipped,
      mode,
      streamState,
      loading: symbolsLoading,
      supported,
      symbol: normalizedSymbol,
      supportedSymbols,
      effectiveStep: resolvedPriceStep,
      targetRows: effectiveTargetRows,
      resolution,
      wheelFeedback
    };
    scheduleDrawRef.current?.();
  }, [
    clipped.clipped,
    effectiveTargetRows,
    ladder,
    lastPrice,
    liveQuote,
    mode,
    normalizedSymbol,
    resolution,
    resolvedPriceStep,
    streamState,
    supported,
    supportedSymbols,
    symbolsLoading,
    wheelFeedback
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    let animationFrame: number | null = null;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const theme = readThemeColors();
      const state = drawStateRef.current;
      context.clearRect(0, 0, rect.width, rect.height);
      if (!state.ladder) {
        context.fillStyle = theme.muted;
        applyCanvasTypography(context, "caption");
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(emptyPanelMessage(state.loading, state.supported, state.symbol, state.supportedSymbols), rect.width / 2, rect.height / 2, Math.max(80, rect.width - 22));
        drawPanelCaptions(context, rect.width, rect.height, state, theme);
        return;
      }
      const inset = rect.width < 150 || rect.height < 110 ? 3 : 7;
      drawOrderFlowPanelLadder(context, {
        x: inset,
        y: inset,
        width: Math.max(40, rect.width - inset * 2),
        height: Math.max(40, rect.height - inset * 2)
      }, state.ladder, theme, {
        quote: state.mode === "live" ? state.liveQuote : null,
        lastPrice: state.mode === "live" ? state.lastPrice : null,
        clippedHint: state.clippedHint
      });
      drawPanelCaptions(context, rect.width, rect.height, state, theme);
      const feedbackActive = drawWheelFeedback(context, rect.width, rect.height, state, theme);
      if (feedbackActive) {
        schedule();
      }
    };
    const schedule = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        draw();
      });
    };
    scheduleDrawRef.current = schedule;
    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize((current) => (
        Math.round(current.width) === Math.round(rect.width) && Math.round(current.height) === Math.round(rect.height)
          ? current
          : { width: rect.width, height: rect.height }
      ));
      schedule();
    };
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(canvas);
    updateSize();
    schedule();
    return () => {
      resizeObserver.disconnect();
      scheduleDrawRef.current = null;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  const dailyMode = mode === "selected" || Boolean(fallbackDay);
  const disabledWindowBadge = mode === "selected"
    ? `day · ${selectedDate ?? ""}`
    : fallbackDay ? `day · ${fallbackDay.sessionDate}` : null;
  const symbolOptions = useMemo<ChartSymbolDto[]>(() => (
    supportedSymbols.map((item) => ({ symbol: item, name: "Order Flow Pin" }))
  ), [supportedSymbols]);

  const handlePointerEnter = useCallback(() => {
    if (overlayIntentRef.current !== null) {
      window.clearTimeout(overlayIntentRef.current);
    }
    overlayIntentRef.current = window.setTimeout(() => {
      setOverlayVisible(true);
      overlayIntentRef.current = null;
    }, 100);
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (overlayIntentRef.current !== null) {
      window.clearTimeout(overlayIntentRef.current);
      overlayIntentRef.current = null;
    }
    setOverlayVisible(false);
  }, []);

  const handleSymbolChange = useCallback((nextSymbol: string) => {
    const normalized = nextSymbol.trim().toUpperCase();
    if (normalized) {
      onSymbolChange?.(normalized);
    }
  }, [onSymbolChange]);

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (overlayVisible) {
      return;
    }
    event.preventDefault();
    const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 80 : event.deltaY;
    wheelAccumulatorRef.current += deltaY;
    let fired = false;
    while (Math.abs(wheelAccumulatorRef.current) >= wheelNotchThreshold) {
      const direction: 1 | -1 = wheelAccumulatorRef.current < 0 ? 1 : -1;
      updateResolution((current) => {
        const metrics = resolutionMetricsRef.current;
        const baseRows = current === "auto" ? metrics.targetRows : current;
        return stepOrderFlowTargetRows(baseRows, direction, metrics.maxRows);
      });
      wheelAccumulatorRef.current -= Math.sign(wheelAccumulatorRef.current) * wheelNotchThreshold;
      fired = true;
    }
    if (fired) {
      const rect = event.currentTarget.getBoundingClientRect();
      showWheelFeedback(event.clientX - rect.left, event.clientY - rect.top);
    }
  }, [overlayVisible, showWheelFeedback, updateResolution]);

  return (
    <section
      className="order-flow-panel"
      data-panel-id={panelId}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={() => setOverlayVisible(true)}
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
          setOverlayVisible(false);
        }
      }}
    >
      <canvas
        ref={canvasRef}
        className="order-flow-canvas"
        aria-label={`${normalizedSymbol} order flow profile`}
        onWheel={handleCanvasWheel}
      />
      <div
        className={`order-flow-hover-overlay ${overlayVisible ? "is-visible" : ""}`}
        aria-hidden={!overlayVisible}
        onWheel={(event) => event.stopPropagation()}
      >
        <SymbolSearch
          symbols={symbolOptions}
          selectedSymbol={supported ? normalizedSymbol : undefined}
          selectedLabel={normalizedSymbol}
          placeholder="symbol search..."
          className="order-flow-symbol-search"
          allowCustomSymbol
          portalMenu={false}
          formatSelectedLabel={(item) => item.symbol}
          onSelectSymbol={handleSymbolChange}
          onPointerActivity={() => setOverlayVisible(true)}
        />
        <div className={`order-flow-window-grid ${dailyMode ? "is-disabled" : ""}`} aria-label="Order flow time window">
          {disabledWindowBadge && <span className="order-flow-window-badge">{disabledWindowBadge}</span>}
          {ORDER_FLOW_WINDOWS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === windowKey ? "active" : ""}
              disabled={dailyMode}
              onClick={() => setWindowKey(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function drawPanelCaptions(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: {
    mode: PanelMode;
    streamState: StreamState;
    symbol: string;
    supported: boolean;
    effectiveStep: number;
    resolution: OrderFlowResolutionSelection;
  },
  theme: ThemeColors
): void {
  const small = width < 150 || height < 112;
  const modeLabel = state.mode === "selected" ? "day" : state.streamState === "live" ? "live" : state.streamState;
  const symbolLabel = state.symbol || "Order Flow";
  const topLabel = small ? `${symbolLabel} est.` : `${symbolLabel} · ${modeLabel} · est.`;
  const bottomLabel = small
    ? formatPriceStep(state.effectiveStep)
    : `bin ${formatPriceStep(state.effectiveStep)}${state.resolution === "auto" ? " auto" : ""}`;
  drawCaptionPill(context, 6, 6, topLabel, theme, small);
  drawCaptionPill(context, 6, Math.max(6, height - (small ? 24 : 28)), bottomLabel, theme, small);
}

function drawWheelFeedback(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: {
    effectiveStep: number;
    targetRows: number;
    wheelFeedback: WheelFeedback;
  },
  theme: ThemeColors
): boolean {
  if (!state.wheelFeedback) {
    return false;
  }
  const remaining = state.wheelFeedback.expiresAt - Date.now();
  if (remaining <= 0) {
    return false;
  }
  const label = `${formatPriceStep(state.effectiveStep)} · ${state.targetRows} rows`;
  context.save();
  applyCanvasTypography(context, "caption");
  const availableWidth = Math.max(48, width - 16);
  const pillWidth = Math.min(availableWidth, Math.max(76, context.measureText(label).width + 18));
  const pillHeight = 24;
  const x = clamp(state.wheelFeedback.x - pillWidth / 2, 8, Math.max(8, width - pillWidth - 8));
  const y = clamp(state.wheelFeedback.y - pillHeight - 10, 8, Math.max(8, height - pillHeight - 8));
  context.globalAlpha = Math.min(1, remaining / 260);
  context.fillStyle = theme.surfaceStrong;
  roundRect(context, x, y, pillWidth, pillHeight, 6);
  context.fill();
  context.globalAlpha = Math.min(1, remaining / 260) * 0.95;
  context.fillStyle = theme.text;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x + pillWidth / 2, y + pillHeight / 2 + 0.5, pillWidth - 12);
  context.restore();
  return true;
}

function drawCaptionPill(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  theme: ThemeColors,
  small: boolean
): void {
  context.save();
  applyCanvasTypography(context, "caption");
  const width = Math.ceil(context.measureText(label).width) + (small ? 10 : 12);
  const height = small ? 20 : 22;
  context.globalAlpha = 0.7;
  context.fillStyle = theme.surface;
  roundRect(context, x, y, width, height, 5);
  context.fill();
  context.globalAlpha = 0.88;
  context.fillStyle = theme.text;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x + width / 2, y + height / 2 + 0.5, width - 8);
  context.restore();
}

function windowToMinuteCount(windowKey: OrderFlowWindow): number | "session" {
  if (windowKey === "session") {
    return "session";
  }
  if (windowKey === "1h") {
    return 60;
  }
  return windowKey === "10m" ? 10 : 1;
}

function normalizeLiveQuote(event: CandleEventDto): LiveQuote {
  const data = event.type === "LIVE_QUOTE_UPDATE" ? event.data : {};
  return {
    bidPrice: finiteNumber(data.bidPrice),
    askPrice: finiteNumber(data.askPrice),
    bidSize: finiteNumber(data.bidSize),
    askSize: finiteNumber(data.askSize),
    timestamp: typeof data.timestamp === "string" ? data.timestamp : undefined
  };
}

function emptyPanelMessage(loading: boolean, supported: boolean, symbol: string, supportedSymbols: string[]): string {
  if (loading) {
    return "오더플로우 심볼을 확인하는 중입니다";
  }
  if (!supported) {
    const supportedText = supportedSymbols.length ? ` · 지원: ${supportedSymbols.join(", ")}` : "";
    return `Order Flow는 아직 ${symbol}을 지원하지 않아요${supportedText}`;
  }
  return "아직 수집된 오더플로우 데이터가 없어요";
}

function sessionDateDaysBefore(sessionDate: string, days: number): string {
  const [year, month, day] = sessionDate.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return sessionDate;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clipPanelLadder(
  ladder: OrderFlowLadder,
  maxRows: number,
  shouldClip: boolean,
  lastPrice: number | null
): { ladder: OrderFlowLadder | null; clipped: boolean } {
  const rowLimit = Math.max(1, Math.floor(maxRows));
  if (!shouldClip || ladder.levels.length <= rowLimit) {
    return { ladder, clipped: false };
  }
  const anchorPrice = ladder.pocPriceBin ?? lastPrice ?? ladder.levels[Math.floor(ladder.levels.length / 2)]?.priceBin;
  const anchorIndex = typeof anchorPrice === "number"
    ? nearestLevelIndexByPrice(ladder.levels, anchorPrice)
    : Math.floor(ladder.levels.length / 2);
  const start = Math.max(0, Math.min(ladder.levels.length - rowLimit, anchorIndex - Math.floor(rowLimit / 2)));
  const levels = ladder.levels.slice(start, start + rowLimit);
  return {
    ladder: {
      ...ladder,
      levels,
      minPrice: Math.min(...levels.map((level) => level.priceBin)),
      maxPrice: Math.max(...levels.map((level) => level.priceBin)),
      maxLevelVolume: Math.max(1, ...levels.map((level) => level.totalVolume))
    },
    clipped: true
  };
}

function latestPanelPrice(minutes: Map<string, OrderFlowMinuteDto>, quote: LiveQuote | null): number | null {
  if (typeof quote?.bidPrice === "number" && typeof quote.askPrice === "number") {
    return (quote.bidPrice + quote.askPrice) / 2;
  }
  const latest = Array.from(minutes.values()).sort((left, right) => left.eventMinute.localeCompare(right.eventMinute)).at(-1);
  if (!latest?.bins.length) {
    return null;
  }
  return latest.bins.reduce((best, level) => {
    const volume = level.askVolume + level.bidVolume + level.unknownVolume;
    const bestVolume = best.askVolume + best.bidVolume + best.unknownVolume;
    return volume > bestVolume ? level : best;
  }).priceBin;
}

function nearestLevelIndexByPrice(levels: OrderFlowLadder["levels"], price: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  levels.forEach((level, index) => {
    const distance = Math.abs(level.priceBin - price);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function formatPriceStep(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.01";
  }
  if (value >= 1) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}
