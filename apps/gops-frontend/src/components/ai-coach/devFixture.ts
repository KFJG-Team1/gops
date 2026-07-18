import type { ChartPoint, CoachReport, DailyTradeReview, DecisionChecklist, HabitLongTermProfile, HabitReport, InsightStage, MissedCheck, TradeCase } from "./types";
import { replayChartSeries, type ReplayChartSymbol } from "./replayChartSeries";

const asOf = "2026-07-17T21:00:00Z";
type ReviewBundle = Omit<DailyTradeReview, "selectedFillId" | "trades" | "reviewsByFillId">;

function chartChecks(symbol: string, series: ChartPoint[]): MissedCheck[] {
  const entry = series.find((point) => point.relativeDay === 0) ?? series.at(-1);
  const priorHigh = Math.max(...series.filter((point) => point.relativeDay >= -20 && point.relativeDay < 0).map((point) => point.high).filter((value): value is number => typeof value === "number"));
  const resistanceGap = entry?.close && Number.isFinite(priorHigh) ? (priorHigh / entry.close - 1) * 100 : null;
  const sourceAsOf = entry?.time ?? asOf;
  return [
    { id: `${symbol}-rsi`, type: "rsi", label: "진입 RSI", relativeDay: 0, value: entry?.rsi ?? null, threshold: 70, reason: "진입일 종가 기준 RSI(14)로 과열 여부를 확인했습니다.", source: "일봉 차트", sourceAsOf },
    { id: `${symbol}-macd`, type: "macd", label: "진입 MACD", relativeDay: 0, value: entry?.macd ?? null, threshold: entry?.signal ?? null, reason: "진입일의 MACD와 시그널을 비교해 추세 힘을 확인했습니다.", source: "일봉 차트", sourceAsOf },
    { id: `${symbol}-volume`, type: "volume", label: "진입 상대 거래량", relativeDay: 0, value: entry?.relativeVolume ?? null, threshold: 1.2, reason: "진입일 거래량을 직전 20거래일 평균과 비교했습니다.", source: "일봉 차트", sourceAsOf },
    { id: `${symbol}-resistance`, type: "price", label: "직전 20일 고점 여유", relativeDay: 0, value: resistanceGap == null ? null : `${resistanceGap.toFixed(2)}%`, threshold: "3% 이상", reason: "진입가 위에 남은 직전 20일 고점까지의 여유를 확인했습니다.", source: "일봉 차트", sourceAsOf }
  ];
}

const similarDates = ["2026-05-18T20:00:00Z", "2026-04-20T20:00:00Z", "2026-03-23T20:00:00Z", "2026-02-23T20:00:00Z", "2026-01-26T20:00:00Z", "2025-12-22T20:00:00Z"];

function historicalChecklist(checks: MissedCheck[], missedType: MissedCheck["type"], symbol: ReplayChartSymbol): DecisionChecklist {
  const price = checks.find((item) => item.type === "price");
  const rsi = checks.find((item) => item.type === "rsi");
  const macd = checks.find((item) => item.type === "macd");
  const volume = checks.find((item) => item.type === "volume");
  const sourceAsOf = price?.sourceAsOf ?? rsi?.sourceAsOf ?? macd?.sourceAsOf ?? volume?.sourceAsOf ?? asOf;
  const source = "일봉 차트";
  const statusFor = (type: MissedCheck["type"]) => type === missedType ? "unchecked" as const : "checked" as const;
  const context = {
    WMT: { news: "동일점 매출 성장과 소비 둔화 위험을 함께 확인", earnings: "다음 실적 발표 전 비중 재점검 계획", market: "필수소비재 비중과 현금 여력 확인" },
    AMZN: { news: "클라우드 성장 기대와 소비 경기 부담을 함께 확인", earnings: "실적 발표 전후 변동성 확대 가능성 확인", market: "임의소비재 비중과 분할 매도 계획 확인" },
    AAPL: { news: "제품 수요와 공급망 관련 주요 기사 확인", earnings: "다음 실적일까지 보유 비중 유지 계획", market: "정보기술 합산 비중과 추가 매수 한도 확인" }
  }[symbol];
  return {
    chart: [
      { status: statusFor("price"), label: "가격 조건", evidence: `직전 20일 고점 여유 ${valueLabel(price?.value)} · 기준 ${valueLabel(price?.threshold)}`, source, sourceAsOf },
      { status: statusFor("rsi"), label: "모멘텀 조건", evidence: `RSI ${valueLabel(rsi?.value)} · MACD ${valueLabel(macd?.value)} / 시그널 ${valueLabel(macd?.threshold)}`, source, sourceAsOf },
      { status: statusFor("volume"), label: "거래량 조건", evidence: `상대 거래량 ${valueLabel(volume?.value)} · 기준 ${valueLabel(volume?.threshold)}`, source, sourceAsOf }
    ],
    news: [{ status: "checked", label: "기업 뉴스", evidence: context.news, source: "기업 뉴스", sourceAsOf }],
    fundamentals: [{ status: "checked", label: "실적 일정", evidence: context.earnings, source: "실적 일정", sourceAsOf }],
    market: [{ status: "checked", label: "시장·계좌 상황", evidence: context.market, source: "계좌 분석", sourceAsOf }]
  };
}

