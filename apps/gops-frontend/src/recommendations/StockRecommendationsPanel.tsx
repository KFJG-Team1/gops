import { AlertTriangle, ChevronRight, LoaderCircle, RefreshCcw, Settings } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentReferenceKey,
  stockRecommendationReference,
  type AgentReference
} from "../agent/agentReferences";
import { LogoDevAttribution, StockLogo } from "../components/StockLogo";
import { sectorLabelKo } from "../market/sectors";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import { latestSimulatorStatus, simulatorStatusEvent, type SimulatorStatus } from "../simulator/simulatorApi";
import {
  fetchStockRecommendations,
  refreshStockRecommendations,
  type RecommendationSessionMode,
  type StockRecommendationItem,
  type StockRecommendationPayload
} from "./recommendationApi";
import { RecommendationSettingsDialog } from "./RecommendationSettingsDialog";

const companyNameBySymbol = new Map(sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item.companyName]));
const RECOMMENDATION_STACK_INTERVAL_MS = 8_000;

export type StockRecommendationSelection = {
  item: StockRecommendationItem;
  payload: StockRecommendationPayload;
  sessionMode: RecommendationSessionMode;
  reference: AgentReference;
};

export function StockRecommendationsPanel({
  activeSymbol,
  sourcePanelId,
  selectedSymbol,
  selectedRecommendation,
  selectedAgentReferenceKeys,
  emphasizedAgentReferenceKeys,
  onSelectReference,
  initialSessionMode,
  variant = "files"
}: {
  activeSymbol: string;
  sourcePanelId: string;
  selectedSymbol: string | null;
  selectedRecommendation: StockRecommendationSelection | null;
  selectedAgentReferenceKeys: string[];
  emphasizedAgentReferenceKeys: string[];
  onSelectReference: (
    reference: AgentReference | null,
    selection?: StockRecommendationSelection | null,
    replaceExisting?: boolean
  ) => void;
  initialSessionMode?: RecommendationSessionMode;
  variant?: "files" | "list";
}) {
  const [payload, setPayload] = useState<StockRecommendationPayload | null>(null);
  const [sessionMode, setSessionMode] = useState<RecommendationSessionMode>(() => (
    initialSessionMode ?? initialRecommendationSessionMode()
  ));
  const [regularLive, setRegularLive] = useState(() => isRegularSessionNow());
  const [simulatorKey, setSimulatorKey] = useState(() => {
    const status = latestSimulatorStatus();
    return `${status?.mode ?? "live"}:${status?.runId ?? ""}:${status?.phase ?? ""}`;
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (latestSimulatorStatus()?.mode === "simulation") {
      setPayload(null);
      setLoading(false);
      setError("시뮬레이션 시각 기준 추천 데이터가 없어 표시하지 않습니다.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setPayload(await fetchStockRecommendations(sessionMode, signal));
    } catch (caught) {
      if (isAbortError(caught)) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "추천을 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [sessionMode, simulatorKey]);

  const refresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      setPayload(await refreshStockRecommendations(activeSymbol, sessionMode));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천을 갱신하지 못했습니다.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [activeSymbol, sessionMode]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setSessionMode(initialSessionMode ?? initialRecommendationSessionMode());
  }, [initialSessionMode]);

  useEffect(() => {
    const updateLiveState = () => setRegularLive(isRegularSessionNow());
    updateLiveState();
    const timer = window.setInterval(updateLiveState, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const status = (event as CustomEvent<SimulatorStatus>).detail;
      setSimulatorKey(`${status?.mode ?? "live"}:${status?.runId ?? ""}:${status?.phase ?? ""}`);
    };
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleStatus);
  }, []);

  const items = useMemo(() => payload?.items ?? [], [payload?.items]);

  useEffect(() => {
    if (loading || !payload || !selectedSymbol || selectedRecommendation?.reference.sourcePanelId !== sourcePanelId) {
      return;
    }
    const selectedItem = items.find((item) => item.symbol === selectedSymbol);
    if (!selectedItem) {
      onSelectReference(null, null, true);
      return;
    }
    if (selectedRecommendation.item !== selectedItem || selectedRecommendation.payload !== payload) {
      const reference = stockRecommendationReference(selectedItem, sourcePanelId);
      onSelectReference(reference, recommendationSelection(selectedItem, payload, sessionMode, reference), true);
    }
  }, [items, loading, onSelectReference, payload, selectedRecommendation, selectedSymbol, sessionMode, sourcePanelId]);

  return (
    <>
      <section
        className={`stock-recommendations-panel ${variant === "list" ? "stock-recommendations-list-panel" : ""}`.trim()}
        aria-label={variant === "list" ? "장중 매수 추천 목록" : "장중 매수 추천"}
      >
        <button
          className="panel-reload-overlay panel-icon-button"
          type="button"
          title="추천 갱신"
          aria-label="추천 갱신"
          onClick={refresh}
          disabled={loading || refreshing}
        >
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
        </button>
        <div className="stock-rec-toolbar">
          <div className="stock-rec-toolbar-leading">
            <button
              ref={settingsButtonRef}
              className="stock-rec-settings-button panel-icon-button"
              type="button"
              title="추천 설정"
              aria-label="추천 설정"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="stock-rec-session-toggle" role="group" aria-label="추천 세션">
            <button
              type="button"
              className={sessionButtonClass(sessionMode === "pre")}
              aria-pressed={sessionMode === "pre"}
              onClick={() => setSessionMode("pre")}
              disabled={loading || refreshing}
            >
              장전
            </button>
            <button
              type="button"
              className={sessionButtonClass(sessionMode === "regular", regularLive)}
              aria-pressed={sessionMode === "regular"}
              onClick={() => setSessionMode("regular")}
              disabled={loading || refreshing}
            >
              본장
            </button>
          </div>
        </div>

        {loading && (
          <div className="stock-rec-state">
            <LoaderCircle size={14} className="spin" />
            <span>추천을 불러오는 중입니다</span>
          </div>
        )}

        {!loading && error && <div className="stock-rec-error">{error}</div>}

        {!loading && !error && payload?.status === "profile_required" && (
          <div className="stock-rec-state">
            <AlertTriangle size={15} />
            <span>장중 추천 설정을 저장해 주세요</span>
          </div>
        )}

        {!loading && !error && payload?.status === "market_closed" && (
          <div className="stock-rec-state">
            <AlertTriangle size={15} />
            <span>{marketClosedMessage(sessionMode)}</span>
          </div>
        )}

        {!loading && !error && payload?.status === "data_not_ready" && (
          <div className="stock-rec-state">
            <AlertTriangle size={15} />
            <span>{emptyMessage(payload, sessionMode)}</span>
          </div>
        )}

        {!loading && !error && payload?.status !== "profile_required" && payload?.status !== "market_closed" && payload?.status !== "data_not_ready" && items.length === 0 && (
          <div className="stock-rec-state">{emptyMessage(payload, sessionMode)}</div>
        )}

        {!loading && !error && payload && items.length > 0 && (
          variant === "list" ? (
            <div className="stock-rec-list">
              {items.map((item) => {
                const reference = stockRecommendationReference(item, sourcePanelId);
                const referenceKey = agentReferenceKey(reference);
                return (
                  <RecommendationListRow
                    key={`${item.rank}-${item.symbol}`}
                    item={item}
                    reference={reference}
                    selected={selectedAgentReferenceKeys.includes(referenceKey)}
                    emphasized={emphasizedAgentReferenceKeys.includes(referenceKey)}
                    onSelectReference={(selectedReference) => onSelectReference(
                      selectedReference,
                      recommendationSelection(item, payload, sessionMode, selectedReference)
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <RecommendationFileStack
              items={items}
              sourcePanelId={sourcePanelId}
              payload={payload}
              sessionMode={sessionMode}
              selectedSymbol={selectedSymbol}
              selectedAgentReferenceKeys={selectedAgentReferenceKeys}
              emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
              onSelectReference={onSelectReference}
            />
          )
        )}
        <LogoDevAttribution className="panel-logo-attribution" />
      </section>
      {settingsOpen && (
        <RecommendationSettingsDialog
          returnFocusRef={settingsButtonRef}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function RecommendationFileStack({
  items,
  sourcePanelId,
  payload,
  sessionMode,
  selectedSymbol,
  selectedAgentReferenceKeys,
  emphasizedAgentReferenceKeys,
  onSelectReference
}: {
  items: StockRecommendationItem[];
  sourcePanelId: string;
  payload: StockRecommendationPayload;
  sessionMode: RecommendationSessionMode;
  selectedSymbol: string | null;
  selectedAgentReferenceKeys: string[];
  emphasizedAgentReferenceKeys: string[];
  onSelectReference: (
    reference: AgentReference | null,
    selection?: StockRecommendationSelection | null,
    replaceExisting?: boolean
  ) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const itemSequenceKey = useMemo(() => items.map((item) => `${item.rank}-${item.symbol}`).join("|"), [items]);
  const showNext = useCallback(() => {
    onSelectReference(null, null);
    setActiveIndex((currentIndex) => items.length > 1 ? (currentIndex + 1) % items.length : currentIndex);
  }, [items.length, onSelectReference]);

  useEffect(() => setActiveIndex(0), [itemSequenceKey]);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }
    const selectedIndex = items.findIndex((item) => item.symbol === selectedSymbol);
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
    }
  }, [items, selectedSymbol]);

  useEffect(() => {
    if (paused || selectedSymbol || items.length < 2) {
      return undefined;
    }
    const intervalId = window.setInterval(showNext, RECOMMENDATION_STACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [items.length, paused, selectedSymbol, showNext]);

  return (
    <div
      className="stock-rec-file-stack"
      aria-label="추천 기업 파일"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setPaused(false);
        }
      }}
    >
      {items.map((item, index) => {
        const position = (index - activeIndex + items.length) % items.length;
        const stackClass = position === 0
          ? "is-active"
          : position === 1
            ? "is-next"
            : position === 2
              ? "is-back-2"
                : position === 3
                  ? "is-back-3"
                  : "is-hidden";
        const reference = stockRecommendationReference(item, sourcePanelId);
        const referenceKey = agentReferenceKey(reference);
        return (
          <RecommendationRow
            key={`${item.rank}-${item.symbol}`}
            item={item}
            className={stackClass}
            active={position === 0}
            selected={selectedAgentReferenceKeys.includes(referenceKey)}
            emphasized={emphasizedAgentReferenceKeys.includes(referenceKey)}
            onClick={() => position === 0
              ? onSelectReference(reference, recommendationSelection(item, payload, sessionMode, reference))
              : setActiveIndex(index)}
          />
        );
      })}
      {items.length > 1 && (
        <>
          <span className="stock-rec-stack-count" aria-live="polite">
            {activeIndex + 1} / {items.length}
          </span>
          <button className="stock-rec-stack-next" type="button" aria-label="다음 추천 기업" onClick={showNext}>
            <ChevronRight size={15} />
          </button>
        </>
      )}
    </div>
  );
}

function recommendationSelection(
  item: StockRecommendationItem,
  payload: StockRecommendationPayload,
  sessionMode: RecommendationSessionMode,
  reference: AgentReference
): StockRecommendationSelection {
  return { item, payload, sessionMode, reference };
}

function sessionButtonClass(active: boolean, live = false) {
  return [
    "stock-rec-session-button",
    active ? "active" : "",
    live ? "is-live" : ""
  ].filter(Boolean).join(" ");
}

function marketClosedMessage(sessionMode: RecommendationSessionMode) {
  return sessionMode === "regular"
    ? "본장 추천은 미국 본장 시간에 생성됩니다"
    : "장전/데이장 추천 생성 시간이 아닙니다";
}

function emptyMessage(payload: StockRecommendationPayload | null, sessionMode: RecommendationSessionMode) {
  const reason = typeof payload?.summary?.emptyReason === "string" ? payload.summary.emptyReason : "";
  if (reason === "opening_data_accumulating") {
    return "09:30 개장 데이터 누적 중 · 첫 V3 추천은 10:00입니다";
  }
  if (reason === "fixture_not_extracted") {
    return "실데이터 fixture가 준비되지 않아 추천을 표시하지 않습니다";
  }
  if (reason === "benchmark_data_not_ready") {
    return "SPY 기준 데이터가 준비되지 않아 V3 추천을 생성하지 않았습니다";
  }
  if (reason === "candidate_data_not_ready") {
    return "근거 신뢰도 기준을 충족한 후보가 15개 미만입니다";
  }
  if (reason === "insufficient_session_data") {
    return sessionMode === "regular"
      ? "본장 데이터가 더 쌓이면 추천을 다시 계산합니다"
      : "장전/데이장 데이터가 더 쌓이면 추천을 다시 계산합니다";
  }
  if (reason === "regular_not_active") {
    return "본장 시작 후 추천을 만들 수 있습니다";
  }
  if (reason === "pre_not_active") {
    return "장전/데이장 시간의 추천을 기다리고 있습니다";
  }
  if (reason === "no_candidates_after_filters") {
    return "현재 필터를 통과한 추천 후보가 없습니다";
  }
  return "추천할 종목이 없습니다";
}

function RecommendationRow({
  item,
  className,
  active,
  selected,
  emphasized,
  onClick
}: {
  item: StockRecommendationItem;
  className: string;
  active: boolean;
  selected: boolean;
  emphasized: boolean;
  onClick: () => void;
}) {
  const sector = item.sector || "Unclassified";
  const sectorLabel = item.sectorLabelKo || sectorLabelKo(sector);
  const companyName = companyNameBySymbol.get(item.symbol);
  const visibleReasons = recommendationVisibleReasons(item);
  const visibleRiskWarnings = recommendationVisibleRiskWarnings(item);
  return (
    <button
      className={`stock-rec-row ${className} ${selected ? "is-selected" : ""} ${emphasized ? "is-agent-reference-emphasized" : ""}`.trim()}
      type="button"
      aria-label={active ? `${item.rank}위 ${item.symbol} 추천 선택` : `${item.rank}위 ${item.symbol} 추천 보기`}
      aria-pressed={selected}
      tabIndex={active || className === "is-next" ? 0 : -1}
      onClick={onClick}
      style={{ "--stock-rec-tab-text-width": `${Math.max(3, item.symbol.length)}ch` } as CSSProperties}
    >
      <span className="stock-rec-file-tab-label">
        <StockLogo symbol={item.symbol} companyName={companyName} size="lg" className="stock-rec-file-tab-logo" />
        <strong>{item.symbol}</strong>
      </span>
      <span className="stock-rec-copy">
        <span className="stock-rec-symbol-line">
          <strong>{companyName ?? item.symbol}</strong>
          <span className={`stock-rec-change ${changeTone(item.changePercent)}`} title="오늘의 등락률">
            {formatChangePercent(item.changePercent)}
          </span>
        </span>
        <span className="stock-rec-reasons">
          {visibleReasons.map((reason) => (
            <em key={`${item.symbol}-${reason.type}-${reason.text}`}>{reason.text}</em>
          ))}
          {visibleRiskWarnings.map((warning) => (
            <em className="risk" key={`${item.symbol}-${warning}`}>{warning}</em>
          ))}
        </span>
        <span className="stock-rec-sector" title={sector}>{sectorLabel}</span>
      </span>
    </button>
  );
}

function RecommendationListRow({
  item,
  reference,
  selected,
  emphasized,
  onSelectReference
}: {
  item: StockRecommendationItem;
  reference: AgentReference;
  selected: boolean;
  emphasized: boolean;
  onSelectReference: (reference: AgentReference) => void;
}) {
  const sector = item.sector || "Unclassified";
  const sectorLabel = item.sectorLabelKo || sectorLabelKo(sector);
  const companyName = companyNameBySymbol.get(item.symbol);
  const visibleReasons = recommendationVisibleReasons(item);
  const visibleRiskWarnings = recommendationVisibleRiskWarnings(item);
  return (
    <button
      className={`stock-rec-row ${selected ? "is-selected" : ""} ${emphasized ? "is-agent-reference-emphasized" : ""}`.trim()}
      type="button"
      aria-label={`${item.rank}위 ${item.symbol} 추천 선택`}
      aria-pressed={selected}
      onClick={() => onSelectReference(reference)}
    >
      <StockLogo symbol={item.symbol} companyName={companyName} size="xs" className="stock-rec-logo" />
      <span className="stock-rec-main">
        <span className="stock-rec-symbol-line">
          <strong>{item.symbol}</strong>
          <span className={`stock-rec-change ${changeTone(item.changePercent)}`} title="오늘의 등락률">
            {formatChangePercent(item.changePercent)}
          </span>
        </span>
      </span>
      <span className="stock-rec-reasons">
        {visibleReasons.map((reason) => (
          <em key={`${item.symbol}-${reason.type}-${reason.text}`}>{reason.text}</em>
        ))}
        {visibleRiskWarnings.map((warning) => (
          <em className="risk" key={`${item.symbol}-${warning}`}>{warning}</em>
        ))}
      </span>
      <span className="stock-rec-sector" title={sector}>{sectorLabel}</span>
    </button>
  );
}

function changeTone(value?: number): "up" | "down" | "flat" {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "flat";
  }
  return value > 0 ? "up" : "down";
}

function formatChangePercent(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function recommendationVisibleReasons(item: StockRecommendationItem) {
  if (item.algorithmVersion === "deterministic-evidence-v3" && item.explanation) {
    return [{ type: "v3_narrative", text: item.explanation.primary.headline }];
  }
  const riskTexts = item.riskWarnings.map(normalizeRecommendationText).filter(Boolean);
  return item.reasons
    .filter((reason) => !duplicatesRiskWarning(reason.text, riskTexts))
    .slice(0, item.riskWarnings.length ? 1 : 2);
}

function recommendationVisibleRiskWarnings(item: StockRecommendationItem) {
  if (item.algorithmVersion === "deterministic-evidence-v3" && item.explanation) {
    return item.explanation.deterministic.risks.slice(0, 1).map((risk) => risk.sentence);
  }
  return item.riskWarnings.slice(0, 1);
}

function duplicatesRiskWarning(text: string, riskTexts: string[]) {
  const normalized = normalizeRecommendationText(text);
  if (!normalized) {
    return false;
  }
  return riskTexts.some((riskText) => (
    normalized === riskText
    || (normalized.length > 10 && riskText.includes(normalized))
    || (riskText.length > 10 && normalized.includes(riskText))
  ));
}

function normalizeRecommendationText(text: string) {
  return text.replace(/\s+/g, "").replace(/[.!?。．]+$/g, "");
}

function isAbortError(value: unknown) {
  return value instanceof DOMException && value.name === "AbortError";
}

function initialRecommendationSessionMode(date = new Date()): RecommendationSessionMode {
  return isPreSessionNow(date) ? "pre" : "regular";
}

function isPreSessionNow(date = new Date()) {
  const clock = newYorkMarketClock(date);
  if (!clock) {
    return false;
  }
  return clock.totalMinutes >= 4 * 60 && clock.totalMinutes < 9 * 60 + 30;
}

function isRegularSessionNow(date = new Date()) {
  const clock = newYorkMarketClock(date);
  if (!clock) {
    return false;
  }
  return clock.totalMinutes >= 9 * 60 + 30 && clock.totalMinutes < 16 * 60;
}

function newYorkMarketClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = values.weekday;
  if (weekday === "Sat" || weekday === "Sun") {
    return null;
  }
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return { totalMinutes: hour * 60 + minute };
}
