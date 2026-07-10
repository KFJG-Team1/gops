import type { ChartCommandType, ChartToolMode, DrawingEntity, DrawingType } from "./types";
import { riskRewardDirection } from "./drawingGeometry";

export type DrawingDefinition = {
  type: DrawingType;
  label: string;
  minAnchors: number;
  maxAnchors: number;
  commandType: ChartCommandType;
};

export type ChartToolDefinition = {
  id: ChartToolMode;
  label: string;
  drawingType?: DrawingType;
};

export const drawingRegistry: Record<DrawingType, DrawingDefinition> = {
  horizontalLine: { type: "horizontalLine", label: "H-Line", minAnchors: 1, maxAnchors: 1, commandType: "chart.drawing.add" },
  horizontalParallelLines: { type: "horizontalParallelLines", label: "Price Parallel", minAnchors: 2, maxAnchors: 2, commandType: "chart.drawing.add" },
  trendLine: { type: "trendLine", label: "Trend", minAnchors: 2, maxAnchors: 2, commandType: "chart.drawing.add" },
  trendParallelLines: { type: "trendParallelLines", label: "Trend Parallel", minAnchors: 3, maxAnchors: 3, commandType: "chart.drawing.add" },
  verticalMarker: { type: "verticalMarker", label: "Marker", minAnchors: 1, maxAnchors: 1, commandType: "chart.drawing.add" },
  verticalParallelLines: { type: "verticalParallelLines", label: "Time Parallel", minAnchors: 2, maxAnchors: 2, commandType: "chart.drawing.add" },
  textLabel: { type: "textLabel", label: "Text", minAnchors: 1, maxAnchors: 1, commandType: "chart.drawing.add" },
  flagMarker: { type: "flagMarker", label: "Flag", minAnchors: 1, maxAnchors: 1, commandType: "chart.drawing.add" },
  rangeBox: { type: "rangeBox", label: "Range", minAnchors: 2, maxAnchors: 2, commandType: "chart.drawing.add" },
  ellipse: { type: "ellipse", label: "Ellipse", minAnchors: 2, maxAnchors: 2, commandType: "chart.drawing.add" },
  riskRewardBox: { type: "riskRewardBox", label: "Risk", minAnchors: 3, maxAnchors: 3, commandType: "chart.drawing.add" },
  fibonacciRetracement: { type: "fibonacciRetracement", label: "Fibo", minAnchors: 2, maxAnchors: 2, commandType: "chart.drawing.add" }
};

export const chartToolRegistry: ChartToolDefinition[] = [
  { id: "select", label: "Select" },
  { id: "pan", label: "Pan" },
  { id: "draw-horizontalLine", label: "H-Line", drawingType: "horizontalLine" },
  { id: "draw-horizontalParallelLines", label: "Price Parallel", drawingType: "horizontalParallelLines" },
  { id: "draw-verticalMarker", label: "Marker", drawingType: "verticalMarker" },
  { id: "draw-verticalParallelLines", label: "Time Parallel", drawingType: "verticalParallelLines" },
  { id: "draw-trendLine", label: "Trend", drawingType: "trendLine" },
  { id: "draw-trendParallelLines", label: "Trend Parallel", drawingType: "trendParallelLines" },
  { id: "draw-textLabel", label: "Text", drawingType: "textLabel" },
  { id: "draw-flagMarker", label: "Flag", drawingType: "flagMarker" },
  { id: "draw-rangeBox", label: "Range", drawingType: "rangeBox" },
  { id: "draw-riskRewardBox", label: "Risk/Reward", drawingType: "riskRewardBox" },
  { id: "draw-fibonacciRetracement", label: "Fibonacci", drawingType: "fibonacciRetracement" }
];

export const commandRegistry = new Set<ChartCommandType>([
  "chart.symbol.set",
  "chart.timeframe.set",
  "chart.type.set",
  "chart.viewport.set",
  "chart.pane.ratio.set",
  "chart.layer.visibility.set",
  "chart.undo",
  "chart.redo",
  "chart.drawing.add",
  "chart.drawing.update",
  "chart.drawing.remove",
  "chart.drawing.select",
  "chart.drawing.clearSelection",
  "chart.preview.set",
  "chart.preview.toggle",
  "chart.preview.apply",
  "chart.preview.clear",
  "chart.comparison.add",
  "chart.comparison.remove",
  "chart.comparison.update"
]);

export const rendererRegistry = [
  "background",
  "grid",
  "volume",
  "candles",
  "comparison",
  "movingAverage",
  "drawing",
  "preview",
  "crosshair",
  "axes"
] as const;

export function drawingNeedsTwoAnchors(type: DrawingType): boolean {
  return drawingRegistry[type]?.minAnchors > 1;
}

export function isSupportedDrawing(entity: DrawingEntity): boolean {
  const definition = drawingRegistry[entity.type];
  if (!definition || entity.anchors.length < definition.minAnchors || entity.anchors.length > definition.maxAnchors) {
    return false;
  }
  if (entity.type === "horizontalLine") {
    return hasAnchorValue(entity.anchors[0]);
  }
  if (entity.type === "verticalMarker") {
    return hasAnchorTime(entity.anchors[0]);
  }
  if (entity.type === "textLabel" || entity.type === "flagMarker") {
    return hasAnchorTime(entity.anchors[0]) && hasAnchorValue(entity.anchors[0]);
  }
  if (entity.type === "riskRewardBox") {
    const [entry, stop, target] = entity.anchors;
    const prices = [entry?.price ?? entry?.value, stop?.price ?? stop?.value, target?.price ?? target?.value];
    return entity.anchors.every((anchor) => hasAnchorTime(anchor) && hasAnchorValue(anchor)) &&
      prices.every((price): price is number => typeof price === "number") &&
      riskRewardDirection(prices[0], prices[1], prices[2]) !== null;
  }
  return entity.anchors.every((anchor) => hasAnchorTime(anchor) && hasAnchorValue(anchor));
}

function hasAnchorTime(anchor: DrawingEntity["anchors"][number] | undefined): boolean {
  return Boolean(anchor?.timestamp) || typeof anchor?.logicalIndex === "number";
}

function hasAnchorValue(anchor: DrawingEntity["anchors"][number] | undefined): boolean {
  return typeof anchor?.price === "number" || typeof anchor?.value === "number";
}
