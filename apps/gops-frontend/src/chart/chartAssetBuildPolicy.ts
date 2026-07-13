import type { AnalysisAssetInterval } from "./analysisAssetsApi";
import type { ChartInterval } from "./types";

const supportedIntervals = new Set<ChartInterval>(["1m", "5m", "10m", "1h", "4h", "1D", "1W"]);

export function defaultChartAssetBuildIntervals(currentInterval: ChartInterval): AnalysisAssetInterval[] {
  return supportedIntervals.has(currentInterval)
    ? [currentInterval as AnalysisAssetInterval]
    : ["1D"];
}
