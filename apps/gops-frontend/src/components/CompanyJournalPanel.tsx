import {
  BookOpenText,
  CalendarRange,
  ChartNoAxesCombined,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentReference } from "../agent/agentReferences";
import { GlossaryText } from "../glossary/GlossaryText";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import {
  CompanySummaryPanel,
  type CompanyJournalEvidence,
  type CompanyPanelView,
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
  type CompanyJournalEvidenceResponse,
  type CompanyJournalReport
} from "./companyJournalApi";

type CompanyJournalView = Extract<CompanyPanelView, "profitability" | "stability" | "valuation"> | "earnings";
type JournalChartFocus =
  | "market-latest"
  | "earnings-latest"
  | "profitability-latest"
  | "returns-latest"
  | "valuation-latest"
  | "stability-latest"
  | "all";

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
  text: string;
  chartFocus: JournalChartFocus;
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

export function CompanyJournalPanel({
  symbol,
  item,
  items = []
}: CompanyJournalPanelProps) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const previewEnabled = companyJournalPreviewEnabled();
  const resolvedItem = useMemo(
    () => previewEnabled ? buildCompanyJournalPreviewItem(item, normalizedSymbol) : item,
    [item, normalizedSymbol, previewEnabled]
  );
  const [storedEvidence, setStoredEvidence] = useState<CompanyJournalEvidenceResponse | null>(null);
  const effectiveItem = useMemo<Sp500UniverseItem | undefined>(() => storedEvidence && resolvedItem ? {
    ...resolvedItem,
    financialSeries: storedEvidence.financialSeries.length > 0
      ? storedEvidence.financialSeries
      : resolvedItem.financialSeries,
    earningsSeries: storedEvidence.earningsSeries.length > 0
      ? storedEvidence.earningsSeries
      : resolvedItem.earningsSeries,
    fundamentalsAsOf: storedEvidence.sourceAsOf ?? resolvedItem?.fundamentalsAsOf
  } : resolvedItem, [resolvedItem, storedEvidence]);
  const hasStoredCompanyEvidence = Boolean(
    storedEvidence?.financialSeries.length && storedEvidence?.earningsSeries.length
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
  const [selectedInsightId, setSelectedInsightId] = useState("tab-focus");
  const [journalReport, setJournalReport] = useState<CompanyJournalReport | null>(null);
  const [journalStatus, setJournalStatus] = useState<"loading" | "ready" | "pending" | "error">(
    previewEnabled ? "ready" : "loading"
  );
  const [journalRefresh, setJournalRefresh] = useState(0);
  const [evidenceBySymbol, setEvidenceBySymbol] = useState<Record<string, CompanyJournalEvidence>>({});
  const evidence = evidenceBySymbol[normalizedSymbol] ?? emptyEvidence;
  const onEvidenceChange = useCallback((nextEvidence: CompanyJournalEvidence) => {
    setEvidenceBySymbol((current) => ({ ...current, [normalizedSymbol]: nextEvidence }));
  }, [normalizedSymbol]);
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
  }, [journalRefresh, normalizedSymbol, previewEnabled]);
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
  }, [normalizedSymbol, previewEnabled, resolvedItem?.industry, resolvedItem?.sector]);
  const overview = useMemo(
    () => previewEnabled ? buildJournalOverview(resolvedItem, evidence) : buildStoredJournalOverview(journalReport, journalStatus),
    [evidence, journalReport, journalStatus, previewEnabled, resolvedItem]
  );
  const narrative = useMemo(
    () => previewEnabled
      ? buildJournalNarrative(activeView, normalizedSymbol, effectiveItem, evidence)
      : buildStoredJournalNarrative(activeView, journalReport, journalStatus),
    [activeView, effectiveItem, evidence, journalReport, journalStatus, normalizedSymbol, previewEnabled]
  );
  const insights = useMemo(
    () => buildJournalInsights({
      activeView,
      report: journalReport,
      status: journalStatus,
      previewEnabled,
      companyName: effectiveItem?.companyName || normalizedSymbol,
      narrative
    }),
    [activeView, effectiveItem?.companyName, journalReport, journalStatus, narrative, normalizedSymbol, previewEnabled]
  );
  const activeChartFocus = insights.find((insight) => insight.id === selectedInsightId)?.chartFocus ?? focusForView(activeView);
  const selectView = useCallback((view: CompanyJournalView) => {
    setActiveView(view);
    setSelectedInsightId("tab-focus");
  }, []);
  const highlightInsight = useCallback((insight: JournalInsight) => {
    setSelectedInsightId(insight.id);
  }, []);

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

      <div className="company-journal-tabs" role="tablist" aria-label="기업 저널 근거 화면">
        {journalViews.map((view) => {
          const Icon = view.icon;
          const selected = view.id === activeView;
          return (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "active" : ""}
              onClick={() => selectView(view.id)}
            >
              <Icon aria-hidden="true" />
              <span>{view.label}</span>
            </button>
          );
        })}
      </div>

      <div className="company-journal-body">
        <div className={`company-journal-evidence is-${activeView}`} data-chart-focus={activeChartFocus} role="tabpanel">
          {activeView === "earnings" ? (
            <div className="company-journal-earnings-evidence">
              <CompanySummaryPanel
                symbol={normalizedSymbol}
                item={effectiveItem}
                items={items}
                view="valuation"
                valuationContent="earnings"
                valuationPriceFixture={previewEnabled ? companyJournalPreviewValuationPrices : storedValuationPrices}
                onEvidenceChange={onEvidenceChange}
                disableRemoteFetch={previewEnabled || hasStoredCompanyEvidence}
                journalPresentation
              />
              <CompanyJournalPerformanceChart
                symbol={normalizedSymbol}
                sector={effectiveItem?.sector}
                industry={effectiveItem?.industry}
                previewEnabled={previewEnabled}
                storedSeries={storedPerformanceSeries}
              />
            </div>
          ) : (
            <CompanySummaryPanel
              symbol={normalizedSymbol}
              item={effectiveItem}
              items={items}
              view={activeView}
              valuationContent={activeView === "valuation" ? "valuation" : "combined"}
              stabilityContent={activeView === "stability" ? "stability-dashboard" : "stability"}
              valuationPriceFixture={previewEnabled ? companyJournalPreviewValuationPrices : storedValuationPrices}
              onEvidenceChange={onEvidenceChange}
              disableRemoteFetch={previewEnabled || hasStoredCompanyEvidence}
              journalPresentation
            />
          )}
        </div>

        <aside className="company-journal-reading" aria-label={`${activeView} 해석`}>
          {insights.map((insight) => (
            <JournalInsightSection
              key={insight.id}
              insight={insight}
              selected={selectedInsightId === insight.id}
              onHighlight={() => highlightInsight(insight)}
              onAction={selectView}
            />
          ))}
        </aside>
      </div>
    </section>
  );
}

