import type { Sp500UniverseItem } from "../market/sp500Universe.seed";

type CompanySummaryPanelProps = {
  symbol: string;
  item?: Sp500UniverseItem;
  items?: Sp500UniverseItem[];
};

type MetricRow = {
  label: string;
  detail: string;
  value: string;
};

export function CompanySummaryPanel({ symbol, item, items = [] }: CompanySummaryPanelProps) {
  const normalizedSymbol = symbol.toUpperCase();
  const companyName = item?.companyName || normalizedSymbol;
  const price = item?.lastPrice ?? item?.layoutPrice ?? null;
  const marketCap = item?.marketCap ?? item?.layoutMarketCap ?? null;
  const changePercent = item?.changePercent ?? null;
  const changeTone = changePercent == null ? "neutral" : changePercent > 0 ? "up" : changePercent < 0 ? "down" : "neutral";
  const dataAsOf = item?.fundamentalsAsOf ?? item?.periodEndDate ?? item?.filedAt ?? item?.priceUpdatedAt ?? item?.layoutPriceUpdatedAt ?? null;
  const comparison = buildComparison(normalizedSymbol, item, items);

  const infoRows = [
    ["현재가", formatUsd(price)],
    ["등락률", formatPercent(changePercent), changeTone],
    ["시가총액", formatUsdCompact(marketCap)],
    ["발행주식수", formatShares(item?.sharesOutstanding ?? null)],
    ["거래소", formatExchange(item?.exchange)],
    ["상장일", formatDate(item?.listingDate)],
    ["섹터", item?.sector || "확인 중"],
    ["산업", item?.industry || "확인 중"],
    ["CIK", item?.cik || "확인 중"],
    ["시장", formatMarket(item?.market, item?.country)],
    ["기업정보 원천", formatCompanySource(item)],
    ["데이터 기준", formatDate(dataAsOf)]
  ] as const;
  const valuationRows: MetricRow[] = [
    ["PER", "현재가 / EPS", formatMultiple(safeDivide(price, item?.eps))],
    ["PBR", "시가총액 / 총자본", formatMultiple(safeDivide(marketCap, item?.totalEquity))],
    ["PSR", "시가총액 / 매출", formatMultiple(safeDivide(marketCap, item?.revenue))],
    ["FCF Yield", "잉여현금흐름 / 시가총액", formatRatioPercent(safeDivide(item?.freeCashFlow, marketCap))]
  ].map(([label, detail, value]) => ({ label, detail, value }));
  const qualityRows: MetricRow[] = [
    ["ROE", "순이익 / 총자본", formatRatioPercent(safeDivide(item?.netIncome, item?.totalEquity))],
    ["영업이익률", "영업이익 / 매출", formatRatioPercent(safeDivide(item?.operatingIncome, item?.revenue))],
    ["순이익률", "순이익 / 매출", formatRatioPercent(safeDivide(item?.netIncome, item?.revenue))],
    ["부채비율", "총부채 / 총자본", formatRatioPercent(safeDivide(item?.totalLiabilities, item?.totalEquity))],
    ["EV/EBITDA", "순차입금 데이터 필요", "확인 중"]
  ].map(([label, detail, value]) => ({ label, detail, value }));

  return (
    <section className="company-summary-panel" aria-label={`${normalizedSymbol} 기업정보`}>
      <section className="company-info-section" aria-label={`${normalizedSymbol} 기본 기업정보`}>
        <header className="company-info-heading">
          <span>기업정보</span>
          <strong>{companyName}</strong>
          <em className={`company-summary-change ${changeTone}`}>{formatPercent(changePercent)}</em>
        </header>
        <dl className="company-info-grid">
          {infoRows.map(([label, value, tone]) => (
            <div key={label} className="company-info-cell">
              <dt>{label}</dt>
              <dd className={tone ? `company-summary-value ${tone}` : "company-summary-value"}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="company-fundamental-section" aria-label={`${normalizedSymbol} 투자지표와 비교`}>
        <h2>투자지표</h2>
        <div className="company-fundamental-grid">
          <MetricColumn title="가치평가" rows={valuationRows} />
          <MetricColumn title="수익성 / 재무" rows={qualityRows} />
          <section className="company-earnings-panel" aria-label={`${normalizedSymbol} 비교 영역`}>
            <div className="company-earnings-heading">
              <h3>비교 영역</h3>
              <div className="company-earnings-tabs" aria-hidden="true">
                <button type="button" className="active" tabIndex={-1}>동종업계</button>
              </div>
            </div>
            <dl className="company-earnings-summary">
              <div>
                <dt>동종업계 평균</dt>
                <dd>{formatPercent(comparison.averageChangePercent)}</dd>
              </div>
              <div>
                <dt>산업 내 순위</dt>
                <dd>{comparison.rankLabel}</dd>
              </div>
              <div>
                <dt>비교 기준</dt>
                <dd>{comparison.scopeLabel}</dd>
              </div>
            </dl>
            <div className="company-earnings-chart">
              <div className="company-earnings-grid" />
              {comparison.peers.length ? (
                <div className="company-peer-list">
                  {comparison.peers.map((peer) => (
                    <div key={peer.symbol} className="company-peer-row">
                      <strong>{peer.symbol}</strong>
                      <span>{peer.companyName}</span>
                      <em>{formatUsdCompact(peer.layoutMarketCap ?? peer.marketCap)}</em>
                    </div>
                  ))}
                </div>
              ) : (
                <p>동종업계 비교 데이터 확인 중</p>
              )}
            </div>
          </section>
        </div>
      </section>

      <p className="company-summary-note">
        {hasFundamentalShares(item)
          ? "시가총액은 현재가와 발행주식수로 계산합니다."
          : "재무 데이터가 없으면 기준 유니버스 값을 임시로 표시합니다."}
      </p>
    </section>
  );
}

function MetricColumn({ title, rows }: { title: string; rows: MetricRow[] }) {
  return (
    <section className="company-metric-column" aria-label={title}>
      <h3>{title}</h3>
      <dl>
        {rows.map((row) => (
          <div key={row.label} className="company-metric-row">
            <dt>
              <strong>{row.label}</strong>
              <span>{row.detail}</span>
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatUsd(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: value && value >= 100 ? 2 : 2,
    maximumFractionDigits: 2
  }).format(value as number)}달러`;
}

function formatUsdCompact(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${formatKoreanCompact(value as number)} 달러`;
}

function formatShares(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${formatKoreanCompact(value as number)} 주`;
}

function formatKoreanCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${formatFixed(value / 1_000_000_000_000)}조`;
  }
  if (abs >= 100_000_000) {
    return `${formatFixed(value / 100_000_000)}억`;
  }
  if (abs >= 10_000) {
    return `${formatFixed(value / 10_000)}만`;
  }
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value);
}

function formatFixed(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  const sign = (value as number) > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value as number)}%`;
}

function formatMultiple(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value as number)}배`;
}

function formatRatioPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format((value as number) * 100)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "확인 중";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(parsed);
}

