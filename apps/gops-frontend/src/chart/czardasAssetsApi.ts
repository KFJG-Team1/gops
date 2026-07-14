import { czardasMeaningFactorKeys, type CzardasFieldDto, type CzardasPatternDto, type DrawingEntity } from "./types";

export const czardasIntervals = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"] as const;
export type CzardasInterval = typeof czardasIntervals[number];
export type CzardasFreshness = "current" | "stale" | "missing" | "incompatible";
export type CzardasFreshnessReason = "identity_match" | "input_changed" | "identity_unavailable" | "asset_missing" | "contract_incompatible";

export type CanonicalSnapshotMetadata = {
  inputContractVersion: "canonical-ohlcv-q8-v1";
  asOf: string;
  lastCandleKey: string;
  completedCount: 240;
  inputDigest: string;
};

export type CzardasExplanation = {
  claim: string;
  because: string[];
  against: string[];
  state: "formed" | "response_supported";
  invalidationCondition: string;
  dataQualifier: string;
};

export type CzardasBoundary = {
  candidateId: string;
  sourceInferenceId: string;
  sourceFieldModeId: string;
  sourceFieldDerivationDigest: string;
  kind: "hline" | "trend";
  role: "support" | "resistance" | "lower" | "upper";
  evidenceState: "formed" | "response_supported";
  isRelevantNow: boolean;
  formation: {
    initialFormationEpisodeIds: string[];
    fitEpisodeIds: string[];
    fitCount: number;
    lastFitObservedAt: string;
    fitEvidenceConfirmedAt: string;
    seedQuality: number;
  };
  responses: { completedCount: number; pendingCount: number; lastInteractionAt: string | null; responseMass: number };
  rank: {
    rankScore: number;
    responseCount: number;
    responseMass: number;
    responseBonus: number;
    profileBonus: number;
    integrityFactCount: number;
    integrityEffectiveFactCount: number;
    integrityCoverage: number;
    bodyPenetrationCount: number;
    closePenetrationCount: number;
  };
  line: { priceAtAsOf: number; slopePerBar: number; zoneHalfWidth: number };
  explanation: CzardasExplanation;
};

export type CzardasPackContent = {
  algorithmVersion: string;
  configVersion: string;
  inputContractVersion: string;
  timeContractVersion: string;
  calendarVersion: string;
  inferenceConfigDigest: string;
  projectionConfigDigest: string;
  sightProjectionVersion: string;
  sightProjectionId: string;
  symbol: string;
  interval: CzardasInterval;
  asOf: string;
  lastCandleKey: string;
  inputDigest: string;
  inferenceId: string;
  status: "ready";
  coverage: { state: "exact"; targetCompleted: 240; actualCompleted: 240; analysisBars: 240; qualityFlags: string[] };
  selection: {
    hline: { configuredCount: number; actualCount: number };
    trend: { configuredCount: number; actualCount: number };
  };
  boundaries: CzardasBoundary[];
  presentationPattern: CzardasPatternDto | null;
  drawings: DrawingEntity[];
  czardasField: CzardasFieldDto;
  rejectSummary?: Record<string, unknown>;
};

export type CzardasAssetEntry = {
  freshness: CzardasFreshness;
  freshnessReason: CzardasFreshnessReason;
  generatedAt: string | null;
  pack: CzardasPackContent | null;
};

export type CzardasAssetsResponse = {
  symbol: string;
  assets: Record<CzardasInterval, CzardasAssetEntry>;
  meta?: { servedAt?: string };
};

export type CzardasBuildAccepted = {
  jobId: string;
  status: CzardasBuildStatus["status"];
  coalesced: boolean;
  status_url: string;
};

export type CzardasBuildItem = {
  symbol: string;
  interval: CzardasInterval;
  status: "saved" | "unchanged" | "failed" | "skipped";
  stage: string;
  error: string | null;
  elapsedMs: number;
  reason?: string;
};

export type CzardasBuildStatus = {
  jobId: string;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "canceled";
  requested: { symbol: string; interval: CzardasInterval; force: boolean };
  progress: { total: number; done: number; failed: number; skipped: number; warnings: number; current: string | null };
  repair?: {
    checkedSymbols: number;
    attemptedSymbols: number;
    repairedSymbols: number;
    unavailableSymbols: number;
    missingBarsBefore: number;
    missingBarsAfter: number;
    materializedRows: number;
    reasonCodes?: Record<string, number>;
  };
  recentItems: CzardasBuildItem[];
  failedItems?: CzardasBuildItem[];
  createdEntities?: number;
  error?: string | null;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CzardasDeleteResult = {
  symbol: string;
  interval: CzardasInterval;
  deleted: number;
};

const MAX_CZARDAS_FIELD_BYTES = 80 * 1024;
const MAX_CZARDAS_PACK_BYTES = 96 * 1024;
const CZARDAS_RAW_FACTOR_SCALE = 1000;

const cache = new Map<string, CzardasAssetsResponse>();
const inFlight = new Map<string, Promise<CzardasAssetsResponse>>();
const symbolGenerations = new Map<string, number>();
const completedCandleObservations = new Map<string, string>();
const invalidationListeners = new Set<(symbol?: string) => void>();
let globalGeneration = 0;

export type CzardasAssetObservation = {
  interval: CzardasInterval;
  completedCandleIdentity: string;
};

export type CzardasAssetsSnapshot = {
  response: CzardasAssetsResponse;
  generation: string;
};

export function czardasCompletedSnapshotIdentity(candles: Array<{
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed?: boolean;
}>): string | null {
  const completed = candles.filter((candle) => candle.isClosed !== false).slice(-240);
  if (!completed.length) return null;
  // Local invalidation fingerprint, not the persisted inputDigest. Including
  // every OHLCV value catches interior corrections with an unchanged tail.
  return JSON.stringify(completed.map((candle) => [
    candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume
  ]));
}

export async function czardasPanelSnapshotMatchesPack(
  pack: CzardasPackContent,
  snapshot: CanonicalSnapshotMetadata | null | undefined,
  candles: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    isClosed?: boolean;
  }>
): Promise<boolean> {
  if (
    !snapshot
    || snapshot.inputContractVersion !== pack.inputContractVersion
    || snapshot.completedCount !== 240
    || snapshot.asOf !== pack.asOf
    || snapshot.lastCandleKey !== pack.lastCandleKey
    || snapshot.inputDigest !== pack.inputDigest
  ) return false;
  const completed = candles.filter((candle) => candle.isClosed !== false).slice(-240);
  const meanings = pack.czardasField?.candleMeanings;
  if (completed.length !== 240 || meanings?.timestamps.length !== 240 || meanings.candleKeys.length !== 240) return false;
  for (let index = 0; index < 240; index += 1) {
    const candle = completed[index];
    const parsed = Date.parse(candle.timestamp);
    const timestamp = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    if (!timestamp || timestamp !== meanings.timestamps[index]) return false;
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (!values.every(Number.isFinite)) return false;
  }
  return true;
}

