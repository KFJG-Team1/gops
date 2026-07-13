import { makeChartCommand, type ChartCommand, type CzardasSuppression } from "@gops/chart-engine";
import type { CzardasPackContent } from "./czardasAssetsApi";
import type { ChartToolMode, DrawingEntity } from "./types";

export type CzardasLayerKey = "hline" | "trend";
export type CzardasLayerVisibility = Record<CzardasLayerKey, boolean>;
type Target = ChartCommand["target"];

export function isManagedCzardasDrawing(drawing: DrawingEntity): boolean {
  return drawing.ownership === "czardas-managed" && Boolean(drawing.sourceCandidateId);
}

export function czardasDeltaCommands(
  target: Target,
  currentDrawings: DrawingEntity[],
  suppressions: CzardasSuppression[],
  pack: CzardasPackContent | null,
  visibility: CzardasLayerVisibility,
  interaction: { mode: ChartToolMode; selectedDrawingId?: string },
  stale = false
): ChartCommand[] {
  const current = currentDrawings.filter(isManagedCzardasDrawing);
  const currentById = new Map(current.map((drawing) => [drawing.id, drawing]));
  const suppressed = new Set(suppressions.map((item) => item.sourceCandidateId));
  const desired = (pack?.drawings ?? []).filter((drawing) => (
    drawing.sourceCandidateId && !suppressed.has(drawing.sourceCandidateId)
  )).map((drawing) => ({
    ...drawing,
    visible: visibility[drawing.czardasLayer ?? "trend"],
    style: {
      ...drawing.style,
      opacity: stale ? 0.42 : drawing.style.opacity
    }
  }));
  const desiredById = new Map(desired.map((drawing) => [drawing.id, drawing]));
  const commands: ChartCommand[] = [];
  current.forEach((drawing) => {
    if (!desiredById.has(drawing.id)) {
      commands.push(external(target, "chart.drawing.remove", { drawingId: drawing.id }));
    }
  });
  desired.forEach((drawing) => {
    const existing = currentById.get(drawing.id);
    if (!existing) {
      commands.push(external(target, "chart.drawing.add", { drawing }));
    } else if (drawingDigest(existing) !== drawingDigest(drawing)) {
      commands.push(external(target, "chart.drawing.update", {
        drawingId: drawing.id,
        drawingPatch: {
          anchors: drawing.anchors,
          style: drawing.style,
          label: drawing.label,
          visible: drawing.visible
        }
      }));
    }
  });
  if (commands.length) {
    commands.push(external(target, "chart.drawing.clearSelection", { mode: interaction.mode }));
    if (
      interaction.mode === "select" && interaction.selectedDrawingId
      && currentDrawings.some((drawing) => drawing.id === interaction.selectedDrawingId && !isManagedCzardasDrawing(drawing))
    ) {
      commands.push(external(target, "chart.drawing.select", { drawingId: interaction.selectedDrawingId }));
    }
  }
  return commands;
}

export function czardasToggleCommands(
  target: Target,
  drawings: DrawingEntity[],
  layer: CzardasLayerKey,
  visible: boolean
): ChartCommand[] {
  return drawings.filter((drawing) => isManagedCzardasDrawing(drawing) && drawing.czardasLayer === layer)
    .map((drawing) => external(target, "chart.drawing.update", {
      drawingId: drawing.id,
      drawingPatch: { visible }
    }));
}

function drawingDigest(drawing: DrawingEntity): string {
  return JSON.stringify([drawing.anchors, drawing.style, drawing.label, drawing.visible]);
}

function external(target: Target, type: ChartCommand["type"], payload: Record<string, unknown>): ChartCommand {
  return makeChartCommand(type, "system", target, payload, undefined, "external");
}