function formatExchange(value: string | null | undefined): string {
  if (!value) {
    return "확인 중";
  }
  const normalized = value.trim().toUpperCase();
  const labels: Record<string, string> = {
    NASDAQ: "나스닥",
    NYSE: "뉴욕증권거래소",
    AMEX: "NYSE 아메리칸",
    ARCA: "NYSE 아카",
    BATS: "Cboe BZX"
  };
  return labels[normalized] ?? value;
}

function formatMarket(market: string | null | undefined, country: string | null | undefined): string {
  const value = market || country;
  if (!value) {
    return "미국";
  }
  const normalized = value.trim().toUpperCase();
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "미국"].includes(normalized)) {
    return "미국";
  }
  return value;
}

function formatCompanySource(item: Sp500UniverseItem | undefined): string {
  const source = item?.fundamentalsSource?.toLowerCase() ?? "";
  if (source.includes("sec")) {
    return "SEC 공시";
  }
  if (hasFundamentalShares(item)) {
    return "재무 데이터";
  }
  if (item?.marketCapSource === "seed" || item?.layoutMarketCapSource === "seed") {
    return "기준 유니버스";
  }
  return "확인 중";
}

function hasFundamentalShares(item: Sp500UniverseItem | undefined): boolean {
  return item?.marketCapSource === "fundamentals" || Number.isFinite(item?.sharesOutstanding ?? NaN);
}

function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!Number.isFinite(numerator ?? NaN) || !Number.isFinite(denominator ?? NaN) || denominator === 0) {
    return null;
  }
  return (numerator as number) / (denominator as number);
}

function buildComparison(symbol: string, item: Sp500UniverseItem | undefined, items: Sp500UniverseItem[]) {
  const sameIndustry = item
    ? items.filter((candidate) => (
      candidate.symbol.toUpperCase() !== symbol &&
      candidate.industry === item.industry &&
      candidate.sector === item.sector
    ))
    : [];
  const sameSector = item
    ? items.filter((candidate) => (
      candidate.symbol.toUpperCase() !== symbol &&
      candidate.sector === item.sector
    ))
    : [];
  const peers = [...sameIndustry]
    .sort((a, b) => comparableMarketCap(b) - comparableMarketCap(a))
    .slice(0, 4);
  const rankGroup = item ? [item, ...sameIndustry].filter((candidate) => comparableMarketCap(candidate) > 0) : [];
  const ranked = [...rankGroup].sort((a, b) => comparableMarketCap(b) - comparableMarketCap(a));
  const rank = ranked.findIndex((candidate) => candidate.symbol.toUpperCase() === symbol);
  const averageChangePercent = average(sameIndustry.map((candidate) => candidate.changePercent));
  return {
    peers: peers.length ? peers : sameSector.sort((a, b) => comparableMarketCap(b) - comparableMarketCap(a)).slice(0, 4),
    averageChangePercent,
    rankLabel: rank >= 0 ? `${rank + 1}/${ranked.length}` : "확인 중",
    scopeLabel: sameIndustry.length ? item?.industry ?? "산업" : item?.sector ?? "섹터"
  };
}

function comparableMarketCap(item: Sp500UniverseItem): number {
  const value = item.layoutMarketCap ?? item.marketCap;
  return Number.isFinite(value) ? value : 0;
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => Number.isFinite(value ?? NaN));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
