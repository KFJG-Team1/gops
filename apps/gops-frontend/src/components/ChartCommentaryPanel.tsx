import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { chartExplanationMatchesAsset, chartExplanationMatchesSource, type ChartExplanationAnchor } from "../agent/chartExplanation";
import {
  normalizeChartCommentaryState,
  setChartCommentaryMode,
  type ChartCommentaryAnswer,
  type ChartCommentaryPending,
  type ChartCommentaryState
} from "../agent/chartCommentaryHistory";
import { fetchAnalysisAssets, subscribeAnalysisAssetsInvalidation, type AnalysisAssetInterval, type ChartAnalysisAsset } from "../chart/analysisAssetsApi";
import { analysisAssetPresentationDiagnostics, candleKeyForTimestamp, formatAnalysisAssetAsOf } from "../chart/analysisAssetPresentation";
import { buildChartCommentaryViewModel, type ChartCommentaryScenario } from "../chart/commentaryModel";
import { dispatchChartAnalysisLayerToggle } from "../chart/analysisLayerController";
import { chartCommentaryHoldingDisplay } from "../chart/commentaryHoldings";
import { projectChartTradeSetup } from "../chart/chartTradeSetup";
import { getActiveTradePlan, subscribeActiveTradePlans, type ActiveTradePlan } from "../chart/tradePlanStore";
import type { CandleDto, ChartInterval } from "../chart/types";
import { GlossaryText } from "../glossary/GlossaryText";
import { usePortfolioHoldingsData } from "./PortfolioHoldingsPanel";
import type { PortfolioPosition } from "./portfolioHoldingsApi";

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
  const activePlan = useSyncExternalStore(
    subscribeActiveTradePlans,
    () => chartDocumentId ? getActiveTradePlan(chartDocumentId) : null,
    () => null
  );
  const holdings = usePortfolioHoldingsData(undefined, "kis");
  const holding = useMemo(
    () => holdings.positions.find((position) => position.symbol.trim().toUpperCase() === normalizedSymbol) ?? null,
    [holdings.positions, normalizedSymbol]
  );
  const verifiedHolding = holdings.loading || holdings.error ? null : holding;

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

  const changeMode = (mode: ChartCommentaryState["mode"]) => {
    onCommentaryStateChange?.(setChartCommentaryMode(state, mode));
    if (chartDocumentId) dispatchFocus(chartDocumentId, normalizedSymbol, interval, [], "clear");
  };
  const asset = isAnalysisAssetInterval(interval) ? assets?.assets[interval] ?? null : null;
  const diagnostics = useMemo(() => asset
    ? analysisAssetPresentationDiagnostics(asset, candles, drawingIds, assets?.assets)
    : null, [asset, assets?.assets, candles, drawingIds]);
  const hasConversation = state.turns.length > 0 || Boolean(state.pending);
  const freshnessLabel = diagnostics?.stale
    ? "데이터 불일치"
    : diagnostics?.outdated
      ? `${diagnostics.freshness.lagBars}봉 전`
      : asset ? "최신" : "분석 없음";

  return (
    <article className="chart-commentary-shell">
      <header className="chart-commentary-source">
        <strong>{normalizedSymbol} · {interval}</strong>
        <span className="chart-commentary-source-meta">{freshnessLabel}{asset ? ` · ${formatAnalysisAssetAsOf(asset.asOf)}` : ""}</span>
        {chartOptions.length > 1 && <button type="button" className={chartSelectionActive ? "is-active" : ""} aria-pressed={chartSelectionActive} onClick={onChartSelectionToggle}>연결</button>}
        {hasConversation && <button
          type="button"
          aria-pressed={state.mode === "conversation"}
          onClick={() => changeMode(state.mode === "conversation" ? "commentary" : "conversation")}
        >{state.mode === "conversation" ? "해설" : "대화"}</button>}
        {chartSelectionActive && chartOptions.length > 1 && <select aria-label="연결할 차트" value={chartDocumentId ?? ""} onChange={(event) => onChartDocumentChange?.(event.target.value)}>
          {chartOptions.map((option) => <option key={option.chartDocumentId} value={option.chartDocumentId}>{option.symbol} · {option.interval}</option>)}
        </select>}
      </header>
      {state.mode === "commentary" && state.pending && (
        <p className="chart-commentary-pending" role="status">
          <GlossaryText text={`${state.pending.snapshot.symbol} ${state.pending.snapshot.interval} 질문을 분석하고 있습니다. 현재 해설은 그대로 유지됩니다.`} />
        </p>
      )}
      {state.mode === "conversation"
        ? <ConversationView
          turns={state.turns}
          pending={state.pending}
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
          holding={verifiedHolding}
          holdingsLoading={holdings.loading}
          holdingsError={holdings.error}
          holdingsErrorStatus={holdings.errorStatus}
        />}
    </article>
  );
}

