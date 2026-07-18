export type CompanyAnalysisCommand =
  | { status: "none" }
  | { status: "missing_symbol" }
  | { status: "ready"; symbol: string };

type CompanyAnalysisEntity = {
  symbol: string;
  name?: string;
};

const companyAnalysisIntentPattern = /(?:기업|회사|종목)\s*분석/iu;
const tickerBeforeIntentPattern = /(?:^|[^A-Za-z0-9.-])([A-Za-z][A-Za-z0-9.-]{0,9})(?=\s*(?:기업|회사|종목)\s*분석)/iu;
const tickerAfterIntentPattern = /(?:기업|회사|종목)\s*분석(?:을|를)?\s*(?:하자|해줘|해|보자|좀)?\s*[:,-]?\s*([A-Za-z][A-Za-z0-9.-]{0,9})(?:\b|$)/iu;

export function resolveCompanyAnalysisCommand(
  prompt: string,
  contextSymbol?: string | null,
  entities: readonly CompanyAnalysisEntity[] = []
): CompanyAnalysisCommand {
  const text = prompt.trim();
  if (!companyAnalysisIntentPattern.test(text)) {
    return { status: "none" };
  }

  const entitySymbol = entities
    .map((entity) => normalizeCompanyAnalysisSymbol(entity.symbol))
    .find((symbol) => symbol && containsTickerToken(text, symbol));
  const explicitSymbol = entitySymbol
    || normalizeCompanyAnalysisSymbol(tickerBeforeIntentPattern.exec(text)?.[1])
    || normalizeCompanyAnalysisSymbol(tickerAfterIntentPattern.exec(text)?.[1]);
  if (explicitSymbol) {
    return { status: "ready", symbol: explicitSymbol };
  }

  const normalizedContext = normalizeCompanyAnalysisSymbol(contextSymbol);
  return normalizedContext
    ? { status: "ready", symbol: normalizedContext }
    : { status: "missing_symbol" };
}

function normalizeCompanyAnalysisSymbol(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

function containsTickerToken(text: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9.-])${escaped}(?=$|[^A-Za-z0-9.-])`, "iu").test(text);
}
