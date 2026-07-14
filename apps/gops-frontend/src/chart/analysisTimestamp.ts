import type { AnalysisAssetInterval } from "./analysisAssetsApi";

const marketDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
});

export function candleKeyForTimestamp(timestamp: string, interval: AnalysisAssetInterval): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (["1m", "5m", "10m", "1h", "4h"].includes(interval)) return parsed.toISOString();
  const utcMidnight = parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0
    && parsed.getUTCSeconds() === 0 && parsed.getUTCMilliseconds() === 0;
  const parts = utcMidnight
    ? { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() }
    : marketDateParts(parsed);
  if (!parts) return null;
  const bucketDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (interval === "1W") {
    bucketDate.setUTCDate(bucketDate.getUTCDate() - ((bucketDate.getUTCDay() + 6) % 7));
  }
  return bucketDate.toISOString().slice(0, 10);
}

function marketDateParts(value: Date): { year: number; month: number; day: number } | null {
  const parts = Object.fromEntries(marketDateFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  return [year, month, day].every(Number.isFinite) ? { year, month, day } : null;
}
