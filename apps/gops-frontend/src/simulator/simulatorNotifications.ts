import type { NotificationItem } from "../alerts/alertApi";
import type { SimulatorNewsArticle, SimulatorStatus } from "./simulatorApi";

const eventResponseUiProposals = [
  { panelType: "portfolioHoldings", action: "open" },
  { panelType: "chart", action: "open", symbol: "AMD" },
  { panelType: "paperAccount", action: "open" },
  { panelType: "priceCondition", action: "open", symbol: "AMD" },
  { panelType: "orderFlowProfile", action: "open", symbol: "OKE" }
];

export function simulatorBreakingNotification(
  article: SimulatorNewsArticle,
  status: SimulatorStatus
): NotificationItem {
  return {
    id: -10_001,
    eventId: `simulator:${status.runId ?? "unknown"}:breaking-event`,
    type: "system.simulator_breaking_event",
    createdAt: new Date().toISOString(),
    payload: {
      symbol: "AMD",
      title: "지정학 이벤트",
      summary: article.headline,
      detail: article.summary ?? "AMD 위험 관리와 OKE 수혜 가능성을 함께 점검합니다.",
      source: article.source ?? "GOPS Simulator",
      decision: {
        eventId: article.id,
        eventType: "simulator_geopolitical_risk",
        metrics: { uiProposals: eventResponseUiProposals }
      }
    }
  };
}

export function simulatorPhaseNotification(status: SimulatorStatus): NotificationItem | null {
  if (status.mode !== "simulation" || status.phase !== "market-close" || !status.runId) {
    return null;
  }
  return {
    id: -10_002,
    eventId: `simulator:${status.runId}:market-close`,
    type: "system.simulator_market_close",
    createdAt: new Date().toISOString(),
    payload: {
      symbol: "MARKET",
      title: "본장 종료",
      summary: "오늘의 가상 주문과 알림을 확인하고 투자 리포트로 복기하세요.",
      detail: "AMD 위험 관리와 OKE 대응 조건은 장 마감 이후에도 계속 관리됩니다."
    }
  };
}
