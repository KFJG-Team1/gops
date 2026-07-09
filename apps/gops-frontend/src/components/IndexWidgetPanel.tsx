import { LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketIndexItem } from "../market/indicesApi";
import { useMarketIndices } from "../market/useMarketIndices";

type IndexWidgetVariant = "1x1" | "2x2";
type Direction = "positive" | "negative" | "neutral";

const ROTATION_MS = 5_000;
const ANIMATION_MS = 350;
const GROUP_ORDER = ["US", "Korea", "Asia", "Commodities", "Crypto", "FX"];

export function IndexWidgetPanel({ variant }: { variant: IndexWidgetVariant }) {
  const { payload, loading, refreshing, error, warning, reload } = useMarketIndices();
  const items = useMemo(() => flattenIndexItems(payload?.items ?? []), [payload?.items]);
  const itemSignature = useMemo(() => items.map((item) => item.symbol).join("|"), [items]);
  const [displayCursor, setDisplayCursor] = useState(0);
  const [animationPhase, setAnimationPhase] = useState<"idle" | "out" | "in">("idle");
  const [rotationPaused, setRotationPaused] = useState(false);
  const cursorRef = useRef(0);
  const visibleSymbolsRef = useRef<string[]>([]);
  const animatingRef = useRef(false);
  const outTimerRef = useRef<number | null>(null);
  const inTimerRef = useRef<number | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const step = variant === "1x1" ? 1 : 4;
  const canRotate = variant === "1x1" ? items.length > 1 : items.length > 4;

  const visibleItems = useMemo(
    () => visibleItemsForVariant(items, displayCursor, variant),
    [displayCursor, items, variant]
  );
  const emptySlots = variant === "2x2" ? Math.max(0, 4 - visibleItems.length) : 0;
  const pauseRotation = useCallback(() => setRotationPaused(true), []);
  const resumeRotation = useCallback(() => setRotationPaused(false), []);

  const clearAnimationTimers = useCallback(() => {
    if (outTimerRef.current !== null) {
      window.clearTimeout(outTimerRef.current);
      outTimerRef.current = null;
    }
    if (inTimerRef.current !== null) {
      window.clearTimeout(inTimerRef.current);
      inTimerRef.current = null;
    }
  }, []);

  const swapCursor = useCallback((nextCursor: number) => {
    setDisplayCursor(nextCursor);
    cursorRef.current = nextCursor;
  }, []);

  const transitionTo = useCallback(
    (nextCursorRaw: number, interrupt: boolean) => {
      if (items.length === 0) {
        return;
      }
      const nextCursor = normalizeCursor(nextCursorRaw, items.length);
      if (nextCursor === cursorRef.current) {
        return;
      }
      if (prefersReducedMotion) {
        clearAnimationTimers();
        animatingRef.current = false;
        setAnimationPhase("idle");
        swapCursor(nextCursor);
        return;
      }
      if (animatingRef.current) {
        if (!interrupt) {
          return;
        }
        clearAnimationTimers();
      }
      animatingRef.current = true;
      setAnimationPhase("out");
      outTimerRef.current = window.setTimeout(() => {
        swapCursor(nextCursor);
        setAnimationPhase("in");
        outTimerRef.current = null;
        inTimerRef.current = window.setTimeout(() => {
          setAnimationPhase("idle");
          animatingRef.current = false;
          inTimerRef.current = null;
        }, ANIMATION_MS);
      }, ANIMATION_MS);
    },
    [clearAnimationTimers, items.length, prefersReducedMotion, swapCursor]
  );

  const advance = useCallback(() => {
    if (!canRotate) {
      return;
    }
    transitionTo(cursorRef.current + step, false);
  }, [canRotate, step, transitionTo]);

  useEffect(() => {
    cursorRef.current = displayCursor;
  }, [displayCursor]);

  useEffect(() => {
    return () => clearAnimationTimers();
  }, [clearAnimationTimers]);

  useEffect(() => {
    clearAnimationTimers();
    animatingRef.current = false;
    setAnimationPhase("idle");
    if (items.length === 0) {
      swapCursor(0);
      return;
    }
    const rematchedCursor = firstVisibleSymbolIndex(visibleSymbolsRef.current, items);
    const nextCursor = rematchedCursor ?? normalizeCursor(cursorRef.current, items.length);
    swapCursor(nextCursor);
  }, [clearAnimationTimers, itemSignature, items, items.length, swapCursor]);

  useEffect(() => {
    visibleSymbolsRef.current = visibleItems.map((item) => item.symbol);
  }, [visibleItems]);

  useEffect(() => {
    if (!canRotate || rotationPaused) {
      return undefined;
    }
    const intervalId = window.setInterval(advance, ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [advance, canRotate, rotationPaused]);

  return (
    <section
      className={`index-widget-panel is-${variant}`}
      aria-label={variant === "1x1" ? "시장 지수 1x1 위젯" : "시장 지수 2x2 위젯"}
      onMouseEnter={pauseRotation}
      onMouseLeave={resumeRotation}
      onPointerEnter={pauseRotation}
      onPointerMove={pauseRotation}
      onPointerLeave={resumeRotation}
    >
      <button
        className="panel-reload-overlay panel-icon-button"
        type="button"
        title="지수 새로고침"
        aria-label="지수 새로고침"
        onClick={() => void reload(true)}
      >
        {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
      </button>
      {loading && (
        <div className="panel-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>지수를 불러오는 중입니다</span>
        </div>
      )}
      {error && !loading && <div className="panel-error-row">{error}</div>}
      {warning && !loading && !error && <div className="panel-state-row">{warning}</div>}
      {!loading && !error && items.length === 0 && <div className="panel-empty-row">표시할 지수 데이터가 없습니다</div>}
      {!loading && !error && items.length > 0 && (
        <div className="index-widget-stack">
          <div className={`index-widget-anim is-${animationPhase}`}>
            <div className={`index-widget-grid is-${variant === "1x1" ? "single" : "quad"}`}>
              {visibleItems.map((item) => (
                <div className="index-widget-cell" key={item.symbol}>
                  <IndexWidgetCard item={item} />
                </div>
              ))}
              {Array.from({ length: emptySlots }).map((_, index) => (
                <div className="index-widget-cell" key={`empty-${index}`}>
                  <div className="index-widget-empty" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function IndexWidgetCard({ item }: { item: MarketIndexItem }) {
  const direction = directionForItem(item);
  return (
    <article className={`index-widget-card surface-raised is-${direction}`}>
      <header className="index-widget-card-top">
        <div className="index-widget-title">
          <strong className="index-widget-symbol">{stripCaret(item.symbol)}</strong>
          <span className="index-widget-name">{item.name}</span>
        </div>
        <strong className={`index-widget-percent is-${direction}`}>
          {item.changePercent != null ? formatPercent(item.changePercent) : "--"}
        </strong>
      </header>
      <MiniAreaSparkline values={item.sparkline} direction={direction} />
      <footer className="index-widget-card-bottom">
        <span className="index-widget-price">{formatPrice(item)}</span>
      </footer>
    </article>
  );
}

function MiniAreaSparkline({ values, direction }: { values: number[]; direction: Direction }) {
  const { points, areaPath, currentY } = sparklineGeometry(values);
  return (
    <svg
      className={`index-widget-sparkline is-${direction}`}
      viewBox="0 0 120 42"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line
        className="index-widget-price-line"
        x1="0"
        y1={currentY}
        x2="120"
        y2={currentY}
        vectorEffect="non-scaling-stroke"
      />
      <path className="index-widget-sparkline-area" d={areaPath} vectorEffect="non-scaling-stroke" />
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function flattenIndexItems(items: MarketIndexItem[]) {
  const groups = new Map<string, MarketIndexItem[]>();
  items.forEach((item) => {
    const key = item.group || "Market";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => groupOrderIndex(left) - groupOrderIndex(right))
    .flatMap(([, groupItems]) => groupItems);
}

function groupOrderIndex(group: string) {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? 99 : index;
}

function visibleItemsForVariant(items: MarketIndexItem[], cursor: number, variant: IndexWidgetVariant) {
  if (items.length === 0) {
    return [];
  }
  if (variant === "1x1") {
    return [items[normalizeCursor(cursor, items.length)]!];
  }
  const count = Math.min(4, items.length);
  return Array.from({ length: count }, (_, index) => items[normalizeCursor(cursor + index, items.length)]!);
}

function firstVisibleSymbolIndex(symbols: string[], items: MarketIndexItem[]) {
  for (const symbol of symbols) {
    const nextIndex = items.findIndex((item) => item.symbol === symbol);
    if (nextIndex >= 0) {
      return nextIndex;
    }
  }
  return null;
}

function normalizeCursor(cursor: number, count: number) {
  if (count <= 0) {
    return 0;
  }
  return ((cursor % count) + count) % count;
}

function directionForItem(item: MarketIndexItem): Direction {
  const basis = item.changePercent ?? item.change;
  if (basis == null) {
    return "neutral";
  }
  return basis > 0 ? "positive" : basis < 0 ? "negative" : "neutral";
}

function stripCaret(symbol: string): string {
  return symbol.startsWith("^") ? symbol.slice(1) : symbol;
}

function sparklineGeometry(values: number[]): { points: string; areaPath: string; currentY: string } {
  const width = 120;
  const height = 42;
  if (values.length < 2) {
    return {
      points: `0,${height / 2} ${width},${height / 2}`,
      areaPath: `M 0,${height} L 0,${height / 2} L ${width},${height / 2} L ${width},${height} Z`,
      currentY: String(height / 2)
    };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const yOf = (value: number) => height - ((value - min) / range) * (height - 6) - 3;
  const coordinates = values.map((value, index) => ({
    x: roundCoord((index / (values.length - 1)) * width),
    y: roundCoord(yOf(value))
  }));
  const points = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = [
    `M ${coordinates[0]!.x},${height}`,
    ...coordinates.map((point, index) => `${index === 0 ? "L" : "L"} ${point.x},${point.y}`),
    `L ${coordinates[coordinates.length - 1]!.x},${height}`,
    "Z"
  ].join(" ");
  return { points, areaPath, currentY: coordinates[coordinates.length - 1]!.y };
}

function formatPrice(item: MarketIndexItem): string {
  if (item.price == null) {
    return "N/A";
  }
  if (item.symbol === "BTC-USD") {
    return formatNumber(item.price, 0, 0);
  }
  if (item.symbol === "KRW=X") {
    return formatNumber(item.price, 2, 2);
  }
  if (item.assetClass === "commodity") {
    return formatNumber(item.price, 2, 2);
  }
  return formatNumber(item.price, 2, 2);
}

function formatPercent(value: number): string {
  if (value > 0) {
    return `▲ ${formatNumber(Math.abs(value), 2, 2)}%`;
  }
  if (value < 0) {
    return `▼ ${formatNumber(Math.abs(value), 2, 2)}%`;
  }
  return `${formatNumber(0, 2, 2)}%`;
}

function formatNumber(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
}

function roundCoord(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return prefersReducedMotion;
}
