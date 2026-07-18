import { slotCenterToX, type ChartScene } from "./scene";
import { advanceTimestampByInterval } from "./semanticTimeline";
import type { CandleDto, ChartInterval } from "./types";

export type EarningsEventSession = "pre" | "after" | "regular" | "unknown";
export type EarningsEventStatus = "scheduled" | "reported";
export type ChartNewsImpactDirection = "positive" | "negative" | "mixed" | "neutral";

export type ChartEarningsEvent = {
  id: string;
  type: "earnings";
  eventAt: string;
  status: EarningsEventStatus;
  session: EarningsEventSession;
  eps: {
    actual: number | null;
    estimate: number | null;
    surprise: number | null;
    surprisePercent: number | null;
  };
  source: string;
  sourceAsOf: string;
};

export type ChartNewsSource = {
  articleId?: string;
  title: string;
  name?: string;
  url: string;
  publishedAt?: string;
};

export type ChartNewsDay = {
  id: string;
  type: "news";
  date: string;
  articleCount: number;
  summary: string;
  keyPoints: string[];
  impactDirection: ChartNewsImpactDirection;
  sentiment: string;
  sources: ChartNewsSource[];
};

export type UpcomingEarningsEvent = {
  eventAt: string;
  session: EarningsEventSession;
  estimate: number | null;
  daysRemaining: number;
  sourceAsOf: string;
};

export type ChartEventsResponse = {
  symbol: string;
  from: string;
  to: string;
  status: {
    earnings: "ready" | "empty" | "stale";
    news: "ready" | "empty";
  };
  earnings: ChartEarningsEvent[];
  newsDays: ChartNewsDay[];
  upcomingEarnings: UpcomingEarningsEvent | null;
};

export type ChartEventMarker = {
  id: string;
  type: "earnings" | "news";
  marketDate: string;
  x: number;
  top: number;
  label: string;
  impactDirection?: ChartNewsImpactDirection;
  event: ChartEarningsEvent | ChartNewsDay;
};

export type ChartEventCoverage = {
  symbol: string;
  from: string;
  to: string;
};

export type ChartEventMarkerCoordinateSpace = {
  width: number;
  height: number;
};

type SceneCandleUnit = Extract<ChartScene["semantic"]["units"][number], { kind: "candle" }>;

const marketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function chartEventRequestRange(candles: CandleDto[], interval: ChartInterval): { from: string; to: string } | null {
  const first = candles[0]?.timestamp;
  const last = candles[candles.length - 1]?.timestamp;
  const next = last ? advanceTimestampByInterval(last, interval) : null;
  const nextTime = next ? Date.parse(next) : Number.NaN;
  const to = Number.isFinite(nextTime) ? new Date(nextTime - 1).toISOString() : null;
  return first && to ? { from: first, to } : null;
}

export function missingChartEventRanges(
  coverage: ChartEventCoverage | null,
  requested: ChartEventCoverage
): Array<{ from: string; to: string }> {
  if (!coverage || coverage.symbol !== requested.symbol) {
    return [{ from: requested.from, to: requested.to }];
  }
  const ranges: Array<{ from: string; to: string }> = [];
  if (Date.parse(requested.from) < Date.parse(coverage.from)) {
    ranges.push({ from: requested.from, to: coverage.from });
  }
  if (Date.parse(requested.to) > Date.parse(coverage.to)) {
    ranges.push({ from: coverage.to, to: requested.to });
  }
  return ranges.filter((range) => Date.parse(range.to) > Date.parse(range.from));
}

export function mergeChartEventsResponses(
  current: ChartEventsResponse | null,
  incoming: ChartEventsResponse[],
  requested: ChartEventCoverage
): ChartEventsResponse | null {
  const responses = [current, ...incoming]
    .filter((response): response is ChartEventsResponse => Boolean(response) && response?.symbol === requested.symbol);
  if (!responses.length) return null;

  const earnings = new Map<string, ChartEarningsEvent>();
  const newsDays = new Map<string, ChartNewsDay>();
  responses.forEach((response) => {
    response.earnings.forEach((event) => {
      const previous = earnings.get(event.id);
      if (!previous || event.sourceAsOf >= previous.sourceAsOf) earnings.set(event.id, event);
    });
    response.newsDays.forEach((event) => newsDays.set(event.date, event));
  });
  const latestResponse = incoming[incoming.length - 1] ?? current;
  const upcoming = latestResponse?.upcomingEarnings ?? null;
  const incomingEarningsStatuses = incoming.map((response) => response.status.earnings);
  const earningsStatus = incomingEarningsStatuses.includes("stale")
    ? "stale"
    : incomingEarningsStatuses.includes("ready")
      ? "ready"
      : current?.status.earnings ?? "empty";
  return {
    symbol: requested.symbol,
    from: requested.from,
    to: requested.to,
    status: {
      earnings: earningsStatus,
      news: responses.some((response) => response.status.news === "ready") ? "ready" : "empty"
    },
    earnings: Array.from(earnings.values())
      .filter((event) => timestampInRange(event.eventAt, requested.from, requested.to))
      .sort((left, right) => Date.parse(left.eventAt) - Date.parse(right.eventAt)),
    newsDays: Array.from(newsDays.values())
      .filter((event) => event.date >= marketDateForTimestamp(requested.from) && event.date <= marketDateForTimestamp(requested.to))
      .sort((left, right) => left.date.localeCompare(right.date)),
    upcomingEarnings: upcoming
  };
}

