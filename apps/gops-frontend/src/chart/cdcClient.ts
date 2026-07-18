import type {
  CandleEventDto,
  ChartCompareRange,
  ChartCompareResponseDto,
  CandleQueryResponseDto,
  ChartInterval,
  ChartSymbolsResponseDto,
  IndicatorPointDto,
  IndicatorSeriesResponseDto,
  VolumeProfileBucketDto,
  VolumeProfileResponseDto
} from "./types";
import {
  derivedClientCacheMaxEntries,
  derivedClientCacheTtlMs,
  stableVolumeProfileRangeKey
} from "./derivedRequestPolicy";
import { indicatorRequestLimitForInterval } from "./indicatorRequestPolicy";
import { normalizeChartEventsResponse, type ChartEventsResponse } from "./chartEvents";

export type CandleQuery = {
  symbol: string;
  interval: ChartInterval;
  limit: number;
  before?: string;
  from?: string;
  to?: string;
  ma?: number[];
  includePreviousClose?: boolean;
};

export type IndicatorQuery = {
  symbol: string;
  interval: ChartInterval;
  layers: string[];
  limit: number;
  from?: string;
  to?: string;
};

export type VolumeProfileQuery = {
  symbol: string;
  interval: ChartInterval;
  from: string;
  to: string;
  targetBins?: number;
  priceMin?: number;
  priceMax?: number;
  priceBinSize?: string;
  candleCount?: number;
};

export type ActiveChartHeartbeat = {
  symbol: string;
  sessionId: string;
  ttlSeconds?: number;
};

export type ChartCompareQuery = {
  symbols: string[];
  range: ChartCompareRange;
};

export type ChartEventsQuery = {
  symbol: string;
  from: string;
  to: string;
  locale?: string;
  upcomingDays?: number;
};

export class ChartApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChartApiError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

type DerivedClientCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const indicatorClientCache = new Map<string, DerivedClientCacheEntry<IndicatorSeriesResponseDto>>();
const volumeProfileClientCache = new Map<string, DerivedClientCacheEntry<VolumeProfileResponseDto>>();

export function invalidateChartDerivedCaches(): void {
  indicatorClientCache.clear();
  volumeProfileClientCache.clear();
}

export async function fetchCandles(query: CandleQuery, signal?: AbortSignal): Promise<CandleQueryResponseDto> {
  const params = new URLSearchParams({
    symbol: query.symbol,
    interval: query.interval,
    limit: String(query.limit),
    ma: (query.ma ?? []).join(",")
  });
  if (query.includePreviousClose) {
    params.set("includePreviousClose", "true");
  }
  if (query.before) {
    params.set("before", query.before);
  }
  if (query.from && query.to) {
    params.set("from", query.from);
    params.set("to", query.to);
  }
  const response = await fetch(`/api/charts/candles?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Candle API failed: ${response.status}`);
  }
  return normalizeCandleResponse(await response.json());
}

export async function fetchChartCompare(query: ChartCompareQuery, signal?: AbortSignal): Promise<ChartCompareResponseDto> {
  const params = new URLSearchParams({
    symbols: query.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean).join(","),
    range: query.range,
    baseMode: "first_close",
    adjustment: "split",
    session: "regular"
  });
  const response = await fetch(`/api/charts/compare?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Compare API failed: ${response.status}`);
  }
  return normalizeCompareResponse(await response.json());
}

