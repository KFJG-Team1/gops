import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMarketIndices } from "../market/indicesApi";
import { sectorLabelKo } from "../market/sectors";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

const popularStockLimit = 10;
const rankingSpotlightIntervalMs = 3_600;
const krwPerWonUnit = 100_000_000;
const krwPerTrillionWonUnit = 1_000_000_000_000;

type PopularStocksPanelProps = {
  items: readonly Sp500UniverseItem[];
  onSelectSymbol: (symbol: string) => void;
};

export function PopularStocksPanel({ items, onSelectSymbol }: PopularStocksPanelProps) {
  const [krwRate, setKrwRate] = useState<number | null>(null);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [interactionSymbol, setInteractionSymbol] = useState<string | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMarketIndices(controller.signal)
      .then((payload) => {
        const rate = payload.items.find((item) => item.symbol === "KRW=X")?.price;
        setKrwRate(typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setKrwRate(null);
      });
    return () => controller.abort();
  }, []);

  const popularItems = useMemo(() => rankPopularItems(items), [items]);

  useEffect(() => {
    setSpotlightIndex((current) => (popularItems.length > 0 ? current % popularItems.length : 0));
    if (popularItems.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setSpotlightIndex((current) => (current + 1) % popularItems.length);
    }, rankingSpotlightIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [popularItems.length]);

  useEffect(() => {
    if (interactionSymbol && !popularItems.some((item) => item.symbol === interactionSymbol)) {
      setInteractionSymbol(null);
    }
  }, [interactionSymbol, popularItems]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }
    const updateMode = () => {
      setIsCompact(panel.clientHeight <= 360);
    };
    updateMode();
    const observer = new ResizeObserver(updateMode);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const spotlightSymbol = interactionSymbol ?? popularItems[spotlightIndex]?.symbol ?? null;
  const spotlightItemIndex = Math.max(
    0,
    popularItems.findIndex((item) => item.symbol === spotlightSymbol)
  );

  const selectSymbol = (symbol: string) => {
    onSelectSymbol(symbol);
  };

  return (
    <section
      className={`popular-stocks-panel has-ranking-focus ${isCompact ? "is-compact" : ""}`}
      ref={panelRef}
      aria-label="인기종목 패널"
    >
      {popularItems.length === 0 ? (
        <div className="panel-empty-row">표시할 인기종목 데이터가 없습니다</div>
      ) : (
        <div
          className="popular-stocks-ranking-list"
          role="group"
          aria-label="거래대금 상위 10개 기업"
          style={{ gridTemplateRows: `repeat(${popularItems.length}, minmax(0, 1fr))` }}
        >
          {popularItems.map((item, index) => {
            const rank = index + 1;
            const isFocused = item.symbol === spotlightSymbol;
            const previousIndex = (spotlightItemIndex - 1 + popularItems.length) % popularItems.length;
            const nextIndex = (spotlightItemIndex + 1) % popularItems.length;
            let positionClass = index < spotlightItemIndex ? "is-before" : "is-after";
            if (isFocused) {
              positionClass = "is-focused";
            } else if (index === previousIndex) {
              positionClass = "is-previous";
            } else if (index === nextIndex) {
              positionClass = "is-next";
            }
            return (
              <button
                key={item.symbol}
                className={`popular-stock-row ${isFocused ? "is-focused" : "is-muted"} ${positionClass}`}
                type="button"
                aria-label={`${rank}위 ${item.symbol} ${item.companyName} 열기`}
                onClick={() => selectSymbol(item.symbol)}
                onPointerEnter={() => setInteractionSymbol(item.symbol)}
                onPointerLeave={(event) => {
                  if (!event.currentTarget.matches(":focus")) {
                    setInteractionSymbol(null);
                  }
                }}
                onFocus={() => setInteractionSymbol(item.symbol)}
                onBlur={() => setInteractionSymbol(null)}
              >
                <span className="popular-stock-rank">{String(rank).padStart(2, "0")}</span>
                <span className="popular-stock-company">
                  <StockLogo symbol={item.symbol} companyName={item.companyName} size="xs" />
                  <span className="popular-stock-company-text">
                    <strong>{item.symbol}</strong>
                    <span>{item.companyName}</span>
                  </span>
                </span>
                <span className="popular-stock-money popular-stock-volume" data-label="거래대금">
                  {formatKrwAmount(item.sessionDollarVolume, krwRate)}
                </span>
                <span className="popular-stock-money popular-stock-market-cap" data-label="시가총액">
                  {formatKrwAmount(item.marketCap, krwRate)}
                </span>
                <span className="popular-stock-industry">{formatSectorLabel(item)}</span>
              </button>
            );
          })}
        </div>
      )}
      <LogoDevAttribution className="panel-logo-attribution" />
    </section>
  );
}

function rankPopularItems(items: readonly Sp500UniverseItem[]): Sp500UniverseItem[] {
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
      const leftValue = rankingValue(left.item);
      const rightValue = rankingValue(right.item);
      if (leftValue !== rightValue) {
        return rightValue - leftValue;
      }
      return left.sourceIndex - right.sourceIndex;
    })
    .slice(0, popularStockLimit)
    .map(({ item }) => item);
}

function rankingValue(item: Sp500UniverseItem): number {
  const value = readFiniteNumber(item.sessionDollarVolume);
  return value == null ? Number.NEGATIVE_INFINITY : value;
}

function formatKrwAmount(usdValue: number | null | undefined, krwRate: number | null): string {
  const usd = readFiniteNumber(usdValue);
  if (usd == null || krwRate == null) {
    return "-";
  }
  const krw = usd * krwRate;
  if (!Number.isFinite(krw) || krw <= 0) {
    return "-";
  }
  if (krw >= krwPerTrillionWonUnit) {
    return `${formatNumber(krw / krwPerTrillionWonUnit, 0, 1)}조원`;
  }
  if (krw >= krwPerWonUnit) {
    return `${formatNumber(Math.round(krw / krwPerWonUnit), 0, 0)}억원`;
  }
  return "1억원 미만";
}

function formatSectorLabel(item: Sp500UniverseItem): string {
  return item.sectorLabelKo || sectorLabelKo(item.sector);
}

function formatNumber(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
}

function readFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