function valueLabel(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value == null || value === "" ? "계산되지 않음" : String(value);
}

function seriesStats(series: ChartPoint[], entryPrice: number) {
  const outcome = series.filter((point) => point.relativeDay >= 0);
  const lastClose = outcome.map((point) => point.close).filter((value): value is number => typeof value === "number").at(-1);
  const highs = outcome.map((point) => point.high).filter((value): value is number => typeof value === "number");
  const lows = outcome.map((point) => point.low).filter((value): value is number => typeof value === "number");
  return {
    exitPrice: lastClose ?? null,
    returnPercent: lastClose == null ? null : (lastClose / entryPrice - 1) * 100,
    mfePercent: highs.length ? (Math.max(...highs) / entryPrice - 1) * 100 : null,
    maePercent: lows.length ? (Math.min(...lows) / entryPrice - 1) * 100 : null,
    holdingDuration: `${Math.max(0, outcome.length - 1)}거래일`
  };
}

function similar(index: number, symbol: ReplayChartSymbol, base: number): TradeCase {
  const entry = base * (1 + index * .006);
  const tradeDate = similarDates[index - 1];
  const series = replayChartSeries(symbol, tradeDate, entry, 20);
  const checks = chartChecks(symbol, series);
  const stats = seriesStats(series, entry);
  const missedType: MissedCheck["type"] = index % 3 === 1 ? "volume" : index % 3 === 2 ? "rsi" : "price";
  const missedCheck = checks.find((item) => item.type === missedType);
  const mistakeSummary = missedType === "volume"
    ? `상대 거래량 ${valueLabel(missedCheck?.value)}에서 진입해 거래 참여가 살아나는지 한 번 더 기다릴 여지가 있었습니다.`
    : missedType === "rsi"
      ? `RSI ${valueLabel(missedCheck?.value)}에서 모멘텀 방향을 충분히 확인하지 않고 진입했습니다.`
      : `직전 20일 고점까지의 여유가 ${valueLabel(missedCheck?.value)}인 구간에서 가격 부담을 더 점검할 필요가 있었습니다.`;
  return {
    caseId: `${symbol}-replay-case-${index}`,
    tradeDate,
    symbol,
    side: index === 5 ? "sell" : "buy",
    similarityScore: 91 - index * 4,
    similarityComponents: { directionScore: 1, marketRegimeScore: .84 - index * .03, indicatorScore: .9 - index * .02 },
    entryPrice: entry,
    ...stats,
    series,
    missedChecks: missedCheck ? [missedCheck] : [],
    checklist: historicalChecklist(checks, missedType, symbol),
    mistakeSummary,
    sameAsToday: "같은 종목에서 추세가 이어지는 구간을 선택했고, 진입 전 계좌 비중을 먼저 확인했습니다.",
    differentFromToday: index % 2
      ? `당시에는 상대 거래량 ${valueLabel(checks.find((item) => item.type === "volume")?.value)}로 수급 강도가 오늘과 달랐습니다.`
      : `당시에는 RSI ${valueLabel(checks.find((item) => item.type === "rsi")?.value)}와 직전 고점까지의 여유가 오늘보다 불리했습니다.`
  };
}

