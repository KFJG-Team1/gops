import type { LayoutPreset, LayoutPresetRole } from "./layoutPresets";
import type { PanelContentKind, TiledPanelState } from "./panelLayout";
import { wildPanelBasePageId } from "./wildPanel";

export const incidentResponsePresetRole: LayoutPresetRole = "incident-response";
export const incidentResponseTransitionDelayMs = 1200;

export type IncidentResponsePresetValidation =
  | { status: "ready" }
  | { status: "invalid"; message: string };

export type PreparedIncidentResponseLayout =
  | { status: "ready"; state: TiledPanelState; wildPanelSlotId?: string }
  | { status: "invalid"; message: string };

const incidentSymbolPanelKinds = new Set<PanelContentKind>([
  "chart",
  "compare",
  "company",
  "companyMulti",
  "companyValuation",
  "companyProfitability",
  "companyStability",
  "news",
  "newsList",
  "watchlistNews",
  "watchlistNewsList",
  "ontology",
  "orderFlow",
  "priceCondition",
  "quickOrder",
  "paperQuickOrder",
  "paperTrade",
  "trade",
  "chartCommentary",
  "chartAssetOps",
  "chartPatternList",
  "aiCoach"
]);

export function isIncidentResponsePrompt(value: string): boolean {
  const text = compactIncidentPrompt(value);
  if (!text) {
    return false;
  }
  const situation = ["무슨일", "무슨상황", "지금상황"].some((term) => text.includes(term))
    && ["벌어", "발생", "이야", "인가", "설명"].some((term) => text.includes(term));
  const responseTopic = ["대응", "대처"].some((term) => text.includes(term));
  const responseQuestion = ["어떻게", "방안", "방법", "뭘", "무엇", "무슨"].some((term) => text.includes(term));
  const responseRequest = ["해야", "해", "하면", "알려", "할까", "할지", "하지", "좋을까"].some((term) => text.includes(term))
    || ["대응방안", "대응방법", "대처방안", "대처방법"].some((term) => text.includes(term));
  const retrospective = ["대응했", "대처했"].some((term) => text.includes(term));
  const response = responseTopic && responseQuestion && responseRequest && !retrospective;
  const panelTopic = text.includes("패널");
  const panelPurpose = ["관련", "상황", "대응", "확인", "봐야"].some((term) => text.includes(term));
  const panelRequest = ["뭘", "무엇", "어떤", "봐야", "보여", "열어", "가져", "알려"].some((term) => text.includes(term));
  const panelGuidance = panelTopic && panelPurpose && panelRequest;
  const informationTopic = ["정보", "지표", "신호", "근거"].some((term) => text.includes(term));
  const informationQuestion = ["어떤", "뭘", "무엇"].some((term) => text.includes(term));
  const informationAction = ["보고대응", "보고대처", "봐야", "확인하고대응", "확인하고대처", "대응해야", "대처해야"].some((term) => text.includes(term));
  const informationGuidance = informationTopic && informationQuestion && informationAction;
  const portfolioTopic = ["포트폴리오", "보유종목", "내자산"].some((term) => text.includes(term));
  const portfolioImpact = ["영향", "미치", "리스크", "위험"].some((term) => text.includes(term));
  const portfolioRequest = ["분석", "알려", "확인", "봐줘", "점검", "찾아", "있는지", "어떤지", "괜찮"].some((term) => text.includes(term));
  const portfolioImpactAnalysis = portfolioTopic && portfolioImpact && portfolioRequest;
  return situation || response || panelGuidance || informationGuidance || portfolioImpactAnalysis;
}

export function incidentResponseLayoutPreset(presets: readonly LayoutPreset[]): LayoutPreset | null {
  return presets.find((preset) => preset.kind === "custom" && preset.role === incidentResponsePresetRole) ?? null;
}

export function incidentResponseAnalysisIntent(prompt: string, symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const originalPrompt = prompt.trim();
  return `${normalizedSymbol} 현재 상황에서 무슨 일이 벌어졌는지 설명하고, 주요 원인과 위험 요인, 대응 방안을 분석해줘. 원문 질문: ${originalPrompt}`;
}

export function validateIncidentResponsePreset(preset: LayoutPreset | null | undefined): IncidentResponsePresetValidation {
  if (!preset || preset.kind !== "custom" || !preset.layout) {
    return { status: "invalid", message: "커스텀 프리셋을 먼저 저장해 주세요." };
  }
  return { status: "ready" };
}

export function prepareIncidentResponseLayout(
  state: TiledPanelState,
  symbol: string
): PreparedIncidentResponseLayout {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    return { status: "invalid", message: "대응할 종목을 먼저 선택해 주세요." };
  }
  const contents = Object.fromEntries(Object.entries(state.contents).map(([contentId, content]) => {
    if (!incidentSymbolPanelKinds.has(content.kind)) {
      return [contentId, content];
    }
    const nextProps: Record<string, unknown> = {
      ...content.props,
      symbol: normalizedSymbol
    };
    if (content.kind === "compare") {
      const currentSymbols = Array.isArray(content.props?.symbols)
        ? content.props.symbols.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      nextProps.baseSymbol = normalizedSymbol;
      nextProps.symbols = [
        normalizedSymbol,
        ...currentSymbols.map((item) => item.trim().toUpperCase()).filter((item) => item !== normalizedSymbol)
      ];
    }
    return [contentId, { ...content, props: nextProps }];
  })) as TiledPanelState["contents"];
  const wildPanelSlotId = state.slots.find((slot) => Boolean(slot.wildPanel))?.id;
  return {
    status: "ready",
    ...(wildPanelSlotId ? { wildPanelSlotId } : {}),
    state: {
      ...state,
      contents,
      slots: state.slots.map((slot) => wildPanelSlotId && slot.id === wildPanelSlotId
        ? {
          ...slot,
          wildPanel: {
            activePageId: wildPanelBasePageId,
            reportGroups: []
          }
        }
        : slot)
    }
  };
}

function compactIncidentPrompt(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/[\s?!.,;:'"()[\]{}-]+/g, "");
}
