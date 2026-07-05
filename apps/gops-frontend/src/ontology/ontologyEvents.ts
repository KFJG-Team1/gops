import type { AgentEvidenceItem } from "./ontologyTypes";

/**
 * 채팅 에이전트 분석과 온톨로지 패널을 잇는 경량 이벤트 버스.
 * 분석 리포트에 온톨로지 evidence가 있으면 발행하고,
 * 열려 있는 온톨로지 패널이 구독해서 즉시 갱신한다 (추가 API 호출 없음).
 */

export type OntologyReportEventDetail = {
  symbol?: string;
  providerEvidence: AgentEvidenceItem[];
};

const EVENT_NAME = "gops:ontology-report";

export function publishOntologyReport(detail: OntologyReportEventDetail): void {
  if (!detail.providerEvidence.some((item) => item.provider === "ontology" && item.status === "available")) {
    return;
  }
  window.dispatchEvent(new CustomEvent<OntologyReportEventDetail>(EVENT_NAME, { detail }));
}

export function subscribeOntologyReports(listener: (detail: OntologyReportEventDetail) => void): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<OntologyReportEventDetail>;
    if (custom.detail && Array.isArray(custom.detail.providerEvidence)) {
      listener(custom.detail);
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
