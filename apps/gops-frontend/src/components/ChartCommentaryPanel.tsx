import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
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
};

export function ChartCommentaryPanel({
  chartDocumentId,
  sourceAvailable = true,
  symbol,
  interval,
  candles,
  drawingIds,
  commentaryState: rawCommentaryState,
  onCommentaryStateChange
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
          activePlan={activePlan}
        />}
    </article>
  );
}

function CurrentCommentary({ chartDocumentId, sourceAvailable, symbol, interval, candles, drawingIds, asset, activePlan }: {
  chartDocumentId?: string;
  sourceAvailable: boolean;
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
  asset: ChartAnalysisAsset | null;
  activePlan: ActiveTradePlan | null;
}) {
  if (!sourceAvailable) return <Empty text="원본 차트 없음" />;
  if (!isAnalysisAssetInterval(interval)) return <Empty text="이 interval은 Geometry 작도를 지원하지 않습니다" />;
  if (!asset) return <Empty text="Geometry 자산이 준비되지 않았습니다" />;
  const diagnostics = analysisAssetPresentationDiagnostics(asset, candles, drawingIds);
  const model = buildChartCommentaryModel(diagnostics.resolvedAsset, activePlan);
  const focusDrawing = (ids: string[], mode: FocusMode) => {
    if (chartDocumentId) dispatchFocus(chartDocumentId, symbol, interval, ids, mode);
  };
  return (
    <article className="chart-commentary-panel">
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{interval}</span>
        <span className={diagnostics.stale ? "is-stale" : ""}>분석 기준 {formatAnalysisAssetAsOf(asset.asOf)}</span>
        <span className="chart-commentary-badge is-muted">{asset.coverage.state}</span>
      </header>
      <h3 className="chart-commentary-headline"><GlossaryText text="차트 해설" /></h3>
      <p className="chart-commentary-text"><GlossaryText text={`적용된 근거·제안 작도 ${diagnostics.appliedDrawingCount}개`} /></p>
      <section className="chart-commentary-focus" aria-label="차트 시나리오 단계">
        <ol>{model.map((step) => <li key={step.id}>
          <FocusButton
            drawingIds={step.drawingIds}
            onFocus={(ids, mode) => focusDrawing(ids, mode)}
          >
            <strong><GlossaryText text={step.title} /></strong>
            <span><GlossaryText text={step.body} /></span>
          </FocusButton>
        </li>)}</ol>
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
    { key: "pattern", label: "패턴", ids: groups?.pattern ?? [] },
    { key: "support", label: "지지", ids: groups?.support ?? [] },
    { key: "resistance", label: "저항", ids: groups?.resistance ?? [] }
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

function FocusButton({ drawingIds, anchor, onFocus, children }: {
  drawingIds: string[];
  anchor?: ChartExplanationAnchor | null;
  onFocus: (ids: string[], mode: FocusMode, anchor?: ChartExplanationAnchor | null) => void;
  children: ReactNode;
}) {
  return <button
    type="button"
    onMouseEnter={() => onFocus(drawingIds, "spotlight", anchor)}
    onMouseLeave={() => onFocus([], "clear")}
    onFocus={() => onFocus(drawingIds, "spotlight", anchor)}
    onBlur={() => onFocus([], "clear")}
    onClick={() => onFocus(drawingIds, "select", anchor)}
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
  anchor?: ChartExplanationAnchor | null
) {
  window.dispatchEvent(new CustomEvent("gops:chart-asset-focus", {
    detail: { chartDocumentId, symbol, interval, drawingIds, mode, ...(anchor ? { anchor } : {}) }
  }));
}