function review(symbol: ReplayChartSymbol, base: number, side: "buy" | "sell", returnPercent: number): ReviewBundle {
  const tradeDate = symbol === "WMT" ? "2026-06-16T19:30:00Z" : symbol === "AMZN" ? "2026-06-15T19:30:00Z" : "2026-06-12T19:30:00Z";
  const currentSeries = replayChartSeries(symbol, tradeDate, base, 0);
  const outcomeSeries = replayChartSeries(symbol, tradeDate, base, 20);
  const checks = chartChecks(symbol, currentSeries);
  const outcome = seriesStats(outcomeSeries, base);
  const entry = base;
  const isTechnologyAdd = symbol === "AAPL";
  const isTrim = side === "sell";
  const portfolioImpact = symbol === "AAPL"
    ? { symbolWeightBefore: 0, symbolWeightAfter: 4.09, sectorWeightBefore: 19.34, sectorWeightAfter: 23.44, cashWeightBefore: 12.0, cashWeightAfter: 8.0, topHoldingsConcentrationBefore: 41.95, topHoldingsConcentrationAfter: 41.95, riskFlags: ["정보기술 비중 23.4%", "단일 종목 비중은 5% 미만", "현금 비중 8.0% 유지"] }
    : symbol === "AMZN"
      ? { symbolWeightBefore: 4.29, symbolWeightAfter: 3.21, sectorWeightBefore: 12.86, sectorWeightAfter: 11.79, cashWeightBefore: 6.87, cashWeightAfter: 8.0, topHoldingsConcentrationBefore: 41.95, topHoldingsConcentrationAfter: 41.95, riskFlags: ["AMZN 비중 1.1%p 축소", "현금 완충력 개선", "임의소비재 비중 11.8%"] }
      : { symbolWeightBefore: 0, symbolWeightAfter: 4.98, sectorWeightBefore: 11.48, sectorWeightAfter: 16.46, cashWeightBefore: 12.86, cashWeightAfter: 8.0, topHoldingsConcentrationBefore: 41.95, topHoldingsConcentrationAfter: 41.95, riskFlags: ["필수소비재 비중 16.5%", "WMT 단일 비중 5.0%", "7개 섹터 분산 유지"] };
  return {
    decisionAssessment: { grade: isTechnologyAdd ? "attention" : "good", summary: isTechnologyAdd ? "새 종목을 더한 건 좋지만, 이미 비중이 큰 정보기술 업종을 더 담았습니다. 다음 AAPL·MSFT 매수 전에는 두 종목을 합친 비중부터 확인해 보세요." : isTrim ? "수익이 난 AMZN을 한 번에 모두 팔지 않고 일부만 정리한 점이 좋습니다. 이익을 챙기면서 추가 상승 가능성과 현금 여력을 함께 남겼습니다." : "기술주 밖의 WMT를 새로 담아 업종 쏠림을 줄인 선택이 좋았습니다. 한 종목에 과하게 싣지 않은 점도 안정적입니다.", processAssessment: isTechnologyAdd ? "AAPL 한 종목의 비중은 크지 않지만, MSFT와 함께 보면 정보기술 비중이 높습니다." : "한 종목과 한 업종에 과하게 몰리지 않도록 비중을 조절했습니다.", outcomeAssessment: `${returnPercent > 0 ? "+" : ""}${returnPercent.toFixed(2)}%`, evidence: isTechnologyAdd ? ["AAPL 4.1%", "정보기술 23.4%", "현금 8.0%"] : isTrim ? ["AMZN 4.3% → 3.2%", "현금 6.9% → 8.0%", "실현손익 +$50"] : ["WMT 5.0%", "필수소비재 16.5%", "7개 섹터"], sourceAsOf: { indicators: asOf, portfolio: asOf } },
    currentCase: { caseId: `${symbol}-replay-current`, tradeDate, symbol, side, entryPrice: entry, returnPercent, mfePercent: outcome.mfePercent, maePercent: outcome.maePercent, holdingDuration: outcome.holdingDuration, series: currentSeries, missedChecks: isTechnologyAdd ? checks.slice(0, 2) : checks.slice(2, 3) },
    similarCases: Array.from({ length: 6 }, (_, index) => similar(index + 1, symbol, base)),
    checklist: {
      chart: isTechnologyAdd ? [{ status: "unchecked", label: "섹터 합산 비중", evidence: "정보기술 23.4%", source: "계좌 분석", sourceAsOf: asOf }, { status: "checked", label: "단일 종목 상한", evidence: "AAPL 4.1%", source: "계좌 분석", sourceAsOf: asOf }] : [{ status: "checked", label: isTrim ? "분할 매도 가격" : "지정가 매수 가격", evidence: isTrim ? "$238 체결" : "$102 체결", source: "체결 내역", sourceAsOf: asOf }],
      news: [{ status: "checked", label: "기업 뉴스", evidence: isTechnologyAdd ? "제품 수요와 공급망 기사 확인" : isTrim ? "클라우드 성장과 소비 경기 기사 확인" : "소비 둔화와 동일점 매출 기사 확인", source: "기업 뉴스", sourceAsOf: asOf }],
      fundamentals: [{ status: "checked", label: "실적 일정", evidence: "다음 발표 전 비중 재검토", source: "실적 일정", sourceAsOf: asOf }],
      market: [{ status: "checked", label: "포트폴리오 비중", evidence: `${symbol} ${portfolioImpact.symbolWeightAfter}% · 현금 8.0%`, source: "계좌 분석", sourceAsOf: asOf }]
    },
    portfolioImpact,
    watchConditions: [
      { id: `${symbol}-close-stop`, type: "price", label: `$${base.toFixed(2)} 아래 일봉 마감`, currentValue: entry + 3.9, threshold: base, operator: "<", reason: "이 가격 아래에서 마감하면 처음 매수한 이유가 아직 유효한지 다시 볼 필요가 있습니다.", recommendedAction: "매수 이유를 다시 확인해 보세요", alertSupported: true, alertRequest: { symbol, type: "price_cross", targetPrice: base.toFixed(2), repeatLimit: 1 } },
      { id: `${symbol}-target-zone`, type: "price", label: `다음 저항 $${(base + 13).toFixed(0)} 접근`, currentValue: entry + 3.9, threshold: base + 13, operator: ">=", reason: "최근 주가가 여러 번 막혔던 가격대에 가까워지고 있습니다.", recommendedAction: "일부 이익 실현을 검토해 보세요", alertSupported: true, alertRequest: { symbol, type: "price_cross", targetPrice: (base + 13).toFixed(2), repeatLimit: 1 } },
      { id: `${symbol}-relative-volume`, type: "volume", label: "상대 거래량 1.2 회복", currentValue: .7, threshold: 1.2, operator: ">=", reason: "거래량이 다시 붙어야 상승 흐름에 힘이 실렸다고 보기 쉽습니다.", recommendedAction: "거래량이 회복되는지 지켜보세요", alertSupported: false },
      { id: `${symbol}-portfolio-weight`, type: "portfolio", label: "종목 비중 20% 상한", currentValue: portfolioImpact.symbolWeightAfter, threshold: 20, operator: ">=", reason: "좋아 보이는 종목도 계좌에서 차지하는 비중이 너무 커지면 한 번의 하락이 전체 성과를 흔들 수 있습니다.", recommendedAction: "더 사기 전에 전체 비중을 확인하세요", alertSupported: false }
    ],
    proposedAlerts: [], confidence: { level: "medium", reason: "과거 유사 사례 6건" }
  };
}

