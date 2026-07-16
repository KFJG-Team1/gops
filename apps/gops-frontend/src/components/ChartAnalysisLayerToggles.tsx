import { BrainCircuit, ChartNoAxesCombined, Goal, Minus, TrendingUp } from "lucide-react";
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
        <LayerButton layer="interpretation" label="해석" icon={<BrainCircuit size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="levels" label="저항" accessibleLabel="지지·저항" icon={<Minus size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="trend" label="추세" icon={<TrendingUp size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="pattern" label="패턴" icon={<ChartNoAxesCombined size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="proposal" label="제안" icon={<Goal size={14} aria-hidden="true" />} visibility={visibility} disabled={disabled} onToggle={onToggle} />
      </div>
      {asOf && <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>분석 기준 {formatAnalysisAssetAsOf(asOf)}{stale ? " · stale" : ""}</span>}
    </div>
  );
}

function LayerButton({ layer, label, accessibleLabel = label, icon, visibility, disabled, onToggle }: {
  layer: AnalysisLayerKey;
  label: string;
  accessibleLabel?: string;
  icon: ReactNode;
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  onToggle: (layer: AnalysisLayerKey) => void;
}) {
  return <button
    type="button"
    className={visibility[layer] && !disabled[layer] ? "is-active" : ""}
    aria-label={`${accessibleLabel} 분석 레이어 ${visibility[layer] ? "끄기" : "켜기"}`}
    aria-pressed={visibility[layer]}
    disabled={disabled[layer]}
    title={disabled[layer] ? `${accessibleLabel} 자산 없음` : `${accessibleLabel} 분석 레이어`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={() => onToggle(layer)}
  >
    {icon}<span>{label}</span>
  </button>;
}
