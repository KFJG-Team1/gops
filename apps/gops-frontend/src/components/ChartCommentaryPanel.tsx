import { useEffect, useState } from "react";
import {
  fetchAnalysisAssets,
  subscribeAnalysisAssetsInvalidation,
  type AnalysisAssetInterval
} from "../chart/analysisAssetsApi";
import {
  analysisAssetPresentationDiagnostics,
  formatAnalysisAssetAsOf
} from "../chart/analysisAssetPresentation";
import type { CandleDto, ChartInterval } from "../chart/types";
import { GlossaryText } from "../glossary/GlossaryText";

type CommentaryPanelState = "base" | "enriching" | "enriched";

type ChartCommentaryPanelProps = {
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
};

export function ChartCommentaryPanel({ symbol, interval, candles, drawingIds }: ChartCommentaryPanelProps) {
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof fetchAnalysisAssets>> | null>(null);
  const [assetsRevision, setAssetsRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [panelState] = useState<CommentaryPanelState>("base");
  const normalizedSymbol = symbol.trim().toUpperCase();

  useEffect(() => subscribeAnalysisAssetsInvalidation((invalidatedSymbol) => {
    if (!invalidatedSymbol || invalidatedSymbol === normalizedSymbol) {
      setAssets(null);
      setAssetsRevision((current) => current + 1);
    }
  }), [normalizedSymbol]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAssets((current) => current?.symbol === normalizedSymbol ? current : null);
    fetchAnalysisAssets(normalizedSymbol)
      .then((response) => {
        if (active) {
          setAssets(response);
        }
      })
      .catch(() => {
        if (active) {
          setAssets(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [assetsRevision, normalizedSymbol]);

  if (!isAnalysisAssetInterval(interval)) {
    return <CommentaryEmpty text="일/주/월봉에서 제공됩니다" />;
  }
  const asset = assets?.assets[interval] ?? null;
  if (loading && !assets) {
    return <CommentaryEmpty text="분석 자산을 불러오는 중입니다" loading />;
  }
  if (!asset) {
    return <CommentaryEmpty text="분석 자산이 준비되지 않았습니다" />;
  }

  const presentation = analysisAssetPresentationDiagnostics(asset, candles, drawingIds);
  const resolvedAsset = presentation.resolvedAsset;
  const stale = presentation.stale;
  const appliedDrawingIds = new Set(presentation.appliedDrawingIds);
  const focusItems = (resolvedAsset.commentary.focusItems ?? []).flatMap((item) => {
    return item.drawingIds.length > 0 && item.drawingIds.every((drawingId) => appliedDrawingIds.has(drawingId))
      ? [item]
      : [];
  });
  const keyLevels = (resolvedAsset.commentary.keyLevelsV2 ?? []).filter((level) => (
    typeof level.drawingId === "string" && appliedDrawingIds.has(level.drawingId)
  ));
  const legacyKeyLevels = resolvedAsset.assetVersion === "v1" && !stale
    ? resolvedAsset.commentary.keyLevels
    : [];
  const stateNotice = commentaryStateNotice(presentation.state);
  const presentationBlocked = presentation.state === "stale_asset"
    || presentation.state === "presentation_rejected";
  const headline = stateNotice ?? resolvedAsset.commentary.headline;
  const displayedConfidence = presentation.state === "ready"
    ? resolvedAsset.commentary.confidence
    : 0;
  const invalidation = commentaryStateInvalidation(presentation.state)
    ?? focusItems[0]?.invalidation
    ?? resolvedAsset.commentary.invalidation;
  const focusDrawing = (drawingIds: string[]) => {
    window.dispatchEvent(new CustomEvent("gops:chart-asset-focus", {
      detail: { symbol: normalizedSymbol, interval, drawingIds }
    }));
  };
  return (
    <article className="chart-commentary-panel" data-enrichment-state={panelState}>
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{interval}</span>
        <span className={stale ? "is-stale" : ""}>분석 기준 {formatAnalysisAssetAsOf(resolvedAsset.asOf)}</span>
        <span className="chart-commentary-confidence">
          <span className={`bottom-chat-confidence-dot ${confidenceTone(displayedConfidence)}`} aria-hidden="true" />
          신뢰도 {Math.round(displayedConfidence * 100)}%
        </span>
        {resolvedAsset.status === "degraded" && <span className="chart-commentary-badge is-muted">자동 생성(축약)</span>}
        {stale && <span className="chart-commentary-badge is-stale">분석 자산 갱신 필요</span>}
      </header>
      {headline && <h3 className="chart-commentary-headline"><GlossaryText text={headline} /></h3>}
      {!presentationBlocked && resolvedAsset.commentary.regimeSummary && <p className="chart-commentary-text"><GlossaryText text={resolvedAsset.commentary.regimeSummary} /></p>}
      {!presentationBlocked && focusItems.length > 0 && (
        <section className="chart-commentary-focus" aria-label="주요 관찰">
          <h3>주요 관찰</h3>
          <ol>{focusItems.map((item, index) => (
            <li key={`${item.candidateId ?? index}-${item.drawingIds.join("-")}`}>
              <button type="button" onClick={() => focusDrawing(item.drawingIds)} disabled={!item.drawingIds.length}>
                <strong><GlossaryText text={item.whatItShows} /></strong>
                <span><GlossaryText text={item.whyItMatters} /></span>
                <span><GlossaryText text={item.whatToWatch} /></span>
              </button>
            </li>
          ))}</ol>
        </section>
      )}
      {!presentationBlocked && !focusItems.length && !stateNotice && <p className="chart-commentary-text"><GlossaryText text={resolvedAsset.commentary.text} /></p>}
      {!presentationBlocked && <section className="chart-commentary-levels" aria-label="핵심 레벨">
        <h3>핵심 레벨</h3>
        {keyLevels.length ? (
          <ul>
            {keyLevels.map((level) => (
              <li key={`${level.drawingId}-${level.role}-${level.price}`}><GlossaryText text={`${levelRoleLabel(level.role)} ${level.price.toFixed(2)} · ${level.reason}`} /></li>
            ))}
          </ul>
        ) : legacyKeyLevels.length ? (
          <ul>
            {legacyKeyLevels.map((level, index) => (
              <li key={`${index}-${level}`}><GlossaryText text={level} /></li>
            ))}
          </ul>
        ) : (
          <p>확인된 핵심 레벨이 없습니다</p>
        )}
      </section>}
      <p className="chart-commentary-invalidation">
        <span aria-hidden="true">⚠</span>
        <GlossaryText text={`무효화: ${invalidation}`} />
      </p>
    </article>
  );
}

function CommentaryEmpty({ text, loading = false }: { text: string; loading?: boolean }) {
  return (
    <div className="chart-commentary-empty" role="status">
      {loading && <span className="chart-commentary-spinner" aria-hidden="true" />}
      <span>{text}</span>
    </div>
  );
}

function isAnalysisAssetInterval(interval: ChartInterval): interval is AnalysisAssetInterval {
  return interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h" || interval === "1D" || interval === "1W" || interval === "1M";
}

function confidenceTone(value: number): "high" | "medium" | "low" {
  return value >= 0.7 ? "high" : value >= 0.4 ? "medium" : "low";
}

function commentaryStateNotice(state: ReturnType<typeof analysisAssetPresentationDiagnostics>["state"]): string | null {
  if (state === "presentation_rejected") return "저장된 작도 일부 또는 전체가 현재 차트에 적용되지 않아 해설에서 제외했습니다.";
  if (state === "stale_asset") return "새 완료 봉이 추가되어 저장된 작도를 현재 차트에 적용하지 않았습니다.";
  return null;
}

function commentaryStateInvalidation(state: ReturnType<typeof analysisAssetPresentationDiagnostics>["state"]): string | null {
  if (state === "stale_asset") return "자산을 갱신한 뒤 새 구조를 다시 평가하세요.";
  if (state === "presentation_rejected") return "canonical 봉 연결을 복구한 뒤 적용된 구조만 다시 평가하세요.";
  return null;
}

function levelRoleLabel(role: string): string {
  return role === "support" ? "지지" : role === "resistance" ? "저항" : role;
}
