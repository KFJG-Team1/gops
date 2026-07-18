import type { ChartPoint, CoachReport, DailyTradeReview, HabitLongTermProfile, HabitReport, InsightStage, MissedCheck, TradeCase } from "./types";

const asOf = "2026-07-17T21:00:00Z";
type ReviewBundle = Omit<DailyTradeReview, "selectedFillId" | "trades" | "reviewsByFillId">;

function fixedSeries(seed: number, through = 20, base = 190): ChartPoint[] {
  return Array.from({ length: through + 61 }, (_, index) => {
    const relativeDay = index - 60;
    const trend = relativeDay * .16;
    const wave = Math.sin((index + seed) / 5) * 2.4 + Math.cos((index + seed) / 11) * 1.1;
    const close = base + seed * 1.3 + trend + wave;
    const open = close - Math.sin((index + seed) / 3) * 1.2;
    const macd = Math.sin((index + seed) / 8) * 1.6 + relativeDay * .008;
    return { relativeDay, time: new Date(Date.parse("2026-07-17T00:00:00Z") + relativeDay * 86400000).toISOString(), open, high: Math.max(open, close) + 1.4, low: Math.min(open, close) - 1.2, close, volume: 24_000_000 + ((index * 7919 + seed * 113) % 18_000_000), relativeVolume: .7 + ((index + seed) % 9) / 10, rsi: Math.max(25, Math.min(78, 52 + Math.sin((index + seed) / 7) * 18 + relativeDay * .12)), macd, signal: macd * .72 + Math.cos(index / 9) * .2, histogram: macd * .28 };
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
  const isTechnologyAdd = symbol === "AAPL";
  const isTrim = side === "sell";
  const portfolioImpact = symbol === "AAPL"
    ? { symbolWeightBefore: 0, symbolWeightAfter: 4.09, sectorWeightBefore: 19.34, sectorWeightAfter: 23.44, cashWeightBefore: 12.0, cashWeightAfter: 8.0, topHoldingsConcentrationBefore: 41.95, topHoldingsConcentrationAfter: 41.95, riskFlags: ["정보기술 비중 23.4%", "단일 종목 비중은 5% 미만", "현금 비중 8.0% 유지"] }
    : symbol === "AMZN"
      ? { symbolWeightBefore: 4.29, symbolWeightAfter: 3.21, sectorWeightBefore: 12.86, sectorWeightAfter: 11.79, cashWeightBefore: 6.87, cashWeightAfter: 8.0, topHoldingsConcentrationBefore: 41.95, topHoldingsConcentrationAfter: 41.95, riskFlags: ["AMZN 비중 1.1%p 축소", "현금 완충력 개선", "임의소비재 비중 11.8%"] }
      : { symbolWeightBefore: 0, symbolWeightAfter: 4.98, sectorWeightBefore: 11.48, sectorWeightAfter: 16.46, cashWeightBefore: 12.86, cashWeightAfter: 8.0, topHoldingsConcentrationBefore: 41.95, topHoldingsConcentrationAfter: 41.95, riskFlags: ["필수소비재 비중 16.5%", "WMT 단일 비중 5.0%", "7개 섹터 분산 유지"] };
  return {
    decisionAssessment: { grade: isTechnologyAdd ? "attention" : "good", summary: isTechnologyAdd ? "AAPL 편입으로 종목 수는 늘었지만 정보기술 비중이 23.4%로 가장 커져 추가 매수 전 상한 확인이 필요합니다." : isTrim ? "AMZN 일부 매도로 수익을 확정하고 임의소비재 비중과 현금 여력을 함께 조정했습니다." : "WMT 편입으로 필수소비재 내 종목 분산을 넓히면서 7개 섹터 구성을 유지했습니다.", processAssessment: isTechnologyAdd ? "단일 종목 비중은 4.1%로 낮지만 MSFT와 합산한 섹터 노출을 함께 봐야 합니다." : "체결 뒤에도 단일 종목과 섹터 비중이 설정한 범위 안에 있습니다.", outcomeAssessment: `${returnPercent > 0 ? "+" : ""}${returnPercent.toFixed(2)}%`, evidence: isTechnologyAdd ? ["AAPL 4.1%", "정보기술 23.4%", "현금 8.0%"] : isTrim ? ["AMZN 4.3% → 3.2%", "현금 6.9% → 8.0%", "실현손익 +$50"] : ["WMT 5.0%", "필수소비재 16.5%", "7개 섹터"], sourceAsOf: { indicators: asOf, portfolio: asOf } },
    currentCase: { caseId: `${symbol}-fixture-current`, tradeDate: symbol === "WMT" ? "2026-06-16T19:30:00Z" : symbol === "AMZN" ? "2026-06-15T19:30:00Z" : "2026-06-12T19:30:00Z", symbol, side, entryPrice: entry, returnPercent, mfePercent: 2.7, maePercent: -1.1, holdingDuration: symbol === "WMT" ? "31일" : symbol === "AMZN" ? "부분 청산" : "35일", series: fixedSeries(isTechnologyAdd ? 1 : 7, 0, base), missedChecks: isTechnologyAdd ? checks.slice(0, 2) : checks.slice(2, 3) },
    similarCases: Array.from({ length: 6 }, (_, index) => similar(index + 1, symbol, base)),
    checklist: {
      chart: isTechnologyAdd ? [{ status: "unchecked", label: "섹터 합산 비중", evidence: "정보기술 23.4%", source: "portfolio snapshot", sourceAsOf: asOf }, { status: "checked", label: "단일 종목 상한", evidence: "AAPL 4.1%", source: "portfolio snapshot", sourceAsOf: asOf }] : [{ status: "checked", label: isTrim ? "분할 매도 가격" : "지정가 매수 가격", evidence: isTrim ? "$238 체결" : "$102 체결", source: "paper ledger", sourceAsOf: asOf }],
      news: [{ status: "checked", label: "기업 뉴스", evidence: "신제품 발표 기사 확인", source: "news cache", sourceAsOf: asOf }],
      fundamentals: [{ status: "checked", label: "실적 일정", evidence: "다음 발표 전 비중 재검토", source: "earnings calendar", sourceAsOf: asOf }],
      market: [{ status: "checked", label: "포트폴리오 비중", evidence: `${symbol} ${portfolioImpact.symbolWeightAfter}% · 현금 8.0%`, source: "portfolio snapshot", sourceAsOf: asOf }]
    },
    portfolioImpact,
    watchConditions: [
      { id: `${symbol}-close-stop`, type: "price", label: `$${base.toFixed(2)} 아래 일봉 마감`, currentValue: entry + 3.9, threshold: base, operator: "<", reason: "진입 근거가 훼손되는 검증 가격입니다.", recommendedAction: "보유 근거 재검토", alertSupported: true, alertRequest: { symbol, type: "price_cross", targetPrice: base.toFixed(2), repeatLimit: 1 } },
      { id: `${symbol}-target-zone`, type: "price", label: `다음 저항 $${(base + 13).toFixed(0)} 접근`, currentValue: entry + 3.9, threshold: base + 13, operator: ">=", reason: "최근 20개 일봉의 저항 가격입니다.", recommendedAction: "분할 청산 검토", alertSupported: true, alertRequest: { symbol, type: "price_cross", targetPrice: (base + 13).toFixed(2), repeatLimit: 1 } },
      { id: `${symbol}-relative-volume`, type: "volume", label: "상대 거래량 1.2 회복", currentValue: .7, threshold: 1.2, operator: ">=", reason: "상승 지속 확인이 필요합니다.", recommendedAction: "추가 관찰", alertSupported: false },
      { id: `${symbol}-portfolio-weight`, type: "portfolio", label: "종목 비중 20% 상한", currentValue: portfolioImpact.symbolWeightAfter, threshold: 20, operator: ">=", reason: "단일 종목 집중 위험을 계좌 전체 기준으로 점검합니다.", recommendedAction: "추가 매수 전 비중 재검토", alertSupported: false }
    ],
    proposedAlerts: [], confidence: { level: "medium", reason: "과거 유사 사례 6건" }
  };
}

function longTermProfile(stage: InsightStage, period: "6m", sampleSize: number): HabitLongTermProfile {
  const scale = .88;
  if (stage === "portfolio") {
    return {
      headline: `총자산 $105,023.52와 총손익 +$5,023.52를 기준으로 10종목이 7개 섹터에 분산되어 있고, 가장 큰 정보기술 비중도 23.4%로 관리 범위 안입니다.`,
      patterns: [{ id: `${period}-portfolio-concentration`, title: "정보기술 비중 점검", occurrenceCount: 4, occurrenceRatePercent: 24, description: "MSFT와 AAPL 합산 비중이 23.4%로 가장 크지만 다른 6개 섹터가 변동성을 분산하고 있습니다.", averageMaePercent: -1.4, confidence: "medium" }],
      marketDiversification: {
        availability: "ready", sourceAsOf: asOf, concentratedSector: "정보기술", concentratedWeightPercent: 23.44,
        sectorExposures: [
          { sector: "정보기술", weightPercent: 23.44, symbols: ["MSFT", "AAPL"], riskLevel: "attention" },
          { sector: "필수소비재", weightPercent: 16.46, symbols: ["COST", "WMT"], riskLevel: "normal" },
          { sector: "임의소비재", weightPercent: 11.79, symbols: ["HD", "AMZN"], riskLevel: "normal" },
          { sector: "금융", weightPercent: 11.13, symbols: ["JPM"], riskLevel: "normal" },
          { sector: "커뮤니케이션", weightPercent: 10.53, symbols: ["GOOGL"], riskLevel: "normal" },
          { sector: "에너지", weightPercent: 9.70, symbols: ["XOM"], riskLevel: "normal" },
          { sector: "헬스케어", weightPercent: 8.95, symbols: ["JNJ"], riskLevel: "normal" }
        ],
        holdingSensitivities: [
          { symbol: "MSFT", sector: "정보기술", weightPercent: 19.34, marketCorrelation: .82, sectorCorrelation: .88, independence: "low" },
          { symbol: "COST", sector: "필수소비재", weightPercent: 11.48, marketCorrelation: .46, sectorCorrelation: .61, independence: "high" },
          { symbol: "JPM", sector: "금융", weightPercent: 11.13, marketCorrelation: .58, sectorCorrelation: .73, independence: "high" }
        ],
        candidates: [
          { id: `${period}-utilities`, market: "미국 유틸리티", sector: "유틸리티", etfSymbol: "XLU", suggestedMinWeightPercent: 3, suggestedMaxWeightPercent: 6, correlationToConcentratedSector: .29, relativeStrengthPercent: 1.2, role: "defensive", reason: "현재 없는 방어 섹터로 정보기술과의 동행성이 낮은 분산 후보입니다.", sourceAsOf: asOf },
          { id: `${period}-real-estate`, market: "미국 리츠", sector: "부동산", etfSymbol: "XLRE", suggestedMinWeightPercent: 3, suggestedMaxWeightPercent: 5, correlationToConcentratedSector: .34, relativeStrengthPercent: .8, role: "diversification", reason: "현재 7개 섹터와 다른 금리 민감 노출을 소규모로 보완할 수 있습니다.", sourceAsOf: asOf }
        ]
      }
    };
  }
  const confirmed = Math.max(2, Math.round(sampleSize * scale));
  const missed = Math.max(1, Math.round(sampleSize * (1 - scale) * .7));
  const unconfirmed = sampleSize - confirmed;
  return {
    headline: stage === "entry"
      ? `최근 6개월 매수 ${sampleSize}건이 10종목·7섹터의 현재 포트폴리오를 만들었습니다.`
      : `최근 6개월 매도 ${sampleSize}건에서 이익 확정 3건과 손실 축소 1건이 기록됐습니다.`,
    decisionRecords: { recordedTradeCount: sampleSize, confirmedTradeCount: confirmed, unconfirmedTradeCount: unconfirmed, missedCheckTradeCount: missed },
    processOutcome: [
      { process: "confirmed", outcome: "positive", count: Math.max(1, Math.round(confirmed * .65)), averageReturnPercent: stage === "entry" ? 3.1 : 2.7, averageMaePercent: -1.3 },
      { process: "confirmed", outcome: "negative", count: Math.max(0, confirmed - Math.max(1, Math.round(confirmed * .65))), averageReturnPercent: -1.8, averageMaePercent: -2.2 },
      { process: "unconfirmed", outcome: "positive", count: unconfirmed ? Math.max(1, Math.round(unconfirmed * .45)) : 0, averageReturnPercent: 1.6, averageMaePercent: -2.9 },
      { process: "unconfirmed", outcome: "negative", count: unconfirmed ? Math.max(0, unconfirmed - Math.max(1, Math.round(unconfirmed * .45))) : 0, averageReturnPercent: -3.4, averageMaePercent: -4.1 }
    ],
    patterns: [
      stage === "entry"
        ? { id: `${period}-${stage}-confirmed-rsi-volume`, title: "RSI·거래량 확인 후 매수", occurrenceCount: confirmed, occurrenceRatePercent: Math.round(confirmed / sampleSize * 100), description: `${sampleSize}건 중 ${confirmed}건에서 RSI와 거래량 확인 기록이 남아 있습니다. 계속 가져가야 할 장점입니다.`, averageReturnPercent: 2.8, averageMaePercent: -1.4, confidence: sampleSize >= 15 ? "high" : "medium" }
        : { id: `${period}-${stage}-target-plan`, title: "목표가 확인 후 매도", occurrenceCount: confirmed, occurrenceRatePercent: Math.round(confirmed / sampleSize * 100), description: `${sampleSize}건 중 ${confirmed}건에서 목표가와 손절 기준을 확인한 뒤 매도했습니다. 계속 가져가야 할 장점입니다.`, averageReturnPercent: 2.1, averageMaePercent: -1.2, confidence: sampleSize >= 15 ? "high" : "medium" },
      stage === "entry"
        ? { id: `${period}-${stage}-volume`, title: "거래량 확인 누락", occurrenceCount: missed, occurrenceRatePercent: Math.round(missed / sampleSize * 100), description: `${sampleSize}건 중 ${missed}건에서 상대 거래량 확인이 미완료로 기록됐습니다.`, averageReturnPercent: -1.2, averageMaePercent: -3.8, confidence: sampleSize >= 15 ? "high" : "medium" }
        : { id: `${period}-${stage}-late-loss`, title: "손실 청산 지연", occurrenceCount: missed, occurrenceRatePercent: Math.round(missed / sampleSize * 100), description: `${sampleSize}건 중 ${missed}건에서 손실 포지션 청산이 계획보다 늦었습니다.`, averageReturnPercent: -2.4, averageMaePercent: -4.2, confidence: sampleSize >= 15 ? "high" : "medium" },
      stage === "entry"
        ? { id: `${period}-${stage}-symbol`, title: "대형주 분할 진입", occurrenceCount: 8, occurrenceRatePercent: Math.round(8 / sampleSize * 100), description: "GOOGL·MSFT·XOM은 한 번에 매수하지 않고 두 차례로 나눠 평균단가를 관리했습니다.", averageReturnPercent: 1.4, averageMaePercent: -2.5, confidence: sampleSize >= 12 ? "medium" : "low" }
        : { id: `${period}-${stage}-target`, title: "목표가 도달 후 보유 지속", occurrenceCount: Math.round(sampleSize * .38), occurrenceRatePercent: 38, description: "목표 구간에 도달한 뒤에도 청산 실행이 늦어진 사례가 반복됐습니다.", averageReturnPercent: .8, averageMaePercent: -1.9, confidence: sampleSize >= 15 ? "high" : "medium" }
    ],
    representativeTrades: [
      { caseId: `${period}-${stage}-googl`, symbol: "GOOGL", side: stage === "entry" ? "buy" : "sell", tradeDate: "2026-06-08T19:30:00Z", process: "confirmed", outcome: "positive", returnPercent: 6.4, maePercent: -1.8, reason: "추가 매수 뒤 목표 구간에서 12주 분할 매도" },
      { caseId: `${period}-${stage}-hd`, symbol: "HD", side: stage === "entry" ? "buy" : "sell", tradeDate: "2026-06-11T19:30:00Z", process: "confirmed", outcome: "negative", returnPercent: -3.6, maePercent: -4.2, reason: "손실 구간에서 6주 비중 축소" },
      { caseId: `${period}-${stage}-amzn`, symbol: "AMZN", side: stage === "entry" ? "buy" : "sell", tradeDate: "2026-06-15T19:30:00Z", process: "confirmed", outcome: "positive", returnPercent: 4.39, maePercent: -1.1, reason: "20주 매수 뒤 5주 분할 매도" }
    ]
  };
}

function habit(stage: InsightStage, period: "6m", sampleSize: number): HabitReport {
  const labels = { entry: "진입", exit: "청산", portfolio: "포트폴리오" };
  const scale = .88;
  return {
    stage, availability: "ready", periodLabel: "최근 6개월", sampleSize,
    totalTradeCount: sampleSize,
    analyzedTradeCount: sampleSize,
    excludedTradeCount: 0,
    excludedReasons: [],
    evidenceQuality: sampleSize >= 50 ? "high" : sampleSize >= 20 ? "medium" : "low",
    confidence: sampleSize >= 18 ? "high" : sampleSize >= 8 ? "medium" : "low",
    concentration: stage === "portfolio" ? "정보기술 23.4%" : "10종목·7섹터", regime: "완만한 상승 국면", missingData: [],
    summary: stage === "entry" ? "16건의 매수를 여러 섹터에 나눴고 최근 AAPL·JPM·WMT 소규모 리밸런싱으로 원금 변화를 제한했습니다." : stage === "exit" ? "7건의 매도 중 GOOGL·XOM·AMZN은 이익을 확정했고 최근 리밸런싱은 평균단가 부근에서 수량만 조정했습니다." : "최대 섹터 비중 23.4%, 최대 단일 종목 비중 19.3%로 분산 상태가 유지되고 있습니다.",
    behavior: [
      { label: `${labels[stage]} 계획 기록률`, value: { value: Math.round(scale * 100), unit: "%", availability: "ready", interpretation: "사전 기록이 있는 거래만 집계했습니다." } },
      { label: "평균 결과", value: { value: stage === "exit" ? 1.8 : 2.4, unit: "%", denominator: `${sampleSize}건`, availability: "ready" } },
      { label: "평균 MAE", value: { value: stage === "portfolio" ? -1.4 : -2.2, unit: "%", availability: "ready" } }
    ],
    planConsistency: { value: Math.round(scale * 92), unit: "%", availability: "ready", interpretation: "계획 기록과 실제 체결을 비교한 값입니다." }, longTermProfile: longTermProfile(stage, period, sampleSize),
    insights: [{ id: `${period}-${stage}-insight`, stage, kind: stage === "exit" ? "effective_candidate" : "improvement_candidate", title: stage === "entry" ? "주문 전 현금 여력 확인" : stage === "exit" ? "수익 구간 분할 매도 유지" : "MSFT 단일 비중 상한", condition: stage === "entry" ? "미체결 매수 예약 후 주문 가능 현금 $6,223" : stage === "exit" ? "목표 구간에서 일부 수량만 매도" : "단일 종목 비중 20% 접근", observedBehavior: stage === "entry" ? "AAPL·WMT 매수 주문으로 $2,178이 예약되어 추가 주문 여력이 줄었습니다." : stage === "exit" ? "GOOGL·XOM·AMZN에서 일부 수량만 매도해 상승 참여와 이익 확정을 병행했습니다." : "MSFT가 19.3%로 단일 종목 상한 20%에 가장 가깝습니다.", sampleSize, confidence: sampleSize >= 12 ? "medium" : "low", metrics: { avgReturn: stage === "exit" ? 2.2 : 1.2, avgMfe: 4.8, avgMae: -2.1, planAdherenceRate: Math.round(scale * 92) }, recurrenceScore: 72, impactScore: 76, controllabilityScore: 90, priorityScore: 80, nextAction: stage === "entry" ? "신규 주문 전 예약 현금과 5% 현금 버퍼 확인" : stage === "exit" ? "목표가 도달 시 분할 청산 원칙 유지" : "MSFT 추가 매수 전 20% 상한 확인", candidateGuardrailId: `${stage}-guardrail` }]
  };
}

const wmtReview = review("WMT", 102, "buy", 2.45);
const amznReview = review("AMZN", 238, "sell", 4.39);
const aaplReview = review("AAPL", 210, "buy", 2.38);
const periods = {
  "6m": { entry: habit("entry", "6m", 16), exit: habit("exit", "6m", 7), portfolio: habit("portfolio", "6m", 23) }
};
const priorityEntry = {
  ...periods["6m"].entry.insights[0],
  priority: "improve" as const,
  title: "예약 현금 확인 후 매수하기",
  condition: "AAPL·WMT 미체결 매수 예약금 $2,178",
  observedBehavior: "현금 $8,401 중 주문 가능 금액은 $6,223",
  nextAction: "다음 매수 전에 최소 5% 현금 버퍼 확인"
};
const priorityExit = {
  ...periods["6m"].exit.insights[0],
  priority: "reproduce" as const,
  title: "목표 가격에서 나눠 매도하기",
  condition: "미리 정한 목표 가격에 도달",
  observedBehavior: "4번의 매도 모두 보유 수량 일부만 축소",
  nextAction: "다음 5번 거래에서도 체크리스트로 확인"
};
const priorityPortfolio = {
  ...periods["6m"].portfolio.insights[0],
  priority: "observe" as const,
  title: "MSFT 20% 상한 확인",
  condition: "MSFT 비중 19.3% · 정보기술 비중 23.4%",
  observedBehavior: "10종목·7섹터 분산은 양호하지만 MSFT가 상한에 근접",
  nextAction: "MSFT 추가 매수 전 계좌 비중 재계산"
};
const experiments = [
  { id: "exp-cash-buffer", sourceStages: ["entry" as const, "portfolio" as const], title: "현금 5% 버퍼 유지", hypothesis: "미체결 예약을 포함해 현금 비중을 5% 이상 유지하면 급락 시 대응 여력을 확보할 수 있습니다.", sampleTarget: 5, appliedCount: 2, checklist: ["예약 현금 확인", "체결 후 현금 비중 확인"], successMetrics: ["현금 비중 5% 이상", "주문 가능 금액 부족 0건"], stopConditions: ["체결 후 현금 비중 5% 미만"], confidence: "medium" as const, status: "active" as const },
  { id: "exp-exit", sourceStages: ["exit" as const], title: "목표 가격에서 두 번 나눠 매도하기", hypothesis: "미리 정한 목표 가격에서 나눠 매도하면, 올랐던 수익을 다시 잃는 폭을 줄일 수 있습니다.", sampleTarget: 5, appliedCount: 1, checklist: ["목표 가격 기록", "각 매도 비율 기록"], successMetrics: ["최고 수익 대비 줄어든 수익 폭 감소"], stopConditions: ["너무 일찍 매도해 놓친 수익 증가"], confidence: "medium" as const, status: "candidate" as const }
];
const guardrails = [
  { id: "entry-guardrail", stage: "entry" as const, title: "현금 비중 5% 아래 매수 확인", description: "미체결 주문까지 반영한 체결 후 현금 비중이 5% 미만이면 주문 이유를 다시 확인합니다.", trigger: { conditions: [{ metric: "cashWeight", operator: "<", value: 5 }], matchMode: "all" as const }, severity: "warning" as const, intervention: "require_confirmation" as const, scope: "next_five_trades" as const, enabled: true },
  { id: "portfolio-guardrail", stage: "portfolio" as const, title: "단일 종목 20% 상한", description: "매수 후 한 종목의 계좌 비중이 20%를 넘으면 매수 계획을 다시 확인합니다.", trigger: { conditions: [{ metric: "symbolWeight", operator: ">", value: 20 }], matchMode: "all" as const }, severity: "risk" as const, intervention: "require_plan" as const, scope: "global" as const, enabled: true }
];

function dailyTradeAlertCandidates(symbol: string, bundle: ReviewBundle) {
  return bundle.watchConditions.map((item) => ({ id: item.id, symbol, title: item.label, detail: item.reason ?? undefined, currentValue: item.currentValue, threshold: item.threshold, operator: item.operator, recommendedAction: item.recommendedAction, alertSupported: item.alertSupported, enabled: false, proposalSource: "daily_trade" as const, alertRequest: item.alertRequest }));
}

export const AI_COACH_DEV_FIXTURE: CoachReport = {
  contractVersion: "coach-report.v2", analysisId: "diversified-us-v3-report", generatedAt: asOf,
  sourceAsOf: { fills: asOf, market: asOf, indicators: asOf, portfolio: asOf, news: asOf }, missingData: [], warnings: [],
  snapshotRef: "paper://diversified-us-v3/coach-input", snapshotDigest: "diversified-us-v3-portfolio",
  page1: {
    selectedFillId: "fixture-fill-wmt",
    trades: [
      { fillId: "fixture-fill-wmt", symbol: "WMT", companyName: "Walmart", side: "buy", filledAt: "2026-06-16T19:30:00Z", averageFillPrice: 102, quantity: 50, currentPrice: 104.5, currentReturnPercent: 2.45, weightBefore: 0, weightAfter: 4.98, earningsAt: null, earningsDaysRemaining: null },
      { fillId: "fixture-fill-amzn", symbol: "AMZN", companyName: "Amazon", side: "sell", filledAt: "2026-06-15T19:30:00Z", averageFillPrice: 238, quantity: 5, currentPrice: 225, currentReturnPercent: 4.39, weightBefore: 4.29, weightAfter: 3.21, earningsAt: null, earningsDaysRemaining: null },
      { fillId: "fixture-fill-aapl", symbol: "AAPL", companyName: "Apple", side: "buy", filledAt: "2026-06-12T19:30:00Z", averageFillPrice: 210, quantity: 20, currentPrice: 215, currentReturnPercent: 2.38, weightBefore: 0, weightAfter: 4.09, earningsAt: null, earningsDaysRemaining: null }
    ],
    ...wmtReview,
    reviewsByFillId: { "fixture-fill-wmt": wmtReview, "fixture-fill-amzn": amznReview, "fixture-fill-aapl": aaplReview }
  },
  page2: { availability: "ready", defaultPeriod: "6m", reportsByPeriod: periods },
  page3: { availability: "ready", summary: "총자산 $105,023.52, 총손익 +$5,023.52의 10종목·7섹터 분산은 유지하되, 예약 주문을 반영한 현금 5% 버퍼와 MSFT 단일 비중 20% 상한을 다음 거래의 핵심 기준으로 둡니다.", priorities: [priorityEntry, priorityExit, priorityPortfolio], experiments, guardrails },
  page4: {
    availability: "ready", activeExperiments: experiments.filter((item) => item.status === "active"), enabledGuardrails: guardrails.filter((item) => item.enabled),
    recommendedAlerts: [
      ...dailyTradeAlertCandidates("WMT", wmtReview),
      ...dailyTradeAlertCandidates("AMZN", amznReview),
      ...dailyTradeAlertCandidates("AAPL", aaplReview),
      { id: `entry-habit-${priorityEntry.id}`, title: priorityEntry.title, detail: `${priorityEntry.condition} · ${priorityEntry.nextAction}`, enabled: false, proposalSource: "entry_habit" as const },
      { id: `exit-habit-${priorityExit.id}`, title: priorityExit.title, detail: `${priorityExit.condition} · ${priorityExit.nextAction}`, enabled: false, proposalSource: "exit_habit" as const },
      { id: `portfolio-risk-${priorityPortfolio.id}`, title: priorityPortfolio.title, detail: `${priorityPortfolio.condition} · ${priorityPortfolio.nextAction}`, enabled: false, proposalSource: "portfolio_risk" as const }
    ],
    watchingAlerts: [
      { id: "pending-aapl-198", symbol: "AAPL", title: "AAPL $198 매수 지정가", detail: "5주 매수 대기 · 예약금 $990", currentValue: 215, threshold: 198, operator: "<=", recommendedAction: "체결 후 정보기술 비중 확인", alertSupported: false, enabled: true, proposalSource: "daily_trade" },
      { id: "pending-jpm-340", symbol: "JPM", title: "JPM $340 매도 지정가", detail: "6주 매도 대기 · 보유수량 예약", currentValue: 216.44, threshold: 340, operator: ">=", recommendedAction: "체결 시 금융 비중 재계산", alertSupported: false, enabled: true, proposalSource: "daily_trade" },
      { id: "pending-wmt-99", symbol: "WMT", title: "WMT $99 매수 지정가", detail: "12주 매수 대기 · 예약금 $1,188", currentValue: 104.5, threshold: 99, operator: "<=", recommendedAction: "체결 후 현금 5% 버퍼 확인", alertSupported: false, enabled: true, proposalSource: "daily_trade" }
    ]
  }
};
