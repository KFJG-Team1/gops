import type {
  AgentAnalysisReport,
  FinalAnswerCitation,
  FinalAnswerSection
} from "../agents/agentAnalysis";
import type { TiledPanelState } from "./panelLayout";

export const wildPanelBasePageId = "base";
export const wildPanelReportLimit = 10;

export type WildPanelCommentaryPage = {
  id: string;
  kind: "chartCommentary";
  analysisId: string;
  symbol?: string;
  kicker: "차트 해설" | "분석 답변";
  title: string;
  summary: string;
  sections: FinalAnswerSection[];
  citations: FinalAnswerCitation[];
  limitations: string[];
  warnings: string[];
  confidence?: number;
};

export type WildPanelAgentAnswerPage = {
  id: string;
  kind: "agentAnswer";
  analysisId: string;
  agentId: string;
  role: string;
  title: string;
  content: string;
  confidence?: number;
  citations: FinalAnswerCitation[];
};

export type WildPanelPage = WildPanelCommentaryPage | WildPanelAgentAnswerPage;

export type WildPanelReportGroup = {
  analysisId: string;
  addedAt: string;
  pages: WildPanelPage[];
};

export type WildPanelState = {
  activePageId: string;
  reportGroups: WildPanelReportGroup[];
};

export function resolveWildPanelSlotId(
  state: TiledPanelState,
  preferredSlotId?: string | null
): string | null {
  const preferred = preferredSlotId
    ? state.slots.find((slot) => slot.id === preferredSlotId && slot.wildPanel)
    : null;
  return preferred?.id ?? state.slots.find((slot) => slot.wildPanel)?.id ?? null;
}

export function enableWildPanel(state: TiledPanelState, slotId: string): TiledPanelState {
  if (!state.slots.some((slot) => slot.id === slotId)) {
    return state;
  }
  let changed = false;
  const slots = state.slots.map((slot) => {
    if (slot.id === slotId) {
      if (slot.wildPanel) {
        return slot;
      }
      changed = true;
      return { ...slot, wildPanel: { activePageId: wildPanelBasePageId, reportGroups: [] } };
    }
    if (!slot.wildPanel) {
      return slot;
    }
    changed = true;
    const { wildPanel: _wildPanel, ...fixedSlot } = slot;
    return fixedSlot;
  });
  return changed ? { ...state, slots } : state;
}

export function disableWildPanel(state: TiledPanelState, slotId: string): TiledPanelState {
  return updateWildPanelSlot(state, slotId, (slot) => {
    if (!slot.wildPanel) {
      return slot;
    }
    const { wildPanel: _wildPanel, ...next } = slot;
    return next;
  });
}

export function setWildPanelActivePage(
  state: TiledPanelState,
  slotId: string,
  pageId: string
): TiledPanelState {
  return updateWildPanelSlot(state, slotId, (slot) => {
    if (!slot.wildPanel || !wildPanelPageIds(slot.wildPanel).includes(pageId)) {
      return slot;
    }
    return {
      ...slot,
      wildPanel: { ...slot.wildPanel, activePageId: pageId }
    };
  });
}

export function addAgentReportToWildPanel(
  state: TiledPanelState,
  slotId: string,
  report: AgentAnalysisReport,
  addedAt = new Date().toISOString()
): TiledPanelState {
  return updateWildPanelSlot(state, slotId, (slot) => {
    if (!slot.wildPanel) {
      return slot;
    }
    const existing = slot.wildPanel.reportGroups.find((group) => group.analysisId === report.analysisId);
    if (existing) {
      return {
        ...slot,
        wildPanel: {
          ...slot.wildPanel,
          activePageId: preferredReportPageId(existing)
        }
      };
    }
    const group = wildPanelReportGroup(report, addedAt);
    if (group.pages.length === 0) {
      return slot;
    }
    const reportGroups = [...slot.wildPanel.reportGroups, group].slice(-wildPanelReportLimit);
    return {
      ...slot,
      wildPanel: {
        activePageId: preferredReportPageId(group),
        reportGroups
      }
    };
  });
}

export function wildPanelReportGroup(
  report: AgentAnalysisReport,
  addedAt = new Date().toISOString()
): WildPanelReportGroup {
  const finalAnswer = report.finalAnswer;
  const chartRoute = Boolean(report.chartExplanation) && report.route?.intentType === "chart";
  const visibleWarnings = userVisibleWarnings([
    ...(report.finalResponse?.risk_warnings ?? []),
    ...(report.finalResponse?.data_freshness_warnings ?? [])
  ]);
  const commentary: WildPanelCommentaryPage = {
    id: `${report.analysisId}:commentary`,
    kind: "chartCommentary",
    analysisId: report.analysisId,
    ...(report.symbol ? { symbol: report.symbol } : {}),
    kicker: chartRoute ? "차트 해설" : "분석 답변",
    title: finalAnswer?.title || "분석 미완료",
    summary: finalAnswer?.summary || "완성된 분석 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
    sections: (finalAnswer?.sections ?? []).map((section) => ({
      title: section.title,
      bullets: [...section.bullets]
    })),
    citations: (finalAnswer?.citations ?? []).map(copyCitation),
    limitations: [...(finalAnswer?.limitations ?? [])],
    warnings: visibleWarnings,
    ...(!chartRoute && typeof report.finalResponse?.confidence === "number"
      ? { confidence: report.finalResponse.confidence }
      : {})
  };
  const answers: WildPanelAgentAnswerPage[] = report.agentAnswers.map((answer, index) => ({
    id: `${report.analysisId}:answer:${index}:${answer.agentId}`,
    kind: "agentAnswer",
    analysisId: report.analysisId,
    agentId: answer.agentId,
    role: answer.role,
    title: answer.title || answer.role,
    content: answer.content,
    ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : {}),
    citations: answer.citations.map(copyCitation)
  }));
  return {
    analysisId: report.analysisId,
    addedAt,
    pages: [commentary, ...answers]
  };
}

