import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { formatKoreanCompactUsd } from "../currencyFormat";
import type { CompanyJournalEvidence, FinancialChartPoint } from "./CompanyJournalSummaryPanel";
import type { CompanyJournalDiagnosis, CompanyJournalSignalTone } from "./companyJournalDiagnosis";

export type CompanyJournalReadingView = "earnings" | "valuation" | "profitability" | "stability";

export type CompanyJournalReadingTarget = {
  label: string;
  view: CompanyJournalReadingView;
  metric: string;
  years: number[];
};

export type CompanyJournalReadingSection = {
  id: string;
  kind: "overview" | "positive" | "caution" | "change" | "comparison" | "impact" | "judgment";
  title: string;
  summary: string;
  detail: string;
  tone: "positive" | "caution" | "neutral";
  links: CompanyJournalReadingTarget[];
  missingNote?: string;
};

type ReadingFacts = {
  latest: FinancialChartPoint | undefined;
  previous: FinancialChartPoint | undefined;
  latestYear: number | null;
  previousYear: number | null;
  years: number[];
  revenueGrowth: number | null;
  operatingMargin: number | null;
  operatingMarginDelta: number | null;
  netMargin: number | null;
  netMarginDelta: number | null;
  epsGrowth: number | null;
  roe: number | null;
  roa: number | null;
  fcfMargin: number | null;
  per: number | null;
  pbr: number | null;
  psr: number | null;
  fcfYield: number | null;
  equityGrowth: number | null;
  liabilitiesGrowth: number | null;
  debtRatio: number | null;
  debtRatioDelta: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  netDebt: number | null;
};

export function buildCompanyJournalReading({
  view,
  item,
  evidence,
  diagnosis
}: {
  view: CompanyJournalReadingView;
  item: Sp500UniverseItem | undefined;
  evidence: CompanyJournalEvidence;
  diagnosis: CompanyJournalDiagnosis;
}): CompanyJournalReadingSection[] {
  const facts = buildReadingFacts(item, evidence);
  return view === "earnings"
    ? buildEarningsReading(item, diagnosis, facts)
    : buildDetailReading(view, diagnosis, facts);
}

