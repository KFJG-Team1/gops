import { makeChartCommand, type ChartCommand } from "@gops/chart-engine";
import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import type { ChartToolMode, DrawingEntity } from "./types";

export const chartAssetSourcePrefix = "chart-asset:";

export type AnalysisLayerKey = "structure" | "trend" | "agent";
export type AnalysisLayerVisibility = Record<AnalysisLayerKey, boolean>;
export type ChartCommandTarget = ChartCommand["target"];

export function isChartAssetDrawing(drawing: Pick<DrawingEntity, "sourceProposalId">): boolean {
  return drawing.sourceProposalId?.startsWith(chartAssetSourcePrefix) === true;
}

export function assetLayerDrawings(asset: ChartAnalysisAsset, layer: AnalysisLayerKey): DrawingEntity[] {
  return asset.layers[layer].drawings;
}

export function analysisAssetApplyCommands(
  target: ChartCommandTarget,
  currentDrawings: DrawingEntity[],
  asset: ChartAnalysisAsset | null,
  visibility: AnalysisLayerVisibility,
  interaction: { mode: ChartToolMode; selectedDrawingId?: string }
): ChartCommand[] {
  const commands = removalCommands(target, currentDrawings);
  if (!asset) {
    return commands;
  }
  (["structure", "trend", "agent"] as const).forEach((layer) => {
    assetLayerDrawings(asset, layer).forEach((drawing) => {
      commands.push(externalSystemCommand(target, "chart.drawing.add", {
        drawing: { ...drawing, visible: visibility[layer] }
      }));
    });
  });
  const layers = [
    ...asset.chartSetup.alwaysOn,
    ...asset.chartSetup.recommended.slice(0, 2).map((item) => item.layer),
  ];
  [...new Set(layers)].forEach((layer) => {
    commands.push(externalSystemCommand(target, "chart.layer.visibility.set", { layer, visible: true }));
  });
  if (commands.some((command) => command.type === "chart.drawing.add")) {
    commands.push(externalSystemCommand(target, "chart.drawing.clearSelection", { mode: interaction.mode }));
    const retainedSelection = interaction.mode === "select"
      && interaction.selectedDrawingId
      && (
        currentDrawings.some((drawing) => drawing.id === interaction.selectedDrawingId && !isChartAssetDrawing(drawing))
        || Object.values(asset.layers).some((layer) => layer.drawings.some((drawing) => drawing.id === interaction.selectedDrawingId))
      );
    if (retainedSelection) {
      commands.push(externalSystemCommand(target, "chart.drawing.select", { drawingId: interaction.selectedDrawingId }));
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
  const expected = assetLayerDrawings(asset, layer);
  const currentById = new Map(currentDrawings.filter(isChartAssetDrawing).map((drawing) => [drawing.id, drawing]));
  return expected.flatMap((drawing) => {
    const current = currentById.get(drawing.id);
    if (current) {
      return [externalSystemCommand(target, "chart.drawing.update", {
        drawingId: drawing.id,
        drawingPatch: { visible }
      })];
    }
    return visible
      ? [externalSystemCommand(target, "chart.drawing.add", {
        drawing: { ...drawing, visible }
      })]
      : [];
  });
}

export function analysisAssetRemovalCommands(target: ChartCommandTarget, drawings: DrawingEntity[]): ChartCommand[] {
  return removalCommands(target, drawings);
}

function removalCommands(target: ChartCommandTarget, drawings: DrawingEntity[]): ChartCommand[] {
  return drawings
    .filter(isChartAssetDrawing)
    .map((drawing) => externalSystemCommand(target, "chart.drawing.remove", { drawingId: drawing.id }));
}

function externalSystemCommand(
  target: ChartCommandTarget,
  type: ChartCommand["type"],
  payload: Record<string, unknown>
): ChartCommand {
  return makeChartCommand(type, "system", target, payload, undefined, "external");
}
