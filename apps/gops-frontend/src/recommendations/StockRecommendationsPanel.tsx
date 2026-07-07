import { AlertTriangle, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogoDevAttribution, StockLogo } from "../components/StockLogo";
import { sectorLabelKo } from "../market/sectors";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import {
  fetchStockRecommendations,
  refreshStockRecommendations,
  type RecommendationSessionMode,
  type StockRecommendationItem,
  type StockRecommendationPayload
} from "./recommendationApi";

const companyNameBySymbol = new Map(sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item.companyName]));

export function StockRecommendationsPanel({
  activeSymbol,
  onSelectSymbol
}: {
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}) {
  const [payload, setPayload] = useState<StockRecommendationPayload | null>(null);
  const [sessionMode, setSessionMode] = useState<RecommendationSessionMode>(() => isRegularSessionNow() ? "regular" : "pre");
  const [regularLive, setRegularLive] = useState(() => isRegularSessionNow());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
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
  }, [sessionMode]);

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
    const updateLiveState = () => setRegularLive(isRegularSessionNow());
    updateLiveState();
    const timer = window.setInterval(updateLiveState, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(() => payload?.items ?? [], [payload?.items]);

  return (
    <section className="stock-recommendations-panel" aria-label="장중 매수 추천">
      <div className="stock-rec-toolbar">
        <div>
          <strong>장중 매수 추천</strong>
          <span>{formatTimestamp(payload?.generatedAt ?? payload?.slotStart)}</span>
        </div>
        <button type="button" title="추천 갱신" onClick={refresh} disabled={loading || refreshing}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
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
          장전/데이장
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
          <span>설정의 추천 설정 탭에서 장중 추천 설정을 저장해야 합니다</span>
        </div>
      )}

      {!loading && !error && payload?.status === "market_closed" && (
        <div className="stock-rec-state">
          <AlertTriangle size={15} />
          <span>{marketClosedMessage(sessionMode)}</span>
        </div>
      )}

      {!loading && !error && payload?.status !== "profile_required" && payload?.status !== "market_closed" && items.length === 0 && (
        <div className="stock-rec-state">{emptyMessage(payload, sessionMode)}</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="stock-rec-list">
          {items.map((item) => (
            <RecommendationRow key={`${item.rank}-${item.symbol}`} item={item} onSelectSymbol={onSelectSymbol} />
          ))}
        </div>
      )}
      <LogoDevAttribution className="panel-logo-attribution" />
    </section>
  );
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
  onSelectSymbol
}: {
  item: StockRecommendationItem;
  onSelectSymbol: (symbol: string) => void;
}) {
  const sector = item.sector || "Unclassified";
  const sectorLabel = item.sectorLabelKo || sectorLabelKo(sector);
  const companyName = companyNameBySymbol.get(item.symbol);
  const visibleReasons = recommendationVisibleReasons(item);
  const visibleRiskWarnings = item.riskWarnings.slice(0, 1);
  return (
    <button
      className="stock-rec-row"
      type="button"
      aria-label={`${item.rank}위 ${item.symbol} 추천 차트 열기`}
      onClick={() => onSelectSymbol(item.symbol)}
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
  const riskTexts = item.riskWarnings.map(normalizeRecommendationText).filter(Boolean);
  return item.reasons
    .filter((reason) => !duplicatesRiskWarning(reason.text, riskTexts))
    .slice(0, item.riskWarnings.length ? 1 : 2);
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

function formatTimestamp(value: string | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function isRegularSessionNow(date = new Date()) {
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
    return false;
  }
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false;
  }
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
}