function buildEarningsReading(
  item: Sp500UniverseItem | undefined,
  diagnosis: CompanyJournalDiagnosis,
  facts: ReadingFacts
): CompanyJournalReadingSection[] {
  const companyName = item?.companyName || item?.symbol || "이 기업";
  const profitability = signalFor(diagnosis, "profitability");
  const valuation = signalFor(diagnosis, "valuation");
  const stability = signalFor(diagnosis, "stability");
  const growthSentence = facts.revenueGrowth == null
    ? `${companyName}의 최근 매출 성장률은 아직 같은 기준으로 비교하기 어렵습니다.`
    : facts.revenueGrowth >= 0
      ? `${companyName}의 매출은 이전 결산보다 ${formatChange(facts.revenueGrowth)} 늘었습니다.`
      : `${companyName}의 매출은 이전 결산보다 ${formatChange(facts.revenueGrowth)} 줄었습니다.`;
  const qualitySentence = facts.operatingMarginDelta == null && facts.netMarginDelta == null
    ? "이익률 자료가 충분하지 않아 성장의 질은 다른 지표와 함께 해석하는 편이 안전합니다."
    : positiveChange(facts.operatingMarginDelta) || positiveChange(facts.netMarginDelta)
      ? "이익률도 함께 개선돼 외형 성장이 실제 이익 증가로 이어지는 흐름입니다."
      : "이익률은 매출 흐름을 따라가지 못해 성장의 질이 약해질 수 있는 구간입니다.";
  const goodLinks = compactTargets([
    target("매출액", "profitability", "revenue", facts.years, facts.revenueGrowth),
    target("EPS", "valuation", "eps", facts.years, facts.epsGrowth),
    target("영업이익률", "profitability", "operating-margin", facts.years, facts.operatingMargin)
  ]);
  const hasPositiveEvidence = positiveChange(facts.revenueGrowth)
    || positiveChange(facts.epsGrowth)
    || positiveChange(facts.operatingMarginDelta)
    || positiveChange(facts.netMarginDelta);
  const hasValuationAssessment = valuation != null && valuation.tone !== "insufficient";
  const hasStabilityAssessment = stability != null && stability.tone !== "insufficient";
  const cautionLinks = compactTargets([
    valuation?.tone === "caution" || valuation?.tone === "negative"
      ? target("PER", "valuation", "per", facts.years, facts.per)
      : null,
    stability?.tone === "caution" || stability?.tone === "negative"
      ? target("부채비율", "stability", "debt-ratio", facts.years, facts.debtRatio)
      : null,
    target("이자보상배율", "stability", "interest-coverage", facts.years, facts.interestCoverage),
    target("FCF Margin", "profitability", "fcf-margin", facts.years, facts.fcfMargin)
  ]).slice(0, 3);
  const comparisons = earningsComparisons(facts);
  const cautionSummary = valuation?.tone === "caution" || valuation?.tone === "negative"
    ? "실적 개선과 별개로 현재 가치 배수가 높아 성장 기대가 가격에 많이 반영돼 있습니다."
    : stability?.tone === "caution" || stability?.tone === "negative"
      ? "사업은 성장하고 있지만 부채와 유동성의 변화가 재무 여력을 낮출 수 있습니다."
      : hasValuationAssessment || hasStabilityAssessment
        ? "현재 확인된 큰 재무 경고는 없지만 현금 창출이 이익 증가를 따라가는지는 함께 볼 필요가 있습니다."
        : "가치와 재무 위험을 판단할 비교 자료가 아직 충분하지 않습니다.";
  const cautionDetail = valuation?.tone === "caution" || valuation?.tone === "negative"
    ? `현재 PER은 ${formatMultiple(facts.per)}, PBR은 ${formatMultiple(facts.pbr)}입니다. 실적보다 가치 배수가 빠르게 높아지면 좋은 실적도 주가에 이미 반영됐을 수 있습니다. 이 흐름이 이어지면 다음 실적이 기대에 못 미칠 때 주가 변동이 커질 수 있습니다.`
    : hasStabilityAssessment
      ? `부채비율은 ${formatPercent(facts.debtRatio)}, 유동비율은 ${formatPercent(facts.currentRatio)}입니다. 이자보상배율 ${formatMultiple(facts.interestCoverage)}는 이익으로 이자비용을 감당할 여력을 보여줍니다. 두 지표가 함께 약해지면 투자와 주주환원에 쓸 현금이 줄어들 수 있습니다.`
      : "현재 확인 가능한 자료만으로는 부채와 유동성의 변화 방향을 정하기 어렵습니다. 확인된 매출과 이익 흐름은 그대로 보여주되 재무 안전성은 단정하지 않습니다. 비교 가능한 결산 자료가 반영되면 위험과 현금 여력을 함께 판단할 수 있습니다.";
  const missingNote = missingFactsNote(facts);

  return [
    section("current-flow", "overview", "기업의 현재 흐름", `${growthSentence} ${qualitySentence}`, `${profitability?.result ?? growthSentence} ${valuation?.result ?? "현재 가치 수준은 확인 가능한 지표 범위에서 해석했습니다."} ${stability?.result ?? "재무 완충력은 확인 가능한 부채·유동성 자료로 판단했습니다."}`, "neutral", []),
    section(
      "strengths",
      "positive",
      "좋은 점",
      positiveChange(facts.revenueGrowth) && (positiveChange(facts.operatingMarginDelta) || positiveChange(facts.netMarginDelta))
        ? "매출과 이익률이 함께 좋아져 성장의 질이 개선되고 있습니다."
        : hasPositiveEvidence
          ? "현재 확인되는 긍정 신호는 매출·주당 실적·수익성 지표에서 선별적으로 나타납니다."
          : "긍정 흐름을 판단할 비교 자료가 아직 충분하지 않습니다.",
      hasPositiveEvidence
        ? `매출은 ${formatChange(facts.revenueGrowth)}, EPS는 ${formatChange(facts.epsGrowth)} 변했습니다. 영업이익률은 ${formatPercent(facts.operatingMargin)}로 ${formatPointChange(facts.operatingMarginDelta)} 움직였습니다. 이 방향이 이어지면 같은 매출 증가에서도 더 큰 이익을 남길 가능성이 커집니다.`
        : "확인된 값이 없는 지표를 긍정 신호로 간주하지 않습니다. 현재 반영된 자료만 표시하고 비교 가능한 두 결산연도가 생기기 전까지 성장의 질을 단정하지 않습니다.",
      hasPositiveEvidence ? "positive" : "neutral",
      goodLinks,
      missingNote
    ),
    section(
      "risks",
      "caution",
      "조심할 점",
      cautionSummary,
      cautionDetail,
      hasValuationAssessment || hasStabilityAssessment ? "caution" : "neutral",
      cautionLinks,
      missingNote
    ),
    section(
      "comparisons",
      "comparison",
      "비교해서 볼 항목",
      comparisons.length > 0 ? "두 결산연도의 같은 지표를 비교하면 변화의 방향과 속도를 바로 볼 수 있습니다." : "같은 기준으로 비교 가능한 두 결산연도가 아직 충분하지 않습니다.",
      "항목을 누르면 해당 탭으로 이동해 차트와 표의 두 연도가 함께 강조됩니다.",
      "neutral",
      comparisons,
      comparisons.length === 0 ? "비교 가능한 연도 자료가 부족합니다." : undefined
    ),
    section(
      "judgment",
      "judgment",
      "GOPS AI 종합 판단",
      diagnosis.summary,
      `${growthSentence} ${cautionSummary} 다음 결산에서도 매출과 이익률이 같은 방향을 유지하고 가치 배수와 부채 부담이 더 빠르게 높아지지 않는다면 현재 기업 흐름의 지속 가능성이 커집니다.`,
      toneForDiagnosis(diagnosis.tone),
      []
    )
  ];
}

