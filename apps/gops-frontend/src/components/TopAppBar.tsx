import { ChevronDown, Redo2, Search, Undo2, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupportedSymbol, WatchlistSymbol } from "@gops/chart-engine/symbols";
import { layoutPresentationSnapshotsEqual, makeCommand } from "../layout/commands";
import type { LayoutCommand, SavedLayoutRecord, WorkspaceLayout } from "../layout/types";
import { SystemOrbRail, type AgentOption } from "./SystemArea";

type TopAppBarProps = {
  layout: WorkspaceLayout;
  savedLayouts: SavedLayoutRecord[];
  autoEnabled: boolean;
  agents: AgentOption[];
  selectedAgentIds: string[];
  settingsActive: boolean;
  notificationsActive: boolean;
  activeSymbol: SupportedSymbol;
  symbolOptions: readonly WatchlistSymbol[];
  symbolSearchError?: string;
  onToggleAuto: () => void;
  onToggleNotifications: () => void;
  onToggleAgent: (agentId: string) => void;
  onToggleSettings: () => void;
  onSymbolQueryChange: (query: string) => void;
  onSymbolOptionsRequest: (query: string) => void;
  onSymbolSearch: (symbol: string) => boolean;
  onCommand: (command: LayoutCommand) => void;
};

function isInteractiveTopBarTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest("button, input, textarea, select, option, datalist, form, a, [role='button']"));
}

