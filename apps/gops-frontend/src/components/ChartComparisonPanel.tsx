import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fetchChartCompare } from "../chart/cdcClient";
import { useVerticalOverflow } from "../hooks/useVerticalOverflow";
import type {
  ChartCompareItemDto,
  ChartComparePointDto,
  ChartCompareRange,
  ChartCompareResponseDto,
  ChartSymbolDto
} from "../chart/types";
import { SymbolSearch } from "./SymbolSearch";
import { StockLogo } from "./StockLogo";

type ChartComparisonPanelProps = {
  symbol: string;
  comparisonSymbols: string[];
  symbols: ChartSymbolDto[];
  range: ChartCompareRange;
  onRangeChange: (range: ChartCompareRange) => void;
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
};

const compareRanges: ChartCompareRange[] = ["1D", "1M", "6M", "1Y", "5Y"];
const chartWidth = 1600;
const chartHeight = 300;
const plot = { left: 62, right: 1538, top: 28, bottom: 232 };
const fallbackColors = ["#0052ff", "#05b169", "#cf202f", "#f4b000", "#003ecc", "#8c939f"];
const maxCompareSymbols = 6;

export function ChartComparisonPanel({
  symbol,
  comparisonSymbols,
  symbols,
  range,
  onRangeChange,
  onAddSymbol,
  onRemoveSymbol
}: ChartComparisonPanelProps) {
  const requestSymbols = useMemo(() => {
    const values = [symbol, ...comparisonSymbols];
    return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  }, [comparisonSymbols, symbol]);
  const requestKey = requestSymbols.join(",");
  const availableSymbols = useMemo(() => {
    const active = new Set(requestSymbols);
    return symbols.filter((item) => !active.has(item.symbol.toUpperCase()));
  }, [requestSymbols, symbols]);
  const [response, setResponse] = useState<ChartCompareResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const symbolsForRequest = requestKey.split(",").filter(Boolean);
    if (!symbolsForRequest.length) {
      setResponse(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setHoverX(null);
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
      const source = item ?? emptyItem(value);
      const apiName = item?.companyName?.trim();
      const metadataName = metadata?.name?.trim();
      return {
        ...source,
        points: normalizeComparePoints(source.points),
        companyName: displayCompanyName(value, apiName, metadataName),
        color: item?.color ?? fallbackColors[index % fallbackColors.length]
      };
    });
  }, [requestSymbols, response?.items, symbols]);
  const series = displayItems.filter((item) => item.points.length >= 2);
  const timeScale = compareTimeScale(series);
  const percentDomain = percentRange(series);
  const xTicks = makeTimeTicks(timeScale, range === "1D" ? 7 : 6);
  const yTicks = makePercentTicks(percentDomain, 5);
  const hasRenderableSeries = series.length > 0;
  const cacheLabel = response?.cache?.hit ? "cached" : response ? "fresh" : "";
  const hoverSnapshot = useMemo(
    () => buildHoverSnapshot(hoverX, series, timeScale, percentDomain),
    [hoverX, percentDomain, series, timeScale]
  );
  const lineLabels = useMemo(() => buildLineLabels(series, percentDomain), [percentDomain, series]);
  const primaryItem = displayItems[0];
  const primaryPercent = hoverSnapshot?.points.find((entry) => entry.item.symbol === primaryItem?.symbol)?.point.returnPercent ?? primaryItem?.changePercent;
  const heroPercent = typeof primaryPercent === "number" && Number.isFinite(primaryPercent) ? primaryPercent : 0;
  const listRef = useRef<HTMLDivElement>(null);
  const listScrolls = useVerticalOverflow(listRef);

  function handleComparePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!hasRenderableSeries) {
      setHoverX(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * chartWidth;
    if (localX < plot.left || localX > plot.right) {
      setHoverX(null);
      return;
    }
    setHoverX(localX);
  }

  return (
    <div className="chart-compare-container">
      <div className={`chart-compare-panel ${hoverSnapshot ? "is-hovering" : ""} ${listScrolls ? "has-scroll-rule" : ""}`} aria-label="비교 차트">
      <aside className="chart-compare-sidebar" aria-label="비교 종목 관리">
        <div className="chart-compare-sidebar-top">
          <span className="chart-compare-brand">GOPS</span>
          <span className="chart-compare-overview">Comparison Overview</span>
        </div>
        <div className="chart-compare-hero">
          <span>{primaryItem?.symbol ?? symbol.toUpperCase()} · 기준</span>
          <strong className={toneClass(heroPercent)}>{formatSignedPercent(heroPercent)}</strong>
          <p>
            {requestSymbols.length}/{maxCompareSymbols} symbols · {response?.timeframe ?? timeframeLabel(range)}
            {cacheLabel ? ` · ${cacheLabel}` : ""}
          </p>
        </div>
        {requestSymbols.length < maxCompareSymbols && (
          <SymbolSearch
            symbols={availableSymbols}
            className="chart-compare-symbol-search"
            selectedLabel=""
            placeholder="기업 추가"
            compact
            menuPlacement="bottom"
            onSelectSymbol={onAddSymbol}
          />
        )}
        <div className="chart-compare-list" aria-label="비교 종목 목록" ref={listRef}>
          {displayItems.map((item, index) => {
            const removable = item.symbol !== symbol.toUpperCase();
            const hoverEntry = hoverSnapshot?.points.find((entry) => entry.item.symbol === item.symbol);
            const rowPrice = hoverEntry?.point.price ?? item.lastPrice;
            const rowChange = hoverEntry ? changeFromBase(hoverEntry.point, item) : item.change;
            const rowPercent = hoverEntry?.point.returnPercent ?? item.changePercent;
            return (
              <div key={item.symbol} className={`chart-compare-list-row ${item.error ? "error" : ""} ${hoverEntry ? "is-synced" : ""}`}>
                <span className="chart-compare-row-swatch" style={{ background: item.color }} aria-hidden="true" />
                <StockLogo
                  symbol={item.symbol}
                  companyName={item.companyName ?? item.symbol}
                  size="xs"
                  className="chart-compare-row-logo"
                />
                <div className="chart-compare-row-name">
                  <strong>{item.companyName ?? item.symbol}</strong>
                  <span>{item.symbol}{item.exchange ? ` · ${item.exchange}` : ""}</span>
                </div>
                <div className="chart-compare-row-metrics">
                  <span className="chart-compare-row-price">{formatPrice(rowPrice)}</span>
                  <span className={`chart-compare-row-percent ${toneClass(rowPercent)}`}>{formatSignedPercent(rowPercent)}</span>
                </div>
                {removable ? (
                  <button type="button" aria-label={`${item.symbol} 비교 삭제`} title={`${item.symbol} 비교 삭제`} onClick={() => onRemoveSymbol(item.symbol)}>
                    <X size={15} />
                  </button>
                ) : (
                  <span className="chart-compare-row-anchor">{index === 0 ? "기준" : ""}</span>
                )}
                <span className={`chart-compare-row-change ${toneClass(rowPercent)}`}>{formatChange(rowChange)}</span>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="chart-compare-main" aria-label="수익률 비교 그래프">
        <div className="chart-compare-header">
          <div>
            <strong>Return graph</strong>
            <span>{hoverSnapshot ? formatHoverTime(hoverSnapshot.timestamp, range) : "first close 기준 수익률"}</span>
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
        <svg
          className="chart-compare-svg"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="종목 수익률 비교 차트"
          onPointerMove={handleComparePointerMove}
          onPointerDown={handleComparePointerMove}
          onPointerLeave={() => setHoverX(null)}
        >
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
            const x = xForTime(tick, timeScale);
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
              points={item.points.map((point) => `${xForTime(Date.parse(point.time), timeScale)},${yForPercent(point.returnPercent, percentDomain)}`).join(" ")}
              style={{ stroke: item.color }}
            />
          ))}
          {!hoverSnapshot && lineLabels.map(({ item, point, y }) => (
              <text
                key={`${item.symbol}-label`}
                className="chart-compare-line-label"
                x={plot.right - 4}
                y={y}
                textAnchor="end"
                style={{ fill: item.color }}
              >
                {item.symbol} {formatSignedPercent(point.returnPercent)}
              </text>
          ))}
          {hoverSnapshot && (
            <g className="chart-compare-hover-layer" aria-hidden="true">
              <line className="chart-compare-hover-guide" x1={hoverSnapshot.x} x2={hoverSnapshot.x} y1={plot.top} y2={plot.bottom} />
              {hoverSnapshot.points.map((entry) => (
                <circle
                  key={`${entry.item.symbol}-${entry.point.time}`}
                  className="chart-compare-hover-dot"
                  cx={hoverSnapshot.x}
                  cy={entry.y}
                  r={5}
                  style={{ fill: entry.item.color, stroke: entry.item.color }}
                />
              ))}
            </g>
          )}
          {!hasRenderableSeries && (
            <text className="chart-compare-empty" x={chartWidth / 2} y={chartHeight / 2} textAnchor="middle">
              {loading ? "비교 데이터 확인 중" : error ?? "비교 데이터가 없습니다"}
            </text>
          )}
        </svg>
        {hoverSnapshot && (
          <div className="chart-compare-hover-card" aria-live="polite">
            <strong>{formatHoverTime(hoverSnapshot.timestamp, range)}</strong>
            {hoverSnapshot.points.map((entry) => (
              <div key={entry.item.symbol}>
                <i style={{ background: entry.item.color }} aria-hidden="true" />
                <span>{entry.item.symbol}</span>
                <em>{formatPrice(entry.point.price)}</em>
                <b className={toneClass(entry.point.returnPercent)}>{formatSignedPercent(entry.point.returnPercent)}</b>
              </div>
            ))}
          </div>
        )}
        </section>
      </div>
    </div>
  );
}

type HoverComparePoint = {
  item: ChartCompareItemDto;
  point: ChartComparePointDto;
  y: number;
};

type HoverCompareSnapshot = {
  timestamp: number;
  x: number;
  points: HoverComparePoint[];
};

type CompareLineLabel = {
  item: ChartCompareItemDto;
  point: ChartComparePointDto;
  y: number;
};

type CompareTimeScale = {
  timeline: number[];
  min: number;
  max: number;
};

function emptyItem(symbol: string): ChartCompareItemDto {
  return {
    symbol,
    companyName: symbol,
    points: [],
    error: "pending",
    message: "pending"
  };
}

function displayCompanyName(symbol: string, apiName: string | undefined, metadataName: string | undefined): string {
  const normalized = symbol.trim().toUpperCase();
  const candidates = [metadataName, apiName];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.toUpperCase() !== normalized) {
      return value;
    }
  }
  return normalized;
}

