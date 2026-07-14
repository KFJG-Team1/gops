import { ChartNoAxesCombined, Route } from "lucide-react";
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
        <button
          type="button"
          className={visibility.geometry && !disabled.geometry ? "is-active" : ""}
          aria-label={`Geometry 분석 레이어 ${visibility.geometry ? "끄기" : "켜기"}`}
          aria-pressed={visibility.geometry}
          disabled={disabled.geometry}
          title={disabled.geometry ? "작도 자산 없음" : "Geometry 분석 레이어"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggle("geometry")}
        >
          <ChartNoAxesCombined size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={visibility.scenario && !disabled.scenario ? "is-active is-scenario" : ""}
          aria-label={`시나리오 분석 레이어 ${visibility.scenario ? "끄기" : "켜기"}`}
          aria-pressed={visibility.scenario}
          disabled={disabled.scenario}
          title={disabled.scenario ? "대응 시나리오 없음" : "작도 대응 시나리오"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggle("scenario")}
        >
          <Route size={14} aria-hidden="true" />
        </button>
      </div>
      {asOf && <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>분석 기준 {formatAnalysisAssetAsOf(asOf)}{stale ? " · stale" : ""}</span>}
    </div>
  );
}
