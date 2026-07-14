import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import { chartSemanticLabel } from "./chartSemanticCatalog";
import type { ActiveTradePlan } from "./tradePlanStore";

export type ChartCommentaryStep = {
  id: "evidence" | "entry" | "target" | "stop" | "summary" | "exit" | "observe";
  title: string;
  body: string;
  drawingIds: string[];
};

export function buildChartCommentaryModel(
  asset: ChartAnalysisAsset,
  activePlan: ActiveTradePlan | null
): ChartCommentaryStep[] {
  const evidenceIds = evidenceDrawingIds(asset);
  const primaryPattern = asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle;
  const levelSummary = `지지선 ${asset.geometry.supports.length}개와 저항선 ${asset.geometry.resistances.length}개`;
  const evidenceBody = primaryPattern
    ? `${chartSemanticLabel("patterns", primaryPattern.kind)} ${chartSemanticLabel("states", primaryPattern.state)}을 근거로 ${levelSummary}를 함께 관찰합니다.`
    : `${levelSummary}를 현재 구조의 근거로 관찰합니다.`;
  const steps: ChartCommentaryStep[] = [{ id: "evidence", title: "근거", body: evidenceBody, drawingIds: evidenceIds }];

  if (activePlan) {
    const planIds = [activePlan.drawingIds.signal, activePlan.drawingIds.plan];
    steps.push(
      {
        id: "entry",
        title: "진입",
        body: `돌파 기준 ${formatPrice(activePlan.entryTrigger)} 확인 뒤 진입가 ${formatPrice(activePlan.entryPrice)}를 검토합니다.`,
        drawingIds: planIds
      },
      {
        id: "target",
        title: "목표",
        body: `목표가 ${formatPrice(activePlan.targetPrice)}는 진입가 대비 ${formatSignedPercent(activePlan.targetPrice, activePlan.entryPrice)} 구간입니다.`,
        drawingIds: [activePlan.drawingIds.plan]
      },
      {
        id: "stop",
        title: "손절",
        body: `손절 ${formatPrice(activePlan.stopPrice)}는 진입가 대비 ${formatSignedPercent(activePlan.stopPrice, activePlan.entryPrice)}이며 시나리오 무효화 조건입니다.`,
        drawingIds: [activePlan.drawingIds.plan]
      },
      {
        id: "summary",
        title: "요약",
        body: `${chartSemanticLabel("actions", activePlan.action)}이며 손익비는 1 : ${activePlan.rewardRiskRatio.toFixed(2)}입니다.`,
        drawingIds: planIds
      }
    );
    return steps;
  }

  const scenario = asset.geometry.tradePlan;
  if (scenario?.action === "sell_candidate" && scenario.direction === "exit_long") {
    steps.push({
      id: "exit",
      title: "청산 후보",
      body: `${chartSemanticLabel("actions", scenario.action)}입니다. ${scenario.reasons.map((reason) => chartSemanticLabel("reasons", reason)).join(" · ")}`,
      drawingIds: asset.geometry.drawings.filter((drawing) => drawing.id.startsWith("chart-plan:")).map((drawing) => drawing.id)
    });
  } else {
    steps.push({
      id: "observe",
      title: "관찰",
      body: `진입 조건 미충족 상태입니다. ${scenario?.reasons.map((reason) => chartSemanticLabel("reasons", reason)).join(" · ") || "확인 조건이 생길 때까지 관찰합니다."}`,
      drawingIds: evidenceIds
    });
  }
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
