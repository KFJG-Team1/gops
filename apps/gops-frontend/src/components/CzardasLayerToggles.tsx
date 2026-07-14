import { Minus, TrendingUp } from "lucide-react";
import type { CzardasLayerKey, CzardasLayerVisibility } from "../chart/czardasLayerController";

export function CzardasLayerToggles({
  visibility, disabled, asOf, stale = false, onToggle
}: {
  visibility: CzardasLayerVisibility;
  disabled: Record<CzardasLayerKey, boolean>;
  asOf?: string;
  stale?: boolean;
  onToggle: (layer: CzardasLayerKey) => void;
}) {
  return (
    <div className="chart-analysis-layer-controls" aria-label="Czardas 작도 레이어">
      <div className="chart-analysis-layer-buttons">
        <button
          type="button"
          className={visibility.hline && !disabled.hline ? "is-active" : ""}
          aria-label={`Czardas H-Line ${visibility.hline ? "끄기" : "켜기"}`}
          aria-pressed={visibility.hline}
          disabled={disabled.hline}
          title={disabled.hline ? "H-Line 제안 없음" : "Czardas H-Line"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggle("hline")}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={visibility.trend && !disabled.trend ? "is-active" : ""}
          aria-label={`Czardas Trend ${visibility.trend ? "끄기" : "켜기"}`}
          aria-pressed={visibility.trend}
          disabled={disabled.trend}
          title={disabled.trend ? "Trend 제안 없음" : "Czardas Trend"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggle("trend")}
        >
          <TrendingUp size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="czardas-sight-legend" aria-label="Czardas 시각 범례">
        <span title="확대 상태의 캔들 진하기">
          <b className="is-candle-tone" aria-hidden="true">▮</b> Shared+<i className={!visibility.trend ? "is-muted" : undefined}>Trend</i>
        </span>
        <span title="확대 상태의 고점·저점 국소 수평 흔적">
          <b className="is-yellow-tone" aria-hidden="true">━</b> Shared+<i className={!visibility.hline ? "is-muted" : undefined}>H-Line</i>
        </span>
        <span title="축소 상태에서 켜진 채널의 전체 의미">
          <b className="is-yellow-tone" aria-hidden="true">│</b> 전체(축소)
        </span>
      </div>
      {asOf && <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>분석 기준 {formatAsOf(asOf)}{stale ? " · stale" : ""}</span>}
    </div>
  );
}

function formatAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}
