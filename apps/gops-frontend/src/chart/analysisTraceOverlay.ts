import type {
  ChartAnalysisAsset,
  GeometryAnchor,
  GeometryTraceCandidate,
  GeometryTracePivot
} from "./analysisAssetsApi";

export type AnalysisTraceOverlayCandidate = GeometryTraceCandidate & {
  category: "levels" | "trend" | "pattern";
  anchors: GeometryAnchor[];
  anchorPivotIds: string[];
  touchPivotIds: string[];
  reactionPivotIds: string[];
};

export type AnalysisTraceOverlay = {
  candidates: AnalysisTraceOverlayCandidate[];
  pivots: GeometryTracePivot[];
  focused: boolean;
};

export function buildAnalysisTraceOverlay(
  asset: ChartAnalysisAsset | null,
  options: {
    visible: boolean;
    candidateIds?: readonly string[];
    evidenceRefs?: readonly string[];
  }
): AnalysisTraceOverlay | null {
  if (!asset) return null;
  const candidateFilter = new Set(options.candidateIds ?? []);
  const evidenceFilter = new Set(options.evidenceRefs ?? []);
  const focused = candidateFilter.size > 0 || evidenceFilter.size > 0;
  if (!options.visible && !focused) return null;

  const trace = asset.geometry.analysisTrace;
  if (!trace) {
    const pivots = legacyPivots(asset).filter((pivot) => !focused || evidenceFilter.has(pivot.id));
    return pivots.length ? { candidates: [], pivots, focused } : null;
  }

  const selectionIds = new Set([
    ...(trace.selections?.levelCandidateIds ?? []),
    ...(trace.selections?.trendCandidateIds ?? []),
    ...(trace.selections?.patternCandidateIds ?? [])
  ]);
  const candidates = [
    ...trace.levelCandidates.map((candidate) => normalizeCandidate(candidate, "levels", selectionIds)),
    ...trace.trendCandidates.map((candidate) => normalizeCandidate(candidate, "trend", selectionIds)),
    ...trace.patternCandidates.map((candidate) => normalizeCandidate(candidate, "pattern", selectionIds))
  ].filter((candidate) => !focused || candidateFilter.has(candidate.id));
  const referencedPivotIds = new Set(evidenceFilter);
  candidates.forEach((candidate) => {
    candidate.anchorPivotIds.forEach((id) => referencedPivotIds.add(id));
    candidate.touchPivotIds.forEach((id) => referencedPivotIds.add(id));
    candidate.reactionPivotIds.forEach((id) => referencedPivotIds.add(id));
  });
  const tracePivots = trace.pivots.filter((pivot) => !focused || referencedPivotIds.has(pivot.id));
  const touchPivots = candidates.flatMap((candidate) => (candidate.touches ?? []).map((touch) => ({
    id: touch.id,
    timestamp: touch.timestamp,
    price: touch.price,
    ...(typeof touch.outcome === "string" ? { outcome: touch.outcome } : {})
  })));
  const pivots = [...new Map([...tracePivots, ...touchPivots].map((pivot) => [pivot.id, pivot])).values()];
  return candidates.length || pivots.length ? { candidates, pivots, focused } : null;
}

function normalizeCandidate(
  candidate: GeometryTraceCandidate,
  category: AnalysisTraceOverlayCandidate["category"],
  selectionIds: ReadonlySet<string>
): AnalysisTraceOverlayCandidate {
  return {
    ...candidate,
    category,
    selected: candidate.selected === true || selectionIds.has(candidate.id),
    anchors: validAnchors(candidate.anchors),
    anchorPivotIds: uniqueStrings(
      candidate.anchorPivotIds?.length ? candidate.anchorPivotIds
        : candidate.pivotIds?.length ? candidate.pivotIds
          : candidate.evidenceRefs
    ),
    touchPivotIds: uniqueStrings([...(candidate.touchPivotIds ?? []), ...(candidate.touchRefs ?? [])]),
    reactionPivotIds: uniqueStrings([...(candidate.reactionPivotIds ?? []), ...(candidate.reactionRefs ?? [])]),
    touches: validTouches(candidate.touches)
  };
}

function validAnchors(value: unknown): GeometryAnchor[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is GeometryAnchor => Boolean(
    item && typeof item === "object"
    && typeof (item as GeometryAnchor).timestamp === "string"
    && Number.isFinite((item as GeometryAnchor).price)
  ));
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : [];
}

function validTouches(value: unknown): NonNullable<GeometryTraceCandidate["touches"]> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NonNullable<GeometryTraceCandidate["touches"]>[number] => Boolean(
    item && typeof item === "object"
    && typeof item.id === "string"
    && typeof item.timestamp === "string"
    && typeof item.price === "number" && Number.isFinite(item.price)
  ));
}

function legacyPivots(asset: ChartAnalysisAsset): GeometryTracePivot[] {
  return (asset.geometry.evidence ?? []).flatMap((item) => {
    const id = typeof item.id === "string" ? item.id : null;
    const timestamp = typeof item.timestamp === "string" ? item.timestamp : null;
    const price = typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null;
    if (!id || !timestamp || price === null) return [];
    return [{
      id,
      timestamp,
      price,
      ...(typeof item.kind === "string" ? { kind: item.kind } : {})
    }];
  });
}
