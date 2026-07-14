import type { ChartPoint, CoachReport, DailyTradeReview, HabitReport, InsightStage, MissedCheck, TradeCase } from "./types";

const asOf = "2026-07-10T20:00:00Z";
type ReviewBundle = Omit<DailyTradeReview, "selectedFillId" | "trades" | "reviewsByFillId">;

function fixedSeries(seed: number, through = 20, base = 190): ChartPoint[] {
  return Array.from({ length: through + 61 }, (_, index) => {
    const relativeDay = index - 60;
    const trend = relativeDay * .16;
    const wave = Math.sin((index + seed) / 5) * 2.4 + Math.cos((index + seed) / 11) * 1.1;
    const close = base + seed * 1.3 + trend + wave;
    const open = close - Math.sin((index + seed) / 3) * 1.2;
    const macd = Math.sin((index + seed) / 8) * 1.6 + relativeDay * .008;
    return { relativeDay, time: new Date(Date.parse("2026-07-10T00:00:00Z") + relativeDay * 86400000).toISOString(), open, high: Math.max(open, close) + 1.4, low: Math.min(open, close) - 1.2, close, volume: 24_000_000 + ((index * 7919 + seed * 113) % 18_000_000), relativeVolume: .7 + ((index + seed) % 9) / 10, rsi: Math.max(25, Math.min(78, 52 + Math.sin((index + seed) / 7) * 18 + relativeDay * .12)), macd, signal: macd * .72 + Math.cos(index / 9) * .2, histogram: macd * .28 };
  });
}

function missed(symbol: string): MissedCheck[] {
  return [
    { id: `${symbol}-rsi`, type: "rsi", label: "RSI 과열", relativeDay: -1, value: 72, threshold: 70, reason: "과열 구간에서 추격 진입 위험을 확인해야 했습니다.", source: "ClickHouse daily indicators", sourceAsOf: asOf },
    { id: `${symbol}-macd`, type: "macd", label: "MACD 약화", relativeDay: 0, value: "히스토그램 둔화", threshold: "상승 모멘텀 유지", reason: "MACD와 시그널선 간격이 축소되고 있었습니다.", source: "indicator-v1", sourceAsOf: asOf },
    { id: `${symbol}-volume`, type: "volume", label: "상대 거래량 부족", relativeDay: 0, value: 0.7, threshold: 1.2, reason: "돌파를 확인할 거래량이 부족했습니다.", source: "market candle volume", sourceAsOf: asOf },
    { id: `${symbol}-resistance`, type: "price", label: "저항선 근접", relativeDay: 0, value: "1.2%", threshold: "3% 이상 여유", reason: "직전 고점 바로 아래에서 진입했습니다.", source: "chart geometry", sourceAsOf: asOf }
  ];
}

function similar(index: number, symbol: string, base: number): TradeCase {
  const entry = base + index * 1.4;
  const gain = index % 2 ? -3.5 : 2.6;
  return { caseId: `${symbol}-fixture-case-${index}`, tradeDate: `2026-0${Math.max(1, 7 - index)}-1${index}T14:00:00Z`, symbol, side: index === 5 ? "sell" : "buy", similarityScore: 91 - index * 4, similarityComponents: { directionScore: 1, marketRegimeScore: .84 - index * .03, indicatorScore: .9 - index * .02 }, entryPrice: entry, exitPrice: entry * (1 + gain / 100), returnPercent: gain, mfePercent: 5.2 + index * .3, maePercent: -2.1 - index * .4, holdingDuration: `${8 + index * 2}일`, series: fixedSeries(index + 2, 20, base), missedChecks: missed(symbol).slice(0, 1 + index % 4), mistakeSummary: "가격·모멘텀·이벤트를 하나의 진입 조건으로 묶지 않았습니다.", sameAsToday: "상승 추세 후반, RSI 과열, 실적 임박 구간입니다.", differentFromToday: index % 2 ? "당시는 시장 거래량이 더 약했습니다." : "당시는 현금 비중이 더 높았습니다." };
}

