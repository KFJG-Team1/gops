const HIDDEN_PAPER_ACCOUNT_ERRORS = new Set([
  "simulation_data_unavailable",
  "simulation_quote_not_ready",
  "simulation_quote_timeout",
  "simulation_service_unavailable"
]);

export function isTransientPaperAccountError(error: string | undefined): boolean {
  return error ? HIDDEN_PAPER_ACCOUNT_ERRORS.has(normalizePaperAccountError(error)) : false;
}

export function visiblePaperAccountError(...errors: Array<string | undefined>): string | undefined {
  const error = errors.find((candidate) => Boolean(candidate?.trim()))?.trim();
  return error && !isTransientPaperAccountError(error) ? error : undefined;
}

function normalizePaperAccountError(error: string): string {
  return error.trim().replace(/^\d{3}:\s*/, "");
}