export function isCzardasInterval(value: unknown): value is CzardasInterval {
  return typeof value === "string" && (czardasIntervals as readonly string[]).includes(value);
}

export function fetchCzardasAssets(symbol: string): Promise<CzardasAssetsResponse> {
  const normalized = normalizeSymbol(symbol);
  return fetchCzardasAssetsCore(normalized);
}

export function fetchCzardasAssetsSnapshot(
  symbol: string,
  observation?: CzardasAssetObservation
): Promise<CzardasAssetsSnapshot> {
  const normalized = normalizeSymbol(symbol);
  if (observation) observeCompletedCandle(normalized, observation);
  const generation = czardasAssetsGeneration(normalized);
  return fetchCzardasAssetsCore(normalized).then((response) => ({ response, generation }));
}

export function isCzardasAssetsGenerationCurrent(symbol: string, generation: string): boolean {
  return generation === czardasAssetsGeneration(normalizeSymbol(symbol));
}

function fetchCzardasAssetsCore(normalized: string): Promise<CzardasAssetsResponse> {
  const cached = cache.get(normalized);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(normalized);
  if (pending) return pending;
  const requestGlobalGeneration = globalGeneration;
  const requestSymbolGeneration = symbolGenerations.get(normalized) ?? 0;
  let request: Promise<CzardasAssetsResponse>;
  request = apiJson(`/api/charts/czardas-assets?${new URLSearchParams({ symbol: normalized })}`)
    .then((payload) => normalizeCzardasAssetsResponse(payload, normalized))
    .then((payload) => {
      if (
        globalGeneration === requestGlobalGeneration
        && (symbolGenerations.get(normalized) ?? 0) === requestSymbolGeneration
      ) {
        cache.set(normalized, payload);
      }
      return payload;
    })
    .finally(() => {
      if (inFlight.get(normalized) === request) inFlight.delete(normalized);
    });
  inFlight.set(normalized, request);
  return request;
}

export function invalidateCzardasAssets(symbol?: string): void {
  if (symbol) {
    const normalized = normalizeSymbol(symbol);
    invalidateNormalizedSymbol(normalized);
    return;
  }
  cache.clear();
  inFlight.clear();
  symbolGenerations.clear();
  globalGeneration += 1;
  invalidationListeners.forEach((listener) => listener());
}

export function subscribeCzardasAssetsInvalidation(listener: (symbol?: string) => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function submitCzardasBuild(request: { symbol: string; interval: CzardasInterval; force?: boolean }): Promise<CzardasBuildAccepted> {
  const idempotencyKey = `czardas-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  return apiJson("/api/charts/czardas-assets/build", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      symbol: normalizeSymbol(request.symbol),
      interval: request.interval,
      force: request.force === true
    })
  });
}

export function fetchCzardasBuildStatus(statusUrl: string): Promise<CzardasBuildStatus> {
  return apiJson(statusUrl);
}

export function cancelCzardasBuild(jobId: string): Promise<CzardasBuildStatus> {
  return apiJson(`/api/charts/czardas-assets/build/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function deleteCzardasAsset(symbol: string, interval: CzardasInterval): Promise<CzardasDeleteResult> {
  const normalized = normalizeSymbol(symbol);
  const query = new URLSearchParams({ symbol: normalized, interval });
  const result = await apiJson<CzardasDeleteResult>(`/api/charts/czardas-assets?${query}`, { method: "DELETE" });
  invalidateCzardasAssets(normalized);
  return result;
}

export function normalizeCzardasAssetsResponse(value: unknown, fallbackSymbol: string): CzardasAssetsResponse {
  const normalizedFallback = normalizeSymbol(fallbackSymbol);
  const source = asRecord(value);
  const rawAssets = asRecord(source.assets);
  const assets = Object.fromEntries(czardasIntervals.map((interval) => [
    interval,
    normalizeEntry(rawAssets[interval], normalizedFallback, interval)
  ])) as Record<CzardasInterval, CzardasAssetEntry>;
  return {
    symbol: asString(source.symbol)?.toUpperCase() ?? normalizedFallback,
    assets,
    meta: asRecord(source.meta)
  };
}

function normalizeEntry(value: unknown, symbol: string, interval: CzardasInterval): CzardasAssetEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { freshness: "missing", freshnessReason: "asset_missing", generatedAt: null, pack: null };
  }
  const source = asRecord(value);
  const freshness = isFreshness(source.freshness) ? source.freshness : "incompatible";
  const freshnessReason = isFreshnessReason(source.freshnessReason)
    ? source.freshnessReason
    : freshness === "missing" ? "asset_missing" : "contract_incompatible";
  const generatedAt = asString(source.generatedAt) ?? null;
  if (freshness === "missing") return { freshness, freshnessReason, generatedAt: null, pack: null };
  const pack = normalizePack(source.pack, symbol, interval);
  return {
    freshness: pack ? freshness : "incompatible",
    freshnessReason: pack ? freshnessReason : "contract_incompatible",
    generatedAt,
    pack,
  };
}

