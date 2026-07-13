import type { ChartInterval } from "./types";
import type { AnalysisAssetInterval } from "./analysisAssetsApi";

export function defaultChartAssetBuildIntervals(_currentInterval: ChartInterval): AnalysisAssetInterval[] {
  return ["1m", "1D"];
}