function review(symbol: string, base: number, side: "buy" | "sell", returnPercent: number): ReviewBundle {
  const checks = missed(symbol);
  const entry = base + 1.3;
  return {
    decisionAssessment: { grade: symbol === "NVDA" ? "attention" : "good", summary: symbol === "NVDA" ? "현재 수익은 발생했지만 RSI 과열과 MACD 약화, 실적 D-3을 함께 확인하지 않은 추격 매수였습니다." : "청산 계획을 확인하고 집중도를 낮춘 판단으로, 이후 반등 여부와 손익은 별도로 평가합니다.", processAssessment: symbol === "NVDA" ? "핵심 4개 축 중 차트·재무·시장 확인 기록이 부족합니다." : "사전 청산 가격과 포트폴리오 집중도를 확인했습니다.", outcomeAssessment: `${returnPercent > 0 ? "+" : ""}${returnPercent.toFixed(2)}%`, evidence: symbol === "NVDA" ? ["RSI 72", "상대 거래량 0.7", "실적 D-3"] : ["목표가 도달", "종목 비중 9% → 6%"], sourceAsOf: { indicators: asOf, earnings: asOf } },
    currentCase: { caseId: `${symbol}-fixture-current`, tradeDate: "2026-07-10T14:35:00Z", symbol, side, entryPrice: entry, returnPercent, mfePercent: 2.7, maePercent: -1.1, holdingDuration: "당일", series: fixedSeries(symbol === "NVDA" ? 1 : 7, 0, base), missedChecks: symbol === "NVDA" ? checks : checks.slice(2, 3) },
    similarCases: Array.from({ length: 6 }, (_, index) => similar(index + 1, symbol, base)),
    checklist: {
      chart: symbol === "NVDA" ? [{ status: "unchecked", label: "RSI 과열", evidence: "RSI 72", source: "indicator-v1", sourceAsOf: asOf }, { status: "unchecked", label: "MACD 약화", evidence: "히스토그램 감소", source: "indicator-v1", sourceAsOf: asOf }] : [{ status: "checked", label: "청산 가격", evidence: "$148 목표가 도달", source: "decision log", sourceAsOf: asOf }],
      news: [{ status: "checked", label: "기업 뉴스", evidence: "신제품 발표 기사 확인", source: "news cache", sourceAsOf: asOf }],
      fundamentals: symbol === "NVDA" ? [{ status: "unchecked", label: "실적 D-3", evidence: "2026-07-13 발표", source: "earnings calendar", sourceAsOf: asOf }] : [{ status: "checked", label: "실적 일정", evidence: "일정 확인", source: "earnings calendar", sourceAsOf: asOf }],
      market: symbol === "NVDA" ? [{ status: "unchecked", label: "반도체 상대 거래량", evidence: "0.7배", source: "market snapshot", sourceAsOf: asOf }] : [{ status: "checked", label: "섹터 비중", evidence: "청산 후 7%p 감소", source: "portfolio snapshot", sourceAsOf: asOf }]
    },
    portfolioImpact: symbol === "NVDA" ? { symbolWeightBefore: 12, symbolWeightAfter: 18, sectorWeightBefore: 54, sectorWeightAfter: 61, cashWeightBefore: 14, cashWeightAfter: 9, topHoldingsConcentrationBefore: 48, topHoldingsConcentrationAfter: 55, riskFlags: ["단일 종목 위험 증가", "섹터 집중도 상승", "현금 완충력 감소", "상위 종목 집중도 상승"] } : { symbolWeightBefore: 9, symbolWeightAfter: 6, sectorWeightBefore: 61, sectorWeightAfter: 54, cashWeightBefore: 9, cashWeightAfter: 12, topHoldingsConcentrationBefore: 55, topHoldingsConcentrationAfter: 51, riskFlags: ["단일 종목 위험 감소", "섹터 집중도 완화", "현금 완충력 증가", "상위 종목 집중도 완화"] },
    watchConditions: [
      { id: `${symbol}-close-stop`, type: "price", label: `$${base.toFixed(2)} 아래 일봉 마감`, currentValue: entry + 3.9, threshold: base, operator: "<", reason: "진입 근거가 훼손되는 검증 가격입니다.", recommendedAction: "보유 근거 재검토", alertSupported: true, alertRequest: { symbol, type: "price_cross", targetPrice: base.toFixed(2), repeatLimit: 1 } },
      { id: `${symbol}-target-zone`, type: "price", label: `다음 저항 $${(base + 13).toFixed(0)} 접근`, currentValue: entry + 3.9, threshold: base + 13, operator: ">=", reason: "최근 20개 일봉의 저항 가격입니다.", recommendedAction: "분할 청산 검토", alertSupported: true, alertRequest: { symbol, type: "price_cross", targetPrice: (base + 13).toFixed(2), repeatLimit: 1 } },
      { id: `${symbol}-relative-volume`, type: "volume", label: "상대 거래량 1.2 회복", currentValue: .7, threshold: 1.2, operator: ">=", reason: "상승 지속 확인이 필요합니다.", recommendedAction: "추가 관찰", alertSupported: false },
      { id: `${symbol}-earnings-review`, type: "event", label: "실적 전 비중 재검토", currentValue: "D-3", threshold: "D-1", operator: "<=", reason: "실적 변동성 전에 집중 위험을 점검합니다.", recommendedAction: "비중 재검토", alertSupported: false }
    ],
    proposedAlerts: [], confidence: { level: "medium", reason: "과거 유사 사례 6건" }
  };
}