function normalizePack(value: unknown, fallbackSymbol: string, interval: CzardasInterval): CzardasPackContent | null {
  const pack = asRecord(value) as CzardasPackContent;
  const symbol = asString(pack.symbol)?.toUpperCase();
  const coverage = asRecord(pack.coverage);
  if (
    !symbol || symbol !== fallbackSymbol || pack.interval !== interval || pack.status !== "ready"
    || pack.algorithmVersion !== "czardas-v3" || pack.configVersion !== "czardas-config-v3"
    || pack.inputContractVersion !== "canonical-ohlcv-q8-v1"
    || pack.timeContractVersion !== "market-time-v1" || pack.calendarVersion !== "nyse-calendar-v1"
    || !isNonEmptyString(pack.inferenceConfigDigest) || !isNonEmptyString(pack.projectionConfigDigest)
    || pack.sightProjectionVersion !== "czardas-sight-v2" || !isNonEmptyString(pack.sightProjectionId)
    || coverage.state !== "exact" || coverage.analysisBars !== 240
    || coverage.actualCompleted !== 240 || coverage.targetCompleted !== 240
    || !isNonEmptyString(pack.asOf) || !isNonEmptyString(pack.lastCandleKey) || !isNonEmptyString(pack.inputDigest)
    || !isNonEmptyString(pack.inferenceId)
    || !Array.isArray(pack.boundaries) || pack.boundaries.length > 7 || !pack.boundaries.every(isBoundary)
    || !Array.isArray(pack.drawings) || pack.drawings.length > 7
    || !isCzardasField(pack.czardasField, pack)
    || jsonUtf8Size(pack.czardasField) > MAX_CZARDAS_FIELD_BYTES
    || jsonUtf8Size(pack) > MAX_CZARDAS_PACK_BYTES
    || pack.lastCandleKey !== pack.czardasField.candleMeanings.candleKeys[239]
    || containsHistoricalContract(pack)
  ) return null;
  const hlines = pack.drawings.filter((item) => item.czardasLayer === "hline");
  const trends = pack.drawings.filter((item) => item.czardasLayer === "trend");
  if (
    hlines.length > 4 || trends.length > 3 || hlines.length + trends.length !== pack.drawings.length
    || pack.selection?.hline?.actualCount !== hlines.length
    || pack.selection?.trend?.actualCount !== trends.length
    || pack.drawings.some((drawing) => !isManagedDrawing(drawing, interval, pack.inferenceId))
    || pack.boundaries.some((boundary) => boundary.sourceInferenceId !== pack.inferenceId)
    || new Set(pack.drawings.map((drawing) => drawing.id)).size !== pack.drawings.length
    || new Set(pack.drawings.map((drawing) => drawing.sourceCandidateId)).size !== pack.drawings.length
    || !candidateProvenanceIsClosed(pack)
    || !isPresentationPattern(pack.presentationPattern, pack.drawings)
  ) return null;
  return pack;
}

function observeCompletedCandle(normalizedSymbol: string, observation: CzardasAssetObservation): void {
  const identity = observation.completedCandleIdentity.trim();
  if (!identity) return;
  const scope = `${normalizedSymbol}|${observation.interval}`;
  if (completedCandleObservations.get(scope) === identity) return;
  completedCandleObservations.set(scope, identity);
  invalidateNormalizedSymbol(normalizedSymbol);
}

function invalidateNormalizedSymbol(normalized: string): void {
  cache.delete(normalized);
  inFlight.delete(normalized);
  symbolGenerations.set(normalized, (symbolGenerations.get(normalized) ?? 0) + 1);
  invalidationListeners.forEach((listener) => listener(normalized));
}

function czardasAssetsGeneration(normalized: string): string {
  return `${globalGeneration}:${symbolGenerations.get(normalized) ?? 0}`;
}

function isManagedDrawing(value: unknown, interval: CzardasInterval, inferenceId: string): value is DrawingEntity {
  const drawing = asRecord(value);
  const layer = drawing.czardasLayer;
  const expectedType = layer === "hline" ? "horizontalLine" : layer === "trend" ? "trendLine" : null;
  const anchors = Array.isArray(drawing.anchors) ? drawing.anchors : [];
  const style = asRecord(drawing.style);
  return expectedType !== null
    && drawing.type === expectedType
    && drawing.ownership === "czardas-managed"
    && drawing.sourceInterval === interval
    && drawing.createdBy === "system"
    && isNonEmptyString(drawing.id) && drawing.id.startsWith("czardas:")
    && drawing.sourceInferenceId === inferenceId
    && isNonEmptyString(drawing.sourceCandidateId)
    && isNonEmptyString(drawing.sourceFieldModeId)
    && isNonEmptyString(drawing.sourceFieldDerivationDigest)
    && anchors.length === 2 && anchors.every(isPriceAnchor)
    && isFiniteNumber(style.lineWidth) && [1, 2, 3].includes(style.lineWidth)
    && style.extension === (layer === "hline" ? "line" : "ray")
    && drawing.visible === true
    && isNonEmptyString(drawing.createdAt)
    && isNonEmptyString(drawing.updatedAt);
}

function isPriceAnchor(value: unknown): boolean {
  const anchor = asRecord(value);
  return isNonEmptyString(anchor.timestamp) && isFiniteNumber(anchor.price);
}

