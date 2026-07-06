import type {
  CandleEventDto,
  CandleQueryResponseDto,
  ChartInterval,
  ChartSymbolsResponseDto,
  FootprintBucketDto,
  FootprintResponseDto,
  IndicatorPointDto,
  IndicatorSeriesResponseDto,
  VolumeProfileBucketDto,
  VolumeProfileResponseDto
} from "./types";

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
};

export type FootprintQuery = {
  symbol: string;
  from: string;
  to: string;
  limit?: number;
};

export type ActiveChartHeartbeat = {
  symbol: string;
  sessionId: string;
  ttlSeconds?: number;
};

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

export async function fetchIndicators(query: IndicatorQuery, signal?: AbortSignal): Promise<IndicatorSeriesResponseDto> {
  const params = new URLSearchParams({
    symbol: query.symbol,
    interval: query.interval,
    layers: query.layers.join(","),
    limit: String(query.limit)
  });
  if (query.from && query.to) {
    params.set("from", query.from);
    params.set("to", query.to);
  }
  const response = await fetch(`/api/charts/indicators?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Indicator API failed: ${response.status}`);
  }
  return normalizeIndicatorResponse(await response.json());
}

export async function fetchVolumeProfile(query: VolumeProfileQuery, signal?: AbortSignal): Promise<VolumeProfileResponseDto> {
  const params = new URLSearchParams({
    symbol: query.symbol,
    interval: query.interval,
    from: query.from,
    to: query.to,
    priceBinSize: query.priceBinSize ?? "auto",
    targetBins: String(query.targetBins ?? 10)
  });
  if (typeof query.priceMin === "number" && Number.isFinite(query.priceMin)) {
    params.set("priceMin", String(query.priceMin));
  }
  if (typeof query.priceMax === "number" && Number.isFinite(query.priceMax)) {
    params.set("priceMax", String(query.priceMax));
  }
  const response = await fetch(`/api/charts/volume-profile-bins?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Volume profile API failed: ${response.status}`);
  }
  return normalizeVolumeProfileResponse(await response.json());
}

export async function fetchFootprint(query: FootprintQuery, signal?: AbortSignal): Promise<FootprintResponseDto> {
  const params = new URLSearchParams({
    symbol: query.symbol,
    from: query.from,
    to: query.to,
    limit: String(query.limit ?? 20000)
  });
  const response = await fetch(`/api/charts/footprint?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Footprint API failed: ${response.status}`);
  }
  return normalizeFootprintResponse(await response.json());
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
  onState: (state: "connecting" | "live" | "idle" | "error") => void
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
    const nextSocket = new WebSocket(chartSocketUrl(normalizedSymbol, interval));
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

function chartSocketUrl(symbol: string, interval: ChartInterval): string {
  const params = new URLSearchParams({ symbol, interval });
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/charts?${params.toString()}`;
}

function reconnectDelayMs(attempts: number): number {
  return Math.min(3_000, 250 * 2 ** Math.min(4, Math.max(0, attempts - 1)));
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

function normalizeFootprintResponse(payload: unknown): FootprintResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid footprint response");
  }
  const source = payload as FootprintResponseDto;
  if (!source.symbol || !Array.isArray(source.buckets)) {
    throw new Error("Footprint response missing required fields");
  }
  const buckets = source.buckets
    .filter(isFootprintBucket)
    .map((bucket) => ({
      ...bucket,
      priceLevels: Array.isArray(bucket.priceLevels)
        ? bucket.priceLevels
            .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.totalVolume))
            .sort((left, right) => right.price - left.price)
        : []
    }))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return {
    ...source,
    interval: "footprint",
    sourceInterval: "1m",
    timeBucket: "1m",
    sideClassification: "estimated",
    dataStatus: source.dataStatus === "pending" || source.dataStatus === "failed"
      ? source.dataStatus
      : buckets.length ? "ready" : "empty",
    tradeCount: Number.isFinite(source.tradeCount) ? source.tradeCount : buckets.reduce((sum, bucket) => sum + bucket.tradeCount, 0),
    quoteCount: Number.isFinite(source.quoteCount) ? source.quoteCount : 0,
    buckets
  };
}

function isFootprintBucket(value: FootprintBucketDto): value is FootprintBucketDto {
  return Boolean(value) &&
    typeof value.timestamp === "string" &&
    Number.isFinite(value.volume) &&
    Number.isFinite(value.askVolume) &&
    Number.isFinite(value.bidVolume) &&
    Number.isFinite(value.unknownVolume) &&
    Number.isFinite(value.delta);
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
  if ((source.type === "LIVE_TRADE_UPDATE" || source.type === "LIVE_QUOTE_UPDATE")) {
    return source;
  }
  if (!source.interval) {
    throw new Error("Candle event missing interval");
  }
  return source;
}
