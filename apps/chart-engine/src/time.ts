export function canonicalTimestamp(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}
