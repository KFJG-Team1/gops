import { Bell, Bot, Cog, LoaderCircle, LogIn, Plus, RotateCcw, SendHorizontal, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getChartAgentAccess } from "@gops/chart-engine/agentAccess";
import { createChatMessage, normalizeAgentChatResponse, type AgentChatMessage } from "@gops/chart-engine/agentChat";
import {
  DEFAULT_AGENT_DRAFT_SEED,
  resolveAgentChartReference,
  resolveAgentSendContent,
  type AgentChartReference
} from "@gops/chart-engine/agentReference";
import { buildChartAgentContext } from "@gops/chart-engine/proposals";
import type { SupportedSymbol, WatchlistSymbol } from "@gops/chart-engine/symbols";
import {
  getCandlesForDocument,
  getChartDocumentForPanel,
  getDataStatusForDocument,
  getStreamStatusForDocument,
  type ChartRuntimeAction,
  type ChartRuntimeState
} from "@gops/chart-engine/runtime";
import { buildAgentAnalysisRequest, formatAgentAnalysisReport, normalizeAgentAnalysisReport } from "../agents/agentAnalysis";
import { MAX_USER_LAYOUTS, layoutSnapshotsEqual, makeCommand } from "../layout/commands";
import { useAuth } from "../auth/AuthProvider";
import { findTargetChartPanel } from "../layout/chartPanelSelection";
import { getPanelDefinition } from "../layout/panelRegistry";
import {
  createPanelDropCommand,
  getWorkspaceDropCell,
  PANEL_CATALOG_MIME,
  PANEL_CATALOG_TYPES
} from "../layout/panelCatalogDrop";
import type { FavoriteLayoutSlot, LayoutCommand, PanelType, SavedLayoutRecord, WorkspaceLayout } from "../layout/types";

export type SystemMode = "watchlist" | "settings" | "agents" | "notifications";

export type SystemMenuTab = "layouts" | "panels" | "agent" | "menu";

export type AgentOption = {
  id: string;
  label: string;
  description: string;
  iconUrl: string;
};

export type AgentUpdatePatch = Partial<Pick<AgentOption, "label" | "description" | "iconUrl">>;

export const initialAgentOptions: AgentOption[] = [
  { id: "agent-01", label: "차트 AI", description: "차트 의도를 해석하고 명령을 제안합니다.", iconUrl: "/assets/agent-icons/agent-01.svg" },
  { id: "agent-02", label: "뉴스 AI", description: "뉴스와 시장 맥락을 정리합니다.", iconUrl: "/assets/agent-icons/agent-02.svg" },
  { id: "agent-03", label: "시그널 AI", description: "신호와 조건을 검토합니다.", iconUrl: "/assets/agent-icons/agent-03.svg" },
  { id: "agent-04", label: "포트폴리오 AI", description: "관심 종목과 포트폴리오를 추적합니다.", iconUrl: "/assets/agent-icons/agent-04.svg" }
];

type SystemAreaProps = {
  mode: SystemMode;
  settingsTab: SystemMenuTab;
  layout: WorkspaceLayout;
  chartRuntime: ChartRuntimeState;
  chartAutoApplyEnabled: boolean;
  agents: AgentOption[];
  selectedAgentIds: string[];
  referencedChartTarget?: AgentChartReference;
  editingAgentId?: string;
  savedLayouts: SavedLayoutRecord[];
  activeSymbol: SupportedSymbol;
  watchlistSymbols: WatchlistSymbol[];
  symbolUniverse: readonly SupportedSymbol[];
  onSettingsTabChange: (tab: SystemMenuTab) => void;
  onEditAgent: (agentId?: string) => void;
  onUpdateAgent: (agentId: string, patch: AgentUpdatePatch) => void;
  onAddAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onCloseSystemPanel: () => void;
  onSelectSymbol: (symbol: string) => boolean;
  onCommand: (command: LayoutCommand) => void;
  onChartAction: (action: ChartRuntimeAction) => void;
};

