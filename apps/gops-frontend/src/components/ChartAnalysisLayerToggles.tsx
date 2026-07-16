import { ChartNoAxesCombined, Goal } from "lucide-react";
import type { ReactNode } from "react";
import { formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import type { AnalysisLayerKey, AnalysisLayerVisibility } from "../chart/analysisLayerController";

export function ChartAnalysisLayerToggles({
  visibility, disabled, asOf, stale = false, onToggle
}: {
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  asOf?: string;
  stale?: boolean;
  onToggle: (layer: AnalysisLayerKey) => void;
}) {
  return (
    <div className="chart-analysis-layer-controls" aria-label="차트 분석 레이어">
      <div className="chart-analysis-layer-buttons">
        <LayerButton layer="evidence" label="작도" icon={<ChartNoAxesCombined size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="proposal" label="제안" icon={<Goal size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
      </div>
      {asOf && <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>분석 기준 {formatAnalysisAssetAsOf(asOf)}{stale ? " · stale" : ""}</span>}
    </div>
  );
}

function LayerButton({ layer, label, icon, visibility, disabled, onToggle }: {
  layer: AnalysisLayerKey;
  label: string;
  icon: ReactNode;
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  onToggle: (layer: AnalysisLayerKey) => void;
}) {
  return <button
    type="button"
    className={visibility[layer] && !disabled[layer] ? "is-active" : ""}
    aria-label={`${label} 분석 레이어 ${visibility[layer] ? "끄기" : "켜기"}`}
    aria-pressed={visibility[layer]}
    disabled={disabled[layer]}
    title={disabled[layer] ? `${label} 자산 없음` : `${label} 분석 레이어`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={() => onToggle(layer)}
  >
    {icon}<span>{label}</span>
  </button>;
}
