import { Bot, ChartNoAxesCombined, TrendingUp } from "lucide-react";
import type { AnalysisLayerKey, AnalysisLayerVisibility } from "../chart/analysisLayerController";

type ChartAnalysisLayerTogglesProps = {
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  asOf?: string;
  stale?: boolean;
  onToggle: (layer: AnalysisLayerKey) => void;
};

const toggles = [
  { layer: "structure" as const, label: "S/R", Icon: ChartNoAxesCombined },
  { layer: "trend" as const, label: "추세", Icon: TrendingUp },
  { layer: "agent" as const, label: "AI", Icon: Bot }
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
            <Icon size={12} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {asOf && (
        <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>
          분석 기준 {formatAsOf(asOf)}
        </span>
      )}
    </div>
  );
}

function formatAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}