function habit(stage: InsightStage, period: "30d" | "90d" | "1y", sampleSize: number): HabitReport {
  const labels = { entry: "진입", exit: "청산", portfolio: "포트폴리오" };
  const scale = period === "30d" ? .72 : period === "90d" ? .84 : .91;
  return {
    stage, availability: "ready", periodLabel: period === "30d" ? "최근 30일" : period === "90d" ? "최근 90일" : "최근 1년", sampleSize,
    confidence: sampleSize >= 18 ? "high" : sampleSize >= 8 ? "medium" : "low",
    concentration: stage === "portfolio" ? "반도체 58%" : "NVDA·AMD 46%", regime: "상승 국면 64%", missingData: [],
    summary: stage === "entry" ? "추세 확인은 일관됐지만 거래량이 약한 날의 추격 진입이 반복됐습니다." : stage === "exit" ? "계획한 가격 청산은 양호했으나 손실 포지션의 청산은 평균 2.1일 늦었습니다." : "상위 종목 집중도를 낮춘 거래의 낙폭 기여가 더 안정적이었습니다.",
    behavior: [
      { label: `${labels[stage]} 계획 기록률`, value: { value: Math.round(scale * 100), unit: "%", availability: "ready", interpretation: "사전 기록이 있는 거래만 집계했습니다." } },
      { label: "평균 결과", value: { value: stage === "exit" ? 1.8 : 2.4, unit: "%", denominator: `${sampleSize}건`, availability: "ready" } },
      { label: "평균 MAE", value: { value: stage === "portfolio" ? -1.4 : -2.2, unit: "%", availability: "ready" } }
    ],
    planConsistency: { value: Math.round(scale * 92), unit: "%", availability: "ready", interpretation: "계획 기록과 실제 체결을 비교한 값입니다." },
    insights: [{ id: `${period}-${stage}-insight`, stage, kind: stage === "exit" ? "effective_candidate" : "improvement_candidate", title: stage === "entry" ? "거래량 확인 뒤 진입" : stage === "exit" ? "목표가 분할 청산 재현" : "섹터 비중 상한 확인", condition: stage === "entry" ? "상대 거래량 1.2 미만" : stage === "exit" ? "사전 목표가 도달" : "섹터 비중 55% 초과", observedBehavior: `${sampleSize}건 중 ${Math.max(2, Math.round(sampleSize * .42))}건에서 반복`, sampleSize, confidence: sampleSize >= 18 ? "high" : "medium", metrics: { avgReturn: stage === "exit" ? 3.1 : 1.2, avgMfe: 4.8, avgMae: -2.1, planAdherenceRate: Math.round(scale * 92) }, recurrenceScore: 78, impactScore: 83, controllabilityScore: 90, priorityScore: 84, nextAction: "다음 5회 거래에서 체크리스트 적용", candidateGuardrailId: `${stage}-guardrail` }]
  };
}

