import { makeChartCommand, type ChartCommand } from "@gops/chart-engine";
import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import type { ChartToolMode, DrawingEntity } from "./types";

export const chartAssetSourcePrefix = "chart-asset:";
export const chartPlanSourcePrefix = "chart-plan:";
export type AnalysisLayerKey = "interpretation" | "levels" | "trend" | "pattern" | "proposal";
export type AnalysisLayerVisibility = Record<AnalysisLayerKey, boolean>;
export type ChartCommandTarget = ChartCommand["target"];

export const defaultAnalysisLayerVisibility: AnalysisLayerVisibility = {
  interpretation: false,
  levels: true,
  trend: true,
  pattern: true,
  proposal: false
};

export function analysisLayerOfDrawing(
  drawing: Pick<DrawingEntity, "id" | "sourceProposalId"> & { type?: string },
  asset?: ChartAnalysisAsset | null
): Exclude<AnalysisLayerKey, "interpretation"> | null {
  const identities = [drawing.id, drawing.sourceProposalId ?? ""];
  if (identities.some((identity) => identity.startsWith(chartPlanSourcePrefix))) return "proposal";
  if (identities.some((identity) => identity.startsWith(chartAssetSourcePrefix) && identity.includes(":trade-timing:"))) return "proposal";
  if (drawing.id.includes(":sma-cross:")) return "trend";

  const groups = asset?.geometry.drawingGroups;
  if (groups) {
    if (groups.levels.includes(drawing.id)) return "levels";
    if (groups.trend.includes(drawing.id)) return "trend";
    if (groups.pattern.includes(drawing.id)) return "pattern";
  }

  if (asset) {
    const levels = [...(asset.geometry.supports ?? []), ...(asset.geometry.resistances ?? [])];
    if (levels.some((level) => drawing.id === level.id || drawing.id.endsWith(`:${level.id}`))) return "levels";
    if ((asset.geometry.trends ?? []).some((trend) => drawing.id === trend.drawingId || drawing.id.endsWith(`:${trend.id}`))) return "trend";
    const patternHashes = [
      ...(asset.geometry.patterns ?? []),
      asset.geometry.primaryPattern,
      asset.geometry.primaryTriangle,
      asset.geometry.historicalTriangle
    ].filter(Boolean).map((pattern) => pattern!.geometryHash);
    if (patternHashes.some((hash) => drawing.id.includes(hash))) return "pattern";
  }

  if (drawing.type === "horizontalLine" && identities.some((identity) => identity.startsWith(chartAssetSourcePrefix))) return "levels";

  // Legacy Geometry assets did not persist drawing groups. Any remaining
  // chart-asset drawing was evidence and is kept visible under Pattern.
  return identities.some((identity) => identity.startsWith(chartAssetSourcePrefix)) ? "pattern" : null;
}

export function isAnalysisDrawing(drawing: Pick<DrawingEntity, "id" | "sourceProposalId"> & { type?: string }): boolean {
  return analysisLayerOfDrawing(drawing) !== null;
}

/** @deprecated Prefer isAnalysisDrawing; kept for existing callers and saved-chart cleanup. */
export function isChartAssetDrawing(drawing: Pick<DrawingEntity, "id" | "sourceProposalId"> & { type?: string }): boolean {
  return isAnalysisDrawing(drawing);
}

export function hasAnalysisLayerDrawings(asset: ChartAnalysisAsset | null, layer: AnalysisLayerKey): boolean {
  if (!asset) return false;
  if (layer === "interpretation") {
    const trace = asset.geometry.analysisTrace;
    return Boolean(
      (trace && (trace.levelCandidates.length || trace.trendCandidates.length || trace.patternCandidates.length))
      || asset.geometry.evidence?.length
    );
  }
  if (layer === "trend" && (asset.indicators.sma60 !== null || asset.indicators.sma120 !== null)) return true;
  return asset.geometry.drawings.some((drawing) => analysisLayerOfDrawing(drawing, asset) === layer);
}

export function analysisAssetApplyCommands(
  target: ChartCommandTarget,
  currentDrawings: DrawingEntity[],
  asset: ChartAnalysisAsset | null,
  visibility: AnalysisLayerVisibility,
  interaction: { mode: ChartToolMode; selectedDrawingId?: string }
): ChartCommand[] {
  const commands = removalCommands(target, currentDrawings);
  if (!asset) return commands;
  asset.geometry.drawings.forEach((drawing) => {
    const layer = analysisLayerOfDrawing(drawing, asset);
    commands.push(externalCommand(target, "chart.drawing.add", {
      drawing: { ...drawing, visible: layer ? visibility[layer] : drawing.visible }
    }));
  });
  (["sma:60", "sma:120"] as const).forEach((layer) => commands.push(externalCommand(target, "chart.layer.visibility.set", {
    layer,
    visible: visibility.trend
  })));
  if (asset.geometry.drawings.length) {
    commands.push(externalCommand(target, "chart.drawing.clearSelection", { mode: interaction.mode }));
    if (interaction.mode === "select" && interaction.selectedDrawingId && currentDrawings.some((drawing) => drawing.id === interaction.selectedDrawingId && !isAnalysisDrawing(drawing))) {
      commands.push(externalCommand(target, "chart.drawing.select", { drawingId: interaction.selectedDrawingId }));
    }
  }
  return commands;
}

export function analysisLayerToggleCommands(
  target: ChartCommandTarget,
  currentDrawings: DrawingEntity[],
  asset: ChartAnalysisAsset,
  layer: AnalysisLayerKey,
  visible: boolean
): ChartCommand[] {
  if (layer === "interpretation") return [];
  const layerDrawings = asset.geometry.drawings.filter((drawing) => analysisLayerOfDrawing(drawing, asset) === layer);
  const currentById = new Map(currentDrawings.filter(isAnalysisDrawing).map((drawing) => [drawing.id, drawing]));
  const commands = layerDrawings.flatMap((drawing) => currentById.has(drawing.id)
    ? [externalCommand(target, "chart.drawing.update", { drawingId: drawing.id, drawingPatch: { visible } })]
    : visible ? [externalCommand(target, "chart.drawing.add", { drawing: { ...drawing, visible } })] : []);
  if (layer === "trend") {
    (["sma:60", "sma:120"] as const).forEach((indicatorLayer) => commands.push(externalCommand(
      target,
      "chart.layer.visibility.set",
      { layer: indicatorLayer, visible }
    )));
  }
  return commands;
}

export function analysisAssetRemovalCommands(target: ChartCommandTarget, drawings: DrawingEntity[]): ChartCommand[] {
  return removalCommands(target, drawings);
}

function removalCommands(target: ChartCommandTarget, drawings: DrawingEntity[]): ChartCommand[] {
  return drawings.filter(isAnalysisDrawing).map((drawing) => externalCommand(target, "chart.drawing.remove", { drawingId: drawing.id }));
}

function externalCommand(target: ChartCommandTarget, type: ChartCommand["type"], payload: Record<string, unknown>): ChartCommand {
  return makeChartCommand(type, "system", target, payload, undefined, "external");
}
