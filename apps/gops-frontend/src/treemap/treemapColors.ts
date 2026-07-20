import type { ThemeColors } from "../theme/colors";

const minOpacity = 0.48;
const maxOpacity = 0.92;
const flatThreshold = 0.08;
const inverseTextOpacityThreshold = 0.58;
const maxReferencePercentile = 0.95;

export type TreeMapOpacityScale = {
  minOpacity: number;
  maxOpacity: number;
  flatThreshold: number;
  referenceChange: number;
};

export function createTreeMapOpacityScale(changePercents: Array<number | null | undefined>): TreeMapOpacityScale {
  const changes = changePercents
    .map((value) => Number.isFinite(value) ? Math.abs(Number(value)) : null)
    .filter((value): value is number => value !== null && value >= flatThreshold)
    .sort((left, right) => left - right);
  return {
    minOpacity,
    maxOpacity,
    flatThreshold,
    referenceChange: percentile(changes, maxReferencePercentile)
  };
}

export function tileFillForChange(changePercent: number | null | undefined, theme: ThemeColors): string {
  const change = Number.isFinite(changePercent) ? Number(changePercent) : 0;
  if (Math.abs(change) < flatThreshold) {
    return theme.muted;
  }
  return change > 0 ? theme.upSoft : theme.downSoft;
}

export function tileOpacityForChange(changePercent: number | null | undefined, scale: TreeMapOpacityScale): number {
  const change = Number.isFinite(changePercent) ? Math.abs(Number(changePercent)) : 0;
  if (change < scale.flatThreshold || scale.referenceChange <= scale.flatThreshold) {
    return scale.minOpacity;
  }
  const intensity = clamp(change / scale.referenceChange, 0, 1);
  return clamp(scale.minOpacity + intensity * (scale.maxOpacity - scale.minOpacity), scale.minOpacity, scale.maxOpacity);
}

export function tileTextForOpacity(opacity: number, theme: ThemeColors): string {
  return opacity >= inverseTextOpacityThreshold ? theme.tileTextInverse : theme.tileText;
}

export function toneForChange(changePercent: number | null | undefined): "up" | "down" | "flat" {
  const change = Number.isFinite(changePercent) ? Number(changePercent) : 0;
  if (change > flatThreshold) {
    return "up";
  }
  if (change < -flatThreshold) {
    return "down";
  }
  return "flat";
}

export function formatTreeMapChange(changePercent: number | null | undefined): string {
  if (!Number.isFinite(changePercent)) {
    return "—";
  }
  const change = Number(changePercent);
  return `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.ceil(clamp(percentileValue, 0, 1) * values.length) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
