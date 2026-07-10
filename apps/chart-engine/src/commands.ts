import { cloneChartDocument, restoreChartDocumentSnapshot, snapshotChartDocument } from "./chartDocuments";
import { defaultVisibleBarsForInterval, maxRequestBarsForInterval, normalizeChartInterval } from "./intervals";
import { chartLayerMetadata, layerVisibilityAliases, normalizeChartLayerKey } from "./layers";
import { drawingRegistry, isSupportedDrawing } from "./registries";
import { riskRewardDirection } from "./drawingGeometry";
import { normalizeSupportedSymbol } from "./symbols";
import { clampRightOffset } from "./viewport";
import type {
  ChartCommand,
  ChartCommandActor,
  ChartCommandHistoryScope,
  ChartCommandType,
  ChartDocument,
  ChartDocumentSnapshot,
  ChartHistoryEntry,
  ChartLineExtension,
  ChartLayerKey,
  ChartType,
  ChartProposal,
  ComparisonSeries,
  DrawingAnchor,
  DrawingEntity,
  DrawingStyle,
  DrawingType
} from "./types";

export type ChartCommandResult =
  | { ok: true; document: ChartDocument; message: string; historyEntry?: ChartHistoryEntry; noOp?: boolean }
  | { ok: false; document: ChartDocument; message: string };

const chartTypes: ChartType[] = ["candle", "line", "ohlc", "bidask"];

export function makeChartCommand(
  type: ChartCommandType,
  actor: ChartCommandActor,
  target: ChartCommand["target"],
  payload: Record<string, unknown> = {},
  proposalId?: string,
  historyScope?: ChartCommandHistoryScope
): ChartCommand {
  return {
    id: `chart-command-${crypto.randomUUID()}`,
    type,
    actor,
    target,
    payload,
    createdAt: new Date().toISOString(),
    proposalId,
    historyScope
  };
}

export function executeChartCommand(document: ChartDocument, command: ChartCommand): ChartCommandResult {
  if (command.target.chartDocumentId !== document.id) {
    return { ok: false, document, message: "Chart command target does not match document." };
  }

  if (command.type === "chart.undo") {
    return undoChartDocument(document);
  }

  if (command.type === "chart.redo") {
    return redoChartDocument(document);
  }

  const before = snapshotChartDocument(document);
  const next = cloneChartDocument(document);
  const validation = applyDocumentMutation(next, command);
  if (validation) {
    return { ok: false, document, message: validation };
  }

  next.updatedAt = new Date().toISOString();
  const after = snapshotChartDocument(next);
  if (snapshotsEqual(before, after)) {
    return { ok: true, document, message: "No chart change.", noOp: true };
  }

  if (command.type === "chart.drawing.select" || command.type === "chart.drawing.clearSelection") {
    return {
      ok: true,
      document: next,
      message: labelForCommand(command)
    };
  }

  if (!recordsChartPanelHistory(command)) {
    return {
      ok: true,
      document: next,
      message: labelForCommand(command)
    };
  }

  const historyEntry: ChartHistoryEntry = {
    id: `chart-history-${crypto.randomUUID()}`,
    label: labelForCommand(command),
    commandTypes: [command.type],
    actor: command.actor,
    before,
    after,
    createdAt: new Date().toISOString(),
    proposalId: command.proposalId,
    historyScope: command.historyScope ?? "chartPanel"
  };

  return {
    ok: true,
    document: {
      ...next,
      history: [...document.history, historyEntry].slice(-80),
      future: []
    },
    message: historyEntry.label,
    historyEntry
  };
}

