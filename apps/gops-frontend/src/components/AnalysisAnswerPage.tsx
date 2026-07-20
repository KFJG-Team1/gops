import type { ReactNode } from "react";
import type { FinalAnswerCitation, FinalAnswerSection } from "../agents/agentAnalysis";
import { GlossaryText } from "../glossary/GlossaryText";

export type AnalysisAnswerPageProps = {
  kicker: string;
  symbol?: string;
  title: string;
  summary: string;
  sections: FinalAnswerSection[];
  citations: FinalAnswerCitation[];
  limitations: string[];
  warnings: string[];
  confidence?: number;
  className?: string;
  beforeBody?: ReactNode;
};

export function AnalysisAnswerPage({
  kicker,
  symbol,
  title,
  summary,
  sections,
  citations,
  limitations,
  warnings,
  confidence,
  className = "",
  beforeBody
}: AnalysisAnswerPageProps) {
  return (
    <article className={`wild-panel-answer-page is-commentary ${className}`.trim()}>
      <header className="wild-panel-answer-header">
        <div>
          <span className="wild-panel-page-kicker"><GlossaryText text={`${kicker}${symbol ? ` · ${symbol}` : ""}`} /></span>
          <h2><GlossaryText text={title} /></h2>
        </div>
        <PageConfidence confidence={confidence} />
      </header>
      {beforeBody}
      <p className="wild-panel-answer-summary"><GlossaryText text={summary} /></p>
      {sections.map((section) => section.title && section.bullets.length > 0 && (
        <section key={section.title} className="wild-panel-answer-section">
          <h3><GlossaryText text={section.title} /></h3>
          <ul>{section.bullets.map((bullet, index) => <li key={`${index}-${bullet}`}><GlossaryText text={bullet} /></li>)}</ul>
        </section>
      ))}
      {warnings.length > 0 && (
        <section className="wild-panel-answer-section is-warning">
          <h3><GlossaryText text="주의사항" /></h3>
          <ul>{warnings.map((warning) => <li key={warning}><GlossaryText text={warning} /></li>)}</ul>
        </section>
      )}
      {limitations.length > 0 && (
        <section className="wild-panel-answer-section is-limitation">
          <h3><GlossaryText text="한계" /></h3>
          <ul>{limitations.map((limitation) => <li key={limitation}><GlossaryText text={limitation} /></li>)}</ul>
        </section>
      )}
      <CitationList citations={citations} />
    </article>
  );
}

function CitationList({ citations }: { citations: FinalAnswerCitation[] }) {
  const linked = citations.filter((citation) => Boolean(citation.url));
  if (linked.length === 0) return null;
  return (
    <section className="wild-panel-answer-section is-citations">
      <h3><GlossaryText text="근거 링크" /></h3>
      <ul>{linked.map((citation, index) => (
        <li key={`${index}-${citation.title}-${citation.url}`}>
          <a href={citation.url} target="_blank" rel="noreferrer"><GlossaryText text={citation.title} /></a>
        </li>
      ))}</ul>
    </section>
  );
}

function PageConfidence({ confidence }: { confidence?: number }) {
  if (typeof confidence !== "number") return null;
  const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return <span className="wild-panel-confidence" title={`신뢰도 ${percent}%`}>{percent}%</span>;
}
