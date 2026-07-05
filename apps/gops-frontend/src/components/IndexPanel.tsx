import { LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMarketIndices, type MarketIndexItem, type MarketIndicesPayload } from "../market/indicesApi";

const FALLBACK_REFRESH_MS = 30_000;

export function IndexPanel() {
  const [payload, setPayload] = useState<MarketIndicesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadIndices = useCallback(async (signal?: AbortSignal, showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const nextPayload = await fetchMarketIndices(signal);
      setPayload(nextPayload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "지수 데이터를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadIndices(controller.signal);
    return () => controller.abort();
  }, [loadIndices]);

  const refreshMs = Math.max(10_000, (payload?.refreshSeconds ?? FALLBACK_REFRESH_MS / 1000) * 1000);
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const controller = new AbortController();
      void loadIndices(controller.signal, true);
    }, refreshMs);
    return () => window.clearInterval(intervalId);
  }, [loadIndices, refreshMs]);

  const groups = useMemo(() => groupIndexItems(payload?.items ?? []), [payload?.items]);
  const cacheLabel = payload?.cacheStatus === "stale" ? "stale" : payload?.cacheStatus === "fresh" ? "live" : "";

  return (
    <section className="market-indices-panel" aria-label="시장 지수 패널">
      <header className="panel-inline-header">
        <div>
          <strong>시장 지수</strong>
          <span className="market-indices-header-meta">
            {cacheLabel && <span className={`market-indices-cache is-${payload?.cacheStatus}`}>{cacheLabel}</span>}
            {payload?.updatedAt && <span>{formatTime(payload.updatedAt)}</span>}
          </span>
        </div>
        <button className="panel-icon-button" type="button" title="지수 새로고침" onClick={() => void loadIndices(undefined, true)}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
        </button>
      </header>
      {loading && (
        <div className="panel-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>지수를 불러오는 중입니다</span>
        </div>
      )}
      {error && !loading && <div className="panel-error-row">{error}</div>}
      {payload?.warning && !loading && !error && <div className="panel-state-row">{payload.warning}</div>}
      {!loading && !error && groups.length === 0 && <div className="panel-empty-row">표시할 지수 데이터가 없습니다</div>}
      {!loading && !error && groups.length > 0 && (
        <div className="market-indices-groups">
          {groups.map((group) => (
            <section key={group.name} className="market-index-group" aria-label={`${group.name} 지수`}>
              <div className="market-index-group-title">{group.name}</div>
              <div className="market-index-list">
                {group.items.map((item) => (
                  <IndexRow key={item.symbol} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function IndexRow({ item }: { item: MarketIndexItem }) {
  const direction = item.change == null ? "neutral" : item.change > 0 ? "positive" : item.change < 0 ? "negative" : "neutral";
  return (
    <article className="market-index-row">
      <div className="market-index-main">
        <div className="market-index-name-line">
          <strong className="market-index-name">{item.name}</strong>
          <span className="market-index-symbol">{item.symbol}</span>
        </div>
        <div className="market-index-subline">
          <span>{item.unit || item.currency || item.assetClass}</span>
          {item.updatedAt && <span>{formatTime(item.updatedAt)}</span>}
        </div>
      </div>
      <MiniSparkline values={item.sparkline} direction={direction} />
      <div className="market-index-quote">
        <strong>{formatPrice(item)}</strong>
        <span className={`market-index-change is-${direction}`}>
          {formatSigned(item.change)}
          {item.changePercent != null && <span>{formatPercent(item.changePercent)}</span>}
        </span>
      </div>
    </article>
  );
}

function MiniSparkline({ values, direction }: { values: number[]; direction: "positive" | "negative" | "neutral" }) {
  const points = sparklinePoints(values);
  return (
    <svg className={`market-index-sparkline is-${direction}`} viewBox="0 0 88 28" aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function groupIndexItems(items: MarketIndexItem[]) {
  const order = ["US", "Korea", "Asia", "Commodities", "Crypto", "FX"];
  const groups = new Map<string, MarketIndexItem[]>();
  items.forEach((item) => {
    const key = item.group || "Market";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => (order.indexOf(left) === -1 ? 99 : order.indexOf(left)) - (order.indexOf(right) === -1 ? 99 : order.indexOf(right)))
    .map(([name, groupItems]) => ({ name, items: groupItems }));
}

function sparklinePoints(values: number[]): string {
  if (values.length < 2) {
    return "0,14 88,14";
  }
  const width = 88;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${roundCoord(x)},${roundCoord(y)}`;
    })
    .join(" ");
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

function formatSigned(value?: number): string {
  if (value == null) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2, 2)}`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2, 2)}%`;
}

function formatNumber(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function roundCoord(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