export async function fetchIndicators(query: IndicatorQuery, signal?: AbortSignal): Promise<IndicatorSeriesResponseDto> {
  const normalizedQuery = {
    ...query,
    symbol: query.symbol.trim().toUpperCase(),
    limit: indicatorRequestLimitForInterval(query.interval, query.limit)
  };
  const cacheKey = [
    normalizedQuery.symbol,
    normalizedQuery.interval,
    normalizedQuery.from ?? "",
    normalizedQuery.to ?? "",
    normalizedQuery.limit,
    normalizedQuery.layers.join(",")
  ].join("|");
  return cachedDerivedRequest(indicatorClientCache, cacheKey, derivedClientCacheTtlMs.indicators, async () => {
    const params = new URLSearchParams({
      symbol: normalizedQuery.symbol,
      interval: normalizedQuery.interval,
      layers: normalizedQuery.layers.join(","),
      limit: String(normalizedQuery.limit)
    });
    if (normalizedQuery.from && normalizedQuery.to) {
      params.set("from", normalizedQuery.from);
      params.set("to", normalizedQuery.to);
    }
    const response = await fetch(`/api/charts/indicators?${params.toString()}`, { signal });
    if (!response.ok) {
      throw new ChartApiError(`Indicator API failed: ${response.status}`, response.status);
    }
    return normalizeIndicatorResponse(await response.json());
  });
}

export async function fetchVolumeProfile(query: VolumeProfileQuery, signal?: AbortSignal): Promise<VolumeProfileResponseDto> {
  const normalizedQuery = {
    ...query,
    symbol: query.symbol.trim().toUpperCase(),
    targetBins: Math.max(4, Math.min(48, Math.round(query.targetBins ?? 10))),
    priceBinSize: query.priceBinSize ?? "auto",
    candleCount: typeof query.candleCount === "number" && Number.isFinite(query.candleCount)
      ? Math.max(1, Math.round(query.candleCount))
      : undefined
  };
  const cacheKey = stableVolumeProfileRangeKey(normalizedQuery);
  return cachedDerivedRequest(volumeProfileClientCache, cacheKey, derivedClientCacheTtlMs.volumeProfile, async () => {
    const params = new URLSearchParams({
      symbol: normalizedQuery.symbol,
      interval: normalizedQuery.interval,
      from: normalizedQuery.from,
      to: normalizedQuery.to,
      priceBinSize: normalizedQuery.priceBinSize,
      targetBins: String(normalizedQuery.targetBins)
    });
    if (typeof normalizedQuery.priceMin === "number" && Number.isFinite(normalizedQuery.priceMin)) {
      params.set("priceMin", String(normalizedQuery.priceMin));
    }
    if (typeof normalizedQuery.priceMax === "number" && Number.isFinite(normalizedQuery.priceMax)) {
      params.set("priceMax", String(normalizedQuery.priceMax));
    }
    if (typeof normalizedQuery.candleCount === "number" && Number.isFinite(normalizedQuery.candleCount)) {
      params.set("candleCount", String(normalizedQuery.candleCount));
    }
    const response = await fetch(`/api/charts/volume-profile-bins?${params.toString()}`, { signal });
    if (!response.ok) {
      throw new Error(`Volume profile API failed: ${response.status}`);
    }
    return normalizeVolumeProfileResponse(await response.json());
  }, (result) => result.dataStatus !== "partial");
}

