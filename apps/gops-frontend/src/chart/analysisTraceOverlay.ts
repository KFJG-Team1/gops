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
  markerCandidates: AnalysisTraceOverlayCandidate[];
  pivots: GeometryTracePivot[];
  focused: boolean;
  focusedCandidateIds: string[];
  showCandidateLines: boolean;
  dataMode: "complete" | "bounded" | "legacy";
  storedCandidateCount: number;
};

export type AnalysisTraceDataMode = AnalysisTraceOverlay["dataMode"] | "none";

export function analysisTraceDataMode(asset: ChartAnalysisAsset | null): AnalysisTraceDataMode {
  if (!asset) return "none";
  const trace = asset.geometry.analysisTrace;
  if (!trace) return asset.geometry.evidence?.length ? "legacy" : "none";
  return trace.version === "geometry-analysis-trace-v2" && trace.completeness?.complete
    ? "complete"
    : "bounded";
}

export function analysisTraceLevelPrice(
  candidate: AnalysisTraceOverlayCandidate,
  pivots: readonly GeometryTracePivot[]
): number | null {
  const metricPrice = candidate.metrics?.price;
  if (typeof metricPrice === "number" && Number.isFinite(metricPrice) && metricPrice > 0) {
    return metricPrice;
  }
  const anchorPrice = candidate.anchors.find((anchor) => Number.isFinite(anchor.price) && anchor.price > 0)?.price;
  if (typeof anchorPrice === "number") return anchorPrice;
  const pivotById = new Map(pivots.map((pivot) => [pivot.id, pivot]));
  for (const id of candidate.anchorPivotIds) {
    const price = pivotById.get(id)?.price;
    if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

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
    return pivots.length ? {
      candidates: [], markerCandidates: [], pivots, focused, focusedCandidateIds: [],
      showCandidateLines: false, dataMode: "legacy", storedCandidateCount: 0
    } : null;
  }

  const selectionIds = new Set([
    ...(trace.selections?.levelCandidateIds ?? []),
    ...(trace.selections?.trendCandidateIds ?? []),
    ...(trace.selections?.patternCandidateIds ?? [])
  ]);
  const allCandidates = [
    ...trace.levelCandidates.map((candidate) => normalizeCandidate(candidate, "levels", selectionIds)),
    ...trace.trendCandidates.map((candidate) => normalizeCandidate(candidate, "trend", selectionIds)),
    ...trace.patternCandidates.map((candidate) => normalizeCandidate(candidate, "pattern", selectionIds))
  ];
  const focusedCandidates = focused
    ? allCandidates.filter((candidate) => candidateFilter.has(candidate.id))
    : allCandidates;
  const displayedCandidates = options.visible ? selectInterpretationCandidates(allCandidates) : [];
  const candidates = options.visible ? displayedCandidates : focusedCandidates;
  const markerCandidates = focused ? focusedCandidates : displayedCandidates;
  const referencedPivotIds = new Set(evidenceFilter);
  markerCandidates.forEach((candidate) => {
    candidate.anchorPivotIds.forEach((id) => referencedPivotIds.add(id));
    candidate.touchPivotIds.forEach((id) => referencedPivotIds.add(id));
    candidate.reactionPivotIds.forEach((id) => referencedPivotIds.add(id));
  });
  const tracePivots = trace.pivots.filter((pivot) => referencedPivotIds.has(pivot.id));
  const touchPivots = markerCandidates.flatMap((candidate) => (candidate.touches ?? []).map((touch) => ({
    id: touch.id,
    timestamp: touch.timestamp,
    price: touch.price,
    ...(typeof touch.outcome === "string" ? { outcome: touch.outcome } : {})
  })));
  const pivots = [...new Map([...tracePivots, ...touchPivots].map((pivot) => [pivot.id, pivot])).values()];
  return candidates.length || pivots.length || (options.visible && allCandidates.length) ? {
    candidates,
    markerCandidates,
    pivots,
    focused,
    focusedCandidateIds: [...candidateFilter],
    showCandidateLines: options.visible,
    dataMode: trace.version === "geometry-analysis-trace-v2" && trace.completeness?.complete
      ? "complete"
      : "bounded",
    storedCandidateCount: allCandidates.length
  } : null;
}

const categoryCaps: Record<AnalysisTraceOverlayCandidate["category"], number> = {
  levels: 4,
  trend: 3,
  pattern: 2
};

