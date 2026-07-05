import { useEffect, useMemo, useState } from "react";
import { buildOntologyGraphFromEvidence } from "./buildOntologyGraphFromEvidence";
import { requestOntologyReport } from "./ontologyReportClient";
import { fetchMarketHeatmap } from "../market/heatmapApi";
import type { Sp500UniverseItem } from "./../market/sp500Universe.seed";
import type { AgentEvidenceItem } from "./ontologyTypes";
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

  if (loadState === "loading") {
    return <div className="ontology-panel ontology-panel-empty">관계 분석을 불러오고 있습니다</div>;
  }

  if (!graph) {
    return <div className="ontology-panel ontology-panel-empty">관계 분석 결과가 아직 없습니다</div>;
  }

  return (
    <div className="ontology-panel">
      <OntologyForceGraph graph={graph} getQuote={getQuote} onSelectSymbol={onSelectSymbol} />
      <ol className="ontology-evidence-list" aria-label="Ontology evidence">
        {ontologyEvidence.slice(0, 4).map((item, index) => (
          <li key={`${item.title ?? "evidence"}-${index}`}>
            <strong>{item.title ?? "Ontology evidence"}</strong>
            {item.summary && <span>{item.summary}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
