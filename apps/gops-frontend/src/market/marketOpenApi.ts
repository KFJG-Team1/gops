export type NextMarketOpen = {
  nextOpenAt: string;
  marketDate: string;
  marketTimezone: string;
  source: string;
  isOpen: boolean;
};

export async function fetchNextMarketOpen(signal?: AbortSignal): Promise<NextMarketOpen> {
  const response = await fetch("/api/market/next-open", {
    headers: { Accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`시장 개장 시간 API 응답 오류 ${response.status}`);
  }
  return normalizeNextMarketOpen(payload);
}

export function normalizeNextMarketOpen(value: unknown): NextMarketOpen {
  const source = asRecord(value);
  const nextOpenAt = asString(source.nextOpenAt);
  if (!nextOpenAt || !Number.isFinite(new Date(nextOpenAt).getTime())) {
    throw new Error("다음 본장 시작 시간을 읽지 못했습니다.");
  }
  return {
    nextOpenAt,
    marketDate: asString(source.marketDate) ?? "",
    marketTimezone: asString(source.marketTimezone) ?? "America/New_York",
    source: asString(source.source) ?? "market-calendar",
    isOpen: source.isOpen === true
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
