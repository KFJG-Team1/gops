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
import { tradePlanPresentation, type TradePlanPresentation } from "./tradePlanPresentation";

export type ChartCommentaryMetricCard = {
  id: string;
  title: string;
  items: Array<{ label: string; value: string }>;
};

export type ChartCommentaryStep = {
  id: "levels" | "trend" | "pattern";
  title: string;
  body: string;
  drawingIds: string[];
  candidateIds?: string[];
  evidenceRefs?: string[];
  metricCards?: ChartCommentaryMetricCard[];
  focusPrice?: number;
};

export type ChartCommentaryHolding = {
  averagePrice?: number | null;
  quantity?: number | null;
};

export type ChartCommentaryKeyPrice = {
  id: "entry" | "target" | "invalidation";
  label: string;
  price: number;
  distancePercent: number | null;
  drawingIds: string[];
  sourceLabel?: string;
};

export type ChartCommentaryScenario = {
  action: ChartTradeSetup["action"];
  labels: TradePlanPresentation;
  status: string;
  confirmation: string;
  targetPrice: number;
  invalidationPrice: number;
  rewardRiskRatio: number;
  projectionBars: number;
  drawingIds: string[];
  targetSourceLabel: string;
  riskSourceLabel: string;
};

export type ChartCommentaryViewModel = {
  summary: string[];
  keyPrices: ChartCommentaryKeyPrice[];
  scenario: ChartCommentaryScenario | null;
  evidence: ChartCommentaryStep[];
};

export function buildChartCommentaryModel(
  asset: ChartAnalysisAsset,
  _setup: ChartTradeSetup | null
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

  return steps;
}

export function buildChartCommentaryViewModel(
  asset: ChartAnalysisAsset,
  setup: ChartTradeSetup | null,
  currentPrice: number | null,
  holding: ChartCommentaryHolding | null
): ChartCommentaryViewModel {
  const evidence = buildChartCommentaryModel(asset, setup);
  const support = nearestLevel(asset.geometry.supports, currentPrice);
  const resistance = nearestLevel(asset.geometry.resistances, currentPrice);
  const planDrawingIds = setup ? [setup.drawingIds.signal, setup.drawingIds.plan] : [];
  const keyPrices: ChartCommentaryKeyPrice[] = [];
  if (setup) {
    const labels = tradePlanPresentation(setup.action);
    keyPrices.push(
      keyPrice("entry", labels.basis, setup.entryPrice, currentPrice, setup.priceSources.entry.drawingIds, setup.priceSources.entry.label),
      keyPrice("target", labels.target, setup.targetPrice, currentPrice, setup.priceSources.target.drawingIds, setup.priceSources.target.label),
      keyPrice("invalidation", labels.risk, setup.stopPrice, currentPrice, setup.priceSources.stop.drawingIds, setup.priceSources.stop.label)
    );
  }

  const proposalFocusIds = setup ? [...new Set([
    ...planDrawingIds,
    ...setup.priceSources.entry.drawingIds,
    ...setup.priceSources.target.drawingIds,
    ...setup.priceSources.stop.drawingIds
  ])] : [];

  return {
    summary: commentarySummary(asset, setup, currentPrice, support, resistance, holding),
    keyPrices,
    scenario: setup ? {
      action: setup.action,
      labels: tradePlanPresentation(setup.action),
      status: tradePlanPresentation(setup.action).scenario,
      confirmation: `${tradePlanPresentation(setup.action).basis} ${formatPrice(setup.entryPrice)} · ${setup.priceSources.entry.label}`,
      targetPrice: setup.targetPrice,
      invalidationPrice: setup.stopPrice,
      rewardRiskRatio: setup.rewardRiskRatio,
      projectionBars: setup.projectionBars,
      drawingIds: proposalFocusIds,
      targetSourceLabel: setup.priceSources.target.label,
      riskSourceLabel: setup.priceSources.stop.label
    } : null,
    evidence
  };
}