function buildDetailReading(
  view: Exclude<CompanyJournalReadingView, "earnings">,
  diagnosis: CompanyJournalDiagnosis,
  facts: ReadingFacts
): CompanyJournalReadingSection[] {
  const signal = signalFor(diagnosis, view);
  const content = detailCopy(view, facts);
  return [
    section("current-state", "overview", "현재 상태", content.currentSummary, content.currentDetail, toneForSignal(signal?.tone), content.primaryLinks),
    section("key-change", "change", "핵심 변화", content.changeSummary, content.changeDetail, toneForSignal(signal?.tone), content.primaryLinks),
    section(
      "comparisons",
      "comparison",
      "비교해서 볼 항목",
      content.comparisons.length > 0 ? "같은 기준의 두 기간을 나란히 보면 변화가 일시적인지 이어지는 흐름인지 구분하기 쉽습니다." : "비교 가능한 두 결산연도가 아직 충분하지 않습니다.",
      "항목을 누르면 관련 차트와 표로 이동하고 두 연도가 동시에 강조됩니다.",
      "neutral",
      content.comparisons.slice(0, 3),
      content.comparisons.length === 0 ? "비교 가능한 연도 자료가 부족합니다." : undefined
    ),
    section("impact", "impact", "이 변화가 기업에 미치는 영향", content.impactSummary, content.impactDetail, toneForSignal(signal?.tone), content.primaryLinks.slice(0, 2)),
    section("judgment", "judgment", "GOPS AI 영역별 판단", signal?.result ?? content.judgmentSummary, content.judgmentDetail, toneForSignal(signal?.tone), [])
  ];
}

