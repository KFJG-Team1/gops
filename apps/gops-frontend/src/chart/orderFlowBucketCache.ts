import {
  orderFlowMinutesForBucket,
  sumMinuteWindows,
  type OrderFlowLevelDto,
  type OrderFlowMinuteDto
} from "./orderFlow";

export type OrderFlowBucket = {
  key: string;
  label: string;
  levels: OrderFlowLevelDto[];
};

export class OrderFlowBucketCache {
  private readonly entries = new Map<string, OrderFlowBucket>();

  constructor(
    private readonly maxEntries = 512,
    private readonly onCompute?: (bucketStart: string, windowMinutes: number) => void
  ) {}

  get(
    minutes: Map<string, OrderFlowMinuteDto>,
    bucketStart: string,
    windowMinutes: number
  ): OrderFlowBucket {
    const contributing = orderFlowMinutesForBucket(minutes, bucketStart, windowMinutes);
    const key = `${bucketStart}|${windowMinutes}|${minuteWindowVersion(contributing)}`;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const bucket = {
      key,
      label: bucketStart,
      levels: sumMinuteWindows(contributing, "session")
    };
    this.entries.set(key, bucket);
    this.onCompute?.(bucketStart, windowMinutes);
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
    return bucket;
  }

  get size(): number {
    return this.entries.size;
  }
}

function minuteWindowVersion(minutes: OrderFlowMinuteDto[]): string {
  return minutes.map((minute) => {
    const bins = minute.bins.map((level) => [
      level.priceBin,
      level.askVolume,
      level.bidVolume,
      level.unknownVolume,
      level.askTradeCount ?? 0,
      level.bidTradeCount ?? 0,
      level.unknownTradeCount ?? 0
    ].join(",")).join(";");
    return `${minute.eventMinute}:${bins}`;
  }).join("|");
}
