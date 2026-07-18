import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  fetchRelatedIndexCommentary,
  fetchRelatedIndices,
  type RelatedIndexItem,
  type RelatedIndicesPayload
} from "../market/relatedIndicesApi";
import { IndexWidgetCard } from "./IndexWidgetCard";
import {
  scheduleHideRelatedIndexTooltip,
  scheduleRelatedIndexTooltip,
  toggleRelatedIndexTooltip,
  updateRelatedIndexTooltip,
  useRelatedIndexTooltipOpen,
  type RelatedIndexTooltipEntry
} from "./RelatedIndexTooltip";

type PanelStatus = "loading" | "ready" | "empty";

export function IndexCommentaryPanel({
  symbol,
  recommendationSymbol
}: {
  symbol: string;
  recommendationSymbol?: string | null;
}) {
  const normalizedSymbol = resolveIndexCommentarySymbol(symbol, recommendationSymbol);
  const [payload, setPayload] = useState<RelatedIndicesPayload | null>(null);
  const [status, setStatus] = useState<PanelStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    setPayload(null);
    setStatus("loading");
    fetchRelatedIndices(normalizedSymbol, controller.signal)
      .then((initialPayload) => {
        if (controller.signal.aborted) {
          return;
        }
        setPayload(initialPayload);
        setStatus(initialPayload.items.length > 0 ? "ready" : "empty");
        initialPayload.items.forEach((item) => {
          void fetchRelatedIndexCommentary(initialPayload, item, controller.signal)
            .then((commentary) => {
              if (controller.signal.aborted || commentary.source !== "llm") {
                return;
              }
              const entryId = relatedIndexTooltipId(initialPayload.symbol, item.symbol);
              setPayload((current) => {
                if (!current || current.symbol !== initialPayload.symbol) {
                  return current;
                }
                return {
                  ...current,
                  items: current.items.map((candidate) => (
                    candidate.symbol === item.symbol ? { ...candidate, commentary } : candidate
                  ))
                };
              });
              updateRelatedIndexTooltip({
                id: entryId,
                indexSymbol: item.symbol,
                commentary
              });
            })
            .catch(() => undefined);
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus("empty");
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol]);

  return (
    <section
      className="related-index-panel"
      aria-label={`${normalizedSymbol} 지수 해설`}
      data-symbol={normalizedSymbol}
    >
      {status === "loading" && (
        <div className="related-index-panel-state" role="status">관련 지수를 불러오는 중입니다</div>
      )}
      {status === "empty" && (
        <div className="related-index-panel-state">표시할 관련 지수 데이터가 없습니다</div>
      )}
      {status === "ready" && payload && (
        <div
          className="related-index-panel-grid"
          style={{ "--related-index-count": payload.items.length } as CSSProperties}
        >
          {payload.items.map((item) => (
            <RelatedIndexCard key={item.symbol} companySymbol={payload.symbol} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export function resolveIndexCommentarySymbol(symbol: string, recommendationSymbol?: string | null): string {
  const selected = recommendationSymbol?.trim().toUpperCase();
  return selected || symbol.trim().toUpperCase();
}

function RelatedIndexCard({ companySymbol, item }: { companySymbol: string; item: RelatedIndexItem }) {
  const entry = useMemo<RelatedIndexTooltipEntry>(() => ({
    id: relatedIndexTooltipId(companySymbol, item.symbol),
    indexSymbol: item.symbol,
    commentary: item.commentary
  }), [companySymbol, item.commentary, item.symbol]);
  const tooltipOpen = useRelatedIndexTooltipOpen(entry.id);
  const anchorRect = (target: HTMLElement): DOMRect => (
    target.closest(".related-index-card-shell")?.getBoundingClientRect() ?? target.getBoundingClientRect()
  );

  return (
    <div
      className={`related-index-card-shell${tooltipOpen ? " is-tooltip-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${item.name} 선정 이유`}
      aria-describedby="gops-related-index-tooltip"
      aria-expanded={tooltipOpen}
      onMouseEnter={(event) => scheduleRelatedIndexTooltip(entry, anchorRect(event.currentTarget))}
      onMouseLeave={scheduleHideRelatedIndexTooltip}
      onFocusCapture={(event) => scheduleRelatedIndexTooltip(entry, anchorRect(event.currentTarget))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          scheduleHideRelatedIndexTooltip();
        }
      }}
      onClick={(event) => toggleRelatedIndexTooltip(entry, anchorRect(event.currentTarget))}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleRelatedIndexTooltip(entry, anchorRect(event.currentTarget));
        }
      }}
    >
      <IndexWidgetCard
        item={item}
        className="related-index-card"
        footerLeading={(
          <span className={`related-index-chip is-${item.relType}`}>{item.relLabel}</span>
        )}
      />
    </div>
  );
}

function relatedIndexTooltipId(companySymbol: string, indexSymbol: string): string {
  return `${companySymbol}:${indexSymbol}`;
}
