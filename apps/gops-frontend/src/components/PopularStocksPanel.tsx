import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { fetchMarketIndices } from "../market/indicesApi";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

const popularStockLimit = 10;
const krwPerWonUnit = 100_000_000;
const krwPerTrillionWonUnit = 1_000_000_000_000;
const industryLabelsKo: Record<string, string> = {
  "Application Software": "응용 소프트웨어",
  "Broadline Retail": "종합 소매",
  "Communications Equipment": "통신 장비",
  "Consumer Electronics": "소비자 전자제품",
  "Data Processing & Outsourced Services": "데이터 처리/아웃소싱",
  "Electronic Components": "전자 부품",
  "Electronic Equipment & Instruments": "전자 장비/계측기",
  "Electronic Manufacturing Services": "전자 제조 서비스",
  "Interactive Media & Services": "인터랙티브 미디어/서비스",
  "Internet Services & Infrastructure": "인터넷 서비스/인프라",
  "IT Consulting & Other Services": "IT 컨설팅/서비스",
  "Semiconductor Materials & Equipment": "반도체 장비/소재",
  "Semiconductors": "반도체",
  "Systems Software": "시스템 소프트웨어",
  "Technology Distributors": "기술 유통",
  "Technology Hardware, Storage & Peripherals": "하드웨어/저장장치"
};
const sectorLabelsKo: Record<string, string> = {
  "Basic Materials": "소재/원자재",
  "Communication Services": "커뮤니케이션 서비스",
  "Consumer Cyclical": "경기소비재",
  "Consumer Defensive": "필수소비재",
  "Energy": "에너지",
  "Financial Services": "금융",
  "Healthcare": "헬스케어",
  "Industrials": "산업재",
  "Real Estate": "부동산",
  "Technology": "기술",
  "Utilities": "유틸리티"
};

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

  return (
    <section className="popular-stocks-panel" aria-label="인기종목 패널">
      <header className="panel-inline-header">
        <div>
          <strong>거래대금순 Top10</strong>
          <span>S&amp;P500</span>
        </div>
      </header>
      {popularItems.length === 0 ? (
        <div className="panel-empty-row">표시할 인기종목 데이터가 없습니다</div>
      ) : (
        <div className="popular-stocks-table-wrap">
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
                <th scope="col">산업</th>
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
                  <td className="popular-stock-industry">{formatIndustryLabel(item.industry, item.sector)}</td>
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

function formatIndustryLabel(industry: string | null | undefined, sector: string | null | undefined): string {
  if (industry) {
    return industryLabelsKo[industry] ?? sectorLabelsKo[sector ?? ""] ?? industry;
  }
  if (sector) {
    return sectorLabelsKo[sector] ?? sector;
  }
  return "-";
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