export function executeChartCommandGroup(
  document: ChartDocument,
  commands: ChartCommand[],
  label: string,
  proposalId?: string
): ChartCommandResult {
  if (commands.length === 0) {
    return { ok: false, document, message: "Chart proposal has no commands." };
  }

  const before = snapshotChartDocument(document);
  let next = cloneChartDocument(document);
  const commandTypes: ChartCommandType[] = [];

  for (const command of commands) {
    if (command.target.chartDocumentId !== document.id) {
      return { ok: false, document, message: "Grouped chart command target mismatch." };
    }
    if (command.type === "chart.undo" || command.type === "chart.redo") {
      return { ok: false, document, message: "Undo/redo cannot be part of a proposal group." };
    }
    const validation = applyDocumentMutation(next, command);
    if (validation) {
      return { ok: false, document, message: validation };
    }
    commandTypes.push(command.type);
  }

  next.updatedAt = new Date().toISOString();
  const after = snapshotChartDocument(next);
  if (snapshotsEqual(before, after)) {
    return { ok: true, document, message: "No chart change.", noOp: true };
  }

  const historyEntry: ChartHistoryEntry = {
    id: `chart-history-${crypto.randomUUID()}`,
    label,
    commandTypes,
    actor: commands[0]?.actor ?? "llm",
    before,
    after,
    createdAt: new Date().toISOString(),
    proposalId,
    historyScope: "chartPanel"
  };

  return {
    ok: true,
    document: {
      ...next,
      history: [...document.history, historyEntry].slice(-80),
      future: []
    },
    message: label,
    historyEntry
  };
}

export function validateChartProposal(proposal: ChartProposal): string | null {
  if (!proposal.title.trim() || !proposal.rationale.trim()) {
    return "Chart proposal requires title and rationale.";
  }

  if (proposal.commands.length === 0) {
    return "Chart proposal requires at least one command.";
  }

  const scope = proposal.target.chartDocumentId;
  const allowed = new Set<ChartCommandType>([
    "chart.symbol.set",
    "chart.timeframe.set",
    "chart.type.set",
    "chart.viewport.set",
    "chart.pane.ratio.set",
    "chart.layer.visibility.set",
    "chart.drawing.add",
    "chart.drawing.update",
    "chart.drawing.remove",
    "chart.drawing.select",
    "chart.drawing.clearSelection",
    "chart.comparison.add",
    "chart.comparison.remove",
    "chart.comparison.update"
  ]);

  for (const command of proposal.commands) {
    if (command.target.chartDocumentId !== scope || command.target.panelId !== proposal.target.panelId) {
      return "Chart proposal mixes multiple targets.";
    }
    if (!allowed.has(command.type)) {
      return `Unsupported proposal command: ${command.type}.`;
    }
    if (command.actor !== "llm") {
      return "Chart proposal commands must use llm actor.";
    }
  }

  return null;
}

export function normalizeDrawingFromCommand(command: ChartCommand): DrawingEntity | null {
  if (command.type !== "chart.drawing.add") {
    return null;
  }

  const drawing = normalizeDrawingEntity(command.payload.drawing, command.actor, command.proposalId) ??
    makeDrawingFromPayload(command.payload, command.actor, command.proposalId);

  return drawing && isSupportedDrawing(drawing) ? drawing : null;
}

export function normalizeComparisonFromCommand(command: ChartCommand): ComparisonSeries | null {
  if (command.type !== "chart.comparison.add") {
    return null;
  }

  return normalizeComparisonSeries(command.payload.comparison);
}

export function normalizeDrawingEntity(value: unknown, actor: ChartCommandActor, proposalId?: string): DrawingEntity | null {
  const drawing = readDrawing(value, actor, proposalId);
  return drawing && isSupportedDrawing(drawing) ? drawing : null;
}

export function normalizeComparisonSeries(value: unknown): ComparisonSeries | null {
  return readComparison(value);
}

