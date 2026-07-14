export type ChartExplanationAssetIdentity = {
  assetVersion: string | null;
  algorithmVersion: string | null;
  inputDigest: string | null;
  asOf: string | null;
};

export type ChartExplanationFocusGroups = {
  evidence: string[];
  pattern: string[];
  support: string[];
  resistance: string[];
};

export type ChartExplanationAnchor = {
  type?: string | null;
  sourcePanelId?: string | null;
  id?: string | null;
  timestamp?: string | null;
};

export type ChartExplanation = {
  version: "chart-explanation.v1";
  symbol: string;
  interval: string;
  asOf: string;
  quality: {
    state: string;
    stale: boolean;
    flags: string[];
  };
  assetIdentity: ChartExplanationAssetIdentity;
  source?: {
    chartDocumentId?: string;
    sourcePanelId?: string;
  };
  facts: {
    pattern: Record<string, unknown> | null;
    support: Record<string, unknown> | null;
    resistance: Record<string, unknown> | null;
    tradeScenario: Record<string, unknown> | null;
    movingAverageCross: Record<string, unknown> | null;
    selectedCandle: Record<string, unknown> | null;
  };
  usedIndicators: string[];
  focusIds: string[];
  focusGroups?: ChartExplanationFocusGroups;
  anchor: ChartExplanationAnchor | null;
  news: unknown[];
};

export type ComparableChartAssetIdentity = {
  assetVersion?: unknown;
  algorithmVersion?: unknown;
  inputDigest?: unknown;
  asOf?: unknown;
  symbol?: unknown;
  interval?: unknown;
};

export function normalizeChartExplanation(value: unknown): ChartExplanation | null {
  const source = readObject(value);
  if (!source || source.version !== "chart-explanation.v1") return null;
  const symbol = readString(source.symbol)?.toUpperCase();
  const interval = readString(source.interval);
  const asOf = readString(source.asOf);
  const quality = readObject(source.quality);
  const identity = readObject(source.assetIdentity);
  const facts = readObject(source.facts);
  if (!symbol || !interval || !asOf || !quality || !identity || !facts) return null;
  const qualityState = readString(quality.state);
  if (!qualityState) return null;
  const focusIds = uniqueStrings(readArray(source.focusIds));
  const sourceIdentity = readObject(source.source);
  const chartDocumentId = readString(sourceIdentity?.chartDocumentId);
  const sourcePanelId = readString(sourceIdentity?.sourcePanelId);
  const focusGroups = normalizeFocusGroups(source.focusGroups, new Set(focusIds));
  const anchor = normalizeAnchor(source.anchor);
  return {
    version: "chart-explanation.v1",
    symbol,
    interval,
    asOf,
    quality: {
      state: qualityState,
      stale: quality.stale === true,
      flags: uniqueStrings(readArray(quality.flags))
    },
    assetIdentity: {
      assetVersion: readString(identity.assetVersion),
      algorithmVersion: readString(identity.algorithmVersion),
      inputDigest: readString(identity.inputDigest),
      asOf: readString(identity.asOf)
    },
    ...((chartDocumentId || sourcePanelId) ? {
      source: {
        ...(chartDocumentId ? { chartDocumentId } : {}),
        ...(sourcePanelId ? { sourcePanelId } : {})
      }
    } : {}),
    facts: {
      pattern: readObject(facts.pattern),
      support: readObject(facts.support),
      resistance: readObject(facts.resistance),
      tradeScenario: readObject(facts.tradeScenario),
      movingAverageCross: readObject(facts.movingAverageCross),
      selectedCandle: readObject(facts.selectedCandle)
    },
    usedIndicators: uniqueStrings(readArray(source.usedIndicators)),
    focusIds,
    ...(focusGroups ? { focusGroups } : {}),
    anchor,
    news: readArray(source.news)
  };
}

export function chartExplanationMatchesAsset(
  explanation: ChartExplanation,
  current: ComparableChartAssetIdentity | null | undefined
): boolean {
  if (!current) return false;
  const currentSymbol = readString(current.symbol)?.toUpperCase();
  const currentInterval = readString(current.interval);
  if (currentSymbol !== explanation.symbol || currentInterval !== explanation.interval) return false;
  return (["assetVersion", "algorithmVersion", "inputDigest", "asOf"] as const).every((key) => {
    const expected = explanation.assetIdentity[key];
    const actual = readString(current[key]);
    return Boolean(expected && actual && expected === actual);
  });
}

export function chartExplanationMatchesSource(
  explanation: ChartExplanation,
  chartDocumentId: string | null | undefined
): boolean {
  const responseDocumentId = explanation.source?.chartDocumentId;
  return Boolean(chartDocumentId && (!responseDocumentId || responseDocumentId === chartDocumentId));
}

function normalizeFocusGroups(value: unknown, focusIds: Set<string>): ChartExplanationFocusGroups | null {
  const source = readObject(value);
  if (!source) return null;
  const normalize = (items: unknown) => uniqueStrings(readArray(items)).filter((id) => focusIds.has(id));
  return {
    evidence: normalize(source.evidence),
    pattern: normalize(source.pattern),
    support: normalize(source.support),
    resistance: normalize(source.resistance)
  };
}

function normalizeAnchor(value: unknown): ChartExplanationAnchor | null {
  const source = readObject(value);
  if (!source) return null;
  const type = readString(source.type);
  const sourcePanelId = readString(source.sourcePanelId);
  const id = readString(source.id);
  const timestamp = readString(source.timestamp);
  if (!type && !sourcePanelId && !id && !timestamp) return null;
  return { type, sourcePanelId, id, timestamp };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(readString).filter((item): item is string => Boolean(item)))];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
