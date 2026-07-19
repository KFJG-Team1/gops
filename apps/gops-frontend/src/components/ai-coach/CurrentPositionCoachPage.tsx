import { Check, ChevronLeft, ChevronRight, CircleAlert, Minus, Newspaper, PieChart, TrendingUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { sp500UniverseSeed } from "../../market/sp500Universe.seed";
import { StockLogo } from "../StockLogo";
import type { ChartPoint, ChecklistItem, CoachReport, DailyTradeReview, MissedCheck, TradeCase, WatchCondition } from "./types";
import styles from "./CurrentPositionCoachPage.module.css";

type Props = { report: CoachReport | null; onOpenAlertCenter?: (condition: WatchCondition) => void };

const checklistMeta = {
  chart: { label: "차트", icon: TrendingUp },
  news: { label: "뉴스", icon: Newspaper },
  fundamentals: { label: "재무", icon: PieChart },
  market: { label: "시장", icon: CircleAlert }
} as const;

const companyNameBySymbol = new Map(
  sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item.companyName])
);

export function CurrentPositionCoachPage({ report, onOpenAlertCenter }: Props) {
  const instanceId = useId();
  const watchPreviewTitleId = `${instanceId}-watch-preview-title`;
  const page = report?.page1;
  const [fillId, setFillId] = useState(page?.selectedFillId ?? page?.trades[0]?.fillId ?? "");
  const [caseIndex, setCaseIndex] = useState(0);
  const [narrativeIndex, setNarrativeIndex] = useState(0);
  const [conditionIndex, setConditionIndex] = useState(0);
  useEffect(() => {
    setFillId(page?.selectedFillId ?? page?.trades[0]?.fillId ?? "");
    setCaseIndex(0);
    setNarrativeIndex(0);
    setConditionIndex(0);
  }, [page?.selectedFillId, report?.analysisId]);

  if (!page) return <EmptyCoach />;
  const trade = page.trades.find((item) => item.fillId === fillId) ?? page.trades[0];
  const tradeIndex = trade ? Math.max(0, page.trades.findIndex((item) => item.fillId === trade.fillId)) : 0;
  const activeReview = (trade && page.reviewsByFillId?.[trade.fillId]) ?? page;
  const cases = [activeReview.currentCase, ...activeReview.similarCases.slice(0, 6)];
  const selectedCase = cases[Math.min(caseIndex, cases.length - 1)] ?? activeReview.currentCase;
  const selectedChecklist = caseIndex === 0 ? activeReview.checklist : selectedCase.checklist;
  const selectedCaseSymbol = selectedCase.symbol?.trim().toUpperCase() ?? "";
  const selectedCaseCompanyName = page.trades.find((item) => item.symbol.trim().toUpperCase() === selectedCaseSymbol)?.companyName?.trim()
    || companyNameBySymbol.get(selectedCaseSymbol)
    || selectedCase.symbol
    || "기업명 확인 불가";
  const assessment = activeReview.decisionAssessment;
  const assessmentSummary = quotedCoachCopy(assessment.summary);
  const narrativeItems = [
    { label: "그때의 실수", value: selectedCase.mistakeSummary ?? "확인 기록 없음" },
    { label: "오늘과 같은 점", value: selectedCase.sameAsToday ?? "계산되지 않음" },
    { label: "오늘과 다른 점", value: selectedCase.differentFromToday ?? "계산되지 않음" }
  ];
  const activeNarrativeIndex = Math.max(0, Math.min(narrativeItems.length - 1, narrativeIndex));
  const activeNarrative = narrativeItems[activeNarrativeIndex];
  const conditionCount = activeReview.watchConditions.length;
  const activeConditionIndex = conditionCount ? Math.max(0, Math.min(conditionCount - 1, conditionIndex)) : 0;
  const activeCondition = conditionCount ? activeReview.watchConditions[activeConditionIndex] : null;

  const selectTrade = (nextFillId: string) => {
    setFillId(nextFillId);
    setCaseIndex(0);
    setNarrativeIndex(0);
    setConditionIndex(0);
  };

  const moveTrade = (delta: number) => {
    if (page.trades.length < 2) return;
    const nextIndex = Math.max(0, Math.min(page.trades.length - 1, tradeIndex + delta));
    selectTrade(page.trades[nextIndex].fillId);
  };

  const moveCase = (delta: number) => {
    setCaseIndex((current) => Math.max(0, Math.min(cases.length - 1, current + delta)));
    setNarrativeIndex(0);
  };

  const moveNarrative = (delta: number) => {
    setNarrativeIndex((current) => Math.max(0, Math.min(narrativeItems.length - 1, current + delta)));
  };

  const moveCondition = (delta: number) => {
    if (conditionCount < 2) return;
    setConditionIndex((current) => Math.max(0, Math.min(conditionCount - 1, current + delta)));
  };

  const handleConditionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveCondition(event.key === "ArrowRight" ? 1 : -1);
  };

  return (
    <div className={styles.page} data-testid="ai-coach-page1">
      <section className={styles.tradeHeader} aria-label="오늘 거래">
        {trade ? <div className={styles.tradeCarousel}>
          <button type="button" className={styles.tradeArrow} aria-label="이전 오늘 거래" disabled={page.trades.length < 2 || tradeIndex === 0} onClick={() => moveTrade(-1)}><ChevronLeft aria-hidden="true" /></button>
          <div key={trade.fillId} className={styles.tradeGrid} role="group" aria-label={`${tradeIndex + 1} / ${page.trades.length}, ${trade.companyName ?? trade.symbol}`} aria-live="polite">
            <div className={styles.identity}><StockLogo symbol={trade.symbol} companyName={trade.companyName ?? trade.symbol} size="lg" /><div className={styles.identitySummary}><strong>{trade.companyName ?? trade.symbol}</strong><span className={styles.ticker}>{trade.symbol}</span><span className={styles.currentPrice}>{money(trade.currentPrice)}</span><span className={`${styles.currentReturn} ${styles[tone(trade.currentReturnPercent) ?? "neutral"]}`}>{percent(trade.currentReturnPercent)}</span></div></div>
            <Metric label="평균 체결가" value={money(trade.averageFillPrice)} />
            <Metric label="체결 수량" value={numberOrMissing(trade.quantity)} />
          </div>
          <button type="button" className={styles.tradeArrow} aria-label="다음 오늘 거래" disabled={page.trades.length < 2 || tradeIndex === page.trades.length - 1} onClick={() => moveTrade(1)}><ChevronRight aria-hidden="true" /></button>
        </div> : <p>데이터 연결 대기</p>}
      </section>

      <section className={styles.assessment} aria-label="오늘 거래 판단 요약">
        <strong>{assessmentSummary ?? "판단 데이터 부족"}</strong>
      </section>

      <section className={styles.chartSection}>
        <div className={styles.sectionTitle}><h3 aria-live="polite">{caseIndex === 0 ? "진입 전후 차트" : `${selectedCaseCompanyName} · ${selectedCase.tradeDate ? formatDate(selectedCase.tradeDate) : "과거 거래"} · 유사도 ${numberOrMissing(selectedCase.similarityScore)}%`}</h3></div>
        <div className={styles.chartCarousel}>
          <button type="button" className={styles.chartArrow} aria-label="이전 거래 사례" disabled={caseIndex === 0} onClick={() => moveCase(-1)}><ChevronLeft aria-hidden="true" /></button>
          <ReviewChart current={activeReview.currentCase} selected={selectedCase} />
          <button type="button" className={styles.chartArrow} aria-label="다음 거래 사례" disabled={caseIndex === cases.length - 1} onClick={() => moveCase(1)}><ChevronRight aria-hidden="true" /></button>
        </div>
        <div className={styles.caseStats}><Metric label="진입 후 수익률" value={percent(selectedCase.returnPercent)} tone={tone(selectedCase.returnPercent)} /><Metric label="MFE" value={percent(selectedCase.mfePercent)} /><Metric label="MAE" value={percent(selectedCase.maePercent)} tone="negative" /><Metric label="보유 기간" value={valueText(selectedCase.holdingDuration)} /></div>
        {caseIndex > 0 && <div className={styles.reviewCarousel}>
          <div className={styles.carouselStage}>
            <button type="button" className={styles.carouselArrow} aria-label="이전 사례 설명" disabled={activeNarrativeIndex === 0} onClick={() => moveNarrative(-1)}><ChevronLeft aria-hidden="true" /></button>
            <p key={`${selectedCase.caseId}-${activeNarrativeIndex}`} className={styles.reviewSlide} role="group" aria-label={`${activeNarrativeIndex + 1} / ${narrativeItems.length}, ${activeNarrative.label}`} aria-live="polite"><span>{activeNarrative.value}</span></p>
            <button type="button" className={styles.carouselArrow} aria-label="다음 사례 설명" disabled={activeNarrativeIndex === narrativeItems.length - 1} onClick={() => moveNarrative(1)}><ChevronRight aria-hidden="true" /></button>
          </div>
        </div>}
      </section>

      <section className={styles.checks}><h3>확인 항목</h3><div className={styles.checkList}>{(Object.keys(checklistMeta) as Array<keyof typeof checklistMeta>).map((key) => <ChecklistGroup key={key} category={key} items={selectedChecklist?.[key] ?? []} emptyLabel={caseIndex > 0 ? "확인 기록 없음" : "데이터 연결 대기"} />)}</div></section>

      <PortfolioImpact impact={activeReview.portfolioImpact} />

      <section className={styles.conditionPreview} aria-labelledby={watchPreviewTitleId}>
        <div className={styles.conditionPreviewHeader}><h3 id={watchPreviewTitleId}>매도 및 관찰 기준</h3></div>
        {activeCondition ? <div className={styles.carouselStage}>
          <button type="button" className={styles.carouselArrow} aria-label="이전 매도 및 관찰 기준" disabled={conditionCount < 2 || activeConditionIndex === 0} onClick={() => moveCondition(-1)}><ChevronLeft aria-hidden="true" /></button>
          <button key={activeCondition.id} type="button" className={styles.conditionSlide} disabled={!onOpenAlertCenter} aria-label={`${activeConditionIndex + 1} / ${conditionCount}, ${activeCondition.label}, 4페이지에서 상세 보기`} onClick={() => onOpenAlertCenter?.(activeCondition)} onKeyDown={handleConditionKey}>
            <span className={styles.conditionRank}>{activeConditionIndex + 1}순위</span>
            <span className={styles.conditionSlideCopy}>
              <strong>{activeCondition.label}</strong>
              <b>{activeCondition.reason ?? "이 조건이 무너지면 당일 거래 판단을 다시 확인해야 합니다."}</b>
            </span>
            <span className={styles.conditionAction}>추천 알람 설정하기</span>
          </button>
          <button type="button" className={styles.carouselArrow} aria-label="다음 매도 및 관찰 기준" disabled={conditionCount < 2 || activeConditionIndex === conditionCount - 1} onClick={() => moveCondition(1)}><ChevronRight aria-hidden="true" /></button>
        </div> : <p className={styles.empty}>계산되지 않음</p>}
      </section>
    </div>
  );
}

