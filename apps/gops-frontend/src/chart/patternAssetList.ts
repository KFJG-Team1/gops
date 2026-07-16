import type { AnalysisAssetInterval } from "./analysisAssetsApi";
import type { ChartAssetCoverageItem } from "./assetBuildApi";

export type ActivePatternState = "forming" | "confirmed";

export type PatternAssetEntry = Omit<ChartAssetCoverageItem, "primaryPattern"> & {
  primaryPattern: NonNullable<ChartAssetCoverageItem["primaryPattern"]> & {
    state: ActivePatternState;
  };
};

export type PatternSymbolGroup = {
  symbol: string;
  patterns: PatternAssetEntry[];
};

export type PatternAssetFilters = {
  search?: string;
  interval?: AnalysisAssetInterval | "all";
  state?: ActivePatternState | "all";
  kind?: string | "all";
};

const intervalOrder: AnalysisAssetInterval[] = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"];

export function buildPatternSymbolGroups(items: ChartAssetCoverageItem[]): PatternSymbolGroup[] {
  const bySymbol = new Map<string, PatternAssetEntry[]>();
  for (const item of items) {
    if (!isActivePatternEntry(item)) {
      continue;
    }
    const symbol = item.symbol.trim().toUpperCase();
    if (!symbol) {
      continue;
    }
    const entry: PatternAssetEntry = { ...item, symbol, primaryPattern: item.primaryPattern };
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), entry]);
  }

  return Array.from(bySymbol, ([symbol, patterns]) => ({
    symbol,
    patterns: patterns.sort(comparePatternEntries)
  })).sort(comparePatternGroups);
}

export function filterPatternSymbolGroups(
  groups: PatternSymbolGroup[],
  filters: PatternAssetFilters
): PatternSymbolGroup[] {
  const search = filters.search?.trim().toUpperCase() ?? "";
  return groups.flatMap((group) => {
    if (search && !group.symbol.includes(search)) {
      return [];
    }
    const patterns = group.patterns.filter((pattern) => (
      (!filters.interval || filters.interval === "all" || pattern.interval === filters.interval)
      && (!filters.state || filters.state === "all" || pattern.primaryPattern.state === filters.state)
      && (!filters.kind || filters.kind === "all" || pattern.primaryPattern.kind === filters.kind)
    ));
    return patterns.length ? [{ symbol: group.symbol, patterns }] : [];
  }).sort(comparePatternGroups);
}

function isActivePatternEntry(item: ChartAssetCoverageItem): item is PatternAssetEntry {
  return item.primaryPattern?.state === "forming" || item.primaryPattern?.state === "confirmed";
}

function comparePatternGroups(left: PatternSymbolGroup, right: PatternSymbolGroup): number {
  const patternOrder = comparePatternEntries(left.patterns[0]!, right.patterns[0]!);
  return patternOrder || left.symbol.localeCompare(right.symbol);
}

function comparePatternEntries(left: PatternAssetEntry, right: PatternAssetEntry): number {
  const stateOrder = patternStateRank(left.primaryPattern.state) - patternStateRank(right.primaryPattern.state);
  if (stateOrder) {
    return stateOrder;
  }
  const scoreOrder = right.primaryPattern.score - left.primaryPattern.score;
  if (scoreOrder) {
    return scoreOrder;
  }
  const symbolOrder = left.symbol.localeCompare(right.symbol);
  if (symbolOrder) {
    return symbolOrder;
  }
  return intervalOrder.indexOf(left.interval) - intervalOrder.indexOf(right.interval);
}

function patternStateRank(state: ActivePatternState): number {
  return state === "confirmed" ? 0 : 1;
}
