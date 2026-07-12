import { makeChartCommand, type ChartCommand } from "@gops/chart-engine";
import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import type { ChartToolMode, DrawingEntity } from "./types";

export const chartAssetSourcePrefix = "chart-asset:";
export type AnalysisLayerKey = "geometry";
export type AnalysisLayerVisibility = Record<AnalysisLayerKey, boolean>;
export type ChartCommandTarget = ChartCommand["target"];

export function isChartAssetDrawing(drawing: Pick<DrawingEntity, "sourceProposalId">): boolean {
  return drawing.sourceProposalId?.startsWith(chartAssetSourcePrefix) === true;
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
  asset.geometry.drawings.forEach((drawing) => commands.push(externalCommand(target, "chart.drawing.add", {
    drawing: { ...drawing, visible: visibility.geometry }
  })));
  (["sma:60", "sma:120"] as const).forEach((layer) => commands.push(externalCommand(target, "chart.layer.visibility.set", { layer, visible: true })));
  if (asset.geometry.drawings.length) {
    commands.push(externalCommand(target, "chart.drawing.clearSelection", { mode: interaction.mode }));
    if (interaction.mode === "select" && interaction.selectedDrawingId && currentDrawings.some((drawing) => drawing.id === interaction.selectedDrawingId && !isChartAssetDrawing(drawing))) {
      commands.push(externalCommand(target, "chart.drawing.select", { drawingId: interaction.selectedDrawingId }));
    }
  }
  return commands;
}

export function analysisLayerToggleCommands(
  target: ChartCommandTarget,
  currentDrawings: DrawingEntity[],
  asset: ChartAnalysisAsset,
  _layer: AnalysisLayerKey,
  visible: boolean
): ChartCommand[] {
  const currentById = new Map(currentDrawings.filter(isChartAssetDrawing).map((drawing) => [drawing.id, drawing]));
  return asset.geometry.drawings.flatMap((drawing) => currentById.has(drawing.id)
    ? [externalCommand(target, "chart.drawing.update", { drawingId: drawing.id, drawingPatch: { visible } })]
    : visible ? [externalCommand(target, "chart.drawing.add", { drawing: { ...drawing, visible } })] : []);
}

export function analysisAssetRemovalCommands(target: ChartCommandTarget, drawings: DrawingEntity[]): ChartCommand[] {
  return removalCommands(target, drawings);
}

function removalCommands(target: ChartCommandTarget, drawings: DrawingEntity[]): ChartCommand[] {
  return drawings.filter(isChartAssetDrawing).map((drawing) => externalCommand(target, "chart.drawing.remove", { drawingId: drawing.id }));
}

function externalCommand(target: ChartCommandTarget, type: ChartCommand["type"], payload: Record<string, unknown>): ChartCommand {
  return makeChartCommand(type, "system", target, payload, undefined, "external");
}
