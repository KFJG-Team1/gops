const logoDevImageBaseUrl = "https://img.logo.dev/ticker";

declare const __GOPS_LOGO_DEV_PUBLISHABLE_KEY__: string | undefined;
declare const __GOPS_LOGO_DEV_ATTRIBUTION__: string | undefined;

type StockLogoUrlOptions = {
  size?: number;
  format?: "webp" | "png" | "jpg";
};

export function buildStockLogoUrl(symbol: string, options: StockLogoUrlOptions = {}): string | null {
  const normalizedSymbol = normalizeStockLogoSymbol(symbol);
  const token = logoDevPublishableKey();
  if (!normalizedSymbol || !token) {
    return null;
  }

  const params = new URLSearchParams({
    token,
    size: String(clampLogoSize(options.size ?? 64)),
    format: options.format ?? "webp",
    fallback: "monogram"
  });

  return `${logoDevImageBaseUrl}/${encodeURIComponent(normalizedSymbol)}?${params.toString()}`;
}

export function stockLogoInitials(symbol: string): string {
  const normalizedSymbol = normalizeStockLogoSymbol(symbol);
  if (!normalizedSymbol) {
    return "?";
  }
  return normalizedSymbol.replace(/[^A-Z0-9]/g, "").slice(0, 3) || normalizedSymbol.slice(0, 1);
}

export function shouldShowLogoDevAttribution(): boolean {
  if (!logoDevPublishableKey()) {
    return false;
  }
  const value = (__GOPS_LOGO_DEV_ATTRIBUTION__ ?? import.meta.env.VITE_LOGO_DEV_ATTRIBUTION)?.trim().toLowerCase();
  return !["0", "false", "off", "no", "hidden"].includes(value ?? "");
}

export function logoDevPublishableKey(): string {
  return (__GOPS_LOGO_DEV_PUBLISHABLE_KEY__ ?? import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY)?.trim() ?? "";
}

export function normalizeStockLogoSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

function clampLogoSize(size: number): number {
  if (!Number.isFinite(size)) {
    return 64;
  }
  return Math.max(16, Math.min(256, Math.round(size)));
}