const fatalNearMissReason = /(stale|breach|invalid|role[_ -]?conflict|break[_ -]?pending)/i;

export function selectInterpretationCandidates(
  candidates: readonly AnalysisTraceOverlayCandidate[]
): AnalysisTraceOverlayCandidate[] {
  const selectedCount = new Set(candidates.filter((candidate) => candidate.selected === true).map((candidate) => candidate.id)).size;
  const budget = Math.min(9, Math.max(3, selectedCount * 2));
  const shortlists = (["levels", "trend", "pattern"] as const).map((category) => {
    const unselected = candidates.filter((candidate) => candidate.category === category && candidate.selected !== true);
    const qualified = unselected.filter((candidate) => (
      candidate.hardPass === true || candidate.disposition === "qualified_not_selected"
    ));
    const eligible = qualified.length
      ? qualified
      : unselected.filter((candidate) => (
        candidate.evidencePass === true
        && candidate.activePass === true
        && !(candidate.rejectReasons ?? []).some((reason) => fatalNearMissReason.test(reason))
      )).slice().sort(compareTraceCandidates).slice(0, 1);
    return orderedByDiversity(eligible, candidateDiversityKey).slice(0, categoryCaps[category]);
  });
  const selected: AnalysisTraceOverlayCandidate[] = [];
  for (let index = 0; selected.length < budget; index += 1) {
    let added = false;
    shortlists.forEach((shortlist) => {
      const candidate = shortlist[index];
      if (candidate && selected.length < budget) {
        selected.push(candidate);
        added = true;
      }
    });
    if (!added) break;
  }
  return selected;
}

function orderedByDiversity(
  candidates: readonly AnalysisTraceOverlayCandidate[],
  keyOf: (candidate: AnalysisTraceOverlayCandidate) => string
): AnalysisTraceOverlayCandidate[] {
  const groups = new Map<string, AnalysisTraceOverlayCandidate[]>();
  candidates.slice().sort(compareTraceCandidates).forEach((candidate) => {
    const key = keyOf(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  });
  const orderedGroups = [...groups.values()].sort((left, right) => compareTraceCandidates(left[0], right[0]));
  const result: AnalysisTraceOverlayCandidate[] = [];
  for (let index = 0; orderedGroups.some((group) => index < group.length); index += 1) {
    orderedGroups.forEach((group) => {
      if (group[index]) result.push(group[index]);
    });
  }
  return result;
}

function candidateDiversityKey(candidate: AnalysisTraceOverlayCandidate): string {
  if (candidate.category === "levels") return candidate.role === "resistance" ? "resistance" : "support";
  if (candidate.category === "trend") {
    if (candidate.kind === "channel") return "channel";
    return candidate.direction ?? candidate.kind ?? "trend";
  }
  return candidate.kind ?? "pattern";
}

function compareTraceCandidates(
  left: AnalysisTraceOverlayCandidate,
  right: AnalysisTraceOverlayCandidate
): number {
  return descending(left.score, right.score)
    || descending(metricNumber(left, "reactionCount"), metricNumber(right, "reactionCount"))
    || descending(metricNumber(left, "touchCount"), metricNumber(right, "touchCount"))
    || ascending(metricNumber(left, "currentDistanceAtr"), metricNumber(right, "currentDistanceAtr"), true)
    || ascending(metricNumber(left, "lastTouchAgeBars"), metricNumber(right, "lastTouchAgeBars"), true)
    || ascending(left.categoryRank, right.categoryRank, true)
    || left.id.localeCompare(right.id);
}

function metricNumber(candidate: AnalysisTraceOverlayCandidate, key: string): number | undefined {
  const value = candidate.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function descending(left: number | undefined, right: number | undefined): number {
  const safeLeft = typeof left === "number" && Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
  const safeRight = typeof right === "number" && Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
  return safeRight - safeLeft;
}

function ascending(left: number | undefined, right: number | undefined, missingLast = false): number {
  const missingValue = missingLast ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const safeLeft = typeof left === "number" && Number.isFinite(left) ? left : missingValue;
  const safeRight = typeof right === "number" && Number.isFinite(right) ? right : missingValue;
  return safeLeft - safeRight;
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
    disposition: candidate.disposition
      ?? (candidate.selected === true || selectionIds.has(candidate.id)
        ? "selected"
        : candidate.hardPass ? "qualified_not_selected" : "rejected"),
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
