import { LoaderCircle, RefreshCcw } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import type { MarketIndexItem } from "../market/indicesApi";
import { useMarketIndices } from "../market/useMarketIndices";

export function IndexPanel() {
  const { payload, loading, refreshing, error, warning, reload } = useMarketIndices();
  const groups = useMemo(() => groupIndexItems(payload?.items ?? []), [payload?.items]);
  // The name column's minimum width tracks the longest ticker, so the graph only starts
  // disappearing once the fullname has already collapsed to the ticker.
  const nameMinWidth = useMemo(() => {
    const maxChars = (payload?.items ?? []).reduce((max, item) => Math.max(max, stripCaret(item.symbol).length), 3);
    return Math.ceil(maxChars * 7.6 + 6);
  }, [payload?.items]);
  const panelStyle = { "--index-name-min": `${nameMinWidth}px` } as CSSProperties;

  return (
    <section className="market-indices-panel" aria-label="시장 지수 패널" style={panelStyle}>
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
        <strong className="market-index-symbol-primary">{stripCaret(item.symbol)}</strong>
        <span className="market-index-fullname">{item.name}</span>
      </div>
      <MiniSparkline values={item.sparkline} direction={direction} />
      <div className="market-index-quote">
        <strong className={`market-index-percent is-${direction}`}>
          {item.changePercent != null ? formatPercent(item.changePercent) : "--"}
        </strong>
        <span className="market-index-price">{formatPrice(item)}</span>
      </div>
    </article>
  );
}

function MiniSparkline({ values, direction }: { values: number[]; direction: "positive" | "negative" | "neutral" }) {
  const { points, currentY } = sparklineGeometry(values);
  return (
    <svg
      className={`market-index-sparkline is-${direction}`}
      viewBox="0 0 88 28"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line
        className="market-index-price-line"
        x1="0"
        y1={currentY}
        x2="88"
        y2={currentY}
        vectorEffect="non-scaling-stroke"
      />
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

function stripCaret(symbol: string): string {
  return symbol.startsWith("^") ? symbol.slice(1) : symbol;
}

function sparklineGeometry(values: number[]): { points: string; currentY: string } {
  const height = 28;
  if (values.length < 2) {
    return { points: "0,14 88,14", currentY: "14" };
  }
  const width = 88;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const yOf = (value: number) => height - ((value - min) / range) * (height - 4) - 2;
  const points = values
    .map((value, index) => `${roundCoord((index / (values.length - 1)) * width)},${roundCoord(yOf(value))}`)
    .join(" ");
  return { points, currentY: roundCoord(yOf(values[values.length - 1])) };
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
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2, 2)}%`;
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