const nvdaReview = review("NVDA", 190.8, "buy", 2.05);
const amdReview = review("AMD", 147.1, "sell", .74);
const periods = {
  "30d": { entry: habit("entry", "30d", 6), exit: habit("exit", "30d", 5), portfolio: habit("portfolio", "30d", 7) },
  "90d": { entry: habit("entry", "90d", 14), exit: habit("exit", "90d", 12), portfolio: habit("portfolio", "90d", 16) },
  "1y": { entry: habit("entry", "1y", 42), exit: habit("exit", "1y", 37), portfolio: habit("portfolio", "1y", 49) }
};
const priorityEntry = { ...periods["90d"].entry.insights[0], priority: "improve" as const };
const priorityExit = { ...periods["90d"].exit.insights[0], priority: "reproduce" as const };
const priorityPortfolio = { ...periods["90d"].portfolio.insights[0], priority: "improve" as const };
const experiments = [
  { id: "exp-volume", sourceStages: ["entry" as const], title: "거래량 확인 후 진입", hypothesis: "상대 거래량 1.2 이상에서만 진입하면 불리한 추격 매수를 줄일 수 있습니다.", sampleTarget: 5, appliedCount: 2, checklist: ["상대 거래량 확인", "RSI 70 미만"], successMetrics: ["평균 MAE 2% 이내", "계획 준수율 80% 이상"], stopConditions: ["표본 3건 연속 MAE 4% 초과"], confidence: "medium" as const, status: "active" as const },
  { id: "exp-exit", sourceStages: ["exit" as const], title: "목표가 2회 분할 청산", hypothesis: "사전 목표가에서 분할 청산하면 MFE 반납을 줄일 수 있습니다.", sampleTarget: 5, appliedCount: 1, checklist: ["목표가 기록", "청산 비율 기록"], successMetrics: ["MFE 반납률 감소"], stopConditions: ["기회비용 증가"], confidence: "medium" as const, status: "candidate" as const }
];
const guardrails = [
  { id: "entry-guardrail", stage: "entry" as const, title: "저거래량 진입 확인", description: "상대 거래량 1.2 미만이면 진입 근거 확인을 요청합니다.", trigger: { conditions: [{ metric: "relativeVolume", operator: "<", value: 1.2 }], matchMode: "all" as const }, severity: "warning" as const, intervention: "require_confirmation" as const, scope: "next_five_trades" as const, enabled: true },
  { id: "portfolio-guardrail", stage: "portfolio" as const, title: "섹터 집중도 확인", description: "거래 후 섹터 비중이 60%를 넘으면 비중 계획을 확인합니다.", trigger: { conditions: [{ metric: "sectorWeight", operator: ">", value: 60 }], matchMode: "all" as const }, severity: "risk" as const, intervention: "require_plan" as const, scope: "global" as const, enabled: false }
];

export const AI_COACH_DEV_FIXTURE: CoachReport = {
  contractVersion: "coach-report.v2", analysisId: "dev-fixture", generatedAt: asOf,
  sourceAsOf: { fills: asOf, market: asOf, indicators: asOf, portfolio: asOf, news: asOf }, missingData: [], warnings: [],
  snapshotRef: "s3://dev-fixture/coach-input.json", snapshotDigest: "dev-fixture-sha256",
  page1: {
    selectedFillId: "fixture-fill-nvda",
    trades: [
      { fillId: "fixture-fill-nvda", symbol: "NVDA", companyName: "NVIDIA", side: "buy", filledAt: "2026-07-10T14:35:00Z", averageFillPrice: 190.8, quantity: 12, currentPrice: 194.72, currentReturnPercent: 2.05, weightBefore: 12, weightAfter: 18, earningsAt: "2026-07-13T20:00:00Z", earningsDaysRemaining: 3 },
      { fillId: "fixture-fill-amd", symbol: "AMD", companyName: "Advanced Micro Devices", side: "sell", filledAt: "2026-07-10T16:05:00Z", averageFillPrice: 148.2, quantity: 5, currentPrice: 147.1, currentReturnPercent: .74, weightBefore: 9, weightAfter: 6, earningsAt: null, earningsDaysRemaining: null }
    ],
    ...nvdaReview,
    reviewsByFillId: { "fixture-fill-nvda": nvdaReview, "fixture-fill-amd": amdReview }
  },
  page2: { availability: "ready", defaultPeriod: "90d", reportsByPeriod: periods },
  page3: { availability: "ready", summary: "저거래량 추격 진입은 먼저 보완하고, 계획된 분할 청산은 다음 거래에서도 재현합니다.", priorities: [priorityEntry, priorityExit, priorityPortfolio], experiments, guardrails },
  page4: {
    availability: "ready", activeExperiments: experiments.filter((item) => item.status === "active"), enabledGuardrails: guardrails.filter((item) => item.enabled),
    recommendedAlerts: nvdaReview.watchConditions.filter((item) => item.alertRequest).map((item) => ({ id: item.id, title: item.label, detail: item.reason ?? undefined, enabled: false, alertRequest: item.alertRequest })),
    watchingAlerts: [{ id: "watching-203", title: "NVDA $203 상향 돌파", detail: "목표 구간 접근 알람 · 현재 활성", enabled: true, serverAlertId: 203 }]
  }
};
