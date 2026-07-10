import { ChartNoAxesCombined, Focus, TrendingUp } from "lucide-react";
import { formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import type { AnalysisLayerKey, AnalysisLayerVisibility } from "../chart/analysisLayerController";

type ChartAnalysisLayerTogglesProps = {
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  asOf?: string;
  stale?: boolean;
  onToggle: (layer: AnalysisLayerKey) => void;
};

const toggles = [
  { layer: "structure" as const, label: "지지·저항", Icon: ChartNoAxesCombined },
  { layer: "trend" as const, label: "추세", Icon: TrendingUp },
  { layer: "agent" as const, label: "인사이트", Icon: Focus }
];

export function ChartAnalysisLayerToggles({
  visibility,
  disabled,
  asOf,
  stale = false,
  onToggle
}: ChartAnalysisLayerTogglesProps) {
  return (
    <div className="chart-analysis-layer-controls" aria-label="차트 분석 레이어">
      <div className="chart-analysis-layer-buttons">
        {toggles.map(({ layer, label, Icon }) => (
          <button
            key={layer}
            type="button"
            className={visibility[layer] && !disabled[layer] ? "is-active" : ""}
            aria-label={`${label} 분석 레이어 ${visibility[layer] ? "끄기" : "켜기"}`}
            aria-pressed={visibility[layer]}
            disabled={disabled[layer]}
            title={disabled[layer] ? "분석 자산 없음" : `${label} 분석 레이어`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onToggle(layer)}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
      {asOf && (
        <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>
          분석 기준 {formatAnalysisAssetAsOf(asOf)}
        </span>
      )}
    </div>
  );
}
