import {
  BookOpenText,
  ChartNoAxesCombined,
  CircleAlert,
  Newspaper,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { AgentReference } from "../agent/agentReferences";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import {
  CompanySummaryPanel,
  type CompanyJournalEvidence,
  type CompanyPanelView,
  type ValuationPricePoint
} from "./CompanySummaryPanel";
import { NewsPanel } from "./NewsPanel";

type CompanyJournalView = Extract<CompanyPanelView, "profitability" | "stability" | "valuation"> | "news";

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

const journalViews = [
  { id: "profitability", label: "매출·수익", icon: ChartNoAxesCombined },
  { id: "stability", label: "안정성", icon: ShieldCheck },
  { id: "valuation", label: "가치", icon: BookOpenText },
  { id: "news", label: "뉴스", icon: Newspaper }
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
  items = [],
  sourcePanelId,
  selectedAgentReferenceKeys = [],
  emphasizedAgentReferenceKeys = [],
  onAgentReferenceSelect,
  onAgentAsk
}: CompanyJournalPanelProps) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const previewEnabled = companyJournalPreviewEnabled();
  const resolvedItem = useMemo(
    () => previewEnabled ? buildCompanyJournalPreviewItem(item, normalizedSymbol) : item,
    [item, normalizedSymbol, previewEnabled]
  );
  const [activeView, setActiveView] = useState<CompanyJournalView>("profitability");
  const [evidenceBySymbol, setEvidenceBySymbol] = useState<Record<string, CompanyJournalEvidence>>({});
  const evidence = evidenceBySymbol[normalizedSymbol] ?? emptyEvidence;
  const onEvidenceChange = useCallback((nextEvidence: CompanyJournalEvidence) => {
    setEvidenceBySymbol((current) => ({ ...current, [normalizedSymbol]: nextEvidence }));
  }, [normalizedSymbol]);
  const overview = useMemo(() => buildJournalOverview(resolvedItem, evidence), [evidence, resolvedItem]);
  const narrative = useMemo(
    () => buildJournalNarrative(activeView, normalizedSymbol, resolvedItem, evidence),
    [activeView, evidence, normalizedSymbol, resolvedItem]
  );
  const sourceAsOf = resolvedItem?.fundamentalsAsOf ?? resolvedItem?.periodEndDate ?? resolvedItem?.filedAt ?? resolvedItem?.priceUpdatedAt ?? null;

  return (
    <section className="company-journal-panel" aria-label={`${normalizedSymbol} AI 기업저널 초안`}>
      <header className="company-journal-header">
        <div className="company-journal-title">
          <span className="company-journal-kicker">
            <Sparkles aria-hidden="true" />기업 저널 · 초안
            {previewEnabled && <em>DEV PREVIEW</em>}
          </span>
          <h2>{resolvedItem?.companyName || normalizedSymbol}</h2>
          <p>{overview.headline}</p>
        </div>
        <dl className="company-journal-meta">
          <div><dt>심볼</dt><dd>{normalizedSymbol}</dd></div>
          <div><dt>업종</dt><dd>{resolvedItem?.industry || resolvedItem?.sectorLabelKo || resolvedItem?.sector || "확인 중"}</dd></div>
          <div><dt>기준</dt><dd>{formatAsOf(sourceAsOf)}</dd></div>
        </dl>
      </header>

      <div className="company-journal-metrics" aria-label="기업 저널 핵심 지표">
        {overview.metrics.map((metric) => (
          <div key={metric.label} className={`company-journal-metric is-${metric.tone}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>

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
              onClick={() => setActiveView(view.id)}
            >
              <Icon aria-hidden="true" />
              <span>{view.label}</span>
            </button>
          );
        })}
      </div>

      <div className="company-journal-body">
        <div className={`company-journal-evidence is-${activeView}`} role="tabpanel">
          {activeView === "news" ? (
            <NewsPanel
              symbol={normalizedSymbol}
              initialPayload={previewEnabled ? buildCompanyJournalPreviewNews(normalizedSymbol) : undefined}
              sourcePanelId={sourcePanelId}
              selectedAgentReferenceKeys={selectedAgentReferenceKeys}
              emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
              onAgentReferenceSelect={onAgentReferenceSelect}
              onAgentAsk={onAgentAsk}
              variant="list"
            />
          ) : (
            <CompanySummaryPanel
              symbol={normalizedSymbol}
              item={resolvedItem}
              items={items}
              view={activeView}
              valuationContent={activeView === "valuation" ? "valuation" : "combined"}
              stabilityContent={activeView === "stability" ? "stability-dashboard" : "stability"}
              valuationPriceFixture={previewEnabled ? companyJournalPreviewValuationPrices : undefined}
              onEvidenceChange={onEvidenceChange}
              disableRemoteFetch={previewEnabled}
            />
          )}
        </div>

        <aside className="company-journal-reading" aria-label={`${activeView} 해석`}>
          <div className="company-journal-reading-heading">
            <span>{journalViews.find((view) => view.id === activeView)?.label}</span>
            <h3>{narrative.headline}</h3>
          </div>
          <JournalReadingSection label="무엇이 보이나" text={narrative.observation} />
          <JournalReadingSection label="이 기업에서는 왜 중요한가" text={narrative.companyMeaning} />
          <JournalReadingSection label="다음 확인" text={narrative.nextCheck} emphasis />
          <div className="company-journal-counterpoint">
            <CircleAlert aria-hidden="true" />
            <div>
              <strong>이 해석이 틀릴 수 있는 이유</strong>
              <p>{narrative.counterpoint}</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function JournalReadingSection({ label, text, emphasis = false }: { label: string; text: string; emphasis?: boolean }) {
  return (
    <section className={emphasis ? "company-journal-reading-section is-emphasis" : "company-journal-reading-section"}>
      <strong>{label}</strong>
      <p>{text}</p>
    </section>
  );
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
  if (view === "news") {
    return {
      headline: "최근 사건을 사업 지표와 연결해 읽습니다.",
      observation: "기존 뉴스 패널의 최신 기사와 일자별 요약을 그대로 사용합니다. 기사 수보다 실적과 사업 구조에 영향을 줄 수 있는 사건이 있는지를 먼저 확인합니다.",
      companyMeaning: `${companyLens(item).newsLens} 초안에서는 확인된 기사만 표시하며, 뉴스가 실제 재무 수치에 미친 영향은 단정하지 않습니다.`,
      nextCheck: "중요 사건이 발생한 뒤 매출·마진·가이던스 중 어떤 지표가 실제로 달라지는지 확인합니다.",
      counterpoint: "기사의 방향과 실제 실적 영향은 다를 수 있습니다. 공시 또는 다음 실적에서 확인되기 전까지는 사건과 결과를 분리해야 합니다."
    };
  }

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

function buildCompanyJournalPreviewNews(symbol: string) {
  return {
    symbol,
    displayMode: "dailySummary",
    items: [],
    dailySummaries: [
      {
        date: "2026-07-15",
        symbol,
        summary: "DEV PREVIEW · 차세대 GPU 공급 확대 기대가 유지됐지만, 핵심 고객의 설비투자 속도가 실제 매출 성장으로 이어지는지 확인이 필요합니다.",
        keyPoints: ["차세대 제품 수요", "주요 고객 CAPEX", "공급 확대"],
        impactDirection: "positive",
        sentiment: "positive",
        articleIds: ["dev-journal-nvda-1"],
        articleCount: 3,
        mentionCount: 5,
        status: "dev-preview",
        generatedAt: "2026-07-15T21:00:00Z",
        sources: [
          {
            articleId: "dev-journal-nvda-1",
            title: "DEV PREVIEW · 차세대 GPU 수요와 공급 확대 점검",
            name: "GOPS Fixture",
            url: "https://example.com/gops-dev-preview/gpu-demand",
            publishedAt: "2026-07-15T20:30:00Z"
          }
        ],
        priceChange: { date: "2026-07-15", previousClose: 190.82, close: 194.72, change: 3.90, changePercent: 2.04 }
      },
      {
        date: "2026-07-14",
        symbol,
        summary: "DEV PREVIEW · 수출 규제 가능성이 특정 지역 매출과 제품 믹스에 미칠 영향이 재부각됐습니다. 매출 규모보다 대체 제품의 마진 차이를 봐야 합니다.",
        keyPoints: ["수출 규제", "지역별 매출", "제품 믹스"],
        impactDirection: "negative",
        sentiment: "mixed",
        articleIds: ["dev-journal-nvda-2"],
        articleCount: 2,
        mentionCount: 4,
        status: "dev-preview",
        generatedAt: "2026-07-14T20:00:00Z",
        sources: [
          {
            articleId: "dev-journal-nvda-2",
            title: "DEV PREVIEW · 수출 규제와 제품 믹스 영향",
            name: "GOPS Fixture",
            url: "https://example.com/gops-dev-preview/export-controls",
            publishedAt: "2026-07-14T19:30:00Z"
          }
        ],
        priceChange: { date: "2026-07-14", previousClose: 192.10, close: 190.82, change: -1.28, changePercent: -0.67 }
      },
      {
        date: "2026-07-11",
        symbol,
        summary: "DEV PREVIEW · 데이터센터 매출 성장과 높은 순이익률이 함께 유지됐다는 가정입니다. 다음 실적에서는 성장률 둔화 여부와 현금흐름 전환을 함께 확인합니다.",
        keyPoints: ["데이터센터 성장", "순이익률", "현금흐름"],
        impactDirection: "mixed",
        sentiment: "neutral",
        articleIds: ["dev-journal-nvda-3"],
        articleCount: 4,
        mentionCount: 6,
        status: "dev-preview",
        generatedAt: "2026-07-11T20:00:00Z",
        sources: [
          {
            articleId: "dev-journal-nvda-3",
            title: "DEV PREVIEW · 데이터센터 성장과 현금흐름",
            name: "GOPS Fixture",
            url: "https://example.com/gops-dev-preview/data-center",
            publishedAt: "2026-07-11T19:30:00Z"
          }
        ],
        priceChange: { date: "2026-07-11", previousClose: 188.64, close: 192.10, change: 3.46, changePercent: 1.83 }
      }
    ]
  };
}
