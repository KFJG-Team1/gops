import { Fragment } from "react";
import { annotateGlossaryTerms, glossaryEntryById } from "./matchGlossaryTerms";
import { hideGlossaryTooltip, scheduleGlossaryTooltip } from "./GlossaryTooltip";

export function GlossaryText({ text }: { text: string }) {
  return (
    <>
      {annotateGlossaryTerms(text).map((segment, index) => {
        const entry = segment.glossaryId ? glossaryEntryById(segment.glossaryId) : undefined;
        if (!entry) {
          return <Fragment key={`${index}-${segment.text}`}>{segment.text}</Fragment>;
        }
        return (
          <span
            key={`${index}-${entry.id}-${segment.text}`}
            className="glossary-term"
            tabIndex={0}
            aria-describedby="gops-glossary-tooltip"
            onMouseEnter={(event) => scheduleGlossaryTooltip(entry, event.clientX, event.clientY)}
            onMouseLeave={hideGlossaryTooltip}
            onFocus={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              scheduleGlossaryTooltip(entry, rect.left + rect.width / 2, rect.bottom);
            }}
            onBlur={hideGlossaryTooltip}
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}
