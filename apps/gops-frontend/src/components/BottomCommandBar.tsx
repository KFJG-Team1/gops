import { Bell, ChevronDown, ChevronUp, LayoutPanelTop, SendHorizontal, Settings, Square, Star, UserCircle, WalletCards } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { AuthUser } from "../auth/AuthProvider";
import type { ChartSymbolDto } from "../chart/types";
import { PortfolioHoldingsPanel } from "./PortfolioHoldingsPanel";

export type BottomMenuKey = "I" | "II" | "III" | "IV" | "V" | "VI";
export type ChatLogEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
};
export type AgentSubmitResult = "chat-log" | "chart-shortcut" | "ignored";

type BottomMenuSide = "left" | "right";

type BottomCommandBarProps = {
  activeMenu: BottomMenuKey | null;
  agentBusy: boolean;
  agentInput: string;
  chatLog: ChatLogEntry[];
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  canUseAgent: boolean;
  hasChartCommandTarget: boolean;
  symbols: ChartSymbolDto[];
  activeSymbol: string;
  isChartMode: boolean;
  onAgentCancel: () => void;
  onAgentInputChange: (value: string) => void;
  onAgentSubmit: (event: FormEvent<HTMLFormElement>) => AgentSubmitResult | Promise<AgentSubmitResult>;
  onCloseMenu: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onToggleMenu: (key: BottomMenuKey) => void;
};

const leftMenuKeys: BottomMenuKey[] = ["I", "II", "III"];
const rightMenuKeys: BottomMenuKey[] = ["IV", "V", "VI"];

