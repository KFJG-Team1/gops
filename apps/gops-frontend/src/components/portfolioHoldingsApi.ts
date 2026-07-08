import { normalizeSector, sectorLabelKo } from "../market/sectors";

export type PortfolioAccount = {
  alias?: string;
  market?: string;
  currency?: string;
  cashKrw?: number | null;
  cashForeign?: number | null;
  stockValueKrw?: number | null;
  stockValueForeign?: number | null;
  totalValueKrw?: number | null;
  totalValueForeign?: number | null;
  unrealizedPnlKrw?: number | null;
  unrealizedPnlForeign?: number | null;
  unrealizedPnlRate?: number | null;
};

export type PortfolioPosition = {
  symbol: string;
  name?: string;
  market?: string;
  exchange?: string;
  currency?: string;
  sector?: string | null;
  industry?: string | null;
  quantity?: number | null;
  availableQuantity?: number | null;
  averagePrice?: number | null;
  currentPrice?: number | null;
  marketValueKrw?: number | null;
  marketValueForeign?: number | null;
  unrealizedPnlKrw?: number | null;
  unrealizedPnlForeign?: number | null;
  unrealizedPnlRate?: number | null;
  sectorLabelKo?: string;
  dayPnlForeign?: number | null;
  dayPnlRate?: number | null;
  peRatio?: number | null;
  epsTtm?: number | null;
  low52?: number | null;
  high52?: number | null;
  marketStatsAsOf?: string | null;
  stats52wSource?: string | null;
  fundamentalsSource?: string | null;
  fundamentalsAsOf?: string | null;
  dividendYield?: number | null;
  dividendPerShare?: number | null;
  annualDividend?: number | null;
  nextDividendDate?: string | null;
  dividendSource?: string | null;
};

export type PortfolioHoldingsResponse = {
  status: "ok" | "empty";
  source?: string;
  asOf?: string;
  account: PortfolioAccount;
  positions: PortfolioPosition[];
  limitations?: string[];
};

type ResponseLike = {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
};

export async function parsePortfolioHoldingsApiResponse(response: ResponseLike): Promise<PortfolioHoldingsResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();
  const payload = parseJsonBody(bodyText, contentType);

  if (!response.ok) {
    throw new Error(apiErrorMessage(response, payload, bodyText));
  }

  if (!isPortfolioHoldingsResponse(payload)) {
    throw new Error(bodyText.trim() ? "보유종목 API 응답 형식이 올바르지 않습니다." : "보유종목 API 응답이 비어 있습니다.");
  }

  return normalizePortfolioHoldingsResponse(payload);
}

function normalizePortfolioHoldingsResponse(payload: PortfolioHoldingsResponse): PortfolioHoldingsResponse {
  return {
    ...payload,
    positions: payload.positions.map((position) => {
      const sector = normalizeSector(position.sector);
      return {
        ...position,
        sector,
        sectorLabelKo: position.sectorLabelKo || sectorLabelKo(sector)
      };
    })
  };
}

function parseJsonBody(bodyText: string, contentType: string): unknown {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return undefined;
  }
  if (contentType && !contentType.toLowerCase().includes("json")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function apiErrorMessage(response: Pick<ResponseLike, "status" | "statusText">, payload: unknown, bodyText: string) {
  const detail = extractErrorDetail(payload);
  if (detail) {
    return detail;
  }

  const plainText = bodyText.trim();
  if (plainText) {
    return firstLine(plainText);
  }

  const suffix = response.statusText ? ` ${response.statusText}` : "";
  return `보유종목 API 오류 ${response.status}${suffix}`;
}

function extractErrorDetail(payload: unknown) {
  if (!isRecord(payload)) {
    return "";
  }
  const detail = payload.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(", ");
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return "";
}

function firstLine(value: string) {
  const [line] = value.split(/\r?\n/);
  return line.slice(0, 160);
}

function isPortfolioHoldingsResponse(value: unknown): value is PortfolioHoldingsResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (value.status === "ok" || value.status === "empty") && isRecord(value.account) && Array.isArray(value.positions);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
