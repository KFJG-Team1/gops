import type { FinalAnswerCitation } from "../agents/agentAnalysis";
import type { WildPanelPage } from "../layout/wildPanel";
import { GlossaryText } from "../glossary/GlossaryText";
import { AnalysisAnswerPage } from "./AnalysisAnswerPage";

export function WildPanelAnswerPage({ page }: { page: WildPanelPage }) {
  if (page.kind === "agentAnswer") {
    return (
      <article className="wild-panel-answer-page is-agent-answer">
        <header className="wild-panel-answer-header">
          <div>
            <span className="wild-panel-page-kicker">에이전트 답변</span>
            <h2><GlossaryText text={page.title} /></h2>
          </div>
          <PageConfidence confidence={page.confidence} />
        </header>
        <p className="wild-panel-agent-role"><GlossaryText text={page.role} /></p>
        <p className="wild-panel-answer-content"><GlossaryText text={page.content} /></p>
        <CitationList citations={page.citations} />
      </article>
    );
  }

  return <AnalysisAnswerPage
    kicker={page.kicker}
    symbol={page.symbol}
    title={page.title}
    summary={page.summary}
    sections={page.sections}
    citations={page.citations}
    limitations={page.limitations}
    warnings={page.warnings}
    confidence={page.confidence}
  />;
}

function CitationList({ citations }: { citations: FinalAnswerCitation[] }) {
  const linked = citations.filter((citation) => Boolean(citation.url));
  if (linked.length === 0) {
    return null;
  }
  return (
    <section className="wild-panel-answer-section is-citations">
      <h3><GlossaryText text="근거 링크" /></h3>
      <ul>
        {linked.map((citation, index) => (
          <li key={`${index}-${citation.title}-${citation.url}`}>
            <a href={citation.url} target="_blank" rel="noreferrer"><GlossaryText text={citation.title} /></a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PageConfidence({ confidence }: { confidence?: number }) {
  if (typeof confidence !== "number") {
    return null;
  }
  const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return <span className="wild-panel-confidence" title={`신뢰도 ${percent}%`}>{percent}%</span>;
}
