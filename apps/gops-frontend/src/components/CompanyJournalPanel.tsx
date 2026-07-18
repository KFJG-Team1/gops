import {
  BookOpenText,
  CalendarRange,
  ChartNoAxesCombined,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentReference } from "../agent/agentReferences";
import { GlossaryText, type GlossarySelectionContext } from "../glossary/GlossaryText";
import type { GlossaryEntry } from "../glossary/stockGlossary";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { latestSimulatorStatus, simulatorStatusEvent, type SimulatorStatus } from "../simulator/simulatorApi";
import {
  CompanySummaryPanel,
  type CompanyJournalEvidence,
  type CompanyPanelView,
  type FinancialPeriodMode,
  type ValuationPricePoint
} from "./CompanyJournalSummaryPanel";
import {
  CompanyJournalPerformanceChart,
  companyJournalSectorBenchmarkSymbol,
  type CompanyJournalPerformanceSeries
} from "./CompanyJournalPerformanceChart";
import {
  fetchCompanyJournal,
  fetchCompanyJournalEvidence,
  type CompanyJournalAnalystAction,
  type CompanyJournalEvidenceResponse,
  type CompanyJournalReport
} from "./companyJournalApi";
import { buildCompanyJournalDiagnosis } from "./companyJournalDiagnosis";
import {
  buildCompanyJournalReading,
  type CompanyJournalReadingSection,
  type CompanyJournalReadingTarget
} from "./companyJournalReading";

type CompanyJournalView = Extract<CompanyPanelView, "profitability" | "stability" | "valuation"> | "earnings";
type CompanyJournalStatus = "loading" | "ready" | "pending" | "error";
type JournalEvidenceTarget =
  | "market-latest"
  | "earnings-latest"
  | "per-share-latest"
  | "valuation-latest"
  | "profitability-latest"
  | "returns-latest"
  | "stability-capital-latest"
  | "stability-ratios-latest";

type CompanyJournalPanelProps = {
  symbol: string;
  item?: Sp500UniverseItem;
  items?: Sp500UniverseItem[];
  sourcePanelId?: string;
  selectedAgentReferenceKeys?: string[];
  emphasizedAgentReferenceKeys?: string[];
  onAgentReferenceSelect?: (reference: AgentReference) => void;
  onAgentAsk?: () => void;
};

type JournalMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "positive" | "negative" | "neutral" | "caution";
};

type JournalNarrative = {
  headline: string;
  observation: string;
  companyMeaning: string;
  nextCheck: string;
  counterpoint: string;
};

type JournalInsight = {
  id: string;
  title: string;
  lead?: string;
  tags?: string[];
  emphasis?: string;
  text: string;
  evidenceTargets: JournalEvidenceTarget[];
  actions?: Array<{ label: string; targetView: CompanyJournalView }>;
};

const journalViews = [
  { id: "earnings", label: "실적", icon: CalendarRange },
  { id: "valuation", label: "가치", icon: BookOpenText },
  { id: "profitability", label: "매출·수익", icon: ChartNoAxesCombined },
  { id: "stability", label: "안정성", icon: ShieldCheck }
] as const satisfies ReadonlyArray<{ id: CompanyJournalView; label: string; icon: typeof ChartNoAxesCombined }>;

const emptyEvidence: CompanyJournalEvidence = {
  financialSeries: [],
  earningsSeries: [],
  selectedFinancialPeriod: null,
  financialPeriodMode: "quarterly"
};

export function companyJournalRequestKey(status: SimulatorStatus | null): string {
  if (status?.mode !== "simulation") return "live";
  const timestamp = Date.parse(status.virtualTime);
  const simulationDate = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(timestamp))
    : status.virtualTime;
  return `simulation:${status.runId ?? status.datasetId}:${simulationDate}`;
}

const companyJournalPreviewValuationPrices: ValuationPricePoint[] = [
  { timestamp: "2021-03-31T00:00:00Z", close: 122.15 },
  { timestamp: "2021-06-30T00:00:00Z", close: 136.96 },
  { timestamp: "2021-09-30T00:00:00Z", close: 141.50 },
  { timestamp: "2021-12-30T00:00:00Z", close: 177.57 },
  { timestamp: "2022-03-31T00:00:00Z", close: 174.61 },
  { timestamp: "2022-06-30T00:00:00Z", close: 136.72 },
  { timestamp: "2022-09-30T00:00:00Z", close: 138.20 },
  { timestamp: "2022-12-30T00:00:00Z", close: 129.93 },
  { timestamp: "2023-03-31T00:00:00Z", close: 164.90 },
  { timestamp: "2023-06-30T00:00:00Z", close: 193.97 },
  { timestamp: "2023-09-29T00:00:00Z", close: 171.21 },
  { timestamp: "2023-12-29T00:00:00Z", close: 192.53 },
  { timestamp: "2024-03-28T00:00:00Z", close: 171.48 },
  { timestamp: "2024-06-28T00:00:00Z", close: 210.62 },
  { timestamp: "2024-09-30T00:00:00Z", close: 233.00 },
  { timestamp: "2024-12-31T00:00:00Z", close: 250.42 },
  { timestamp: "2025-03-31T00:00:00Z", close: 221.90 },
  { timestamp: "2025-06-30T00:00:00Z", close: 205.17 },
  { timestamp: "2025-09-30T00:00:00Z", close: 226.44 },
  { timestamp: "2025-12-31T00:00:00Z", close: 238.71 },
  { timestamp: "2026-03-31T00:00:00Z", close: 188.62 },
  { timestamp: "2026-06-30T00:00:00Z", close: 194.72 }
];

const companyJournalPreviewAnalystActions: readonly CompanyJournalAnalystAction[] = [
  {
    firm: "모건스탠리",
    action: "maintain",
    fromGrade: "Overweight",
    toGrade: "Overweight",
    priorPriceTarget: 200,
    priceTarget: 220,
    actionAt: "2026-07-16T13:00:00Z",
    source: "dev-preview"
  }
];