export async function fetchChartEvents(query: ChartEventsQuery, signal?: AbortSignal): Promise<ChartEventsResponse> {
  const params = new URLSearchParams({
    symbol: query.symbol.trim().toUpperCase(),
    from: query.from,
    to: query.to,
    locale: query.locale ?? "ko-KR",
    upcomingDays: String(Math.max(1, Math.min(365, Math.round(query.upcomingDays ?? 90))))
  });
  const response = await fetch(`/api/charts/events?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new ChartApiError(`Chart events API failed: ${response.status}`, response.status);
  }
  return normalizeChartEventsResponse(await response.json());
}

export async function fetchSymbols(signal?: AbortSignal): Promise<ChartSymbolsResponseDto> {
  const response = await fetch("/api/charts/symbols", { signal });
  if (!response.ok) {
    throw new Error(`Symbol API failed: ${response.status}`);
  }
  return normalizeSymbolsResponse(await response.json());
}

export async function refreshActiveChartSymbol(body: ActiveChartHeartbeat, signal?: AbortSignal): Promise<void> {
  const response = await fetch("/api/charts/active-symbol", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    throw new Error(`Active chart heartbeat failed: ${response.status}`);
  }
}

export function openChartSocket(
  symbol: string,
  interval: ChartInterval,
  onEvent: (event: CandleEventDto) => void,
  onState: (state: "connecting" | "live" | "idle" | "error") => void,
  options: { orderFlow?: boolean } = {}
): () => void {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    onState("idle");
    return () => undefined;
  }
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let reconnectAttempts = 0;

  const connect = () => {
    if (closed) {
      return;
    }
    const nextSocket = new WebSocket(chartSocketUrl(normalizedSymbol, interval, options));
    socket = nextSocket;
    onState("connecting");
    nextSocket.onopen = () => {
      reconnectAttempts = 0;
      onState("idle");
    };
    nextSocket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload.type === "HEARTBEAT") {
          onState("idle");
          return;
        }
        onEvent(normalizeCandleEvent(payload));
        onState("live");
      } catch {
        onState("error");
      }
    };
    nextSocket.onerror = () => {
      onState("error");
      nextSocket.close();
    };
    nextSocket.onclose = () => {
      if (closed || socket !== nextSocket) {
        return;
      }
      onState("error");
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(connect, reconnectDelayMs(reconnectAttempts));
    };
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
    }
    socket?.close();
  };
}

function chartSocketUrl(symbol: string, interval: ChartInterval, options: { orderFlow?: boolean } = {}): string {
  const params = new URLSearchParams({ symbol, interval });
  if (options.orderFlow) {
    params.set("orderFlow", "true");
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/charts?${params.toString()}`;
}

function cachedDerivedRequest<T>(
  cache: Map<string, DerivedClientCacheEntry<T>>,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<T> {
  const now = Date.now();
  pruneExpiredDerivedEntries(cache, now);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.promise;
  }
  const promise = load()
    .then((value) => {
      if (!shouldCache(value) && cache.get(key)?.promise === promise) {
        cache.delete(key);
      }
      return value;
    })
    .catch((error) => {
      if (cache.get(key)?.promise === promise) {
        cache.delete(key);
      }
      throw error;
    });
  cache.set(key, { expiresAt: now + ttlMs, promise });
  trimDerivedCache(cache);
  return promise;
}

function pruneExpiredDerivedEntries<T>(cache: Map<string, DerivedClientCacheEntry<T>>, now: number): void {
  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(entryKey);
    }
  }
}

function trimDerivedCache<T>(cache: Map<string, DerivedClientCacheEntry<T>>): void {
  while (cache.size > derivedClientCacheMaxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    cache.delete(oldestKey);
  }
}

function reconnectDelayMs(attempts: number): number {
  return Math.min(3_000, 250 * 2 ** Math.min(4, Math.max(0, attempts - 1)));
}

function normalizeCompareResponse(payload: unknown): ChartCompareResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid compare response");
  }
  const source = payload as ChartCompareResponseDto;
  if (!source.range || !Array.isArray(source.items)) {
    throw new Error("Compare response missing required fields");
  }
  return {
    ...source,
    items: source.items
      .filter((item) => item && typeof item.symbol === "string")
      .map((item) => ({
        ...item,
        symbol: item.symbol.trim().toUpperCase(),
        points: Array.isArray(item.points)
          ? item.points
            .filter((point) =>
              point &&
              typeof point.time === "string" &&
              Number.isFinite(point.price) &&
              Number.isFinite(point.returnPercent)
            )
            .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
          : []
      }))
  };
}

function normalizeCandleResponse(payload: unknown): CandleQueryResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid candle response");
  }
  const source = payload as CandleQueryResponseDto;
  if (!source.symbol || !source.interval || !Array.isArray(source.candles)) {
    throw new Error("Candle response missing required fields");
  }
  const status = source.status ?? source.dataStatus ?? (source.candles.length ? "ready" : "empty");
  const request = source.request ?? {
    limit: source.requestedLimit ?? source.candles.length
  };
  return {
    ...source,
    status,
    request,
    candles: source.candles.filter((item) =>
      item &&
      typeof item.timestamp === "string" &&
      Number.isFinite(item.open) &&
      Number.isFinite(item.high) &&
      Number.isFinite(item.low) &&
      Number.isFinite(item.close) &&
      Number.isFinite(item.volume)
    ).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  };
}

