import type { AgentAnalysisReport } from "../agents/agentAnalysis";

export type AgentHeaderNoticeTone = "success" | "info" | "error";

export type AgentHeaderNotice = {
  id: string;
  message: string;
  tone: AgentHeaderNoticeTone;
};

export function agentReportCompletionMessage(
  report: AgentAnalysisReport,
  fallbackSymbol: string
): string {
  const symbol = (report.symbol || fallbackSymbol).trim().toUpperCase();
  const intentType = report.route?.intentType?.trim().toLowerCase() ?? "";
  const selectedRoles = report.route?.selectedRoles ?? [];
  const isNews = intentType.includes("news") || selectedRoles.some((role) => role.trim().toLowerCase() === "news");
  return isNews
    ? `${symbol} 뉴스를 가져왔습니다.`
    : `${symbol} 차트 분석을 완료했습니다.`;
}
