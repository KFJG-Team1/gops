import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AgentReference } from "../agent/agentReferences";
import { fetchCandles } from "../chart/cdcClient";

const CARD_INTERVAL_MS = 8_000;
const FLIP_DURATION_MS = 680;
const chartCache = new Map<string, number[]>();

export type NewsFlipCardItem = {
  key: string;
  symbol: string;
  title: string;
  url?: string | null;
  reference: AgentReference;
  selected?: boolean;
  emphasized?: boolean;
};

type NewsFlipCardProps = {
  items: NewsFlipCardItem[];
  ariaLabel: string;
  onSelect: (reference: AgentReference) => void;
};

export function NewsFlipCard({ items, ariaLabel, onSelect }: NewsFlipCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const flipTimeoutRef = useRef<number | undefined>(undefined);
  const itemSequenceKey = useMemo(() => items.map((item) => item.key).join("|"), [items]);

  const showItem = useCallback((nextIndex: number) => {
    if (items.length < 2) {
      return;
    }
    setActiveIndex((currentIndex) => {
      const normalizedIndex = ((nextIndex % items.length) + items.length) % items.length;
      if (normalizedIndex === currentIndex) {
        return currentIndex;
      }
      setPreviousIndex(currentIndex);
      window.clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = window.setTimeout(() => setPreviousIndex(null), FLIP_DURATION_MS);
      return normalizedIndex;
    });
  }, [items.length]);

  const showNext = useCallback(() => {
    setActiveIndex((currentIndex) => {
      if (items.length < 2) {
        return currentIndex;
      }
      setPreviousIndex(currentIndex);
      window.clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = window.setTimeout(() => setPreviousIndex(null), FLIP_DURATION_MS);
      return (currentIndex + 1) % items.length;
    });
  }, [items.length]);

  useEffect(() => {
    setActiveIndex(0);
    setPreviousIndex(null);
  }, [itemSequenceKey]);

  useEffect(() => {
    if (paused || items.length < 2) {
      return undefined;
    }
    const intervalId = window.setInterval(showNext, CARD_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [items.length, paused, showNext]);

  useEffect(() => () => window.clearTimeout(flipTimeoutRef.current), []);

  const activeItem = items[activeIndex];
  const previousItem = previousIndex === null ? null : items[previousIndex];
  if (!activeItem) {
    return null;
  }

  return (
    <div
      className={`news-card-widget ${paused ? "is-paused" : ""}`}
      aria-label={ariaLabel}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setPaused(false);
        }
      }}
    >
      <div className="news-card-stage">
        {previousItem && (
          <NewsCardFace
            key={`previous-${previousItem.key}`}
            item={previousItem}
            className="is-exiting"
            onSelect={onSelect}
          />
        )}
        <NewsCardFace
          key={`active-${activeItem.key}`}
          item={activeItem}
          className={previousItem ? "is-entering" : ""}
          onSelect={onSelect}
        />
      </div>
      {items.length > 1 && (
        <div className="news-card-pagination" role="group" aria-label="뉴스 카드 선택">
          {items.map((item, index) => (
            <button
              key={`${item.key}-${paused ? "paused" : "playing"}`}
              type="button"
              className={index === activeIndex ? "active" : ""}
              aria-label={`${index + 1}번째 뉴스 보기`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => showItem(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NewsCardFace({ item, className, onSelect }: { item: NewsFlipCardItem; className: string; onSelect: (reference: AgentReference) => void }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onSelect(item.reference);
  };

  return (
    <article
      className={`news-card-face ${className} ${item.selected ? "is-agent-reference-selected" : ""} ${item.emphasized ? "is-agent-reference-emphasized" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={item.selected}
      onClick={() => onSelect(item.reference)}
      onKeyDown={handleKeyDown}
    >
      <NewsCardLineChart symbol={item.symbol} />
      <div className="news-card-shade" aria-hidden="true" />
      {item.url ? (
        <a
          className="news-card-title"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {item.title}
        </a>
      ) : (
        <h3 className="news-card-title">{item.title}</h3>
      )}
    </article>
  );
}

function NewsCardLineChart({ symbol }: { symbol: string }) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const gradientId = `news-card-fill-${useId().replace(/:/g, "")}`;
  const [values, setValues] = useState<number[]>(() => chartCache.get(normalizedSymbol) ?? []);

  useEffect(() => {
    const cachedValues = chartCache.get(normalizedSymbol);
    if (cachedValues) {
      setValues(cachedValues);
      return undefined;
    }
    setValues([]);
    const controller = new AbortController();
    void fetchCandles({ symbol: normalizedSymbol, interval: "1D", limit: 40 }, controller.signal)
      .then((response) => {
        const nextValues = response.candles
          .map((candle) => candle.close)
          .filter((value) => Number.isFinite(value));
        if (nextValues.length >= 2) {
          chartCache.set(normalizedSymbol, nextValues);
        }
        setValues(nextValues);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol]);

  if (values.length < 2) {
    return <div className="news-card-chart is-empty" aria-hidden="true" />;
  }

  const { line, area } = chartPaths(values);
  const trendClass = values[values.length - 1] >= values[0] ? "is-up" : "is-down";
  return (
    <svg className={`news-card-chart ${trendClass}`} viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="news-card-chart-area" d={area} fill={`url(#${gradientId})`} />
      <path className="news-card-chart-line" d={line} />
    </svg>
  );
}

function chartPaths(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 1000;
    const y = 350 - ((value - minimum) / range) * 300;
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L1000,400 L0,400 Z`;
  return { line, area };
}
