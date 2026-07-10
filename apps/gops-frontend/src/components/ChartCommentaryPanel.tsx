import { useEffect, useState } from "react";
import {
  fetchAnalysisAssets,
  type AnalysisAssetInterval,
  type ChartAnalysisAsset
} from "../chart/analysisAssetsApi";
import type { CandleDto, ChartInterval } from "../chart/types";
import { GlossaryText } from "../glossary/GlossaryText";

type CommentaryPanelState = "base" | "enriching" | "enriched";

type ChartCommentaryPanelProps = {
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
};

export function ChartCommentaryPanel({ symbol, interval, candles }: ChartCommentaryPanelProps) {
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof fetchAnalysisAssets>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelState] = useState<CommentaryPanelState>("base");
  const normalizedSymbol = symbol.trim().toUpperCase();

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
  }, [normalizedSymbol]);

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

  const stale = isAssetStale(asset, candles);
  return (
    <article className="chart-commentary-panel" data-enrichment-state={panelState}>
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{interval}</span>
        <span className={stale ? "is-stale" : ""}>분석 기준 {formatAsOf(asset.asOf)}</span>
        <span className="chart-commentary-confidence">
          <span className={`bottom-chat-confidence-dot ${confidenceTone(asset.commentary.confidence)}`} aria-hidden="true" />
          신뢰도 {Math.round(asset.commentary.confidence * 100)}%
        </span>
        {asset.status === "degraded" && <span className="chart-commentary-badge is-muted">자동 생성(축약)</span>}
        {stale && <span className="chart-commentary-badge is-stale">오래됨</span>}
      </header>
      <p className="chart-commentary-text"><GlossaryText text={asset.commentary.text} /></p>
      <section className="chart-commentary-levels" aria-label="핵심 레벨">
        <h3>핵심 레벨</h3>
        {asset.commentary.keyLevels.length ? (
          <ul>
            {asset.commentary.keyLevels.map((level, index) => (
              <li key={`${index}-${level}`}><GlossaryText text={level} /></li>
            ))}
          </ul>
        ) : (
          <p>확인된 핵심 레벨이 없습니다</p>
        )}
      </section>
      <p className="chart-commentary-invalidation">
        <span aria-hidden="true">⚠</span>
        <GlossaryText text={`무효화: ${asset.commentary.invalidation}`} />
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
  return interval === "1D" || interval === "1W" || interval === "1M";
}

function isAssetStale(asset: ChartAnalysisAsset, candles: CandleDto[]): boolean {
  const asOf = Date.parse(asset.asOf);
  return Number.isFinite(asOf) && candles.filter((candle) => (
    candle.isClosed !== false && Date.parse(candle.timestamp) > asOf
  )).length >= 2;
}

function formatAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}

function confidenceTone(value: number): "high" | "medium" | "low" {
  return value >= 0.7 ? "high" : value >= 0.4 ? "medium" : "low";
}
