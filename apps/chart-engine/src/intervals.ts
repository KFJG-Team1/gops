const lookbackMinutes24h = 24 * 60;
const lookbackDays1y = 365;
const lookbackMinutes1y = lookbackMinutes24h * lookbackDays1y;

const intervalMinutes: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "10m": 10,
  "1d": lookbackMinutes24h
};

export function candleLimitFor24Hours(interval: string): number {
  const minutes = intervalMinutes[interval] ?? 1;
  return Math.max(1, Math.floor(lookbackMinutes24h / Math.max(1, minutes)));
}

export function candleLimitFor1Year(interval: string): number {
  const minutes = intervalMinutes[interval] ?? 1;
  return Math.max(1, Math.floor(lookbackMinutes1y / Math.max(1, minutes)));
}
