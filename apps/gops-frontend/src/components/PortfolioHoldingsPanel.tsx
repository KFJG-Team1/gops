import { LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parsePortfolioHoldingsApiResponse, type PortfolioHoldingsResponse, type PortfolioPosition } from "./portfolioHoldingsApi";

type SortMode = "custom" | "value" | "return";
type ValueMode = "marketValue" | "currentPrice";
type CurrencyMode = "krw" | "foreign";

const REFRESH_INTERVAL_MS = 60_000;

export function PortfolioHoldingsPanel({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => boolean }) {
  const [payload, setPayload] = useState<PortfolioHoldingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sortMode, setSortMode] = useState<SortMode>("value");
  const [valueMode, setValueMode] = useState<ValueMode>("marketValue");
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>("krw");

  const loadHoldings = useCallback(async (signal?: AbortSignal, showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const response = await fetch("/api/account/holdings?market=overseas&currency=USD", { signal });
      const nextPayload = await parsePortfolioHoldingsApiResponse(response);
      setPayload(nextPayload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "보유종목을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadHoldings(controller.signal);
    const intervalId = window.setInterval(() => {
      void loadHoldings(undefined, true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [loadHoldings]);

  const positions = useMemo(() => sortPositions(payload?.positions ?? [], sortMode, currencyMode), [payload?.positions, sortMode, currencyMode]);
  const account = payload?.account;
  const totalValue = currencyMode === "krw" ? account?.totalValueKrw : account?.totalValueForeign;
  const totalCurrency = currencyMode === "krw" ? "KRW" : account?.currency ?? "USD";
  const pnlValue = currencyMode === "krw" ? account?.unrealizedPnlKrw : account?.unrealizedPnlForeign;
  const pnlDirection = directionClass(pnlValue ?? account?.unrealizedPnlRate);

  return (
    <section className="portfolio-holdings-panel" aria-label="내 투자 패널">
      <div className="portfolio-cash-grid">
        <div className="portfolio-cash-card">
          <span>원화</span>
          <strong>{formatMoney(account?.cashKrw, "KRW")}</strong>
        </div>
        <div className="portfolio-cash-card">
          <span>달러</span>
          <strong>{formatMoney(account?.cashForeign, "USD")}</strong>
        </div>
      </div>

      <div className="portfolio-summary">
        <span>내 투자</span>
        <strong>{formatMoney(totalValue, totalCurrency)}</strong>
        <em className={pnlDirection}>
          {formatSignedMoney(pnlValue, totalCurrency)} {formatSignedPercent(account?.unrealizedPnlRate)}
        </em>
      </div>

      <div className="portfolio-toolbar">
        <select value={sortMode} aria-label="보유종목 정렬" onChange={(event) => setSortMode(toSortMode(event.target.value))}>
          <option value="value">평가금 순</option>
          <option value="return">수익률 순</option>
          <option value="custom">직접 설정한 순</option>
        </select>
        <div className="portfolio-segmented" aria-label="표시 값">
          <button className={valueMode === "currentPrice" ? "active" : ""} type="button" onClick={() => setValueMode("currentPrice")}>
            현재가
          </button>
          <button className={valueMode === "marketValue" ? "active" : ""} type="button" onClick={() => setValueMode("marketValue")}>
            평가금
          </button>
        </div>
        <div className="portfolio-segmented portfolio-currency-toggle" aria-label="통화">
          <button className={currencyMode === "foreign" ? "active" : ""} type="button" onClick={() => setCurrencyMode("foreign")}>
            $
          </button>
          <button className={currencyMode === "krw" ? "active" : ""} type="button" onClick={() => setCurrencyMode("krw")}>
            원
          </button>
        </div>
        <button className="portfolio-refresh-button" type="button" title="보유종목 새로고침" onClick={() => void loadHoldings(undefined, true)}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
        </button>
      </div>

      <div className="portfolio-section-row">
        <span>{account?.market === "domestic" ? "국내주식" : "해외주식"}</span>
        <em>{payload?.asOf ? formatAsOf(payload.asOf) : ""}</em>
      </div>

      {loading && (
        <div className="portfolio-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>보유종목을 불러오는 중입니다</span>
        </div>
      )}

      {error && !loading && <div className="portfolio-error">{error}</div>}

      {!loading && !error && positions.length === 0 && (
        <div className="portfolio-empty">모의투자 계좌에 표시할 보유종목이 없습니다</div>
      )}

      {!loading && !error && positions.length > 0 && (
        <div className="portfolio-position-list">
          {positions.map((position) => (
            <button key={position.symbol} className="portfolio-position-row" type="button" onClick={() => onSelectSymbol(position.symbol)}>
              <span className="portfolio-position-badge">{positionBadge(position)}</span>
              <span className="portfolio-position-name">
                <strong>{position.name || position.symbol}</strong>
                <em>{formatQuantity(position.quantity)}주</em>
              </span>
              <span className="portfolio-position-value">
                <strong>{formatPositionValue(position, valueMode, currencyMode)}</strong>
                <em className={directionClass(position.unrealizedPnlRate)}>
                  {formatSignedMoney(currencyMode === "krw" ? position.unrealizedPnlKrw : position.unrealizedPnlForeign, currencyMode === "krw" ? "KRW" : position.currency ?? "USD")} {formatSignedPercent(position.unrealizedPnlRate)}
                </em>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function sortPositions(positions: PortfolioPosition[], sortMode: SortMode, currencyMode: CurrencyMode) {
  const valueKey = currencyMode === "krw" ? "marketValueKrw" : "marketValueForeign";
  return [...positions].sort((left, right) => {
    if (sortMode === "return") {
      return (right.unrealizedPnlRate ?? -Infinity) - (left.unrealizedPnlRate ?? -Infinity);
    }
    if (sortMode === "custom") {
      return left.symbol.localeCompare(right.symbol);
    }
    return ((right[valueKey] as number | null | undefined) ?? -Infinity) - ((left[valueKey] as number | null | undefined) ?? -Infinity);
  });
}

function toSortMode(value: string): SortMode {
  if (value === "return" || value === "custom") {
    return value;
  }
  return "value";
}

function formatMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2
  }).format(value);
}

function formatSignedMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatMoney(value, currency)}`;
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  const prefix = value > 0 ? "+" : "";
  return `(${prefix}${value.toFixed(1)}%)`;
}

function formatQuantity(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(value);
}

function formatPositionValue(position: PortfolioPosition, valueMode: ValueMode, currencyMode: CurrencyMode) {
  const currency = currencyMode === "krw" ? "KRW" : position.currency ?? "USD";
  if (valueMode === "currentPrice") {
    return formatMoney(position.currentPrice, currency);
  }
  return formatMoney(currencyMode === "krw" ? position.marketValueKrw : position.marketValueForeign, currency);
}

function directionClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function formatAsOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function positionBadge(position: PortfolioPosition) {
  const words = (position.name || position.symbol).split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return position.symbol.slice(0, 3).toUpperCase();
}
