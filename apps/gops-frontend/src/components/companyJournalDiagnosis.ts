import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { formatKoreanCompactUsd } from "../currencyFormat";
import type { CompanyJournalEvidence, FinancialChartPoint } from "./CompanyJournalSummaryPanel";

export type CompanyJournalDiagnosisView = "earnings" | "valuation" | "profitability" | "stability";
export type CompanyJournalSignalTone = "positive" | "appropriate" | "caution" | "negative" | "insufficient";

export type CompanyJournalSignal = {
  view: CompanyJournalDiagnosisView;
  label: string;
  tone: CompanyJournalSignalTone;
  statusLabel: string;
  result: string;
  metrics: string[];
};

export type CompanyJournalDiagnosis = {
  tone: CompanyJournalSignalTone;
  statusLabel: string;
  summary: string;
  signals: CompanyJournalSignal[];
};

const statusLabels: Record<CompanyJournalSignalTone, string> = {
  positive: "긍정",
  appropriate: "적정",
  caution: "주의",
  negative: "부정",
  insufficient: "데이터 부족"
};

export function buildCompanyJournalDiagnosis(
  item: Sp500UniverseItem | undefined,
  evidence: CompanyJournalEvidence
): CompanyJournalDiagnosis {
  const pair = selectedFinancialPair(evidence);
  const latest = pair.latest;
  const previous = pair.previous;
  const earnings = evidence.earningsSeries.at(-1);
  const earningsSignal = buildEarningsSignal(earnings);
  const profitabilitySignal = buildProfitabilitySignal(latest, previous, evidence.financialPeriodMode);
  const valuationSignal = buildValuationSignal(item, latest);
  const stabilitySignal = buildStabilitySignal(latest);
  const signals = [earningsSignal, valuationSignal, profitabilitySignal, stabilitySignal];
  const positiveLabels = signals.filter((signal) => signal.tone === "positive").map((signal) => signal.label);
  const riskLabels = signals.filter((signal) => signal.tone === "caution" || signal.tone === "negative").map((signal) => signal.label);
  const available = signals.filter((signal) => signal.tone !== "insufficient");
  const hasNegative = signals.some((signal) => signal.tone === "negative");
  const hasCaution = signals.some((signal) => signal.tone === "caution");
  const tone: CompanyJournalSignalTone = available.length === 0
    ? "insufficient"
    : hasNegative
      ? "negative"
      : hasCaution
        ? "caution"
        : positiveLabels.length >= 2
          ? "positive"
          : "appropriate";
  const statusLabel = available.length === 0
    ? "데이터 부족"
    : hasNegative
      ? "주의 필요"
      : hasCaution
        ? "선별 확인"
        : positiveLabels.length >= 2
          ? "긍정 우세"
          : "균형 확인";
  const summary = diagnosisSummary(positiveLabels, riskLabels, available.length);
  return { tone, statusLabel, summary, signals };
}

function buildEarningsSignal(earnings: CompanyJournalEvidence["earningsSeries"][number] | undefined): CompanyJournalSignal {
  const epsSurprise = changePercent(earnings?.estimatedEps, earnings?.actualEps);
  const revenueSurprise = changePercent(earnings?.estimatedRevenue, earnings?.actualRevenue);
  const values = [epsSurprise, revenueSurprise].filter(isFiniteNumber);
  if (values.length === 0) {
    return signal("earnings", "실적", "insufficient", "실제치와 예상치 비교 자료가 필요합니다.", []);
  }
  const score = values.reduce((total, value) => total + (value >= 2 ? 1 : value <= -2 ? -1 : 0), 0);
  const tone = score >= 2 ? "positive" : score <= -2 ? "negative" : score < 0 ? "caution" : "appropriate";
  const result = tone === "positive"
    ? "매출과 EPS가 시장 기대를 함께 웃돕니다."
    : tone === "negative"
      ? "매출과 EPS가 시장 기대에 함께 못 미칩니다."
      : tone === "caution"
        ? "실적 지표 일부가 시장 기대에 못 미칩니다."
        : "실제 실적이 시장 기대와 비슷한 범위입니다.";
  return signal("earnings", "실적", tone, result, [
    epsSurprise == null ? null : `EPS ${formatChange(epsSurprise)}`,
    revenueSurprise == null ? null : `매출 ${formatChange(revenueSurprise)}`
  ]);
}

