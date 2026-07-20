import { type WheelEvent as ReactWheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CandleEventDto, ChartSymbolDto } from "../chart/types";
import { openChartSocket } from "../chart/cdcClient";
import {
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
  orderFlowUnsupportedMessage,
  rebinLevels,
  replaceOrderFlowMinute,
  resolveOrderFlowTargetRows,
  stepOrderFlowTargetRows,
  sumMinuteWindows,
  type OrderFlowIntradayResponseDto,
  type OrderFlowLadder,
  type OrderFlowMinuteDto,
  type OrderFlowResolutionSelection,
  type OrderFlowWindow
} from "../chart/orderFlow";
import { drawOrderFlowPanelLadder } from "../chart/orderFlowRender";
import { readThemeColors } from "../theme/colors";
import type { ThemeColors } from "../theme/colors";
import { applyCanvasTypography, CANVAS_FONT_FAMILY } from "../theme/typography";
import { SymbolSearch } from "./SymbolSearch";

type OrderFlowPanelProps = {
  panelId: string;
  symbol: string;
  savedWindow?: OrderFlowWindow;
  savedResolution?: OrderFlowResolutionSelection;
  onSymbolChange?: (symbol: string) => void;
  onWindowChange?: (windowKey: OrderFlowWindow) => void;
  onResolutionChange?: (resolution: OrderFlowResolutionSelection) => void;
};

type LiveQuote = NonNullable<OrderFlowIntradayResponseDto["liveQuote"]>;
type StreamState = "connecting" | "live" | "idle" | "error";
type LoadState = "loading" | "ready" | "empty" | "unsupported" | "error";
type WheelFeedback = { x: number; y: number; expiresAt: number } | null;

const defaultWindow: OrderFlowWindow = "10m";
const defaultResolution: OrderFlowResolutionSelection = "auto";
const preferredDefaultSymbol = "NVDA";
const wheelNotchThreshold = 90;
const canvasFontFamily = CANVAS_FONT_FAMILY;

