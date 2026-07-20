import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCandles } from "../chart/cdcClient";
import type { CandleDto } from "../chart/types";

export type CompanyJournalPerformanceSeries = {
  symbol: string;
  label: string;
  tone: "company" | "benchmark" | "sector";
  candles: CandleDto[];
};

type CompanyJournalPerformanceChartProps = {
  symbol: string;
  sector?: string;
  industry?: string;
  previewEnabled: boolean;
  storedSeries?: CompanyJournalPerformanceSeries[];
  disableRemoteFetch?: boolean;
};

const defaultPerformanceChartSize = { width: 760, height: 320 };

function usePerformanceChartSize() {
  const [chart, setChart] = useState<SVGSVGElement | null>(null);
  const [size, setSize] = useState(defaultPerformanceChartSize);
  const chartRef = useCallback((node: SVGSVGElement | null) => setChart(node), []);

  useEffect(() => {
    if (!chart) return undefined;
    const measure = () => {
      const bounds = chart.getBoundingClientRect();
      const next = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
      if (next.width < 240 || next.height < 160) return;
      setSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(chart);
    return () => observer.disconnect();
  }, [chart]);

  return { chartRef, chartWidth: size.width, chartHeight: size.height };
}

export function CompanyJournalPerformanceChart({
  symbol,
  sector,
  industry,
  previewEnabled,
  storedSeries = [],
  disableRemoteFetch = false
}: CompanyJournalPerformanceChartProps) {
  const { chartRef, chartWidth, chartHeight } = usePerformanceChartSize();
  const sectorSymbol = companyJournalSectorBenchmarkSymbol(sector, industry);
  const [series, setSeries] = useState<CompanyJournalPerformanceSeries[]>(() => previewEnabled
    ? buildPreviewPerformanceSeries(symbol, sectorSymbol)
    : storedSeries);
  const [status, setStatus] = useState<"loading" | "ready" | "partial" | "error">(
    previewEnabled ? "ready" : "loading"
  );

  useEffect(() => {
    if (previewEnabled) {
      setSeries(buildPreviewPerformanceSeries(symbol, sectorSymbol));
      setStatus("ready");
      return undefined;
    }
    if (storedSeries.length) {
      setSeries(storedSeries);
      setStatus(storedSeries.some((value) => value.tone === "company") ? "ready" : "partial");
      return undefined;
    }
    if (disableRemoteFetch) {
      setSeries([]);
      setStatus("partial");
      return undefined;
    }
    const controller = new AbortController();
    const to = new Date();
    const from = new Date(to);
    from.setUTCFullYear(from.getUTCFullYear() - 2);
    const definitions = [
      { symbol, label: symbol, tone: "company" as const },
      { symbol: "SPY", label: "S&P 500", tone: "benchmark" as const },
      { symbol: sectorSymbol, label: sectorSymbol, tone: "sector" as const }
    ].filter((definition, index, values) => values.findIndex((value) => value.symbol === definition.symbol) === index);
    setStatus("loading");
    void Promise.allSettled(definitions.map(async (definition) => {
      const response = await fetchCandles({
        symbol: definition.symbol,
        interval: "1D",
        limit: 750,
        from: from.toISOString(),
        to: to.toISOString()
      }, controller.signal);
      return { ...definition, candles: response.candles.filter((candle) => candle.isClosed) };
    })).then((results) => {
      if (controller.signal.aborted) return;
      const loaded = results.flatMap((result) => result.status === "fulfilled" && result.value.candles.length
        ? [result.value]
        : []);
      setSeries(loaded);
      const company = loaded.find((value) => value.tone === "company");
      setStatus(!company ? "error" : loaded.length === definitions.length ? "ready" : "partial");
    });
    return () => controller.abort();
  }, [disableRemoteFetch, previewEnabled, sectorSymbol, storedSeries, symbol]);

  const normalized = useMemo(() => normalizePerformanceSeries(series), [series]);
  const companySeries = series.find((value) => value.tone === "company");
  const commonCompanyPoints = normalized.find((value) => value.tone === "company")?.points ?? [];
  const commonFrom = commonCompanyPoints[0]?.timestamp;
  const commonTo = commonCompanyPoints.at(-1)?.timestamp;
  const hasRenderablePerformance = commonCompanyPoints.length >= 2 && commonFrom !== commonTo;
  const hasFilteredSeries = normalized.length < series.filter((value) => value.candles.length > 0).length;
  const companyWindowCandles = (companySeries?.candles ?? []).filter((candle) => (
    (!commonFrom || candle.timestamp >= commonFrom) && (!commonTo || candle.timestamp <= commonTo)
  ));
  const volumePoints = downsampleCandles(companyWindowCandles, 42);
  const values = normalized.flatMap((value) => value.points.map((point) => point.value));
  const minValue = values.length ? Math.min(...values, 0) : -5;
  const maxValue = values.length ? Math.max(...values, 0) : 5;
  const padding = Math.max(4, (maxValue - minValue) * 0.12);
  const domain = { min: minValue - padding, max: maxValue + padding };
  const maxVolume = Math.max(1, ...volumePoints.map((candle) => candle.volume));
  const widthProgress = Math.min(1, Math.max(0, (chartWidth - 320) / 440));
  const plotLeft = 44 + (54 - 44) * widthProgress;
  const plotRight = 10 + (18 - 10) * widthProgress;
  const plotBottom = chartHeight - 26;
  const volumeHeight = Math.min(54, Math.max(36, chartHeight * 0.16));
  const plot = {
    left: plotLeft,
    right: plotRight,
    top: chartHeight < 260 ? 20 : 26,
    priceBottom: plotBottom - volumeHeight - 18,
    volumeTop: plotBottom - volumeHeight,
    bottom: plotBottom
  };
  const yFor = (value: number) => plot.top + ((domain.max - value) / (domain.max - domain.min || 1)) * (plot.priceBottom - plot.top);
  const xFor = (index: number, length: number) => {
    const plotWidth = chartWidth - plot.left - plot.right;
    return length <= 1 ? plot.left + plotWidth / 2 : plot.left + (index / (length - 1)) * plotWidth;
  };
  const ticks = makeTicks(domain.min, domain.max, 5);
  const companyPerformance = normalized.find((value) => value.tone === "company") ?? normalized[0];
  const companyLatestIndex = Math.max(0, (companyPerformance?.points.length ?? 1) - 1);
  const companyLatestPoint = companyPerformance?.points[companyLatestIndex];
  const companyLatestX = companyPerformance ? xFor(companyLatestIndex, companyPerformance.points.length) : chartWidth - plot.right;
  const companyLatestY = companyLatestPoint ? yFor(companyLatestPoint.value) : plot.top;

  return (
    <section className="company-journal-performance" aria-label={`${symbol} 시장 대비 주가와 거래량`}>
      <header>
        <div>
          <h3>시장 대비 주가</h3>
        </div>
        {previewEnabled && <em>DEV PREVIEW</em>}
      </header>
      {hasRenderablePerformance && (
        <div className="company-journal-performance-legend" aria-label="시장 대비 주가 범례">
          {normalized.map((value) => <span key={value.symbol}><i className={value.tone} />{value.label}</span>)}
          <span><i className="volume" />거래량</span>
        </div>
      )}
      {hasRenderablePerformance ? (
        <svg ref={chartRef} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${symbol}, S&P 500, 산업 기준 상대수익률과 거래량`}>
          {ticks.map((tick) => {
            const y = yFor(tick);
            return <g key={tick}><line className="grid" x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="axis-value" x={0} y={y + 4}>{formatAxis(tick)}</text></g>;
          })}
          <line className="zero" x1={plot.left} x2={chartWidth - plot.right} y1={yFor(0)} y2={yFor(0)} />
          {volumePoints.map((candle, index) => {
            const x = xFor(index, volumePoints.length);
            const bar = performanceVolumeBarGeometry(x, plot.left, chartWidth - plot.right, volumePoints.length);
            const height = (candle.volume / maxVolume) * (plot.bottom - plot.volumeTop);
            return <rect key={candle.timestamp} className="volume" x={bar.x} y={plot.bottom - height} width={bar.width} height={height} rx={1.5}><title>{`${formatDate(candle.timestamp)} · 거래량 ${formatVolume(candle.volume)}`}</title></rect>;
          })}
          {normalized.map((value) => (
            <path key={value.symbol} className={`performance-line ${value.tone}`} d={linePath(value.points.map((point) => point.value), xFor, yFor)} />
          ))}
          {normalized.map((value) => value.points.map((point, index) => index === value.points.length - 1 ? (
            <circle key={`${value.symbol}-${point.timestamp}`} className={`performance-end ${value.tone}`} data-journal-mark="market-latest" cx={xFor(index, value.points.length)} cy={yFor(point.value)} r={4}>
              <title>{`${value.label} · ${point.value >= 0 ? "+" : ""}${point.value.toFixed(1)}%`}</title>
            </circle>
          ) : null))}
          {companyLatestPoint && (
            <g className="company-journal-chart-annotation" data-journal-annotation="market-latest" aria-hidden="true">
              <line className="company-journal-chart-annotation-guide" x1={companyLatestX} x2={companyLatestX} y1={plot.top + 28} y2={companyLatestY} />
              <circle className="company-journal-chart-annotation-anchor" cx={companyLatestX} cy={companyLatestY} r={6} />
              <rect className="company-journal-chart-annotation-label" x={Math.max(4, companyLatestX - 150)} y={plot.top + 2} width={140} height={25} rx={7} />
              <text className="company-journal-chart-annotation-text" x={Math.max(13, companyLatestX - 141)} y={plot.top + 19}>시장 대비 상대강도</text>
            </g>
          )}
          {dateLabels(companyWindowCandles).map((label) => (
            <text key={label.timestamp} className="date" x={label.ratio * (chartWidth - plot.left - plot.right) + plot.left} y={chartHeight - 7}>{label.label}</text>
          ))}
        </svg>
      ) : (
        <div className="company-journal-performance-empty">
          {status === "loading" ? "2년 가격 이력을 불러오는 중입니다." : "가격 이력이 충분하지 않아 시장 비교를 계산하지 않았습니다."}
        </div>
      )}
      {hasRenderablePerformance && (status === "partial" || hasFilteredSeries) && <p className="company-journal-performance-note">일부 비교 지수의 이력이 부족해 확인된 시계열만 표시합니다.</p>}
    </section>
  );
}

export function normalizePerformanceSeries(series: CompanyJournalPerformanceSeries[]) {
  const available = series
    .map((value) => ({ ...value, candles: validPerformanceCandles(value.candles) }))
    .filter((value) => value.candles.length >= 2);
  const company = available.find((value) => value.tone === "company") ?? available[0];
  if (!company) return [];
  const minimumComparisonPoints = Math.max(2, Math.ceil(company.candles.length * 0.5));
  const comparable = available.filter((value) => value === company || value.candles.filter((candle) => (
    candle.timestamp >= company.candles[0]!.timestamp && candle.timestamp <= company.candles.at(-1)!.timestamp
  )).length >= minimumComparisonPoints);
  const commonStart = comparable.reduce((latest, value) => value.candles[0]!.timestamp > latest ? value.candles[0]!.timestamp : latest, "");
  const commonEnd = comparable.reduce((earliest, value) => {
    const end = value.candles.at(-1)!.timestamp;
    return !earliest || end < earliest ? end : earliest;
  }, "");
  return comparable.flatMap((value) => {
    const candles = downsampleCandles(
      value.candles.filter((candle) => candle.timestamp >= commonStart && candle.timestamp <= commonEnd),
      64
    );
    if (candles.length < 2 || candles[0]?.timestamp === candles.at(-1)?.timestamp) return [];
    const base = candles.find((candle) => Number.isFinite(candle.close) && candle.close !== 0)?.close;
    if (!base) return [];
    return [{
      ...value,
      points: candles.map((candle) => ({ timestamp: candle.timestamp, value: (candle.close / base - 1) * 100 }))
    }];
  });
}

function validPerformanceCandles(candles: CandleDto[]) {
  const byTimestamp = new Map<string, CandleDto>();
  for (const candle of candles) {
    if (!candle.timestamp || !Number.isFinite(candle.close) || candle.close === 0) continue;
    byTimestamp.set(candle.timestamp, candle);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function performanceVolumeBarGeometry(x: number, plotLeft: number, plotEnd: number, pointCount: number) {
  const plotWidth = Math.max(0, plotEnd - plotLeft);
  const slot = plotWidth / Math.max(1, pointCount - 1);
  const width = Math.min(14, Math.max(2, slot * 0.56));
  return {
    x: Math.min(Math.max(plotLeft, x - width / 2), Math.max(plotLeft, plotEnd - width)),
    width
  };
}

function downsampleCandles(candles: CandleDto[], limit: number) {
  const sorted = [...candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (sorted.length <= limit) return sorted;
  return Array.from({ length: limit }, (_, index) => sorted[Math.round(index * (sorted.length - 1) / (limit - 1))]!).filter(Boolean);
}

function linePath(values: number[], xFor: (index: number, length: number) => number, yFor: (value: number) => number) {
  return values.map((value, index) => `${index ? "L" : "M"}${xFor(index, values.length).toFixed(2)},${yFor(value).toFixed(2)}`).join(" ");
}

function makeTicks(min: number, max: number, count: number) {
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / Math.max(1, count - 1));
}

export function companyJournalSectorBenchmarkSymbol(sector?: string, industry?: string) {
  const value = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/semiconductor/.test(value)) return "SOXX";
  if (/technology|software|interactive media/.test(value)) return "XLK";
  if (/financial|bank|insurance/.test(value)) return "XLF";
  if (/health|pharma|biotech/.test(value)) return "XLV";
  if (/energy|oil|gas/.test(value)) return "XLE";
  if (/consumer staples/.test(value)) return "XLP";
  if (/consumer|retail|automobile/.test(value)) return "XLY";
  if (/industrial|aerospace|transport/.test(value)) return "XLI";
  return "SPY";
}

function buildPreviewPerformanceSeries(symbol: string, sectorSymbol: string): CompanyJournalPerformanceSeries[] {
  const definitions = [
    { symbol, label: symbol, tone: "company" as const, drift: 1.46, amplitude: 10.5, phase: 0 },
    { symbol: "SPY", label: "S&P 500", tone: "benchmark" as const, drift: 0.72, amplitude: 4.2, phase: 1.1 },
    { symbol: sectorSymbol, label: sectorSymbol, tone: "sector" as const, drift: 1.02, amplitude: 6.4, phase: 2.2 }
  ].filter((definition, index, values) => values.findIndex((value) => value.symbol === definition.symbol) === index);
  return definitions.map((definition) => ({
    symbol: definition.symbol,
    label: definition.label,
    tone: definition.tone,
    candles: Array.from({ length: 25 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 6 + index, 1));
      const close = 100 + index * definition.drift + Math.sin(index * 0.63 + definition.phase) * definition.amplitude + Math.max(0, index - 15) * definition.drift * 0.7;
      const previous = index === 0 ? close : 100 + (index - 1) * definition.drift + Math.sin((index - 1) * 0.63 + definition.phase) * definition.amplitude;
      return {
        timestamp: date.toISOString(),
        open: previous,
        high: close * 1.025,
        low: close * 0.975,
        close,
        volume: 24_000_000 + (index % 5) * 7_500_000 + Math.round((Math.sin(index * 0.8) + 1) * 9_000_000),
        isClosed: true
      };
    })
  }));
}

export function dateLabels(candles: CandleDto[]) {
  const sorted = [...candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (!sorted.length) return [];
  const indexes = [...new Set([0, Math.round((sorted.length - 1) / 2), sorted.length - 1])];
  const monthLabels = indexes.map((index) => formatDate(sorted[index]!.timestamp));
  const includeDay = new Set(monthLabels).size < monthLabels.length;
  return indexes.map((index) => {
    const candle = sorted[index]!;
    return { timestamp: candle.timestamp, ratio: index / Math.max(1, sorted.length - 1), label: formatDate(candle.timestamp, includeDay) };
  });
}

function formatAxis(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}%`;
}

function formatDate(value: string, includeDay = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = `${String(date.getUTCFullYear()).slice(2)}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return includeDay ? `${month}.${String(date.getUTCDate()).padStart(2, "0")}` : month;
}

function formatVolume(value: number) {
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
