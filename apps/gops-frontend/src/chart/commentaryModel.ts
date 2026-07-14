import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import { chartSemanticLabel } from "./chartSemanticCatalog";
import type { ChartTradeSetup } from "./chartTradeSetup";

export type ChartCommentaryStep = {
  id: "evidence" | "entry" | "target" | "stop" | "summary" | "exit" | "observe";
  title: string;
  body: string;
  drawingIds: string[];
  focusPrice?: number;
};

export function buildChartCommentaryModel(
  asset: ChartAnalysisAsset,
  setup: ChartTradeSetup | null
): ChartCommentaryStep[] {
  const evidenceIds = evidenceDrawingIds(asset);
  const primaryPattern = asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle;
  const levelSummary = `지지선 ${asset.geometry.supports.length}개와 저항선 ${asset.geometry.resistances.length}개`;
  const evidenceBody = primaryPattern
    ? `${chartSemanticLabel("patterns", primaryPattern.kind)} ${chartSemanticLabel("states", primaryPattern.state)}을 근거로 ${levelSummary}를 함께 관찰합니다.`
    : `${levelSummary}를 현재 구조의 근거로 관찰합니다.`;
  const steps: ChartCommentaryStep[] = [{ id: "evidence", title: "근거", body: evidenceBody, drawingIds: evidenceIds }];

  if (setup) {
    const planIds = [setup.drawingIds.signal, setup.drawingIds.plan];
    const isBuy = setup.action === "buy_candidate";
    const intervalNote = setup.sourceInterval !== asset.interval ? ` 근거 주기는 ${setup.sourceInterval}입니다.` : "";
    const conditional = setup.sourceKind === "conditional" ? "조건 충족 시 " : "";
    steps.push(
      {
        id: "entry",
        title: isBuy ? "매수 기준" : "매도 기준",
        body: isBuy
          ? `${conditional}진입가 ${formatPrice(setup.entryPrice)}를 검토합니다.${intervalNote}`
          : `${conditional}매도 기준가 ${formatPrice(setup.entryPrice)}를 검토합니다.${intervalNote}`,
        drawingIds: planIds,
        focusPrice: setup.entryPrice
      },
      {
        id: "target",
        title: isBuy ? "목표" : "하락 목표",
        body: `${isBuy ? "목표가" : "하락 목표가"} ${formatPrice(setup.targetPrice)}는 기준가 대비 ${formatSignedPercent(setup.targetPrice, setup.entryPrice)} 구간입니다.`,
        drawingIds: [setup.drawingIds.plan],
        focusPrice: setup.targetPrice
      },
      {
        id: "stop",
        title: isBuy ? "손절" : "매도 무효화",
        body: `${isBuy ? "손절가" : "매도 무효화가"} ${formatPrice(setup.stopPrice)}는 기준가 대비 ${formatSignedPercent(setup.stopPrice, setup.entryPrice)}이며 시나리오 무효화 조건입니다.`,
        drawingIds: [setup.drawingIds.plan],
        focusPrice: setup.stopPrice
      },
      {
        id: "summary",
        title: "요약",
        body: `${setup.sourceKind === "conditional" ? "조건부 " : ""}${isBuy ? "매수 후보" : "매도 후보"}이며 손익비는 1 : ${setup.rewardRiskRatio.toFixed(2)}입니다.`,
        drawingIds: planIds,
        focusPrice: setup.entryPrice
      }
    );
    return steps;
  }

  const scenario = asset.geometry.tradePlan;
  steps.push({
    id: "observe",
    title: "관찰",
    body: `매수·매도 조건을 계산할 저장 근거가 부족합니다. ${scenario?.reasons.map((reason) => chartSemanticLabel("reasons", reason)).join(" · ") || "확인 조건이 생길 때까지 관찰합니다."}`,
    drawingIds: evidenceIds
  });
  return steps;
}

function evidenceDrawingIds(asset: ChartAnalysisAsset): string[] {
  const levelIds = new Set([...(asset.geometry.supports ?? []), ...(asset.geometry.resistances ?? [])].map((level) => level.id));
  const patternHash = (asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle)?.geometryHash;
  return asset.geometry.drawings
    .filter((drawing) => drawing.id.startsWith("chart-asset:") && (
      [...levelIds].some((id) => drawing.id === id || drawing.id.endsWith(`:${id}`))
      || Boolean(patternHash && drawing.id.includes(patternHash))
    ))
    .map((drawing) => drawing.id);
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

function formatSignedPercent(value: number, base: number): string {
  const percent = ((value - base) / Math.max(0.0000001, Math.abs(base))) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}
