import { normalizeChartExplanation, type ChartExplanation, type ComparableChartAssetIdentity } from "./chartExplanation";
import {
  normalizeFinalAnswer,
  type AgentAnalysisReport,
  type FinalAnswer
} from "../agents/agentAnalysis";
import {
  addPanelSlotAtGridRect,
  canPlaceGridRect,
  resolveFirstAvailableRecommendedGridRect,
  setPanelContentProps,
  type PanelGridRect,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "../layout/panelLayout";
import { userVisibleWarnings } from "../layout/wildPanel";

export const chartCommentaryHistoryLimit = 5;

export type ChartCommentaryRequestSnapshot = ComparableChartAssetIdentity & {
  chartDocumentId: string;
  sourcePanelId?: string;
  symbol: string;
  interval: string;
  asOf?: string;
};

export type ChartCommentaryPending = {
  requestId: string;
  question: string;
  requestedAt: string;
  snapshot: ChartCommentaryRequestSnapshot;
};

export type ChartCommentaryAnswer = {
  analysisId: string;
  question: string;
  createdAt: string;
  symbol: string;
  interval: string;
  asOf: string;
  finalAnswer: FinalAnswer;
  warnings: string[];
  chartExplanation: ChartExplanation;
};

export type ChartCommentaryState = {
  version: "chart-commentary-history.v2";
  chartDocumentId: string;
  mode: "commentary" | "conversation";
  turns: ChartCommentaryAnswer[];
  pending: ChartCommentaryPending | null;
};

export type EnsureChartCommentaryResult = {
  state: TiledPanelState;
  contentId: string | null;
  created: boolean;
};

export function ensureChartCommentaryPanel(
  state: TiledPanelState,
  source: ChartCommentaryRequestSnapshot,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {}
): EnsureChartCommentaryResult {
  const exact = Object.values(state.contents).find((content) => (
    content.kind === "chartCommentary" && readString(content.props?.chartDocumentId) === source.chartDocumentId
  ));
  if (exact) return { state, contentId: exact.id, created: false };

  const legacy = Object.values(state.contents).find((content) => (
    content.kind === "chartCommentary" && !readString(content.props?.chartDocumentId)
  ));
  if (legacy) {
    return {
      state: setPanelContentProps(state, legacy.id, {
        chartDocumentId: source.chartDocumentId,
        commentaryState: emptyChartCommentaryState(source.chartDocumentId)
      }),
      contentId: legacy.id,
      created: false
    };
  }

  const sourceSlot = state.slots.find((slot) => {
    const content = state.contents[slot.contentId];
    return content?.kind === "chart" && (
      content.id === source.sourcePanelId || content.chartDocumentId === source.chartDocumentId
    );
  });
  const gridRect = sourceSlot
    ? chartCommentaryGridRect(state, sourceSlot.gridRect, viewport.width)
    : resolveFirstAvailableRecommendedGridRect(state, "chartCommentary");
  if (!gridRect) return { state, contentId: null, created: false };
  const contentId = `content-chartCommentary-${state.nextInstance}`;
  const next = addPanelSlotAtGridRect(state, "chartCommentary", gridRect, {
    props: {
      chartDocumentId: source.chartDocumentId,
      commentaryState: emptyChartCommentaryState(source.chartDocumentId)
    }
  }, viewport, layoutMetrics);
  return next.contents[contentId]
    ? { state: next, contentId, created: true }
    : { state, contentId: null, created: false };
}

export function beginChartCommentaryRequest(
  state: TiledPanelState,
  source: ChartCommentaryRequestSnapshot,
  requestId: string,
  question: string,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {},
  requestedAt = new Date().toISOString()
): EnsureChartCommentaryResult {
  const ensured = ensureChartCommentaryPanel(state, source, viewport, layoutMetrics);
  if (!ensured.contentId) return ensured;
  const content = ensured.state.contents[ensured.contentId];
  const commentaryState = normalizeChartCommentaryState(content?.props?.commentaryState, source.chartDocumentId);
  return {
    ...ensured,
    state: setPanelContentProps(ensured.state, ensured.contentId, {
      chartDocumentId: source.chartDocumentId,
      commentaryState: {
        ...commentaryState,
        mode: "commentary",
        pending: { requestId, question, requestedAt, snapshot: source }
      }
    })
  };
}

export function updateChartCommentaryRequestId(
  state: TiledPanelState,
  chartDocumentId: string,
  previousRequestId: string,
  requestId: string
): TiledPanelState {
  return updateCommentaryForDocument(state, chartDocumentId, (commentaryState) => (
    commentaryState.pending?.requestId === previousRequestId
      ? { ...commentaryState, pending: { ...commentaryState.pending, requestId } }
      : commentaryState
  ));
}

export function clearChartCommentaryPending(
  state: TiledPanelState,
  chartDocumentId: string
): TiledPanelState {
  return updateCommentaryForDocument(state, chartDocumentId, (commentaryState) => (
    commentaryState.pending
      ? {
        ...commentaryState,
        mode: commentaryState.turns.length > 0 ? commentaryState.mode : "commentary",
        pending: null
      }
      : commentaryState
  ));
}

export function attachChartCommentaryReport(
  state: TiledPanelState,
  source: ChartCommentaryRequestSnapshot,
  report: AgentAnalysisReport,
  question: string,
  viewport: ViewportSize,
  layoutMetrics: WorkspaceLayoutMetrics = {},
  createdAt = new Date().toISOString()
): EnsureChartCommentaryResult {
  const explanation = report.chartExplanation;
  const finalAnswer = report.finalAnswer;
  if (!explanation || !finalAnswer) {
    return { state: clearChartCommentaryPending(state, source.chartDocumentId), contentId: null, created: false };
  }
  const ensured = ensureChartCommentaryPanel(state, source, viewport, layoutMetrics);
  if (!ensured.contentId) return ensured;
  const content = ensured.state.contents[ensured.contentId];
  const commentaryState = normalizeChartCommentaryState(content?.props?.commentaryState, source.chartDocumentId);
  const answer: ChartCommentaryAnswer = {
    analysisId: report.analysisId,
    question,
    createdAt,
    symbol: explanation.symbol,
    interval: explanation.interval,
    asOf: explanation.asOf,
    finalAnswer,
    warnings: userVisibleWarnings([
      ...(report.finalResponse?.risk_warnings ?? []),
      ...(report.finalResponse?.data_freshness_warnings ?? [])
    ]),
    chartExplanation: explanation
  };
  const turns = [
    ...commentaryState.turns.filter((item) => item.analysisId !== answer.analysisId),
    answer
  ].slice(-chartCommentaryHistoryLimit);
  return {
    ...ensured,
    state: setPanelContentProps(ensured.state, ensured.contentId, {
      chartDocumentId: source.chartDocumentId,
      commentaryState: {
        ...commentaryState,
        mode: "conversation",
        turns,
        pending: null
      }
    })
  };
}

export function setChartCommentaryMode(
  state: ChartCommentaryState,
  mode: ChartCommentaryState["mode"]
): ChartCommentaryState {
  if (mode === "conversation" && state.turns.length === 0 && !state.pending) return state;
  return state.mode === mode ? state : { ...state, mode };
}

export function normalizeChartCommentaryState(value: unknown, chartDocumentId: string): ChartCommentaryState {
  const source = readObject(value);
  if (!source || !["chart-commentary-history.v1", "chart-commentary-history.v2"].includes(String(source.version))) {
    return emptyChartCommentaryState(chartDocumentId);
  }
  const turns = readArray(source.version === "chart-commentary-history.v2" ? source.turns : source.answers)
    .map(normalizeAnswer)
    .filter((answer): answer is ChartCommentaryAnswer => Boolean(answer))
    .slice(-chartCommentaryHistoryLimit);
  const legacyActiveView = readString(source.activeView) ?? "current";
  const requestedMode = source.version === "chart-commentary-history.v2"
    ? readString(source.mode)
    : legacyActiveView === "current" ? "commentary" : "conversation";
  const pending = normalizePending(source.pending, chartDocumentId);
  return {
    version: "chart-commentary-history.v2",
    chartDocumentId,
    mode: requestedMode === "conversation" && (turns.length > 0 || pending)
      ? "conversation"
      : "commentary",
    turns,
    pending
  };
}

export function chartCommentaryStateForDocument(
  value: unknown,
  chartDocumentId: string
): ChartCommentaryState {
  const history = readObject(value);
  return normalizeChartCommentaryState(history?.[chartDocumentId], chartDocumentId);
}

export function rememberChartCommentaryState(
  value: unknown,
  chartDocumentId: string,
  state: unknown
): Record<string, unknown> {
  const history = readObject(value) ?? {};
  return {
    ...history,
    [chartDocumentId]: normalizeChartCommentaryState(state, chartDocumentId)
  };
}

export function emptyChartCommentaryState(chartDocumentId: string): ChartCommentaryState {
  return {
    version: "chart-commentary-history.v2",
    chartDocumentId,
    mode: "commentary",
    turns: [],
    pending: null
  };
}

function updateCommentaryForDocument(
  state: TiledPanelState,
  chartDocumentId: string,
  update: (commentaryState: ChartCommentaryState) => ChartCommentaryState
): TiledPanelState {
  const content = Object.values(state.contents).find((item) => (
    item.kind === "chartCommentary" && readString(item.props?.chartDocumentId) === chartDocumentId
  ));
  if (!content) return state;
  const current = normalizeChartCommentaryState(content.props?.commentaryState, chartDocumentId);
  const next = update(current);
  return next === current ? state : setPanelContentProps(state, content.id, { commentaryState: next });
}

function chartCommentaryGridRect(
  state: TiledPanelState,
  source: PanelGridRect,
  viewportWidth: number
): PanelGridRect | null {
  const span = { colSpan: 2, rowSpan: 2 };
  const right = { col: source.col + source.colSpan, row: source.row, ...span };
  const below = { col: source.col, row: source.row + source.rowSpan, ...span };
  const candidates = viewportWidth >= 900 ? [right, below] : [below, right];
  for (const candidate of candidates) {
    if (canPlaceGridRect(state, candidate, { kind: "chartCommentary" })) return candidate;
  }
  return resolveFirstAvailableRecommendedGridRect(state, "chartCommentary");
}

function normalizeAnswer(value: unknown): ChartCommentaryAnswer | null {
  const source = readObject(value);
  const analysisId = readString(source?.analysisId);
  const question = readString(source?.question);
  const createdAt = readString(source?.createdAt);
  const symbol = readString(source?.symbol)?.toUpperCase();
  const interval = readString(source?.interval);
  const asOf = readString(source?.asOf);
  const finalAnswer = normalizeFinalAnswer(source?.finalAnswer);
  const chartExplanation = normalizeChartExplanation(source?.chartExplanation);
  if (!source || !analysisId || !question || !createdAt || !symbol || !interval || !asOf || !finalAnswer || !chartExplanation) return null;
  return {
    analysisId,
    question,
    createdAt,
    symbol,
    interval,
    asOf,
    finalAnswer,
    warnings: uniqueStrings(readArray(source.warnings)),
    chartExplanation
  };
}

function normalizePending(value: unknown, chartDocumentId: string): ChartCommentaryPending | null {
  const source = readObject(value);
  const snapshot = readObject(source?.snapshot);
  const requestId = readString(source?.requestId);
  const question = readString(source?.question);
  const requestedAt = readString(source?.requestedAt);
  const symbol = readString(snapshot?.symbol)?.toUpperCase();
  const interval = readString(snapshot?.interval);
  if (!source || !snapshot || !requestId || !question || !requestedAt || !symbol || !interval) return null;
  return {
    requestId,
    question,
    requestedAt,
    snapshot: {
      chartDocumentId,
      ...(readString(snapshot.sourcePanelId) ? { sourcePanelId: readString(snapshot.sourcePanelId)! } : {}),
      symbol,
      interval,
      ...(readString(snapshot.asOf) ? { asOf: readString(snapshot.asOf)! } : {}),
      assetVersion: readString(snapshot.assetVersion) ?? undefined,
      algorithmVersion: readString(snapshot.algorithmVersion) ?? undefined,
      inputDigest: readString(snapshot.inputDigest) ?? undefined
    }
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(readString).filter((item): item is string => Boolean(item)))];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
