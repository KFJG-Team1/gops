import { Bell, BellOff, CircleAlert, Eye, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { CoachActionCenter, CoachAlertCandidate, PlaybookExperiment, TradingGuardrail } from "./types";
import styles from "./CoachActionCenterPage.module.css";

type Props = {
  center: CoachActionCenter;
  activeExperiments?: PlaybookExperiment[];
  enabledGuardrails?: TradingGuardrail[];
  onCreateAlert?: (candidate: CoachAlertCandidate) => Promise<boolean>;
  onWatchingAlertStatusChange?: (candidate: CoachAlertCandidate, enabled: boolean) => Promise<boolean>;
};

export function CoachActionCenterPage({
  center,
  activeExperiments = center.activeExperiments,
  enabledGuardrails = center.enabledGuardrails,
  onCreateAlert,
  onWatchingAlertStatusChange
}: Props) {
  const [saved, setSaved] = useState<string[]>([]);
  const [watchingOverrides, setWatchingOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (candidate: CoachAlertCandidate) => {
    if (!candidate.alertRequest || !onCreateAlert || pending) return;
    setPending(candidate.id);
    setError(null);
    const ok = await onCreateAlert(candidate).catch(() => false);
    setPending(null);
    if (ok) setSaved((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    else setError("알람을 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
  };

  const toggleWatching = async (candidate: CoachAlertCandidate) => {
    if (!candidate.serverAlertId || !onWatchingAlertStatusChange || pending) return;
    const currentlyEnabled = watchingOverrides[candidate.id] ?? candidate.enabled;
    const nextEnabled = !currentlyEnabled;
    setPending(candidate.id);
    setError(null);
    const ok = await onWatchingAlertStatusChange(candidate, nextEnabled).catch(() => false);
    setPending(null);
    if (!ok) {
      setError("알람 상태를 변경하지 못했습니다.");
      return;
    }
    setWatchingOverrides((items) => ({ ...items, [candidate.id]: nextEnabled }));
  };

  return (
    <article className={styles.page} data-testid="ai-coach-page4">
      <header className={styles.pageHeader}>
        <span>04 / 04</span>
        <div><h2>실행·알람 관리</h2><p>개선 실행, 추천 알람, 주시 중인 알람을 한 페이지에서 관리합니다.</p></div>
      </header>

      {center.availability !== "ready" && <div className={styles.notice} role="status"><CircleAlert />분석 데이터가 준비되는 동안 현재 연결된 항목만 표시합니다.</div>}

      <div className={styles.summaryGrid}>
        <Summary icon={FlaskConical} label="활성 실험" value={`${activeExperiments.length}개`} />
        <Summary icon={ShieldCheck} label="사용 가드레일" value={`${enabledGuardrails.length}개`} />
        <Summary icon={Bell} label="추천 알람" value={`${center.recommendedAlerts.length}개`} />
        <Summary icon={Eye} label="주시 중" value={`${center.watchingAlerts.length}개`} />
      </div>

      <section className={styles.execution} aria-labelledby="coach-execution-title">
        <div className={styles.sectionTitle}><h3 id="coach-execution-title">개선 실행</h3><small>3페이지에서 선택한 현재 세션 상태</small></div>
        <div className={styles.executionGrid}>
          <ExecutionList title="활성 실험" empty="활성 실험 없음" items={activeExperiments.map((item) => ({ id: item.id, title: item.title, detail: `${item.appliedCount} / ${item.sampleTarget}회 · ${item.hypothesis}` }))} />
          <ExecutionList title="사용 가드레일" empty="사용 가드레일 없음" items={enabledGuardrails.map((item) => ({ id: item.id, title: item.title, detail: item.description }))} />
        </div>
      </section>

      <section className={styles.alertSection} aria-labelledby="coach-recommended-alerts-title">
        <div className={styles.sectionTitle}><h3 id="coach-recommended-alerts-title">추천 알람</h3><small>사용자가 추가할 때만 생성</small></div>
        {center.recommendedAlerts.length ? <div className={styles.alertList}>{center.recommendedAlerts.map((candidate) => {
          const isSaved = saved.includes(candidate.id) || candidate.enabled;
          const isPending = pending === candidate.id;
          const supported = Boolean(candidate.alertRequest && onCreateAlert);
          return <div key={candidate.id} className={styles.alertRow}><Bell aria-hidden="true" /><div><strong>{candidate.title}</strong><small>{candidate.detail || "판단 근거 확인 필요"}</small></div><button type="button" disabled={!supported || isSaved || isPending} title={!supported ? "현재 알람 API에서 지원하지 않는 조건입니다." : undefined} onClick={() => create(candidate)}>{isSaved ? "추가됨" : isPending ? "저장 중" : supported ? "알람 추가" : "미지원"}</button></div>;
        })}</div> : <p className={styles.empty}>추천 가능한 알람이 없습니다.</p>}
      </section>

      <section className={styles.alertSection} aria-labelledby="coach-watching-alerts-title">
        <div className={styles.sectionTitle}><h3 id="coach-watching-alerts-title">주시 중인 알람</h3><small>서버에 저장된 알람</small></div>
        {center.watchingAlerts.length ? <div className={styles.alertList}>{center.watchingAlerts.map((candidate) => {
          const isDisabled = !(watchingOverrides[candidate.id] ?? candidate.enabled);
          const isPending = pending === candidate.id;
          const canToggle = Boolean(candidate.serverAlertId && onWatchingAlertStatusChange);
          return <div key={candidate.id} className={styles.alertRow}>{isDisabled ? <BellOff aria-hidden="true" /> : <Eye aria-hidden="true" />}<div><strong>{candidate.title}</strong><small>{candidate.detail || (isDisabled ? "비활성" : "주시 중")}</small></div><button type="button" disabled={!canToggle || isPending} onClick={() => toggleWatching(candidate)}>{isPending ? "저장 중" : isDisabled ? "다시 켜기" : "끄기"}</button></div>;
        })}</div> : <p className={styles.empty}>주시 중인 알람이 없습니다.</p>}
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.safety}>알람은 주문이나 자동 청산을 실행하지 않습니다.</p>
    </article>
  );
}

function Summary({ icon: Icon, label, value }: { icon: typeof Bell; label: string; value: string }) {
  return <div className={styles.summary}><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>;
}

function ExecutionList({ title, items, empty }: { title: string; items: Array<{ id: string; title: string; detail: string }>; empty: string }) {
  return <section className={styles.executionList}><h4>{title}</h4>{items.length ? <ul>{items.map((item) => <li key={item.id}><strong>{item.title}</strong><small>{item.detail}</small></li>)}</ul> : <p>{empty}</p>}</section>;
}