function isCzardasField(value: unknown, pack: CzardasPackContent): value is CzardasFieldDto {
  const field = asRecord(value);
  const asOf = pack.asOf;
  if (
    field.schemaVersion !== 3 || field.sourceBars !== 240
    || field.inputContractVersion !== pack.inputContractVersion
    || field.inferenceConfigDigest !== pack.inferenceConfigDigest
    || field.projectionConfigDigest !== pack.projectionConfigDigest
    || field.sightProjectionVersion !== pack.sightProjectionVersion
    || field.sightProjectionId !== pack.sightProjectionId
    || field.evaluationAsOf !== asOf
    || field.sourceInferenceId !== pack.inferenceId
    || !isTimestamp(field.windowFromTimestamp) || !isTimestamp(field.windowToTimestamp)
    || Date.parse(field.windowFromTimestamp) > Date.parse(field.windowToTimestamp)
    || field.windowToTimestamp !== asOf
    || !isCandleMeanings(field.candleMeanings, asOf, field.windowFromTimestamp, field.windowToTimestamp)
    || !isBasisFacts(field.basisFacts)
    || !Array.isArray(field.basisGlyphs) || !field.basisGlyphs.every(isBasisGlyph)
    || !Array.isArray(field.hlineResponseSegments) || !field.hlineResponseSegments.every((item) => isWindowScopedRecord(item, field))
    || !Array.isArray(field.hlineProfileBins) || !field.hlineProfileBins.every(isRecordValue)
    || !Array.isArray(field.hlineModes) || !field.hlineModes.every((item) => isHlineMode(item) && isWindowScopedRecord(item, field))
    || !Array.isArray(field.trendModes) || !field.trendModes.every(isTrendMode)
    || !Array.isArray(field.selectedModeRefs) || !field.selectedModeRefs.every(isSelectedModeRef)
    || !isDerivationEpisodes(field.derivationEpisodes, field.selectedModeRefs.length, field.basisFacts.basisIds.length)
    || !Array.isArray(field.validationGlyphs) || !field.validationGlyphs.every((item) => (
      isValidationGlyph(item, field.selectedModeRefs.length, field.derivationEpisodes.candidateIndexes.length)
    ))
    || !(field.relationGlyph === undefined || field.relationGlyph === null || isRecordValue(field.relationGlyph))
    || !(field.projection === undefined || isRecordValue(field.projection))
  ) return false;
  const modeKeys = new Set([
    ...field.hlineModes,
    ...field.trendModes
  ].map((mode) => `${String(mode.fieldModeId)}:${String(mode.derivationDigest)}`));
  const selectedModeKeys = new Set(field.selectedModeRefs.map((reference) => (
    `${String(reference.sourceFieldModeId)}:${String(reference.sourceFieldDerivationDigest)}`
  )));
  return field.selectedModeRefs.every((reference) => modeKeys.has(
    `${String(reference.sourceFieldModeId)}:${String(reference.sourceFieldDerivationDigest)}`
  )) && [...field.hlineModes, ...field.trendModes].every((mode) => (
    modeBasisIndexesAreValid(
      mode,
      field.basisFacts,
      selectedModeKeys.has(`${String(mode.fieldModeId)}:${String(mode.derivationDigest)}`)
    )
  )) && field.basisGlyphs.every((basis) => (
    Date.parse(basis.observedAt) <= Date.parse(basis.confirmedAt)
    && Date.parse(basis.confirmedAt) <= Date.parse(asOf)
  )) && field.trendModes.every((mode) => trendModeInsideWindow(mode, field))
    && field.validationGlyphs.every((glyph) => (
      Date.parse(glyph.observedAt) <= Date.parse(glyph.confirmedAt ?? asOf)
      && Date.parse(glyph.confirmedAt ?? asOf) <= Date.parse(asOf)
    ));
}

function modeBasisIndexesAreValid(value: unknown, basisFacts: Record<string, any>, selected: boolean): boolean {
  const mode = asRecord(value);
  const indexes = mode.contributorBasisIndexes;
  const contributorCount = mode.contributorCount;
  const roleCode = asRecord(basisFacts.roleCodebook)[String(mode.role)];
  const basisCount = Array.isArray(basisFacts.basisIds) ? basisFacts.basisIds.length : 0;
  return Number.isInteger(contributorCount) && contributorCount >= 0
    && Array.isArray(indexes)
    && (!selected || indexes.length === contributorCount)
    && new Set(indexes).size === indexes.length
    && Number.isInteger(roleCode)
    && indexes.every((index: unknown) => (
      Number.isInteger(index) && (index as number) >= 0 && (index as number) < basisCount
      && basisFacts.roleCodes[index as number] === roleCode
    ));
}

function isBasisFacts(value: unknown): boolean {
  const facts = asRecord(value);
  const basisIds = facts.basisIds;
  if (!Array.isArray(basisIds) || !basisIds.every(isNonEmptyString) || new Set(basisIds).size !== basisIds.length) return false;
  const count = basisIds.length;
  const numericKeys = [
    "roleCodes", "observedIndexes", "confirmedIndexes", "endpointPrices", "bodyEdgePrices",
    "corridorLows", "corridorHighs", "roleMasses", "effectiveScales"
  ];
  if (!numericKeys.every((key) => isFiniteNumberArray(facts[key], count))) return false;
  if (!Array.isArray(facts.participations) || facts.participations.length !== count
    || !facts.participations.every((item: unknown) => item === null || isFiniteNumber(item))) return false;
  const codebook = asRecord(facts.roleCodebook);
  if (codebook.support !== 0 || codebook.resistance !== 1 || codebook.lower !== 2 || codebook.upper !== 3) return false;
  return basisIds.every((_id, index) => (
    Number.isInteger(facts.roleCodes[index]) && facts.roleCodes[index] >= 0 && facts.roleCodes[index] <= 3
    && Number.isInteger(facts.observedIndexes[index]) && Number.isInteger(facts.confirmedIndexes[index])
    && facts.observedIndexes[index] >= 0 && facts.observedIndexes[index] <= facts.confirmedIndexes[index]
    && facts.confirmedIndexes[index] < 240
    && facts.corridorLows[index] <= facts.corridorHighs[index]
    && facts.effectiveScales[index] > 0
  ));
}