function ChecklistGroup({ category, items, emptyLabel }: { category: keyof typeof checklistMeta; items: ChecklistItem[]; emptyLabel: string }) {
  const titleId = useId();
  const meta = checklistMeta[category];
  const Icon = meta.icon;
  const checkedCount = items.filter((item) => item.status === "checked" || item.status === "not_applicable").length;
  return <div className={styles.checkGroup} data-category={category} role="group" aria-labelledby={titleId}>
    <div className={styles.checkGroupHeader}>
      <Icon aria-hidden="true" />
      <strong id={titleId}>{meta.label}</strong>
      <span>{checkedCount}/{items.length}</span>
    </div>
    <ul className={styles.checkItems} role="list">
      {items.length ? items.map((item, index) => <li key={`${item.label}-${index}`} className={styles.checkRow} data-status={item.status}>
        <span className={styles.checkIndicator} aria-hidden="true">{item.status === "checked" ? <Check /> : item.status === "unchecked" ? <X /> : <Minus />}</span>
        <span className={styles.checkCopy}>
          <strong>{item.label}</strong>
          <span>{item.evidence ?? "근거 데이터 부족"}</span>
        </span>
        <span className={styles.checkStatus}>{statusLabel(item.status)}</span>
      </li>) : <li className={styles.checkRow} data-status="insufficient_data"><span className={styles.checkIndicator} aria-hidden="true"><Minus /></span><span className={styles.checkCopy}><strong>{emptyLabel}</strong></span><span className={styles.checkStatus}>데이터 부족</span></li>}
    </ul>
  </div>;
}

