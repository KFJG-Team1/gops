import { ChartNoAxesCombined, Minus, TrendingUp } from "lucide-react";
import type { AnalysisEngine } from "../chart/analysisEngine";
import { formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import type { AnalysisLayerKey, AnalysisLayerVisibility } from "../chart/analysisLayerController";
import type { CzardasLayerKey, CzardasLayerVisibility } from "../chart/czardasLayerController";

export function ChartAnalysisLayerToggles({
  engine, visibility, disabled, asOf, stale = false, onToggle
}: {
  engine: AnalysisEngine;
  visibility: AnalysisLayerVisibility & CzardasLayerVisibility;
  disabled: Record<AnalysisLayerKey | CzardasLayerKey, boolean>;
  asOf?: string;
  stale?: boolean;
  onToggle: (layer: AnalysisLayerKey | CzardasLayerKey) => void;
}) {
  if (engine === "off") return null;
  return (
    <div className="chart-analysis-layer-controls" aria-label="차트 분석 레이어">
      <div className="chart-analysis-layer-buttons">
        {engine === "geometry" ? (
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
        ) : (
          <>
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
          </>
        )}
      </div>
      {asOf && <span className={`chart-analysis-asof ${stale ? "is-stale" : ""}`}>분석 기준 {formatAnalysisAssetAsOf(asOf)}{stale ? " · stale" : ""}</span>}
    </div>
  );
}
