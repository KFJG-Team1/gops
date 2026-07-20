import type { ChartDataStatus } from "./types";

export function isChartDataRenderable(status: ChartDataStatus): boolean {
  if (status.state === "ready") {
    return true;
  }
  if (status.state !== "partial") {
    return false;
  }
  const coverage = status.coverage;
  if (
    (coverage?.renderabilityReasonCode ?? coverage?.reasonCode) === "returned_window_sparse" &&
    (status.returnedCount ?? coverage?.returnedCount ?? 0) > 0
  ) {
    return true;
  }
  return coverage ? coverage.renderable === true : true;
}