function detailCopy(view: Exclude<CompanyJournalReadingView, "earnings">, facts: ReadingFacts) {
  if (view === "valuation") {
    const links = compactTargets([
      target("EPS", view, "eps", facts.years, facts.epsGrowth),
      target("PER", view, "per", facts.years, facts.per),
      target("FCF Yield", view, "fcf-yield", facts.years, facts.fcfYield)
    ]);
    return {
      currentSummary: `주당 실적은 ${changeDirection(facts.epsGrowth)}했지만 현재 PER은 ${formatMultiple(facts.per)}입니다.`,
      currentDetail: `EPS는 이전 결산보다 ${formatChange(facts.epsGrowth)} 변했고 PER은 ${formatMultiple(facts.per)}, PBR은 ${formatMultiple(facts.pbr)}입니다. 주당 실적보다 가치 배수가 빠르게 높아졌다면 성장 기대가 현재 가격에 먼저 반영됐다는 뜻입니다. 다음 실적이 기대에 못 미치면 가치 배수가 낮아지며 주가 변동이 커질 수 있습니다.`,
      changeSummary: facts.epsGrowth == null
        ? `EPS 변화 자료가 부족해 현재 PER ${formatMultiple(facts.per)}을 중심으로 가격 부담을 확인합니다.`
        : `EPS 변화 ${formatChange(facts.epsGrowth)}와 PER ${formatMultiple(facts.per)}를 함께 보면 실적 대비 가격 부담을 구분할 수 있습니다.`,
      changeDetail: `현재 PSR은 ${formatMultiple(facts.psr)}, FCF Yield는 ${formatPercent(facts.fcfYield)}입니다. 매출과 현금흐름 증가보다 가치 배수가 더 빠르게 높아지면 투자자가 지불하는 기대의 몫이 커집니다. 반대로 현금 창출이 따라오면 높은 배수를 지탱할 근거가 강해집니다.`,
      comparisons: compactTargets([
        comparisonTarget("EPS", view, "eps", facts),
        comparisonTarget("BPS", view, "bps", facts),
        comparisonTarget("SPS", view, "sps", facts)
      ]),
      impactSummary: "가치 부담이 커질수록 좋은 실적에도 주가 반응이 제한될 수 있습니다.",
      impactDetail: `FCF Yield ${formatPercent(facts.fcfYield)}는 현재 가격 대비 현금 창출 여력을 보여줍니다. 가치 배수는 높은데 현금수익률이 낮아지면 기대가 실제 현금보다 앞선 상태입니다. 이 간격이 더 벌어지면 실적 발표 전후의 변동성이 커질 수 있습니다.`,
      judgmentSummary: "현재 가치 수준은 주당 실적의 성장 속도와 함께 해석해야 합니다.",
      judgmentDetail: `주당 실적은 ${changeDirection(facts.epsGrowth)}했지만 PER ${formatMultiple(facts.per)}와 PSR ${formatMultiple(facts.psr)}도 함께 고려해야 합니다. 다음 EPS와 현금흐름이 현재 가치 배수의 기대를 따라갈 때 가격 부담이 완화될 수 있습니다.`,
      primaryLinks: links
    };
  }
  if (view === "profitability") {
    const links = compactTargets([
      target("매출액", view, "revenue", facts.years, facts.revenueGrowth),
      target("영업이익률", view, "operating-margin", facts.years, facts.operatingMargin),
      target("순이익률", view, "net-margin", facts.years, facts.netMargin),
      target("ROE", view, "roe", facts.years, facts.roe),
      target("FCF Margin", view, "fcf-margin", facts.years, facts.fcfMargin)
    ]);
    return {
      currentSummary: `매출은 ${formatChange(facts.revenueGrowth)} 변했고 영업이익률은 ${formatPercent(facts.operatingMargin)}입니다.`,
      currentDetail: `매출은 이전 결산보다 ${formatChange(facts.revenueGrowth)}, 영업이익률은 ${formatPointChange(facts.operatingMarginDelta)} 움직였습니다. 매출과 이익률이 같은 방향이면 외형 성장이 비용 효율 개선으로 이어졌다는 뜻입니다. 이 흐름이 이어지면 매출 증가보다 이익 증가가 더 빨라질 수 있습니다.`,
      changeSummary: `순이익률은 ${formatPercent(facts.netMargin)}로 ${formatPointChange(facts.netMarginDelta)} 변했습니다.`,
      changeDetail: `ROE는 ${formatPercent(facts.roe)}, ROA는 ${formatPercent(facts.roa)}, FCF Margin은 ${formatPercent(facts.fcfMargin)}입니다. 이익률과 자본 효율이 함께 좋아지면 더 적은 자산으로 더 많은 이익을 만드는 구조가 강화됩니다. 현금 마진까지 유지될 때 이익의 질도 높게 볼 수 있습니다.`,
      comparisons: compactTargets([
        comparisonTarget("매출액", view, "revenue", facts),
        comparisonTarget("영업이익률", view, "operating-margin", facts),
        comparisonTarget("순이익률", view, "net-margin", facts)
      ]),
      impactSummary: "매출과 이익률의 동행은 성장의 질과 다음 이익 증가 폭을 좌우합니다.",
      impactDetail: `현재 매출 변화는 ${formatChange(facts.revenueGrowth)}, FCF Margin은 ${formatPercent(facts.fcfMargin)}입니다. 외형 성장과 현금 전환이 함께 개선되면 투자 확대를 자체 현금으로 감당할 여지가 커집니다. 매출만 늘고 현금 마진이 낮아지면 성장 비용이 뒤늦게 부담으로 나타날 수 있습니다.`,
      judgmentSummary: "매출 증가가 이익과 현금 증가로 이어지는지가 수익성의 핵심입니다.",
      judgmentDetail: `영업이익률 ${formatPercent(facts.operatingMargin)}와 순이익률 ${formatPercent(facts.netMargin)}의 방향이 매출과 같다면 성장의 질은 양호합니다. ROE·ROA와 FCF Margin까지 같은 방향을 유지할 때 현재 개선 흐름의 지속 가능성이 높아집니다.`,
      primaryLinks: links
    };
  }
  const links = compactTargets([
    target("부채비율", view, "debt-ratio", facts.years, facts.debtRatio),
    target("유동비율", view, "current-ratio", facts.years, facts.currentRatio),
    target("이자보상배율", view, "interest-coverage", facts.years, facts.interestCoverage),
    target("순부채", view, "net-debt", facts.years, facts.netDebt)
  ]);
  const stabilityCurrentSummary = facts.currentRatio == null
    ? `부채비율은 ${formatPercent(facts.debtRatio)}이며, 유동성 자료는 아직 충분하지 않습니다.`
    : `부채비율은 ${formatPercent(facts.debtRatio)}, 유동비율은 ${formatPercent(facts.currentRatio)}로 현재 재무 완충력을 보여줍니다.`;
  return {
    currentSummary: stabilityCurrentSummary,
    currentDetail: `부채비율은 이전 결산보다 ${formatPointChange(facts.debtRatioDelta)} 변했고 유동비율은 ${formatPercent(facts.currentRatio)}입니다. 부채 부담이 낮아지고 단기 지급 여력이 높아지면 경기 둔화에도 버틸 여지가 커집니다. 반대 흐름이 이어지면 투자와 주주환원에 쓸 현금이 줄어들 수 있습니다.`,
    changeSummary: facts.equityGrowth == null || facts.liabilitiesGrowth == null
      ? "총자본과 총부채의 변화는 비교 가능한 결산 자료가 더 필요합니다."
      : `총자본은 ${formatChange(facts.equityGrowth)}, 총부채는 ${formatChange(facts.liabilitiesGrowth)} 변했습니다.`,
    changeDetail: `이자보상배율은 ${formatMultiple(facts.interestCoverage)}, 순부채는 ${formatMoney(facts.netDebt)}입니다. 자본보다 부채가 빠르게 늘고 이자보상배율이 낮아지면 이익 중 이자비용으로 쓰이는 몫이 커집니다. 이 흐름이 계속되면 새로운 투자에 사용할 재무 여력이 줄어들 수 있습니다.`,
    comparisons: compactTargets([
      comparisonTarget("부채비율", view, "debt-ratio", facts),
      comparisonTarget("유동비율", view, "current-ratio", facts),
      comparisonTarget("이자보상배율", view, "interest-coverage", facts)
    ]),
    impactSummary: "부채와 현금 여력은 어려운 시기에 사업 투자를 계속할 수 있는 범위를 결정합니다.",
    impactDetail: `현재 유동비율은 ${formatPercent(facts.currentRatio)}, 이자보상배율은 ${formatMultiple(facts.interestCoverage)}입니다. 두 지표가 충분하면 매출이 일시적으로 둔화돼도 단기 채무와 이자비용을 감당할 가능성이 높습니다. 함께 약해지면 비용 절감이나 투자 축소 압력이 커질 수 있습니다.`,
    judgmentSummary: "부채 수준뿐 아니라 유동성과 이자 부담이 같은 방향인지 함께 봐야 합니다.",
    judgmentDetail: `부채비율 ${formatPercent(facts.debtRatio)}와 유동비율 ${formatPercent(facts.currentRatio)}을 함께 보면 현재 재무 부담과 단기 지급 능력을 구분할 수 있습니다. 이자보상배율이 유지되는 동안에는 부채 증가가 즉각적인 위험으로 이어질 가능성이 낮습니다.`,
    primaryLinks: links
  };
}