function JournalInsightSection({
  insight,
  selected,
  onHighlight,
  onAction
}: {
  insight: JournalInsight;
  selected: boolean;
  onHighlight: () => void;
  onAction: (view: CompanyJournalView) => void;
}) {
  return (
    <section
      className={`company-journal-insight ${selected ? "is-selected" : ""}`}
      tabIndex={0}
      aria-label={`${insight.title} 설명과 관련 차트 보기`}
      onMouseEnter={onHighlight}
      onFocus={onHighlight}
      onClick={onHighlight}
    >
      <h3>{insight.title}</h3>
      {insight.lead && <strong><GlossaryText text={insight.lead} /></strong>}
      <p><GlossaryText text={insight.text} /></p>
      {insight.actions && insight.actions.length > 0 && (
        <div className="company-journal-insight-actions" aria-label="관련 기업분석 화면">
          {insight.actions.map((action) => (
            <button
              key={action.targetView}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAction(action.targetView);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function buildJournalInsights({
  activeView,
  report,
  status,
  previewEnabled,
  companyName,
  narrative
}: {
  activeView: CompanyJournalView;
  report: CompanyJournalReport | null;
  status: "loading" | "ready" | "pending" | "error";
  previewEnabled: boolean;
  companyName: string;
  narrative: JournalNarrative;
}): JournalInsight[] {
  if (previewEnabled) {
    const tab = previewTabInsight(activeView, narrative);
    if (activeView === "earnings") {
      return [
        {
          id: "movement",
          title: "최근 움직임",
          lead: "3거래일 +4.2% · S&P 500 대비 +1.6%p",
          text: `${companyName}는 최근 시장보다 강했습니다. 아래 상대수익률의 마지막 점에서 같은 기간 S&P 500과의 차이를 확인할 수 있습니다. 다만 특정 뉴스 하나를 상승 원인으로 단정하지는 않습니다.`,
          chartFocus: "market-latest"
        },
        {
          id: "tab-focus",
          title: "이번 실적에서 먼저 볼 것",
          lead: tab.lead,
          text: tab.text,
          chartFocus: "earnings-latest"
        },
        {
          id: "watch",
          title: "앞으로 볼 것",
          lead: "다음 가이던스 · 핵심 사업 성장률 · AI 투자 회수",
          text: "다음 발표에서는 매출 성장률이 유지되는지, EPS 개선이 일회성 비용 감소가 아닌 영업 변화에서 나왔는지 확인해야 합니다. 추정치와 실제치 사이의 최신 점 간격이 첫 확인 지점입니다.",
          chartFocus: "earnings-latest"
        },
        {
          id: "summary",
          title: "GOPS AI 종합 판단",
          text: narrative.companyMeaning || narrative.observation,
          chartFocus: "all"
        },
        {
          id: "first-check",
          title: "기업 분석에서 먼저 볼 곳",
          text: "궁금한 기준을 선택하면 해당 차트로 이동합니다. 이동은 아래 버튼을 눌렀을 때만 실행됩니다.",
          chartFocus: "all",
          actions: journalAnalysisActions(activeView)
        }
      ];
    }
    return [
      {
        id: "tab-focus",
        title: tab.title,
        lead: tab.lead,
        text: tab.text,
        chartFocus: focusForView(activeView)
      },
      {
        id: "watch",
        title: "다음 확인",
        lead: detailWatchLead(activeView),
        text: detailWatchText(activeView),
        chartFocus: activeView === "profitability" ? "returns-latest" : focusForView(activeView)
      },
      {
        id: "summary",
        title: `${journalViewLabel(activeView)} 종합 판단`,
        text: previewDetailSummary(activeView),
        chartFocus: "all"
      },
      {
        id: "first-check",
        title: "기업분석에서 다음으로 볼 곳",
        text: "궁금한 기준을 선택하면 해당 차트로 이동합니다.",
        chartFocus: "all",
        actions: journalAnalysisActions(activeView)
      }
    ];
  }

  if (!report) {
    const waiting = status === "error"
      ? "저장된 기업저널을 불러오지 못했습니다. 연결을 확인하는 동안 기존 차트와 뉴스는 계속 볼 수 있습니다."
      : "검증된 기업저널 문장을 준비하고 있습니다. 기존 차트는 먼저 확인할 수 있습니다.";
    return [
      ...(activeView === "earnings" ? [{ id: "movement", title: "최근 움직임", lead: "데이터 연결 대기", text: waiting, chartFocus: "market-latest" as const }] : []),
      { id: "tab-focus", title: `${journalViewLabel(activeView)}에서 먼저 볼 것`, lead: "계산되지 않음", text: "확인되지 않은 숫자를 임의로 채우지 않습니다.", chartFocus: focusForView(activeView) },
      { id: "watch", title: "앞으로 볼 것", text: "검증된 결과가 저장되면 관찰 항목이 이 위치에 표시됩니다.", chartFocus: focusForView(activeView) },
      { id: "summary", title: `${journalViewLabel(activeView)} 종합 판단`, text: narrative.observation, chartFocus: "all" },
      { id: "first-check", title: "기업분석에서 다음으로 볼 곳", text: "궁금한 기준을 선택하면 해당 차트로 이동합니다.", chartFocus: "all", actions: journalAnalysisActions(activeView) }
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
  return [
    ...(activeView === "earnings" ? [{ id: "movement", title: "최근 움직임", lead: movementLead, text: report.recentMovement, chartFocus: "market-latest" as const }] : []),
    {
      id: "tab-focus",
      title: `${journalViewLabel(activeView)}에서 먼저 볼 것`,
      lead: activeView === "stability" ? stabilityLead : report.keywords.slice(0, 3).join(" · ") || undefined,
      text: selectedAnalysis,
      chartFocus: focusForView(activeView)
    },
    {
      id: "watch",
      title: "앞으로 볼 것",
      lead: report.keywords.length > 0 ? report.keywords.join(" · ") : undefined,
      text: report.watchItems,
      chartFocus: activeView === "profitability" ? "returns-latest" : focusForView(activeView)
    },
    {
      id: "summary",
      title: activeView === "earnings" ? "GOPS AI 종합 판단" : `${journalViewLabel(activeView)} 종합 판단`,
      text: activeView === "earnings" ? report.headline : selectedAnalysis,
      chartFocus: "all"
    },
    {
      id: "first-check",
      title: activeView === "earnings" ? "기업 분석에서 먼저 볼 곳" : "기업분석에서 다음으로 볼 곳",
      lead: activeView === "earnings" ? firstAnalysisLead : undefined,
      text: activeView === "earnings"
        ? report.tabs[firstAnalysisView] || report.financialStability || report.headline
        : "궁금한 기준을 선택하면 해당 차트로 이동합니다.",
      chartFocus: "all",
      actions: journalAnalysisActions(activeView)
    }
  ];
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

function focusForView(view: CompanyJournalView): JournalChartFocus {
  if (view === "earnings") return "earnings-latest";
  if (view === "valuation") return "valuation-latest";
  if (view === "stability") return "stability-latest";
  return "profitability-latest";
}

function detailWatchLead(view: CompanyJournalView) {
  if (view === "valuation") return "실적 성장률 · PER 변화 · FCF Yield";
  if (view === "stability") return "유동비율 · 순부채 · 이자보상배율";
  return "ROE · ROA · FCF Margin";
}

function detailWatchText(view: CompanyJournalView) {
  if (view === "valuation") return "현재 배수만 보지 말고 최신 EPS·BPS·SPS·CPS의 증가 속도와 PER·PBR·PSR의 마지막 점을 함께 비교하세요. 실적이 늘었는데 배수도 더 빨리 높아졌다면 기대가 먼저 반영됐을 수 있습니다.";
  if (view === "stability") return "최신 부채비율의 방향과 유동부채 비중을 먼저 비교하고, 표의 유동비율·순부채·이자보상배율로 단기 지급 능력과 이자 부담을 확인하세요.";
  return "순이익이 늘어도 ROE·ROA가 둔화되거나 FCF Margin이 따라오지 않으면 성장에 더 많은 자본과 현금이 필요하다는 뜻일 수 있습니다. 최신 점 세 개의 방향을 함께 보세요.";
}

function previewDetailSummary(view: Exclude<CompanyJournalView, "earnings">) {
  if (view === "valuation") {
    return "주당 실적은 개선되고 있지만 PER·PBR·PSR도 높은 구간입니다. 지금 가격이 정당화되려면 다음 실적에서도 EPS와 현금흐름이 현재 기대 속도를 따라와야 합니다.";
  }
  if (view === "stability") {
    return "현재 부채 구조는 비교적 안정적입니다. 다만 투자 확대가 이어지는 동안 유동비율과 이자보상배율이 함께 약해지지 않는지, 영업현금흐름이 지출을 감당하는지 확인해야 합니다.";
  }
  return "매출과 이익률이 함께 개선돼 성장의 질은 양호합니다. 다음 구간에서도 ROE·ROA와 FCF Margin이 같은 방향을 유지해야 현재 성장이 더 많은 자본 투입에만 의존하지 않는다고 판단할 수 있습니다.";
}

function journalViewLabel(view: CompanyJournalView) {
  return journalViews.find((candidate) => candidate.id === view)?.label ?? "기업 분석";
}

function previewTabInsight(activeView: CompanyJournalView, narrative: JournalNarrative) {
  if (activeView === "earnings") return {
    title: "실적에서 먼저 볼 것",
    lead: "EPS 예상 대비 · 매출 예상 대비 · 다음 가이던스",
    text: `${narrative.observation} 최신 실적의 큰 점은 실제치, 작은 점은 시장 추정치입니다. 두 점 사이의 세로선이 길수록 예상과 실제의 차이가 큽니다. EPS와 매출이 모두 같은 방향으로 움직였는지 먼저 확인하세요.`
  };
  if (activeView === "stability") return {
    title: "안정성에서 먼저 볼 것",
    lead: "부채비율 42% · 유동비율 · 이자보상배율",
    text: `${narrative.observation} 최신 부채비율 점이 유동부채비율보다 빠르게 높아졌는지 확인하세요. 이어서 안정성 수치 표의 유동비율·순부채·이자보상배율을 보면 단기 지급 능력과 이자 부담을 구분할 수 있습니다.`
  };
  if (activeView === "valuation") return {
    title: "가치에서 먼저 볼 것",
    lead: "PER · PBR · PSR · 주당 현금흐름",
    text: `${narrative.observation} 최신 EPS·BPS·SPS·CPS 막대의 증가 속도와 PER·PBR·PSR의 마지막 점을 함께 보세요. 실적보다 가치 배수가 더 빠르게 높아졌다면 주가에 성장 기대가 먼저 반영됐을 수 있습니다.`
  };
  return {
    title: "매출·수익에서 먼저 볼 것",
    lead: "매출 성장 · 영업이익률 · 순이익률",
    text: `${narrative.observation} 최신 매출 막대와 영업이익률·순이익률의 마지막 점이 같은 방향인지 확인하세요. 매출만 늘고 두 이익률이 낮아지면 성장보다 비용 부담이 더 빠르게 커진 구간입니다.`
  };
}

function buildStoredJournalOverview(
  report: CompanyJournalReport | null,
  status: "loading" | "ready" | "pending" | "error"
): { headline: string; metrics: JournalMetric[] } {
  if (!report) {
    const headline = status === "error"
      ? "저장된 기업저널을 불러올 수 없습니다. 기존 재무 차트와 뉴스는 계속 확인할 수 있습니다."
      : "최신 뉴스·주가·재무 근거로 기업저널을 준비하고 있습니다. 기존 차트는 먼저 확인할 수 있습니다.";
    return {
      headline,
      metrics: [
        metric("최근 움직임", "데이터 연결 대기", "ClickHouse 검증본 준비 중", "neutral"),
        metric("시장 대비", "계산되지 않음", "S&P 500 기준", "neutral"),
        metric("재무 안정성", "데이터 연결 대기", "SEC 기준", "neutral"),
        metric("분석 상태", status === "error" ? "연결 확인 필요" : "생성 대기", "기존 차트는 사용 가능", status === "error" ? "caution" : "neutral")
      ]
    };
  }
  const metrics = report.serverMetrics;
  const debtRatio = metrics.financial?.liabilitiesToEquity;
  const sessions = metrics.recentSessions ?? 3;
  return {
    headline: report.headline,
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

function buildStoredJournalNarrative(
  view: CompanyJournalView,
  report: CompanyJournalReport | null,
  status: "loading" | "ready" | "pending" | "error"
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

function buildJournalNarrative(
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
    const valuation = companyValuationLens(item);
    return {
      headline: "현재 가격이 요구하는 성장 기대를 점검합니다.",
      observation: `최신 기준 PER은 ${formatJournalMultiple(per)}, PBR은 ${formatJournalMultiple(pbr)}, PSR은 ${formatJournalMultiple(psr)}이며 FCF Yield는 ${formatRatio(fcfYield)}입니다. 주당지표의 증가와 현재 배수 수준을 분리해 확인해야 합니다.`,
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
  if (revenueGrowth != null && revenueGrowth > 0 && marginDelta != null && marginDelta > 0) {
    return `${companyName}의 외형 성장과 이익률 개선이 함께 이어지는지 확인할 구간입니다.`;
  }
  if (revenueGrowth != null && revenueGrowth > 0 && marginDelta != null && marginDelta < 0) {
    return `${companyName}에서는 성장보다 수익성 희석의 원인을 먼저 확인해야 합니다.`;
  }
  if (epsSurprise != null && Math.abs(epsSurprise) >= 5) {
    return `${companyName}의 최근 실적 차이가 반복 가능한 영업 변화인지가 중요합니다.`;
  }
  return `${companyName}의 매출·수익성·안정성을 같은 기준시각에서 함께 읽습니다.`;
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
  const earningsSeries = financialSeries.slice(-8).map((point, index) => {
    const epsFactor = [1.04, 0.98, 1.06, 1.03, 1.07, 1.05, 0.99, 1.08][index] ?? 1;
    const revenueFactor = [1.03, 0.99, 1.04, 1.02, 1.05, 1.04, 1.01, 1.06][index] ?? 1;
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
