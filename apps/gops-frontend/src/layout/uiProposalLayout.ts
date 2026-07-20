import type { AgentLayoutCommand, AgentLayoutProposal } from "./agentLayoutTypes";
import { panelKindForAgentType } from "./panelRegistry";

/**
 * Backend agents (risk monitor 등) attach `uiProposals` to alert events:
 * `{ panelType, action, symbol? }`. The frontend layout engine has no
 * open/focus verbs — both collapse onto `layout.panel.add`, which focuses an
 * existing panel or creates it.
 */
export type UiProposalLike = {
  panelType: string;
  action: string;
  symbol?: string;
};

export function normalizeUiProposals(value: unknown): UiProposalLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const proposals: UiProposalLike[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const panelType = typeof record.panelType === "string" ? record.panelType.trim() : "";
    if (!panelType || panelKindForAgentType(panelType) === null) {
      continue;
    }
    const action = typeof record.action === "string" && record.action.trim() ? record.action.trim() : "open";
    const symbol = typeof record.symbol === "string" && /^[A-Z0-9.\-]{1,16}$/.test(record.symbol.trim().toUpperCase())
      ? record.symbol.trim().toUpperCase()
      : undefined;
    proposals.push({ panelType, action, symbol });
  }
  return proposals;
}

export function buildUiProposalLayoutProposal(
  proposals: UiProposalLike[],
  options: { title?: string; rationale?: string } = {}
): AgentLayoutProposal | null {
  if (proposals.length === 0) {
    return null;
  }
  const createdAt = new Date().toISOString();
  const proposalId = `ui-proposal-${Date.now()}`;
  const commands: AgentLayoutCommand[] = proposals.map((proposal, index) => ({
    id: `${proposalId}-cmd-${index}`,
    type: "layout.panel.add",
    actor: "system",
    payload: {
      panelType: proposal.panelType,
      ...(proposal.symbol ? { symbol: proposal.symbol, props: { symbol: proposal.symbol } } : {})
    },
    createdAt,
    proposalId
  }));
  return {
    id: proposalId,
    title: options.title ?? "알림 근거 패널",
    rationale: options.rationale ?? "알림이 참조한 패널을 엽니다.",
    autoApply: true,
    commands,
    createdAt
  };
}
