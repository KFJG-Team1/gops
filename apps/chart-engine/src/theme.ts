import type { ChartDocument } from "./types";

export type ChartDocumentStyle = ChartDocument["style"];

const ink = "#0a0b0d";
const mutedInk = "#5b616e";
const borderInk = "rgba(10, 11, 13, 0.08)";
const gridInk = "rgba(10, 11, 13, 0.08)";
const ma5Ink = "#0052ff";
const ma20Ink = "#05b169";
const ma60Ink = "#f4b000";
const volumeInk = "rgba(10, 11, 13, 0.12)";

export const fallbackChartStyle: ChartDocumentStyle = {
  background: "#ffffff",
  surface: "rgba(255, 255, 255, 0.68)",
  surfaceStrong: "rgba(255, 255, 255, 0.84)",
  border: borderInk,
  shadow: ink,
  grid: gridInk,
  axis: mutedInk,
  crosshair: ink,
  text: ink,
  muted: mutedInk,
  bullish: "#05b169",
  bearish: "#cf202f",
  ma5: ma5Ink,
  ma20: ma20Ink,
  ma60: ma60Ink,
  volume: volumeInk,
  drawing: ink,
  preview: ink,
  signal: "#0052ff",
  caution: "#f4b000",
  purple: "#8c939f"
};

// Compatibility drop-list only: these old defaults are normalized away, not used as the active palette.
const legacyDefaultChartStyle: Partial<ChartDocumentStyle> = {
  background: "#ffffff",
  grid: gridInk,
  text: "#8c939f",
  bullish: "#05b169",
  bearish: "#cf202f",
  ma5: ma5Ink,
  ma20: ma20Ink,
  ma60: ma60Ink,
  volume: volumeInk
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