export function OrderFlowPanel({
  panelId,
  symbol,
  savedWindow = defaultWindow,
  savedResolution = defaultResolution,
  onSymbolChange,
  onWindowChange,
  onResolutionChange
}: OrderFlowPanelProps) {
  const requestedSymbol = symbol.trim().toUpperCase();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scheduleDrawRef = useRef<(() => void) | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const feedbackTimerRef = useRef<number | null>(null);
  const snapshotSymbolRef = useRef("");
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
    streamState: StreamState;
    loading: boolean;
    error: boolean;
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
    streamState: "idle",
    loading: true,
    error: false,
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
  const liveSessionDateRef = useRef("");
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [initialSnapshotSettled, setInitialSnapshotSettled] = useState(false);
  const [wheelFeedback, setWheelFeedback] = useState<WheelFeedback>(null);

  useEffect(() => {
    setWindowKeyState(savedWindow);
  }, [savedWindow]);

  useEffect(() => {
    setResolutionState(savedResolution);
  }, [savedResolution]);

  useEffect(() => () => {
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
    if (requestedSymbol) {
      return requestedSymbol;
    }
    return supportedSymbols.includes(preferredDefaultSymbol)
      ? preferredDefaultSymbol
      : supportedSymbols[0] ?? preferredDefaultSymbol;
  }, [requestedSymbol, supportedSymbols]);
  const supported = supportedSymbols.includes(normalizedSymbol);

  useEffect(() => {
    const controller = new AbortController();
    setSymbolsLoading(true);
    setLoadState("loading");
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
          setLoadState("error");
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
    if (!requestedSymbol && supportedSymbols.length > 0 && supported) {
      onSymbolChange?.(normalizedSymbol);
    }
  }, [normalizedSymbol, onSymbolChange, requestedSymbol, supported, supportedSymbols.length]);

  useEffect(() => {
    if (symbolsLoading) {
      setLoadState("loading");
      setInitialSnapshotSettled(false);
      return;
    }
    if (!normalizedSymbol || !supported) {
      setMinutes(new Map());
      setLiveSessionDate("");
      liveSessionDateRef.current = "";
      setLiveQuote(null);
      setInitialSnapshotSettled(false);
      setLoadState((current) => current === "error"
        ? "error"
        : normalizedSymbol && !symbolsLoading ? "unsupported" : "loading");
      return;
    }
    const controller = new AbortController();
    if (snapshotSymbolRef.current !== normalizedSymbol) {
      snapshotSymbolRef.current = normalizedSymbol;
      setMinutes(new Map());
      setLiveSessionDate("");
      liveSessionDateRef.current = "";
      setLiveQuote(null);
    }
    setLoadState("loading");
    setInitialSnapshotSettled(false);
    fetchOrderFlowIntraday(
      normalizedSymbol,
      controller.signal,
      undefined,
      windowToMinuteCount(windowKey)
    )
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        liveSessionDateRef.current = response.sessionDate;
        setLiveSessionDate(response.sessionDate);
        setLiveQuote(response.liveQuote);
        setMinutes(new Map(response.minutes.map((minute) => [minute.eventMinute, minute])));
        setLoadState(response.dataStatus);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadState("error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setInitialSnapshotSettled(true);
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol, supported, symbolsLoading, windowKey]);

  useEffect(() => {
    if (!normalizedSymbol || !supported || !initialSnapshotSettled) {
      setStreamState("idle");
      return undefined;
    }
    const handleEvent = (event: CandleEventDto) => {
      if (event.type === "ORDER_FLOW_BINS_UPDATE" && event.symbol.toUpperCase() === normalizedSymbol) {
        const previousSessionDate = liveSessionDateRef.current;
        liveSessionDateRef.current = event.data.sessionDate;
        setLiveSessionDate(event.data.sessionDate);
        setMinutes((current) => replaceOrderFlowMinute(current, event.data, previousSessionDate));
        setLoadState("ready");
        return;
      }
      if (event.type === "LIVE_QUOTE_UPDATE" && event.symbol.toUpperCase() === normalizedSymbol) {
        setLiveQuote(normalizeLiveQuote(event));
      }
    };
    const handleStreamState = (state: StreamState) => {
      setStreamState(state === "connecting" || state === "live" || state === "error" ? state : "idle");
      if (state === "error") {
        setLoadState("error");
      }
    };
    const demoCleanup = subscribeOrderFlowDemoTicks(
      normalizedSymbol,
      handleEvent,
      handleStreamState
    );
    if (demoCleanup) {
      return demoCleanup;
    }
    return openChartSocket(
      normalizedSymbol,
      "1m",
      handleEvent,
      handleStreamState,
      { orderFlow: true, candles: false }
    );
  }, [initialSnapshotSettled, normalizedSymbol, supported]);

  const activeProfile = useMemo(() => {
    const windowMinutes = windowToMinuteCount(windowKey);
    const levels = sumMinuteWindows(Array.from(minutes.values()), windowMinutes);
    return {
      sessionDate: liveSessionDate,
      levels
    };
  }, [liveSessionDate, minutes, windowKey]);

  const maxTargetRows = useMemo(() => maxOrderFlowTargetRowsForHeight(canvasSize.height), [canvasSize.height]);
  const autoTargetRows = useMemo(() => autoOrderFlowTargetRows(canvasSize.height), [canvasSize.height]);
  const effectiveTargetRows = useMemo(() => (
    resolveOrderFlowTargetRows(resolution, autoTargetRows, maxTargetRows)
  ), [autoTargetRows, maxTargetRows, resolution]);
  const lastPrice = useMemo(() => latestPanelPrice(minutes, liveQuote), [liveQuote, minutes]);
  const priceRange = useMemo(() => {
    if (!activeProfile.levels.length) {
      return sourcePriceStep;
    }
    const prices = activeProfile.levels.map((level) => level.priceBin).filter((price) => Number.isFinite(price));
    return prices.length ? Math.max(...prices) - Math.min(...prices) : sourcePriceStep;
  }, [activeProfile, sourcePriceStep]);
  const resolvedPriceStep = useMemo(() => {
    if (!activeProfile.levels.length) {
      return sourcePriceStep;
    }
    return effectiveOrderFlowPriceStep(priceRange, effectiveTargetRows, sourcePriceStep);
  }, [activeProfile, effectiveTargetRows, priceRange, sourcePriceStep]);
  const fullLadder = useMemo(() => {
    if (!activeProfile.levels.length) {
      return null;
    }
    return buildLadder(rebinLevels(activeProfile.levels, sourcePriceStep, resolvedPriceStep), resolvedPriceStep, activeProfile.sessionDate);
  }, [activeProfile, resolvedPriceStep, sourcePriceStep]);
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
      streamState,
      loading: loadState === "loading",
      error: loadState === "error",
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
    normalizedSymbol,
    resolution,
    resolvedPriceStep,
    streamState,
    supported,
    supportedSymbols,
    loadState,
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
        applyCanvasTypography(context, "bodyMd", canvasFontFamily);
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(emptyPanelMessage(state.loading, state.error, state.supported, state.symbol, state.supportedSymbols), rect.width / 2, rect.height / 2, Math.max(80, rect.width - 22));
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
        quote: state.liveQuote,
        lastPrice: state.lastPrice,
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

  const symbolOptions = useMemo<ChartSymbolDto[]>(() => (
    supportedSymbols.map((item) => ({ symbol: item, name: "Order Flow Pin" }))
  ), [supportedSymbols]);

  const handleSymbolChange = useCallback((nextSymbol: string) => {
    const normalized = nextSymbol.trim().toUpperCase();
    if (normalized) {
      onSymbolChange?.(normalized);
    }
  }, [onSymbolChange]);

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<HTMLCanvasElement>) => {
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
  }, [showWheelFeedback, updateResolution]);

  return (
    <section
      className="order-flow-panel"
      data-panel-id={panelId}
      data-order-flow-symbol={normalizedSymbol}
      data-order-flow-window={windowKey}
      data-order-flow-resolution={resolution}
      data-order-flow-status={loadState === "error" ? "error" : ladder ? "ready" : loadState}
    >
      <canvas
        ref={canvasRef}
        className="order-flow-canvas"
        aria-label={`${normalizedSymbol} order flow profile`}
        onWheel={handleCanvasWheel}
      />
      <div className="order-flow-hover-overlay">
        <SymbolSearch
          symbols={symbolOptions}
          selectedSymbol={supported ? normalizedSymbol : undefined}
          selectedLabel={normalizedSymbol}
          placeholder="symbol search..."
          className="order-flow-symbol-search"
          compact
          allowCustomSymbol
          portalMenu={false}
          formatSelectedLabel={(item) => item.symbol}
          onSelectSymbol={handleSymbolChange}
        />
        <div className="order-flow-window-grid" aria-label="Order flow time window">
          {ORDER_FLOW_WINDOWS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === windowKey ? "active" : ""}
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
    streamState: StreamState;
    symbol: string;
    supported: boolean;
    effectiveStep: number;
    resolution: OrderFlowResolutionSelection;
  },
  theme: ThemeColors
): void {
  const small = width < 150 || height < 112;
  const modeLabel = state.streamState === "live" ? "live" : state.streamState;
  const symbolLabel = state.symbol || "Order Flow";
  const topLabel = small ? `${symbolLabel} est.` : `${symbolLabel} · ${modeLabel} · est.`;
  const bottomLabel = small
    ? formatPriceStep(state.effectiveStep)
    : `bin ${formatPriceStep(state.effectiveStep)}${state.resolution === "auto" ? " auto" : ""}`;
  drawCaptionPill(context, 6, 6, topLabel, theme, small);
  drawCaptionPill(context, 6, Math.max(6, height - (small ? 22 : 24)), bottomLabel, theme, small);
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
  applyCanvasTypography(context, "labelMd", canvasFontFamily);
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
  applyCanvasTypography(context, "caption", canvasFontFamily);
  const width = Math.ceil(context.measureText(label).width) + (small ? 10 : 12);
  const height = small ? 16 : 18;
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

function emptyPanelMessage(loading: boolean, error: boolean, supported: boolean, symbol: string, supportedSymbols: string[]): string {
  if (loading) {
    return "오더플로우 심볼을 확인하는 중입니다";
  }
  if (error) {
    return "오더플로우 데이터를 불러오지 못했습니다";
  }
  if (!supported) {
    return orderFlowUnsupportedMessage(symbol, supportedSymbols);
  }
  return "아직 수집된 오더플로우 데이터가 없어요";
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
