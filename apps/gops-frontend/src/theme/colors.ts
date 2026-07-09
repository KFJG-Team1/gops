import { setDefaultChartStyle, type ChartDocumentStyle } from "@gops/chart-engine/theme";

export type ThemeColorToken =
  | "background"
  | "surface"
  | "surfaceStrong"
  | "text"
  | "muted"
  | "border"
  | "shadow"
  | "up"
  | "upSoft"
  | "down"
  | "downSoft"
  | "changeUp"
  | "changeDown"
  | "ma5"
  | "ma20"
  | "ma60"
  | "drawing"
  | "preview"
  | "footprint"
  | "volume"
  | "grid"
  | "axis"
  | "crosshair"
  | "tileText"
  | "tileTextInverse"
  | "signal"
  | "caution"
  | "purple";

export type ThemeColors = Record<ThemeColorToken, string> & {
  palette: Set<string>;
};

const cssVariableByToken: Record<ThemeColorToken, string> = {
  background: "--color-background",
  surface: "--color-surface",
  surfaceStrong: "--color-surface-strong",
  text: "--color-text",
  muted: "--color-muted",
  border: "--color-border",
  shadow: "--color-shadow",
  up: "--color-up",
  upSoft: "--color-up-soft",
  down: "--color-down",
  downSoft: "--color-down-soft",
  changeUp: "--color-change-up",
  changeDown: "--color-change-down",
  ma5: "--color-ma5",
  ma20: "--color-ma20",
  ma60: "--color-ma60",
  drawing: "--color-drawing",
  preview: "--color-preview",
  footprint: "--color-footprint",
  volume: "--color-volume",
  grid: "--color-grid",
  axis: "--color-axis",
  crosshair: "--color-crosshair",
  tileText: "--color-tile-text",
  tileTextInverse: "--color-tile-text-inverse",
  signal: "--color-signal",
  caution: "--color-caution",
  purple: "--color-purple"
};

const paletteVariables = [
  "--framer-primary",
  "--framer-on-primary",
  "--framer-accent-blue",
  "--framer-ink",
  "--framer-ink-muted",
  "--framer-canvas",
  "--framer-surface-1",
  "--framer-surface-2",
  "--framer-hairline",
  "--framer-hairline-soft",
  "--framer-success",
  "--framer-coral",
  "--framer-orange",
  "--coinbase-primary",
  "--coinbase-primary-active",
  "--coinbase-primary-soft",
  "--coinbase-primary-disabled",
  "--coinbase-ink",
  "--coinbase-ink-soft",
  "--coinbase-body",
  "--coinbase-body-strong",
  "--coinbase-muted",
  "--coinbase-muted-soft",
  "--coinbase-hairline",
  "--coinbase-hairline-strong",
  "--coinbase-hairline-soft",
  "--coinbase-canvas",
  "--coinbase-canvas-left",
  "--coinbase-canvas-right",
  "--coinbase-canvas-mid",
  "--coinbase-canvas-end",
  "--coinbase-panel",
  "--coinbase-panel-strong",
  "--coinbase-panel-muted",
  "--coinbase-rail",
  "--coinbase-shadow-soft",
  "--coinbase-shadow-glow-blue",
  "--coinbase-shadow-glow-green",
  "--coinbase-surface-soft",
  "--coinbase-surface-card",
  "--coinbase-surface-strong",
  "--coinbase-surface-dark",
  "--coinbase-surface-dark-elevated",
  "--coinbase-on-primary",
  "--coinbase-on-dark",
  "--coinbase-on-dark-soft",
  "--coinbase-semantic-up",
  "--coinbase-semantic-up-glow",
  "--coinbase-semantic-down",
  "--coinbase-semantic-down-glow",
  "--coinbase-accent-yellow",
  "--coinbase-accent-yellow-glow",
  "--gops-background",
  "--gops-ink",
  "--gops-down",
  "--gops-up",
  "--gops-signal",
  "--gops-caution",
  "--gops-purple"
];

export function readThemeColors(): ThemeColors {
  const root = getComputedStyle(document.documentElement);
  const read = (name: string) => root.getPropertyValue(name).trim();
  const fallback = read("--gops-ink");
  const palette = new Set(paletteVariables.map(read).filter(Boolean).map((value) => value.toLowerCase()));
  const colors = Object.fromEntries(
    Object.entries(cssVariableByToken).map(([token, variable]) => [token, read(variable) || fallback])
  ) as Record<ThemeColorToken, string>;
  return { ...colors, palette };
}

export function chartDocumentStyleFromTheme(theme: ThemeColors): ChartDocumentStyle {
  return {
    background: theme.background,
    surface: theme.surface,
    surfaceStrong: theme.surfaceStrong,
    border: theme.border,
    shadow: theme.shadow,
    grid: theme.grid,
    axis: theme.axis,
    crosshair: theme.crosshair,
    text: theme.text,
    muted: theme.muted,
    bullish: theme.upSoft,
    bearish: theme.downSoft,
    ma5: theme.ma5,
    ma20: theme.ma20,
    ma60: theme.ma60,
    volume: theme.volume,
    drawing: theme.drawing,
    preview: theme.preview,
    signal: theme.signal,
    caution: theme.caution,
    purple: theme.purple
  };
}

export function syncChartEngineThemeFromCss(): void {
  if (typeof document === "undefined") {
    return;
  }
  setDefaultChartStyle(chartDocumentStyleFromTheme(readThemeColors()));
}

export function resolveThemeColor(theme: ThemeColors, token: ThemeColorToken): string {
  return theme[token] || theme.text;
}

export function resolveRawPaletteColor(theme: ThemeColors, rawColor: string | undefined, fallback: ThemeColorToken): string {
  if (rawColor && theme.palette.has(rawColor.toLowerCase())) {
    return rawColor;
  }
  return resolveThemeColor(theme, fallback);
}
