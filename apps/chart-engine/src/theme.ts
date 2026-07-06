import type { ChartDocument } from "./types";

export type ChartDocumentStyle = ChartDocument["style"];

const ink = "#1a1a0e";
const mutedInk = "rgba(26, 26, 14, 0.66)";
const borderInk = "rgba(26, 26, 14, 0.26)";
const gridInk = "rgba(26, 26, 14, 0.08)";
const ma5Ink = "rgba(120, 58, 107, 0.22)";
const ma20Ink = "rgba(120, 58, 107, 0.40)";
const ma60Ink = "rgba(120, 58, 107, 0.68)";
const volumeInk = "rgba(26, 26, 14, 0.12)";

export const fallbackChartStyle: ChartDocumentStyle = {
  background: "#efefe8",
  surface: "#efefe8",
  surfaceStrong: "#efefe8",
  border: borderInk,
  shadow: ink,
  grid: gridInk,
  axis: mutedInk,
  crosshair: ink,
  text: ink,
  muted: mutedInk,
  bullish: "#1b6a29",
  bearish: "#b31a0f",
  ma5: ma5Ink,
  ma20: ma20Ink,
  ma60: ma60Ink,
  volume: volumeInk,
  drawing: ink,
  preview: ink,
  signal: "#1D4D8C",
  caution: "#D99B00",
  purple: "#783A6B"
};

// Compatibility drop-list only: these old defaults are normalized away, not used as the active palette.
const legacyDefaultChartStyle: Partial<ChartDocumentStyle> = {
  background: "#ffffff",
  grid: "#edf1f7",
  text: "#667085",
  bullish: "#16a86b",
  bearish: "#e94b5b",
  ma5: "#2478f2",
  ma20: "#c98210",
  ma60: "#7557d9",
  volume: "#9ca3af"
};

let defaultChartStyle: ChartDocumentStyle = { ...fallbackChartStyle };

export function getDefaultChartStyle(): ChartDocumentStyle {
  return { ...defaultChartStyle };
}

export function setDefaultChartStyle(style: Partial<ChartDocumentStyle>): ChartDocumentStyle {
  defaultChartStyle = { ...fallbackChartStyle, ...compactStyle(style) };
  return getDefaultChartStyle();
}

export function normalizeChartStyle(style: Partial<ChartDocumentStyle> | null | undefined): ChartDocumentStyle {
  return { ...defaultChartStyle, ...compactStyle(style ?? {}, { dropLegacyDefaults: true }) };
}

export function resolveChartStyleColor(
  style: ChartDocumentStyle,
  token: string | undefined,
  fallback: keyof ChartDocumentStyle
): string {
  return token && token in style ? style[token as keyof ChartDocumentStyle] : style[fallback];
}

function compactStyle(
  style: Partial<ChartDocumentStyle>,
  options: { dropLegacyDefaults?: boolean } = {}
): Partial<ChartDocumentStyle> {
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => {
      if (typeof value !== "string" || !value.trim()) {
        return false;
      }
      return !(options.dropLegacyDefaults && legacyDefaultChartStyle[key as keyof ChartDocumentStyle]?.toLowerCase() === value.toLowerCase());
    })
  ) as Partial<ChartDocumentStyle>;
}
