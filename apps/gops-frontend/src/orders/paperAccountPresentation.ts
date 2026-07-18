const HIDDEN_PAPER_ACCOUNT_ERRORS = new Set([
  "simulation_data_unavailable"
]);

export function visiblePaperAccountError(...errors: Array<string | undefined>): string | undefined {
  const error = errors.find((candidate) => Boolean(candidate?.trim()))?.trim();
  return error && !HIDDEN_PAPER_ACCOUNT_ERRORS.has(error) ? error : undefined;
}
