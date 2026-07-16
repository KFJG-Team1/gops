import type {
  ChartAnalysisAsset,
  GeometryLevel,
  GeometryPattern,
  GeometryTraceCandidate,
  GeometryTrend
} from "./analysisAssetsApi";
import { analysisLayerOfDrawing } from "./analysisLayerController";
import { chartSemanticLabel } from "./chartSemanticCatalog";
import type { ChartTradeSetup } from "./chartTradeSetup";

export type ChartCommentaryMetricCard = {
  id: string;
  title: string;
  items: Array<{ label: string; value: string }>;
};

export type ChartCommentaryStep = {
  id: "levels" | "trend" | "pattern" | "entry" | "target" | "stop" | "summary" | "exit" | "observe";
  title: string;
  body: string;
  drawingIds: string[];
  candidateIds?: string[];
  evidenceRefs?: string[];
  metricCards?: ChartCommentaryMetricCard[];
  focusPrice?: number;
};

export function buildChartCommentaryModel(
  asset: ChartAnalysisAsset,
  setup: ChartTradeSetup | null
): ChartCommentaryStep[] {
  const primaryPattern = asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle;
  const primaryTrend = asset.geometry.primaryTrend ?? asset.geometry.trends?.[0] ?? null;
  const trace = asset.geometry.analysisTrace;
  const levelCandidates = selectedCandidates(
    trace?.levelCandidates ?? [], trace?.selections.levelCandidateIds ?? []
  );
  const trendCandidates = selectedCandidates(
    trace?.trendCandidates ?? [], trace?.selections.trendCandidateIds ?? []
  );
  const patternCandidates = selectedCandidates(
    trace?.patternCandidates ?? [], trace?.selections.patternCandidateIds ?? []
  );
  const levelCount = asset.geometry.supports.length + asset.geometry.resistances.length;
  const evidenceIds = allEvidenceDrawingIds(asset);
  const steps: ChartCommentaryStep[] = [
    {
      id: "levels",
      title: "지지·저항",
      body: levelCount
        ? `지지선 ${asset.geometry.supports.length}개와 저항선 ${asset.geometry.resistances.length}개를 관찰합니다.`
        : "적격 지지·저항 없음",
      drawingIds: drawingIdsForGroup(asset, "levels"),
      candidateIds: levelCandidates.map((candidate) => candidate.id),
      evidenceRefs: candidateEvidenceRefs(levelCandidates),
      metricCards: [...asset.geometry.supports, ...asset.geometry.resistances].map(levelMetricCard)
    },
    {
      id: "trend",
      title: "추세",
      body: primaryTrend
        ? `${trendLabel(primaryTrend)}을 전반 추세 근거로 관찰합니다.`
        : "적격 대각 추세 없음",
      drawingIds: drawingIdsForGroup(asset, "trend"),
      candidateIds: trendCandidates.map((candidate) => candidate.id),
      evidenceRefs: candidateEvidenceRefs(trendCandidates),
      metricCards: primaryTrend ? [trendMetricCard(primaryTrend)] : []
    },
    {
      id: "pattern",
      title: "패턴",
      body: primaryPattern
        ? `${chartSemanticLabel("patterns", primaryPattern.kind)} ${chartSemanticLabel("states", primaryPattern.state)}을 관찰합니다.`
        : "적격 패턴 없음",
      drawingIds: drawingIdsForGroup(asset, "pattern"),
      candidateIds: patternCandidates.map((candidate) => candidate.id),
      evidenceRefs: candidateEvidenceRefs(patternCandidates),
      metricCards: primaryPattern ? [patternMetricCard(primaryPattern, selectedCandidate(patternCandidates))] : []
    }
  ];

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
        body: `${isBuy ? "손절가" : "매도 무효화가"} ${formatPrice(setup.stopPrice)}는 기준가 대비 ${formatSignedPercent(setup.stopPrice, setup.entryPrice)}입니다. 이 기준을 벗어나면 ${isBuy ? "매수" : "매도"} 관점을 다시 검토합니다.`,
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

function drawingIdsForGroup(asset: ChartAnalysisAsset, group: "levels" | "trend" | "pattern"): string[] {
  return asset.geometry.drawings
    .filter((drawing) => analysisLayerOfDrawing(drawing, asset) === group)
    .map((drawing) => drawing.id);
}

function allEvidenceDrawingIds(asset: ChartAnalysisAsset): string[] {
  return ["levels", "trend", "pattern"].flatMap((group) => drawingIdsForGroup(asset, group as "levels" | "trend" | "pattern"));
}

function candidateEvidenceRefs(candidates: GeometryTraceCandidate[]): string[] {
  return [...new Set(candidates.flatMap((candidate) => [
    ...(candidate.evidenceRefs ?? []),
    ...(candidate.pivotIds ?? []),
    ...(candidate.anchorPivotIds ?? []),
    ...(candidate.touchRefs ?? []),
    ...(candidate.touchPivotIds ?? []),
    ...(candidate.reactionRefs ?? []),
    ...(candidate.reactionPivotIds ?? [])
  ]))];
}

function selectedCandidate(candidates: GeometryTraceCandidate[]): GeometryTraceCandidate | undefined {
  return candidates.find((candidate) => candidate.selected) ?? candidates.find((candidate) => candidate.hardPass);
}

function selectedCandidates(candidates: GeometryTraceCandidate[], selectionIds: string[]): GeometryTraceCandidate[] {
  const selectedIds = new Set(selectionIds);
  const selected = candidates.filter((candidate) => selectedIds.has(candidate.id) || candidate.selected === true);
  return selected.length ? selected : candidates.filter((candidate) => candidate.hardPass).slice(0, 1);
}

function levelMetricCard(level: GeometryLevel): ChartCommentaryMetricCard {
  return {
    id: level.id,
    title: `${level.role === "support" ? "지지" : "저항"} ${formatMetricValue(level.price)}`,
    items: definedMetrics([
      ["가격", level.price],
      ["위계", level.importanceTier],
      ["순위", level.importanceRank],
      ["선택 단계", level.selectionTier],
      ["접촉", level.touches],
      ["반응", level.reactionCount],
      ["최근 접촉 경과", level.lastTouchAgeBars],
      ["현재 거리(ATR)", level.currentDistanceAtr],
      ["점수", level.score]
    ])
  };
}

function trendMetricCard(trend: GeometryTrend): ChartCommentaryMetricCard {
  return {
    id: trend.id,
    title: trendLabel(trend),
    items: definedMetrics([
      ["방향", trend.direction],
      ["점수", trend.score],
      ["접촉", trend.touchCount],
      ["반응", trend.reactionCount],
      ["기울기(ATR/bar)", trend.slopeAtrPerBar],
      ["중앙 잔차(ATR)", trend.medianResidualAtr],
      ["현재 거리(ATR)", trend.currentDistanceAtr],
      ["최근 접촉 경과", trend.lastTouchAgeBars],
      ["채널 폭(ATR)", trend.channelWidthAtr],
      ["평행 오차", trend.parallelSlopeError],
      ["포함률", trend.containment],
      ["활성 무효화", trend.activeInvalidation],
      ["위반 횟수", trend.violationCount],
      ["무효화", trend.invalidation]
    ])
  };
}

function patternMetricCard(pattern: GeometryPattern, candidate?: GeometryTraceCandidate): ChartCommentaryMetricCard {
  const metrics = candidate?.metrics ?? pattern.metrics ?? {};
  return {
    id: pattern.geometryHash,
    title: chartSemanticLabel("patterns", pattern.kind),
    items: definedMetrics([
      ["상태", chartSemanticLabel("states", pattern.state)],
      ["점수", pattern.score],
      ["접촉", pattern.touches],
      ["상단 접촉", metrics.upperTouches],
      ["하단 접촉", metrics.lowerTouches],
      ["포함률", metrics.containment],
      ["잔차(ATR)", metrics.maxResidualAtr ?? metrics.residualAtr ?? metrics.medianResidualAtr],
      ["수렴률", metrics.convergenceRatio ?? metrics.convergence],
      ["평행 오차", metrics.parallelSlopeErrorAtr ?? metrics.parallelSlopeError],
      ["돌파 침투(ATR)", metrics.penetrationAtr ?? pattern.confirmation?.penetrationAtr],
      ["상대 거래량", metrics.relativeVolume ?? pattern.confirmation?.relativeVolume]
    ])
  };
}

function trendLabel(trend: GeometryTrend): string {
  if (trend.kind === "channel") return trend.direction === "down" ? "하락 평행 채널" : "상승 평행 채널";
  return trend.direction === "down" ? "하락 추세선" : "상승 추세선";
}

function definedMetrics(items: Array<[string, unknown]>): Array<{ label: string; value: string }> {
  return items.flatMap(([label, value]) => value === undefined || value === null || value === ""
    ? []
    : [{ label, value: formatMetricValue(value) }]);
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return String(value);
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

function formatSignedPercent(value: number, base: number): string {
  const percent = ((value - base) / Math.max(0.0000001, Math.abs(base))) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}
