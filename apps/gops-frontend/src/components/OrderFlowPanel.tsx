import { useEffect, useMemo, useRef, useState } from "react";
import type { CandleEventDto } from "../chart/types";
import { openChartSocket } from "../chart/cdcClient";
import {
  fetchOrderFlowDaily,
  fetchOrderFlowIntraday,
  fetchOrderFlowSymbols,
  subscribeOrderFlowDemoTicks
} from "../chart/orderFlowClient";
import {
  autoPriceStep,
  buildLadder,
  ORDER_FLOW_PRICE_STEPS,
  ORDER_FLOW_WINDOWS,
  rebinLevels,
  replaceOrderFlowMinute,
  sessionDateFromTimestamp,
  sumMinuteWindows,
  type OrderFlowDayDto,
  type OrderFlowIntradayResponseDto,
  type OrderFlowLadder,
  type OrderFlowMinuteDto,
  type OrderFlowPriceStepSelection,
  type OrderFlowWindow
} from "../chart/orderFlow";
import { drawOrderFlowPanelLadder } from "../chart/orderFlowRender";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import { readThemeColors } from "../theme/colors";

type OrderFlowPanelProps = {
  panelId: string;
  symbol: string;
  defaultToPinnedSymbol?: boolean;
  onSymbolChange?: (symbol: string) => void;
  semanticSelection: SemanticSelectionSnapshot | null;
};

type LiveQuote = NonNullable<OrderFlowIntradayResponseDto["liveQuote"]>;
type PanelMode = "live" | "selected";
type StreamState = "connecting" | "live" | "idle" | "error";

const defaultWindow: OrderFlowWindow = "10m";
const defaultPriceStep: OrderFlowPriceStepSelection = "auto";
const preferredDefaultSymbol = "NVDA";
const minPanelRows = 12;
const maxPanelRows = 44;