function applyDocumentMutation(document: ChartDocument, command: ChartCommand): string | null {
  switch (command.type) {
    case "chart.symbol.set": {
      const symbol = readSymbol(command.payload.symbol);
      if (!symbol) {
        return "Invalid chart symbol.";
      }
      document.symbol = symbol;
      document.viewport = { rightOffset: 0, visibleCount: defaultVisibleBarsForInterval(document.timeframe) };
      return null;
    }
    case "chart.timeframe.set": {
      const timeframe = readTimeframe(command.payload.timeframe);
      if (!timeframe) {
        return "Invalid chart timeframe.";
      }
      document.timeframe = timeframe;
      document.viewport = { rightOffset: 0, visibleCount: defaultVisibleBarsForInterval(timeframe) };
      return null;
    }
    case "chart.type.set": {
      const chartType = readChartType(command.payload.chartType);
      if (!chartType) {
        return "Invalid chart type.";
      }
      document.chartType = chartType;
      return null;
    }
    case "chart.viewport.set": {
      const visibleCount = readNumber(command.payload.visibleCount);
      const rightOffset = readNumber(command.payload.rightOffset);
      const nextVisibleCount = visibleCount === null ? document.viewport.visibleCount : clamp(Math.round(visibleCount), 6, maxRequestBarsForInterval(document.timeframe));
      const extraFutureSlots = maxRequestBarsForInterval(document.timeframe);
      document.viewport = {
        visibleCount: nextVisibleCount,
        rightOffset: rightOffset === null
          ? document.viewport.rightOffset
          : clampRightOffset(rightOffset, nextVisibleCount, Math.max(nextVisibleCount, extraFutureSlots), { extraFutureSlots })
      };
      return null;
    }
    case "chart.pane.ratio.set": {
      const paneId = readString(command.payload.paneId);
      const heightRatio = readNumber(command.payload.heightRatio);
      if (!paneId || heightRatio === null) {
        return "Invalid pane ratio payload.";
      }
      const nextRatio = clamp(heightRatio, 0.08, 0.82);
      if (!document.panes.some((pane) => pane.id === paneId)) {
        document.panes = [...document.panes, { id: paneId, heightRatio: nextRatio }];
        return null;
      }
      document.panes = document.panes.map((pane) => (
        pane.id === paneId ? { ...pane, heightRatio: nextRatio } : pane
      ));
      return null;
    }
    case "chart.layer.visibility.set": {
      const layer = readLayer(command.payload.layer);
      const visible = typeof command.payload.visible === "boolean" ? command.payload.visible : null;
      if (!layer || visible === null) {
        return "Invalid layer visibility payload.";
      }
      const nextLayers = { ...document.layers };
      layerVisibilityAliases(layer).forEach((layerKey) => {
        nextLayers[layerKey] = visible;
      });
      document.layers = nextLayers;
      syncLayerPane(document, layer, visible);
      return null;
    }
    case "chart.drawing.add": {
      const drawing = readDrawing(command.payload.drawing, command.actor, command.proposalId) ??
        makeDrawingFromPayload(command.payload, command.actor, command.proposalId);
      if (!drawing || !isSupportedDrawing(drawing)) {
        return "Invalid drawing payload.";
      }
      document.drawings = [...document.drawings.filter((item) => item.id !== drawing.id), drawing];
      document.selectedDrawingId = drawing.id;
      document.interactionState = { ...document.interactionState, mode: "select" };
      return null;
    }
    case "chart.drawing.update": {
      const drawingId = readString(command.payload.drawingId);
      const patch = readObject(command.payload.drawingPatch);
      if (!drawingId || !patch) {
        return "Invalid drawing update payload.";
      }
      const current = document.drawings.find((drawing) => drawing.id === drawingId);
      if (!current || current.locked) {
        return "Drawing not found or locked.";
      }
      const next = mergeDrawingPatch(current, patch);
      if (!isSupportedDrawing(next)) {
        return "Invalid drawing update.";
      }
      document.drawings = document.drawings.map((drawing) => drawing.id === drawingId ? next : drawing);
      return null;
    }
    case "chart.drawing.remove": {
      const drawingId = readString(command.payload.drawingId);
      if (!drawingId) {
        return "Invalid drawing remove payload.";
      }
      if (!document.drawings.some((drawing) => drawing.id === drawingId)) {
        return "Drawing not found.";
      }
      document.drawings = document.drawings.filter((drawing) => drawing.id !== drawingId);
      if (document.selectedDrawingId === drawingId) {
        document.selectedDrawingId = undefined;
      }
      return null;
    }
    case "chart.drawing.select": {
      const drawingId = readString(command.payload.drawingId);
      if (!drawingId || !document.drawings.some((drawing) => drawing.id === drawingId)) {
        return "Drawing not found.";
      }
      document.selectedDrawingId = drawingId;
      return null;
    }
    case "chart.drawing.clearSelection":
      document.selectedDrawingId = undefined;
      if (isToolMode(command.payload.mode)) {
        document.interactionState = { ...document.interactionState, mode: command.payload.mode };
      }
      if (isLineExtension(command.payload.trendLineExtension)) {
        document.interactionState = { ...document.interactionState, trendLineExtension: command.payload.trendLineExtension };
      }
      const parallelLineCount = readNumber(command.payload.parallelLineCount);
      if (parallelLineCount !== null) {
        document.interactionState = { ...document.interactionState, parallelLineCount: normalizeParallelLineCount(parallelLineCount) };
      }
      return null;
    case "chart.comparison.add": {
      const comparison = readComparison(command.payload.comparison);
      if (!comparison) {
        return "Invalid comparison payload.";
      }
      document.comparisons = [...document.comparisons.filter((item) => item.id !== comparison.id), comparison];
      return null;
    }
    case "chart.comparison.update": {
      const comparisonId = readString(command.payload.comparisonId);
      const patch = readObject(command.payload.comparisonPatch) ?? readObject(command.payload.comparison);
      if (!comparisonId || !patch || !document.comparisons.some((item) => item.id === comparisonId)) {
        return "Invalid comparison update payload.";
      }
      document.comparisons = document.comparisons.map((item) => item.id === comparisonId ? {
        ...item,
        ...patch,
        id: item.id,
        symbol: typeof patch.symbol === "string" ? normalizeSupportedSymbol(patch.symbol) ?? item.symbol : item.symbol,
        scaleMode: "percent",
        style: { ...item.style, ...(readObject(patch.style) ?? {}) }
      } : item);
      return null;
    }
    case "chart.comparison.remove": {
      const comparisonId = readString(command.payload.comparisonId);
      if (!comparisonId || !document.comparisons.some((item) => item.id === comparisonId)) {
        return "Comparison not found.";
      }
      document.comparisons = document.comparisons.filter((item) => item.id !== comparisonId);
      return null;
    }
    default:
      return `Unsupported chart command: ${command.type}.`;
  }
}

