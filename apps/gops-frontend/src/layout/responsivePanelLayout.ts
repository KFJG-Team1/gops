import {
  panelGridMetrics,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./panelLayout";

export type WorkspaceLayoutMode = "wide" | "standard" | "compact";

export type ResponsivePanelLayout = {
  mode: WorkspaceLayoutMode;
  metrics: WorkspaceLayoutMetrics;
  renderedCellSize: { width: number; height: number };
};

export const compactGridCellFloorPx = {
  width: 160,
  height: 110
} as const;

const wideGridCellFloorPx = {
  width: 220,
  height: 140
} as const;

export function resolveResponsivePanelLayout(
  viewport: ViewportSize,
  baseMetrics: WorkspaceLayoutMetrics = {}
): ResponsivePanelLayout {
  const naturalMetrics = withoutCellFloors(baseMetrics);
  const grid = panelGridMetrics(viewport, naturalMetrics);
  const uiScale = Math.max(0.1, finiteMetric(baseMetrics.uiScale, 1));
  const renderedCellSize = {
    width: grid.cellWidth * uiScale,
    height: grid.cellHeight * uiScale
  };
  const mode: WorkspaceLayoutMode = renderedCellSize.width >= wideGridCellFloorPx.width
    && renderedCellSize.height >= wideGridCellFloorPx.height
    ? "wide"
    : renderedCellSize.width >= compactGridCellFloorPx.width
      && renderedCellSize.height >= compactGridCellFloorPx.height
      ? "standard"
      : "compact";

  return {
    mode,
    renderedCellSize,
    metrics: mode === "compact"
      ? {
        ...naturalMetrics,
        minCellWidthPx: compactGridCellFloorPx.width,
        minCellHeightPx: compactGridCellFloorPx.height
      }
      : naturalMetrics
  };
}

function withoutCellFloors(metrics: WorkspaceLayoutMetrics): WorkspaceLayoutMetrics {
  const {
    minCellWidthPx: _minCellWidthPx,
    minCellHeightPx: _minCellHeightPx,
    ...rest
  } = metrics;
  return rest;
}

function finiteMetric(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
