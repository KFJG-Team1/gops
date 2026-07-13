import { useEffect, useState } from "react";
import { fetchAnalysisAssets, subscribeAnalysisAssetsInvalidation, type AnalysisAssetInterval } from "../chart/analysisAssetsApi";
import { analysisAssetPresentationDiagnostics, detectedPatternSummary, formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import type { CandleDto, ChartInterval } from "../chart/types";

export function ChartCommentaryPanel({ symbol, interval, candles, drawingIds }: {
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
}) {
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof fetchAnalysisAssets>> | null>(null);
  const [revision, setRevision] = useState(0);
  const normalizedSymbol = symbol.trim().toUpperCase();

  useEffect(() => subscribeAnalysisAssetsInvalidation((invalidatedSymbol) => {
    if (!invalidatedSymbol || invalidatedSymbol === normalizedSymbol) {
      setAssets(null);
      setRevision((current) => current + 1);
    }
  }), [normalizedSymbol]);

  useEffect(() => {
    let active = true;
    fetchAnalysisAssets(normalizedSymbol).then((response) => {
      if (active) setAssets(response);
    }).catch(() => {
      if (active) setAssets(null);
    });
    return () => { active = false; };
  }, [normalizedSymbol, revision]);

  if (!isAnalysisAssetInterval(interval)) return <Empty text="이 interval은 Geometry 작도를 지원하지 않습니다" />;
  const asset = assets?.assets[interval] ?? null;
  if (!asset) return <Empty text="Geometry 자산이 준비되지 않았습니다" />;

  const diagnostics = analysisAssetPresentationDiagnostics(asset, candles, drawingIds);
  const pattern = detectedPatternSummary(asset);
  const focusDrawing = (ids: string[]) => window.dispatchEvent(new CustomEvent("gops:chart-asset-focus", {
    detail: { symbol: normalizedSymbol, interval, drawingIds: ids }
  }));
  return (
    <article className="chart-commentary-panel">
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{interval}</span>
        <span className={diagnostics.stale ? "is-stale" : ""}>분석 기준 {formatAnalysisAssetAsOf(asset.asOf)}</span>
        <span className="chart-commentary-badge is-muted">{asset.coverage.state}</span>
      </header>
      <h3 className="chart-commentary-headline">Geometry 분석</h3>
      <p className="chart-commentary-text">지지 {asset.geometry.supports.length}개 · 저항 {asset.geometry.resistances.length}개 · 적용 {diagnostics.appliedDrawingCount}개</p>
      {pattern && (
        <button type="button" onClick={() => focusDrawing(asset.geometry.drawings.filter((drawing) => drawing.id.includes(asset.geometry.primaryTriangle?.geometryHash ?? "")).map((drawing) => drawing.id))}>
          {patternName(pattern.kind)} · {pattern.state === "confirmed" ? "돌파 확인" : "형성 중"} · 점수 {pattern.score.toFixed(2)}
        </button>
      )}
      <section className="chart-commentary-levels" aria-label="핵심 레벨">
        <h3>핵심 레벨</h3>
        <ul>
          {[...asset.geometry.supports, ...asset.geometry.resistances].map((level) => (
            <li key={level.id}>{level.role === "support" ? "지지" : "저항"} {level.price.toFixed(2)} · 접촉 {level.touches}회</li>
          ))}
        </ul>
      </section>
      <p className="chart-commentary-text">SMA60 {formatValue(asset.indicators.sma60)} · SMA120 {formatValue(asset.indicators.sma120)} · {crossName(asset.indicators.cross.direction)}</p>
      {diagnostics.stale && <p className="chart-commentary-invalidation">새 완료 봉이 있어 낮은 불투명도로 이전 자산을 표시합니다.</p>}
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="chart-commentary-empty" role="status"><span>{text}</span></div>;
}

function isAnalysisAssetInterval(interval: ChartInterval): interval is AnalysisAssetInterval {
  return ["1m", "5m", "10m", "1h", "4h", "1D", "1W"].includes(interval);
}

function patternName(kind: string): string {
  return { ascending_triangle: "상승 삼각형", descending_triangle: "하락 삼각형", symmetrical_triangle: "대칭 삼각형" }[kind] ?? kind;
}

function formatValue(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function crossName(direction: "golden" | "dead" | null | undefined): string {
  return direction === "golden" ? "골든크로스" : direction === "dead" ? "데드크로스" : "교차 없음";
}
