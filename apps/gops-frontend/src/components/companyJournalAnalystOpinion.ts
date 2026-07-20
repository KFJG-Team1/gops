import type { CompanyJournalAnalystAction } from "./companyJournalApi";

export type CompanyJournalAnalystOpinion = {
  actionAt: string;
  dateLabel: string | null;
  message: string;
  tone: "positive" | "negative" | "neutral";
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function formatActionDate(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!matched) return null;
  return `${Number(matched[1])}년 ${Number(matched[2])}월 ${Number(matched[3])}일`;
}

function withTopicParticle(value: string) {
  const lastCharacter = value.trim().at(-1);
  if (!lastCharacter) return value;
  const code = lastCharacter.charCodeAt(0);
  const hasFinalConsonant = code >= 0xac00 && code <= 0xd7a3
    ? (code - 0xac00) % 28 !== 0
    : true;
  return `${value}${hasFinalConsonant ? "은" : "는"}`;
}

function targetSentence(priorTarget: number | null, target: number | null) {
  const prior = Number.isFinite(priorTarget) ? priorTarget : null;
  const current = Number.isFinite(target) ? target : null;
  if (prior != null && current != null) {
    if (current > prior) return `목표주가를 ${formatPrice(prior)}달러에서 ${formatPrice(current)}달러로 높였습니다.`;
    if (current < prior) return `목표주가를 ${formatPrice(prior)}달러에서 ${formatPrice(current)}달러로 낮췄습니다.`;
    return `목표주가를 ${formatPrice(current)}달러로 유지했습니다.`;
  }
  return current == null ? null : `목표주가를 ${formatPrice(current)}달러로 제시했습니다.`;
}

export function formatCompanyJournalAnalystOpinion(
  action: CompanyJournalAnalystAction,
  companyName: string
): CompanyJournalAnalystOpinion | null {
  const storedStatement = action.statement?.trim();
  if (storedStatement) {
    return {
      actionAt: action.actionAt,
      dateLabel: formatActionDate(action.actionAt),
      message: storedStatement,
      tone: action.tone ?? "neutral"
    };
  }
  const firm = action.firm.trim();
  const company = companyName.trim();
  const fromGrade = action.fromGrade.trim();
  const toGrade = action.toGrade.trim();
  const grade = toGrade || fromGrade;
  if (!firm || !company) return null;

  const firmTopic = withTopicParticle(firm);
  const target = targetSentence(action.priorPriceTarget, action.priceTarget);
  let message: string | null = null;
  let tone: CompanyJournalAnalystOpinion["tone"] = "neutral";

  if (action.action === "upgrade") {
    tone = "positive";
    const rating = fromGrade && toGrade
      ? `${firmTopic} ${company}의 투자의견을 ${fromGrade}에서 ${toGrade}로 상향`
      : grade ? `${firmTopic} ${company}의 투자의견을 ${grade}로 상향` : null;
    if (rating) message = target ? `${rating}하고, ${target}` : `${rating}했습니다.`;
  } else if (action.action === "downgrade") {
    tone = "negative";
    const rating = fromGrade && toGrade
      ? `${firmTopic} ${company}의 투자의견을 ${fromGrade}에서 ${toGrade}로 하향`
      : grade ? `${firmTopic} ${company}의 투자의견을 ${grade}로 하향` : null;
    if (rating) message = target ? `${rating}하고, ${target}` : `${rating}했습니다.`;
  } else if (action.action === "maintain" && grade) {
    message = target
      ? `${firmTopic} ${grade} 의견을 유지하면서 ${target}`
      : `${firmTopic} ${grade} 의견을 유지했습니다.`;
  } else if (action.action === "initiate" && grade) {
    message = target
      ? `${firmTopic} ${company}에 대해 ${grade} 의견으로 분석을 시작하고, ${target}`
      : `${firmTopic} ${company}에 대해 ${grade} 의견으로 분석을 시작했습니다.`;
  } else if (grade) {
    message = target
      ? `${firm}의 ${company} 최신 투자의견은 ${grade}이며, ${target}`
      : `${firm}의 ${company} 최신 투자의견은 ${grade}입니다.`;
  }

  return message ? {
    actionAt: action.actionAt,
    dateLabel: formatActionDate(action.actionAt),
    message,
    tone
  } : null;
}
