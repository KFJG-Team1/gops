import { formatAnalysisAssetAsOf, type AnalysisAssetFreshness } from "../chart/analysisAssetPresentation";
import type { AnalysisLayerKey, AnalysisLayerVisibility } from "../chart/analysisLayerController";
import type { AnalysisTraceDataMode } from "../chart/analysisTraceOverlay";

export function ChartAnalysisLayerToggles({
  visibility, disabled, asOf, freshness = null, interpretationMode = "none", candidateCounts, loadError = null, onToggle
}: {
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  asOf?: string;
  freshness?: AnalysisAssetFreshness | null;
  interpretationMode?: AnalysisTraceDataMode;
  candidateCounts?: { total: number; visible: number; stored: number } | null;
  loadError?: string | null;
  onToggle: (layer: AnalysisLayerKey) => void;
}) {
  return (
    <div className="chart-analysis-layer-controls" aria-label="차트 분석 레이어">
      <div className="chart-analysis-layer-buttons">
        <LayerButton layer="interpretation" label="해석" visibility={visibility} disabled={disabled} onToggle={onToggle} interpretationMode={interpretationMode} />
        <LayerButton layer="levels" label="저항" accessibleLabel="지지·저항" visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="trend" label="추세" visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="pattern" label="패턴" visibility={visibility} disabled={disabled} onToggle={onToggle} />
        <LayerButton layer="proposal" label="제안" visibility={visibility} disabled={disabled} onToggle={onToggle} />
      </div>
      {loadError ? <span className="chart-analysis-asof is-error" role="status">{loadError}</span> : asOf && <span className={`chart-analysis-asof ${freshness?.state === "source_invalid" ? "is-stale" : freshness?.state === "outdated_snapshot" ? "is-outdated" : ""}`}>
        분석 기준 {formatAnalysisAssetAsOf(asOf)}
        {freshness?.state === "source_invalid" ? " · 데이터 불일치" : freshness?.state === "outdated_snapshot" ? ` · ${freshness.lagBars}봉 전` : ""}
        {interpretationMode === "complete" ? " · 해석 유력 후보" : interpretationMode === "bounded" ? " · 해석 일부 후보" : interpretationMode === "legacy" ? " · 해석 근거만 · 재생성 필요" : ""}
        {interpretationMode === "complete" && candidateCounts ? ` · 유력 후보 ${candidateCounts.visible}/${candidateCounts.total} · 전체 ${candidateCounts.stored}` : ""}
      </span>}
    </div>
  );
}

function LayerButton({ layer, label, accessibleLabel = label, visibility, disabled, onToggle, interpretationMode }: {
  layer: AnalysisLayerKey;
  label: string;
  accessibleLabel?: string;
  visibility: AnalysisLayerVisibility;
  disabled: Record<AnalysisLayerKey, boolean>;
  onToggle: (layer: AnalysisLayerKey) => void;
  interpretationMode?: AnalysisTraceDataMode;
}) {
  const unavailable = disabled[layer];
  const state = unavailable ? "unavailable" : visibility[layer] ? "on" : "off";
  return <button
    type="button"
    className={`is-${state}`}
    data-state={state}
    aria-label={unavailable
      ? `${accessibleLabel} 분석 레이어 사용 불가`
      : `${accessibleLabel} 분석 레이어 ${visibility[layer] ? "끄기" : "켜기"}`}
    aria-pressed={unavailable ? undefined : visibility[layer]}
    disabled={unavailable}
    title={unavailable
      ? `${accessibleLabel} 자산 없음`
      : layer === "interpretation" && interpretationMode === "complete"
        ? "유력한 미선택 작도 후보와 선택 근거"
        : layer === "interpretation" && interpretationMode === "bounded"
          ? "일부 상위 후보만 포함된 구자산"
          : layer === "interpretation" && interpretationMode === "legacy"
            ? "근거 피벗만 포함된 구자산 · 재생성 필요"
            : `${accessibleLabel} 분석 레이어`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={() => onToggle(layer)}
  >
    <span className="chart-analysis-layer-label">{label}</span>
  </button>;
}
