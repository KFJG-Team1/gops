import { makeChartCommand, type ChartCommand, type CzardasSuppression } from "@gops/chart-engine";
import type { CzardasPackContent } from "./czardasAssetsApi";
import type { ChartToolMode, ChartType, DrawingEntity } from "./types";

export type CzardasLayerKey = "hline" | "trend" | "pattern";
export type CzardasLayerVisibility = Record<CzardasLayerKey, boolean>;
type Target = ChartCommand["target"];

export function isManagedCzardasDrawing(drawing: DrawingEntity): boolean {
  return drawing.ownership === "czardas-managed" && Boolean(drawing.sourceCandidateId || drawing.sourceRelationId);
}

export function supportsCzardasManagedDrawings(chartType: ChartType): boolean {
  return chartType === "czardas" || chartType === "candle" || chartType === "line" || chartType === "ohlc";
}

export function czardasDrawingsForChartType(
  drawings: DrawingEntity[],
  chartType: ChartType
): DrawingEntity[] {
  return supportsCzardasManagedDrawings(chartType)
    ? drawings
    : drawings.filter((drawing) => !isManagedCzardasDrawing(drawing));
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
  const suppressed = new Set(suppressions.flatMap((item) => (
    item.sourceKind === "candidate" ? [item.sourceCandidateId ?? item.sourceId]
      : item.sourceKind === "relation" ? [item.sourceRelationId ?? item.sourceId] : []
  )));
  const desired = (pack?.drawings ?? []).filter((drawing) => (
    (drawing.sourceCandidateId || drawing.sourceRelationId)
    && !suppressed.has(drawing.sourceCandidateId ?? drawing.sourceRelationId ?? "")
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
          visible: drawing.visible,
          czardasLayer: drawing.czardasLayer,
          sourceInferenceId: drawing.sourceInferenceId,
          sourceCandidateId: drawing.sourceCandidateId,
          sourceFieldModeId: drawing.sourceFieldModeId,
          sourceFieldDerivationDigest: drawing.sourceFieldDerivationDigest,
          sourceRelationId: drawing.sourceRelationId,
          sourceRelationDerivationDigest: drawing.sourceRelationDerivationDigest,
          updatedAt: drawing.updatedAt
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

export function czardasRestoreCommands(
  target: Target,
  suppressions: CzardasSuppression[],
  pack: CzardasPackContent | null
): ChartCommand[] {
  if (!pack || !suppressions.length) return [];
  const activeSources = new Set(pack.drawings.flatMap((drawing) => (
    drawing.sourceCandidateId ? [drawing.sourceCandidateId]
      : drawing.sourceRelationId ? [drawing.sourceRelationId] : []
  )));
  const activeSetIds = new Set(suppressions.filter((item) => (
    (item.sourceKind === "candidate" && activeSources.has(item.sourceCandidateId ?? item.sourceId))
    || (item.sourceKind === "relation" && activeSources.has(item.sourceRelationId ?? item.sourceId))
  )).map((item) => item.suppressionSetId));
  const commands: ChartCommand[] = [];
  [...activeSetIds].sort().forEach((setId) => {
    const members = suppressions.filter((item) => item.suppressionSetId === setId);
    members.filter((item) => item.sourceKind === "candidate" || item.sourceKind === "relation")
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
      .forEach((item) => commands.push(makeChartCommand("chart.czardas.restoreManaged", "system", target, {
        sourceKind: item.sourceKind,
        sourceId: item.sourceId,
        sourceCandidateId: item.sourceCandidateId,
        sourceRelationId: item.sourceRelationId
      })));
  });
  return commands;
}

function drawingDigest(drawing: DrawingEntity): string {
  return JSON.stringify([
    drawing.anchors,
    drawing.style,
    drawing.label,
    drawing.visible,
    drawing.czardasLayer,
    drawing.sourceInferenceId,
    drawing.sourceCandidateId,
    drawing.sourceFieldModeId,
    drawing.sourceFieldDerivationDigest,
    drawing.sourceRelationId,
    drawing.sourceRelationDerivationDigest,
    drawing.updatedAt
  ]);
}

function external(target: Target, type: ChartCommand["type"], payload: Record<string, unknown>): ChartCommand {
  return makeChartCommand(type, "system", target, payload, undefined, "external");
}