function ReviewChart({ current, selected }: { current: TradeCase; selected: TradeCase }) {
  const id = useId();
  const priceClipId = `coach-price-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [activeMarker, setActiveMarker] = useState<MissedCheck | null>(null);
  useEffect(() => { const node = host.current; if (!node || typeof ResizeObserver === "undefined") return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry.contentRect.width)))); observer.observe(node); return () => observer.disconnect(); }, []);
  const height = 360, left = 50, right = width - 18, plotWidth = right - left;
  const priceTop = 16, priceBottom = 176, volumeTop = 194, volumeBottom = 230;
  const rsiTop = 246, rsiBottom = 286, macdTop = 304, macdBottom = 344;
  const series = selected.series.filter((point) => point.relativeDay >= -60 && point.relativeDay <= 20);
  const currentSeries = current.series.filter((point) => point.relativeDay >= -60 && point.relativeDay <= 20);
  const priceValues = series.flatMap((point) => [point.open, point.high, point.low, point.close]).filter(isNumber);
  const entry = isNumber(selected.entryPrice) && selected.entryPrice > 0
    ? selected.entryPrice
    : priceValues.find((value) => value > 0) ?? 1;
  const normalized = (value: number) => (value - entry) / entry * 100;
  const normalizedValues = priceValues.map(normalized);
  const currentEntry = isNumber(current.entryPrice) && current.entryPrice > 0 ? current.entryPrice : null;
  const currentNormalizedValues = currentEntry === null
    ? []
    : currentSeries
      .map((point) => point.close)
      .filter(isNumber)
      .map((value) => (value - currentEntry) / currentEntry * 100);
  const sharedNormalizedValues = [...normalizedValues, ...currentNormalizedValues];
  const minPrice = Math.min(-2, ...sharedNormalizedValues), maxPrice = Math.max(2, ...sharedNormalizedValues);
  const x = (day: number) => left + ((day + 60) / 80) * plotWidth;
  const scale = (value: number, min: number, max: number, top: number, bottom: number) => bottom - ((value - min) / Math.max(.0001, max - min)) * (bottom - top);
  const priceY = (value: number) => scale(normalized(value), minPrice, maxPrice, priceTop, priceBottom);
  const volumes = series.map((p) => p.volume).filter(isNumber); const maxVolume = Math.max(1, ...volumes);
  const macdValues = series.flatMap((p) => [p.macd, p.signal, p.histogram]).filter(isNumber); const macdMax = Math.max(.1, ...macdValues.map(Math.abs));
  const currentPath = currentEntry === null || selected.caseId === current.caseId
    ? ""
    : currentSeries
      .filter((p): p is ChartPoint & { close: number } => isNumber(p.close))
      .map((p) => `${x(p.relativeDay)},${scale((p.close - currentEntry) / currentEntry * 100, minPrice, maxPrice, priceTop, priceBottom)}`)
      .join(" ");
  const markerY = (marker: MissedCheck) => { const point = nearestPoint(series, marker.relativeDay ?? 0); if (marker.type === "rsi") return scale(isNumber(marker.value) ? marker.value : point?.rsi ?? 50, 0, 100, rsiTop, rsiBottom); if (marker.type === "macd") return scale(isNumber(marker.value) ? marker.value : point?.macd ?? 0, -macdMax, macdMax, macdTop, macdBottom); if (marker.type === "volume") return scale(point?.volume ?? 0, 0, maxVolume, volumeTop, volumeBottom); return point?.close ? priceY(point.close) : 96; };
  return <div className={styles.chartHost} ref={host}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>진입 전후 T-60부터 T+20까지의 가격, 거래량, RSI, MACD</title><desc id={`${id}-desc`}>진입 시점과 놓친 판단 조건을 점선과 점으로 표시합니다. 오늘 거래의 미래 구간은 비어 있습니다.</desc>
      <defs><clipPath id={priceClipId}><rect x={left} y={priceTop} width={plotWidth} height={priceBottom - priceTop} /></clipPath></defs>
      {[-60, -40, -20, 0, 20].map((day) => <line key={`grid-${day}`} x1={x(day)} x2={x(day)} y1={priceTop} y2={macdBottom} className={styles.gridLine} />)}
      {[-60, -40, -20, 0, 20].map((day) => <text key={day} x={x(day)} y="358" textAnchor="middle" className={styles.axis}>{day === 0 ? "Entry" : `T${day > 0 ? "+" : ""}${day}`}</text>)}
      <line x1={x(0)} x2={x(0)} y1={priceTop} y2={macdBottom} className={styles.entryLine} /><text x={x(0) + 6} y="29" className={styles.entryText}>ENTRY</text>
      <text x="8" y="30" className={styles.panelLabel}>가격 %</text><text x="8" y="207" className={styles.panelLabel}>거래량</text><text x="8" y="259" className={styles.panelLabel}>RSI</text><text x="8" y="317" className={styles.panelLabel}>MACD</text>
      <g clipPath={`url(#${priceClipId})`}>
        {series.map((point) => isNumber(point.open) && isNumber(point.high) && isNumber(point.low) && isNumber(point.close) ? <g key={point.relativeDay} className={point.close >= point.open ? styles.upCandle : styles.downCandle}><line x1={x(point.relativeDay)} x2={x(point.relativeDay)} y1={priceY(point.high)} y2={priceY(point.low)} /><rect x={x(point.relativeDay) - Math.max(1.5, plotWidth / 210)} width={Math.max(3, plotWidth / 105)} y={Math.min(priceY(point.open), priceY(point.close))} height={Math.max(1.5, Math.abs(priceY(point.open) - priceY(point.close)))} /></g> : null)}
        {currentPath && <polyline points={currentPath} className={styles.todayLine} />}
      </g>
      {series.map((point) => isNumber(point.volume) ? <rect key={`v-${point.relativeDay}`} x={x(point.relativeDay) - 2} width="4" y={scale(point.volume, 0, maxVolume, volumeTop, volumeBottom)} height={volumeBottom - scale(point.volume, 0, maxVolume, volumeTop, volumeBottom)} className={styles.volumeBar} /> : null)}
      <line x1={left} x2={right} y1={scale(70, 0, 100, rsiTop, rsiBottom)} y2={scale(70, 0, 100, rsiTop, rsiBottom)} className={styles.threshold} />
      <polyline points={linePoints(series, "rsi", x, (v) => scale(v, 0, 100, rsiTop, rsiBottom))} className={styles.rsiLine} />
      <line x1={left} x2={right} y1={scale(0, -macdMax, macdMax, macdTop, macdBottom)} y2={scale(0, -macdMax, macdMax, macdTop, macdBottom)} className={styles.zeroLine} />
      <polyline points={linePoints(series, "macd", x, (v) => scale(v, -macdMax, macdMax, macdTop, macdBottom))} className={styles.macdLine} /><polyline points={linePoints(series, "signal", x, (v) => scale(v, -macdMax, macdMax, macdTop, macdBottom))} className={styles.signalLine} />
      {selected.missedChecks.map((marker, index) => <g key={marker.id ?? `${marker.type}-${index}`} tabIndex={0} role="button" aria-label={`${marker.label}: ${valueText(marker.value)}, 기준 ${valueText(marker.threshold)}`} onFocus={() => setActiveMarker(marker)} onBlur={() => setActiveMarker(null)} onMouseEnter={() => setActiveMarker(marker)} onMouseLeave={() => setActiveMarker(null)}><line x1={x(marker.relativeDay ?? 0)} x2={x(marker.relativeDay ?? 0)} y1={Math.max(priceTop, markerY(marker) - 18)} y2={Math.min(macdBottom, markerY(marker) + 18)} className={styles.markerGuide} /><circle cx={x(marker.relativeDay ?? 0)} cy={markerY(marker)} r="6" className={styles.markerDot} /></g>)}
    </svg>
    {activeMarker && <div className={styles.tooltip} role="status"><strong>{activeMarker.label}</strong><span>당시 {valueText(activeMarker.value)} · 기준 {valueText(activeMarker.threshold)}</span><p>{activeMarker.reason ?? "확인이 필요했던 조건입니다."}</p></div>}
  </div>;
}

function PortfolioImpact({ impact }: { impact: DailyTradeReview["portfolioImpact"] }) {
  const rows = [
    { label: "종목 비중", before: impact.symbolWeightBefore, after: impact.symbolWeightAfter, riskFlag: "단일 종목 위험 증가" },
    { label: "섹터 비중", before: impact.sectorWeightBefore, after: impact.sectorWeightAfter, riskFlag: "섹터 집중도 상승" },
    { label: "현금 비중", before: impact.cashWeightBefore, after: impact.cashWeightAfter, riskFlag: "현금 완충력 감소" },
    { label: "상위 종목 집중도", before: impact.topHoldingsConcentrationBefore, after: impact.topHoldingsConcentrationAfter, riskFlag: "상위 종목 집중도 상승" }
  ];
  const riskFlags = impact.riskFlags ?? [];
  const costBasis = impact.valuationBasisBefore === "cost_basis" || impact.valuationBasisAfter === "cost_basis";
  return <section className={styles.portfolio}><h3>포트폴리오 영향</h3>{costBasis && <p className={styles.valuationNote}>가상투자 거래원가 기준 · 실시간 평가금액이 아닙니다</p>}<div className={styles.tableWrap}><table><thead><tr><th>항목</th><th>변경 전</th><th>변경 후</th><th>변화</th><th>영향 및 리스크</th></tr></thead><tbody>{rows.map(({ label, before, after, riskFlag }) => { const a = typeof before === "number" ? before : null, b = typeof after === "number" ? after : null; return <tr key={label}><td>{label}</td><td>{percent(a)}</td><td>{percent(b)}</td><td>{a != null && b != null ? `${b - a > 0 ? "+" : ""}${(b - a).toFixed(1)}%p` : "계산되지 않음"}</td><td>{riskFlags.includes(riskFlag) ? riskFlag : a != null && b != null ? "추가 위험 신호 없음" : "계산되지 않음"}</td></tr>; })}</tbody></table></div></section>;
}

function EmptyCoach() { return <div className={styles.emptyPage}><CircleAlert /><h2>당일 거래 회고</h2><p>아직 오늘 회고할 거래가 없습니다.</p><small>거래가 체결되면 판단 과정과 계좌 변화를 함께 정리해 드립니다.</small></div>; }
function quotedCoachCopy(value?: string | null) {
  const copy = value?.trim();
  if (!copy) return null;
  const unquoted = copy.replace(/^["“”]+/, "").replace(/["“”]+$/, "").trim();
  return unquoted ? `"${unquoted}"` : null;
}
function Metric({ label, value, tone: color }: { label: string; value: string; tone?: string }) { return <div className={styles.metric}><span>{label}</span><strong className={color ? styles[color] : undefined}>{value}</strong></div>; }
function nearestPoint(points: ChartPoint[], day: number) { return points.reduce<ChartPoint | undefined>((best, point) => !best || Math.abs(point.relativeDay - day) < Math.abs(best.relativeDay - day) ? point : best, undefined); }
function linePoints(points: ChartPoint[], key: "rsi" | "macd" | "signal", x: (v: number) => number, y: (v: number) => number) { return points.filter((p) => isNumber(p[key])).map((p) => `${x(p.relativeDay)},${y(p[key] as number)}`).join(" "); }
function isNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function money(value: unknown) { return isNumber(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "계산되지 않음"; }
function percent(value: unknown) { return isNumber(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "계산되지 않음"; }
function numberOrMissing(value: unknown) { return isNumber(value) ? value.toLocaleString("ko-KR") : "계산되지 않음"; }
function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "계산되지 않음";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value);
  }
  return String(value);
}
function tone(value: unknown) { return isNumber(value) ? value > 0 ? "positive" : value < 0 ? "negative" : undefined : undefined; }
function statusLabel(value: string) { return ({ checked: "확인", unchecked: "미확인", insufficient_data: "데이터 부족", not_applicable: "해당 없음" } as Record<string, string>)[value] ?? value; }
function formatDate(value?: string | null) { if (!value) return "일정 확인 불가"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date); }
