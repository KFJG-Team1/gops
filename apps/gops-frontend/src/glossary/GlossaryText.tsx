import { Fragment } from "react";
import type { GlossaryEntry } from "./stockGlossary";
import { annotateGlossaryTerms, glossaryEntryById } from "./matchGlossaryTerms";
import { hideGlossaryTooltip, scheduleGlossaryTooltip, toggleGlossaryTooltip } from "./GlossaryTooltip";

export type GlossarySelectionContext = {
  text: string;
  matchedText: string;
  startIndex: number;
};

export function GlossaryText({
  text,
  onTermSelect
}: {
  text: string;
  onTermSelect?: (entry: GlossaryEntry, context: GlossarySelectionContext) => boolean;
}) {
  let textCursor = 0;
  return (
    <>
      {annotateGlossaryTerms(text).map((segment, index) => {
        const startIndex = textCursor;
        textCursor += segment.text.length;
        const entry = segment.glossaryId ? glossaryEntryById(segment.glossaryId) : undefined;
        if (!entry) {
          return <Fragment key={`${index}-${segment.text}`}>{segment.text}</Fragment>;
        }
        return (
          <span
            key={`${index}-${entry.id}-${segment.text}`}
            className="glossary-term"
            tabIndex={0}
            role="button"
            aria-label={`${entry.term} 용어 설명`}
            aria-describedby="gops-glossary-tooltip"
            onMouseEnter={(event) => scheduleGlossaryTooltip(entry, event.clientX, event.clientY)}
            onMouseLeave={() => hideGlossaryTooltip()}
            onFocus={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              scheduleGlossaryTooltip(entry, rect.left + rect.width / 2, rect.bottom);
            }}
            onBlur={() => hideGlossaryTooltip()}
            onClick={(event) => {
              const handled = onTermSelect?.(entry, { text, matchedText: segment.text, startIndex }) ?? false;
              if (handled) {
                event.stopPropagation();
                hideGlossaryTooltip();
                return;
              }
              if (onTermSelect) event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              toggleGlossaryTooltip(entry, rect.left + rect.width / 2, rect.bottom);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              const handled = onTermSelect?.(entry, { text, matchedText: segment.text, startIndex }) ?? false;
              if (handled) {
                event.stopPropagation();
                hideGlossaryTooltip();
                return;
              }
              if (onTermSelect) event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              toggleGlossaryTooltip(entry, rect.left + rect.width / 2, rect.bottom);
            }}
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}
