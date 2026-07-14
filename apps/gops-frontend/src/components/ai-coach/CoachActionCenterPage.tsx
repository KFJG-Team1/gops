import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CoachActionCenter, CoachAlertCandidate, PlaybookExperiment, TradingGuardrail } from "./types";
import styles from "./CoachActionCenterPage.module.css";

const DAILY_TRADE_SOURCE_LABEL = "당일 거래에서 제안";

type Props = {
  center: CoachActionCenter;
  focusedCandidateId?: string | null;
  activeExperiments?: PlaybookExperiment[];
  enabledGuardrails?: TradingGuardrail[];
  onCreateAlert?: (candidate: CoachAlertCandidate) => Promise<boolean>;
  onWatchingAlertStatusChange?: (candidate: CoachAlertCandidate, enabled: boolean) => Promise<boolean>;
};

export function CoachActionCenterPage({
  center,
  focusedCandidateId = null,
  onCreateAlert
}: Props) {
  const instanceId = useId();
  const dailyTradeTitleId = `${instanceId}-alert-source-daily-trade`;
  const alertRowRefs = useRef(new Map<string, HTMLDivElement>());
  const [saved, setSaved] = useState<string[]>([]);
  const [expandedCandidateIds, setExpandedCandidateIds] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dailyTradeCandidates = center.recommendedAlerts.filter((candidate) => (candidate.proposalSource ?? "daily_trade") === "daily_trade");
  const focusedCandidatePresent = Boolean(focusedCandidateId && dailyTradeCandidates.some((item) => item.id === focusedCandidateId));

  useEffect(() => {
    if (!focusedCandidateId || !focusedCandidatePresent) return;
    setExpandedCandidateIds((current) => current.includes(focusedCandidateId) ? current : [...current, focusedCandidateId]);
    const frame = requestAnimationFrame(() => {
      const row = alertRowRefs.current.get(focusedCandidateId);
      row?.focus({ preventScroll: true });
      if (row && typeof row.scrollIntoView === "function") {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedCandidateId, focusedCandidatePresent]);

  const create = async (candidate: CoachAlertCandidate) => {
    if (!candidate.alertRequest || !onCreateAlert || pending) return;
    setPending(candidate.id);
    setError(null);
    const ok = await onCreateAlert(candidate).catch(() => false);
    setPending(null);
    if (ok) setSaved((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    else setError("알람을 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
  };

  const toggleExpandedCandidate = (candidateId: string) => {
    setExpandedCandidateIds((current) => current.includes(candidateId)
      ? current.filter((id) => id !== candidateId)
      : [...current, candidateId]);
  };

  return (
    <article className={styles.page} data-testid="ai-coach-page4">
      {center.availability !== "ready" && <div className={styles.notice} role="status"><CircleAlert />분석 데이터가 준비되는 동안 현재 연결된 항목만 표시합니다.</div>}

      <section className={styles.alertSection} aria-labelledby={dailyTradeTitleId}>
        {focusedCandidateId && !focusedCandidatePresent && <p className={styles.focusStatus} role="status">요청한 조건이 현재 추천 목록에 없습니다.</p>}
        <section className={styles.sourceGroup} aria-labelledby={dailyTradeTitleId}>
          <h4 id={dailyTradeTitleId} className={styles.sourceBadge}>{DAILY_TRADE_SOURCE_LABEL}</h4>
          {dailyTradeCandidates.length ? <div className={styles.alertTableScroll}>
            <div className={styles.alertTable} role="table" aria-label="당일 거래 알람 제안">
              <div className={styles.alertTableHead} role="row">
                <span role="columnheader">종목</span>
                <span role="columnheader">항목</span>
                <span role="columnheader">현재</span>
                <span role="columnheader">조건</span>
                <span role="columnheader">관리</span>
              </div>
              <div className={styles.alertTableBody} role="rowgroup">
                {dailyTradeCandidates.map((candidate) => {
                  const isSaved = saved.includes(candidate.id) || candidate.enabled;
                  const isPending = pending === candidate.id;
                  const supported = candidate.alertSupported !== false && Boolean(candidate.alertRequest && onCreateAlert);
                  const isFocused = focusedCandidateId === candidate.id;
                  const isExpanded = expandedCandidateIds.includes(candidate.id);
                  const detailId = `${alertRowDomId(instanceId, candidate.id)}-details`;
                  const detail = candidate.detail || "판단 근거 확인 필요";
                  const current = conditionValue(candidate.currentValue);
                  const threshold = `${conditionOperator(candidate.operator)} ${conditionValue(candidate.threshold)}`;
                  const recommendedAction = candidate.recommendedAction || "—";
                  return <div
                    key={candidate.id}
                    id={alertRowDomId(instanceId, candidate.id)}
                    ref={(node) => {
                      if (node) alertRowRefs.current.set(candidate.id, node);
                      else alertRowRefs.current.delete(candidate.id);
                    }}
                    className={styles.alertRow}
                    role="row"
                    data-focused={isFocused ? "true" : undefined}
                    data-expanded={isExpanded ? "true" : undefined}
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={detailId}
                    onClick={() => toggleExpandedCandidate(candidate.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleExpandedCandidate(candidate.id);
                      }
                    }}
                  >
                    <div className={styles.alertSymbol} role="cell" data-label="종목"><strong>{candidate.symbol || "—"}</strong></div>
                    <div className={styles.alertCondition} role="cell" data-label="항목" title={candidate.title}><strong>{candidate.title}</strong></div>
                    <div className={styles.alertCurrent} role="cell" data-label="현재" title={current}><span>{current}</span></div>
                    <div className={styles.alertThreshold} role="cell" data-label="조건" title={threshold}><span>{threshold}</span></div>
                    <div className={styles.alertManage} role="cell" data-label="관리" onClick={(event) => event.stopPropagation()}><button type="button" disabled={!supported || isSaved || isPending} title={!supported ? "현재 알람 API에서 지원하지 않는 조건입니다." : undefined} onClick={() => create(candidate)}>{isSaved ? "추가됨" : isPending ? "저장 중" : supported ? "알람 추가" : "미지원"}</button></div>
                    {isExpanded && <div id={detailId} className={styles.alertDetails} onClick={(event) => event.stopPropagation()}>
                      <div className={styles.alertDetailsContent}>
                        <b className={styles.alertDetailLabel}>판단 근거</b>
                        <span className={styles.alertDetailReason} title={detail}>{detail}</span>
                        <b className={styles.alertDetailRecommendationLabel}>추천 행동</b>
                        <span className={styles.alertDetailRecommendation} title={recommendedAction}>{recommendedAction}</span>
                      </div>
                    </div>}
                  </div>;
                })}
              </div>
            </div>
          </div> : <p className={styles.empty}>현재 데이터에서 제안 없음</p>}
        </section>
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </article>
  );
}

function alertRowDomId(instanceId: string, candidateId: string) {
  return `${instanceId}-alert-${encodeURIComponent(candidateId)}`;
}

function conditionValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "계산되지 않음";
  return typeof value === "number"
    ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value)
    : value;
}

function conditionOperator(operator: string | null | undefined) {
  const normalized = operator?.trim().toLowerCase();
  if (!normalized) return "—";
  const symbols: Record<string, string> = {
    above: ">", gt: ">", greaterthan: ">", greater_than: ">", ">": ">",
    atorabove: ">=", at_or_above: ">=", ge: ">=", gte: ">=", ">=": ">=", "≥": ">=",
    below: "<", lt: "<", lessthan: "<", less_than: "<", "<": "<",
    atorbelow: "<=", at_or_below: "<=", le: "<=", lte: "<=", "<=": "<=", "≤": "<=",
    eq: "=", equals: "=", "==": "=", "=": "="
  };
  return symbols[normalized] ?? "—";
}
