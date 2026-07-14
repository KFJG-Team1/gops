import { Bell, CalendarClock, ChevronLeft, ChevronRight, CircleAlert, Newspaper, PieChart, TrendingUp } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { StockLogo } from "../StockLogo";
import type { ChartPoint, ChecklistItem, CoachReport, DailyTradeReview, MissedCheck, TradeCase, WatchCondition } from "./types";
import styles from "./CurrentPositionCoachPage.module.css";

type Props = { report: CoachReport | null; onAlertRequested?: (condition: WatchCondition) => Promise<boolean> };

const checklistMeta = {
  chart: { label: "차트", icon: TrendingUp },
  news: { label: "뉴스", icon: Newspaper },
  fundamentals: { label: "재무", icon: PieChart },
  market: { label: "시장", icon: CircleAlert }
} as const;

export function CurrentPositionCoachPage({ report, onAlertRequested }: Props) {
  const page = report?.page1;
  const tradeTabsId = useId();
  const [fillId, setFillId] = useState(page?.selectedFillId ?? page?.trades[0]?.fillId ?? "");
  const [caseIndex, setCaseIndex] = useState(0);
  const [enabledAlerts, setEnabledAlerts] = useState<string[]>([]);
  const [pendingAlert, setPendingAlert] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  useEffect(() => {
    setFillId(page?.selectedFillId ?? page?.trades[0]?.fillId ?? "");
    setCaseIndex(0);
  }, [page?.selectedFillId, report?.analysisId]);

  if (!page) return <EmptyCoach report={report} />;
  const trade = page.trades.find((item) => item.fillId === fillId) ?? page.trades[0];
  const activeReview = (trade && page.reviewsByFillId?.[trade.fillId]) ?? page;
  const cases = [activeReview.currentCase, ...activeReview.similarCases.slice(0, 6)];
  const selectedCase = cases[Math.min(caseIndex, cases.length - 1)] ?? activeReview.currentCase;
  const assessment = activeReview.decisionAssessment;
  const grade = assessment.grade ?? "insufficient_data";

  const selectTrade = (nextFillId: string) => {
    setFillId(nextFillId);
    setCaseIndex(0);
  };

  const moveTradeFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % page.trades.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + page.trades.length) % page.trades.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = page.trades.length - 1;
    if (nextIndex === undefined || page.trades.length === 0) return;
    event.preventDefault();
    selectTrade(page.trades[nextIndex].fillId);
    requestAnimationFrame(() => document.getElementById(`${tradeTabsId}-trade-${nextIndex}`)?.focus());
  };

  const requestAlert = async (condition: WatchCondition) => {
    if (enabledAlerts.includes(condition.id) || pendingAlert) return;
    if (!onAlertRequested || !condition.alertRequest) {
      setAlertError("이 조건은 현재 알람 API에서 지원되지 않습니다.");
      return;
    }
    setAlertError(null);
    setPendingAlert(condition.id);
    const saved = await onAlertRequested(condition).catch(() => false);
    setPendingAlert(null);
    if (saved) setEnabledAlerts((current) => [...current, condition.id]);
    else setAlertError("알람을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  };

  return (
    <div className={styles.page} data-testid="ai-coach-page1">
      <header className={styles.heading}>
        <div><span>01 / 04 · 당일 거래 회고</span><h2>오늘의 판단을 결과와 분리해 봅니다</h2></div>
        <small>{formatAsOf(report?.sourceAsOf)}</small>
      </header>

      <section className={styles.tradeHeader} aria-label="오늘 거래">
        <div className={styles.tradeTabs} role="tablist" aria-label="오늘 체결 종목">
          {page.trades.map((item, index) => {
            const selected = item.fillId === trade?.fillId;
            return <button
              key={item.fillId}
              id={`${tradeTabsId}-trade-${index}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTrade(item.fillId)}
              onKeyDown={(event) => moveTradeFocus(event, index)}
            >{item.symbol}</button>;
          })}
        </div>
        {trade ? <div className={styles.tradeGrid}>
          <div className={styles.identity}><StockLogo symbol={trade.symbol} companyName={trade.companyName ?? trade.symbol} size="md" /><div><strong>{trade.companyName ?? trade.symbol}</strong><span>{trade.symbol} · {sideLabel(trade.side)} · {formatDateTime(trade.filledAt)}</span></div></div>
          <Metric label="평균 체결가" value={money(trade.averageFillPrice)} />
          <Metric label="체결 수량" value={numberOrMissing(trade.quantity)} />
          <Metric label="현재가" value={money(trade.currentPrice)} />
          <Metric label="현재 수익률" value={percent(trade.currentReturnPercent)} tone={tone(trade.currentReturnPercent)} />
          <Metric label="종목 비중" value={`${percent(trade.weightBefore)} → ${percent(trade.weightAfter)}`} />
          <Metric label="다음 실적" value={trade.earningsAt ? `${formatDate(trade.earningsAt)}${trade.earningsDaysRemaining != null ? ` · D-${trade.earningsDaysRemaining}` : ""}` : "일정 확인 불가"} />
        </div> : <p>데이터 연결 대기</p>}
      </section>

      <section className={`${styles.assessment} ${styles[grade]}`}>
        <div><span>오늘 판단 · {gradeLabel(grade)}</span><strong>{assessment.summary ?? "판단 데이터 부족"}</strong></div>
        <div className={styles.assessmentSplit}><p><b>결과 손익</b>{valueText(assessment.outcomeAssessment)}</p><p><b>과정 평가</b>{assessment.processAssessment ?? "확인 기록 없음"}</p></div>
        <small>근거 기준시각 {formatAsOf(assessment.sourceAsOf)}</small>
      </section>

      <section className={styles.chartSection}>
        <div className={styles.sectionTitle}><div><span>{caseIndex === 0 ? "오늘 거래" : `유사 사례 ${caseIndex} / ${cases.length - 1}`}</span><h3>{caseIndex === 0 ? "진입 전후 차트" : `${selectedCase.tradeDate ? formatDate(selectedCase.tradeDate) : "과거 거래"} · 유사도 ${numberOrMissing(selectedCase.similarityScore)}%`}</h3></div><div className={styles.caseControls}><button aria-label="이전 사례" onClick={() => setCaseIndex((caseIndex - 1 + cases.length) % cases.length)}><ChevronLeft /></button><button aria-label="다음 사례" onClick={() => setCaseIndex((caseIndex + 1) % cases.length)}><ChevronRight /></button></div></div>
        <ReviewChart current={activeReview.currentCase} selected={selectedCase} />
        <div className={styles.caseStats}><Metric label="진입 후 수익률" value={percent(selectedCase.returnPercent)} tone={tone(selectedCase.returnPercent)} /><Metric label="MFE" value={percent(selectedCase.mfePercent)} /><Metric label="MAE" value={percent(selectedCase.maePercent)} tone="negative" /><Metric label="보유 기간" value={valueText(selectedCase.holdingDuration)} /></div>
        {caseIndex > 0 && <div className={styles.caseNarrative}><p><b>그때의 실수</b>{selectedCase.mistakeSummary ?? "확인 기록 없음"}</p><p><b>오늘과 같은 점</b>{selectedCase.sameAsToday ?? "계산되지 않음"}</p><p><b>오늘과 다른 점</b>{selectedCase.differentFromToday ?? "계산되지 않음"}</p></div>}
      </section>

      <section className={styles.checks}><h3>놓친 체크 포인트</h3><div className={styles.checkGrid}>{(Object.keys(checklistMeta) as Array<keyof typeof checklistMeta>).map((key) => <ChecklistCard key={key} category={key} items={activeReview.checklist[key] ?? []} />)}</div></section>

      <PortfolioImpact impact={activeReview.portfolioImpact} />

      <section className={styles.conditions}><h3>매도 및 관찰 기준</h3>{activeReview.watchConditions.length ? activeReview.watchConditions.map((condition) => { const enabled = enabledAlerts.includes(condition.id); const pending = pendingAlert === condition.id; const canCreate = condition.alertSupported && Boolean(condition.alertRequest); return <div key={condition.id}><span className={styles.conditionIcon}><CalendarClock /></span><p><strong>{condition.label}</strong><small>현재 {valueText(condition.currentValue)} · 기준 {condition.operator ?? ""} {valueText(condition.threshold)} · {condition.reason ?? "판단 근거 없음"}</small></p><em>{condition.recommendedAction ?? "관찰"}</em><button disabled={!canCreate || enabled || pending} title={!canCreate ? "현재 알람 API에서 지원하지 않는 조건입니다." : undefined} onClick={() => requestAlert(condition)}><Bell />{enabled ? "알람 추가됨" : pending ? "저장 중" : canCreate ? "알람 추가" : "알람 미지원"}</button></div>; }) : <p className={styles.empty}>계산되지 않음</p>}{alertError && <p className={styles.empty} role="alert">{alertError}</p>}</section>
    </div>
  );
}

function ChecklistCard({ category, items }: { category: keyof typeof checklistMeta; items: ChecklistItem[] }) {
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const meta = checklistMeta[category];
  const Icon = meta.icon;
  const missed = items.filter((item) => item.status === "unchecked");
  return <div
    className={styles.checkCard}
    tabIndex={0}
    aria-describedby={tooltipId}
    onFocus={() => setTooltipVisible(true)}
    onBlur={() => setTooltipVisible(false)}
    onMouseEnter={() => setTooltipVisible(true)}
    onMouseLeave={() => setTooltipVisible(false)}
  >
    <Icon aria-hidden="true" />
    <span>{meta.label}</span>
    <strong>{missed[0]?.label ?? items[0]?.label ?? "데이터 부족"}</strong>
    <small>{missed.length ? "미확인" : items.length ? "확인" : "데이터 부족"}</small>
    <div id={tooltipId} role="tooltip" className={styles.checkTooltip} data-visible={tooltipVisible ? "true" : "false"}>
      <b>{meta.label} 근거</b>
      {items.length ? items.map((item, index) => <p key={`${item.label}-${index}`}><strong>{item.label} · {statusLabel(item.status)}</strong><span>{item.evidence ?? "근거 데이터 부족"}</span><small>{item.source ?? "출처 없음"} · {item.sourceAsOf ?? "기준시각 없음"}</small></p>) : <p><span>데이터 연결 대기</span></p>}
    </div>
  </div>;
}

function ReviewChart({ current, selected }: { current: TradeCase; selected: TradeCase }) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [activeMarker, setActiveMarker] = useState<MissedCheck | null>(null);
  useEffect(() => { const node = host.current; if (!node || typeof ResizeObserver === "undefined") return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(560, Math.round(entry.contentRect.width)))); observer.observe(node); return () => observer.disconnect(); }, []);
  const height = 520, left = 50, right = width - 18, plotWidth = right - left;
  const series = selected.series.filter((point) => point.relativeDay >= -60 && point.relativeDay <= 20);
  const currentSeries = current.series.filter((point) => point.relativeDay >= -60 && point.relativeDay <= 20);
  const priceValues = series.flatMap((point) => [point.open, point.high, point.low, point.close]).filter(isNumber);
  const entry = selected.entryPrice ?? priceValues[0] ?? 1;
  const normalized = (value: number) => (value - entry) / entry * 100;
  const normalizedValues = priceValues.map(normalized);
  const minPrice = Math.min(-2, ...normalizedValues), maxPrice = Math.max(2, ...normalizedValues);
  const x = (day: number) => left + ((day + 60) / 80) * plotWidth;
  const scale = (value: number, min: number, max: number, top: number, bottom: number) => bottom - ((value - min) / Math.max(.0001, max - min)) * (bottom - top);
  const priceY = (value: number) => scale(normalized(value), minPrice, maxPrice, 18, 264);
  const volumes = series.map((p) => p.volume).filter(isNumber); const maxVolume = Math.max(1, ...volumes);
  const macdValues = series.flatMap((p) => [p.macd, p.signal, p.histogram]).filter(isNumber); const macdMax = Math.max(.1, ...macdValues.map(Math.abs));
  const currentPath = currentSeries.filter((p): p is ChartPoint & { close: number } => isNumber(p.close)).map((p) => `${x(p.relativeDay)},${priceYForCurrent(p.close, current.entryPrice ?? p.close, minPrice, maxPrice, 18, 264)}`).join(" ");
  const markerY = (marker: MissedCheck) => { const point = nearestPoint(series, marker.relativeDay ?? 0); if (marker.type === "rsi") return scale(point?.rsi ?? 50, 0, 100, 350, 410); if (marker.type === "macd") return scale(point?.macd ?? 0, -macdMax, macdMax, 430, 500); if (marker.type === "volume") return scale(point?.volume ?? 0, 0, maxVolume, 280, 335); return point?.close ? priceY(point.close) : 140; };
  return <div className={styles.chartHost} ref={host}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>진입 전후 T-60부터 T+20까지의 가격, 거래량, RSI, MACD</title><desc id={`${id}-desc`}>진입 시점과 놓친 판단 조건을 점선과 점으로 표시합니다. 오늘 거래의 미래 구간은 비어 있습니다.</desc>
      {[0, 100, 200, 300, 400, 500].map((day) => <line key={day} x1={left + day / 500 * plotWidth} x2={left + day / 500 * plotWidth} y1="18" y2="500" className={styles.gridLine} />)}
      {[-60, -40, -20, 0, 20].map((day) => <text key={day} x={x(day)} y="516" textAnchor="middle" className={styles.axis}>{day === 0 ? "Entry" : `T${day > 0 ? "+" : ""}${day}`}</text>)}
      <line x1={x(0)} x2={x(0)} y1="18" y2="500" className={styles.entryLine} /><text x={x(0) + 6} y="31" className={styles.entryText}>ENTRY</text>
      <text x="8" y="32" className={styles.panelLabel}>가격 %</text><text x="8" y="294" className={styles.panelLabel}>거래량</text><text x="8" y="366" className={styles.panelLabel}>RSI</text><text x="8" y="446" className={styles.panelLabel}>MACD</text>
      {series.map((point) => isNumber(point.open) && isNumber(point.high) && isNumber(point.low) && isNumber(point.close) ? <g key={point.relativeDay} className={point.close >= point.open ? styles.upCandle : styles.downCandle}><line x1={x(point.relativeDay)} x2={x(point.relativeDay)} y1={priceY(point.high)} y2={priceY(point.low)} /><rect x={x(point.relativeDay) - Math.max(1.5, plotWidth / 210)} width={Math.max(3, plotWidth / 105)} y={Math.min(priceY(point.open), priceY(point.close))} height={Math.max(1.5, Math.abs(priceY(point.open) - priceY(point.close)))} /></g> : null)}
      {currentPath && selected.caseId !== current.caseId && <polyline points={currentPath} className={styles.todayLine} />}
      {series.map((point) => isNumber(point.volume) ? <rect key={`v-${point.relativeDay}`} x={x(point.relativeDay) - 2} width="4" y={scale(point.volume, 0, maxVolume, 280, 335)} height={335 - scale(point.volume, 0, maxVolume, 280, 335)} className={styles.volumeBar} /> : null)}
      <line x1={left} x2={right} y1={scale(70, 0, 100, 350, 410)} y2={scale(70, 0, 100, 350, 410)} className={styles.threshold} />
      <polyline points={linePoints(series, "rsi", x, (v) => scale(v, 0, 100, 350, 410))} className={styles.rsiLine} />
      <line x1={left} x2={right} y1={scale(0, -macdMax, macdMax, 430, 500)} y2={scale(0, -macdMax, macdMax, 430, 500)} className={styles.zeroLine} />
      <polyline points={linePoints(series, "macd", x, (v) => scale(v, -macdMax, macdMax, 430, 500))} className={styles.macdLine} /><polyline points={linePoints(series, "signal", x, (v) => scale(v, -macdMax, macdMax, 430, 500))} className={styles.signalLine} />
      {selected.missedChecks.map((marker, index) => <g key={marker.id ?? `${marker.type}-${index}`} tabIndex={0} role="button" aria-label={`${marker.label}: ${valueText(marker.value)}, 기준 ${valueText(marker.threshold)}`} onFocus={() => setActiveMarker(marker)} onBlur={() => setActiveMarker(null)} onMouseEnter={() => setActiveMarker(marker)} onMouseLeave={() => setActiveMarker(null)}><line x1={x(marker.relativeDay ?? 0)} x2={x(marker.relativeDay ?? 0)} y1={Math.max(18, markerY(marker) - 22)} y2={Math.min(500, markerY(marker) + 22)} className={styles.markerGuide} /><circle cx={x(marker.relativeDay ?? 0)} cy={markerY(marker)} r="7" className={styles.markerDot} /></g>)}
    </svg>
    {activeMarker && <div className={styles.tooltip} role="status"><strong>{activeMarker.label}</strong><span>당시 {valueText(activeMarker.value)} · 기준 {valueText(activeMarker.threshold)}</span><p>{activeMarker.reason ?? "확인이 필요했던 조건입니다."}</p><small>{activeMarker.source ?? "출처 없음"} · {activeMarker.sourceAsOf ?? "기준시각 없음"}</small></div>}
    <div className={styles.legend}><span>캔들: 선택 사례</span><span>파란선: 오늘 경로</span><span>빨간점: 놓친 확인</span><span>미래 예측 없음</span></div>
  </div>;
}

function PortfolioImpact({ impact }: { impact: DailyTradeReview["portfolioImpact"] }) {
  const rows = [["종목 비중", impact.symbolWeightBefore, impact.symbolWeightAfter], ["섹터 비중", impact.sectorWeightBefore, impact.sectorWeightAfter], ["현금 비중", impact.cashWeightBefore, impact.cashWeightAfter], ["상위 종목 집중도", impact.topHoldingsConcentrationBefore, impact.topHoldingsConcentrationAfter]];
  return <section className={styles.portfolio}><h3>포트폴리오 영향</h3><div className={styles.tableWrap}><table><thead><tr><th>항목</th><th>변경 전</th><th>변경 후</th><th>변화</th><th>영향 및 리스크</th></tr></thead><tbody>{rows.map(([label, before, after], index) => { const a = typeof before === "number" ? before : null, b = typeof after === "number" ? after : null; return <tr key={String(label)}><td>{String(label)}</td><td>{percent(a)}</td><td>{percent(b)}</td><td>{a != null && b != null ? `${b - a > 0 ? "+" : ""}${(b - a).toFixed(1)}%p` : "계산되지 않음"}</td><td>{impact.riskFlags?.[index] ?? "계산되지 않음"}</td></tr>; })}</tbody></table></div></section>;
}

function EmptyCoach({ report }: { report: CoachReport | null }) { return <div className={styles.emptyPage}><CircleAlert /><h2>당일 거래 회고</h2><p>{report?.warnings[0] ?? "데이터 연결 대기"}</p><small>실제 체결과 분석 report가 준비되면 표시됩니다.</small></div>; }
function Metric({ label, value, tone: color }: { label: string; value: string; tone?: string }) { return <div className={styles.metric}><span>{label}</span><strong className={color ? styles[color] : undefined}>{value}</strong></div>; }
function nearestPoint(points: ChartPoint[], day: number) { return points.reduce<ChartPoint | undefined>((best, point) => !best || Math.abs(point.relativeDay - day) < Math.abs(best.relativeDay - day) ? point : best, undefined); }
function linePoints(points: ChartPoint[], key: "rsi" | "macd" | "signal", x: (v: number) => number, y: (v: number) => number) { return points.filter((p) => isNumber(p[key])).map((p) => `${x(p.relativeDay)},${y(p[key] as number)}`).join(" "); }
function priceYForCurrent(value: number, entry: number, min: number, max: number, top: number, bottom: number) { const normalized = (value - entry) / entry * 100; return bottom - ((normalized - min) / Math.max(.0001, max - min)) * (bottom - top); }
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
function sideLabel(value: unknown) { return String(value).toLowerCase() === "sell" ? "매도" : "매수"; }
function gradeLabel(value: string) { return ({ good: "양호", attention: "주의", risk: "위험", insufficient_data: "데이터 부족" } as Record<string, string>)[value] ?? "데이터 부족"; }
function statusLabel(value: string) { return ({ checked: "확인", unchecked: "미확인", insufficient_data: "데이터 부족", not_applicable: "해당 없음" } as Record<string, string>)[value] ?? value; }
function formatDate(value?: string | null) { if (!value) return "일정 확인 불가"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date); }
function formatDateTime(value?: string | null) { if (!value) return "체결시각 확인 불가"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(date); }
function formatAsOf(value?: Record<string, string | null>) { const dates = Object.values(value ?? {}).filter((item): item is string => Boolean(item)); return dates.length ? `데이터 기준 ${formatDateTime(dates.sort().at(-1))}` : "기준시각 확인 불가"; }