function isDerivationEpisodes(value: unknown, candidateCount: number, basisCount: number): boolean {
  const episodes = asRecord(value);
  const candidateIndexes = episodes.candidateIndexes;
  if (!Array.isArray(candidateIndexes)) return false;
  const count = candidateIndexes.length;
  const numericKeys = [
    "candidateIndexes", "candidateEpisodeOrdinals", "contributionBasisIndexes", "observedFromIndexes", "observedToIndexes",
    "confirmedIndexes", "contributionIndexes", "contributionPrices", "corridorLows", "corridorHighs", "initialFormationMasks"
  ];
  if (!numericKeys.every((key) => isFiniteNumberArray(episodes[key], count))) return false;
  if (!Array.isArray(episodes.memberBasisIndexes) || episodes.memberBasisIndexes.length !== count) return false;
  const coveredCandidates = new Set<number>();
  const ordinalsByCandidate = new Map<number, Set<number>>();
  const valid = candidateIndexes.every((_candidate, index) => {
    const candidateIndex = episodes.candidateIndexes[index];
    const candidateEpisodeOrdinal = episodes.candidateEpisodeOrdinals[index];
    const contributionBasisIndex = episodes.contributionBasisIndexes[index];
    const contributionIndex = episodes.contributionIndexes[index];
    const members = episodes.memberBasisIndexes[index];
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidateCount) return false;
    if (!Number.isInteger(contributionBasisIndex) || contributionBasisIndex < 0 || contributionBasisIndex >= basisCount) return false;
    if (!Array.isArray(members) || !members.length || !members.every((item: unknown) => (
      Number.isInteger(item) && (item as number) >= 0 && (item as number) < basisCount
    )) || new Set(members).size !== members.length || !members.includes(contributionBasisIndex)) return false;
    if (!Number.isInteger(candidateEpisodeOrdinal) || candidateEpisodeOrdinal < 0) return false;
    const ordinals = ordinalsByCandidate.get(candidateIndex) ?? new Set<number>();
    if (ordinals.has(candidateEpisodeOrdinal)) return false;
    ordinals.add(candidateEpisodeOrdinal);
    ordinalsByCandidate.set(candidateIndex, ordinals);
    coveredCandidates.add(candidateIndex);
    return Number.isInteger(episodes.observedFromIndexes[index])
      && Number.isInteger(episodes.observedToIndexes[index])
      && Number.isInteger(episodes.confirmedIndexes[index])
      && episodes.observedFromIndexes[index] >= 0
      && episodes.observedFromIndexes[index] <= episodes.observedToIndexes[index]
      && Number.isInteger(contributionIndex)
      && episodes.observedFromIndexes[index] <= contributionIndex
      && contributionIndex <= episodes.observedToIndexes[index]
      && episodes.observedToIndexes[index] <= episodes.confirmedIndexes[index]
      && episodes.confirmedIndexes[index] < 240
      && episodes.corridorLows[index] <= episodes.corridorHighs[index]
      && (episodes.initialFormationMasks[index] === 0 || episodes.initialFormationMasks[index] === 1);
  });
  return valid && coveredCandidates.size === candidateCount
    && [...ordinalsByCandidate.values()].every((ordinals) => (
      [...ordinals].sort((left, right) => left - right).every((ordinal, index) => ordinal === index)
    ));
}

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function isBasisGlyph(value: unknown): boolean {
  const item = asRecord(value);
  return isNonEmptyString(item.basisId)
    && isNonEmptyString(item.observedAt)
    && isNonEmptyString(item.confirmedAt)
    && isFiniteNumber(item.endpointPrice)
    && isFiniteNumber(item.corridorLow)
    && isFiniteNumber(item.corridorHigh)
    && (item.kind === "hline_reaction" || item.kind === "trend_endpoint")
    && (item.role === "support" || item.role === "resistance" || item.role === "lower" || item.role === "upper")
    && isFiniteNumber(item.effectiveScale)
    && isFiniteNumber(item.roleMassAtAsOf)
    && (item.participation === undefined || item.participation === null || isFiniteNumber(item.participation));
}

function isValidationGlyph(value: unknown, candidateCount: number, episodeCount: number): boolean {
  const item = asRecord(value);
  return isNonEmptyString(item.validationId)
    && Number.isInteger(item.candidateIndex) && item.candidateIndex >= 0 && item.candidateIndex < candidateCount
    && (item.episodeIndex === null || (Number.isInteger(item.episodeIndex) && item.episodeIndex >= 0 && item.episodeIndex < episodeCount))
    && (item.candidateKind === "hline" || item.candidateKind === "trend")
    && (item.role === "support" || item.role === "resistance" || item.role === "lower" || item.role === "upper")
    && (item.kind === "formation" || item.kind === "fit" || item.kind === "interaction")
    && isTimestamp(item.observedAt)
    && (item.confirmedAt === null || isTimestamp(item.confirmedAt))
    && isFiniteNumber(item.endpointPrice)
    && (item.corridorLow === null || isFiniteNumber(item.corridorLow))
    && (item.corridorHigh === null || isFiniteNumber(item.corridorHigh))
    && typeof item.initialFormation === "boolean"
    && (item.kind === "interaction" ? item.episodeIndex === null : item.episodeIndex !== null)
    && (item.outcome === undefined || item.outcome === null || isNonEmptyString(item.outcome));
}

function isHlineMode(value: unknown): boolean {
  const mode = asRecord(value);
  const ridge = asRecord(mode.ridge);
  return isModeIdentity(mode)
    && isWindowScopedRecord(mode)
    && (mode.role === "support" || mode.role === "resistance")
    && isFiniteNumber(mode.centerPrice)
    && isFiniteNumber(mode.zoneHalfWidth)
    && isFiniteNumber(mode.supportMass)
    && isFiniteNumber(mode.oppositionMass)
    && isFiniteNumber(ridge.lowPrice)
    && isFiniteNumber(ridge.highPrice);
}

function isTrendMode(value: unknown): boolean {
  const mode = asRecord(value);
  const estimate = asRecord(mode.boundaryEstimate);
  const medoid = asRecord(mode.hypothesisMedoid);
  const ribbon = asRecord(mode.ribbon);
  return isModeIdentity(mode)
    && (mode.role === "lower" || mode.role === "upper")
    && isTimestampPriceLine(estimate)
    && isTimestampPriceLine(medoid)
    && isTimestamp(ribbon.fromTimestamp)
    && isTimestamp(ribbon.toTimestamp)
    && [ribbon.lowerFromPrice, ribbon.upperFromPrice, ribbon.lowerToPrice, ribbon.upperToPrice].every(isFiniteNumber)
    && isFiniteNumber(mode.supportMass)
    && isFiniteNumber(mode.oppositionMass)
    && Array.isArray(mode.representativeHypotheses)
    && mode.representativeHypotheses.every((item) => {
      const hypothesis = asRecord(item);
      return isNonEmptyString(hypothesis.hypothesisId)
        && Array.isArray(hypothesis.sourceBasisIds) && hypothesis.sourceBasisIds.every(isNonEmptyString)
        && isTimestampPriceLine(hypothesis)
        && isFiniteNumber(hypothesis.seedMass);
    });
}