function normalizeIndicatorResponse(payload: unknown): IndicatorSeriesResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid indicator response");
  }
  const source = payload as IndicatorSeriesResponseDto;
  if (!source.symbol || !source.interval || !source.series || typeof source.series !== "object") {
    throw new Error("Indicator response missing required fields");
  }
  const normalizedSeries = Object.fromEntries(
    Object.entries(source.series).map(([key, points]) => [
      key,
      Array.isArray(points) ? normalizeIndicatorPoints(points) : []
    ])
  );
  return {
    ...source,
    series: normalizedSeries,
    indicators: Array.isArray(source.indicators)
      ? source.indicators.map((indicator) => ({
          ...indicator,
          points: normalizedSeries[indicator.id] ?? (Array.isArray(indicator.points) ? normalizeIndicatorPoints(indicator.points) : [])
        }))
      : []
  };
}

function normalizeIndicatorPoints(points: IndicatorPointDto[]): IndicatorPointDto[] {
  return points
    .filter((point) => point && typeof point.timestamp === "string")
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function normalizeVolumeProfileResponse(payload: unknown): VolumeProfileResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid volume profile response");
  }
  const source = payload as VolumeProfileResponseDto;
  if (!source.symbol || !Array.isArray(source.bins)) {
    throw new Error("Volume profile response missing required fields");
  }
  const bins = source.bins
    .filter(isVolumeProfileBucket)
    .sort((left, right) => left.priceMin - right.priceMin);
  return {
    ...source,
    interval: source.interval ?? "1m",
    sourceInterval: source.sourceInterval ?? source.interval ?? "1m",
    timeBucket: source.timeBucket ?? source.interval ?? "1m",
    sideClassification: source.sideClassification ?? "estimated",
    targetBins: Number.isFinite(source.targetBins) ? source.targetBins : 10,
    bucketCount: Number.isFinite(source.bucketCount) ? source.bucketCount : bins.length,
    sourceBinCount: Number.isFinite(source.sourceBinCount) ? source.sourceBinCount : bins.length,
    sourceCandleCount: Number.isFinite(source.sourceCandleCount) ? source.sourceCandleCount : source.sourceBinCount,
    requestedCandleCount: Number.isFinite(source.requestedCandleCount) ? source.requestedCandleCount : null,
    totalVolume: Number.isFinite(source.totalVolume) ? source.totalVolume : bins.reduce((sum, bin) => sum + bin.volume, 0),
    totalTradeCount: Number.isFinite(source.totalTradeCount) ? source.totalTradeCount : bins.reduce((sum, bin) => sum + bin.tradeCount, 0),
    bins
  };
}

function isVolumeProfileBucket(value: VolumeProfileBucketDto): value is VolumeProfileBucketDto {
  return Boolean(value) &&
    Number.isFinite(value.index) &&
    Number.isFinite(value.priceMin) &&
    Number.isFinite(value.priceMax) &&
    Number.isFinite(value.priceMid) &&
    Number.isFinite(value.volume);
}

function normalizeSymbolsResponse(payload: unknown): ChartSymbolsResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid symbols response");
  }
  const source = payload as ChartSymbolsResponseDto;
  if (!Array.isArray(source.symbols)) {
    throw new Error("Symbols response missing required fields");
  }
  return {
    symbols: source.symbols.filter((item) =>
      item &&
      typeof item.symbol === "string" &&
      typeof item.name === "string"
    )
  };
}

function normalizeCandleEvent(payload: unknown): CandleEventDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid candle event");
  }
  const source = payload as CandleEventDto;
  if (!source.type || !source.symbol || !source.data) {
    throw new Error("Candle event missing required fields");
  }
  if (source.type === "LIVE_TRADE_UPDATE" || source.type === "LIVE_QUOTE_UPDATE" || source.type === "ORDER_FLOW_BINS_UPDATE") {
    return source;
  }
  if (!source.interval) {
    throw new Error("Candle event missing interval");
  }
  return source;
}