function syncLayerPane(document: ChartDocument, layer: ChartLayerKey, visible: boolean): void {
  const metadata = chartLayerMetadata[layer];
  if (!metadata || metadata.placement !== "below" || metadata.paneId === "price") {
    return;
  }
  if (visible) {
    if (!document.panes.some((pane) => pane.id === metadata.paneId)) {
      document.panes = [...document.panes, { id: metadata.paneId, heightRatio: 0.22 }];
    }
    return;
  }
  document.panes = document.panes.filter((pane) => pane.id === "price" || pane.id !== metadata.paneId);
}

function undoChartDocument(document: ChartDocument): ChartCommandResult {
  const historyEntry = document.history[document.history.length - 1];
  if (!historyEntry) {
    return { ok: true, document, message: "No chart change.", noOp: true };
  }

  const restored = restoreChartDocumentFields(document, historyEntry.before, historyEntry.commandTypes);
  return {
    ok: true,
    document: {
      ...restored,
      history: document.history.slice(0, -1),
      future: [historyEntry, ...document.future].slice(0, 80)
    },
    message: "Chart undo applied."
  };
}

function redoChartDocument(document: ChartDocument): ChartCommandResult {
  const historyEntry = document.future[0];
  if (!historyEntry) {
    return { ok: true, document, message: "No chart change.", noOp: true };
  }

  const restored = restoreChartDocumentFields(document, historyEntry.after, historyEntry.commandTypes);
  return {
    ok: true,
    document: {
      ...restored,
      history: [...document.history, historyEntry].slice(-80),
      future: document.future.slice(1)
    },
    message: "Chart redo applied."
  };
}

function recordsChartPanelHistory(command: ChartCommand): boolean {
  return command.historyScope !== "external";
}

function restoreChartDocumentFields(
  current: ChartDocument,
  snapshot: ChartDocumentSnapshot,
  commandTypes: ChartCommandType[]
): ChartDocument {
  const restored = restoreChartDocumentSnapshot(current, snapshot);
  const next: ChartDocument = {
    ...current,
    updatedAt: restored.updatedAt
  };
  const typeSet = new Set(commandTypes);

  if (typeSet.has("chart.symbol.set")) {
    next.symbol = restored.symbol;
    next.viewport = { ...restored.viewport };
  }
  if (typeSet.has("chart.timeframe.set")) {
    next.timeframe = restored.timeframe;
    next.viewport = { ...restored.viewport };
  }
  if (typeSet.has("chart.type.set")) {
    next.chartType = restored.chartType;
  }
  if (typeSet.has("chart.viewport.set")) {
    next.viewport = { ...restored.viewport };
  }
  if (typeSet.has("chart.pane.ratio.set")) {
    next.panes = structuredClone(restored.panes) as ChartDocument["panes"];
  }
  if (typeSet.has("chart.layer.visibility.set")) {
    next.layers = { ...restored.layers };
  }
  if (
    typeSet.has("chart.drawing.add") ||
    typeSet.has("chart.drawing.update") ||
    typeSet.has("chart.drawing.remove")
  ) {
    next.drawings = restored.drawings;
    next.selectedDrawingId = restored.selectedDrawingId;
  }
  if (
    typeSet.has("chart.comparison.add") ||
    typeSet.has("chart.comparison.update") ||
    typeSet.has("chart.comparison.remove")
  ) {
    next.comparisons = restored.comparisons;
  }

  return next;
}

