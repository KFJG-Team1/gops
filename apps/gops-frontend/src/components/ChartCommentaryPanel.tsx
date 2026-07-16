import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { chartExplanationMatchesAsset, chartExplanationMatchesSource, type ChartExplanationAnchor } from "../agent/chartExplanation";
import {
  normalizeChartCommentaryState,
  setChartCommentaryActiveView,
  type ChartCommentaryAnswer,
  type ChartCommentaryState
} from "../agent/chartCommentaryHistory";
import { fetchAnalysisAssets, subscribeAnalysisAssetsInvalidation, type AnalysisAssetInterval, type ChartAnalysisAsset } from "../chart/analysisAssetsApi";
import { analysisAssetPresentationDiagnostics, candleKeyForTimestamp, formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import { buildChartCommentaryModel } from "../chart/commentaryModel";
import { projectChartTradeSetup } from "../chart/chartTradeSetup";
import { getActiveTradePlan, subscribeActiveTradePlans, type ActiveTradePlan } from "../chart/tradePlanStore";
import type { CandleDto, ChartInterval } from "../chart/types";
import { GlossaryText } from "../glossary/GlossaryText";
import { AnalysisAnswerPage } from "./AnalysisAnswerPage";

type ChartCommentaryPanelProps = {
  chartDocumentId?: string;
  sourceAvailable?: boolean;
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
  commentaryState?: unknown;
  onCommentaryStateChange?: (state: ChartCommentaryState) => void;
  chartOptions?: Array<{ chartDocumentId: string; symbol: string; interval: string }>;
  chartSelectionActive?: boolean;
  onChartSelectionToggle?: () => void;
  onChartDocumentChange?: (chartDocumentId: string) => void;
};

export function ChartCommentaryPanel({
  chartDocumentId,
  sourceAvailable = true,
  symbol,
  interval,
  candles,
  drawingIds,
  commentaryState: rawCommentaryState,
  onCommentaryStateChange,
  chartOptions = [],
  chartSelectionActive = false,
  onChartSelectionToggle,
  onChartDocumentChange
}: ChartCommentaryPanelProps) {
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof fetchAnalysisAssets>> | null>(null);
  const [revision, setRevision] = useState(0);
  const normalizedSymbol = symbol.trim().toUpperCase();
  const state = useMemo(
    () => normalizeChartCommentaryState(rawCommentaryState, chartDocumentId ?? "unbound"),
    [chartDocumentId, rawCommentaryState]
  );
  const activeAnswer = state.activeView === "current"
    ? null
    : state.answers.find((answer) => answer.analysisId === state.activeView) ?? null;
  const activePlan = useSyncExternalStore(
    subscribeActiveTradePlans,
    () => chartDocumentId ? getActiveTradePlan(chartDocumentId) : null,
    () => null
  );

  useEffect(() => subscribeAnalysisAssetsInvalidation((invalidatedSymbol) => {
    if (!invalidatedSymbol || invalidatedSymbol === normalizedSymbol) {
      setAssets(null);
      setRevision((current) => current + 1);
    }
  }), [normalizedSymbol]);

  useEffect(() => {
    if (!sourceAvailable || !isAnalysisAssetInterval(interval)) {
      setAssets(null);
      return undefined;
    }
    let active = true;
    fetchAnalysisAssets(normalizedSymbol).then((response) => {
      if (active) setAssets(response);
    }).catch(() => {
      if (active) setAssets(null);
    });
    return () => { active = false; };
  }, [interval, normalizedSymbol, revision, sourceAvailable]);

  useEffect(() => () => {
    if (chartDocumentId) dispatchFocus(chartDocumentId, normalizedSymbol, interval, [], "clear");
  }, [chartDocumentId, interval, normalizedSymbol]);

  const changeActiveView = (activeView: string) => {
    onCommentaryStateChange?.(setChartCommentaryActiveView(state, activeView));
    if (chartDocumentId) dispatchFocus(chartDocumentId, normalizedSymbol, interval, [], "clear");
  };
  const asset = isAnalysisAssetInterval(interval) ? assets?.assets[interval] ?? null : null;

  return (
    <article className="chart-commentary-shell">
      <header className="chart-commentary-source">
        <strong>{normalizedSymbol} · {interval}</strong>
        <button type="button" className={chartSelectionActive ? "is-active" : ""} aria-pressed={chartSelectionActive} onClick={onChartSelectionToggle}>차트 선택</button>
        {chartSelectionActive && chartOptions.length > 1 && <select aria-label="연결할 차트" value={chartDocumentId ?? ""} onChange={(event) => onChartDocumentChange?.(event.target.value)}>
          {chartOptions.map((option) => <option key={option.chartDocumentId} value={option.chartDocumentId}>{option.symbol} · {option.interval}</option>)}
        </select>}
      </header>
      <nav className="chart-commentary-view-nav" aria-label="차트 해설 보기">
        <button
          type="button"
          className={state.activeView === "current" ? "is-active" : ""}
          aria-pressed={state.activeView === "current"}
          onClick={() => changeActiveView("current")}
        >현재 해설</button>
        <select
          aria-label="질문 답변 선택"
          value={activeAnswer?.analysisId ?? ""}
          disabled={state.answers.length === 0}
          onChange={(event) => changeActiveView(event.target.value)}
        >
          <option value="">질문 답변 {state.answers.length}개</option>
          {[...state.answers].reverse().map((answer) => (
            <option key={answer.analysisId} value={answer.analysisId}>{answer.symbol} {answer.interval} · {answer.question}</option>
          ))}
        </select>
      </nav>
      {state.pending && (
        <p className="chart-commentary-pending" role="status">
          <GlossaryText text={`${state.pending.snapshot.symbol} ${state.pending.snapshot.interval} 질문을 분석하고 있습니다. 현재 해설은 그대로 유지됩니다.`} />
        </p>
      )}
      {activeAnswer
        ? <QuestionAnswer
          answer={activeAnswer}
          chartDocumentId={chartDocumentId}
          sourceAvailable={sourceAvailable}
          currentAsset={asset}
          activePlan={activePlan}
          currentSymbol={normalizedSymbol}
          currentInterval={interval}
          candles={candles}
          drawingIds={drawingIds}
        />
        : <CurrentCommentary
          chartDocumentId={chartDocumentId}
          sourceAvailable={sourceAvailable}
          symbol={normalizedSymbol}
          interval={interval}
          candles={candles}
          drawingIds={drawingIds}
          asset={asset}
          availableAssets={assets?.assets}
        />}
    </article>
  );
}

function CurrentCommentary({ chartDocumentId, sourceAvailable, symbol, interval, candles, drawingIds, asset, availableAssets }: {
  chartDocumentId?: string;
  sourceAvailable: boolean;
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
  asset: ChartAnalysisAsset | null;
  availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>;
}) {
  const metricIdPrefix = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [pinnedStepId, setPinnedStepId] = useState<string | null>(null);
  const drawingIdsKey = drawingIds.join("\u0000");
  const diagnostics = useMemo(() => asset
    ? analysisAssetPresentationDiagnostics(asset, candles, drawingIds, availableAssets)
    : null, [asset, availableAssets, candles, drawingIdsKey]);
  const setup = useMemo(() => diagnostics
    ? projectChartTradeSetup(diagnostics.resolvedAsset, candles, availableAssets)
    : null, [availableAssets, candles, diagnostics]);
  const model = useMemo(() => diagnostics
    ? buildChartCommentaryModel(diagnostics.resolvedAsset, setup)
    : [], [diagnostics, setup]);
  useEffect(() => {
    setPinnedStepId(null);
  }, [asset?.algorithmVersion, asset?.asOf, asset?.inputDigest, chartDocumentId, interval, symbol]);
  if (!sourceAvailable) return <Empty text="원본 차트 없음" />;
  if (!isAnalysisAssetInterval(interval)) return <Empty text="이 interval은 Geometry 작도를 지원하지 않습니다" />;
  if (!asset) return <Empty text="Geometry 자산이 준비되지 않았습니다" />;
  if (!diagnostics) return <Empty text="Geometry 자산을 해석할 수 없습니다" />;
  const focusStep = (stepId: string | null, mode: FocusMode) => {
    if (!chartDocumentId) return;
    const step = model.find((candidate) => candidate.id === stepId);
    dispatchFocus(
      chartDocumentId,
      symbol,
      interval,
      step?.drawingIds ?? [],
      step ? mode : "clear",
      undefined,
      step?.focusPrice,
      step?.candidateIds,
      step?.evidenceRefs
    );
  };
  const restorePinned = () => {
    focusStep(pinnedStepId, pinnedStepId ? "select" : "clear");
  };
  return (
    <article className="chart-commentary-panel">
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{symbol} · {interval}</span>
        <span className={diagnostics.stale ? "is-stale" : ""}>분석 기준 {formatAnalysisAssetAsOf(asset.asOf)}</span>
        <span className="chart-commentary-badge is-muted">{asset.coverage.state}</span>
      </header>
      <h3 className="chart-commentary-headline"><GlossaryText text="차트 해설" /></h3>
      <p className="chart-commentary-text"><GlossaryText text={`적용된 근거·제안 작도 ${diagnostics.appliedDrawingCount}개`} /></p>
      <section className="chart-commentary-focus" aria-label="차트 시나리오 단계">
        <ol>{model.map((step) => {
          const pinned = pinnedStepId === step.id;
          const metricPanelId = `chart-commentary-${metricIdPrefix}-metrics-${step.id}`;
          return <li key={step.id}>
            <button
              className={pinned ? "is-pinned" : undefined}
              type="button"
              aria-expanded={pinned}
              aria-controls={metricPanelId}
              onMouseEnter={() => focusStep(step.id, "spotlight")}
              onMouseLeave={restorePinned}
              onFocus={() => focusStep(step.id, "spotlight")}
              onBlur={restorePinned}
              onClick={() => {
                const next = pinned ? null : step.id;
                setPinnedStepId(next);
                focusStep(next, next ? "select" : "clear");
              }}
            >
              <strong><GlossaryText text={step.title} /></strong>
              <span><GlossaryText text={step.body} /></span>
            </button>
            <div id={metricPanelId} className="chart-commentary-metric-panel" hidden={!pinned}>
              {step.metricCards?.length
                ? step.metricCards.map((card) => <section key={card.id} className="chart-commentary-metric-card">
                  <h4>{card.title}</h4>
                  <dl>{card.items.map((item) => <div key={`${card.id}-${item.label}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                </section>)
                : <p>저장된 수치 근거가 없습니다.</p>}
            </div>
          </li>;
        })}</ol>
      </section>
      {diagnostics.stale && <p className="chart-commentary-invalidation"><GlossaryText text="새 완료 봉이 있어 낮은 불투명도로 이전 자산을 표시합니다." /></p>}
    </article>
  );
}

function QuestionAnswer({ answer, chartDocumentId, sourceAvailable, currentAsset, activePlan, currentSymbol, currentInterval, candles, drawingIds }: {
  answer: ChartCommentaryAnswer;
  chartDocumentId?: string;
  sourceAvailable: boolean;
  currentAsset: ChartAnalysisAsset | null;
  activePlan: ActiveTradePlan | null;
  currentSymbol: string;
  currentInterval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
}) {
  const explanation = answer.chartExplanation;
  const sourceMatches = sourceAvailable && chartExplanationMatchesSource(explanation, chartDocumentId);
  const identityMatches = sourceMatches && chartExplanationMatchesAsset(explanation, currentAsset);
  const availableDrawingIds = new Set(drawingIds);
  const groups = explanation.focusGroups;
  const focusActions = [
    { key: "evidence", label: "전체 근거", ids: groups?.evidence ?? explanation.focusIds },
    { key: "levels", label: "지지·저항", ids: groups?.levels ?? [...(groups?.support ?? []), ...(groups?.resistance ?? [])] },
    { key: "trend", label: "추세", ids: groups?.trend ?? [] },
    { key: "pattern", label: "패턴", ids: groups?.pattern ?? [] },
  ].map((item) => ({ ...item, ids: item.ids.filter((id) => availableDrawingIds.has(id)) }))
    .filter((item) => identityMatches && item.ids.length > 0);
  const planMatches = Boolean(sourceMatches && activePlan && chartExplanationMatchesAsset(explanation, {
    ...activePlan.provenance,
    symbol: activePlan.symbol,
    interval: activePlan.interval
  }));
  if (planMatches && explanation.facts.tradeScenario && activePlan) {
    const ids = [activePlan.drawingIds.plan, activePlan.drawingIds.signal].filter((id) => availableDrawingIds.has(id));
    if (ids.length > 0) focusActions.push({
      key: "proposal",
      label: "트레이드 플랜",
      ids
    });
  }
  const anchor = sourceAvailable
    && currentSymbol === explanation.symbol
    && currentInterval === explanation.interval
    ? currentAnchor(explanation.anchor, candles, explanation.interval)
    : null;
  const canFocus = Boolean(chartDocumentId && sourceMatches);
  const focus = (ids: string[], mode: FocusMode, targetAnchor?: ChartExplanationAnchor | null) => {
    if (chartDocumentId && canFocus) dispatchFocus(chartDocumentId, explanation.symbol, explanation.interval, ids, mode, targetAnchor);
  };
  return <AnalysisAnswerPage
    kicker="질문 답변"
    symbol={answer.symbol}
    title={answer.finalAnswer.title}
    summary={answer.finalAnswer.summary}
    sections={answer.finalAnswer.sections}
    citations={answer.finalAnswer.citations}
    limitations={answer.finalAnswer.limitations}
    warnings={answer.warnings}
    className="chart-commentary-answer"
    beforeBody={<>
      <p className="chart-commentary-question"><GlossaryText text={`질문: ${answer.question}`} /></p>
      <div className="chart-commentary-meta">
        <span className="chart-commentary-badge">{answer.interval}</span>
        <span>요청 기준 {formatAnalysisAssetAsOf(answer.asOf)}</span>
        {explanation.quality.stale && <span className="chart-commentary-badge is-stale">stale</span>}
        {!sourceAvailable && <span className="chart-commentary-badge is-stale">원본 차트 없음</span>}
        {sourceAvailable && !identityMatches && <span className="chart-commentary-badge is-stale">분석 기준 변경됨</span>}
      </div>
      {canFocus && (focusActions.length > 0 || anchor) && (
        <div className="chart-commentary-answer-focus" aria-label="답변 근거 포커스">
          {focusActions.map((action) => <FocusButton key={action.key} drawingIds={action.ids} onFocus={focus}>{action.label}</FocusButton>)}
          {anchor && <FocusButton drawingIds={[]} anchor={anchor} onFocus={focus}>선택 봉</FocusButton>}
        </div>
      )}
    </>}
  />;
}

function FocusButton({ drawingIds, anchor, price, onFocus, children }: {
  drawingIds: string[];
  anchor?: ChartExplanationAnchor | null;
  price?: number;
  onFocus: (ids: string[], mode: FocusMode, anchor?: ChartExplanationAnchor | null, price?: number) => void;
  children: ReactNode;
}) {
  const [pinned, setPinned] = useState(false);
  return <button
    className={pinned ? "is-pinned" : undefined}
    aria-pressed={pinned}
    type="button"
    onMouseEnter={() => onFocus(drawingIds, "spotlight", anchor, price)}
    onMouseLeave={() => { if (!pinned) onFocus([], "clear"); }}
    onFocus={() => onFocus(drawingIds, "spotlight", anchor, price)}
    onBlur={() => { if (!pinned) onFocus([], "clear"); }}
    onClick={() => {
      const next = !pinned;
      setPinned(next);
      onFocus(next ? drawingIds : [], next ? "select" : "clear", anchor, next ? price : undefined);
    }}
  >{children}</button>;
}

function currentAnchor(anchor: ChartExplanationAnchor | null, candles: CandleDto[], interval: string): ChartExplanationAnchor | null {
  if (!anchor?.timestamp || !isAnalysisAssetIntervalValue(interval)) return null;
  const key = candleKeyForTimestamp(anchor.timestamp, interval);
  if (!key) return null;
  const candle = candles.find((item) => candleKeyForTimestamp(item.timestamp, interval) === key);
  return candle ? { ...anchor, timestamp: candle.timestamp } : null;
}

function Empty({ text }: { text: string }) {
  return <div className="chart-commentary-empty" role="status"><GlossaryText text={text} /></div>;
}

type FocusMode = "select" | "spotlight" | "clear";

function isAnalysisAssetInterval(interval: ChartInterval): interval is AnalysisAssetInterval {
  return isAnalysisAssetIntervalValue(interval);
}

function isAnalysisAssetIntervalValue(interval: string): interval is AnalysisAssetInterval {
  return ["1m", "5m", "10m", "1h", "4h", "1D", "1W"].includes(interval);
}

function dispatchFocus(
  chartDocumentId: string,
  symbol: string,
  interval: string,
  drawingIds: string[],
  mode: FocusMode,
  anchor?: ChartExplanationAnchor | null,
  price?: number,
  candidateIds?: string[],
  evidenceRefs?: string[]
) {
  window.dispatchEvent(new CustomEvent("gops:chart-asset-focus", {
    detail: {
      chartDocumentId,
      symbol,
      interval,
      drawingIds,
      mode,
      ...(anchor ? { anchor } : {}),
      ...(typeof price === "number" && Number.isFinite(price) ? { price } : {}),
      ...(candidateIds?.length ? { candidateIds } : {}),
      ...(evidenceRefs?.length ? { evidenceRefs } : {})
    }
  }));
}