type SettingsPanelProps = {
  settingsTab: SystemMenuTab;
  layout: WorkspaceLayout;
  activeSymbol: SupportedSymbol;
  agents: AgentOption[];
  editingAgentId?: string;
  savedLayouts: SavedLayoutRecord[];
  onSettingsTabChange: (tab: SystemMenuTab) => void;
  onEditAgent: (agentId?: string) => void;
  onUpdateAgent: (agentId: string, patch: AgentUpdatePatch) => void;
  onAddAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onCommand: (command: LayoutCommand) => void;
};

export function SystemArea({
  mode,
  settingsTab,
  layout,
  chartRuntime,
  chartAutoApplyEnabled,
  agents,
  selectedAgentIds,
  referencedChartTarget,
  editingAgentId,
  savedLayouts,
  activeSymbol,
  watchlistSymbols,
  symbolUniverse,
  onSettingsTabChange,
  onEditAgent,
  onUpdateAgent,
  onAddAgent,
  onDeleteAgent,
  onCloseSystemPanel,
  onSelectSymbol,
  onCommand,
  onChartAction
}: SystemAreaProps) {
  const selectedAgents = agents.filter((agent) => selectedAgentIds.includes(agent.id));
  const chartAgentAccess = getChartAgentAccess(selectedAgents);
  const agentHeaderTitle = selectedAgents.length > 1
    ? "AI 오케스트레이션"
    : selectedAgents[0]?.label ?? "AI 에이전트";
  const agentHeaderDetail = selectedAgents.length > 1
    ? selectedAgents.map((agent) => agent.label).join(" / ")
    : selectedAgents[0]?.description ?? "에이전트를 선택하세요";

  return (
    <aside className="system-area" data-system-mode={mode} aria-label="시스템 패널">
      {mode !== "watchlist" && (
        <button className="system-panel-close" title="시스템 패널 닫기" onClick={onCloseSystemPanel}>
          <X size={16} />
        </button>
      )}

      {mode === "settings" && (
        <SettingsPanel
          settingsTab={settingsTab}
          layout={layout}
          activeSymbol={activeSymbol}
          agents={agents}
          editingAgentId={editingAgentId}
          savedLayouts={savedLayouts}
          onSettingsTabChange={onSettingsTabChange}
          onEditAgent={onEditAgent}
          onUpdateAgent={onUpdateAgent}
          onAddAgent={onAddAgent}
          onDeleteAgent={onDeleteAgent}
          onCommand={onCommand}
        />
      )}

      {mode === "agents" && (
        <div className="system-mode-content agent-mode-content">
          <div className="system-mode-header agent-header">
            <strong>{agentHeaderTitle}</strong>
            <span>{agentHeaderDetail}</span>
          </div>
          <AgentChatPanel
            layout={layout}
            chartRuntime={chartRuntime}
            autoApplyEnabled={chartAutoApplyEnabled}
            selectedAgents={selectedAgents}
            chartAgentAccess={chartAgentAccess}
            referencedChartTarget={referencedChartTarget}
            symbolUniverse={symbolUniverse}
            onChartAction={onChartAction}
          />
        </div>
      )}

      {mode === "notifications" && (
        <div className="system-mode-content">
          <div className="system-mode-header">
            <strong>알림</strong>
            <span>알림 설정</span>
          </div>
          <div className="menu-settings-list">
            {["레이아웃 제안", "시장 알림", "AI 상태", "리스크 알림"].map((item) => (
              <button key={item}>{item}</button>
            ))}
          </div>
        </div>
      )}

      {mode === "watchlist" && (
        <div className="system-mode-content">
          <div className="system-mode-header watchlist-header">
            <strong>관심 종목</strong>
          </div>
          <div className="watchlist-list">
            {watchlistSymbols.length === 0 && (
              <div className="watchlist-empty">불러온 종목이 없습니다</div>
            )}
            {watchlistSymbols.map((item) => (
              <button
                key={item.symbol}
                className={item.symbol === activeSymbol ? "watchlist-row active" : "watchlist-row"}
                data-symbol={item.symbol}
                aria-label={`${item.symbol} ${item.name} 불러오기`}
                title={`${item.symbol} 불러오기`}
                onClick={() => onSelectSymbol(item.symbol)}
              >
                <span className="watchlist-symbol-cell">
                  <strong>{item.symbol}</strong>
                  <em>{item.name}</em>
                </span>
                <span className="watchlist-quote-cell">
                  <strong className={typeof item.changePercent === "number" ? (item.changePercent < 0 ? "market-down" : "market-up") : "watchlist-change-empty"}>
                    {typeof item.changePercent === "number" ? `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%` : "-"}
                  </strong>
                  <em>
                    {typeof item.lastPrice === "number" ? item.lastPrice.toFixed(2) : "데이터 없음"}
                  </em>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function AgentChatPanel({
  layout,
  chartRuntime,
  autoApplyEnabled,
  selectedAgents,
  chartAgentAccess,
  referencedChartTarget,
  symbolUniverse,
  onChartAction
}: {
  layout: WorkspaceLayout;
  chartRuntime: ChartRuntimeState;
  autoApplyEnabled: boolean;
  selectedAgents: AgentOption[];
  chartAgentAccess: ReturnType<typeof getChartAgentAccess>;
  referencedChartTarget?: AgentChartReference;
  symbolUniverse: readonly SupportedSymbol[];
  onChartAction: (action: ChartRuntimeAction) => void;
}) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const resolvedReference = useMemo(
    () => resolveAgentChartReference(layout.panels, chartRuntime, referencedChartTarget),
    [chartRuntime, layout.panels, referencedChartTarget]
  );
  const orchestrationMode = selectedAgents.length > 1;
  const hasNonChartAgent = selectedAgents.some((agent) => agent.id !== "agent-01");
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [agentError, setAgentError] = useState(false);
  const selectedAgentKey = selectedAgents.map((agent) => agent.id).join("|");
  const referencedChartKey = referencedChartTarget ? `${referencedChartTarget.panelId}:${referencedChartTarget.chartDocumentId}` : "";
  const draftSeed = referencedChartTarget?.draftSeed ?? defaultDraftSeedForAgents(selectedAgents);
  const draftContent = resolveAgentSendContent(draft, draftSeed);
  const routeIntentMode = isAgentAnalysisIntent(draftContent);
  const agentAnalysisMode = orchestrationMode || hasNonChartAgent || routeIntentMode;
  const fallbackChartPanel = useMemo(
    () => agentAnalysisMode ? findTargetChartPanel(layout.panels, layout.selectedPanelId) : null,
    [agentAnalysisMode, layout.panels, layout.selectedPanelId]
  );
  const fallbackChartDocument = fallbackChartPanel ? getChartDocumentForPanel(chartRuntime, fallbackChartPanel) : null;
  const chartPanel = resolvedReference?.panel ?? fallbackChartPanel;
  const chartDocument = resolvedReference?.document ?? fallbackChartDocument;
  const candles = chartDocument ? getCandlesForDocument(chartRuntime, chartDocument) : [];
  const dataStatus = chartDocument ? getDataStatusForDocument(chartRuntime, chartDocument) : undefined;
  const streamStatus = chartDocument ? getStreamStatusForDocument(chartRuntime, chartDocument) : "stale";
  const introAgent = selectedAgents[0];
  const introLabel = selectedAgents.length > 1 ? "AI 오케스트레이션" : introAgent?.label ?? "AI 에이전트";
  const introIconUrl = introAgent?.iconUrl ?? "/assets/agent-icons/agent-01.svg";
  const introDescription = selectedAgents.length > 1
    ? selectedAgents.map((agent) => agent.label).join(" / ")
    : introAgent?.description ?? "에이전트를 선택하세요";
  const target = (chartAgentAccess.enabled || agentAnalysisMode) && chartPanel && chartDocument ? { panelId: chartPanel.id, chartDocumentId: chartDocument.id } : null;
  const signalState = sending ? "thinking" : agentError ? "error" : "waiting";
  const signalLabel = signalState === "thinking" ? "생각 중" : signalState === "error" ? "오류" : "대기 중";
  const authRequired = authEnabled && !user;
  const disabledMessage = authRequired
    ? "AI를 사용하려면 Google 로그인이 필요합니다."
    : agentAnalysisMode
    ? "차트 패널을 선택하거나 차트에서 AI에게 묻기를 눌러 분석할 차트를 지정하세요."
    : chartAgentAccess.reason === "no-chart-agent"
      ? "이 에이전트는 아직 차트 요청 권한이 없습니다."
      : "차트 패널에서 AI에게 묻기를 눌러 분석할 차트를 지정하세요.";
  const sendDisabled = authRequired || authLoading || !target || !draftContent.trim() || sending;

  useEffect(() => {
    setMessages([]);
    setDraft("");
    setSending(false);
    setAgentError(false);
  }, [selectedAgentKey, referencedChartKey]);

  const sendMessage = () => {
    if (authRequired) {
      login();
      return;
    }

    const content = resolveAgentSendContent(draft, draftSeed);
    if (!content || !target || !chartPanel || !chartDocument || sending) {
      return;
    }

    const userMessage = createChatMessage("user", content);
    const requestMessages = [...messages, userMessage];
    setMessages(requestMessages);
    setDraft("");
    setSending(true);
    setAgentError(false);
    const chartContext = buildChartAgentContext({
      panelId: chartPanel.id,
      document: chartDocument,
      candles,
      dataStatus,
      streamStatus,
      symbolUniverse
    });
    const requestMessagePayload = requestMessages.map((message) => ({ role: message.role, content: message.content }));

    if (shouldUseAgentAnalysisEndpoint(selectedAgents, content)) {
      fetch("/api/agents/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAgentAnalysisRequest({
          agentIds: selectedAgents.map((agent) => agent.id),
          messages: requestMessages,
          symbol: chartDocument.symbol,
          intent: content,
          chartContext,
          routerMode: "hybrid"
        }))
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await readApiErrorMessage(response, "Agent orchestration API"));
          }
          return response.json() as Promise<unknown>;
        })
        .then((payload) => {
          const report = normalizeAgentAnalysisReport(payload);
          setMessages((current) => [...current, createChatMessage("assistant", formatAgentAnalysisReport(report))]);
        })
        .catch((error: unknown) => {
          setAgentError(true);
          setMessages((current) => [
            ...current,
            createChatMessage("assistant", error instanceof Error ? error.message : "AI 분석 요청에 실패했습니다.")
          ]);
        })
        .finally(() => setSending(false));
      return;
    }

    fetch("/api/llm/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentIds: selectedAgents.map((agent) => agent.id),
        messages: requestMessagePayload,
        context: chartContext
      })
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "AI 채팅 API"));
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const result = normalizeAgentChatResponse(payload, target);
        const nextMessages = [createChatMessage("assistant", result.reply)];
        if (result.proposal) {
          onChartAction({ kind: "chart.proposal.received", proposal: result.proposal, autoApply: autoApplyEnabled });
          nextMessages.push(createChatMessage("system", chartProposalStatusMessage(result.proposal, autoApplyEnabled)));
        }
        setMessages((current) => [...current, ...nextMessages]);
      })
      .catch((error: unknown) => {
        setAgentError(true);
        setMessages((current) => [
          ...current,
          createChatMessage("assistant", error instanceof Error ? error.message : "AI 채팅 요청에 실패했습니다.")
        ]);
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="agent-chat-panel">
      <div className={messages.length === 0 ? "agent-chat-messages empty" : "agent-chat-messages"} aria-label="AI 차트 대화">
        {messages.length === 0 && (
          <div className="agent-chat-empty-state">
            <img src={introIconUrl} alt="" />
            <strong>{introLabel}</strong>
            <span>{introDescription}</span>
            {!target && <small>{disabledMessage}</small>}
            {authRequired && (
              <button className="agent-auth-button" type="button" onClick={login}>
                <LogIn size={14} /> 로그인
              </button>
            )}
          </div>
        )}
        {target && messages.map((message) => (
          <div key={message.id} className={`agent-chat-message ${message.role}`}>
            {message.content}
          </div>
        ))}
      </div>
      <div className="agent-chat-composer">
        <div className="agent-chat-reference">
          <div className="agent-chat-reference-list" aria-label="AI 참조 대상">
            <span className="agent-chat-reference-token">{chartDocument ? chartDocument.symbol : "차트 없음"}</span>
          </div>
          <span className={`agent-chat-signal ${signalState}`} title={signalLabel} aria-label={signalLabel} />
        </div>
        <div className="agent-chat-input-row">
          <textarea
            value={draft}
            placeholder={authRequired ? disabledMessage : target ? draftSeed : disabledMessage}
            disabled={authRequired || !target || sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <button title={authRequired ? "Google 로그인" : target ? "차트 요청 보내기" : disabledMessage} disabled={sendDisabled} onClick={sendMessage}>
            {sending ? <LoaderCircle size={15} /> : <SendHorizontal size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function chartProposalStatusMessage(
  proposal: ReturnType<typeof normalizeAgentChatResponse>["proposal"],
  autoApplyEnabled: boolean
): string {
  const hasPreviewCommands = proposal?.commands.some((command) =>
    command.type.startsWith("chart.drawing.") ||
    command.type.startsWith("chart.comparison.") ||
    command.type === "chart.measurement.add"
  );

  if (hasPreviewCommands) {
    return "차트 미리보기가 준비되었습니다. 차트 패널에서 확인 후 적용하세요.";
  }

  return autoApplyEnabled
    ? "차트 명령을 적용했습니다."
    : "차트 명령 제안이 패널에서 대기 중입니다.";
}

function shouldUseAgentAnalysisEndpoint(selectedAgents: AgentOption[], content: string): boolean {
  return selectedAgents.length > 1 ||
    selectedAgents.some((agent) => agent.id !== "agent-01") ||
    isAgentAnalysisIntent(content);
}

function isAgentAnalysisIntent(content: string): boolean {
  const normalized = content.toLowerCase();
  return [
    "뉴스",
    "기사",
    "보도",
    "헤드라인",
    "거시",
    "금리",
    "관계",
    "공급망",
    "경쟁사",
    "섹터",
    "급등",
    "급락",
    "극락",
    "이상",
    "변동",
    "원인",
    "왜",
    "news",
    "headline",
    "article",
    "macro",
    "rate",
    "relationship",
    "ontology",
    "surge",
    "spike",
    "why"
  ].some((keyword) => normalized.includes(keyword));
}

function defaultDraftSeedForAgents(selectedAgents: AgentOption[]): string {
  if (selectedAgents.length > 1) {
    return "주가 변동 원인 분석해줘";
  }
  switch (selectedAgents[0]?.id) {
    case "agent-02":
      return "뉴스 보여줘";
    case "agent-03":
      return "거시 경제 영향 분석해줘";
    case "agent-04":
      return "기업 관계 영향 분석해줘";
    default:
      return DEFAULT_AGENT_DRAFT_SEED;
  }
}

export function SystemOrbRail({
  aiActive,
  settingsActive,
  notificationsActive,
  onTogglePrimaryAgent,
  onToggleNotifications,
  onToggleSettings
}: {
  aiActive: boolean;
  settingsActive: boolean;
  notificationsActive: boolean;
  onTogglePrimaryAgent: () => void;
  onToggleNotifications: () => void;
  onToggleSettings: () => void;
}) {
  return (
    <div className="system-orb-rail" aria-label="시스템 버튼">
      <button
        className={aiActive ? "system-orb ai-entry selected" : "system-orb ai-entry"}
        aria-label="AI 열기"
        title="AI 열기"
        onClick={onTogglePrimaryAgent}
      >
        <Bot size={18} />
        <span>AI</span>
      </button>
      <button
        className={settingsActive ? "system-orb environment-settings selected" : "system-orb environment-settings"}
        aria-label="환경 설정"
        title="환경 설정"
        aria-pressed={settingsActive}
        onClick={onToggleSettings}
      >
        <Cog size={19} />
      </button>
      <button
        className={notificationsActive ? "system-orb selected" : "system-orb"}
        aria-label="알림 설정"
        title="알림 설정"
        aria-pressed={notificationsActive}
        onClick={onToggleNotifications}
      >
        <Bell size={19} />
      </button>
    </div>
  );
}

function SettingsPanel({
  settingsTab,
  layout,
  activeSymbol,
  agents,
  editingAgentId,
  savedLayouts,
  onSettingsTabChange,
  onEditAgent,
  onUpdateAgent,
  onAddAgent,
  onDeleteAgent,
  onCommand
}: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <div className="settings-tabs">
        <button className={settingsTab === "layouts" ? "active" : ""} onClick={() => onSettingsTabChange("layouts")}>
          레이어 프리셋
        </button>
        <button className={settingsTab === "panels" ? "active" : ""} onClick={() => onSettingsTabChange("panels")}>
          패널
        </button>
        <button className={settingsTab === "agent" ? "active" : ""} onClick={() => onSettingsTabChange("agent")}>
          AI
        </button>
        <button className={settingsTab === "menu" ? "active" : ""} onClick={() => onSettingsTabChange("menu")}>
          메뉴
        </button>
      </div>

      {settingsTab === "layouts" && (
        <LayoutsSettings layout={layout} savedLayouts={savedLayouts} onCommand={onCommand} />
      )}

      {settingsTab === "panels" && <PanelsCatalog layout={layout} activeSymbol={activeSymbol} onCommand={onCommand} />}

      {settingsTab === "agent" && (
        <AgentSettings
          agents={agents}
          editingAgentId={editingAgentId}
          onEditAgent={onEditAgent}
          onUpdateAgent={onUpdateAgent}
          onAddAgent={onAddAgent}
          onDeleteAgent={onDeleteAgent}
        />
      )}

      {settingsTab === "menu" && (
        <div className="menu-settings-list">
          {["계정", "작업 화면", "데이터 소스", "키보드", "도움말"].map((item) => (
            <button key={item}>{item}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelsCatalog({
  layout,
  activeSymbol,
  onCommand
}: {
  layout: WorkspaceLayout;
  activeSymbol: SupportedSymbol;
  onCommand: (command: LayoutCommand) => void;
}) {
  return (
    <div className="panel-catalog-list" aria-label="패널 목록">
      <div className="settings-section-title">작업 패널</div>
      {PANEL_CATALOG_TYPES.map((panelType) => (
        <PanelCatalogItem
          key={panelType}
          panelType={panelType}
          layout={layout}
          activeSymbol={activeSymbol}
          onCommand={onCommand}
        />
      ))}
    </div>
  );
}

function PanelCatalogItem({
  panelType,
  layout,
  activeSymbol,
  onCommand
}: {
  panelType: PanelType;
  layout: WorkspaceLayout;
  activeSymbol: SupportedSymbol;
  onCommand: (command: LayoutCommand) => void;
}) {
  const definition = getPanelDefinition(panelType);
  const beginPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const source = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let latestX = startX;
    let latestY = startY;
    let moved = false;

    source.setPointerCapture?.(event.pointerId);

    const handleMove = (moveEvent: PointerEvent) => {
      latestX = moveEvent.clientX;
      latestY = moveEvent.clientY;
      moved = moved || Math.abs(latestX - startX) + Math.abs(latestY - startY) > 8;
    };

    const handleUp = (upEvent: PointerEvent) => {
      source.removeEventListener("pointermove", handleMove);
      source.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      try {
        source.releasePointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture may already be released when native drag is active.
      }

      if (!moved) {
        return;
      }

      const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const frame = dropTarget?.closest(".layout-frame");
      if (!(frame instanceof HTMLElement)) {
        return;
      }

      const targetPanelId = dropTarget?.closest<HTMLElement>("[data-panel-id]")?.dataset.panelId ?? null;
      const cell = getWorkspaceDropCell(frame.getBoundingClientRect(), upEvent.clientX, upEvent.clientY);
      const command = createPanelDropCommand({ layout, panelType, activeSymbol, cell, targetPanelId });
      if (command) {
        onCommand(command);
      }
    };

    source.addEventListener("pointermove", handleMove);
    source.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  return (
    <div
      className="panel-catalog-item"
      data-panel-catalog-type={panelType}
      aria-label={`${definition.title} 패널 추가`}
      draggable
      role="button"
      tabIndex={0}
      title={`${definition.title} 패널을 작업 화면으로 드래그`}
      onDragStart={(event) => {
        event.dataTransfer.setData(PANEL_CATALOG_MIME, panelType);
        event.dataTransfer.setData("text/plain", panelType);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onPointerDown={beginPointerDrag}
    >
      <strong>{definition.title}</strong>
      <span>{catalogDescription(panelType)}</span>
    </div>
  );
}

function catalogDescription(panelType: PanelType): string {
  switch (panelType) {
    case "chart":
      return "차트 작업 공간";
    case "newsFeed":
      return "시장 뉴스";
    case "symbolSummary":
      return "종목 요약";
    case "aiSummary":
      return "AI 요약";
    case "watchlist":
      return "관심 종목";
    case "indicatorCompare":
      return "지표 비교";
    case "orderTicket":
      return "주문 입력";
    case "proposalReview":
      return "제안 검토";
    case "notifications":
      return "알림";
    default:
      return "작업 패널";
  }
}

function LayoutsSettings({
  layout,
  savedLayouts,
  onCommand
}: {
  layout: WorkspaceLayout;
  savedLayouts: SavedLayoutRecord[];
  onCommand: (command: LayoutCommand) => void;
}) {
  const defaultLayouts = savedLayouts.filter((record) => record.kind === "default");
  const userLayouts = savedLayouts.filter((record) => record.kind === "user");
  const usedSlots = new Set(savedLayouts.map((record) => record.favoriteSlot).filter(Boolean));
  const nextFavoriteSlot = findNextFavoriteSlot(usedSlots);

  return (
    <div className="layout-settings">
      <div className="settings-section-title">기본 프리셋</div>
      {defaultLayouts.map((record) => (
        <LayoutRecordRow
          key={record.id}
          layout={layout}
          record={record}
          nextFavoriteSlot={nextFavoriteSlot}
          onCommand={onCommand}
        />
      ))}

      <div className="settings-section-title">사용자 프리셋</div>
      {userLayouts.length === 0 ? (
        <span className="empty-layout-note">저장된 사용자 프리셋이 없습니다</span>
      ) : (
        userLayouts.map((record) => (
          <LayoutRecordRow
            key={record.id}
            layout={layout}
            record={record}
            nextFavoriteSlot={nextFavoriteSlot}
            onCommand={onCommand}
          />
        ))
      )}
      <button
        className="add-layout-button"
        disabled={userLayouts.length >= MAX_USER_LAYOUTS}
        onClick={() => onCommand(makeCommand("layout.save", "user", { name: `레이어 프리셋 ${userLayouts.length + 1}` }))}
      >
        <Plus size={15} /> 프리셋 추가
      </button>
    </div>
  );
}

function LayoutRecordRow({
  layout,
  record,
  nextFavoriteSlot,
  onCommand
}: {
  layout: WorkspaceLayout;
  record: SavedLayoutRecord;
  nextFavoriteSlot: FavoriteLayoutSlot | null;
  onCommand: (command: LayoutCommand) => void;
}) {
  const isSame = layoutSnapshotsEqual(layout, record.layout);
  const favoriteDisabled = !record.favoriteSlot && nextFavoriteSlot === null;

  return (
    <div className="layout-record-row">
      <button
        className="layout-record-name"
        title={record.name}
        onClick={() => onCommand(makeCommand("layout.load", "user", { savedLayoutId: record.id }))}
      >
        {record.name}
      </button>
      <button
        title={favoriteDisabled ? "즐겨찾기 슬롯이 가득 찼습니다" : "즐겨찾기"}
        disabled={favoriteDisabled}
        onClick={() =>
          onCommand(
            makeCommand("layout.favorite.set", "user", {
              savedLayoutId: record.id,
              favoriteSlot: record.favoriteSlot ? null : nextFavoriteSlot
            })
          )
        }
      >
        <Star size={14} />
        {record.favoriteSlot ?? ""}
      </button>
      {record.kind === "default" && (
        <button
          title="기본값 복원"
          onClick={() => onCommand(makeCommand("layout.default.restore", "user", { defaultKey: record.defaultKey }))}
        >
          <RotateCcw size={14} />
        </button>
      )}
      <button
        title="저장 상태 업데이트"
        disabled={isSame}
        onClick={() => onCommand(makeCommand("layout.update", "user", { savedLayoutId: record.id }))}
      >
        수정
      </button>
      {record.kind === "user" && (
        <button
          title="레이아웃 삭제"
          onClick={() => onCommand(makeCommand("layout.delete", "user", { savedLayoutId: record.id }))}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function findNextFavoriteSlot(usedSlots: Set<unknown>): FavoriteLayoutSlot | null {
  for (const slot of [1, 2, 3, 4] as const) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }

  return null;
}

function AgentSettings({
  agents,
  editingAgentId,
  onEditAgent,
  onUpdateAgent,
  onAddAgent,
  onDeleteAgent
}: {
  agents: AgentOption[];
  editingAgentId?: string;
  onEditAgent: (agentId?: string) => void;
  onUpdateAgent: (agentId: string, patch: AgentUpdatePatch) => void;
  onAddAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
}) {
  return (
    <div className="agent-settings-list">
      {agents.map((agent) => {
        const editing = editingAgentId === agent.id;

        return (
          <div key={agent.id} className={editing ? "agent-settings-row editing" : "agent-settings-row"}>
            {!editing && (
              <button className="agent-settings-summary" onClick={() => onEditAgent(agent.id)}>
                <img src={agent.iconUrl} alt="" />
                <span className="agent-settings-name">{agent.label}</span>
              </button>
            )}
            {editing && (
              <div className="agent-settings-editor">
                <button
                  className="agent-icon-edit-button"
                  title="AI 아이콘 변경"
                  aria-label={`${agent.label} 아이콘`}
                  onClick={() => onUpdateAgent(agent.id, { iconUrl: getNextAgentIconUrl(agent.iconUrl) })}
                >
                  <img src={agent.iconUrl} alt="" />
                </button>
                <input
                  className="agent-name-input"
                  value={agent.label}
                  onChange={(event) => onUpdateAgent(agent.id, { label: event.target.value })}
                  aria-label={`${agent.label} 이름`}
                />
                <button className="agent-delete-button" onClick={() => onDeleteAgent(agent.id)} disabled={agents.length <= 1}>
                  삭제
                </button>
                <textarea
                  className="agent-description-input"
                  value={agent.description}
                  onChange={(event) => onUpdateAgent(agent.id, { description: event.target.value })}
                  aria-label={`${agent.label} 설명`}
                />
              </div>
            )}
          </div>
        );
      })}
      <button className="add-layout-button" onClick={onAddAgent} disabled={agents.length >= 4}>
        <Plus size={15} /> AI 추가
      </button>
    </div>
  );
}

const agentIconOptions = Array.from(
  { length: 12 },
  (_, index) => `/assets/agent-icons/agent-${String(index + 1).padStart(2, "0")}.svg`
);

function getNextAgentIconUrl(currentIconUrl: string): string {
  const currentIndex = agentIconOptions.indexOf(currentIconUrl);
  return agentIconOptions[(currentIndex + 1) % agentIconOptions.length] ?? agentIconOptions[0];
}

async function readApiErrorMessage(response: Response, label: string): Promise<string> {
  let detail = "";

  try {
    const body = await response.text();
    if (body.trim()) {
      try {
        const parsed = JSON.parse(body) as { detail?: unknown };
        detail = typeof parsed.detail === "string" ? parsed.detail : body;
      } catch {
        detail = body;
      }
    }
  } catch {
    detail = "";
  }

  return detail.trim() ? `${label} 응답 오류 ${response.status}: ${detail}` : `${label} 응답 오류 ${response.status}`;
}