export function latestChartEventRefreshRange(range: { from: string; to: string }): { from: string; to: string } {
  const to = Date.parse(range.to);
  return Number.isFinite(to)
    ? { from: new Date(to - 1_000).toISOString(), to: range.to }
    : range;
}

export function normalizeChartEventsResponse(payload: unknown): ChartEventsResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid chart events response");
  }
  const source = payload as Partial<ChartEventsResponse>;
  if (typeof source.symbol !== "string" || typeof source.from !== "string" || typeof source.to !== "string") {
    throw new Error("Chart events response is missing its range");
  }
  return {
    symbol: source.symbol.trim().toUpperCase(),
    from: source.from,
    to: source.to,
    status: {
      earnings: source.status?.earnings === "ready" || source.status?.earnings === "stale" ? source.status.earnings : "empty",
      news: source.status?.news === "ready" ? "ready" : "empty"
    },
    earnings: Array.isArray(source.earnings) ? source.earnings.filter(isChartEarningsEvent) : [],
    newsDays: Array.isArray(source.newsDays) ? source.newsDays.filter(isChartNewsDay) : [],
    upcomingEarnings: isUpcomingEarningsEvent(source.upcomingEarnings) ? source.upcomingEarnings : null
  };
}

export function chartEventMarkersForScene(
  scene: ChartScene,
  response: ChartEventsResponse | null,
  visibility: { earnings: boolean; news: boolean },
  coordinateSpace: ChartEventMarkerCoordinateSpace = scene
): ChartEventMarker[] {
  if (!response || scene.chart.chartType === "bidask") {
    return [];
  }
  const units = scene.semantic.units.filter(
    (unit): unit is SceneCandleUnit => unit.kind === "candle" && unit.depth === 0
  );
  const candidates: Array<Omit<ChartEventMarker, "x" | "top"> & { baseX: number }> = [];
  if (visibility.earnings) {
    response.earnings.forEach((event) => {
      const unit = matchingEventUnit(units, chartEventReferenceTimestamp(event), chartEventMarketDate(event), scene.chart.interval);
      if (!unit) return;
      const baseX = slotCenterToX(scene, unit.slotCenter);
      if (baseX < scene.plot.left || baseX > scene.plot.right) return;
      candidates.push({
        id: event.id,
        type: "earnings",
        marketDate: chartEventMarketDate(event),
        baseX,
        label: "E",
        event
      });
    });
  }
  if (visibility.news) {
    response.newsDays.forEach((event) => {
      const reference = chartEventReferenceTimestamp(event);
      const unit = matchingEventUnit(units, reference, event.date, scene.chart.interval);
      if (!unit) return;
      const baseX = slotCenterToX(scene, unit.slotCenter);
      if (baseX < scene.plot.left || baseX > scene.plot.right) return;
      candidates.push({
        id: event.id,
        type: "news",
        marketDate: event.date,
        baseX,
        label: "N",
        impactDirection: event.impactDirection,
        event
      });
    });
  }

  const groups = new Map<string, typeof candidates>();
  candidates.forEach((marker) => {
    const key = `${marker.marketDate}:${Math.round(marker.baseX)}`;
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  });
  const scaleX = coordinateScale(coordinateSpace.width, scene.width);
  const scaleY = coordinateScale(coordinateSpace.height, scene.height);
  const bottomMarkerTop = Math.max(scene.plot.top + 4, scene.plot.bottom - 28);
  return Array.from(groups.values()).flatMap((group) => {
    const ordered = [...group].sort((left, right) => left.type === right.type ? left.id.localeCompare(right.id) : left.type === "earnings" ? -1 : 1);
    return ordered.map((marker, index) => ({
      id: marker.id,
      type: marker.type,
      marketDate: marker.marketDate,
      x: marker.baseX * scaleX,
      top: Math.max(
        scene.plot.top + 4,
        bottomMarkerTop - (ordered.length - index - 1) * 28
      ) * scaleY,
      label: marker.label,
      impactDirection: marker.impactDirection,
      event: marker.event
    }));
  });
}

export function chartEventMarkerLayoutKey(markers: ChartEventMarker[]): string {
  return markers.map((marker) => `${marker.id}:${Math.round(marker.x)}:${Math.round(marker.top)}`).join("|");
}