function buildReadingFacts(item: Sp500UniverseItem | undefined, evidence: CompanyJournalEvidence): ReadingFacts {
  const pair = selectedFinancialPair(evidence);
  const latest = pair.latest;
  const previous = pair.previous;
  const latestYear = financialYear(latest);
  const previousYear = financialYear(previous);
  const years = [latestYear, previousYear].filter((value): value is number => value != null);
  const annualizer = evidence.financialPeriodMode === "quarterly" ? 4 : 1;
  const operatingMargin = ratio(latest?.operatingIncome, latest?.revenue);
  const previousOperatingMargin = ratio(previous?.operatingIncome, previous?.revenue);
  const netMargin = ratio(latest?.netIncome, latest?.revenue);
  const previousNetMargin = ratio(previous?.netIncome, previous?.revenue);
  const shares = latest?.sharesOutstanding;
  const previousShares = previous?.sharesOutstanding;
  const latestEps = firstFinite(latest?.eps, ratio(latest?.netIncome, shares));
  const previousEps = firstFinite(previous?.eps, ratio(previous?.netIncome, previousShares));
  const marketCap = firstFinite(item?.marketCap, item?.layoutMarketCap);
  const price = firstFinite(item?.lastPrice, item?.layoutPrice);
  const latestEquity = firstFinite(latest?.totalEquity, item?.totalEquity);
  const latestRevenue = firstFinite(latest?.revenue, item?.revenue);
  const latestFcf = firstFinite(latest?.freeCashFlow, item?.freeCashFlow);
  const currentRatio = firstFinite(latest?.currentRatio, ratio(latest?.currentAssets, latest?.currentLiabilities));
  const interestExpense = latest?.interestExpense == null ? null : Math.abs(latest.interestExpense);
  const debtRatio = firstFinite(latest?.debtRatio, ratio(latest?.totalLiabilities, latest?.totalEquity));
  const previousDebtRatio = firstFinite(previous?.debtRatio, ratio(previous?.totalLiabilities, previous?.totalEquity));
  return {
    latest,
    previous,
    latestYear,
    previousYear,
    years,
    revenueGrowth: changePercent(previous?.revenue, latest?.revenue),
    operatingMargin,
    operatingMarginDelta: pointDelta(previousOperatingMargin, operatingMargin),
    netMargin,
    netMarginDelta: pointDelta(previousNetMargin, netMargin),
    epsGrowth: changePercent(previousEps, latestEps),
    roe: ratio(multiply(latest?.netIncome, annualizer), latest?.totalEquity),
    roa: ratio(multiply(latest?.netIncome, annualizer), latest?.totalAssets),
    fcfMargin: ratio(latest?.freeCashFlow, latest?.revenue),
    per: ratio(price, firstFinite(item?.eps, latestEps)),
    pbr: ratio(marketCap, latestEquity),
    psr: ratio(marketCap, latestRevenue),
    fcfYield: ratio(latestFcf, marketCap),
    equityGrowth: changePercent(previous?.totalEquity, latest?.totalEquity),
    liabilitiesGrowth: changePercent(previous?.totalLiabilities, latest?.totalLiabilities),
    debtRatio,
    debtRatioDelta: pointDelta(previousDebtRatio, debtRatio),
    currentRatio,
    interestCoverage: firstFinite(latest?.interestCoverage, ratio(latest?.operatingIncome, interestExpense)),
    netDebt: firstFinite(latest?.netDebt, subtract(latest?.totalDebt, latest?.cashAndCashEquivalents))
  };
}

