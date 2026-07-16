import { makeChartCommand, type ChartCommand } from "@gops/chart-engine";
import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import type { ChartToolMode, DrawingEntity } from "./types";

export const chartAssetSourcePrefix = "chart-asset:";
export const chartPlanSourcePrefix = "chart-plan:";
export type AnalysisLayerKey = "evidence" | "proposal";
export type AnalysisLayerVisibility = Record<AnalysisLayerKey, boolean>;
export type ChartCommandTarget = ChartCommand["target"];

export function analysisLayerOfDrawing(
  drawing: Pick<DrawingEntity, "id" | "sourceProposalId">
): AnalysisLayerKey | null {
  const identities = [drawing.id, drawing.sourceProposalId ?? ""];
  if (identities.some((identity) => identity.startsWith(chartPlanSourcePrefix))) {
    return "proposal";
  }
  if (identities.some((identity) => identity.startsWith(chartAssetSourcePrefix) && identity.includes(":trade-timing:"))) {
    return "proposal";
  }
  return identities.some((identity) => identity.startsWith(chartAssetSourcePrefix)) ? "evidence" : null;
}

export function isAnalysisDrawing(drawing: Pick<DrawingEntity, "id" | "sourceProposalId">): boolean {
  return analysisLayerOfDrawing(drawing) !== null;
}

/** @deprecated Prefer isAnalysisDrawing; kept for existing callers and saved-chart cleanup. */
export function isChartAssetDrawing(drawing: Pick<DrawingEntity, "id" | "sourceProposalId">): boolean {
  return isAnalysisDrawing(drawing);
}

export function hasAnalysisLayerDrawings(asset: ChartAnalysisAsset | null, layer: AnalysisLayerKey): boolean {
  return asset?.geometry.drawings.some((drawing) => analysisLayerOfDrawing(drawing) === layer) === true;
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
    const layer = analysisLayerOfDrawing(drawing);
    commands.push(externalCommand(target, "chart.drawing.add", {
      drawing: { ...drawing, visible: layer ? visibility[layer] : drawing.visible }
    }));
  });
  (["sma:60", "sma:120"] as const).forEach((layer) => commands.push(externalCommand(target, "chart.layer.visibility.set", { layer, visible: true })));
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
  const layerDrawings = asset.geometry.drawings.filter((drawing) => analysisLayerOfDrawing(drawing) === layer);
  const currentById = new Map(currentDrawings.filter(isAnalysisDrawing).map((drawing) => [drawing.id, drawing]));
  return layerDrawings.flatMap((drawing) => currentById.has(drawing.id)
    ? [externalCommand(target, "chart.drawing.update", { drawingId: drawing.id, drawingPatch: { visible } })]
    : visible ? [externalCommand(target, "chart.drawing.add", { drawing: { ...drawing, visible } })] : []);
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