function isModeIdentity(mode: Record<string, any>): boolean {
  return isNonEmptyString(mode.fieldModeId)
    && isNonEmptyString(mode.derivationDigest)
    && (mode.modeState === "weak" || mode.modeState === "coherent" || mode.modeState === "opposed");
}

function isTimestampPriceLine(value: Record<string, any>): boolean {
  return isTimestamp(value.fromTimestamp) && isFiniteNumber(value.fromPrice)
    && isTimestamp(value.toTimestamp) && isFiniteNumber(value.toPrice);
}

function trendModeInsideWindow(modeValue: unknown, field: Record<string, any>): boolean {
  const mode = asRecord(modeValue);
  const lines = [mode.hypothesisMedoid, mode.boundaryEstimate, ...(Array.isArray(mode.representativeHypotheses) ? mode.representativeHypotheses : [])];
  const ribbon = asRecord(mode.ribbon);
  const from = Date.parse(field.windowFromTimestamp);
  const to = Date.parse(field.windowToTimestamp);
  return lines.every((value) => {
    const line = asRecord(value);
    return Date.parse(line.fromTimestamp) >= from && Date.parse(line.toTimestamp) <= to;
  }) && Date.parse(ribbon.fromTimestamp) >= from && Date.parse(ribbon.toTimestamp) <= to;
}

function isSelectedModeRef(value: unknown): boolean {
  const item = asRecord(value);
  return isNonEmptyString(item.candidateId)
    && isNonEmptyString(item.sourceInferenceId)
    && (item.kind === "hline" || item.kind === "trend")
    && isNonEmptyString(item.sourceFieldModeId)
    && isNonEmptyString(item.sourceFieldDerivationDigest);
}

function candidateProvenanceIsClosed(pack: CzardasPackContent): boolean {
  const refs = new Map(pack.czardasField.selectedModeRefs.map((value) => {
    const item = asRecord(value);
    return [String(item.candidateId), item];
  }));
  const boundaries = new Map(pack.boundaries.map((boundary) => [boundary.candidateId, boundary]));
  const drawings = new Map(pack.drawings.map((drawing) => [drawing.sourceCandidateId ?? "", drawing]));
  const modes = new Map([...pack.czardasField.hlineModes, ...pack.czardasField.trendModes].map((mode) => [
    `${String(mode.fieldModeId)}:${String(mode.derivationDigest)}`,
    mode
  ]));
  if (refs.size !== pack.czardasField.selectedModeRefs.length
    || boundaries.size !== pack.boundaries.length
    || drawings.size !== pack.drawings.length) return false;
  const ids = [...refs.keys()].sort();
  if (JSON.stringify(ids) !== JSON.stringify([...boundaries.keys()].sort())
    || JSON.stringify(ids) !== JSON.stringify([...drawings.keys()].sort())) return false;
  return ids.every((candidateId) => {
    const reference = refs.get(candidateId);
    const boundary = boundaries.get(candidateId);
    const drawing = drawings.get(candidateId);
    const mode = reference ? modes.get(`${String(reference.sourceFieldModeId)}:${String(reference.sourceFieldDerivationDigest)}`) : null;
    if (!reference || !boundary || !drawing || !mode) return false;
    return reference.sourceInferenceId === pack.inferenceId
      && boundary.sourceInferenceId === pack.inferenceId
      && drawing.sourceInferenceId === pack.inferenceId
      && reference.sourceFieldModeId === boundary.sourceFieldModeId
      && reference.sourceFieldModeId === drawing.sourceFieldModeId
      && reference.sourceFieldDerivationDigest === boundary.sourceFieldDerivationDigest
      && reference.sourceFieldDerivationDigest === drawing.sourceFieldDerivationDigest
      && reference.kind === boundary.kind
      && reference.kind === drawing.czardasLayer
      && mode.role === boundary.role
      && mode.viewRole === "landscape_and_selected";
  }) && derivationEpisodesCloseOverBoundaries(pack, refs, boundaries);
}

function derivationEpisodesCloseOverBoundaries(
  pack: CzardasPackContent,
  refs: Map<string, Record<string, any>>,
  boundaries: Map<string, CzardasBoundary>
): boolean {
  const episodes = pack.czardasField.derivationEpisodes;
  const resolvedByCandidate = new Map<string, Set<string>>();
  const initialByCandidate = new Map<string, Set<string>>();
  for (let index = 0; index < episodes.candidateIndexes.length; index += 1) {
    const candidateIndex = episodes.candidateIndexes[index];
    const reference = pack.czardasField.selectedModeRefs[candidateIndex];
    if (!reference) return false;
    const candidateId = String(asRecord(reference).candidateId ?? "");
    const boundary = boundaries.get(candidateId);
    if (!refs.has(candidateId) || !boundary) return false;
    const ordinal = episodes.candidateEpisodeOrdinals[index];
    const episodeId = boundary.formation.fitEpisodeIds[ordinal];
    if (!episodeId) return false;
    const expectedRoleCode = asRecord(pack.czardasField.basisFacts.roleCodebook)[boundary.role];
    const members = episodes.memberBasisIndexes[index];
    if (!Number.isInteger(expectedRoleCode) || !members.every((basisIndex) => (
      pack.czardasField.basisFacts.roleCodes[basisIndex] === expectedRoleCode
    ))) return false;
    const resolved = resolvedByCandidate.get(candidateId) ?? new Set<string>();
    if (resolved.has(episodeId)) return false;
    resolved.add(episodeId);
    resolvedByCandidate.set(candidateId, resolved);
    if (episodes.initialFormationMasks[index] === 1) {
      const initials = initialByCandidate.get(candidateId) ?? new Set<string>();
      initials.add(episodeId);
      initialByCandidate.set(candidateId, initials);
    }
  }
  return [...refs.keys()].every((candidateId) => {
    const boundary = boundaries.get(candidateId);
    if (!boundary) return false;
    const resolved = [...(resolvedByCandidate.get(candidateId) ?? [])].sort();
    const expected = [...boundary.formation.fitEpisodeIds].sort();
    const initials = [...(initialByCandidate.get(candidateId) ?? [])].sort();
    const expectedInitials = [...boundary.formation.initialFormationEpisodeIds].sort();
    return JSON.stringify(resolved) === JSON.stringify(expected)
      && JSON.stringify(initials) === JSON.stringify(expectedInitials);
  });
}

