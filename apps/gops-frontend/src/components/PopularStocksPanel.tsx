import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { fetchMarketIndices } from "../market/indicesApi";
import { sectorLabelKo } from "../market/sectors";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { useVerticalOverflow } from "../hooks/useVerticalOverflow";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

const popularStockLimit = 10;
const krwPerWonUnit = 100_000_000;
const krwPerTrillionWonUnit = 1_000_000_000_000;

type PopularStocksPanelProps = {
  items: readonly Sp500UniverseItem[];
  onSelectSymbol: (symbol: string) => void;
};

export function PopularStocksPanel({ items, onSelectSymbol }: PopularStocksPanelProps) {
  const [krwRate, setKrwRate] = useState<number | null>(null);

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

  const selectSymbol = (symbol: string) => {
    onSelectSymbol(symbol);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, symbol: string) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    selectSymbol(symbol);
  };

  const tableWrapRef = useRef<HTMLDivElement>(null);
  const scrolls = useVerticalOverflow(tableWrapRef);

  return (
    <section className={`popular-stocks-panel ${scrolls ? "has-scroll-rule" : ""}`} aria-label="인기종목 패널">
      {popularItems.length === 0 ? (
        <div className="panel-empty-row">표시할 인기종목 데이터가 없습니다</div>
      ) : (
        <div className="popular-stocks-table-wrap" ref={tableWrapRef}>
          <table className="popular-stocks-table">
            <colgroup>
              <col className="popular-stock-company-col" />
              <col className="popular-stock-money-col" />
              <col className="popular-stock-money-col" />
              <col className="popular-stock-industry-col" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">회사명</th>
                <th scope="col">거래대금</th>
                <th scope="col">시가총액</th>
                <th scope="col">섹터</th>
              </tr>
            </thead>
            <tbody>
              {popularItems.map((item) => (
                <tr
                  key={item.symbol}
                  className="popular-stock-row"
                  tabIndex={0}
                  role="button"
                  aria-label={`${item.symbol} ${item.companyName} 열기`}
                  onClick={() => selectSymbol(item.symbol)}
                  onKeyDown={(event) => handleRowKeyDown(event, item.symbol)}
                >
                  <td className="popular-stock-company">
                    <StockLogo symbol={item.symbol} companyName={item.companyName} size="xs" />
                    <span className="popular-stock-company-text">
                      <strong>{item.symbol}</strong>
                      <span>{item.companyName}</span>
                    </span>
                  </td>
                  <td className="popular-stock-money">{formatKrwAmount(item.sessionDollarVolume, krwRate)}</td>
                  <td className="popular-stock-money">{formatKrwAmount(item.marketCap, krwRate)}</td>
                  <td className="popular-stock-industry">{formatSectorLabel(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