function buildProfitabilitySignal(
  latest: FinancialChartPoint | undefined,
  previous: FinancialChartPoint | undefined,
  mode: CompanyJournalEvidence["financialPeriodMode"]
): CompanyJournalSignal {
  const revenueGrowth = changePercent(previous?.revenue, latest?.revenue);
  const operatingMargin = ratio(latest?.operatingIncome, latest?.revenue);
  const previousOperatingMargin = ratio(previous?.operatingIncome, previous?.revenue);
  const netMargin = ratio(latest?.netIncome, latest?.revenue);
  const previousNetMargin = ratio(previous?.netIncome, previous?.revenue);
  const operatingDelta = pointDelta(previousOperatingMargin, operatingMargin);
  const netDelta = pointDelta(previousNetMargin, netMargin);
  const multiplier = mode === "quarterly" ? 4 : 1;
  const roe = ratio(multiply(latest?.netIncome, multiplier), latest?.totalEquity);
  const roa = ratio(multiply(latest?.netIncome, multiplier), latest?.totalAssets);
  const comparable = [revenueGrowth, operatingDelta, netDelta].filter(isFiniteNumber);
  if (comparable.length < 2) {
    return signal("profitability", "매출·수익", "insufficient", "매출과 이익률 비교 자료가 필요합니다.", compact([
      revenueGrowth == null ? null : `매출 ${formatChange(revenueGrowth)}`,
      netMargin == null ? null : `순이익률 ${formatPercent(netMargin)}`
    ]));
  }
  const score = (revenueGrowth == null ? 0 : revenueGrowth >= 5 ? 1 : revenueGrowth < 0 ? -1 : 0)
    + (operatingDelta == null ? 0 : operatingDelta >= 1 ? 1 : operatingDelta <= -1 ? -1 : 0)
    + (netDelta == null ? 0 : netDelta >= 1 ? 1 : netDelta <= -1 ? -1 : 0);
  const tone = score >= 2 ? "positive" : score <= -2 ? "negative" : score < 0 ? "caution" : "appropriate";
  const result = tone === "positive"
    ? "외형 성장과 이익률 개선이 함께 나타납니다."
    : tone === "negative"
      ? "매출과 이익률이 함께 약해지고 있습니다."
      : tone === "caution"
        ? "매출 흐름과 이익률 방향이 엇갈립니다."
        : "성장과 수익성이 현재 범위를 유지하고 있습니다.";
  return signal("profitability", "매출·수익", tone, result, [
    revenueGrowth == null ? null : `매출 ${formatChange(revenueGrowth)}`,
    operatingMargin == null ? null : `영업이익률 ${formatPercent(operatingMargin)}`,
    netMargin == null ? null : `순이익률 ${formatPercent(netMargin)}`,
    roe == null ? null : `ROE ${formatPercent(roe)}`,
    roa == null ? null : `ROA ${formatPercent(roa)}`
  ]);
}

function buildValuationSignal(
  item: Sp500UniverseItem | undefined,
  latest: FinancialChartPoint | undefined
): CompanyJournalSignal {
  const price = firstFinite(item?.lastPrice, item?.layoutPrice);
  const marketCap = firstFinite(item?.marketCap, item?.layoutMarketCap);
  const eps = firstFinite(item?.eps, latest?.eps);
  const equity = firstFinite(item?.totalEquity, latest?.totalEquity);
  const revenue = firstFinite(item?.revenue, latest?.revenue);
  const freeCashFlow = firstFinite(item?.freeCashFlow, latest?.freeCashFlow);
  const per = ratio(price, eps);
  const pbr = ratio(marketCap, equity);
  const psr = ratio(marketCap, revenue);
  const fcfYield = ratio(freeCashFlow, marketCap);
  const values = [per, pbr, psr, fcfYield].filter(isFiniteNumber);
  if (values.length < 2) {
    return signal("valuation", "가치", "insufficient", "가격과 재무를 연결할 자료가 필요합니다.", []);
  }
  const negative = (per != null && per < 0) || (fcfYield != null && fcfYield < 0);
  const caution = (per != null && per > 40)
    || (pbr != null && pbr > 10)
    || (psr != null && psr > 10)
    || (fcfYield != null && fcfYield < 0.02);
  const tone: CompanyJournalSignalTone = negative ? "negative" : caution ? "caution" : "appropriate";
  const result = tone === "negative"
    ? "현재 이익·현금흐름 기준 가치 부담이 큽니다."
    : tone === "caution"
      ? "성장 기대가 현재 가격에 많이 반영돼 있습니다."
      : "현재 실적과 가치 배수가 비교 가능한 범위입니다.";
  return signal("valuation", "가치", tone, result, [
    per == null ? null : `PER ${formatMultiple(per)}`,
    pbr == null ? null : `PBR ${formatMultiple(pbr)}`,
    psr == null ? null : `PSR ${formatMultiple(psr)}`,
    fcfYield == null ? null : `FCF Yield ${formatPercent(fcfYield)}`
  ]);
}

