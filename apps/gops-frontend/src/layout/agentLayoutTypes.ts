export type AgentLayoutGridGroup = "workspace" | "agentRail";

export type AgentLayoutGridZone = "main" | "context" | "mainContext" | "agentRail";

export type CommandActor = "user" | "llm" | "system";

export type AgentLayoutPanelType =
  | "chart"
  | "compareChart"
  | "marketIndices"
  | "companyProfile"
  | "companyMulti"
  | "companyValuation"
  | "companyProfitability"
  | "companyStability"
  | "popularStocks"
  | "newsFeed"
  | "stockRecommendations"
  | "themeRadar"
  | "ontologyGraph"
  | "portfolioDashboard"
  | "portfolioHoldings"
  | "portfolioHoldingsFlatCards"
  | "portfolioMulti"
  | "portfolioInvestment"
  | "portfolioPerformance"
  | "portfolioInvested"
  | "portfolioDividend"
  | "portfolioDiversification"
  | "portfolioHeatmap"
  | "orderFlowProfile"
  | "aiCoach"
  | "priceCondition"
  | "quickOrder"
  | "paperQuickOrder"
  | "paperOrderTicket"
  | "paperAccount"
  | "chartCommentary"
  | "chartAssetOps"
  | "chartPatternList"
  | "orderTicket";

export type AgentLayoutCommandType =
  | "layout.panel.add"
  | "layout.panel.remove"
  | "layout.panel.move"
  | "layout.panel.replace"
  | "layout.panel.props.update"
  | "layout.panel.pin"
  | "layout.panel.unpin"
  | "layout.panel.select"
  | "layout.panel.priority.set"
  | "layout.panels.arrange"
  | "layout.placement.pick"
  | "layout.boundary.resize"
  | "layout.reflow"
  | "layout.undo"
  | "layout.redo"
  | "layout.save"
  | "layout.update"
  | "layout.delete"
  | "layout.load"
  | "layout.favorite.set"
  | "layout.default.restore"
  | "layout.reset"
  | "layout.autoApply.set"
  | "layout.proposal.accept"
  | "layout.proposal.reject";

export const agentLayoutCommandTypes: readonly AgentLayoutCommandType[] = [
  "layout.panel.add",
  "layout.panel.remove",
  "layout.panel.move",
  "layout.panel.replace",
  "layout.panel.props.update",
  "layout.panel.pin",
  "layout.panel.unpin",
  "layout.panel.select",
  "layout.panel.priority.set",
  "layout.panels.arrange",
  "layout.placement.pick",
  "layout.boundary.resize",
  "layout.reflow",
  "layout.undo",
  "layout.redo",
  "layout.save",
  "layout.update",
  "layout.delete",
  "layout.load",
  "layout.favorite.set",
  "layout.default.restore",
  "layout.reset",
  "layout.autoApply.set",
  "layout.proposal.accept",
  "layout.proposal.reject"
] as const;

export type AgentLayoutCommand = {
  id: string;
  type: AgentLayoutCommandType;
  actor: CommandActor;
  target?: { panelId?: string; panelIds?: string[]; group?: AgentLayoutGridGroup; zone?: AgentLayoutGridZone };
  payload: Record<string, unknown>;
  createdAt: string;
  proposalId?: string;
};

export type AgentLayoutProposal = {
  id: string;
  title: string;
  rationale: string;
  autoApply?: boolean;
  panelPriorities?: Array<{
    panelId: string;
    panelType?: AgentLayoutPanelType | string;
    layoutWeight: number;
    reason?: string;
  }>;
  commands: AgentLayoutCommand[];
  createdAt: string;
};