function earningsComparisons(facts: ReadingFacts): CompanyJournalReadingTarget[] {
  return compactTargets([
    comparisonTarget("EPS", "valuation", "eps", facts),
    comparisonTarget("영업이익률", "profitability", "operating-margin", facts),
    comparisonTarget("부채비율", "stability", "debt-ratio", facts)
  ]).slice(0, 3);
}

function comparisonTarget(
  label: string,
  view: CompanyJournalReadingView,
  metric: string,
  facts: ReadingFacts
): CompanyJournalReadingTarget | null {
  if (
    facts.latestYear == null
    || facts.previousYear == null
    || facts.latestYear === facts.previousYear
    || !supportsComparisonSurface(facts.latest, view)
    || !supportsComparisonSurface(facts.previous, view)
    || !hasComparisonMetric(facts.latest, metric)
    || !hasComparisonMetric(facts.previous, metric)
  ) return null;
  return {
    label: `${facts.latestYear}년 ${label} ↔ ${facts.previousYear}년 ${label}`,
    view,
    metric,
    years: [facts.latestYear, facts.previousYear]
  };
}

function supportsComparisonSurface(point: FinancialChartPoint | undefined, view: CompanyJournalReadingView): boolean {
  if (!point) return false;
  if (view === "profitability") {
    return isFiniteNumber(point.revenue) && (point.revenue as number) > 0 && isFiniteNumber(point.netIncome);
  }
  if (view === "stability") {
    const totalLiabilities = firstFinite(
      point.totalLiabilities,
      isFiniteNumber(point.totalAssets) && isFiniteNumber(point.totalEquity)
        ? (point.totalAssets as number) - (point.totalEquity as number)
        : null
    );
    return isFiniteNumber(point.totalEquity) && point.totalEquity !== 0 && totalLiabilities != null;
  }
  return true;
}

