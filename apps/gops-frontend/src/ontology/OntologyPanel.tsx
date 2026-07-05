import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { buildOntologyGraphFromEvidence } from "./buildOntologyGraphFromEvidence";
import { requestOntologyReport } from "./ontologyReportClient";
import { fetchMarketHeatmap } from "../market/heatmapApi";
import type { Sp500UniverseItem } from "./../market/sp500Universe.seed";
import type { AgentEvidenceItem } from "./ontologyTypes";
import { subscribeOntologyReports } from "./ontologyEvents";
import { OntologyForceGraph, type OntologyQuote } from "./OntologyForceGraph";

type OntologyPanelProps = {
  symbol: string;
  onSelectSymbol?: (symbol: string) => void;
};

type LoadState = "loading" | "ready";

const QUOTE_REFRESH_MS = 60_000;

export function OntologyPanel({ symbol, onSelectSymbol }: OntologyPanelProps) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [evidence, setEvidence] = useState<AgentEvidenceItem[]>([]);
  const [quotes, setQuotes] = useState<Map<string, Sp500UniverseItem>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    requestOntologyReport({ symbol: normalizedSymbol }, controller.signal)
      .then((report) => {
        if (!controller.signal.aborted) {
          setEvidence(report?.providerEvidence ?? []);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEvidence([]);
          setLoadState("ready");
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol, refreshKey]);

  // 채팅 에이전트 분석이 완료되면 (온톨로지 evidence 포함 시) 패널 즉시 갱신
  useEffect(() => {
    return subscribeOntologyReports((detail) => {
      const reportSymbol = detail.symbol?.trim().toUpperCase();
      if (reportSymbol && reportSymbol !== normalizedSymbol) {
        return;
      }
      setEvidence(detail.providerEvidence);
      setLoadState("ready");
    });
  }, [normalizedSymbol]);

  useEffect(() => {
    const controller = new AbortController();

    const loadQuotes = () => {
      fetchMarketHeatmap(controller.signal)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setQuotes(new Map(payload.items.map((item) => [item.symbol.toUpperCase(), item])));
          }
        })
        .catch(() => {
          // 시세 없이도 그래프는 동작 (중립색 노드로 표시)
        });
    };

    loadQuotes();
    const timer = window.setInterval(loadQuotes, QUOTE_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  const graph = useMemo(
    () => buildOntologyGraphFromEvidence(evidence, normalizedSymbol),
    [evidence, normalizedSymbol]
  );
  const ontologyEvidence = useMemo(
    () => evidence.filter((item) => item.provider === "ontology" && item.status === "available"),
    [evidence]
  );
  const getQuote = useMemo(() => {
    return (ticker: string): OntologyQuote | undefined => {
      const item = quotes.get(ticker.toUpperCase());
      if (!item) {
        return undefined;
      }
      return {
        changePercent: item.changePercent ?? undefined,
        lastPrice: item.lastPrice ?? undefined,
        marketCap: item.marketCap ?? undefined,
        companyName: item.companyName ?? undefined
      };
    };
  }, [quotes]);

  const isLoading = loadState === "loading";

  if (isLoading && evidence.length === 0) {
    return <div className="ontology-panel ontology-panel-empty">관계 분석을 불러오고 있습니다</div>;
  }

  if (!graph) {
    return (
      <div className="ontology-panel ontology-panel-empty">
        <span>관계 분석 결과가 아직 없습니다</span>
        <button type="button" className="ontology-refresh ontology-refresh-inline" onClick={refresh} disabled={isLoading} title="다시 불러오기">
          <RefreshCw size={13} className={isLoading ? "is-spinning" : undefined} />
          다시 불러오기
        </button>
      </div>
    );
  }

  return (
    <div className="ontology-panel">
      <button
        type="button"
        className="ontology-refresh"
        onClick={refresh}
        disabled={isLoading}
        title="관계 데이터 새로고침"
        aria-label="관계 데이터 새로고침"
      >
        <RefreshCw size={13} className={isLoading ? "is-spinning" : undefined} />
      </button>
      <OntologyForceGraph graph={graph} getQuote={getQuote} onSelectSymbol={onSelectSymbol} />
      {ontologyEvidence.length > 0 && (
        <button
          type="button"
          className="ontology-evidence-toggle"
          onClick={() => setShowEvidence((current) => !current)}
          aria-expanded={showEvidence}
        >
          근거 {ontologyEvidence.length}건 {showEvidence ? "닫기" : "보기"}
        </button>
      )}
      {showEvidence && (
        <div className="ontology-evidence-overlay">
          <ol className="ontology-evidence-list" aria-label="Ontology evidence">
            {ontologyEvidence.map((item, index) => (
              <li key={`${item.title ?? "evidence"}-${index}`}>
                <strong>{item.title ?? "Ontology evidence"}</strong>
                {item.summary && <span>{item.summary}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
