import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchChartCompare } from "../chart/cdcClient";
import type { ChartCompareItemDto, ChartCompareRange, ChartCompareResponseDto, ChartSymbolDto } from "../chart/types";

type ChartComparisonPanelProps = {
  symbol: string;
  comparisons: Array<{
    id: string;
    symbol: string;
    label?: string;
    style?: { color?: string; colorToken?: string };
  }>;
  symbols: ChartSymbolDto[];
  range: ChartCompareRange;
  onRangeChange: (range: ChartCompareRange) => void;
  onRemoveComparison: (comparisonId: string) => void;
};

const compareRanges: ChartCompareRange[] = ["1D", "1M", "6M", "1Y", "5Y"];
const chartWidth = 960;
const chartHeight = 360;
const plot = { left: 54, right: 910, top: 34, bottom: 284 };
const fallbackColors = ["#2a8c99", "#b2553d", "#b99b2e", "#ca8a4a", "#8f6bb5", "#c85363"];

export function ChartComparisonPanel({
  symbol,
  comparisons,
  symbols,
  range,
  onRangeChange,
  onRemoveComparison
}: ChartComparisonPanelProps) {
  const requestSymbols = useMemo(() => {
    const values = [symbol, ...comparisons.map((comparison) => comparison.symbol)];
    return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  }, [comparisons, symbol]);
  const requestKey = requestSymbols.join(",");
  const [response, setResponse] = useState<ChartCompareResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const symbolsForRequest = requestKey.split(",").filter(Boolean);
    if (!symbolsForRequest.length) {
      setResponse(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchChartCompare({ symbols: symbolsForRequest, range }, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setResponse(payload);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Compare request failed");
          setResponse(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [range, requestKey]);

  const displayItems = useMemo(() => {
    const items = response?.items ?? [];
    return requestSymbols.map((value, index) => {
      const item = items.find((candidate) => candidate.symbol === value);
      const metadata = symbols.find((candidate) => candidate.symbol.toUpperCase() === value);
      return {
        ...(item ?? emptyItem(value)),
        companyName: item?.companyName ?? metadata?.name ?? value,
        color: item?.color ?? fallbackColors[index % fallbackColors.length]
      };
    });
  }, [requestSymbols, response?.items, symbols]);
  const series = displayItems.filter((item) => item.points.length >= 2);
  const timeDomain = timeRange(series);
  const percentDomain = percentRange(series);
  const xTicks = makeTimeTicks(timeDomain, 5);
  const yTicks = makePercentTicks(percentDomain, 5);
  const hasRenderableSeries = series.length > 0;
  const cacheLabel = response?.cache?.hit ? "cached" : response ? "fresh" : "";

  return (
    <div className="chart-compare-panel" aria-label="비교 차트">
      <div className="chart-compare-header">
        <div>
          <strong>비교</strong>
          <span>{response?.timeframe ?? timeframeLabel(range)} · {cacheLabel}</span>
        </div>
        <div className="chart-compare-range-tabs" role="tablist" aria-label="비교 기간">
          {compareRanges.map((item) => (
            <button
              key={item}
              type="button"
              className={item === range ? "active" : ""}
              onClick={() => onRangeChange(item)}
              aria-pressed={item === range}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <svg className="chart-compare-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="종목 수익률 비교 차트">
        {yTicks.map((tick) => {
          const y = yForPercent(tick, percentDomain);
          return (
            <g key={tick}>
              <line className="chart-compare-grid" x1={plot.left} x2={plot.right} y1={y} y2={y} />
              <text className="chart-compare-axis-label" x={plot.left - 10} y={y + 4} textAnchor="end">{formatPercent(tick)}</text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = xForTime(tick, timeDomain);
          return (
            <g key={tick}>
              <line className="chart-compare-grid subtle" x1={x} x2={x} y1={plot.top} y2={plot.bottom} />
              <text className="chart-compare-axis-label" x={x} y={plot.bottom + 28} textAnchor="middle">{formatTickTime(tick, range)}</text>
            </g>
          );
        })}
        <line className="chart-compare-zero" x1={plot.left} x2={plot.right} y1={yForPercent(0, percentDomain)} y2={yForPercent(0, percentDomain)} />
        {series.map((item) => (
          <polyline
            key={item.symbol}
            className="chart-compare-line"
            points={item.points.map((point) => `${xForTime(Date.parse(point.time), timeDomain)},${yForPercent(point.returnPercent, percentDomain)}`).join(" ")}
            style={{ stroke: item.color }}
          />
        ))}
        {series.map((item) => {
          const last = item.points[item.points.length - 1];
          if (!last) {
            return null;
          }
          return (
            <text
              key={`${item.symbol}-label`}
              className="chart-compare-line-label"
              x={plot.right - 4}
              y={Math.max(plot.top + 12, Math.min(plot.bottom - 6, yForPercent(last.returnPercent, percentDomain) - 7))}
              textAnchor="end"
              style={{ fill: item.color }}
            >
              {item.symbol} {formatSignedPercent(last.returnPercent)}
            </text>
          );
        })}
        {!hasRenderableSeries && (
          <text className="chart-compare-empty" x={chartWidth / 2} y={chartHeight / 2} textAnchor="middle">
            {loading ? "비교 데이터 확인 중" : error ?? "비교 데이터가 없습니다"}
          </text>
        )}
      </svg>
      <div className="chart-compare-list" aria-label="비교 종목 목록">
        {displayItems.map((item, index) => {
          const removable = item.symbol !== symbol.toUpperCase();
          const comparison = comparisons.find((candidate) => candidate.symbol.toUpperCase() === item.symbol);
          return (
            <div key={item.symbol} className={`chart-compare-list-row ${item.error ? "error" : ""}`}>
              <span className="chart-compare-row-swatch" style={{ background: item.color }} aria-hidden="true" />
              <div className="chart-compare-row-name">
                <strong>{item.companyName ?? item.symbol}</strong>
                <span>{item.symbol}{item.exchange ? ` · ${item.exchange}` : ""}</span>
              </div>
              <span>{formatPrice(item.lastPrice)}</span>
              <span className={toneClass(item.changePercent)}>{formatChange(item.change)}</span>
              <span className={toneClass(item.changePercent)}>{formatSignedPercent(item.changePercent)}</span>
              {removable && comparison ? (
                <button type="button" aria-label={`${item.symbol} 비교 삭제`} title={`${item.symbol} 비교 삭제`} onClick={() => onRemoveComparison(comparison.id)}>
                  <X size={15} />
                </button>
              ) : (
                <span className="chart-compare-row-anchor">{index === 0 ? "기준" : ""}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function emptyItem(symbol: string): ChartCompareItemDto {
  return {
    symbol,
    companyName: symbol,
    points: [],
    error: "pending",
    message: "pending"
  };
}

function timeRange(items: ChartCompareItemDto[]): { min: number; max: number } {
  const values = items.flatMap((item) => item.points.map((point) => Date.parse(point.time))).filter(Number.isFinite);
  if (!values.length) {
    const now = Date.now();
    return { min: now - 60 * 60 * 1000, max: now };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}

function percentRange(items: ChartCompareItemDto[]): { min: number; max: number } {
  const values = items.flatMap((item) => item.points.map((point) => point.returnPercent)).filter(Number.isFinite);
  if (!values.length) {
    return { min: -1, max: 1 };
  }
  const min = Math.min(-1, ...values);
  const max = Math.max(1, ...values);
  const pad = Math.max(0.25, (max - min) * 0.1);
  return { min: min - pad, max: max + pad };
}

function xForTime(value: number, range: { min: number; max: number }): number {
  const span = Math.max(1, range.max - range.min);
  return plot.left + ((value - range.min) / span) * (plot.right - plot.left);
}

function yForPercent(value: number, range: { min: number; max: number }): number {
  const span = Math.max(0.0001, range.max - range.min);
  return plot.top + ((range.max - value) / span) * (plot.bottom - plot.top);
}

function makeTimeTicks(range: { min: number; max: number }, count: number): number[] {
  const safeCount = Math.max(2, count);
  const step = (range.max - range.min) / (safeCount - 1);
  return Array.from({ length: safeCount }, (_, index) => range.min + step * index);
}

function makePercentTicks(range: { min: number; max: number }, count: number): number[] {
  const safeCount = Math.max(2, count);
  const step = (range.max - range.min) / (safeCount - 1);
  return Array.from({ length: safeCount }, (_, index) => range.min + step * index);
}

function formatTickTime(value: number, range: ChartCompareRange): string {
  const date = new Date(value);
  if (range === "1D") {
    return date.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function timeframeLabel(range: ChartCompareRange): string {
  if (range === "1D") {
    return "1분";
  }
  if (range === "1M") {
    return "1시간";
  }
  if (range === "5Y") {
    return "1주";
  }
  return "1일";
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `US$${value.toFixed(2)}` : "-";
}

function formatChange(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : "-"}US$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value === 0 ? 0 : 1)}%`;
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function toneClass(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "flat";
  }
  if (value > 0) {
    return "up";
  }
  if (value < 0) {
    return "down";
  }
  return "flat";
}