function isBoundary(value: unknown): boolean {
  const item = asRecord(value);
  const formation = asRecord(item.formation);
  const responses = asRecord(item.responses);
  const rank = asRecord(item.rank);
  const line = asRecord(item.line);
  const explanation = asRecord(item.explanation);
  return isNonEmptyString(item.candidateId)
    && isNonEmptyString(item.sourceInferenceId)
    && isNonEmptyString(item.sourceFieldModeId)
    && isNonEmptyString(item.sourceFieldDerivationDigest)
    && (item.kind === "hline" || item.kind === "trend")
    && (
      (item.kind === "hline" && (item.role === "support" || item.role === "resistance"))
      || (item.kind === "trend" && (item.role === "lower" || item.role === "upper"))
    )
    && (item.evidenceState === "formed" || item.evidenceState === "response_supported")
    && typeof item.isRelevantNow === "boolean"
    && Array.isArray(formation.initialFormationEpisodeIds) && formation.initialFormationEpisodeIds.length === 2
    && formation.initialFormationEpisodeIds.every(isNonEmptyString)
    && new Set(formation.initialFormationEpisodeIds).size === 2
    && Array.isArray(formation.fitEpisodeIds) && formation.fitEpisodeIds.length >= 2
    && formation.fitEpisodeIds.every(isNonEmptyString)
    && new Set(formation.fitEpisodeIds).size === formation.fitEpisodeIds.length
    && formation.initialFormationEpisodeIds.every((id: string) => formation.fitEpisodeIds.includes(id))
    && isFiniteNumber(formation.fitCount) && formation.fitCount === formation.fitEpisodeIds.length
    && isTimestamp(formation.lastFitObservedAt) && isTimestamp(formation.fitEvidenceConfirmedAt) && isFiniteNumber(formation.seedQuality)
    && isFiniteNumber(responses.completedCount) && isFiniteNumber(responses.pendingCount) && isFiniteNumber(responses.responseMass)
    && (responses.lastInteractionAt === null || isTimestamp(responses.lastInteractionAt))
    && isFiniteNumber(rank.rankScore) && isFiniteNumber(rank.responseCount) && isFiniteNumber(rank.responseMass)
    && isFiniteNumber(rank.responseBonus) && isFiniteNumber(rank.profileBonus)
    && Number.isInteger(rank.integrityFactCount) && rank.integrityFactCount >= 0
    && isFiniteNumber(rank.integrityEffectiveFactCount) && rank.integrityEffectiveFactCount >= 0
    && isFiniteNumber(rank.integrityCoverage) && rank.integrityCoverage >= 0 && rank.integrityCoverage <= 1
    && Number.isInteger(rank.bodyPenetrationCount) && rank.bodyPenetrationCount >= 0
    && Number.isInteger(rank.closePenetrationCount) && rank.closePenetrationCount >= 0
    && isFiniteNumber(line.priceAtAsOf) && isFiniteNumber(line.slopePerBar) && isFiniteNumber(line.zoneHalfWidth)
    && isNonEmptyString(explanation.claim)
    && isStringArray(explanation.because) && isStringArray(explanation.against)
    && (explanation.state === "formed" || explanation.state === "response_supported")
    && isNonEmptyString(explanation.invalidationCondition)
    && isNonEmptyString(explanation.dataQualifier);
}

function isPresentationPattern(value: unknown, drawings: DrawingEntity[]): boolean {
  if (value === null) return true;
  const pattern = asRecord(value);
  if (
    !isNonEmptyString(pattern.triangleId)
    || !(pattern.kind === "ascending_triangle" || pattern.kind === "descending_triangle" || pattern.kind === "symmetrical_triangle")
    || !isNonEmptyString(pattern.upperCandidateId)
    || !isNonEmptyString(pattern.lowerCandidateId)
  ) return false;
  const expectedIds = [
    asString(pattern.upperDrawingId) ?? `czardas:${pattern.upperCandidateId}:line`,
    asString(pattern.lowerDrawingId) ?? `czardas:${pattern.lowerCandidateId}:line`
  ];
  return expectedIds.every((id) => drawings.some((drawing) => (
    drawing.id === id && drawing.czardasLayer === "trend" && drawing.sourceGroupId === pattern.triangleId
  )));
}