function normalizeComparePoints(points: ChartComparePointDto[]): ChartComparePointDto[] {
  return [...points]
    .filter((point) => (
      Number.isFinite(Date.parse(point.time)) &&
      Number.isFinite(point.price) &&
      Number.isFinite(point.returnPercent)
    ))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function buildHoverSnapshot(
  hoverX: number | null,
  items: ChartCompareItemDto[],
  timeScale: CompareTimeScale,
  percentDomain: { min: number; max: number }
): HoverCompareSnapshot | null {
  if (hoverX == null || !items.length) {
    return null;
  }
  const timestamp = timeForX(hoverX, timeScale);
  const snappedX = xForTime(timestamp, timeScale);
  const points = items
    .map((item) => {
      const point = nearestComparePoint(item.points, timestamp);
      if (!point) {
        return null;
      }
      return {
        item,
        point,
        y: yForPercent(point.returnPercent, percentDomain)
      };
    })
    .filter((entry): entry is HoverComparePoint => entry != null);
  if (!points.length) {
    return null;
  }
  return {
    timestamp,
    x: snappedX,
    points
  };
}

function nearestComparePoint(points: ChartComparePointDto[], timestamp: number): ChartComparePointDto | null {
  let nearest: ChartComparePointDto | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const pointTime = Date.parse(point.time);
    const distance = Math.abs(pointTime - timestamp);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function compareTimeScale(items: ChartCompareItemDto[]): CompareTimeScale {
  const values = Array.from(new Set(
    items.flatMap((item) => item.points.map((point) => Date.parse(point.time))).filter(Number.isFinite)
  )).sort((left, right) => left - right);
  if (!values.length) {
    const now = Date.now();
    return { timeline: [now - 60 * 60 * 1000, now], min: now - 60 * 60 * 1000, max: now };
  }
  if (values.length === 1) {
    const value = values[0];
    return { timeline: [value - 1, value + 1], min: value - 1, max: value + 1 };
  }
  return { timeline: values, min: values[0], max: values[values.length - 1] };
}

function buildLineLabels(items: ChartCompareItemDto[], percentDomain: { min: number; max: number }): CompareLineLabel[] {
  const minY = plot.top + 12;
  const maxY = plot.bottom - 6;
  const minGap = 15;
  const labels = items
    .map((item) => {
      const point = item.points[item.points.length - 1];
      return point ? { item, point, y: yForPercent(point.returnPercent, percentDomain) - 7 } : null;
    })
    .filter((entry): entry is CompareLineLabel => entry != null)
    .sort((left, right) => left.y - right.y);

  let cursor = minY;
  for (const label of labels) {
    label.y = Math.max(label.y, cursor);
    cursor = label.y + minGap;
  }
  const overflow = labels.length ? labels[labels.length - 1].y - maxY : 0;
  if (overflow > 0) {
    for (let index = labels.length - 1; index >= 0; index -= 1) {
      const nextY = index === labels.length - 1 ? maxY : labels[index + 1].y - minGap;
      labels[index].y = Math.min(labels[index].y - overflow, nextY);
    }
  }
  return labels.map((label) => ({
    ...label,
    y: Math.max(minY, Math.min(maxY, label.y))
  }));
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

function xForTime(value: number, scale: CompareTimeScale): number {
  const span = Math.max(1, scale.max - scale.min);
  const clamped = Math.max(scale.min, Math.min(scale.max, value));
  return plot.left + ((clamped - scale.min) / span) * (plot.right - plot.left);
}

function timeForX(value: number, scale: CompareTimeScale): number {
  const timeline = scale.timeline;
  const clamped = Math.max(plot.left, Math.min(plot.right, value));
  const ratio = (clamped - plot.left) / Math.max(1, plot.right - plot.left);
  const rawTime = scale.min + ratio * Math.max(1, scale.max - scale.min);
  if (timeline.length <= 1) {
    return rawTime;
  }
  return timeline[nearestTimelineIndex(timeline, rawTime)];
}

function yForPercent(value: number, range: { min: number; max: number }): number {
  const span = Math.max(0.0001, range.max - range.min);
  return plot.top + ((range.max - value) / span) * (plot.bottom - plot.top);
}

function makeTimeTicks(scale: CompareTimeScale, count: number): number[] {
  const safeCount = Math.max(2, count);
  if (scale.max <= scale.min) {
    return scale.timeline;
  }
  const span = scale.max - scale.min;
  return Array.from({ length: safeCount }, (_, index) => scale.min + (span * index) / (safeCount - 1));
}

function nearestTimelineIndex(timeline: number[], value: number): number {
  let low = 0;
  let high = timeline.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (timeline[mid] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  if (low <= 0) {
    return 0;
  }
  const previous = low - 1;
  return Math.abs(timeline[previous] - value) <= Math.abs(timeline[low] - value) ? previous : low;
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

function formatHoverTime(value: number, range: ChartCompareRange): string {
  const date = new Date(value);
  if (range === "1D") {
    return date.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("ko-KR", { year: "2-digit", month: "short", day: "numeric" });
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

function changeFromBase(point: ChartComparePointDto, item: ChartCompareItemDto): number | null {
  const basePrice = typeof item.basePrice === "number" && Number.isFinite(item.basePrice)
    ? item.basePrice
    : item.points[0]?.price;
  return typeof basePrice === "number" && Number.isFinite(basePrice) ? point.price - basePrice : null;
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
