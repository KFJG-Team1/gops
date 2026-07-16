import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentReference } from "../agent/agentReferences";

const CARD_INTERVAL_MS = 8_000;
const FLIP_DURATION_MS = 680;
const NEWS_THUMBNAIL_SRC = "/assets/news/USAIRAN.png";

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
      <img className="news-card-thumbnail" src={NEWS_THUMBNAIL_SRC} alt="" aria-hidden="true" />
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
