import type { ChartDocument } from "./types";

export type ChartDocumentStyle = ChartDocument["style"];

const ink = "#ffffff";
const mutedInk = "#999999";
const borderInk = "#262626";
const gridInk = "rgba(255, 255, 255, 0.08)";
const ma5Ink = "#0099ff";
const ma20Ink = "#22c55e";
const ma60Ink = "#ff7a3d";
const volumeInk = "rgba(255, 255, 255, 0.12)";

export const fallbackChartStyle: ChartDocumentStyle = {
  background: "#090909",
  surface: "#141414",
  surfaceStrong: "#1c1c1c",
  border: borderInk,
  shadow: ink,
  grid: gridInk,
  axis: mutedInk,
  crosshair: ink,
  text: ink,
  muted: mutedInk,
  bullish: "#22c55e",
  bearish: "#ff5577",
  ma5: ma5Ink,
  ma20: ma20Ink,
  ma60: ma60Ink,
  volume: volumeInk,
  drawing: ink,
  preview: ink,
  signal: "#0099ff",
  caution: "#ff7a3d",
  purple: "#8c939f",
  pointYellow: "#fff436",
  pointOrange: "#ff490a",
  pointPurple: "#9c3dff"
};

// Compatibility drop-list only: these old defaults are normalized away, not used as the active palette.
const legacyDefaultChartStyle: Partial<ChartDocumentStyle> = {
  background: "#ffffff",
  grid: "rgba(10, 11, 13, 0.08)",
  text: "#8c939f",
  bullish: "#05b169",
  bearish: "#cf202f",
  ma5: "#0052ff",
  ma20: "#05b169",
  ma60: "#f4b000",
  volume: "rgba(10, 11, 13, 0.12)"
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
