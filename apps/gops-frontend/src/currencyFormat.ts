type CurrencyFormatOptions = {
  invalidValue?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

const KOREAN_CURRENCY_UNITS = [
  { unit: "조", divisor: 1_000_000_000_000 },
  { unit: "억", divisor: 100_000_000 },
  { unit: "만", divisor: 10_000 }
] as const;

export function formatUsd(
  value: number | null | undefined,
  {
    invalidValue = "--",
    minimumFractionDigits = 2,
    maximumFractionDigits = 2
  }: CurrencyFormatOptions = {}
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalidValue;

  const sign = value < 0 ? "-" : "";
  return `${sign}$${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(Math.abs(value))}`;
}

export function formatKoreanCompactUsd(
  value: number | null | undefined,
  {
    invalidValue = "--",
    minimumFractionDigits = 0,
    maximumFractionDigits = 1
  }: CurrencyFormatOptions = {}
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalidValue;

  const absolute = Math.abs(value);
  const resolvedUnit = KOREAN_CURRENCY_UNITS.find((candidate) => absolute >= candidate.divisor);
  const scaled = resolvedUnit ? absolute / resolvedUnit.divisor : absolute;
  const sign = value < 0 ? "-" : "";
  const formatted = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(scaled);

  return `${sign}$${formatted}${resolvedUnit?.unit ?? ""}`;
}