export function BottomCommandBar({
  activeMenu,
  agentBusy,
  agentInput,
  chatLog,
  authEnabled,
  authLoading,
  authUser,
  canUseAgent,
  hasChartCommandTarget,
  symbols,
  activeSymbol,
  isChartMode,
  onAgentCancel,
  onAgentInputChange,
  onAgentSubmit,
  onCloseMenu,
  onLogin,
  onLogout,
  onSelectSymbol,
  onShowTreeMap,
  onToggleMenu
}: BottomCommandBarProps) {
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const hasFloatingPanel = activeMenu !== null || chatPanelOpen;

  useEffect(() => {
    if (!hasFloatingPanel) {
      return undefined;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(".bottom-menu-panel, .bottom-nav-actions, .bottom-chat-panel, .agent-dock")) {
        return;
      }
      if (activeMenu) {
        onCloseMenu();
      }
      if (chatPanelOpen) {
        setChatPanelOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [activeMenu, chatPanelOpen, hasFloatingPanel, onCloseMenu]);

  const closeFloatingPanels = () => {
    if (activeMenu) {
      onCloseMenu();
    }
    setChatPanelOpen(false);
  };

  const toggleChatPanel = () => {
    setChatPanelOpen((current) => {
      const next = !current;
      if (next && activeMenu) {
        onCloseMenu();
      }
      return next;
    });
  };

  const toggleBottomMenu = (key: BottomMenuKey) => {
    setChatPanelOpen(false);
    onToggleMenu(key);
  };

  const submitAgentPrompt = async (event: FormEvent<HTMLFormElement>) => {
    const hasPrompt = Boolean(agentInput.trim());
    if (hasPrompt && activeMenu) {
      onCloseMenu();
    }
    const result = await onAgentSubmit(event);
    if (hasPrompt && result === "chart-shortcut") {
      setChatPanelOpen(false);
      return;
    }
    if (hasPrompt && result === "chat-log") {
      setChatPanelOpen(true);
    }
  };

  return (
    <>
      {hasFloatingPanel && (
        <button
          type="button"
          className="bottom-menu-dismiss-layer"
          aria-label="Close bottom floating panel"
          onClick={closeFloatingPanels}
        />
      )}
      <nav className="workspace-bottom-nav" aria-label="Workspace command bar">
        <MenuActionGroup
          side="left"
          keys={leftMenuKeys}
          activeMenu={activeMenu}
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          symbols={symbols}
          activeSymbol={activeSymbol}
          onLogin={onLogin}
          onLogout={onLogout}
          onSelectSymbol={onSelectSymbol}
          onShowTreeMap={onShowTreeMap}
          onCloseMenu={onCloseMenu}
          onToggleMenu={toggleBottomMenu}
        />
        <div className={`agent-dock ${chatPanelOpen ? "is-chat-open" : ""}`}>
          <button
            type="button"
            className="agent-dock-toggle"
            aria-label={chatPanelOpen ? "채팅 로그 닫기" : "채팅 로그 열기"}
            aria-expanded={chatPanelOpen}
            onClick={toggleChatPanel}
          >
            {chatPanelOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          <section className={`bottom-chat-panel surface-floating ${chatPanelOpen ? "is-open" : ""}`} aria-label="Chart agent conversation" aria-hidden={!chatPanelOpen}>
            <div className="bottom-chat-log" role="log" aria-live="polite">
              {chatLog.length ? chatLog.map((entry) => (
                <article key={entry.id} className={`bottom-chat-message ${entry.role} ${entry.pending ? "is-pending" : ""}`}>
                  <span className="bottom-chat-message-role">{entry.role === "user" ? "You" : entry.role === "assistant" ? "Agent" : "System"}</span>
                  <p>{entry.text}</p>
                </article>
              )) : (
                <p className="bottom-chat-empty">질문을 입력하면 이곳에 대화가 남습니다.</p>
              )}
            </div>
          </section>
          <form className="agent-box surface-raised" onSubmit={submitAgentPrompt}>
            <input
              value={agentInput}
              onChange={(event) => onAgentInputChange(event.target.value)}
              placeholder={agentPlaceholder(isChartMode, canUseAgent, hasChartCommandTarget)}
              aria-label="Agent command"
              disabled={agentBusy || !canUseAgent}
            />
            <button
              type={agentBusy ? "button" : "submit"}
              className={agentBusy ? "agent-stop-button" : undefined}
              aria-label={agentBusy ? "Agent 분석 중단" : "Agent에게 전송"}
              title={agentBusy ? "Agent 분석 중단" : "Agent에게 전송"}
              disabled={!agentBusy && !canUseAgent}
              onClick={agentBusy ? onAgentCancel : undefined}
            >
              {agentBusy ? <Square size={13} aria-hidden="true" /> : <SendHorizontal size={15} aria-hidden="true" />}
            </button>
          </form>
        </div>
        <MenuActionGroup
          side="right"
          keys={rightMenuKeys}
          activeMenu={activeMenu}
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          symbols={symbols}
          activeSymbol={activeSymbol}
          onLogin={onLogin}
          onLogout={onLogout}
          onSelectSymbol={onSelectSymbol}
          onShowTreeMap={onShowTreeMap}
          onCloseMenu={onCloseMenu}
          onToggleMenu={toggleBottomMenu}
        />
      </nav>
    </>
  );
}

function MenuActionGroup({
  side,
  keys,
  activeMenu,
  authEnabled,
  authLoading,
  authUser,
  symbols,
  activeSymbol,
  onLogin,
  onLogout,
  onSelectSymbol,
  onShowTreeMap,
  onCloseMenu,
  onToggleMenu
}: {
  side: BottomMenuSide;
  keys: BottomMenuKey[];
  activeMenu: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  symbols: ChartSymbolDto[];
  activeSymbol: string;
  onLogin: () => void;
  onLogout: () => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onCloseMenu: () => void;
  onToggleMenu: (key: BottomMenuKey) => void;
}) {
  const isMenuOpen = activeMenu !== null && keys.includes(activeMenu);

  return (
    <div
      className={`bottom-nav-actions ${side} ${isMenuOpen ? "is-menu-open" : ""}`}
      aria-label={`Menu actions ${side}`}
    >
      <BottomMenuPanel
        side={side}
        activeKey={activeMenu}
        authEnabled={authEnabled}
        authLoading={authLoading}
        authUser={authUser}
        symbols={symbols}
        activeSymbol={activeSymbol}
        onLogin={onLogin}
        onLogout={onLogout}
        onSelectSymbol={onSelectSymbol}
        onShowTreeMap={onShowTreeMap}
        onClose={onCloseMenu}
      />
      {keys.map((label) => (
        <button
          key={label}
          type="button"
          className={`workspace-nav-button surface-raised ${activeMenu === label ? "is-active" : ""}`}
          aria-label={bottomMenuLabel(label)}
          title={bottomMenuLabel(label)}
          aria-expanded={activeMenu === label}
          onClick={() => onToggleMenu(label)}
        >
          {bottomMenuIcon(label)}
        </button>
      ))}
    </div>
  );
}

function BottomMenuPanel({
  side,
  activeKey,
  authEnabled,
  authLoading,
  authUser,
  symbols,
  activeSymbol,
  onLogin,
  onLogout,
  onSelectSymbol,
  onShowTreeMap,
  onClose
}: {
  side: BottomMenuSide;
  activeKey: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  symbols: ChartSymbolDto[];
  activeSymbol: string;
  onLogin: () => void;
  onLogout: () => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onClose: () => void;
}) {
  const sideKeys = side === "left" ? leftMenuKeys : rightMenuKeys;
  const isOpen = activeKey !== null && sideKeys.includes(activeKey);
  const menuContent = isOpen
    ? bottomMenuContent({
      activeKey,
      authEnabled,
      authLoading,
      authUser,
      symbols,
      activeSymbol,
      onLogin,
      onLogout,
      onSelectSymbol,
      onShowTreeMap,
      onClose
    })
    : <p className="bottom-menu-empty">Menu</p>;

  return (
    <section
      className={`bottom-menu-panel surface-floating ${side} ${isOpen ? "is-open" : ""}`}
      aria-label={`${side === "left" ? "Left" : "Right"} menu panel`}
      aria-hidden={!isOpen}
    >
      <div className="bottom-menu-list">{menuContent}</div>
    </section>
  );
}

function agentPlaceholder(isChartMode: boolean, canUseAgent: boolean, hasChartCommandTarget: boolean): string {
  if (!canUseAgent) {
    return "로그인 후 Agent를 사용할 수 있습니다";
  }
  if (hasChartCommandTarget) {
    return isChartMode ? "선택한 차트에 명령하기" : "종목 차트를 연 뒤 차트를 선택하세요";
  }
  return isChartMode ? "Agent에게 물어보기" : "기업명/티커로 차트 열기";
}

function bottomMenuIcon(key: BottomMenuKey): ReactNode {
  const size = 17;
  return {
    I: <LayoutPanelTop size={size} aria-hidden="true" />,
    II: <WalletCards size={size} aria-hidden="true" />,
    III: <Star size={size} aria-hidden="true" />,
    IV: <Bell size={size} aria-hidden="true" />,
    V: <UserCircle size={size} aria-hidden="true" />,
    VI: <Settings size={size} aria-hidden="true" />
  }[key];
}

function bottomMenuLabel(key: BottomMenuKey): string {
  return {
    I: "레이아웃/페이지",
    II: "포트폴리오",
    III: "관심종목",
    IV: "알림설정",
    V: "로그인/프로필",
    VI: "설정"
  }[key];
}

function bottomMenuContent({
  activeKey,
  authEnabled,
  authLoading,
  authUser,
  symbols,
  activeSymbol,
  onLogin,
  onLogout,
  onSelectSymbol,
  onShowTreeMap,
  onClose
}: {
  activeKey: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  symbols: ChartSymbolDto[];
  activeSymbol: string;
  onLogin: () => void;
  onLogout: () => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onClose: () => void;
}) {
  switch (activeKey) {
    case "I":
      return (
        <div className="bottom-menu-section">
          <MenuTitle icon={<LayoutPanelTop size={15} />} title="레이아웃" detail="페이지와 배치" />
          <button
            type="button"
            className="bottom-menu-item surface-raised"
            onClick={() => {
              onShowTreeMap();
              onClose();
            }}
          >
            홈화면
          </button>
        </div>
      );
    case "II":
      return (
        <div className="bottom-menu-section bottom-menu-scroll">
          <MenuTitle title="포트폴리오" detail="보유종목" />
          <PortfolioHoldingsPanel
            onSelectSymbol={(symbol) => {
              onSelectSymbol(symbol);
              onClose();
              return true;
            }}
          />
        </div>
      );
    case "III":
      return (
        <div className="bottom-menu-section bottom-menu-scroll">
          <MenuTitle icon={<Star size={15} />} title="관심종목" detail="현재 기본 목록" />
          <div className="bottom-watchlist">
            {symbols.slice(0, 24).map((item) => (
              <button
                key={item.symbol}
                type="button"
                className={item.symbol === activeSymbol ? "bottom-watchlist-row active" : "bottom-watchlist-row"}
                onClick={() => {
                  onSelectSymbol(item.symbol);
                  onClose();
                }}
              >
                <strong>{item.symbol}</strong>
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      );
    case "IV":
      return (
        <div className="bottom-menu-section">
          <MenuTitle icon={<Bell size={15} />} title="알림설정" detail="실시간 알림 진입점" />
          <p className="bottom-menu-empty">알림 스트림 연결은 후속 단계로 남겨두고, 현재는 진입점만 제공합니다.</p>
        </div>
      );
    case "V":
      return (
        <div className="bottom-menu-section account-menu-section">
          <MenuTitle icon={<UserCircle size={15} />} title="계정" detail={authEnabled ? "Google OAuth" : "Local dev"} />
          {authLoading && <p className="bottom-menu-empty">계정 상태를 확인하고 있습니다.</p>}
          {!authLoading && authUser && (
            <div className="account-menu-card">
              {authUser.picture && <img src={authUser.picture} alt="" />}
              <strong>{authUser.name || authUser.email}</strong>
              <span>{authUser.email}</span>
            </div>
          )}
          {!authLoading && !authUser && !authEnabled && (
            <p className="bottom-menu-empty">로컬 개발 모드에서는 로그인 없이 Agent를 사용할 수 있습니다.</p>
          )}
          {!authLoading && !authUser && authEnabled && (
            <button className="bottom-menu-item surface-raised" type="button" onClick={onLogin}>
              Google login
            </button>
          )}
          {authUser && (
            <button className="bottom-menu-item surface-raised danger" type="button" onClick={onLogout}>
              로그아웃
            </button>
          )}
        </div>
      );
    case "VI":
      return (
        <div className="bottom-menu-section">
          <MenuTitle icon={<Settings size={15} />} title="설정" detail="작업 환경" />
          <p className="bottom-menu-empty">테마, Agent, 패널 설정을 이 영역에서 확장합니다.</p>
        </div>
      );
    default:
      return <p className="bottom-menu-empty">Menu</p>;
  }
}

function MenuTitle({ icon, title, detail }: { icon?: ReactNode; title: string; detail: string }) {
  return (
    <header className="bottom-menu-title">
      {icon}
      <span>{title}</span>
      <small>{detail}</small>
    </header>
  );
}