export function TopAppBar({
  layout,
  savedLayouts,
  autoEnabled,
  agents,
  selectedAgentIds,
  settingsActive,
  notificationsActive,
  activeSymbol,
  symbolOptions,
  symbolSearchError,
  onToggleAuto,
  onToggleNotifications,
  onToggleAgent,
  onToggleSettings,
  onSymbolQueryChange,
  onSymbolOptionsRequest,
  onSymbolSearch,
  onCommand
}: TopAppBarProps) {
  const favoriteLayouts = [1, 2, 3, 4].map((slot) => savedLayouts.find((record) => record.favoriteSlot === slot));
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchDraft, setSearchDraft] = useState<string>(activeSymbol);
  const [symbolDropdownQuery, setSymbolDropdownQuery] = useState<string>(activeSymbol);
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);
  const filteredSymbolOptions = useMemo(() => {
    const query = symbolDropdownQuery.trim().toUpperCase();
    return symbolOptions
      .filter((item) => !query || item.symbol.includes(query))
      .slice(0, 40);
  }, [symbolDropdownQuery, symbolOptions]);

  useEffect(() => {
    setSearchDraft(activeSymbol);
  }, [activeSymbol]);

  const submitSymbol = (value: string) => {
    if (onSymbolSearch(value)) {
      setSymbolDropdownOpen(false);
    }
  };

  const readSearchInputValue = () => searchInputRef.current?.value ?? searchDraft;

  return (
    <header
      className="top-app-bar"
      onClick={(event) => {
        if (!isInteractiveTopBarTarget(event.target)) {
          onCommand(makeCommand("layout.panel.select", "user", { clear: true }));
        }
      }}
    >
      <form
        className={symbolSearchError ? "brand-search has-error" : "brand-search"}
        onSubmit={(event) => {
          event.preventDefault();
          const submittedSymbol = new FormData(event.currentTarget).get("symbolSearch");
          submitSymbol(typeof submittedSymbol === "string" ? submittedSymbol : searchDraft);
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setSymbolDropdownOpen(false);
          }
        }}
      >
        <span className="brand-mark">GOPS</span>
        <span className="search-divider" />
        <input
          ref={searchInputRef}
          name="symbolSearch"
          value={searchDraft}
          placeholder="Search symbol"
          aria-label="Search symbol"
          aria-invalid={Boolean(symbolSearchError)}
          title={symbolSearchError ?? "Search Alpaca stock symbol"}
          onChange={(event) => {
            const value = event.target.value.toUpperCase();
            setSearchDraft(value);
            if (symbolDropdownOpen) {
              setSymbolDropdownQuery(value);
            }
            onSymbolQueryChange(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitSymbol(event.currentTarget.value);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSymbolDropdownOpen(true);
            }
            if (event.key === "Escape") {
              setSymbolDropdownOpen(false);
            }
          }}
        />
        <button
          type="button"
          className={symbolDropdownOpen ? "search-dropdown-button active" : "search-dropdown-button"}
          title="Show searchable symbols"
          aria-label="Show searchable symbols"
          aria-expanded={symbolDropdownOpen}
          onClick={() => {
            const value = readSearchInputValue().toUpperCase();
            const query = value === activeSymbol ? "" : value;
            setSearchDraft(value);
            setSymbolDropdownQuery(query);
            onSymbolOptionsRequest(query);
            setSymbolDropdownOpen((open) => !open);
          }}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <button type="submit" className="search-submit-button" title="Search symbol">
          <Search size={15} aria-hidden="true" />
        </button>
        {symbolDropdownOpen && (
          <div className="symbol-search-dropdown" role="listbox" aria-label="Searchable symbols">
            {filteredSymbolOptions.map((item) => (
              <button
                key={item.symbol}
                type="button"
                role="option"
                className="symbol-search-option"
                aria-selected={item.symbol === activeSymbol}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSearchDraft(item.symbol);
                  setSymbolDropdownQuery(item.symbol);
                  onSymbolQueryChange(item.symbol);
                  submitSymbol(item.symbol);
                }}
              >
                <strong>{item.symbol}</strong>
                <span>{item.name}</span>
              </button>
            ))}
            {filteredSymbolOptions.length === 0 && (
              <span className="symbol-search-empty">No matching symbols</span>
            )}
          </div>
        )}
        {symbolSearchError && <span className="search-error-message">{symbolSearchError}</span>}
      </form>

      <nav className="favorite-layout-strip" aria-label="Favorite layouts">
        {favoriteLayouts.map((layoutRecord, index) => (
          <button
            key={index + 1}
            className={layoutRecord && layoutPresentationSnapshotsEqual(layout, layoutRecord.layout)
              ? "favorite-layout-button filled active"
              : layoutRecord
                ? "favorite-layout-button filled"
                : "favorite-layout-button"}
            title={layoutRecord?.name ?? `Favorite layout ${index + 1}`}
            disabled={!layoutRecord}
            onClick={() => {
              if (layoutRecord) {
                onCommand(makeCommand("layout.load", "user", { savedLayoutId: layoutRecord.id }));
              }
            }}
          >
            {index + 1}
          </button>
        ))}
      </nav>

      <div className="top-right-controls" aria-label="Layout controls">
        <div className="toolbar-group" aria-label="Layout history">
          <button title="Layout undo" onClick={() => onCommand(makeCommand("layout.undo", "user"))}>
            <Undo2 size={16} />
          </button>
          <button title="Layout redo" onClick={() => onCommand(makeCommand("layout.redo", "user"))}>
            <Redo2 size={16} />
          </button>
        </div>
        <div className="toolbar-group" aria-label="Automation controls">
          <button
            className={autoEnabled ? "toggle-button active" : "toggle-button"}
            title={autoEnabled ? "AI command auto apply on" : "AI command auto apply off"}
            aria-pressed={autoEnabled}
            aria-label="AI command auto apply"
            onClick={onToggleAuto}
          >
            <WandSparkles size={18} />
          </button>
        </div>
      </div>

      <div className="headline-alert-strip" aria-label="Realtime headline and alert message">
        <span>Realtime headline placeholder</span>
        <strong>Alerts and agent messages appear here</strong>
      </div>

      <SystemOrbRail
        agents={agents}
        selectedAgentIds={selectedAgentIds}
        settingsActive={settingsActive}
        notificationsActive={notificationsActive}
        onToggleAgent={onToggleAgent}
        onToggleNotifications={onToggleNotifications}
        onToggleSettings={onToggleSettings}
      />
    </header>
  );
}
