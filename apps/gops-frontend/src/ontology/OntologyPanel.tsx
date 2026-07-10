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
type IssueSignal = { count: number; score: number };

const QUOTE_REFRESH_MS = 60_000;

function readRawString(item: AgentEvidenceItem, key: string): string {
  const value = item.raw?.[key];
  return typeof value === "string" ? value : "";
}

function readRawNumber(item: AgentEvidenceItem, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = item.raw?.[key];
    const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric)) {
      return numeric > 1 ? Math.min(1, numeric / 100) : Math.max(0, numeric);
    }
  }
  return undefined;
}

function buildIssueSignals(evidence: readonly AgentEvidenceItem[], primarySymbol: string): Map<string, IssueSignal> {
  const issueKeys = new Map<string, Map<string, number>>();
  evidence.forEach((item) => {
    if (item.status !== "available" || item.provider === "ontology") return;
    const ticker = (
      readRawString(item, "ticker") ||
      readRawString(item, "symbol") ||
      readRawString(item, "companyTicker") ||
      primarySymbol
    ).toUpperCase();
    const fingerprint = `${item.title || ""}|${item.summary || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (!fingerprint) return;

    const observedAt = item.observedAt ? Date.parse(item.observedAt) : Number.NaN;
    const ageHours = Number.isFinite(observedAt) ? Math.max(0, (Date.now() - observedAt) / 3_600_000) : 12;
    const recency = ageHours <= 6 ? 1 : ageHours <= 24 ? 0.82 : ageHours <= 72 ? 0.5 : 0.28;
    const explicitScore = readRawNumber(item, ["issueScore", "impactScore", "importance", "severity", "relevanceScore"]);
    const score = Math.max(0.18, Math.min(1, (explicitScore ?? 0.48) * recency));
    if (!issueKeys.has(ticker)) issueKeys.set(ticker, new Map());
    const issues = issueKeys.get(ticker) as Map<string, number>;
    issues.set(fingerprint, Math.max(issues.get(fingerprint) ?? 0, score));
  });

  const result = new Map<string, IssueSignal>();
  issueKeys.forEach((issues, ticker) => {
    const values = Array.from(issues.values()).sort((a, b) => b - a);
    const score = 1 - values.slice(0, 5).reduce((remaining, value) => remaining * (1 - value * 0.55), 1);
    result.set(ticker, { count: issues.size, score: Math.min(1, score) });
  });
  return result;
}

function isSubsidiaryRelationshipNote(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return Boolean(normalized) && (
    normalized.includes("following subsidiar") ||
    normalized.includes("partially own") ||
    normalized.includes("collectively own") ||
    normalized.includes(" owns ") ||
    normalized === "legal entity name"
  );
}

function isSuppressedControlEvidence(item: AgentEvidenceItem): boolean {
  const relationType = readRawString(item, "relationType");
  const controlledName = readRawString(item, "controlledName");
  return (relationType === "control" || relationType === "theme-control") && isSubsidiaryRelationshipNote(controlledName);
}

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
    () => evidence.filter((item) => item.provider === "ontology" && item.status === "available" && !isSuppressedControlEvidence(item)),
    [evidence]
  );
  const issueSignals = useMemo(() => buildIssueSignals(evidence, normalizedSymbol), [evidence, normalizedSymbol]);
  const getQuote = useMemo(() => {
    return (ticker: string): OntologyQuote | undefined => {
      const item = quotes.get(ticker.toUpperCase());
      const issueSignal = issueSignals.get(ticker.toUpperCase());
      if (!item && !issueSignal) {
        return undefined;
      }
      return {
        changePercent: item?.changePercent ?? undefined,
        lastPrice: item?.lastPrice ?? undefined,
        marketCap: item?.marketCap ?? undefined,
        volume: item?.volume ?? undefined,
        sessionDollarVolume: item?.sessionDollarVolume ?? undefined,
        issueCount: issueSignal?.count ?? 0,
        issueScore: issueSignal?.score ?? 0,
        companyName: item?.companyName ?? undefined,
        sector: item?.sector || undefined,
        industry: item?.industry || undefined
      };
    };
  }, [issueSignals, quotes]);

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
        className="ontology-refresh panel-reload-overlay"
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