function longTermProfile(stage: InsightStage, period: "6m", sampleSize: number): HabitLongTermProfile {
  const scale = .88;
  if (stage === "portfolio") {
    return {
      headline: "한 종목이나 한 업종에 몰리지 않도록 꾸준히 나눠 담는 습관이 좋습니다. 지금도 여러 업종이 서로의 흔들림을 보완하고 있습니다.",
      patterns: [{ id: `${period}-portfolio-concentration`, title: "업종 쏠림을 스스로 점검함", occurrenceCount: 4, occurrenceRatePercent: 24, description: "정보기술 비중이 가장 크지만, 다른 여섯 업종도 함께 보유해 한쪽으로 과하게 치우치지 않았습니다.", averageMaePercent: -1.4, confidence: "medium" }],
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
          { id: `${period}-utilities`, market: "미국 유틸리티", sector: "유틸리티", etfSymbol: "XLU", suggestedMinWeightPercent: 3, suggestedMaxWeightPercent: 6, correlationToConcentratedSector: .29, relativeStrengthPercent: 1.2, role: "defensive", reason: "기술주와 움직임이 다른 방어 업종이라, 지금의 분산 습관을 더 단단하게 만들 수 있습니다.", sourceAsOf: asOf },
          { id: `${period}-real-estate`, market: "미국 리츠", sector: "부동산", etfSymbol: "XLRE", suggestedMinWeightPercent: 3, suggestedMaxWeightPercent: 5, correlationToConcentratedSector: .34, relativeStrengthPercent: .8, role: "diversification", reason: "현재 보유하지 않은 부동산 자산을 조금 더하면 기존 종목과 다른 흐름을 담을 수 있습니다.", sourceAsOf: asOf }
        ]
      }
    };
  }
  const confirmed = Math.max(2, Math.round(sampleSize * scale));
  const missed = Math.max(1, Math.round(sampleSize * (1 - scale) * .7));
  const unconfirmed = sampleSize - confirmed;
  return {
    headline: stage === "entry"
      ? "한 번에 크게 사기보다 여러 종목과 업종에 나눠 진입하는 편입니다. 이런 습관이 한 번의 판단이 계좌 전체를 흔드는 일을 줄여 줍니다."
      : "수익이 난 종목을 한꺼번에 정리하지 않고 나눠 파는 습관이 좋습니다. 이익을 챙기면서 추가 상승 가능성도 남겨 두었습니다.",
    decisionRecords: { recordedTradeCount: sampleSize, confirmedTradeCount: confirmed, unconfirmedTradeCount: unconfirmed, missedCheckTradeCount: missed },
    processOutcome: [
      { process: "confirmed", outcome: "positive", count: Math.max(1, Math.round(confirmed * .65)), averageReturnPercent: stage === "entry" ? 3.1 : 2.7, averageMaePercent: -1.3 },
      { process: "confirmed", outcome: "negative", count: Math.max(0, confirmed - Math.max(1, Math.round(confirmed * .65))), averageReturnPercent: -1.8, averageMaePercent: -2.2 },
      { process: "unconfirmed", outcome: "positive", count: unconfirmed ? Math.max(1, Math.round(unconfirmed * .45)) : 0, averageReturnPercent: 1.6, averageMaePercent: -2.9 },
      { process: "unconfirmed", outcome: "negative", count: unconfirmed ? Math.max(0, unconfirmed - Math.max(1, Math.round(unconfirmed * .45))) : 0, averageReturnPercent: -3.4, averageMaePercent: -4.1 }
    ],
    patterns: [
      stage === "entry"
        ? { id: `${period}-${stage}-confirmed-rsi-volume`, title: "확인하고 사는 습관", occurrenceCount: confirmed, occurrenceRatePercent: Math.round(confirmed / sampleSize * 100), description: `매수 전에 RSI와 거래량을 먼저 보는 습관이 잘 자리 잡았습니다. 최근 ${sampleSize}건 중 ${confirmed}건에서 이 순서를 지켰습니다.`, averageReturnPercent: 2.8, averageMaePercent: -1.4, confidence: sampleSize >= 15 ? "high" : "medium" }
        : { id: `${period}-${stage}-target-plan`, title: "계획대로 나눠 파는 습관", occurrenceCount: confirmed, occurrenceRatePercent: Math.round(confirmed / sampleSize * 100), description: `오른 종목을 한꺼번에 정리하지 않고 목표 가격에서 나눠 파는 습관이 좋습니다. 최근 ${sampleSize}건 중 ${confirmed}건에서 계획을 지켰습니다.`, averageReturnPercent: 2.1, averageMaePercent: -1.2, confidence: sampleSize >= 15 ? "high" : "medium" },
      stage === "entry"
        ? { id: `${period}-${stage}-volume`, title: "거래량을 빼먹고 산 경우", occurrenceCount: missed, occurrenceRatePercent: Math.round(missed / sampleSize * 100), description: `가끔 가격만 보고 서둘러 산 경우가 있습니다. 최근 ${sampleSize}건 중 ${missed}건은 거래량 확인을 놓쳤습니다.`, averageReturnPercent: -1.2, averageMaePercent: -3.8, confidence: sampleSize >= 15 ? "high" : "medium" }
        : { id: `${period}-${stage}-late-loss`, title: "손실을 오래 끌고 간 경우", occurrenceCount: missed, occurrenceRatePercent: Math.round(missed / sampleSize * 100), description: `손절 기준을 정해 두고도 매도를 미룬 경우가 있습니다. 최근 ${sampleSize}건 중 ${missed}건에서 결정이 늦었습니다.`, averageReturnPercent: -2.4, averageMaePercent: -4.2, confidence: sampleSize >= 15 ? "high" : "medium" },
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
    summary: stage === "entry" ? "한 종목을 크게 사기보다 여러 종목에 나눠 들어가는 편입니다." : stage === "exit" ? "수익이 난 종목은 일부씩 정리해 이익과 추가 상승 가능성을 함께 남기는 편입니다." : "한 종목과 한 업종에 몰리지 않도록 비중을 꾸준히 조절하고 있습니다.",
    behavior: [
      { label: `${labels[stage]} 계획 기록률`, value: { value: Math.round(scale * 100), unit: "%", availability: "ready", interpretation: "사전 기록이 있는 거래만 집계했습니다." } },
      { label: "평균 결과", value: { value: stage === "exit" ? 1.8 : 2.4, unit: "%", denominator: `${sampleSize}건`, availability: "ready" } },
      { label: "평균 MAE", value: { value: stage === "portfolio" ? -1.4 : -2.2, unit: "%", availability: "ready" } }
    ],
    planConsistency: { value: Math.round(scale * 92), unit: "%", availability: "ready", interpretation: "계획 기록과 실제 체결을 비교한 값입니다." }, longTermProfile: longTermProfile(stage, period, sampleSize),
    insights: [{ id: `${period}-${stage}-insight`, stage, kind: stage === "exit" ? "effective_candidate" : "improvement_candidate", title: stage === "entry" ? "예약 주문까지 생각하고 사기" : stage === "exit" ? "오른 종목은 나눠 팔기" : "MSFT를 더 사기 전 비중 확인", condition: stage === "entry" ? "예약 주문을 빼면 실제로 쓸 수 있는 현금이 줄어드는 상황" : stage === "exit" ? "목표 가격에 도달했을 때 일부만 매도" : "MSFT 비중이 정한 상한에 가까워지는 상황", observedBehavior: stage === "entry" ? "AAPL과 WMT 주문에 현금이 이미 예약되어, 생각보다 새 주문에 쓸 수 있는 돈이 적었습니다." : stage === "exit" ? "GOOGL·XOM·AMZN을 일부만 팔아 이익을 챙기고 남은 상승 가능성도 열어 두었습니다." : "MSFT가 계좌에서 가장 큰 비중을 차지하고 있어, 추가 매수는 더 신중해야 합니다.", sampleSize, confidence: sampleSize >= 12 ? "medium" : "low", metrics: { avgReturn: stage === "exit" ? 2.2 : 1.2, avgMfe: 4.8, avgMae: -2.1, planAdherenceRate: Math.round(scale * 92) }, recurrenceScore: 72, impactScore: 76, controllabilityScore: 90, priorityScore: 80, nextAction: stage === "entry" ? "새로 사기 전에 예약 주문을 뺀 실제 현금을 확인하세요" : stage === "exit" ? "다음에도 목표 가격에서 일부만 먼저 정리해 보세요" : "MSFT를 더 사기 전에 계좌에서 차지할 비중을 계산하세요", candidateGuardrailId: `${stage}-guardrail` }]
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
  title: "예약 주문까지 생각하고 사기",
  condition: "AAPL·WMT 주문에 현금이 이미 묶여 있는 상황",
  observedBehavior: "계좌에 보이는 현금보다 실제로 새 주문에 쓸 수 있는 금액이 적습니다.",
  nextAction: "다음 매수 전에는 예약 주문을 뺀 실제 현금을 확인하세요"
};
const priorityExit = {
  ...periods["6m"].exit.insights[0],
  priority: "reproduce" as const,
  title: "오른 종목은 나눠 팔기",
  condition: "미리 정한 목표 가격에 도달한 상황",
  observedBehavior: "최근 매도에서도 전부 팔지 않고 일부만 정리해 이익과 추가 상승 가능성을 함께 남겼습니다.",
  nextAction: "다음에도 목표 가격에서 일부만 먼저 정리해 보세요"
};
const priorityPortfolio = {
  ...periods["6m"].portfolio.insights[0],
  priority: "observe" as const,
  title: "MSFT를 더 사기 전 비중 확인",
  condition: "MSFT가 계좌에서 가장 큰 비중을 차지한 상황",
  observedBehavior: "전체적으로는 잘 나눠 담았지만, MSFT 한 종목의 영향은 점점 커지고 있습니다.",
  nextAction: "MSFT를 더 사기 전에 매수 후 비중을 먼저 계산하세요"
};
const experiments = [
  { id: "exp-cash-buffer", sourceStages: ["entry" as const, "portfolio" as const], title: "새 기회를 위한 현금 남겨 두기", hypothesis: "예약 주문을 빼고도 현금을 조금 남겨 두면, 갑자기 좋은 가격이 왔을 때 서두르지 않고 대응할 수 있습니다.", sampleTarget: 5, appliedCount: 2, checklist: ["예약 주문을 뺀 현금 확인", "매수 후 남을 현금 확인"], successMetrics: ["현금 비중 5% 이상", "주문 가능 금액 부족 0건"], stopConditions: ["매수 후 현금 비중 5% 미만"], confidence: "medium" as const, status: "active" as const },
  { id: "exp-exit", sourceStages: ["exit" as const], title: "목표 가격에서 두 번 나눠 팔기", hypothesis: "오른 종목을 나눠 팔면 이익을 먼저 챙기면서도 남은 상승을 따라갈 수 있습니다.", sampleTarget: 5, appliedCount: 1, checklist: ["목표 가격 기록", "먼저 팔 수량 기록"], successMetrics: ["고점 이후 돌려준 수익 감소"], stopConditions: ["너무 일찍 팔아 놓친 상승이 커질 때"], confidence: "medium" as const, status: "candidate" as const }
];
const guardrails = [
  { id: "entry-guardrail", stage: "entry" as const, title: "현금이 너무 적게 남는 매수", description: "이 주문을 체결한 뒤 현금이 5%도 남지 않는다면, 지금 꼭 사야 하는 이유를 한 번 더 묻습니다.", trigger: { conditions: [{ metric: "cashWeight", operator: "<", value: 5 }], matchMode: "all" as const }, severity: "warning" as const, intervention: "require_confirmation" as const, scope: "next_five_trades" as const, enabled: true },
  { id: "portfolio-guardrail", stage: "portfolio" as const, title: "한 종목에 너무 많이 담는 매수", description: "이 주문 뒤 한 종목이 계좌의 20%를 넘는다면, 기대만큼 위험도 감당할 수 있는지 다시 확인합니다.", trigger: { conditions: [{ metric: "symbolWeight", operator: ">", value: 20 }], matchMode: "all" as const }, severity: "risk" as const, intervention: "require_plan" as const, scope: "global" as const, enabled: true }
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
  page3: { availability: "ready", summary: "여러 종목에 나눠 사고, 오른 종목은 나눠 파는 습관은 잘하고 있습니다. 다음 거래에서는 예약 주문을 뺀 실제 현금과 가장 비중이 큰 MSFT만 한 번 더 확인해 보세요.", priorities: [priorityEntry, priorityExit, priorityPortfolio], experiments, guardrails },
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