export function syncChartEventMarkerPositions(
  container: ParentNode | null,
  markers: ChartEventMarker[]
): void {
  if (!container) return;
  const positions = new Map(markers.map((marker) => [marker.id, marker]));
  container.querySelectorAll<HTMLElement>("[data-chart-event-id]").forEach((element) => {
    const marker = positions.get(element.dataset.chartEventId ?? "");
    if (!marker) {
      element.style.visibility = "hidden";
      return;
    }
    element.style.left = `${marker.x}px`;
    element.style.top = `${marker.top}px`;
    element.style.visibility = "";
  });
}

export function marketDateForTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "";
  const parts = Object.fromEntries(
    marketDateFormatter.formatToParts(parsed).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chartEventReferenceTimestamp(event: ChartEarningsEvent | ChartNewsDay): string {
  if (event.type === "earnings") return event.eventAt;
  const storedTime = event.sources
    .map((source) => source.publishedAt)
    .find((value): value is string => Boolean(value) && marketDateForTimestamp(value as string) === event.date);
  return storedTime ?? `${event.date}T16:00:00.000Z`;
}

export function chartEventMarketDate(event: ChartEarningsEvent | ChartNewsDay): string {
  return event.type === "news" ? event.date : marketDateForTimestamp(event.eventAt);
}

export function chartEventTargetCandleIndex(
  candles: CandleDto[],
  interval: ChartInterval,
  event: ChartEarningsEvent | ChartNewsDay
): number {
  const marketDate = chartEventMarketDate(event);
  const sameDay = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle }) => marketDateForTimestamp(candle.timestamp) === marketDate);
  if (!sameDay.length) return -1;
  if (interval === "1D") return sameDay[0].index;
  const referenceTime = Date.parse(chartEventReferenceTimestamp(event));
  if (!Number.isFinite(referenceTime)) return sameDay[0].index;
  return sameDay.reduce((best, candidate) => (
    Math.abs(Date.parse(candidate.candle.timestamp) - referenceTime)
      < Math.abs(Date.parse(best.candle.timestamp) - referenceTime)
      ? candidate
      : best
  )).index;
}

export function upcomingDailyEventLogicalIndex(candles: CandleDto[], eventAt: string): number | null {
  const latest = candles.at(-1);
  const latestDate = latest ? marketDateForTimestamp(latest.timestamp) : "";
  const eventDate = marketDateForTimestamp(eventAt);
  const latestTime = Date.parse(`${latestDate}T00:00:00.000Z`);
  const eventTime = Date.parse(`${eventDate}T00:00:00.000Z`);
  if (!latest || !Number.isFinite(latestTime) || !Number.isFinite(eventTime) || eventTime <= latestTime) {
    return null;
  }
  const daySlots = Math.max(1, Math.round((eventTime - latestTime) / 86_400_000));
  return candles.length - 1 + daySlots;
}

function matchingEventUnit(
  units: SceneCandleUnit[],
  timestamp: string,
  marketDate: string,
  interval: ChartInterval
) {
  if (!units.length) return undefined;
  if (interval === "1D") {
    return units.find((unit) => marketDateForTimestamp(unit.timestamp) === marketDate);
  }
  const eventTime = Date.parse(timestamp);
  if (interval === "1W" || interval === "1M") {
    return units.find((unit) => {
      const from = Date.parse(unit.from);
      const to = Date.parse(unit.to);
      return Number.isFinite(eventTime) && Number.isFinite(from) && Number.isFinite(to) && eventTime >= from && eventTime < to;
    }) ?? units.find((unit) => marketDateForTimestamp(unit.timestamp) === marketDate);
  }
  const sameDay = units.filter((unit) => marketDateForTimestamp(unit.timestamp) === marketDate);
  if (!sameDay.length) return undefined;
  if (!Number.isFinite(eventTime)) return sameDay[0];
  return sameDay.reduce((best, unit) => (
    Math.abs(Date.parse(unit.timestamp) - eventTime) < Math.abs(Date.parse(best.timestamp) - eventTime) ? unit : best
  ));
}

function isChartEarningsEvent(value: unknown): value is ChartEarningsEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as ChartEarningsEvent;
  return event.type === "earnings" && typeof event.id === "string" && typeof event.eventAt === "string" && Boolean(event.eps);
}

function isChartNewsDay(value: unknown): value is ChartNewsDay {
  if (!value || typeof value !== "object") return false;
  const event = value as ChartNewsDay;
  return event.type === "news" && typeof event.id === "string" && typeof event.date === "string" && Array.isArray(event.sources);
}

function isUpcomingEarningsEvent(value: unknown): value is UpcomingEarningsEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as UpcomingEarningsEvent;
  return typeof event.eventAt === "string" && Number.isFinite(event.daysRemaining);
}

function coordinateScale(localSize: number, sceneSize: number): number {
  return Number.isFinite(localSize) && localSize > 0 && Number.isFinite(sceneSize) && sceneSize > 0
    ? localSize / sceneSize
    : 1;
}

function timestampInRange(timestamp: string, from: string, to: string): boolean {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value >= Date.parse(from) && value <= Date.parse(to);
}
