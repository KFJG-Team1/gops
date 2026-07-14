import { useEffect, useState } from "react";
import { fetchAnalysisAssets, subscribeAnalysisAssetsInvalidation, type AnalysisAssetInterval } from "../chart/analysisAssetsApi";
import { analysisAssetPresentationDiagnostics, detectedPatternSummary, formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import type { AnalysisLayerVisibility } from "../chart/analysisLayerController";
import { buildTradeScenarioPresentation } from "../chart/tradeScenarioPresentation";
import type { CandleDto, ChartInterval } from "../chart/types";

export function ChartCommentaryPanel({ symbol, interval, candles, drawingIds, analysisLayerVisibility }: {
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
  analysisLayerVisibility: AnalysisLayerVisibility;
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
  const scenario = buildTradeScenarioPresentation(asset);
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
      <h3 className="chart-commentary-headline">작도 기반 대응 시나리오</h3>
      <section className="chart-commentary-card is-interpretation" aria-label="현재 해석">
        <header><span>현재 해석</span>{pattern && <strong>품질 {pattern.score.toFixed(2)}</strong>}</header>
        {pattern ? (
          <button className="chart-commentary-pattern" type="button" onClick={() => focusDrawing(asset.geometry.drawings.filter((drawing) => drawing.id.includes(asset.geometry.primaryPattern?.geometryHash ?? asset.geometry.primaryTriangle?.geometryHash ?? "")).map((drawing) => drawing.id))}>
            {patternName(pattern.kind)} · {pattern.state === "confirmed" ? "돌파 확인" : "형성 중"}
          </button>
        ) : <p>현재 활성 패턴이 없습니다.</p>}
        <p>지지 {asset.geometry.supports.length}개 · 저항 {asset.geometry.resistances.length}개 · 적용 {diagnostics.appliedDrawingCount}개</p>
        <ul>
          {[...asset.geometry.supports, ...asset.geometry.resistances].map((level) => (
            <li key={level.id}>{level.role === "support" ? "지지" : "저항"} {level.price.toFixed(2)} · 접촉 {level.touches}회</li>
          ))}
        </ul>
      </section>
      {analysisLayerVisibility.scenario && scenario?.available && scenario.responseTitle && (
        <section className="chart-commentary-card is-scenario" aria-label="대응 시나리오">
          <header><span>대응 시나리오</span><strong>{scenario.stateLabel}</strong></header>
          <h4>{scenario.responseTitle}</h4>
          {scenario.confirmationSummary && <p>{scenario.confirmationSummary}</p>}
          {scenario.responseDetail && <p>{scenario.responseDetail}</p>}
          {scenario.responseItems.length > 0 && (
            <ul>{scenario.responseItems.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
          {scenario.conditionLabels.length > 0 && (
            <ul className="chart-commentary-conditions">
              {scenario.conditionLabels.map((condition) => <li key={condition}>{condition}</li>)}
            </ul>
          )}
        </section>
      )}
      {analysisLayerVisibility.scenario && scenario?.available && scenario.invalidation && (
        <section className="chart-commentary-card is-invalidation" aria-label="무효화 조건">
          <header><span>무효화 조건</span></header>
          <p>{scenario.invalidation}</p>
        </section>
      )}
      <section className="chart-commentary-card is-quality" aria-label="분석 품질">
        <header><span>분석 품질</span><strong>{asset.coverage.state}</strong></header>
        <p>{interval} · 기준 {formatAnalysisAssetAsOf(asset.asOf)} · {diagnostics.stale ? "이전 분석" : "최신 완료 봉 기준"}</p>
        <p>SMA60 {formatValue(asset.indicators.sma60)} · SMA120 {formatValue(asset.indicators.sma120)} · {crossName(asset.indicators.cross.direction)}</p>
        {diagnostics.stale && <p className="chart-commentary-invalidation">새 완료 봉이 있어 낮은 불투명도로 이전 자산을 표시합니다.</p>}
      </section>
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
  return {
    ascending_triangle: "상승 삼각형",
    descending_triangle: "하락 삼각형",
    symmetrical_triangle: "대칭 삼각형",
    bullish_flag: "상승 깃발형",
    bearish_flag: "하락 깃발형",
    bullish_pennant: "상승 페넌트",
    bearish_pennant: "하락 페넌트",
    bullish_rectangle: "상승 직사각형",
    bearish_rectangle: "하락 직사각형",
    rising_wedge: "상승 쐐기",
    falling_wedge: "하락 쐐기",
    descending_channel_breakout: "하락 채널 상단 돌파",
    ascending_channel_breakdown: "상승 채널 하단 이탈"
  }[kind] ?? kind;
}

function formatValue(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function crossName(direction: "golden" | "dead" | null | undefined): string {
  return direction === "golden" ? "골든크로스" : direction === "dead" ? "데드크로스" : "교차 없음";
}