export function CompanyJournalPanel({
  symbol,
  item,
  items = []
}: CompanyJournalPanelProps) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const previewEnabled = companyJournalPreviewEnabled();
  const [simulatorStatus, setSimulatorStatus] = useState<SimulatorStatus | null>(() => latestSimulatorStatus());
  const simulatorMode = simulatorStatus?.mode ?? "live";
  const journalRequestKey = companyJournalRequestKey(simulatorStatus);
  const resolvedItem = useMemo(
    () => previewEnabled
      ? buildCompanyJournalPreviewItem(item, normalizedSymbol)
      : simulatorMode === "simulation"
        ? simulationSafeCompanyJournalItem(item)
        : item,
    [item, normalizedSymbol, previewEnabled, simulatorMode]
  );
  const [storedEvidence, setStoredEvidence] = useState<CompanyJournalEvidenceResponse | null>(null);
  const effectiveItem = useMemo<Sp500UniverseItem | undefined>(
    () => mergeCompanyJournalEvidence(resolvedItem, storedEvidence, simulatorMode === "simulation"),
    [resolvedItem, simulatorMode, storedEvidence]
  );
  const storedPerformanceSeries = useMemo<CompanyJournalPerformanceSeries[]>(() => {
    const sectorSymbol = companyJournalSectorBenchmarkSymbol(effectiveItem?.sector, effectiveItem?.industry);
    return (storedEvidence?.performanceSeries ?? []).map((series) => ({
      ...series,
      label: series.symbol === "SPY" ? "S&P 500" : series.symbol,
      tone: (series.symbol === normalizedSymbol ? "company" : series.symbol === "SPY" ? "benchmark" : "sector") as CompanyJournalPerformanceSeries["tone"]
    })).filter((series) => series.symbol === normalizedSymbol || series.symbol === "SPY" || series.symbol === sectorSymbol);
  }, [effectiveItem?.industry, effectiveItem?.sector, normalizedSymbol, storedEvidence?.performanceSeries]);
  const storedValuationPrices = useMemo<ValuationPricePoint[]>(() => (
    storedPerformanceSeries.find((series) => series.symbol === normalizedSymbol)?.candles.map((candle) => ({
      timestamp: candle.timestamp,
      close: candle.close
    })) ?? []
  ), [normalizedSymbol, storedPerformanceSeries]);
  const [activeView, setActiveView] = useState<CompanyJournalView>("earnings");
  const [focusedValuationMetric, setFocusedValuationMetric] = useState<string | null>(null);
  const [focusedStabilityMetric, setFocusedStabilityMetric] = useState<string | null>(null);
  const [focusedFinancialMetric, setFocusedFinancialMetric] = useState<string | null>(null);
  const [focusedFinancialYear, setFocusedFinancialYear] = useState<number | null>(null);
  const [comparisonFinancialYear, setComparisonFinancialYear] = useState<number | null>(null);
  const [financialPeriodMode, setFinancialPeriodMode] = useState<FinancialPeriodMode>("annual");
  const [selectedInsightId, setSelectedInsightId] = useState("");
  const [journalReport, setJournalReport] = useState<CompanyJournalReport | null>(null);
  const [journalStatus, setJournalStatus] = useState<CompanyJournalStatus>(
    previewEnabled ? "ready" : "loading"
  );
  const [journalRefresh, setJournalRefresh] = useState(0);
  const [evidenceBySymbol, setEvidenceBySymbol] = useState<Record<string, CompanyJournalEvidence>>({});
  const evidencePanelRef = useRef<HTMLDivElement | null>(null);
  const evidence = evidenceBySymbol[normalizedSymbol] ?? emptyEvidence;
  const diagnosis = useMemo(
    () => buildCompanyJournalDiagnosis(effectiveItem, evidence),
    [effectiveItem, evidence]
  );
  const onEvidenceChange = useCallback((nextEvidence: CompanyJournalEvidence) => {
    setEvidenceBySymbol((current) => ({ ...current, [normalizedSymbol]: nextEvidence }));
  }, [normalizedSymbol]);
  useEffect(() => {
    const handleStatus = (event: Event) => {
      const status = (event as CustomEvent<SimulatorStatus>).detail;
      setSimulatorStatus(status ?? null);
    };
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleStatus);
  }, []);
  useEffect(() => {
    if (previewEnabled) return;
    setJournalReport(null);
    setStoredEvidence(null);
    setEvidenceBySymbol({});
    setJournalStatus("loading");
  }, [journalRequestKey, normalizedSymbol, previewEnabled]);
  useEffect(() => {
    if (previewEnabled) {
      setJournalReport(null);
      setJournalStatus("ready");
      return;
    }
    const controller = new AbortController();
    let pollTimer: number | undefined;
    setJournalStatus((current) => current === "ready" ? current : "loading");
    void fetchCompanyJournal(normalizedSymbol, controller.signal)
      .then((response) => {
        if (response.status === "ready" && response.report) {
          setJournalReport(response.report);
          setJournalStatus("ready");
          return;
        }
        setJournalReport(null);
        setJournalStatus("pending");
        pollTimer = window.setTimeout(() => setJournalRefresh((value) => value + 1), 30_000);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setJournalReport(null);
          setJournalStatus("error");
        }
      });
    return () => {
      controller.abort();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [journalRefresh, journalRequestKey, normalizedSymbol, previewEnabled]);
  useEffect(() => {
    if (previewEnabled) {
      setStoredEvidence(null);
      return undefined;
    }
    const controller = new AbortController();
    setStoredEvidence(null);
    const sectorSymbol = companyJournalSectorBenchmarkSymbol(resolvedItem?.sector, resolvedItem?.industry);
    void fetchCompanyJournalEvidence(normalizedSymbol, ["SPY", sectorSymbol], controller.signal)
      .then(setStoredEvidence)
      .catch(() => {
        if (!controller.signal.aborted) setStoredEvidence(null);
      });
    return () => controller.abort();
  }, [journalRequestKey, normalizedSymbol, previewEnabled, resolvedItem?.industry, resolvedItem?.sector]);
  const deterministicOverview = useMemo(
    () => buildJournalOverview(effectiveItem, evidence),
    [effectiveItem, evidence]
  );
  const overview = useMemo(
    () => previewEnabled
      ? deterministicOverview
      : buildStoredJournalOverview(journalReport, journalStatus, deterministicOverview.headline),
    [deterministicOverview, journalReport, journalStatus, previewEnabled]
  );
  const readingInsights = useMemo(
    () => buildCompanyJournalReading({
      view: activeView,
      item: effectiveItem,
      evidence,
      diagnosis
    }),
    [activeView, diagnosis, effectiveItem, evidence]
  );
  const selectedInsight = readingInsights.find((insight) => insight.id === selectedInsightId);
  const hasExplicitFocus = Boolean(focusedFinancialMetric || focusedValuationMetric || focusedStabilityMetric);
  const activeEvidenceTargets = hasExplicitFocus || !selectedInsight
    ? []
    : readingEvidenceTargets(activeView, selectedInsight.id);
  const clearMetricFocus = useCallback(() => {
    setFocusedValuationMetric(null);
    setFocusedStabilityMetric(null);
    setFocusedFinancialMetric(null);
    setFocusedFinancialYear(null);
    setComparisonFinancialYear(null);
  }, []);
  const changeFinancialPeriodMode = useCallback((mode: FinancialPeriodMode) => {
    clearMetricFocus();
    setFinancialPeriodMode(mode);
  }, [clearMetricFocus]);
  const selectView = useCallback((view: CompanyJournalView) => {
    setActiveView(view);
    clearMetricFocus();
    setSelectedInsightId("");
  }, [clearMetricFocus]);
  const selectInsightTerm = useCallback((entry: GlossaryEntry, context: GlossarySelectionContext) => {
    const target = journalGlossaryTarget(entry.term);
    if (!target) return false;
    const years = financialYearsForContext(context);
    setActiveView(target.view);
    setFocusedValuationMetric(target.valuationMetric ?? null);
    setFocusedStabilityMetric(target.stabilityMetric ?? null);
    setFocusedFinancialMetric(target.financialMetric ?? target.stabilityMetric ?? target.valuationMetric ?? null);
    setFocusedFinancialYear(years[0] ?? null);
    setComparisonFinancialYear(years[1] ?? null);
    if (years.length > 0) setFinancialPeriodMode("annual");
    return true;
  }, []);
  const selectReadingTarget = useCallback((target: CompanyJournalReadingTarget, insightId: string) => {
    const isValuationMultiple = ["per", "pbr", "psr", "fcf-yield"].includes(target.metric);
    setActiveView(target.view);
    setFocusedValuationMetric(target.view === "valuation" && isValuationMultiple ? target.metric : null);
    setFocusedStabilityMetric(target.view === "stability" ? target.metric : null);
    setFocusedFinancialMetric(target.metric);
    setFocusedFinancialYear(target.years[0] ?? null);
    setComparisonFinancialYear(target.years[1] ?? null);
    if (target.years.length > 0) setFinancialPeriodMode("annual");
    setSelectedInsightId(insightId);
  }, []);
  const highlightInsight = useCallback((insight: CompanyJournalReadingSection) => {
    const opening = selectedInsightId !== insight.id;
    setSelectedInsightId(opening ? insight.id : "");
    if (!opening) return;
    const primaryTarget = readingEvidenceTargets(activeView, insight.id)[0];
    if (!primaryTarget) return;
    window.requestAnimationFrame(() => {
      const target = evidencePanelRef.current?.querySelector(`[data-journal-mark="${primaryTarget}"]`);
      if (!target) return;
      const scrollCandidates = [
        target.closest<HTMLElement>(".company-valuation-dashboard"),
        target.closest<HTMLElement>(".company-stability-dashboard"),
        target.closest<HTMLElement>(".company-journal-earnings-evidence"),
        target.closest<HTMLElement>(".company-single-fundamental-section"),
        evidencePanelRef.current
      ].filter((candidate): candidate is HTMLElement => candidate !== null);
      const scrollContainer = scrollCandidates.find(
        (candidate) => candidate.scrollHeight > candidate.clientHeight + 1
      ) ?? scrollCandidates.at(-1);
      if (!scrollContainer) return;
      const targetBounds = target.getBoundingClientRect();
      const containerBounds = scrollContainer.getBoundingClientRect();
      const targetTop = scrollContainer.scrollTop
        + targetBounds.top
        - containerBounds.top
        - Math.max(0, (scrollContainer.clientHeight - targetBounds.height) / 2);
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop),
        left: scrollContainer.scrollLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }, [activeView, selectedInsightId]);
  useEffect(() => {
    if (activeView !== "valuation" || !focusedValuationMetric) return;
    const frame = window.requestAnimationFrame(() => {
      const container = evidencePanelRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-journal-metric-row="${focusedValuationMetric}"]`);
      if (!container || !target) return;
      const targetBounds = target.getBoundingClientRect();
      const containerBounds = container.getBoundingClientRect();
      const top = container.scrollTop + targetBounds.top - containerBounds.top - Math.max(0, (container.clientHeight - targetBounds.height) / 2);
      container.scrollTo({
        top: Math.max(0, top),
        left: container.scrollLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, focusedValuationMetric]);
  useEffect(() => {
    if (!focusedFinancialMetric) return;
    const frame = window.requestAnimationFrame(() => {
      const container = evidencePanelRef.current;
      const yearSelector = focusedFinancialYear == null ? "" : `[data-journal-financial-year="${focusedFinancialYear}"]`;
      const selector = `[data-journal-financial-metric="${focusedFinancialMetric}"]${yearSelector}`;
      const target = container?.querySelector<HTMLElement>(`td${selector}`)
        ?? container?.querySelector<HTMLElement>(selector);
      if (!container || !target) return;
      const targetBounds = target.getBoundingClientRect();
      const containerBounds = container.getBoundingClientRect();
      const top = container.scrollTop + targetBounds.top - containerBounds.top - Math.max(0, (container.clientHeight - targetBounds.height) / 2);
      container.scrollTo({
        top: Math.max(0, top),
        left: container.scrollLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
      const table = target.closest<HTMLElement>(".company-financial-table-wrap");
      if (table) {
        const left = target.offsetLeft - Math.max(0, (table.clientWidth - target.offsetWidth) / 2);
        table.scrollTo({
          left: Math.max(0, left),
          top: table.scrollTop,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, evidence.financialSeries.length, focusedFinancialMetric, focusedFinancialYear]);

  return (
    <section className="company-journal-panel" aria-label={`${normalizedSymbol} AI 기업저널`}>
      <header className="company-journal-header">
        <div className="company-journal-brand" aria-label="GOPS AI">
          <span aria-hidden="true"><Sparkles /></span>
          <strong>gopsai</strong>
          {previewEnabled && <em>DEV PREVIEW</em>}
        </div>
        <blockquote className="company-journal-quote">
          <GlossaryText text={overview.headline} />
        </blockquote>
      </header>

      <div className="company-journal-tabbar">
        <div className="company-journal-tabs" role="tablist" aria-label="기업 저널 근거 화면">
          {journalViews.map((view) => {
            const Icon = view.icon;
            const selected = view.id === activeView;
            const signal = diagnosis.signals.find((candidate) => candidate.view === view.id);
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={`${view.label} · ${signal?.statusLabel ?? "데이터 부족"}`}
                title={signal ? `${signal.statusLabel}: ${signal.result}` : "데이터 부족"}
                className={`${selected ? "active " : ""}is-${signal?.tone ?? "insufficient"}`}
                onClick={() => selectView(view.id)}
              >
                <Icon aria-hidden="true" />
                <span>{view.label}</span>
                <i className="company-journal-tab-signal" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className="company-journal-period-toggle" role="group" aria-label="재무 표시 기간">
          <button type="button" aria-pressed={financialPeriodMode === "annual"} onClick={() => changeFinancialPeriodMode("annual")}>연간</button>
          <button type="button" aria-pressed={financialPeriodMode === "quarterly"} onClick={() => changeFinancialPeriodMode("quarterly")}>분기</button>
        </div>
      </div>

      <div className="company-journal-body">
        <div
          ref={evidencePanelRef}
          className={`company-journal-evidence is-${activeView}`}
          data-evidence-active={activeEvidenceTargets.length > 0 ? "true" : "false"}
          data-evidence-targets={activeEvidenceTargets.join(" ")}
          role="tabpanel"
        >
          {activeView === "earnings" ? (
            <div className="company-journal-earnings-evidence">
              <CompanySummaryPanel
                symbol={normalizedSymbol}
                item={effectiveItem}
                items={simulatorMode === "simulation" ? [] : items}
                view="valuation"
                valuationContent="earnings"
                valuationPriceSeries={previewEnabled ? companyJournalPreviewValuationPrices : storedValuationPrices}
                onEvidenceChange={onEvidenceChange}
                disableRemoteFetch={previewEnabled || simulatorMode === "simulation"}
                journalPresentation
                focusedFinancialMetric={focusedFinancialMetric}
                focusedFinancialYear={focusedFinancialYear}
                comparisonFinancialYear={comparisonFinancialYear}
                financialPeriodMode={financialPeriodMode}
                onFinancialPeriodModeChange={setFinancialPeriodMode}
                onFinancialSelectionChange={clearMetricFocus}
                analystActions={previewEnabled
                  ? companyJournalPreviewAnalystActions
                  : journalReport?.serverMetrics.analystOutlook?.recentActions}
              />
              <CompanyJournalPerformanceChart
                symbol={normalizedSymbol}
                sector={effectiveItem?.sector}
                industry={effectiveItem?.industry}
                previewEnabled={previewEnabled}
                storedSeries={storedPerformanceSeries}
                disableRemoteFetch={simulatorMode === "simulation"}
              />
            </div>
          ) : (
            <CompanySummaryPanel
              symbol={normalizedSymbol}
              item={effectiveItem}
              items={simulatorMode === "simulation" ? [] : items}
              view={activeView}
              valuationContent={activeView === "valuation" ? "valuation" : "combined"}
              stabilityContent={activeView === "stability" ? "stability-dashboard" : "stability"}
              valuationPriceSeries={previewEnabled ? companyJournalPreviewValuationPrices : storedValuationPrices}
              onEvidenceChange={onEvidenceChange}
              disableRemoteFetch={previewEnabled || simulatorMode === "simulation"}
              journalPresentation
              focusedValuationMetric={activeView === "valuation" ? focusedValuationMetric : null}
              focusedStabilityMetric={activeView === "stability" ? focusedStabilityMetric : null}
              focusedFinancialMetric={focusedFinancialMetric}
              focusedFinancialYear={focusedFinancialYear}
              comparisonFinancialYear={comparisonFinancialYear}
              financialPeriodMode={financialPeriodMode}
              onFinancialPeriodModeChange={setFinancialPeriodMode}
              onFinancialSelectionChange={clearMetricFocus}
            />
          )}
        </div>

        <aside className="company-journal-reading" aria-label={`${activeView} 해석`}>
          {readingInsights.map((insight) => (
            <JournalInsightSection
              key={insight.id}
              insight={insight}
              selected={selectedInsightId === insight.id}
              onHighlight={() => highlightInsight(insight)}
              onTarget={(target) => selectReadingTarget(target, insight.id)}
              onTermSelect={selectInsightTerm}
            />
          ))}
        </aside>
      </div>
    </section>
  );
}

export function simulationSafeCompanyJournalItem(item?: Sp500UniverseItem): Sp500UniverseItem | undefined {
  if (!item) return undefined;
  return {
    ...item,
    marketCap: 0,
    layoutPrice: null,
    layoutMarketCap: null,
    layoutMarketCapSource: null,
    layoutPriceSource: null,
    layoutPriceUpdatedAt: null,
    sharesOutstanding: null,
    fundamentalsSource: null,
    fundamentalsAsOf: null,
    fiscalPeriod: null,
    periodEndDate: null,
    filedAt: null,
    revenue: null,
    operatingIncome: null,
    netIncome: null,
    eps: null,
    totalAssets: null,
    totalLiabilities: null,
    totalEquity: null,
    operatingCashFlow: null,
    freeCashFlow: null,
    ebitda: null,
    earningsSeries: [],
    financialSeries: [],
    lastPrice: null,
    priceSource: null,
    priceUpdatedAt: null,
    volume: null,
    sessionDollarVolume: null,
    rsi14: null,
    previousClose: null,
    changePercent: null
  };
}

function mergeCompanyJournalEvidence(
  item: Sp500UniverseItem | undefined,
  evidence: CompanyJournalEvidenceResponse | null,
  simulation: boolean
): Sp500UniverseItem | undefined {
  if (!item || !evidence) return item;
  if (!simulation) {
    return {
      ...item,
      financialSeries: evidence.financialSeries.length > 0 ? evidence.financialSeries : item.financialSeries,
      earningsSeries: evidence.earningsSeries.length > 0 ? evidence.earningsSeries : item.earningsSeries,
      fundamentalsAsOf: evidence.sourceAsOf ?? item.fundamentalsAsOf
    };
  }
  const latestFinancial = evidence.financialSeries.at(-1);
  const companyCandles = evidence.performanceSeries.find((series) => series.symbol === item.symbol)?.candles ?? [];
  const latestCandle = companyCandles.at(-1);
  const previousCandle = companyCandles.at(-2);
  const price = latestCandle?.close ?? null;
  const shares = latestFinancial?.sharesOutstanding ?? null;
  const changePercent = price != null && previousCandle?.close
    ? ((price / previousCandle.close) - 1) * 100
    : null;
  return {
    ...item,
    marketCap: price != null && shares != null ? price * shares : 0,
    layoutPrice: price,
    layoutMarketCap: price != null && shares != null ? price * shares : null,
    sharesOutstanding: shares,
    fundamentalsSource: "simulation-point-in-time",
    fundamentalsAsOf: evidence.sourceAsOf,
    fiscalPeriod: latestFinancial?.period ?? null,
    periodEndDate: latestFinancial?.periodEndDate ?? null,
    filedAt: latestFinancial?.filedAt ?? null,
    revenue: latestFinancial?.revenue ?? null,
    operatingIncome: latestFinancial?.operatingIncome ?? null,
    netIncome: latestFinancial?.netIncome ?? null,
    eps: latestFinancial?.eps ?? null,
    totalAssets: latestFinancial?.totalAssets ?? null,
    totalLiabilities: latestFinancial?.totalLiabilities ?? null,
    totalEquity: latestFinancial?.totalEquity ?? null,
    operatingCashFlow: latestFinancial?.operatingCashFlow ?? null,
    freeCashFlow: latestFinancial?.freeCashFlow ?? null,
    financialSeries: evidence.financialSeries,
    earningsSeries: evidence.earningsSeries,
    lastPrice: price,
    priceSource: "simulation-point-in-time",
    priceUpdatedAt: latestCandle?.timestamp ?? null,
    volume: latestCandle?.volume ?? null,
    previousClose: previousCandle?.close ?? null,
    changePercent
  };
}

function JournalInsightSection({
  insight,
  selected,
  onHighlight,
  onTarget,
  onTermSelect
}: {
  insight: CompanyJournalReadingSection;
  selected: boolean;
  onHighlight: () => void;
  onTarget: (target: CompanyJournalReadingTarget) => void;
  onTermSelect: (entry: GlossaryEntry, context: GlossarySelectionContext) => boolean;
}) {
  const detailId = `company-journal-insight-${insight.id}`;
  return (
    <section
      className={`company-journal-insight is-${insight.tone} ${selected ? "is-selected" : ""}`}
      data-insight-kind={insight.kind}
    >
      <button
        type="button"
        className="company-journal-insight-disclosure"
        aria-expanded={selected}
        aria-controls={detailId}
        onClick={onHighlight}
      >
        <span>
          <h3>{insight.title}</h3>
          <strong className="company-journal-insight-emphasis">{insight.summary}</strong>
        </span>
        <i aria-hidden="true" />
      </button>
      {insight.links.length > 0 && (
        <div className="company-journal-insight-tags" aria-label={`${insight.title} 핵심 지표`}>
          {insight.links.map((target) => (
            <button
              key={`${target.view}-${target.metric}-${target.label}`}
              type="button"
              title="관련 차트와 표에서 보기"
              onClick={() => onTarget(target)}
            >
              {target.label}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div id={detailId} className="company-journal-insight-detail">
          <p><GlossaryText text={compactInsightText(insight.detail)} onTermSelect={onTermSelect} /></p>
          {insight.missingNote && <small>{insight.missingNote}</small>}
          <span className="company-journal-insight-evidence-hint">관련 근거가 차트와 표에 표시됩니다</span>
        </div>
      )}
    </section>
  );
}

function compactInsightText(value: string): string {
  const sentences = value.replace(/([.!?])\s+/g, "$1\n").split("\n").map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.slice(0, 3).join(" ") || value;
}

function journalGlossaryTarget(term: string): {
  view: CompanyJournalView;
  valuationMetric?: string;
  stabilityMetric?: string;
  financialMetric?: string;
} | null {
  if (["PER", "PBR", "PSR", "FCF Yield"].includes(term)) {
    const metric = term.toLowerCase().replaceAll(" ", "-");
    return { view: "valuation", valuationMetric: metric, financialMetric: metric };
  }
  const perShareMetric = new Map([
    ["EPS", "eps"],
    ["BPS", "bps"],
    ["SPS", "sps"],
    ["CPS", "cps"]
  ]).get(term);
  if (perShareMetric) return { view: "valuation", financialMetric: perShareMetric };
  const profitabilityMetric = new Map([
    ["매출", "revenue"],
    ["매출액", "revenue"],
    ["영업이익률", "operating-margin"],
    ["순이익률", "net-margin"],
    ["당기순이익", "net-income"],
    ["ROE", "roe"],
    ["ROA", "roa"],
    ["FCF Margin", "fcf-margin"],
    ["영업현금흐름", "operating-cash-flow"],
    ["잉여현금흐름", "free-cash-flow"]
  ]).get(term);
  if (profitabilityMetric) return { view: "profitability", financialMetric: profitabilityMetric };
  const stabilityMetric = new Map([
    ["총자본", "equity"],
    ["총부채", "liabilities"],
    ["부채비율", "debt-ratio"],
    ["유동부채비율", "current-liability-ratio"],
    ["비유동부채비율", "noncurrent-liability-ratio"],
    ["유동비율", "current-ratio"],
    ["이자발생부채", "total-debt"],
    ["이자보상배율", "interest-coverage"],
    ["금융비용부담률", "financial-cost-burden"],
    ["순부채", "net-debt"]
  ]).get(term);
  if (stabilityMetric) return { view: "stability", stabilityMetric, financialMetric: stabilityMetric };
  return null;
}

export function nearestFinancialYear(context: GlossarySelectionContext): number | null {
  return financialYearsForContext(context)[0] ?? null;
}

export function financialYearsForContext(context: GlossarySelectionContext): number[] {
  const matches = Array.from(context.text.matchAll(/(?:FY\s*)?(20\d{2}|\d{2})\s*(?:년(?:도)?|년도|FY)?/gi))
    .filter((match) => /FY/i.test(match[0]) || /년/.test(match[0]))
    .map((match) => {
      const rawYear = Number(match[1]);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      return {
        year,
        distance: Math.abs((match.index ?? 0) - context.startIndex)
      };
    })
    .filter((match) => match.year >= 2000 && match.year <= 2100)
    .sort((left, right) => left.distance - right.distance);
  return Array.from(new Set(matches.map((match) => match.year))).slice(0, 2);
}

function readingEvidenceTargets(view: CompanyJournalView, insightId: string): JournalEvidenceTarget[] {
  if (view === "earnings") {
    if (insightId === "current-flow" || insightId === "judgment") return ["earnings-latest", "market-latest"];
    if (insightId === "strengths") return ["earnings-latest", "profitability-latest"];
    if (insightId === "risks") return ["valuation-latest", "stability-ratios-latest"];
    return [];
  }
  if (view === "valuation") return insightId === "judgment" ? ["per-share-latest", "valuation-latest"] : ["valuation-latest"];
  if (view === "profitability") return insightId === "judgment" ? ["profitability-latest", "returns-latest"] : ["profitability-latest"];
  return insightId === "judgment" ? ["stability-capital-latest", "stability-ratios-latest"] : ["stability-ratios-latest"];
}

export function buildJournalInsights({
  activeView,
  report,
  status,
  previewEnabled,
  companyName,
  narrative
}: {
  activeView: CompanyJournalView;
  report: CompanyJournalReport | null;
  status: CompanyJournalStatus;
  previewEnabled: boolean;
  companyName: string;
  narrative: JournalNarrative;
}): Array<Omit<JournalInsight, "evidenceTargets">> {
  if (previewEnabled) {
    const tab = previewTabInsight(activeView, narrative);
    if (activeView === "earnings") {
      return [
        {
          id: "movement",
          title: "최근 움직임",
          lead: "3거래일 +4.2% · S&P 500 대비 +1.6%p",
          emphasis: `${companyName}의 상승 폭이 시장보다 컸기 때문에 단기 상대강도는 개선된 모습입니다.`,
          text: "모건스탠리는 투자의견 Overweight를 유지했습니다. 시장 평균 목표주가는 현재 $205입니다. AI·핵심 사업 기대와 주가 상승이 같은 기간에 나타났지만, 특정 뉴스 하나만으로 상승 원인을 단정할 수는 없습니다."
        },
        {
          id: "tab-focus",
          title: "이번 실적에서 먼저 볼 것",
          lead: tab.lead,
          emphasis: tab.emphasis,
          text: tab.text
        },
        {
          id: "watch",
          title: "앞으로 볼 것",
          lead: "다음 가이던스 · 핵심 사업 성장률 · AI 투자 회수",
          emphasis: "매출과 EPS가 함께 예상치를 웃돌면 외형 성장과 비용 효율이 동시에 개선된 것으로 해석할 수 있습니다.",
          text: "반대로 EPS만 좋아지고 매출이 둔화되면 비용 절감이나 일회성 요인의 영향일 수 있습니다. 다음 가이던스까지 같은 방향이 이어질 때 실적 개선의 지속 가능성이 높아집니다."
        },
        {
          id: "summary",
          title: "GOPS AI 종합 판단",
          emphasis: "현재는 성장 기대가 숫자로 이어지는 과정이지만, 한 번의 실적만으로 추세를 확정하기에는 이릅니다.",
          text: narrative.companyMeaning || narrative.observation
        },
        {
          id: "first-check",
          title: "기업 분석에서 먼저 볼 곳",
          emphasis: "실적 개선이 주가에 이미 얼마나 반영됐는지 가치와 매출·수익을 함께 비교해야 합니다.",
          text: "매출과 이익률의 동행 여부는 성장의 질을, 가치 배수와 현금흐름은 현재 기대의 부담을 보여줍니다.",
          actions: journalAnalysisActions(activeView)
        }
      ];
    }
    return [
      {
        id: "tab-focus",
        title: tab.title,
        lead: tab.lead,
        emphasis: tab.emphasis,
        text: tab.text
      },
      {
        id: "watch",
        title: "다음 확인",
        lead: detailWatchLead(activeView),
        emphasis: detailWatchEmphasis(activeView),
        text: detailWatchText(activeView)
      },
      {
        id: "summary",
        title: `${journalViewLabel(activeView)} 종합 판단`,
        ...journalInsightCopy(previewDetailSummary(activeView))
      },
      {
        id: "first-check",
        title: "기업분석에서 다음으로 볼 곳",
        emphasis: crossViewEmphasis(activeView),
        text: crossViewText(activeView),
        actions: journalAnalysisActions(activeView)
      }
    ];
  }

  if (!report) {
    const waiting = status === "error"
      ? "저장된 기업저널을 불러오지 못했습니다. 연결을 확인하는 동안 기존 차트와 뉴스는 계속 볼 수 있습니다."
      : "검증된 기업저널 문장을 준비하고 있습니다. 기존 차트는 먼저 확인할 수 있습니다.";
    const tab = previewTabInsight(activeView, narrative);
    return [
      ...(activeView === "earnings" ? [{ id: "movement", title: "최근 움직임", lead: "저장 분석 준비 중", emphasis: narrative.headline, text: waiting }] : []),
      { id: "tab-focus", title: `${journalViewLabel(activeView)} 핵심`, lead: tab.lead, emphasis: tab.emphasis, text: tab.text },
      { id: "watch", title: "앞으로 볼 것", emphasis: detailWatchEmphasis(activeView), text: detailWatchText(activeView) },
      { id: "summary", title: `${journalViewLabel(activeView)} 종합 판단`, emphasis: narrative.headline, text: narrative.companyMeaning || narrative.observation },
      { id: "first-check", title: "기업분석에서 다음으로 볼 곳", emphasis: crossViewEmphasis(activeView), text: crossViewText(activeView), actions: journalAnalysisActions(activeView) }
    ];
  }

  const metrics = report.serverMetrics;
  const debtRatio = metrics.financial?.liabilitiesToEquity;
  const recentSessions = metrics.recentSessions ?? 3;
  const movementLead = `${recentSessions}거래일 ${formatStoredPercent(metrics.stockReturnPercent)}`
    + ` · ${metrics.benchmarkSymbol || "S&P 500"} 대비 ${formatStoredPoint(metrics.relativeReturnPercentagePoints)}`;
  const stabilityLead = debtRatio == null
    ? "안정성 · 데이터 부족"
    : `${debtRatio <= 1 ? "양호" : debtRatio <= 2 ? "주의" : "점검 필요"} · 부채비율 ${(debtRatio * 100).toFixed(1)}%`;
  const selectedAnalysis = report.tabs[activeView] || report.tabs.current || report.headline;
  const firstAnalysisView: CompanyJournalView = debtRatio != null && debtRatio > 1 ? "stability" : "profitability";
  const firstAnalysisLead = firstAnalysisView === "stability"
    ? stabilityLead
    : report.keywords.slice(0, 3).join(" · ") || "매출 성장과 이익률 비교";
  const movementCopy = consumerJournalInsight(report.recentMovement, {
    emphasis: narrative.headline,
    text: narrative.companyMeaning
  });
  const tabFallback = previewTabInsight(activeView, narrative);
  const selectedCopy = consumerJournalInsight(selectedAnalysis, {
    emphasis: tabFallback.emphasis,
    text: tabFallback.text
  });
  const watchCopy = consumerJournalInsight(report.watchItems, {
    emphasis: detailWatchEmphasis(activeView),
    text: detailWatchText(activeView)
  });
  const headlineCopy = consumerJournalInsight(activeView === "earnings" ? report.headline : selectedAnalysis, {
    emphasis: narrative.headline,
    text: narrative.companyMeaning
  });
  const firstCheckCopy = consumerJournalInsight(
    activeView === "earnings"
      ? report.tabs[firstAnalysisView] || report.financialStability || report.headline
      : selectedAnalysis,
    {
      emphasis: crossViewEmphasis(activeView),
      text: crossViewText(activeView)
    }
  );
  return [
    ...(activeView === "earnings" ? [{ id: "movement", title: "최근 움직임", lead: movementLead, ...movementCopy }] : []),
    {
      id: "tab-focus",
      title: `${journalViewLabel(activeView)}에서 먼저 볼 것`,
      lead: activeView === "stability" ? stabilityLead : report.keywords.slice(0, 3).join(" · ") || undefined,
      ...selectedCopy
    },
    {
      id: "watch",
      title: "앞으로 볼 것",
      lead: report.keywords.length > 0 ? report.keywords.join(" · ") : undefined,
      ...watchCopy
    },
    {
      id: "summary",
      title: activeView === "earnings" ? "GOPS AI 종합 판단" : `${journalViewLabel(activeView)} 종합 판단`,
      ...headlineCopy
    },
    {
      id: "first-check",
      title: activeView === "earnings" ? "기업 분석에서 먼저 볼 곳" : "기업분석에서 다음으로 볼 곳",
      lead: activeView === "earnings" ? firstAnalysisLead : undefined,
      ...firstCheckCopy,
      actions: journalAnalysisActions(activeView)
    }
  ];
}

export function journalEvidenceTargets(view: CompanyJournalView, insightId: string): JournalEvidenceTarget[] {
  if (view === "earnings") {
    if (insightId === "movement") return ["market-latest"];
    if (insightId === "tab-focus" || insightId === "watch") return ["earnings-latest"];
    if (insightId === "summary") return ["earnings-latest", "market-latest"];
    return [];
  }
  if (view === "valuation") {
    if (insightId === "watch") return ["valuation-latest", "per-share-latest"];
    if (insightId === "tab-focus" || insightId === "summary") return ["per-share-latest", "valuation-latest"];
    return [];
  }
  if (view === "profitability") {
    if (insightId === "watch") return ["returns-latest"];
    if (insightId === "tab-focus") return ["profitability-latest"];
    if (insightId === "summary") return ["profitability-latest", "returns-latest"];
    return [];
  }
  if (insightId === "watch") return ["stability-ratios-latest"];
  if (insightId === "tab-focus") return ["stability-capital-latest"];
  if (insightId === "summary") return ["stability-capital-latest", "stability-ratios-latest"];
  return [];
}

function journalAnalysisActions(view: CompanyJournalView): Array<{ label: string; targetView: CompanyJournalView }> {
  const actions: Array<{ label: string; targetView: CompanyJournalView }> = [
    { label: "실적 근거 보기", targetView: "earnings" },
    { label: "가치 부담 확인", targetView: "valuation" },
    { label: "성장의 질 확인", targetView: "profitability" },
    { label: "현금 방어력 확인", targetView: "stability" }
  ];
  return actions.filter((action) => action.targetView !== view);
}

function detailWatchLead(view: CompanyJournalView) {
  if (view === "valuation") return "실적 성장률 · PER 변화 · FCF Yield";
  if (view === "stability") return "유동비율 · 순부채 · 이자보상배율";
  return "ROE · ROA · FCF Margin";
}

function detailWatchEmphasis(view: CompanyJournalView) {
  if (view === "valuation") return "실적 증가보다 가치 배수가 더 빠르게 높아지면 성장 기대가 가격에 먼저 반영된 구간입니다.";
  if (view === "stability") return "부채가 늘어도 현금과 이익의 증가 속도가 더 빠르면 재무 부담은 통제 가능한 범위에 머물 수 있습니다.";
  return "매출과 이익률, ROE·ROA가 함께 오르면 외형 성장과 자본 효율이 동시에 좋아지는 흐름입니다.";
}

function detailWatchText(view: CompanyJournalView) {
  if (view === "valuation") return "EPS·BPS·SPS·CPS가 늘어나는 속도보다 PER·PBR·PSR이 더 빠르게 높아졌습니다. 실적 개선보다 가격 기대가 앞선 형태이므로 다음 실적이 기대에 못 미치면 가치 배수가 먼저 낮아질 가능성이 있습니다.";
  if (view === "stability") return "부채비율과 유동부채 비중은 낮아지고 유동비율·이자보상배율은 높아졌습니다. 단기 지급 능력과 이자 부담이 동시에 개선된 형태라 현재 투자 확대를 감당할 재무 완충력은 유지되는 모습입니다.";
  return "순이익과 ROE·ROA가 함께 높아졌고 FCF Margin도 유지됐습니다. 이익 증가가 더 많은 자본 투입에만 의존하지 않고 실제 현금 창출로 이어지는 형태여서 현재 성장의 질은 양호한 편입니다.";
}

function previewDetailSummary(view: Exclude<CompanyJournalView, "earnings">) {
  if (view === "valuation") {
    return "주당 실적은 개선됐지만 PER·PBR·PSR도 높은 구간입니다. 가격 상승이 실적 증가보다 앞선 형태여서 다음 EPS와 현금흐름이 둔화되면 현재 가치 배수의 부담이 커질 가능성이 있습니다.";
  }
  if (view === "stability") {
    return "현재 부채 구조는 비교적 안정적이고 유동비율과 이자보상배율도 함께 개선됐습니다. 영업현금흐름이 투자 지출 증가보다 빠르게 유지되는 동안에는 재무 안정성이 크게 훼손될 가능성이 낮습니다.";
  }
  return "매출과 이익률, ROE·ROA가 함께 개선됐고 FCF Margin도 유지돼 성장의 질은 양호합니다. 외형 성장보다 이익과 현금 증가가 더 빠른 영업 레버리지 구간이 이어질 가능성이 있습니다.";
}

function crossViewEmphasis(view: CompanyJournalView) {
  if (view === "valuation") return "높은 가치 배수가 유지되려면 매출과 이익률의 개선이 같은 속도로 이어져야 합니다.";
  if (view === "stability") return "재무 안전성이 양호해도 현금이 이익만큼 늘지 않으면 투자 확대의 부담이 뒤늦게 나타날 수 있습니다.";
  return "성장이 좋아도 현재 가격이 이를 과도하게 반영했다면 기대수익은 낮아질 수 있습니다.";
}

function crossViewText(view: CompanyJournalView) {
  if (view === "valuation") return "매출·수익 화면에서 외형 성장과 마진이 가치 상승을 뒷받침하는지 이어서 비교할 수 있습니다.";
  if (view === "stability") return "매출·수익 화면의 FCF Margin을 함께 보면 회계상 이익이 실제 현금으로 전환되는지 구분할 수 있습니다.";
  return "가치 화면의 PER·PBR·PSR과 비교하면 좋은 실적이 현재 가격에 어느 정도 반영됐는지 판단할 수 있습니다.";
}

function journalInsightCopy(value: string): Pick<JournalInsight, "emphasis" | "text"> {
  const text = value.trim();
  if (!text) return { text: "" };
  const sentence = text.match(/^(.+?다\.|.+?[.!?])\s*(.*)$/s);
  if (!sentence) return { emphasis: text, text: "" };
  return {
    emphasis: sentence[1].trim(),
    text: sentence[2].trim()
  };
}

function consumerJournalInsight(
  value: string,
  fallback: Pick<JournalInsight, "emphasis" | "text">
): Pick<JournalInsight, "emphasis" | "text"> {
  return isOperationalJournalCopy(value) ? fallback : journalInsightCopy(value);
}

function isOperationalJournalCopy(value: string): boolean {
  return /\bnull\b|[a-z]+_[a-z_]+|복구|입력되는지|제공되는지|확인해\s*주세요|데이터\s*(?:연결|복구|입력)|계산되지\s*않|확인할\s*구간|먼저\s*확인할|판단할\s*수\s*없|OpenAI|Bedrock|ClickHouse|Redis|저장소|모델명/iu.test(value);
}

function journalViewLabel(view: CompanyJournalView) {
  return journalViews.find((candidate) => candidate.id === view)?.label ?? "기업 분석";
}

function previewTabInsight(activeView: CompanyJournalView, narrative: JournalNarrative) {
  if (activeView === "earnings") return {
    title: "실적에서 먼저 볼 것",
    lead: "EPS 예상 대비 · 매출 예상 대비 · 다음 가이던스",
    emphasis: "최근 실제치가 추정치 위에 형성돼 시장 기대보다 강한 실적이 나온 구간입니다.",
    text: `${narrative.observation} EPS와 매출이 함께 상회하면 수요와 비용 효율이 동시에 좋아진 결과일 가능성이 큽니다. 한 지표만 상회하면 일회성 요인 여부를 구분해야 합니다.`
  };
  if (activeView === "stability") return {
    title: "안정성에서 먼저 볼 것",
    lead: "부채비율 42% · 유동비율 · 이자보상배율",
    emphasis: "부채 의존도는 낮아졌고, 단기 지급 여력과 이자비용을 감당할 완충력은 커진 상태입니다.",
    text: narrative.observation.replace(
      /입니다\.$/,
      "이며, 이 조합은 실적이 일시적으로 둔화되거나 금리가 오를 때도 단기 채무와 이자비용을 버틸 여지가 커졌다는 뜻입니다."
    )
  };
  if (activeView === "valuation") return {
    title: "가치에서 먼저 볼 것",
    lead: "PER · PBR · PSR · 주당 현금흐름",
    emphasis: "주당 실적은 늘었지만 가치 배수도 높은 구간이어서 성장 기대가 이미 가격에 반영된 모습입니다.",
    text: `${narrative.observation} EPS·SPS·CPS 증가 속도가 PER·PBR·PSR 상승을 따라가지 못하면 다음 실적이 양호해도 주가 반응은 제한될 수 있습니다.`
  };
  return {
    title: "매출·수익에서 먼저 볼 것",
    lead: "매출 성장 · 영업이익률 · 순이익률",
    emphasis: "매출 증가와 영업·순이익률 상승이 함께 나타나 성장의 질이 개선되는 모습입니다.",
    text: `${narrative.observation} 매출보다 이익이 더 빠르게 늘어 영업 레버리지가 발생한 구간입니다. 이 방향이 이어지면 같은 매출 증가에서도 더 큰 이익 증가를 기대할 수 있습니다.`
  };
}

function buildStoredJournalOverview(
  report: CompanyJournalReport | null,
  status: CompanyJournalStatus,
  fallbackHeadline: string
): { headline: string; metrics: JournalMetric[] } {
  if (!report) {
    return {
      headline: fallbackHeadline,
      metrics: [
        metric("최근 움직임", "자료 부족", "확인 가능한 가격 기준", "neutral"),
        metric("시장 대비", "자료 부족", "같은 기간 비교", "neutral"),
        metric("재무 안정성", "자료 부족", "확인 가능한 재무 기준", "neutral"),
        metric(
          "분석 상태",
          status === "error" ? "자료 부족" : "계산 중",
          "확인된 근거만 표시",
          status === "error" ? "caution" : "neutral"
        )
      ]
    };
  }
  const metrics = report.serverMetrics;
  const debtRatio = metrics.financial?.liabilitiesToEquity;
  const sessions = metrics.recentSessions ?? 3;
  return {
    headline: isOperationalJournalCopy(report.headline) ? fallbackHeadline : report.headline,
    metrics: [
      metric(
        "최근 움직임",
        formatStoredPercent(metrics.stockReturnPercent),
        `${sessions}거래일`,
        toneForChange(metrics.stockReturnPercent ?? null)
      ),
      metric(
        "S&P 500 대비",
        formatStoredPoint(metrics.relativeReturnPercentagePoints),
        "같은 기간 비교",
        toneForChange(metrics.relativeReturnPercentagePoints ?? null)
      ),
      metric(
        "부채비율",
        debtRatio == null ? "데이터 부족" : `${(debtRatio * 100).toFixed(1)}%`,
        "총부채 ÷ 자기자본",
        toneForDebtRatio(debtRatio ?? null)
      ),
      metric("분석 상태", "검증 완료", formatAsOf(report.generatedAt), "positive")
    ]
  };
}

export function buildStoredJournalNarrative(
  view: CompanyJournalView,
  report: CompanyJournalReport | null,
  status: CompanyJournalStatus
): JournalNarrative {
  if (!report) {
    const unavailable = status === "error"
      ? "기업저널 저장소 연결을 확인해야 합니다."
      : "검증된 기업저널 문장을 준비하고 있습니다.";
    return {
      headline: unavailable,
      observation: "차트와 뉴스는 기존 데이터 원천에서 표시되며, AI 문장은 검증된 결과가 저장된 뒤 나타납니다.",
      companyMeaning: "준비되지 않은 숫자나 원인을 임의로 채우지 않습니다.",
      nextCheck: "잠시 뒤 다시 확인하면 최신 검증 결과가 자동으로 표시됩니다.",
      counterpoint: "현재 상태는 기업에 대한 부정적 평가가 아니라 분석 결과가 아직 준비되지 않았다는 뜻입니다."
    };
  }
  const label = journalViews.find((candidate) => candidate.id === view)?.label ?? "현재 핵심";
  const observation = report.tabs[view] || report.tabs.current || report.headline;
  const companyMeaning = view === "stability" ? report.financialStability : report.headline;
  const missingNote = report.missingData.length > 0
    ? `현재 ${report.missingData.length}개 근거 항목이 부족해 해석 범위가 제한될 수 있습니다.`
    : "확인된 근거의 기준일 이후 사건은 아직 반영되지 않았을 수 있습니다.";
  return {
    headline: report.keywords.length > 0 ? `${label} · ${report.keywords.join(" · ")}` : label,
    observation,
    companyMeaning,
    nextCheck: report.watchItems,
    counterpoint: missingNote
  };
}

function formatStoredPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "데이터 부족";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatStoredPoint(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "계산되지 않음";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function buildJournalOverview(item: Sp500UniverseItem | undefined, evidence: CompanyJournalEvidence) {
  const financial = selectedFinancialPair(evidence);
  const earnings = evidence.earningsSeries.at(-1);
  const revenueGrowth = changePercent(financial.previous?.revenue, financial.latest?.revenue);
  const latestMargin = ratio(financial.latest?.netIncome, financial.latest?.revenue);
  const previousMargin = ratio(financial.previous?.netIncome, financial.previous?.revenue);
  const marginDelta = percentagePointDelta(previousMargin, latestMargin);
  const debtRatio = ratio(financial.latest?.totalLiabilities, financial.latest?.totalEquity);
  const epsSurprise = surprisePercent(earnings?.estimatedEps, earnings?.actualEps);
  const companyName = item?.companyName || item?.symbol || "이 기업";
  const headline = overviewHeadline(companyName, revenueGrowth, marginDelta, epsSurprise);
  return {
    headline,
    metrics: [
      metric("매출 추이", formatChange(revenueGrowth), latestPeriod(financial.latest), toneForChange(revenueGrowth)),
      metric("순이익률", formatRatio(latestMargin), formatDeltaDetail(marginDelta), toneForChange(marginDelta)),
      metric("부채비율", formatRatio(debtRatio), "총부채 ÷ 총자본", toneForDebtRatio(debtRatio)),
      metric("EPS 예상 대비", formatChange(epsSurprise), earnings?.period || "최근 실적", toneForChange(epsSurprise))
    ]
  };
}

export function buildJournalNarrative(
  view: CompanyJournalView,
  symbol: string,
  item: Sp500UniverseItem | undefined,
  evidence: CompanyJournalEvidence
): JournalNarrative {
  const financial = selectedFinancialPair(evidence);
  const earnings = evidence.earningsSeries.at(-1);
  const lens = companyLens(item);
  if (view === "profitability") {
    const revenueGrowth = changePercent(financial.previous?.revenue, financial.latest?.revenue);
    const incomeGrowth = changePercent(financial.previous?.netIncome, financial.latest?.netIncome);
    const latestMargin = ratio(financial.latest?.netIncome, financial.latest?.revenue);
    const previousMargin = ratio(financial.previous?.netIncome, financial.previous?.revenue);
    const marginDelta = percentagePointDelta(previousMargin, latestMargin);
    return {
      headline: profitabilityHeadline(revenueGrowth, marginDelta),
      observation: `${financial.label} 기준 매출은 비교 구간 대비 ${formatChange(revenueGrowth)}, 순이익은 ${formatChange(incomeGrowth)}입니다. 순이익률은 ${formatRatio(latestMargin)}로 ${formatDeltaSentence(marginDelta)}.`,
      companyMeaning: lens.profitabilityMeaning,
      nextCheck: lens.profitabilityNextCheck,
      counterpoint: "두 개 분기의 변화만으로 구조적인 성장이나 비용 개선을 확정할 수 없습니다. 일회성 비용·세금·회계 효과가 포함됐는지 원문 공시 확인이 필요합니다."
    };
  }

  if (view === "stability") {
    const latestDebtRatio = ratio(financial.latest?.totalLiabilities, financial.latest?.totalEquity);
    const previousDebtRatio = ratio(financial.previous?.totalLiabilities, financial.previous?.totalEquity);
    const debtDelta = percentagePointDelta(previousDebtRatio, latestDebtRatio);
    const equityGrowth = changePercent(financial.previous?.totalEquity, financial.latest?.totalEquity);
    const currentRatio = financial.latest?.currentRatio ?? ratio(financial.latest?.currentAssets, financial.latest?.currentLiabilities);
    const interestExpense = Number.isFinite(financial.latest?.interestExpense ?? NaN) ? Math.abs(financial.latest?.interestExpense as number) : null;
    const interestCoverage = financial.latest?.interestCoverage ?? ratio(financial.latest?.operatingIncome, interestExpense);
    const netDebt = financial.latest?.netDebt ?? (Number.isFinite(financial.latest?.totalDebt ?? NaN) && Number.isFinite(financial.latest?.cashAndCashEquivalents ?? NaN)
      ? (financial.latest?.totalDebt as number) - (financial.latest?.cashAndCashEquivalents as number)
      : null);
    return {
      headline: stabilityHeadline(latestDebtRatio, debtDelta),
      observation: `${financial.label} 기준 총자본은 비교 구간 대비 ${formatChange(equityGrowth)}이고 부채비율은 ${formatRatio(latestDebtRatio)}로 ${formatDeltaSentence(debtDelta)}. 유동비율은 ${formatRatio(currentRatio)}, 이자보상배율은 ${formatJournalMultiple(interestCoverage)}, 순부채는 ${formatJournalMoney(netDebt)}입니다.`,
      companyMeaning: lens.stabilityMeaning,
      nextCheck: lens.stabilityNextCheck,
      counterpoint: "SEC 계정으로 계산한 비율은 만기 구조와 약정 조건을 모두 보여주지 않습니다. 산업별 회계 특성과 제한성 현금 포함 여부를 원문 공시에서 함께 확인해야 합니다."
    };
  }

  if (view === "valuation") {
    const marketCap = item?.marketCap;
    const per = ratio(item?.lastPrice ?? item?.layoutPrice, item?.eps);
    const pbr = ratio(marketCap, item?.totalEquity);
    const psr = ratio(marketCap, item?.revenue);
    const fcfYield = ratio(item?.freeCashFlow, marketCap);
    const shares = financial.latest?.sharesOutstanding;
    const selectedEps = Number.isFinite(financial.latest?.eps ?? NaN)
      ? financial.latest?.eps ?? null
      : ratio(financial.latest?.netIncome, shares);
    const selectedBps = ratio(financial.latest?.totalEquity, shares);
    const selectedSps = ratio(financial.latest?.revenue, shares);
    const selectedCps = ratio(financial.latest?.operatingCashFlow, shares);
    const valuation = companyValuationLens(item);
    return {
      headline: "현재 가격이 요구하는 성장 기대를 점검합니다.",
      observation: `${financial.label} 기준 EPS는 ${formatJournalPerShare(selectedEps)}, BPS는 ${formatJournalPerShare(selectedBps)}, SPS는 ${formatJournalPerShare(selectedSps)}, CPS는 ${formatJournalPerShare(selectedCps)}입니다. 현재 PER은 ${formatJournalMultiple(per)}, PBR은 ${formatJournalMultiple(pbr)}, PSR은 ${formatJournalMultiple(psr)}이며 FCF Yield는 ${formatRatio(fcfYield)}입니다.`,
      companyMeaning: valuation.meaning,
      nextCheck: valuation.nextCheck,
      counterpoint: "현재 가치지표는 최신 가격과 최신 재무를 결합한 값입니다. 서로 다른 기준시각이나 일회성 실적이 포함되면 적정가치 해석이 달라질 수 있습니다."
    };
  }

  const epsSurprise = surprisePercent(earnings?.estimatedEps, earnings?.actualEps);
  const revenueSurprise = surprisePercent(earnings?.estimatedRevenue, earnings?.actualRevenue);
  return {
    headline: earningsHeadline(epsSurprise, revenueSurprise),
    observation: `최근 실적에서 EPS는 예상 대비 ${formatChange(epsSurprise)}, 매출은 예상 대비 ${formatChange(revenueSurprise)}입니다. 차트의 실제치와 추정치를 함께 비교해야 합니다.`,
    companyMeaning: lens.earningsMeaning,
    nextCheck: lens.earningsNextCheck,
    counterpoint: `${symbol}의 실적 상회·하회만으로 다음 분기 방향을 확정할 수 없습니다. 일회성 항목과 가이던스 변화가 결과를 다르게 해석하게 만들 수 있습니다.`
  };
}

function companyValuationLens(item: Sp500UniverseItem | undefined) {
  const category = `${item?.sector || ""} ${item?.industry || ""}`.toLowerCase();
  if (/bank|financial|insurance|capital market/.test(category)) {
    return {
      meaning: "금융기업은 일반 PER보다 PBR과 자본수익성의 조합이 중요합니다. 낮은 PBR도 자본수익성이 약하면 할인 근거가 될 수 있습니다.",
      nextCheck: "PBR 변화와 ROE, 자본비율이 같은 방향으로 움직이는지 확인합니다."
    };
  }
  if (/semiconductor|software|technology|interactive media/.test(category)) {
    return {
      meaning: "기술기업의 높은 배수는 미래 성장률과 마진 유지 기대를 반영합니다. 주당 매출과 현금흐름이 기대를 따라가지 못하면 배수 부담이 커집니다.",
      nextCheck: "SPS·CPS 성장률이 현재 PER·PSR에 내재된 성장 기대를 계속 뒷받침하는지 확인합니다."
    };
  }
  if (/retail|restaurant|consumer|automobile|apparel/.test(category)) {
    return {
      meaning: "소비기업의 배수는 수요 지속성과 마진 안정성에 민감합니다. 매출 증가가 가격 인상에만 의존하면 높은 가치평가가 유지되기 어렵습니다.",
      nextCheck: "SPS 성장과 현금흐름, 재고 변화가 현재 PER·PSR 수준을 정당화하는지 확인합니다."
    };
  }
  return {
    meaning: "주당 실적의 성장 속도와 현재 시장 배수를 함께 봐야 가격에 반영된 기대 수준을 판단할 수 있습니다.",
    nextCheck: "EPS·SPS·CPS 성장률이 현재 PER·PBR·PSR 수준과 일치하는지 다음 공시에서 확인합니다."
  };
}

function companyLens(item: Sp500UniverseItem | undefined) {
  const category = `${item?.sector || ""} ${item?.industry || ""}`.toLowerCase();
  if (/bank|financial|insurance|capital market/.test(category)) {
    return {
      profitabilityMeaning: "금융기업은 일반 매출 증가보다 금리 환경, 순이자마진과 대손비용이 이익의 질을 좌우합니다.",
      profitabilityNextCheck: "순이자마진과 대손충당금이 순이익 변화와 같은 방향인지 확인합니다.",
      stabilityMeaning: "금융기업의 안정성은 일반 부채비율보다 자본비율, 유동성과 신용비용을 더 중요하게 봐야 합니다.",
      stabilityNextCheck: "CET1 자본비율, 연체율과 충당금 추이를 다음 공시에서 확인합니다.",
      earningsMeaning: "실적 상회보다 대출 성장과 신용비용이 다음 분기 이익에 어떤 영향을 주는지가 중요합니다.",
      earningsNextCheck: "가이던스의 순이자이익과 대손비용 전망을 확인합니다.",
      newsLens: "금리, 규제와 신용 사건이 손익과 자본비율에 연결되는지가 핵심입니다."
    };
  }
  if (/semiconductor|software|technology|interactive media/.test(category)) {
    return {
      profitabilityMeaning: "기술기업은 매출 성장뿐 아니라 제품 믹스, 가격 결정력과 연구개발비가 마진으로 이어지는지를 함께 봐야 합니다.",
      profitabilityNextCheck: "핵심 사업 매출 성장률과 영업·순이익률이 같은 방향을 유지하는지 확인합니다.",
      stabilityMeaning: "재무 부채가 낮더라도 대규모 설비투자, 고객 집중과 기술 전환 비용이 실질적인 안정성 변수일 수 있습니다.",
      stabilityNextCheck: "잉여현금흐름이 투자 확대 이후에도 유지되는지 확인합니다.",
      earningsMeaning: "기술기업은 현재 실적보다 다음 분기 성장률과 마진 가이던스가 시장 기대를 결정하는 경우가 많습니다.",
      earningsNextCheck: "핵심 사업 성장률, 마진 가이던스와 주요 고객 투자 계획을 함께 확인합니다.",
      newsLens: "제품 전환, 주요 고객 투자와 규제 사건이 매출·마진에 연결되는지가 핵심입니다."
    };
  }
  if (/retail|restaurant|consumer|automobile|apparel/.test(category)) {
    return {
      profitabilityMeaning: "소비기업은 매출 증가가 판매량에서 왔는지 가격 인상에서 왔는지에 따라 성장의 지속성이 달라집니다.",
      profitabilityNextCheck: "동일점포·판매량, 가격 변화와 재고가 마진 변화와 일치하는지 확인합니다.",
      stabilityMeaning: "재고와 현금전환주기가 악화되면 표면적인 자본 증가와 달리 운영 부담이 커질 수 있습니다.",
      stabilityNextCheck: "재고 증가율과 영업현금흐름을 다음 실적에서 확인합니다.",
      earningsMeaning: "예상치 상회가 할인 축소나 일회성 비용 감소에서 왔는지 실제 수요 회복에서 왔는지가 중요합니다.",
      earningsNextCheck: "판매량, 평균판매가격과 다음 분기 수요 가이던스를 함께 확인합니다.",
      newsLens: "가격, 수요, 재고와 공급망 사건이 소비와 마진에 연결되는지가 핵심입니다."
    };
  }
  return {
    profitabilityMeaning: "매출 증가가 실제 이익과 현금으로 전환되는지를 확인해야 성장의 질을 판단할 수 있습니다.",
    profitabilityNextCheck: "매출 성장률과 순이익률이 다음 구간에도 같은 방향을 유지하는지 확인합니다.",
    stabilityMeaning: "자본과 부채의 방향을 현금흐름과 함께 봐야 재무 완충력을 판단할 수 있습니다.",
    stabilityNextCheck: "부채비율과 영업현금흐름이 동시에 악화되는지 확인합니다.",
    earningsMeaning: "예상치와 실제치의 차이보다 그 차이가 반복 가능한 영업 요인에서 발생했는지가 중요합니다.",
    earningsNextCheck: "일회성 항목을 제외한 실적과 다음 분기 가이던스를 확인합니다.",
    newsLens: "최근 사건이 핵심 사업의 매출·비용·현금흐름 중 어디에 연결되는지가 핵심입니다."
  };
}

function selectedFinancialPair(evidence: CompanyJournalEvidence) {
  const selectedIndex = evidence.selectedFinancialPeriod
    ? evidence.financialSeries.findIndex((point) => (point.periodEndDate || point.period) === evidence.selectedFinancialPeriod)
    : -1;
  const index = selectedIndex >= 0 ? selectedIndex : evidence.financialSeries.length - 1;
  const latest = evidence.financialSeries[index];
  const comparisonOffset = evidence.financialPeriodMode === "quarterly" ? 4 : 1;
  const previous = evidence.financialSeries[index - comparisonOffset] ?? evidence.financialSeries[index - 1];
  return {
    latest,
    previous,
    label: latest ? formatJournalPeriod(latest.period, latest.periodEndDate, evidence.financialPeriodMode) : "최근 구간"
  };
}

function formatJournalPeriod(period: string, periodEndDate: string | null | undefined, mode: CompanyJournalEvidence["financialPeriodMode"]) {
  const year = period.match(/(?:19|20)\d{2}/)?.[0] ?? (periodEndDate ? String(new Date(periodEndDate).getUTCFullYear()) : "");
  if (mode === "annual") return year ? `${year}년` : period;
  const quarter = period.match(/Q([1-4])/i)?.[1] ?? (periodEndDate ? String(Math.floor(new Date(periodEndDate).getUTCMonth() / 3) + 1) : "");
  return year && quarter ? `${year}년 ${quarter}분기` : period;
}

function ratio(numerator: number | null | undefined, denominator: number | null | undefined) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? (numerator as number) / (denominator as number)
    : null;
}

function changePercent(previous: number | null | undefined, current: number | null | undefined) {
  return Number.isFinite(previous) && Number.isFinite(current) && previous !== 0
    ? (((current as number) - (previous as number)) / Math.abs(previous as number)) * 100
    : null;
}

function surprisePercent(estimate: number | null | undefined, actual: number | null | undefined) {
  return changePercent(estimate, actual);
}

function percentagePointDelta(previousRatio: number | null, currentRatio: number | null) {
  return previousRatio == null || currentRatio == null ? null : (currentRatio - previousRatio) * 100;
}

function metric(label: string, value: string, detail: string, tone: JournalMetric["tone"]): JournalMetric {
  return { label, value, detail, tone };
}

function toneForChange(value: number | null): JournalMetric["tone"] {
  if (value == null || Math.abs(value) < 0.05) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function toneForDebtRatio(value: number | null): JournalMetric["tone"] {
  if (value == null) return "neutral";
  if (value > 2) return "negative";
  if (value > 1) return "caution";
  return "positive";
}

function overviewHeadline(companyName: string, revenueGrowth: number | null, marginDelta: number | null, epsSurprise: number | null) {
  const subject = koreanSubject(companyName);
  if (revenueGrowth != null && revenueGrowth > 0 && marginDelta != null && marginDelta > 0) {
    return `${subject} 매출 성장과 이익률 개선이 함께 나타나 현재 성장의 질이 양호합니다.`;
  }
  if (revenueGrowth != null && revenueGrowth > 0 && marginDelta != null && marginDelta < 0) {
    return `${subject} 매출은 늘었지만 이익률이 낮아져 현재 성장의 질은 약해진 상태입니다.`;
  }
  if (epsSurprise != null && Math.abs(epsSurprise) >= 5) {
    return epsSurprise > 0
      ? `${subject} 최근 EPS가 시장 예상치를 웃돌아 실적 모멘텀이 개선된 상태입니다.`
      : `${subject} 최근 EPS가 시장 예상치를 밑돌아 실적 기대가 낮아진 상태입니다.`;
  }
  return `${subject} 최근 재무 지표의 방향이 엇갈려 성장성과 안정성을 선별적으로 판단해야 하는 상태입니다.`;
}

function koreanSubject(value: string): string {
  const lastCharacter = Array.from(value.trim()).at(-1);
  if (!lastCharacter) return value;
  const code = lastCharacter.charCodeAt(0);
  const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${value}${hasBatchim ? "은" : "는"}`;
}

function profitabilityHeadline(revenueGrowth: number | null, marginDelta: number | null) {
  if (revenueGrowth == null || marginDelta == null) return "매출과 이익의 방향을 함께 확인합니다.";
  if (revenueGrowth > 0 && marginDelta > 0) return "성장과 이익의 질이 함께 개선됐습니다.";
  if (revenueGrowth > 0 && marginDelta < 0) return "매출은 늘었지만 수익성은 희석됐습니다.";
  if (revenueGrowth < 0 && marginDelta > 0) return "외형 둔화를 비용 통제로 방어하고 있습니다.";
  return "매출과 이익률이 함께 약해지는지 점검해야 합니다.";
}

function stabilityHeadline(debtRatio: number | null, debtDelta: number | null) {
  if (debtRatio == null) return "자본과 부채의 변화 방향을 확인합니다.";
  if (debtDelta != null && debtDelta > 5) return "부채 부담이 자본보다 빠르게 커졌습니다.";
  if (debtRatio > 2) return "재무 완충력보다 부채 구조 확인이 우선입니다.";
  return "현재 자본 구조의 완충력이 유지되는지 확인합니다.";
}

function earningsHeadline(epsSurprise: number | null, revenueSurprise: number | null) {
  if (epsSurprise == null && revenueSurprise == null) return "실제 실적과 시장 기대의 차이를 확인합니다.";
  if ((epsSurprise ?? 0) > 0 && (revenueSurprise ?? 0) > 0) return "매출과 EPS가 모두 기대를 웃돌았습니다.";
  if ((epsSurprise ?? 0) > 0 && (revenueSurprise ?? 0) <= 0) return "EPS 상회가 매출 성장에서 왔는지 확인이 필요합니다.";
  return "예상치 하회의 원인이 일시적인지 확인해야 합니다.";
}

function formatChange(value: number | null) {
  if (value == null) return "데이터 확인 중";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatRatio(value: number | null) {
  return value == null ? "데이터 확인 중" : `${(value * 100).toFixed(1)}%`;
}

function formatJournalMultiple(value: number | null) {
  return value == null ? "데이터 확인 중" : `${value.toFixed(2)}배`;
}

function formatJournalMoney(value: number | null) {
  return value == null ? "데이터 확인 중" : new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatJournalPerShare(value: number | null) {
  return value == null ? "데이터 확인 중" : `US$${value.toFixed(2)}`;
}

function formatDeltaDetail(value: number | null) {
  if (value == null) return "이전 구간 비교 대기";
  const sign = value > 0 ? "+" : "";
  return `이전 대비 ${sign}${value.toFixed(1)}%p`;
}

function formatDeltaSentence(value: number | null) {
  if (value == null) return "이전 구간과 비교할 데이터가 부족합니다";
  if (Math.abs(value) < 0.05) return "이전 구간과 유사합니다";
  return `이전 구간보다 ${Math.abs(value).toFixed(1)}%p ${value > 0 ? "높아졌습니다" : "낮아졌습니다"}`;
}

function latestPeriod(point: CompanyJournalEvidence["financialSeries"][number] | undefined) {
  return point?.periodEndDate || point?.period || "최근 구간";
}

function formatAsOf(value: string | null) {
  if (!value) return "기준시각 확인 중";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function companyJournalPreviewEnabled() {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("companyJournalPreview") === "1";
}

function buildCompanyJournalPreviewItem(item: Sp500UniverseItem | undefined, symbol: string): Sp500UniverseItem {
  const periodMeta = Array.from({ length: 22 }, (_, index) => {
    const year = 2021 + Math.floor(index / 4);
    const quarter = index % 4 + 1;
    const endDates = ["03-31", "06-30", "09-30", "12-31"];
    return { period: `${year} Q${quarter}`, periodEndDate: `${year}-${endDates[quarter - 1]}` };
  });
  const seasonal = [0.94, 1, 1.04, 1.12];
  const revenues = periodMeta.map((_, index) => 18.5 * Math.pow(1.065, index) * seasonal[index % 4]);
  const margins = periodMeta.map((_, index) => Math.min(0.59, 0.36 + index * 0.0105));
  const equities = periodMeta.map((_, index) => 34 + index * 2.2 + Math.pow(index, 1.18) * 0.38);
  const liabilities = periodMeta.map((_, index) => 24 + index * 0.72);
  const previewSharesOutstanding = symbol === "AAPL" ? 15_300_000_000 : 24_400_000_000;
  const financialSeries = periodMeta.map(({ period, periodEndDate }, index) => {
    const revenue = revenues[index] * 1_000_000_000;
    const operatingIncome = revenues[index] * margins[index] * 0.88 * 1_000_000_000;
    const totalAssets = (equities[index] + liabilities[index]) * 1_000_000_000;
    const totalLiabilities = liabilities[index] * 1_000_000_000;
    const totalEquity = equities[index] * 1_000_000_000;
    const currentAssets = totalAssets * (0.43 + index * 0.0015);
    const currentLiabilities = totalLiabilities * Math.max(0.42, 0.58 - index * 0.005);
    const cashAndCashEquivalents = totalAssets * (0.11 + index * 0.002);
    const interestExpense = revenue * Math.max(0.007, 0.018 - index * 0.00045);
    const totalDebt = totalLiabilities * Math.max(0.48, 0.68 - index * 0.006);
    return {
      period,
      periodEndDate,
      revenue,
      operatingIncome,
      netIncome: revenues[index] * margins[index] * 1_000_000_000,
      eps: 0.66 + index * 0.13,
      totalAssets,
      totalLiabilities,
      totalEquity,
      currentAssets,
      currentLiabilities,
      cashAndCashEquivalents,
      interestExpense,
      operatingCashFlow: revenues[index] * 0.55 * 1_000_000_000,
      freeCashFlow: revenues[index] * 0.46 * 1_000_000_000,
      sharesOutstanding: previewSharesOutstanding,
      debtRatio: totalLiabilities / totalEquity,
      currentLiabilityRatio: currentLiabilities / totalEquity,
      noncurrentLiabilityRatio: (totalLiabilities - currentLiabilities) / totalEquity,
      currentRatio: currentAssets / currentLiabilities,
      totalDebt,
      interestCoverage: operatingIncome / interestExpense,
      financialCostBurdenRatio: interestExpense / revenue,
      netDebt: totalDebt - cashAndCashEquivalents,
      source: "DEV PREVIEW"
    };
  });
  const earningsSeries = financialSeries.map((point, index) => {
    const epsFactors = [1.04, 0.98, 1.06, 1.03, 1.07, 1.05, 0.99, 1.08];
    const revenueFactors = [1.03, 0.99, 1.04, 1.02, 1.05, 1.04, 1.01, 1.06];
    const epsFactor = epsFactors[index % epsFactors.length] ?? 1;
    const revenueFactor = revenueFactors[index % revenueFactors.length] ?? 1;
    const estimatedEps = (point.eps ?? 0) / epsFactor;
    const estimatedRevenue = (point.revenue ?? 0) / revenueFactor;
    return {
      period: point.period,
      periodEndDate: point.periodEndDate,
      actualEps: point.eps,
      estimatedEps,
      actualRevenue: point.revenue,
      estimatedRevenue,
      source: "DEV PREVIEW",
      estimateSource: "DEV PREVIEW"
    };
  });
  const latestFinancial = financialSeries.at(-1)!;
  return {
    ...item,
    symbol,
    companyName: symbol === "NVDA" ? "NVIDIA" : item?.companyName || symbol,
    sector: item?.sector || "Information Technology",
    sectorLabelKo: item?.sectorLabelKo,
    industry: item?.industry || "Semiconductors",
    marketCap: 4_751_168_000_000,
    marketCapSource: "DEV PREVIEW",
    lastPrice: 194.72,
    priceSource: "DEV PREVIEW",
    priceUpdatedAt: "2026-07-16T02:30:00Z",
    sharesOutstanding: previewSharesOutstanding,
    changePercent: 2.05,
    currency: "USD",
    exchange: "NASDAQ",
    market: "US",
    country: "US",
    fundamentalsSource: "DEV PREVIEW",
    fundamentalsAsOf: "2026-06-30T00:00:00Z",
    fiscalPeriod: "2026 Q2",
    periodEndDate: latestFinancial.periodEndDate,
    filedAt: "2026-07-12T00:00:00Z",
    revenue: 224_400_000_000,
    operatingIncome: 116_800_000_000,
    netIncome: 128_700_000_000,
    eps: 3.85,
    totalAssets: latestFinancial.totalAssets,
    totalLiabilities: latestFinancial.totalLiabilities,
    totalEquity: latestFinancial.totalEquity,
    operatingCashFlow: 123_400_000_000,
    freeCashFlow: 103_200_000_000,
    financialSeries,
    earningsSeries
  };
}
