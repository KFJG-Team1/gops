import { LoaderCircle, RefreshCcw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MarketIndexItem } from "../market/indicesApi";
import { useMarketIndices } from "../market/useMarketIndices";
import { IndexWidgetCard } from "./IndexWidgetCard";

const ROTATION_MS = 5_000;
const ANIMATION_MS = 350;
const GROUP_ORDER = ["US", "Korea", "Asia", "Commodities", "Crypto", "FX"];

export const IndexWidgetPanel = memo(function IndexWidgetPanel({
  cols,
  rows,
  suspended = false
}: {
  cols: number;
  rows: number;
  suspended?: boolean;
}) {
  const { payload, loading, refreshing, error, warning, reload } = useMarketIndices();
  const items = useMemo(() => flattenIndexItems(payload?.items ?? []), [payload?.items]);
  const itemSignature = useMemo(() => items.map((item) => item.symbol).join("|"), [items]);
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  const visibleCount = safeCols * safeRows;
  const gridStyle = {
    "--iw-cols": safeCols,
    "--iw-rows": safeRows
  } as CSSProperties;
  const [displayCursor, setDisplayCursor] = useState(0);
  const [animationPhase, setAnimationPhase] = useState<"idle" | "out" | "in">("idle");
  const [rotationPaused, setRotationPaused] = useState(false);
  const cursorRef = useRef(0);
  const visibleSymbolsRef = useRef<string[]>([]);
  const animatingRef = useRef(false);
  const outTimerRef = useRef<number | null>(null);
  const inTimerRef = useRef<number | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const step = visibleCount;
  const canRotate = items.length > visibleCount;

  const visibleItems = useMemo(
    () => selectVisibleItems(items, displayCursor, visibleCount),
    [displayCursor, items, visibleCount]
  );
  const emptySlots = Math.max(0, visibleCount - items.length);
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
      if (prefersReducedMotion || suspended) {
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
    [clearAnimationTimers, items.length, prefersReducedMotion, suspended, swapCursor]
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
    if (!suspended) {
      return;
    }
    clearAnimationTimers();
    animatingRef.current = false;
    setAnimationPhase("idle");
  }, [clearAnimationTimers, suspended]);

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
  }, [clearAnimationTimers, itemSignature, items, items.length, safeCols, safeRows, swapCursor]);

  useEffect(() => {
    visibleSymbolsRef.current = visibleItems.map((item) => item.symbol);
  }, [visibleItems]);

  useEffect(() => {
    if (!canRotate || rotationPaused || suspended) {
      return undefined;
    }
    const intervalId = window.setInterval(advance, ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [advance, canRotate, rotationPaused, suspended]);

  return (
    <section
      className="index-widget-panel"
      aria-label={`시장 지수 ${safeCols}x${safeRows} 위젯`}
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
            <div className="index-widget-grid" style={gridStyle}>
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
});

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

function selectVisibleItems(items: MarketIndexItem[], cursor: number, count: number): MarketIndexItem[] {
  if (items.length === 0) {
    return [];
  }
  const visibleCount = Math.min(count, items.length);
  return Array.from({ length: visibleCount }, (_, index) => items[normalizeCursor(cursor + index, items.length)]!);
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