export function OrderFlowPanel({ panelId, symbol, defaultToPinnedSymbol = false, onSymbolChange, semanticSelection }: OrderFlowPanelProps) {
  const requestedSymbol = symbol.trim().toUpperCase();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scheduleDrawRef = useRef<(() => void) | null>(null);
  const drawStateRef = useRef<{
    ladder: OrderFlowLadder | null;
    liveQuote: LiveQuote | null;
    lastPrice: number | null;
    clippedHint: boolean;
    mode: PanelMode;
    loading: boolean;
    supported: boolean;
    symbol: string;
    supportedSymbols: string[];
  }>({
    ladder: null,
    liveQuote: null,
    lastPrice: null,
    clippedHint: false,
    mode: "live",
    loading: true,
    supported: false,
    symbol: "",
    supportedSymbols: []
  });
  const [supportedSymbols, setSupportedSymbols] = useState<string[]>([]);
  const [sourcePriceStep, setSourcePriceStep] = useState(0.01);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [windowKey, setWindowKey] = useState<OrderFlowWindow>(defaultWindow);
  const [priceStep, setPriceStep] = useState<OrderFlowPriceStepSelection>(defaultPriceStep);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [minutes, setMinutes] = useState<Map<string, OrderFlowMinuteDto>>(new Map());
  const [liveSessionDate, setLiveSessionDate] = useState("");
  const [liveStatus, setLiveStatus] = useState<OrderFlowIntradayResponseDto["dataStatus"]>("empty");
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [selectedDay, setSelectedDay] = useState<OrderFlowDayDto | null>(null);
  const [fallbackDay, setFallbackDay] = useState<OrderFlowDayDto | null>(null);

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

  const panelRowBudget = useMemo(() => (
    Math.max(minPanelRows, Math.min(maxPanelRows, Math.floor(Math.max(120, canvasSize.height - 28) / 13)))
  ), [canvasSize.height]);
  const lastPrice = useMemo(() => latestPanelPrice(minutes, liveQuote), [liveQuote, minutes]);
  const resolvedPriceStep = useMemo(() => {
    if (!activeDay?.levels.length) {
      return sourcePriceStep;
    }
    if (priceStep !== "auto") {
      return Math.max(sourcePriceStep, priceStep);
    }
    const prices = activeDay.levels.map((level) => level.priceBin).filter((price) => Number.isFinite(price));
    const priceRange = prices.length ? Math.max(...prices) - Math.min(...prices) : sourcePriceStep;
    return Math.max(sourcePriceStep, autoPriceStep(priceRange, panelRowBudget));
  }, [activeDay, panelRowBudget, priceStep, sourcePriceStep]);
  const fullLadder = useMemo(() => {
    if (!activeDay?.levels.length) {
      return null;
    }
    return buildLadder(rebinLevels(activeDay.levels, sourcePriceStep, resolvedPriceStep), resolvedPriceStep, activeDay.sessionDate);
  }, [activeDay, resolvedPriceStep, sourcePriceStep]);
  const clipped = useMemo(() => (
    fullLadder ? clipPanelLadder(fullLadder, panelRowBudget, priceStep !== "auto", lastPrice) : { ladder: null, clipped: false }
  ), [fullLadder, lastPrice, panelRowBudget, priceStep]);
  const ladder = clipped.ladder;

  useEffect(() => {
    drawStateRef.current = {
      ladder,
      liveQuote,
      lastPrice,
      clippedHint: clipped.clipped,
      mode,
      loading: symbolsLoading,
      supported,
      symbol: normalizedSymbol,
      supportedSymbols
    };
    scheduleDrawRef.current?.();
  }, [clipped.clipped, ladder, lastPrice, liveQuote, mode, normalizedSymbol, supported, supportedSymbols, symbolsLoading]);

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
        context.font = "700 12px Inter, system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(emptyPanelMessage(state.loading, state.supported, state.symbol, state.supportedSymbols), rect.width / 2, rect.height / 2, Math.max(80, rect.width - 22));
        return;
      }
      drawOrderFlowPanelLadder(context, { x: 12, y: 8, width: Math.max(80, rect.width - 24), height: Math.max(60, rect.height - 18) }, state.ladder, theme, {
        quote: state.mode === "live" ? state.liveQuote : null,
        lastPrice: state.mode === "live" ? state.lastPrice : null,
        clippedHint: state.clippedHint
      });
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

  const delta = ladder?.totals.delta ?? 0;
  const volume = ladder?.totals.volume ?? 0;
  const unknownPct = volume > 0 ? (ladder?.totals.unknownVolume ?? 0) / volume * 100 : 0;
  const pocText = ladder?.pocPriceBin === null || ladder?.pocPriceBin === undefined ? "-" : ladder.pocPriceBin.toFixed(2);
  const fallback = mode === "live" && fallbackDay ? `${fallbackDay.sessionDate} · daily aggregate` : null;
  const dailyMode = mode === "selected" || Boolean(fallbackDay);
  const windowSelectValue = dailyMode ? "day" : windowKey;
  const priceStepSelectValue = priceStep === "auto" ? "auto" : String(priceStep);
  return (
    <section className="order-flow-panel" data-panel-id={panelId}>
      <header className="order-flow-panel-header">
        <div className="order-flow-title">
          <span>Order Flow Profile</span>
          <span className="order-flow-estimated-pill">estimated</span>
        </div>
        <select
          className="order-flow-symbol-select"
          value={supported ? normalizedSymbol : ""}
          aria-label="Order flow symbol"
          onChange={(event) => onSymbolChange?.(event.target.value)}
        >
          {!supported && <option value="">{normalizedSymbol || "Symbol"}</option>}
          {supportedSymbols.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </header>
      <div className="order-flow-controls">
        <span className={`order-flow-mode ${mode}`}>{fallback ?? (mode === "selected" ? `${selectedDate} · daily aggregate` : streamState)}</span>
        <select
          className="order-flow-control-select"
          value={windowSelectValue}
          disabled={dailyMode}
          aria-label="Order flow window"
          onChange={(event) => setWindowKey(event.target.value as OrderFlowWindow)}
        >
          {dailyMode && <option value="day">day</option>}
          {ORDER_FLOW_WINDOWS.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select
          className="order-flow-control-select"
          value={priceStepSelectValue}
          aria-label="Order flow price step"
          onChange={(event) => setPriceStep(event.target.value === "auto" ? "auto" : Number(event.target.value) as OrderFlowPriceStepSelection)}
        >
          <option value="auto">auto</option>
          {ORDER_FLOW_PRICE_STEPS.map((item) => (
            <option key={item} value={item}>{item.toFixed(item < 0.1 ? 2 : item < 1 ? 2 : 0)}</option>
          ))}
        </select>
        <span className={`order-flow-delta ${delta >= 0 ? "up" : "down"}`}>Δ {signed(delta)}</span>
      </div>
      <div className="order-flow-stats">
        <span>POC {pocText}</span>
        <span>Vol {compactNumber(volume)}</span>
        <span>UNK {unknownPct.toFixed(1)}%</span>
      </div>
      <canvas ref={canvasRef} className="order-flow-canvas" aria-label={`${normalizedSymbol} order flow profile`} />
    </section>
  );
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

function signed(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`;
}

function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(Math.round(value));
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