function labelForCommand(command: ChartCommand): string {
  switch (command.type) {
    case "chart.symbol.set":
      return `Symbol changed to ${String(command.payload.symbol).toUpperCase()}.`;
    case "chart.timeframe.set":
      return `Timeframe changed to ${String(command.payload.timeframe)}.`;
    case "chart.type.set":
      return `Chart type changed to ${String(command.payload.chartType)}.`;
    case "chart.viewport.set":
      return "Chart viewport changed.";
    case "chart.pane.ratio.set":
      return "Chart pane ratio changed.";
    case "chart.layer.visibility.set":
      return "Chart layer visibility changed.";
    case "chart.drawing.add":
      return "Chart drawing added.";
    case "chart.drawing.update":
      return "Chart drawing updated.";
    case "chart.drawing.remove":
      return "Chart drawing removed.";
    case "chart.drawing.select":
      return "Chart drawing selected.";
    case "chart.drawing.clearSelection":
      return "Chart drawing selection cleared.";
    case "chart.comparison.add":
      return "Comparison added.";
    case "chart.comparison.update":
      return "Comparison updated.";
    case "chart.comparison.remove":
      return "Comparison removed.";
    default:
      return command.type;
  }
}

function snapshotsEqual(left: ReturnType<typeof snapshotChartDocument>, right: ReturnType<typeof snapshotChartDocument>): boolean {
  return left.id === right.id &&
    left.symbol === right.symbol &&
    left.chartType === right.chartType &&
    left.timeframe === right.timeframe &&
    left.viewport.visibleCount === right.viewport.visibleCount &&
    left.viewport.rightOffset === right.viewport.rightOffset &&
    JSON.stringify(left.panes) === JSON.stringify(right.panes) &&
    JSON.stringify(left.layers) === JSON.stringify(right.layers) &&
    JSON.stringify(left.style) === JSON.stringify(right.style) &&
    JSON.stringify(left.interactionState) === JSON.stringify(right.interactionState) &&
    JSON.stringify(left.drawings) === JSON.stringify(right.drawings) &&
    JSON.stringify(left.comparisons) === JSON.stringify(right.comparisons) &&
    left.selectedDrawingId === right.selectedDrawingId;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSymbol(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return normalizeSupportedSymbol(value);
}

function readTimeframe(value: unknown) {
  return normalizeChartInterval(value);
}

function readLayer(value: unknown): ChartLayerKey | null {
  return normalizeChartLayerKey(value);
}

function readChartType(value: unknown): ChartType | null {
  return chartTypes.includes(value as ChartType) ? value as ChartType : null;
}

function isToolMode(value: unknown): value is ChartDocument["interactionState"]["mode"] {
  return value === "select" ||
    value === "pan" ||
    value === "draw-horizontalLine" ||
    value === "draw-horizontalParallelLines" ||
    value === "draw-trendLine" ||
    value === "draw-trendParallelLines" ||
    value === "draw-verticalMarker" ||
    value === "draw-verticalParallelLines" ||
    value === "draw-textLabel" ||
    value === "draw-flagMarker" ||
    value === "draw-rangeBox" ||
    value === "draw-riskRewardBox" ||
    value === "draw-fibonacciRetracement";
}

function isLineExtension(value: unknown): value is ChartLineExtension {
  return value === "segment" || value === "ray" || value === "line";
}

function readDrawingType(value: unknown): DrawingType | null {
  return typeof value === "string" && drawingRegistry[value as DrawingType] ? value as DrawingType : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readAnchor(value: unknown): DrawingAnchor | null {
  const source = readObject(value);
  if (!source) {
    return null;
  }
  const timestamp = readString(source.timestamp);
  const price = readNumber(source.price);
  const logicalIndex = readNumber(source.logicalIndex);
  const anchorValue = readNumber(source.value);
  if (price === null && anchorValue === null) {
    return null;
  }
  return {
    timestamp: timestamp ?? undefined,
    price: price ?? undefined,
    paneId: readString(source.paneId) ?? "price",
    symbol: readString(source.symbol) ?? undefined,
    logicalIndex: logicalIndex ?? undefined,
    value: anchorValue ?? undefined,
    interval: readString(source.interval) ?? undefined
  };
}

function readAnchors(value: unknown): DrawingAnchor[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const anchors = value.map(readAnchor).filter((anchor): anchor is DrawingAnchor => Boolean(anchor));
  return anchors.length === value.length ? anchors : null;
}

function readStyle(value: unknown): DrawingStyle {
  const source = readObject(value) ?? {};
  const color = readString(source.color);
  const fillColor = readString(source.fillColor);
  const textColor = readString(source.textColor);
  return {
    color: color ?? undefined,
    colorToken: readString(source.colorToken) ?? (color ? undefined : "drawing"),
    lineWidth: readNumber(source.lineWidth) ?? 1.0,
    lineDash: Array.isArray(source.lineDash) ? source.lineDash.filter((item): item is number => typeof item === "number") : undefined,
    fillColor: fillColor ?? undefined,
    fillToken: readString(source.fillToken) ?? (fillColor ? undefined : "drawing"),
    fillOpacity: readNumber(source.fillOpacity) ?? undefined,
    textColor: textColor ?? color ?? undefined,
    textToken: readString(source.textToken) ?? (textColor || color ? undefined : "drawing"),
    fontSize: readNumber(source.fontSize) ?? 12,
    opacity: readNumber(source.opacity) ?? 1,
    extension: isLineExtension(source.extension) ? source.extension : undefined
  };
}

function readStylePatch(value: unknown): DrawingStyle {
  const source = readObject(value);
  if (!source) {
    return {};
  }
  const patch: DrawingStyle = {};
  for (const key of ["color", "colorToken", "fillColor", "fillToken", "textColor", "textToken"] as const) {
    if (key in source) {
      patch[key] = readString(source[key]) ?? undefined;
    }
  }
  for (const key of ["lineWidth", "fillOpacity", "fontSize", "opacity"] as const) {
    if (key in source) {
      patch[key] = readNumber(source[key]) ?? undefined;
    }
  }
  if ("lineDash" in source) {
    patch.lineDash = Array.isArray(source.lineDash)
      ? source.lineDash.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : undefined;
  }
  if ("extension" in source) {
    patch.extension = isLineExtension(source.extension) ? source.extension : undefined;
  }
  return patch;
}

function readDrawing(value: unknown, actor: ChartCommandActor, proposalId?: string): DrawingEntity | null {
  const source = readObject(value);
  if (!source) {
    return null;
  }
  const type = readDrawingType(source.type);
  const rawAnchors = readAnchors(source.anchors);
  const anchors = type && rawAnchors ? normalizeDrawingAnchors(type, rawAnchors) : rawAnchors;
  if (!type || !anchors || !anchorsMatchDrawingType(type, anchors)) {
    return null;
  }
  const createdAt = readString(source.createdAt) ?? new Date().toISOString();
  return {
    id: readString(source.id) ?? `drawing-${crypto.randomUUID()}`,
    type,
    anchors,
    sourceInterval: readString(source.sourceInterval) ?? undefined,
    style: readStyle(source.style),
    label: readString(source.label) ?? undefined,
    parallelLineCount: type === "trendParallelLines" ? normalizeParallelLineCount(readNumber(source.parallelLineCount) ?? 3) : undefined,
    locked: typeof source.locked === "boolean" ? source.locked : undefined,
    visible: typeof source.visible === "boolean" ? source.visible : true,
    createdBy: source.createdBy === "llm" || source.createdBy === "system" || source.createdBy === "user" ? source.createdBy : actor,
    sourceProposalId: readString(source.sourceProposalId) ?? proposalId,
    createdAt,
    updatedAt: readString(source.updatedAt) ?? createdAt
  };
}

function makeDrawingFromPayload(payload: Record<string, unknown>, actor: ChartCommandActor, proposalId?: string, forcedType?: DrawingType): DrawingEntity | null {
  const type = forcedType ?? readDrawingType(payload.drawingType);
  const rawAnchors = readAnchors(payload.anchors);
  const anchors = type && rawAnchors ? normalizeDrawingAnchors(type, rawAnchors) : rawAnchors;
  if (!type || !anchors || !anchorsMatchDrawingType(type, anchors)) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: readString(payload.drawingId) ?? `drawing-${crypto.randomUUID()}`,
    type,
    anchors,
    sourceInterval: readString(payload.sourceInterval) ?? undefined,
    style: readStyle(payload.style),
    label: readString(payload.label) ?? undefined,
    parallelLineCount: type === "trendParallelLines" ? normalizeParallelLineCount(readNumber(payload.parallelLineCount) ?? 3) : undefined,
    visible: true,
    createdBy: actor,
    sourceProposalId: proposalId,
    createdAt: now,
    updatedAt: now
  };
}

function anchorsMatchDrawingType(type: DrawingType, anchors: DrawingAnchor[]): boolean {
  if (!anchors.length) {
    return false;
  }
  if (type === "horizontalLine") {
    return hasAnchorValue(anchors[0]);
  }
  if (type === "verticalMarker") {
    return hasAnchorTime(anchors[0]);
  }
  if (type === "textLabel" || type === "flagMarker") {
    return hasAnchorTime(anchors[0]) && hasAnchorValue(anchors[0]);
  }
  const needed = drawingRegistry[type]?.minAnchors ?? 2;
  if (anchors.length < needed || !anchors.slice(0, needed).every((anchor) => hasAnchorTime(anchor) && hasAnchorValue(anchor))) {
    return false;
  }
  if (type === "riskRewardBox") {
    const prices = anchors.slice(0, 3).map((anchor) => anchor.price ?? anchor.value);
    return prices.every((price): price is number => typeof price === "number") &&
      riskRewardDirection(prices[0], prices[1], prices[2]) !== null;
  }
  return true;
}

function hasAnchorTime(anchor: DrawingAnchor): boolean {
  return Boolean(anchor.timestamp) || typeof anchor.logicalIndex === "number";
}

function hasAnchorValue(anchor: DrawingAnchor): boolean {
  return typeof anchor.price === "number" || typeof anchor.value === "number";
}

function mergeDrawingPatch(current: DrawingEntity, patch: Record<string, unknown>): DrawingEntity {
  const rawAnchors = readAnchors(patch.anchors);
  const anchors = rawAnchors ? normalizeDrawingAnchors(current.type, rawAnchors) : null;
  const parallelLineCount = readNumber(patch.parallelLineCount);
  return {
    ...current,
    anchors: anchors ?? current.anchors,
    style: { ...current.style, ...readStylePatch(patch.style) },
    label: typeof patch.label === "string" ? patch.label : current.label,
    parallelLineCount: parallelLineCount === null ? current.parallelLineCount : normalizeParallelLineCount(parallelLineCount),
    visible: typeof patch.visible === "boolean" ? patch.visible : current.visible,
    locked: typeof patch.locked === "boolean" ? patch.locked : current.locked,
    updatedAt: new Date().toISOString()
  };
}

function normalizeDrawingAnchors(type: DrawingType, anchors: DrawingAnchor[]): DrawingAnchor[] {
  if (type !== "riskRewardBox" || anchors.length < 3) {
    return anchors;
  }
  const [entry, stop, target, ...rest] = anchors;
  return [entry, stop, {
    ...target,
    timestamp: stop.timestamp,
    logicalIndex: stop.logicalIndex,
    interval: stop.interval,
    symbol: stop.symbol,
    paneId: stop.paneId
  }, ...rest];
}

function normalizeParallelLineCount(value: number): number {
  return Math.max(2, Math.min(10, Math.round(value)));
}

function readComparison(value: unknown): ComparisonSeries | null {
  const source = readObject(value);
  if (!source) {
    return null;
  }
  const symbol = normalizeSupportedSymbol(typeof source.symbol === "string" ? source.symbol : "");
  if (!symbol) {
    return null;
  }
  return {
    id: readString(source.id) ?? `comparison-${crypto.randomUUID()}`,
    symbol,
    label: readString(source.label) ?? symbol,
    scaleMode: "percent",
    base: readObject(source.base)?.mode === "timestamp" ? {
      mode: "timestamp",
      timestamp: readString(readObject(source.base)?.timestamp) ?? undefined
    } : { mode: "visibleRangeStart" },
    style: readStyle(source.style)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