function buildStabilitySignal(latest: FinancialChartPoint | undefined): CompanyJournalSignal {
  const debtRatio = firstFinite(latest?.debtRatio, ratio(latest?.totalLiabilities, latest?.totalEquity));
  const currentRatio = firstFinite(latest?.currentRatio, ratio(latest?.currentAssets, latest?.currentLiabilities));
  const interestExpense = latest?.interestExpense == null ? null : Math.abs(latest.interestExpense);
  const interestCoverage = firstFinite(latest?.interestCoverage, ratio(latest?.operatingIncome, interestExpense));
  const netDebt = firstFinite(latest?.netDebt, subtract(latest?.totalDebt, latest?.cashAndCashEquivalents));
  const values = [debtRatio, currentRatio, interestCoverage, netDebt].filter(isFiniteNumber);
  if (values.length < 2) {
    return signal("stability", "안정성", "insufficient", "부채와 유동성 판단 자료가 필요합니다.", []);
  }
  const negative = (debtRatio != null && debtRatio > 2.5)
    || (currentRatio != null && currentRatio < 0.8)
    || (interestCoverage != null && interestCoverage < 1);
  const caution = (debtRatio != null && debtRatio > 1.5)
    || (currentRatio != null && currentRatio < 1)
    || (interestCoverage != null && interestCoverage < 2)
    || (netDebt != null && latest?.totalEquity != null && netDebt > latest.totalEquity * 0.5);
  const strongCount = [
    debtRatio != null && debtRatio <= 1,
    currentRatio != null && currentRatio >= 1.5,
    interestCoverage != null && interestCoverage >= 5,
    netDebt != null && netDebt <= 0
  ].filter(Boolean).length;
  const tone: CompanyJournalSignalTone = negative ? "negative" : caution ? "caution" : strongCount >= 2 ? "positive" : "appropriate";
  const result = tone === "negative"
    ? "부채 상환력이나 단기 유동성을 우선 점검해야 합니다."
    : tone === "caution"
      ? "재무 완충력 일부가 약해지는 구간입니다."
      : tone === "positive"
        ? "부채 부담과 단기 지급 능력이 안정적인 편입니다."
        : "현재 자본·부채 구조는 적정 범위입니다.";
  return signal("stability", "안정성", tone, result, [
    debtRatio == null ? null : `부채비율 ${formatPercent(debtRatio)}`,
    currentRatio == null ? null : `유동비율 ${formatPercent(currentRatio)}`,
    interestCoverage == null ? null : `이자보상배율 ${formatMultiple(interestCoverage)}`,
    netDebt == null ? null : `순부채 ${formatMoney(netDebt)}`
  ]);
}

function diagnosisSummary(positiveLabels: string[], riskLabels: string[], availableCount: number): string {
  if (availableCount === 0) return "검증된 재무 자료가 연결되면 기업의 강점과 주의 신호를 함께 보여드립니다.";
  if (positiveLabels.length > 0 && riskLabels.length > 0) {
    return `${positiveLabels.join("·")}은 긍정적이지만 ${riskLabels.join("·")}는 추가 확인이 필요합니다.`;
  }
  if (riskLabels.length > 0) return `${riskLabels.join("·")}에서 주의 신호가 확인됩니다. 세부 근거를 먼저 확인해 주세요.`;
  if (positiveLabels.length > 0) return `${positiveLabels.join("·")}에서 긍정 신호가 우세하며 나머지 영역은 적정 범위입니다.`;
  return "실적·가치·수익성·안정성이 현재 비교 기준에서 대체로 균형을 이루고 있습니다.";
}

function signal(
  view: CompanyJournalDiagnosisView,
  label: string,
  tone: CompanyJournalSignalTone,
  result: string,
  metrics: Array<string | null>
): CompanyJournalSignal {
  return { view, label, tone, statusLabel: statusLabels[tone], result, metrics: compact(metrics) };
}

function selectedFinancialPair(evidence: CompanyJournalEvidence) {
  const selectedIndex = evidence.selectedFinancialPeriod
    ? evidence.financialSeries.findIndex((point) => (point.periodEndDate || point.period) === evidence.selectedFinancialPeriod)
    : -1;
  const index = selectedIndex >= 0 ? selectedIndex : evidence.financialSeries.length - 1;
  const comparisonOffset = evidence.financialPeriodMode === "quarterly" ? 4 : 1;
  return {
    latest: evidence.financialSeries[index],
    previous: evidence.financialSeries[index - comparisonOffset] ?? evidence.financialSeries[index - 1]
  };
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

function compact(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function formatChange(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMultiple(value: number): string {
  return `${value.toFixed(1)}배`;
}

function formatMoney(value: number): string {
  return formatKoreanCompactUsd(value);
}
