import type { ChartAssetCommentaryIndicatorLayer, ChartAssetCommentaryReference } from "./analysisAssetsApi";

export const chartCommentaryReferenceOpenEventName = "gops:chart-commentary-reference-open";
export const chartCommentaryIndicatorToggleEventName = "gops:chart-commentary-indicator-toggle";

export type ChartCommentaryReferenceOpenRequest = {
  chartDocumentId: string;
  reference: Exclude<ChartAssetCommentaryReference, { type: "drawing" }>;
};

export type ChartCommentaryIndicatorToggleRequest = {
  chartDocumentId: string;
  layer: ChartAssetCommentaryIndicatorLayer;
};

export function dispatchChartCommentaryReferenceOpen(request: ChartCommentaryReferenceOpenRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChartCommentaryReferenceOpenRequest>(chartCommentaryReferenceOpenEventName, {
    detail: request
  }));
}

export function dispatchChartCommentaryIndicatorToggle(request: ChartCommentaryIndicatorToggleRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChartCommentaryIndicatorToggleRequest>(chartCommentaryIndicatorToggleEventName, {
    detail: request
  }));
}