function hasComparisonMetric(point: FinancialChartPoint | undefined, metric: string): boolean {
  if (!point) return false;
  const interestExpense = point.interestExpense == null ? null : Math.abs(point.interestExpense);
  const metricValue = new Map<string, number | null>([
    ["eps", firstFinite(point.eps, ratio(point.netIncome, point.sharesOutstanding))],
    ["bps", ratio(point.totalEquity, point.sharesOutstanding)],
    ["sps", ratio(point.revenue, point.sharesOutstanding)],
    ["cps", ratio(point.operatingCashFlow, point.sharesOutstanding)],
    ["revenue", firstFinite(point.revenue)],
    ["operating-margin", ratio(point.operatingIncome, point.revenue)],
    ["net-margin", ratio(point.netIncome, point.revenue)],
    ["debt-ratio", firstFinite(point.debtRatio, ratio(point.totalLiabilities, point.totalEquity))],
    ["current-ratio", firstFinite(point.currentRatio, ratio(point.currentAssets, point.currentLiabilities))],
    ["interest-coverage", firstFinite(point.interestCoverage, ratio(point.operatingIncome, interestExpense))]
  ]).get(metric);
  return metricValue != null;
}

function target(
  label: string,
  view: CompanyJournalReadingView,
  metric: string,
  years: number[],
  available: number | null
): CompanyJournalReadingTarget | null {
  return available == null ? null : { label, view, metric, years };
}

function section(
  id: string,
  kind: CompanyJournalReadingSection["kind"],
  title: string,
  summary: string,
  detail: string,
  tone: CompanyJournalReadingSection["tone"],
  links: CompanyJournalReadingTarget[],
  missingNote?: string
): CompanyJournalReadingSection {
  return { id, kind, title, summary, detail: clampSentences(detail, 3), tone, links: links.slice(0, kind === "comparison" ? 3 : 6), missingNote };
}

