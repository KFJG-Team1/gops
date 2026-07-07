import { AlertTriangle, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchStockRecommendations,
  refreshStockRecommendations,
  type StockRecommendationItem,
  type StockRecommendationPayload
} from "./recommendationApi";

export function StockRecommendationsPanel({
  activeSymbol,
  onSelectSymbol
}: {
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}) {
  const [payload, setPayload] = useState<StockRecommendationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    try {
      setPayload(await fetchStockRecommendations(signal));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      setPayload(await refreshStockRecommendations(activeSymbol));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천을 갱신하지 못했습니다.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [activeSymbol]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
          <span>로그인/프로필에서 장중 추천 설정을 저장해야 합니다</span>
        </div>
      )}

      {!loading && !error && payload?.status === "market_closed" && (
        <div className="stock-rec-state">
          <AlertTriangle size={15} />
          <span>정규장 장중 추천만 지원합니다</span>
        </div>
      )}

      {!loading && !error && payload?.status !== "profile_required" && payload?.status !== "market_closed" && items.length === 0 && (
        <div className="stock-rec-state">추천할 종목이 없습니다</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="stock-rec-list">
          {items.map((item) => (
            <RecommendationRow key={`${item.rank}-${item.symbol}`} item={item} onSelectSymbol={onSelectSymbol} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecommendationRow({
  item,
  onSelectSymbol
}: {
  item: StockRecommendationItem;
  onSelectSymbol: (symbol: string) => void;
}) {
  return (
    <button className="stock-rec-row" type="button" onClick={() => onSelectSymbol(item.symbol)}>
      <span className="stock-rec-rank">{item.rank}</span>
      <span className="stock-rec-main">
        <strong>{item.symbol}</strong>
        <em>{item.sector || "Unclassified"}</em>
      </span>
      <span className="stock-rec-score">
        <strong>{Math.round(item.score)}</strong>
        <em>{Math.round(item.confidence * 100)}%</em>
      </span>
      <span className="stock-rec-reasons">
        {item.reasons.slice(0, 2).map((reason) => (
          <em key={`${item.symbol}-${reason.type}-${reason.text}`}>{reason.text}</em>
        ))}
        {item.riskWarnings.slice(0, 1).map((warning) => (
          <em className="risk" key={`${item.symbol}-${warning}`}>{warning}</em>
        ))}
      </span>
    </button>
  );
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