function commentarySummary(
  asset: ChartAnalysisAsset,
  setup: ChartTradeSetup | null,
  currentPrice: number | null,
  support: GeometryLevel | null,
  resistance: GeometryLevel | null,
  holding: ChartCommentaryHolding | null
): string[] {
  const primaryPattern = asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle;
  const primaryTrend = asset.geometry.primaryTrend ?? asset.geometry.trends?.[0] ?? null;
  const sentences: string[] = [];
  if (primaryPattern) {
    sentences.push(`${asset.symbol} ${asset.interval} 차트의 주요 패턴은 ${chartSemanticLabel("patterns", primaryPattern.kind)}이며, 현재 ${chartSemanticLabel("states", primaryPattern.state)} 상태입니다.`);
  } else if (primaryTrend) {
    sentences.push(`${asset.symbol} ${asset.interval} 차트는 ${trendLabel(primaryTrend)}을 중심으로 가격 구조를 관찰하고 있습니다.`);
  } else {
    sentences.push(`${asset.symbol} ${asset.interval} 차트는 확인된 패턴이나 대각 추세 없이 지지·저항을 중심으로 관찰하고 있습니다.`);
  }
  if (currentPrice != null && (support || resistance)) {
    const levelParts = [
      support ? `지지 ${formatPrice(support.price)}` : "",
      resistance ? `저항 ${formatPrice(resistance.price)}` : ""
    ].filter(Boolean).join(", ");
    sentences.push(`현재가 ${formatPrice(currentPrice)}의 가까운 기준은 ${levelParts}입니다.`);
  }
  if (setup) {
    const labels = tradePlanPresentation(setup.action);
    sentences.push(labels.risk === "재검토"
      ? `${formatPrice(setup.entryPrice)} ${setup.priceSources.entry.label}을 ${labels.basis} 기준으로 보고, ${formatPrice(setup.stopPrice)} ${setup.priceSources.stop.label}에서 시나리오를 재검토합니다.`
      : `${formatPrice(setup.entryPrice)} ${setup.priceSources.entry.label}을 ${labels.basis} 기준으로 보고, ${formatPrice(setup.stopPrice)} ${setup.priceSources.stop.label}을 손절 기준으로 봅니다.`);
  } else {
    sentences.push("현재 적격 제안 없음 — 세 가격을 모두 설명할 최종 작도가 부족합니다.");
  }
  if (holding?.averagePrice != null && currentPrice != null) {
    sentences.push(`실계좌 평균 매입가 ${formatPrice(holding.averagePrice)} 대비 현재가는 ${formatSignedPercent(currentPrice, holding.averagePrice)} 구간입니다.`);
  }
  if (sentences.length < 2) {
    sentences.push(currentPrice != null
      ? `현재가는 ${formatPrice(currentPrice)}이며, 비교할 지지·저항이나 트레이드 시나리오는 저장되어 있지 않습니다.`
      : "저장된 주요 가격이나 트레이드 시나리오가 없어 추가 조건을 제시하지 않습니다.");
  }
  return sentences.slice(0, 4);
}

function nearestLevel(levels: GeometryLevel[], currentPrice: number | null): GeometryLevel | null {
  const valid = levels.filter((level) => Number.isFinite(level.price) && level.price > 0);
  if (valid.length === 0) return null;
  if (currentPrice == null) return valid[0] ?? null;
  return [...valid].sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice))[0] ?? null;
}

function keyPrice(
  id: ChartCommentaryKeyPrice["id"],
  label: string,
  price: number,
  currentPrice: number | null,
  drawingIds: string[],
  sourceLabel?: string
): ChartCommentaryKeyPrice {
  return {
    id,
    label,
    price,
    distancePercent: currentPrice == null ? null : ((price - currentPrice) / Math.max(0.0000001, Math.abs(currentPrice))) * 100,
    drawingIds,
    ...(sourceLabel ? { sourceLabel } : {})
  };
}

function drawingIdsForGroup(asset: ChartAnalysisAsset, group: "levels" | "trend" | "pattern"): string[] {
  return asset.geometry.drawings
    .filter((drawing) => analysisLayerOfDrawing(drawing, asset) === group)
    .map((drawing) => drawing.id);
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