function selectedFinancialPair(evidence: CompanyJournalEvidence) {
  const selectedIndex = evidence.selectedFinancialPeriod
    ? evidence.financialSeries.findIndex((point) => (point.periodEndDate || point.period) === evidence.selectedFinancialPeriod)
    : -1;
  const latestIndex = selectedIndex >= 0 ? selectedIndex : evidence.financialSeries.length - 1;
  const comparisonOffset = evidence.financialPeriodMode === "quarterly" ? 4 : 1;
  return {
    latest: evidence.financialSeries[latestIndex],
    previous: evidence.financialSeries[latestIndex - comparisonOffset] ?? evidence.financialSeries[latestIndex - 1]
  };
}

function signalFor(diagnosis: CompanyJournalDiagnosis, view: CompanyJournalReadingView) {
  return diagnosis.signals.find((signal) => signal.view === view);
}

function toneForDiagnosis(tone: CompanyJournalSignalTone): CompanyJournalReadingSection["tone"] {
  return tone === "positive" ? "positive" : tone === "caution" || tone === "negative" ? "caution" : "neutral";
}

function toneForSignal(tone: CompanyJournalSignalTone | undefined): CompanyJournalReadingSection["tone"] {
  return tone == null ? "neutral" : toneForDiagnosis(tone);
}

function compactTargets(values: Array<CompanyJournalReadingTarget | null>): CompanyJournalReadingTarget[] {
  return values.filter((value): value is CompanyJournalReadingTarget => value != null);
}

function missingFactsNote(facts: ReadingFacts): string | undefined {
  const missing: string[] = [];
  if (facts.fcfMargin == null) missing.push("현금흐름");
  if (facts.netDebt == null) missing.push("순부채");
  if (facts.interestCoverage == null) missing.push("이자보상배율");
  return missing.length > 0 ? `${missing.slice(0, 2).join("·")} 자료는 아직 반영되지 않았습니다.` : undefined;
}

function financialYear(point: FinancialChartPoint | undefined): number | null {
  const value = point?.periodEndDate || point?.period || "";
  const match = value.match(/(?:FY\s*)?(20\d{2})/i);
  return match ? Number(match[1]) : null;
}

function changeDirection(value: number | null) {
  return value == null ? "자료가 부족" : value > 0 ? "증가" : value < 0 ? "감소" : "유지";
}

function positiveChange(value: number | null) {
  return value != null && value > 0;
}

function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  return isFiniteNumber(numerator) && isFiniteNumber(denominator) && denominator !== 0 ? numerator / denominator : null;
}

function changePercent(previous: number | null | undefined, current: number | null | undefined): number | null {
  return isFiniteNumber(previous) && isFiniteNumber(current) && previous !== 0
    ? ((current - previous) / Math.abs(previous)) * 100
    : null;
}

function pointDelta(previous: number | null, current: number | null): number | null {
  return previous == null || current == null ? null : (current - previous) * 100;
}

function multiply(value: number | null | undefined, multiplier: number): number | null {
  return isFiniteNumber(value) ? value * multiplier : null;
}

function subtract(left: number | null | undefined, right: number | null | undefined): number | null {
  return isFiniteNumber(left) && isFiniteNumber(right) ? left - right : null;
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  return values.find(isFiniteNumber) ?? null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatChange(value: number | null) {
  return value == null ? "자료 부족" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPointChange(value: number | null) {
  return value == null ? "자료 부족" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function formatPercent(value: number | null) {
  return value == null ? "자료 부족" : `${(value * 100).toFixed(1)}%`;
}

function formatMultiple(value: number | null) {
  return value == null ? "자료 부족" : `${value.toFixed(1)}배`;
}

function formatMoney(value: number | null) {
  if (value == null) return "자료 부족";
  return formatKoreanCompactUsd(value, { invalidValue: "자료 부족" });
}

function clampSentences(value: string, limit: number) {
  const sentences = value.replace(/([.!?])\s+/g, "$1\n").split("\n").map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.slice(0, limit).join(" ") || value;
}
