import type { FinalAnswerCitation } from "../agents/agentAnalysis";
import type { WildPanelPage } from "../layout/wildPanel";

export function WildPanelAnswerPage({ page }: { page: WildPanelPage }) {
  if (page.kind === "agentAnswer") {
    return (
      <article className="wild-panel-answer-page is-agent-answer">
        <header className="wild-panel-answer-header">
          <div>
            <span className="wild-panel-page-kicker">에이전트 답변</span>
            <h2>{page.title}</h2>
          </div>
          <PageConfidence confidence={page.confidence} />
        </header>
        <p className="wild-panel-agent-role">{page.role}</p>
        <p className="wild-panel-answer-content">{page.content}</p>
        <CitationList citations={page.citations} />
      </article>
    );
  }

  return (
    <article className="wild-panel-answer-page is-commentary">
      <header className="wild-panel-answer-header">
        <div>
          <span className="wild-panel-page-kicker">차트 해설{page.symbol ? ` · ${page.symbol}` : ""}</span>
          <h2>{page.title}</h2>
        </div>
        <PageConfidence confidence={page.confidence} />
      </header>
      <p className="wild-panel-answer-summary">{page.summary}</p>
      {page.sections.map((section) => section.title && section.bullets.length > 0 && (
        <section key={section.title} className="wild-panel-answer-section">
          <h3>{section.title}</h3>
          <ul>
            {section.bullets.map((bullet, index) => <li key={`${index}-${bullet}`}>{bullet}</li>)}
          </ul>
        </section>
      ))}
      {page.warnings.length > 0 && (
        <section className="wild-panel-answer-section is-warning">
          <h3>주의사항</h3>
          <ul>{page.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      )}
      {page.limitations.length > 0 && (
        <section className="wild-panel-answer-section is-limitation">
          <h3>한계</h3>
          <ul>{page.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </section>
      )}
      <CitationList citations={page.citations} />
    </article>
  );
}

function CitationList({ citations }: { citations: FinalAnswerCitation[] }) {
  const linked = citations.filter((citation) => Boolean(citation.url));
  if (linked.length === 0) {
    return null;
  }
  return (
    <section className="wild-panel-answer-section is-citations">
      <h3>근거 링크</h3>
      <ul>
        {linked.map((citation, index) => (
          <li key={`${index}-${citation.title}-${citation.url}`}>
            <a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
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