function CurrentCommentary({
  chartDocumentId, sourceAvailable, symbol, interval, candles, drawingIds, asset, availableAssets,
  holding, holdingsLoading, holdingsError, holdingsErrorStatus
}: {
  chartDocumentId?: string;
  sourceAvailable: boolean;
  symbol: string;
  interval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
  asset: ChartAnalysisAsset | null;
  availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>;
  holding: PortfolioPosition | null;
  holdingsLoading: boolean;
  holdingsError?: string;
  holdingsErrorStatus?: number;
}) {
  const [pinnedStepId, setPinnedStepId] = useState<string | null>(null);
  const drawingIdsKey = drawingIds.join("\u0000");
  const diagnostics = useMemo(() => asset
    ? analysisAssetPresentationDiagnostics(asset, candles, drawingIds, availableAssets)
    : null, [asset, availableAssets, candles, drawingIdsKey]);
  const setup = useMemo(() => diagnostics
    ? projectChartTradeSetup(diagnostics.resolvedAsset, candles, availableAssets)
    : null, [availableAssets, candles, diagnostics]);
  const currentPrice = useMemo(() => {
    const candle = [...candles].reverse().find((item) => Number.isFinite(item.close) && item.close > 0);
    return candle?.close ?? null;
  }, [candles]);
  const viewModel = useMemo(() => diagnostics
    ? buildChartCommentaryViewModel(diagnostics.resolvedAsset, setup, currentPrice, holding)
    : null, [currentPrice, diagnostics, holding, setup]);
  useEffect(() => {
    setPinnedStepId(null);
  }, [asset?.algorithmVersion, asset?.asOf, asset?.inputDigest, chartDocumentId, interval, symbol]);
  const emptyText = !sourceAvailable
    ? "연결된 원본 차트가 없습니다"
    : !isAnalysisAssetInterval(interval)
      ? "이 주기는 차트 해설을 지원하지 않습니다"
      : !asset
        ? "아직 생성된 차트 해설이 없습니다"
        : !diagnostics || !viewModel
          ? "차트 해설을 불러오지 못했습니다"
          : null;
  const focusStep = (stepId: string | null, mode: FocusMode) => {
    if (!chartDocumentId) return;
    const step = viewModel?.evidence.find((candidate) => candidate.id === stepId);
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
      <HoldingSummary
        holding={holding}
        loading={holdingsLoading}
        error={holdingsError}
        errorStatus={holdingsErrorStatus}
      />
      {emptyText || !diagnostics || !viewModel || !asset
        ? <Empty text={emptyText ?? "차트 해설을 불러오지 못했습니다"} />
        : <>
      <section className="chart-commentary-summary" aria-label="종합 해설">
        {viewModel.summary.map((sentence) => <p key={sentence}><GlossaryText text={sentence} /></p>)}
      </section>
      {viewModel.keyPrices.length > 0 && <section className="chart-commentary-key-prices" aria-label="주요 가격">
        <div className="chart-commentary-price-table" role="table">
          <div className="chart-commentary-price-head" role="row">
            <span role="columnheader">기준</span><span role="columnheader">가격</span><span role="columnheader">현재가 대비</span>
          </div>
          {viewModel.keyPrices.map((item) => <button
            key={item.id}
            type="button"
            role="row"
            onMouseEnter={() => chartDocumentId && dispatchFocus(chartDocumentId, symbol, interval, item.drawingIds, "spotlight", undefined, item.price)}
            onMouseLeave={restorePinned}
            onFocus={() => chartDocumentId && dispatchFocus(chartDocumentId, symbol, interval, item.drawingIds, "spotlight", undefined, item.price)}
            onBlur={restorePinned}
          >
            <span role="cell">{item.label}</span>
            <strong role="cell">{formatPrice(item.price)}</strong>
            <span role="cell">{item.distancePercent == null ? "—" : `${item.distancePercent >= 0 ? "+" : ""}${item.distancePercent.toFixed(2)}%`}</span>
          </button>)}
        </div>
      </section>}
      {viewModel.scenario && <CommentaryScenarioButton
        scenario={viewModel.scenario}
        chartDocumentId={chartDocumentId}
        symbol={symbol}
        interval={interval}
        onRestore={restorePinned}
      />}
      <section className="chart-commentary-focus" aria-label="판단 근거">
        <ol>{viewModel.evidence.map((step) => {
          const pinned = pinnedStepId === step.id;
          return <li key={step.id}>
            <button
              className={pinned ? "is-pinned" : undefined}
              type="button"
              aria-pressed={pinned}
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
          </li>;
        })}</ol>
      </section>
      <details className="chart-commentary-metrics">
        <summary>수치 근거 자세히</summary>
        {viewModel.evidence.flatMap((step) => step.metricCards ?? []).length > 0
          ? viewModel.evidence.flatMap((step) => step.metricCards ?? []).map((card) => <section key={card.id} className="chart-commentary-metric-card">
            <h4>{card.title}</h4>
            <dl>{card.items.map((item) => <div key={`${card.id}-${item.label}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          </section>)
          : <p>저장된 수치 근거가 없습니다.</p>}
      </details>
      {diagnostics.outdated && <p className="chart-commentary-invalidation"><GlossaryText text={`${diagnostics.freshness.lagBars}개 완료 봉 전 분석 스냅샷입니다. 당시 작도를 원래 선명도로 표시합니다.`} /></p>}
      {diagnostics.stale && <p className="chart-commentary-invalidation"><GlossaryText text="자산 기준 봉과 데이터 watermark가 일치하지 않아 작도를 낮은 불투명도로 표시합니다." /></p>}
        </>}
    </article>
  );
}

function CommentaryScenarioButton({ scenario, chartDocumentId, symbol, interval, onRestore }: {
  scenario: ChartCommentaryScenario;
  chartDocumentId?: string;
  symbol: string;
  interval: ChartInterval;
  onRestore: () => void;
}) {
  const pointerActiveRef = useRef(false);
  const keyboardFocusRef = useRef(false);
  const pointerFocusRef = useRef(false);
  const spotlight = () => {
    if (chartDocumentId) dispatchFocus(chartDocumentId, symbol, interval, scenario.drawingIds, "spotlight");
  };
  return <button
    type="button"
    className="chart-commentary-scenario"
    aria-label={`${scenario.status} 제안 레이어 전환`}
    disabled={!chartDocumentId}
    onPointerEnter={() => {
      pointerActiveRef.current = true;
      spotlight();
    }}
    onPointerLeave={() => {
      pointerActiveRef.current = false;
      if (!keyboardFocusRef.current) onRestore();
    }}
    onPointerDown={() => { pointerFocusRef.current = true; }}
    onPointerUp={() => { pointerFocusRef.current = false; }}
    onFocus={() => {
      if (pointerFocusRef.current) return;
      keyboardFocusRef.current = true;
      spotlight();
    }}
    onBlur={() => {
      keyboardFocusRef.current = false;
      pointerFocusRef.current = false;
      if (!pointerActiveRef.current) onRestore();
    }}
    onClick={() => {
      if (chartDocumentId) dispatchChartAnalysisLayerToggle({ chartDocumentId, layer: "proposal" });
    }}
  >
    <span className="chart-commentary-scenario-status">{scenario.status}</span>
    <span className="chart-commentary-scenario-line">{scenario.confirmation} · {scenario.labels.target} {formatPrice(scenario.targetPrice)} · {scenario.labels.risk} {formatPrice(scenario.invalidationPrice)}</span>
    <span className="chart-commentary-scenario-line">손익비 1 : {scenario.rewardRiskRatio.toFixed(2)} · 유효기간 {scenario.projectionBars}개 봉</span>
  </button>;
}

function HoldingSummary({ holding, loading, error, errorStatus }: {
  holding: PortfolioPosition | null;
  loading: boolean;
  error?: string;
  errorStatus?: number;
}) {
  const display = chartCommentaryHoldingDisplay(holding, loading, error, errorStatus);
  return <section className="chart-commentary-holding" aria-label="실계좌 보유 현황">
    <table>
      <thead><tr><th>보유 상태</th><th>평균 매입가</th><th>보유 수량</th></tr></thead>
      <tbody><tr>
        <td>{display.status}</td>
        <td>{display.averagePrice != null ? `$${formatPrice(display.averagePrice)}` : "—"}</td>
        <td>{display.quantity != null ? `${formatQuantity(display.quantity)}주` : "—"}</td>
      </tr></tbody>
    </table>
  </section>;
}

function ConversationView({ turns, pending, ...answerProps }: {
  turns: ChartCommentaryAnswer[];
  pending: ChartCommentaryPending | null;
  chartDocumentId?: string;
  sourceAvailable: boolean;
  currentAsset: ChartAnalysisAsset | null;
  activePlan: ActiveTradePlan | null;
  currentSymbol: string;
  currentInterval: ChartInterval;
  candles: CandleDto[];
  drawingIds: string[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [pending?.requestId, turns.length]);
  return <div ref={scrollRef} className="chart-commentary-conversation" aria-label="차트 대화 기록">
    {turns.map((turn) => <article key={turn.analysisId} className="chart-commentary-turn">
      <div className="chart-commentary-message is-user">
        <span>나</span>
        <p><GlossaryText text={turn.question} /></p>
      </div>
      <div className="chart-commentary-message is-assistant">
        <span>해설</span>
        <QuestionAnswer answer={turn} {...answerProps} />
      </div>
    </article>)}
    {pending && <article className="chart-commentary-turn is-pending" aria-live="polite">
      <div className="chart-commentary-message is-user"><span>나</span><p><GlossaryText text={pending.question} /></p></div>
      <div className="chart-commentary-message is-assistant"><span>해설</span><p><i className="chart-commentary-spinner" aria-hidden="true" /> 분석하고 있습니다.</p></div>
    </article>}
  </div>;
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
  return <section className="chart-commentary-answer">
    <header>
      <h3><GlossaryText text={answer.finalAnswer.title} /></h3>
      <div className="chart-commentary-meta">
        <span>{answer.interval} · {formatAnalysisAssetAsOf(answer.asOf)} 기준</span>
        {explanation.quality.stale && <span className="chart-commentary-badge is-stale">이전 데이터</span>}
        {!sourceAvailable && <span className="chart-commentary-badge is-stale">원본 차트 없음</span>}
        {sourceAvailable && !identityMatches && <span className="chart-commentary-badge is-stale">분석 기준 변경됨</span>}
      </div>
    </header>
    <p className="chart-commentary-answer-summary"><GlossaryText text={answer.finalAnswer.summary} /></p>
    {answer.finalAnswer.sections.map((section) => section.title && section.bullets.length > 0 && <section key={section.title}>
      <h4><GlossaryText text={section.title} /></h4>
      <ul>{section.bullets.map((bullet, index) => <li key={`${index}-${bullet}`}><GlossaryText text={bullet} /></li>)}</ul>
    </section>)}
    {answer.warnings.length > 0 && <section className="is-warning"><h4>주의사항</h4><ul>{answer.warnings.map((warning) => <li key={warning}><GlossaryText text={warning} /></li>)}</ul></section>}
    {answer.finalAnswer.limitations.length > 0 && <section className="is-limitation"><h4>한계</h4><ul>{answer.finalAnswer.limitations.map((limitation) => <li key={limitation}><GlossaryText text={limitation} /></li>)}</ul></section>}
    {answer.finalAnswer.citations.some((citation) => Boolean(citation.url)) && <section><h4>근거 링크</h4><ul>{answer.finalAnswer.citations.filter((citation) => citation.url).map((citation) => <li key={`${citation.title}-${citation.url}`}><a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a></li>)}</ul></section>}
    {canFocus && (focusActions.length > 0 || anchor) && <div className="chart-commentary-answer-focus" aria-label="답변 근거 포커스">
      {focusActions.map((action) => <FocusButton key={action.key} drawingIds={action.ids} onFocus={focus}>{action.label}</FocusButton>)}
      {anchor && <FocusButton drawingIds={[]} anchor={anchor} onFocus={focus}>선택 봉</FocusButton>}
    </div>}
  </section>;
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

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQuantity(value: number): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
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