function isCandleMeanings(
  value: unknown,
  asOf: string,
  windowFromTimestamp: string,
  windowToTimestamp: string
): boolean {
  const meanings = asRecord(value);
  const summaries = asRecord(meanings.summaries);
  const roles = asRecord(meanings.roles);
  const factors = asRecord(meanings.factors);
  const normalizedFactors = asRecord(meanings.normalizedFactors);
  const rawFactorScales = asRecord(meanings.rawFactorScales);
  const rawFactorTransforms = asRecord(meanings.rawFactorTransforms);
  const rawFactorRanges = asRecord(meanings.rawFactorRanges);
  const timestamps = meanings.timestamps;
  const candleKeys = meanings.candleKeys;
  const availabilityMasks = meanings.availabilityMasks;
  const phaseMasks = meanings.phaseMasks;
  const availabilityCodebook = meanings.availabilityCodebook;
  const phaseCodebook = meanings.phaseCodebook;
  const reasonCodebook = meanings.reasonCodebook;
  const reasonMasks = meanings.reasonMasks;
  if (
    meanings.evaluationAsOf !== asOf
    || meanings.normalizedFactorScale !== CZARDAS_RAW_FACTOR_SCALE
    || meanings.scoreScale !== CZARDAS_RAW_FACTOR_SCALE
    || meanings.rawFactorEncoding !== "int16-base64-be"
    || meanings.normalizedFactorEncoding !== "int16-base64-be"
    || meanings.rawFactorNullSentinel !== -32768
    || meanings.normalizedFactorNullSentinel !== -32768
    || meanings.rawFactorOverflowPolicy !== "reject"
    || !isStringArrayOfLength(candleKeys, 240)
    || !isStringArrayOfLength(timestamps, 240) || !timestamps.every(isTimestamp)
    || timestamps[0] !== windowFromTimestamp || timestamps[239] !== windowToTimestamp
    || !strictlyIncreasingTimestamps(timestamps)
    || ![summaries.shared, summaries.hline, summaries.trend].every((items) => isScaledArray(items, 240))
    || !isScaledArray(summaries.compositePercentile, 240, meanings.scoreScale)
    || ![roles.support, roles.resistance, roles.lower, roles.upper].every((items) => isScaledArray(items, 240))
    || !isMaskArray(availabilityMasks) || !isMaskArray(phaseMasks)
    || !isMaskCodebook(availabilityCodebook) || !isMaskCodebook(phaseCodebook)
    || !Array.isArray(reasonCodebook) || !reasonCodebook.every(isReasonCode)
    || meanings.reasonEncoding !== "uint32-bitmask-base64-be"
  ) return false;
  if (!czardasMeaningFactorKeys.every((key) => (
    rawFactorScales[key] === CZARDAS_RAW_FACTOR_SCALE
    && (rawFactorTransforms[key] === "linear" || rawFactorTransforms[key] === "log1p")
    && isFactorRange(rawFactorRanges[key], rawFactorScales[key], rawFactorTransforms[key])
    && isEncodedFactorSeries(factors[key])
    && isEncodedFactorSeries(normalizedFactors[key])
  ))) return false;
  const reasonCodes = new Set(reasonCodebook.map((item) => asRecord(item).code));
  if (reasonCodes.size !== reasonCodebook.length) return false;
  return isEncodedReasonMasks(reasonMasks, reasonCodes as Set<number>);
}

function isFactorRange(value: unknown, scale: number, transform: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isFiniteNumber)) return false;
  const encodedLimit = 32767 / scale;
  const expectedLow = transform === "log1p" ? 0 : -encodedLimit;
  const expectedHigh = transform === "log1p" ? Math.expm1(encodedLimit) : encodedLimit;
  const tolerance = (expected: number) => Math.max(1e-9, Math.abs(expected) * 1e-12);
  return Math.abs(value[0] - expectedLow) <= tolerance(expectedLow)
    && Math.abs(value[1] - expectedHigh) <= tolerance(expectedHigh);
}

function isReasonCode(value: unknown): boolean {
  const reason = asRecord(value);
  return Number.isInteger(reason.code) && reason.code >= 0 && reason.code < 32
    && isNonEmptyString(reason.key)
    && isNonEmptyString(reason.label)
    && ["geometry_input", "fit", "integrity", "response", "visualization_only"].includes(reason.usage)
    && ["shared", "hline", "trend"].includes(reason.channel);
}

function isEncodedReasonMasks(value: unknown, reasonCodes: Set<number>): boolean {
  if (typeof value !== "string" || value.length !== 1280 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return false;
  }
  if (binary.length !== 960) return false;
  let allowed = 0;
  reasonCodes.forEach((code) => { allowed = (allowed | (2 ** code)) >>> 0; });
  for (let index = 0; index < 240; index += 1) {
    const offset = index * 4;
    const mask = (
      binary.charCodeAt(offset) * 0x1000000
      + binary.charCodeAt(offset + 1) * 0x10000
      + binary.charCodeAt(offset + 2) * 0x100
      + binary.charCodeAt(offset + 3)
    ) >>> 0;
    if ((mask & ~allowed) !== 0) return false;
  }
  return true;
}

function isWindowScopedRecord(value: unknown, expected?: Record<string, any>): boolean {
  const item = asRecord(value);
  if (!isTimestamp(item.windowFromTimestamp) || !isTimestamp(item.windowToTimestamp)) return false;
  if (Date.parse(item.windowFromTimestamp) > Date.parse(item.windowToTimestamp)) return false;
  return !expected || (
    item.windowFromTimestamp === expected.windowFromTimestamp
    && item.windowToTimestamp === expected.windowToTimestamp
  );
}

function isStringArrayOfLength(value: unknown, length: number): value is string[] {
  return Array.isArray(value) && value.length === length && value.every(isNonEmptyString);
}

function isScaledArray(value: unknown, length: number, max?: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => (
    Number.isInteger(item) && item >= 0 && (max === undefined || item <= max)
  ));
}

function isEncodedFactorSeries(value: unknown): boolean {
  if (typeof value !== "string" || value.length !== 640 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return atob(value).length === 480;
  } catch {
    return false;
  }
}

function isMaskArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 240
    && value.every((item) => Number.isInteger(item) && item >= 0);
}

function isMaskCodebook(value: unknown): boolean {
  const codebook = asRecord(value);
  return Object.keys(codebook).length > 0
    && Object.values(codebook).every((item) => Number.isInteger(item) && item > 0);
}

function strictlyIncreasingTimestamps(values: string[]): boolean {
  return values.every((value, index) => index === 0 || Date.parse(values[index - 1]) < Date.parse(value));
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

const forbiddenHistoricalContractKeys = new Set([
  "fieldRevision",
  "modelRevision",
  "sourceFieldRevision",
  "engineRevision",
  "lineageFormedAt",
  "revisionFormedAt",
  "firstSeenAt",
  "replayLineageCap",
  "replay_lineage_cap",
  "originFieldModeId",
  "roleMassAtRevision",
  "verificationCount",
  "verification",
  "lifecycle"
]);

function containsHistoricalContract(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsHistoricalContract);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => (
    forbiddenHistoricalContractKeys.has(key) || containsHistoricalContract(item)
  ));
}

function jsonUtf8Size(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function isFreshness(value: unknown): value is CzardasFreshness {
  return value === "current" || value === "stale" || value === "missing" || value === "incompatible";
}

function isFreshnessReason(value: unknown): value is CzardasFreshnessReason {
  return value === "identity_match" || value === "input_changed" || value === "identity_unavailable"
    || value === "asset_missing" || value === "contract_incompatible";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecordValue(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}
