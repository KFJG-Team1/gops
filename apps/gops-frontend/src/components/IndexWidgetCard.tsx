import type { ReactNode } from "react";
import type { MarketIndexItem } from "../market/indicesApi";

export type IndexWidgetDirection = "positive" | "negative" | "neutral";

export function IndexWidgetCard({
  item,
  className = "",
  action,
  footerLeading
}: {
  item: MarketIndexItem;
  className?: string;
  action?: ReactNode;
  footerLeading?: ReactNode;
}) {
  const direction = directionForItem(item);
  return (
    <article className={`index-widget-card surface-raised is-${direction}${action ? " has-action" : ""}${className ? ` ${className}` : ""}`}>
      {action && <div className="index-widget-card-action">{action}</div>}
      <header className="index-widget-card-top">
        <div className="index-widget-title">
          <strong className="index-widget-symbol">{stripCaret(item.symbol)}</strong>
          <span className="index-widget-name">{item.name}</span>
        </div>
        <strong className={`index-widget-percent is-${direction}`}>
          {item.changePercent != null ? formatPercent(item.changePercent) : "--"}
        </strong>
      </header>
      <MiniAreaSparkline values={item.sparkline} direction={direction} />
      <footer className="index-widget-card-bottom">
        {footerLeading}
        <span className="index-widget-price">{formatPrice(item)}</span>
      </footer>
    </article>
  );
}

export function MiniAreaSparkline({ values, direction }: { values: number[]; direction: IndexWidgetDirection }) {
  const { points, areaPath, currentY } = sparklineGeometry(values);
  return (
    <svg
      className={`index-widget-sparkline is-${direction}`}
      viewBox="0 0 120 42"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line
        className="index-widget-price-line"
        x1="0"
        y1={currentY}
        x2="120"
        y2={currentY}
        vectorEffect="non-scaling-stroke"
      />
      <path className="index-widget-sparkline-area" d={areaPath} vectorEffect="non-scaling-stroke" />
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function directionForItem(item: MarketIndexItem): IndexWidgetDirection {
  const basis = item.changePercent ?? item.change;
  if (basis == null) {
    return "neutral";
  }
  return basis > 0 ? "positive" : basis < 0 ? "negative" : "neutral";
}

export function stripCaret(symbol: string): string {
  return symbol.startsWith("^") ? symbol.slice(1) : symbol;
}

export function sparklineGeometry(values: number[]): { points: string; areaPath: string; currentY: string } {
  const width = 120;
  const height = 42;
  if (values.length < 2) {
    return {
      points: `0,${height / 2} ${width},${height / 2}`,
      areaPath: `M 0,${height} L 0,${height / 2} L ${width},${height / 2} L ${width},${height} Z`,
      currentY: String(height / 2)
    };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const yOf = (value: number) => height - ((value - min) / range) * (height - 6) - 3;
  const coordinates = values.map((value, index) => ({
    x: roundCoord((index / (values.length - 1)) * width),
    y: roundCoord(yOf(value))
  }));
  const points = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = [
    `M ${coordinates[0]!.x},${height}`,
    ...coordinates.map((point) => `L ${point.x},${point.y}`),
    `L ${coordinates[coordinates.length - 1]!.x},${height}`,
    "Z"
  ].join(" ");
  return { points, areaPath, currentY: coordinates[coordinates.length - 1]!.y };
}

export function formatPrice(item: MarketIndexItem): string {
  if (item.price == null) {
    return "N/A";
  }
  if (item.symbol === "BTC-USD") {
    return formatNumber(item.price, 0, 0);
  }
  return formatNumber(item.price, 2, 2);
}

export function formatPercent(value: number): string {
  if (value > 0) {
    return `▲ ${formatNumber(Math.abs(value), 2, 2)}%`;
  }
  if (value < 0) {
    return `▼ ${formatNumber(Math.abs(value), 2, 2)}%`;
  }
  return `${formatNumber(0, 2, 2)}%`;
}

export function formatNumber(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
}

function roundCoord(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