export function wildPanelPages(wildPanel: WildPanelState | undefined): WildPanelPage[] {
  return wildPanel?.reportGroups.flatMap((group) => group.pages) ?? [];
}

export function wildPanelPageIds(wildPanel: WildPanelState): string[] {
  return [wildPanelBasePageId, ...wildPanelPages(wildPanel).map((page) => page.id)];
}

export function normalizeWildPanelState(value: unknown): WildPanelState | null {
  const source = readRecord(value);
  if (!source || !Array.isArray(source.reportGroups)) {
    return null;
  }
  const reportGroups = source.reportGroups
    .map(normalizeReportGroup)
    .filter((group): group is WildPanelReportGroup => Boolean(group))
    .slice(-wildPanelReportLimit);
  const candidate: WildPanelState = {
    activePageId: readString(source.activePageId) ?? wildPanelBasePageId,
    reportGroups
  };
  return {
    ...candidate,
    activePageId: wildPanelPageIds(candidate).includes(candidate.activePageId)
      ? candidate.activePageId
      : wildPanelBasePageId
  };
}

function preferredReportPageId(group: WildPanelReportGroup): string {
  return group.pages.find((page) => page.kind === "chartCommentary")?.id
    ?? group.pages[0]?.id
    ?? wildPanelBasePageId;
}

function updateWildPanelSlot(
  state: TiledPanelState,
  slotId: string,
  update: (slot: TiledPanelState["slots"][number]) => TiledPanelState["slots"][number]
): TiledPanelState {
  const index = state.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) {
    return state;
  }
  const current = state.slots[index]!;
  const next = update(current);
  if (next === current) {
    return state;
  }
  return {
    ...state,
    slots: state.slots.map((slot) => slot.id === slotId ? next : slot)
  };
}

function normalizeReportGroup(value: unknown): WildPanelReportGroup | null {
  const source = readRecord(value);
  const analysisId = readString(source?.analysisId);
  const addedAt = readString(source?.addedAt);
  if (!source || !analysisId || !addedAt || !Array.isArray(source.pages)) {
    return null;
  }
  const pages = source.pages.map(normalizePage).filter((page): page is WildPanelPage => Boolean(page));
  if (pages.length === 0) {
    return null;
  }
  return { analysisId, addedAt, pages };
}

function normalizePage(value: unknown): WildPanelPage | null {
  const source = readRecord(value);
  const id = readString(source?.id);
  const kind = readString(source?.kind);
  const analysisId = readString(source?.analysisId);
  const title = readString(source?.title);
  if (!source || !id || !analysisId || !title) {
    return null;
  }
  const confidence = readNumber(source.confidence);
  const citations = readArray(source.citations).map(normalizeCitation).filter((item): item is FinalAnswerCitation => Boolean(item));
  if (kind === "chartCommentary") {
    const summary = readString(source.summary);
    if (!summary) {
      return null;
    }
    return {
      id,
      kind,
      analysisId,
      ...(readString(source.symbol) ? { symbol: readString(source.symbol)! } : {}),
      kicker: readString(source.kicker) === "분석 답변" ? "분석 답변" : "차트 해설",
      title,
      summary,
      sections: readArray(source.sections).map(normalizeSection).filter((item): item is FinalAnswerSection => Boolean(item)),
      citations,
      limitations: readArray(source.limitations).map(readString).filter((item): item is string => Boolean(item)),
      warnings: readArray(source.warnings).map(readString).filter((item): item is string => Boolean(item)),
      ...(confidence !== null ? { confidence } : {})
    };
  }
  if (kind === "agentAnswer") {
    const agentId = readString(source.agentId);
    const role = readString(source.role);
    const content = readString(source.content);
    if (!agentId || !role || !content) {
      return null;
    }
    return {
      id,
      kind,
      analysisId,
      agentId,
      role,
      title,
      content,
      citations,
      ...(confidence !== null ? { confidence } : {})
    };
  }
  return null;
}

export function userVisibleWarnings(values: string[]): string[] {
  const labels: Record<string, string> = {
    partial_data_used: "일부 데이터만 사용해 분석했습니다.",
    partial_chart_data: "차트 데이터 일부만 사용할 수 있습니다.",
    stale_chart_asset: "차트 작도 기준 시점이 현재 화면보다 오래되었습니다.",
    no_relevant_news_found: "선택 시점에 연결할 관련 뉴스가 없습니다."
  };
  return [...new Set(values.map((value) => labels[value]).filter((value): value is string => Boolean(value)))];
}

function normalizeSection(value: unknown): FinalAnswerSection | null {
  const source = readRecord(value);
  const title = readString(source?.title);
  if (!source || !title || !Array.isArray(source.bullets)) {
    return null;
  }
  return {
    title,
    bullets: source.bullets.map(readString).filter((item): item is string => Boolean(item))
  };
}

function normalizeCitation(value: unknown): FinalAnswerCitation | null {
  const source = readRecord(value);
  const provider = readString(source?.provider);
  const title = readString(source?.title);
  if (!source || !provider || !title) {
    return null;
  }
  return {
    provider,
    title,
    ...(readString(source.url) ? { url: readString(source.url)! } : {}),
    ...(readString(source.publishedAt) ? { publishedAt: readString(source.publishedAt)! } : {})
  };
}

function copyCitation(citation: FinalAnswerCitation): FinalAnswerCitation {
  return { ...citation };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
