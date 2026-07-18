import { CalendarClock, ExternalLink, X } from "lucide-react";
import { createPortal } from "react-dom";
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { chartEventPopoverPlacement } from "../chart/chartEventPopoverLayout";
import type {
  ChartEarningsEvent,
  ChartEventMarker,
  ChartEventsResponse,
  ChartNewsDay,
  UpcomingEarningsEvent
} from "../chart/chartEvents";

type ChartEventOverlayProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  markers: ChartEventMarker[];
  response: ChartEventsResponse | null;
  earningsVisible: boolean;
  upcomingStyle?: CSSProperties;
  openRequest?: { eventId: string; revision: number } | null;
  onSelectedEventChange?: (eventId: string | null) => void;
};

type SelectedChartEvent = {
  event: ChartEarningsEvent | ChartNewsDay;
  anchorX: number;
  anchorTop: number;
  upcoming?: UpcomingEarningsEvent;
};

const koreaDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const dateLabel = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric"
});

export function ChartEventOverlay({
  containerRef,
  markers,
  response,
  earningsVisible,
  upcomingStyle,
  openRequest,
  onSelectedEventChange
}: ChartEventOverlayProps) {
  const [selected, setSelected] = useState<SelectedChartEvent | null>(null);
  const [positionRevision, setPositionRevision] = useState(0);
  const popoverRef = useRef<HTMLElement | null>(null);
  const handledOpenRevisionRef = useRef<number | null>(null);
  const selectedStillVisible = Boolean(selected?.upcoming && earningsVisible && response?.upcomingEarnings)
    || markers.some((marker) => marker.id === selected?.event.id);

  useEffect(() => {
    setSelected(null);
    handledOpenRevisionRef.current = null;
  }, [response?.symbol]);

  useEffect(() => {
    if (!openRequest || handledOpenRevisionRef.current === openRequest.revision) return;
    const marker = markers.find((item) => item.id === openRequest.eventId);
    if (marker) {
      setSelected((current) => current?.event.id === marker.id ? null : {
        event: marker.event,
        anchorX: marker.x,
        anchorTop: marker.top
      });
      handledOpenRevisionRef.current = openRequest.revision;
      return;
    }
    const upcoming = response?.upcomingEarnings;
    const container = containerRef.current;
    const upcomingEvent = upcoming && response
      ? upcomingAsEarningsEvent(response.symbol, upcoming)
      : null;
    if (upcomingEvent?.id === openRequest.eventId && container && earningsVisible) {
      setSelected((current) => current?.event.id === upcomingEvent.id ? null : {
        event: upcomingEvent,
        anchorX: Math.max(40, container.clientWidth - 110),
        anchorTop: Math.max(44, container.clientHeight - 28),
        upcoming: upcoming ?? undefined
      });
      handledOpenRevisionRef.current = openRequest.revision;
    }
  }, [containerRef, earningsVisible, markers, openRequest, response]);

  useEffect(() => {
    onSelectedEventChange?.(selected?.event.id ?? null);
  }, [onSelectedEventChange, selected?.event.id]);

  useEffect(() => {
    if (selected && !selectedStillVisible) {
      setSelected(null);
    }
  }, [selected, selectedStillVisible]);

  useEffect(() => {
    if (!selected || selected.upcoming) return;
    const marker = markers.find((item) => item.id === selected.event.id);
    if (marker && (marker.x !== selected.anchorX || marker.top !== selected.anchorTop)) {
      setSelected((current) => current ? { ...current, anchorX: marker.x, anchorTop: marker.top } : current);
    }
  }, [markers, selected]);

  useEffect(() => {
    if (!selected) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const trigger = target instanceof Element
        ? target.closest("[data-chart-event-trigger='true'], [data-chart-commentary-event-trigger='true']")
        : null;
      if (target && (popoverRef.current?.contains(target) || trigger)) {
        return;
      }
      setSelected(null);
    };
    const updatePosition = () => setPositionRevision((current) => current + 1);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [selected]);

  useLayoutEffect(() => {
    if (selected && popoverRef.current) {
      setPositionRevision((current) => current + 1);
    }
  }, [selected]);

  const selectedStyle = useMemo(() => {
    void positionRevision;
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (!selected || !container || !rect) return undefined;
    const scaleX = container.clientWidth > 0 ? rect.width / container.clientWidth : 1;
    const scaleY = container.clientHeight > 0 ? rect.height / container.clientHeight : 1;
    const anchorX = rect.left + selected.anchorX * scaleX;
    const anchorTop = rect.top + selected.anchorTop * scaleY;
    const contentHeight = popoverRef.current?.getBoundingClientRect().height
      ?? Math.min(480, Math.max(0, window.innerHeight - 24));
    const placement = chartEventPopoverPlacement({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      anchorX,
      anchorY: anchorTop,
      contentHeight,
      preferredWidth: selected.event.type === "news" ? 360 : undefined
    });
    return {
      left: placement.left,
      top: placement.top,
      width: placement.width,
      maxHeight: placement.maxHeight,
      transformOrigin: placement.transformOrigin
    } as CSSProperties;
  }, [containerRef, positionRevision, selected]);

  const openUpcoming = () => {
    const upcoming = response?.upcomingEarnings;
    const container = containerRef.current;
    if (!upcoming || !container) return;
    const event = upcomingAsEarningsEvent(response?.symbol ?? "", upcoming);
    setSelected((current) => current?.event.id === event.id ? null : {
      event,
      anchorX: Math.max(40, container.clientWidth - 110),
      anchorTop: Math.max(44, container.clientHeight - 28),
      upcoming
    });
  };
  const selectedTitleId = selected
    ? `chart-event-title-${selected.event.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
    : undefined;

  return (
    <>
      <div className="chart-event-marker-layer" aria-label="차트 기업 이벤트">
        {markers.map((marker) => {
          const popoverId = `chart-event-${marker.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return (
            <button
              key={marker.id}
              type="button"
              className={`chart-event-marker is-${marker.type} ${marker.impactDirection ? `is-${marker.impactDirection}` : ""}`}
              style={{ left: marker.x, top: marker.top }}
              data-chart-event-id={marker.id}
              data-chart-event-trigger="true"
              aria-label={marker.event.type === "earnings"
                ? `${marker.marketDate} 실적 이벤트`
                : `${marker.marketDate} 뉴스 ${marker.event.articleCount}건`}
              aria-expanded={selected?.event.id === marker.id}
              aria-controls={popoverId}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setSelected((current) => current?.event.id === marker.id ? null : {
                  event: marker.event,
                  anchorX: marker.x,
                  anchorTop: marker.top
                });
              }}
            >
              {marker.label}
            </button>
          );
        })}
      </div>
      {earningsVisible && response?.upcomingEarnings && (
        <button
          type="button"
          className="chart-upcoming-earnings-badge"
          style={upcomingStyle}
          data-chart-event-trigger="true"
          aria-label={`예정 실적 D-${response.upcomingEarnings.daysRemaining}`}
          aria-expanded={Boolean(selected?.upcoming)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (selected?.upcoming) setSelected(null);
            else openUpcoming();
          }}
        >
          <span>E</span>
          <strong>D-{response.upcomingEarnings.daysRemaining}</strong>
        </button>
      )}
      {selected && selectedStyle && createPortal(
        <article
          ref={popoverRef}
          id={`chart-event-${selected.event.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
          className={`chart-event-popover is-${selected.event.type}`}
          style={selectedStyle}
          role="dialog"
          aria-modal="false"
          aria-labelledby={selectedTitleId}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <span className="chart-event-popover-badge" aria-hidden="true">
              <span>{selected.event.type === "earnings" ? "E" : "N"}</span>
            </span>
            <div className="chart-event-popover-title">
              <small>{selected.event.type === "earnings" ? "FUNDAMENTALS" : "MARKET NEWS"}</small>
              <strong id={selectedTitleId}>
                {selected.event.type === "earnings" ? "실적 및 펀더멘탈" : "뉴스 브리핑"}
              </strong>
            </div>
            <button className="chart-event-popover-close" type="button" aria-label="이벤트 상세 닫기" onClick={() => setSelected(null)}>
              <X size={16} />
            </button>
          </header>
          {selected.event.type === "earnings"
            ? <EarningsEventContent event={selected.event} upcoming={selected.upcoming} />
            : <NewsEventContent event={selected.event} />}
        </article>,
        window.document.body
      )}
    </>
  );
}

function EarningsEventContent({ event, upcoming }: { event: ChartEarningsEvent; upcoming?: UpcomingEarningsEvent }) {
  const session = earningsSessionLabel(event.session);
  const highlightTone = metricTone(event.eps.surprisePercent);
  const highlightValue = upcoming ? `D-${upcoming.daysRemaining}` : formatSignedPercent(event.eps.surprisePercent);
  return (
    <div className="chart-event-popover-body">
      <div className="chart-event-context-strip">
        <span><CalendarClock size={13} aria-hidden="true" />{koreaDateTime.format(new Date(event.eventAt))}</span>
        <strong>{session}</strong>
      </div>
      <section className={`chart-event-highlight ${highlightTone}`} aria-label="실적 핵심 결과">
        <div>
          <small>{upcoming ? "발표까지" : "EPS 서프라이즈율"}</small>
          <strong>{highlightValue}</strong>
        </div>
        <span>{earningsResultLabel(event, Boolean(upcoming))}</span>
      </section>
      {upcoming && <p className="chart-event-upcoming-note">예상 EPS를 기준으로 발표를 기다리고 있습니다.</p>}
      <section className="chart-event-section" aria-label="EPS 세부 지표">
        <div className="chart-event-section-label">
          <span>EPS 결과</span>
          <small>주당순이익</small>
        </div>
        <dl className="chart-event-detail-list">
          <div><dt>발표</dt><dd>{formatEps(event.eps.actual)}</dd></div>
          <div><dt>시장 예상</dt><dd>{formatEps(event.eps.estimate)}</dd></div>
          <div className={metricTone(event.eps.surprise)}><dt>예상 대비</dt><dd>{formatSignedEps(event.eps.surprise)}</dd></div>
        </dl>
      </section>
      <footer className="chart-event-source-footer">
        <span>DATA SOURCE</span>
        <strong>{event.source}</strong>
        <time dateTime={event.sourceAsOf}>기준 {koreaDateTime.format(new Date(event.sourceAsOf))}</time>
      </footer>
    </div>
  );
}

function NewsEventContent({ event }: { event: ChartNewsDay }) {
  return (
    <div className="chart-event-popover-body chart-event-news-body">
      <dl className="chart-event-news-meta" aria-label="뉴스 브리핑 정보">
        <div>
          <dt><CalendarClock size={13} aria-hidden="true" />날짜</dt>
          <dd>{dateLabel.format(new Date(`${event.date}T12:00:00Z`))}</dd>
        </div>
        <div>
          <dt>종합 기사</dt>
          <dd>{event.articleCount}건</dd>
        </div>
      </dl>
      <section className={`chart-event-news-impact is-${event.impactDirection}`} aria-label="뉴스 영향 요약">
        <span>시장 영향</span>
        <strong>{newsImpactLabel(event.impactDirection)}</strong>
        <small>{newsSentimentLabel(event.sentiment)}</small>
      </section>
      <section className="chart-event-section">
        <div className="chart-event-section-label">
          <span>핵심 요약</span>
        </div>
        <p className="chart-event-news-summary">{event.summary || "저장된 일별 요약이 없습니다."}</p>
      </section>
      {event.keyPoints.length > 0 && (
        <section className="chart-event-section">
          <div className="chart-event-section-label">
            <span>주요 포인트</span>
          </div>
          <ul className="chart-event-key-points">
            {event.keyPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
      )}
      {event.sources.length > 0 && (
        <section className="chart-event-section">
          <div className="chart-event-section-label">
            <span>원문 기사</span>
            <small>{Math.min(event.sources.length, 3)}개</small>
          </div>
          <nav className="chart-event-source-links" aria-label="뉴스 원문">
            {event.sources.slice(0, 3).map((source) => (
              <a key={source.articleId ?? source.url} href={source.url} target="_blank" rel="noreferrer">
                <span>{source.name || "원문"}</span>
                <strong>{source.title}</strong>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ))}
          </nav>
        </section>
      )}
    </div>
  );
}

function upcomingAsEarningsEvent(symbol: string, event: UpcomingEarningsEvent): ChartEarningsEvent {
  return {
    id: `earnings:${symbol}:${event.eventAt}:upcoming`,
    type: "earnings",
    eventAt: event.eventAt,
    status: "scheduled",
    session: event.session,
    eps: { actual: null, estimate: event.estimate, surprise: null, surprisePercent: null },
    source: "yahoo-finance",
    sourceAsOf: event.sourceAsOf
  };
}

function earningsSessionLabel(session: ChartEarningsEvent["session"]): string {
  if (session === "pre") return "미국 장전 발표";
  if (session === "after") return "미국 장후 발표";
  if (session === "regular") return "미국 정규장 발표";
  return "발표 시각 미정";
}

function newsImpactLabel(direction: ChartNewsDay["impactDirection"]): string {
  if (direction === "positive") return "긍정 영향";
  if (direction === "negative") return "부정 영향";
  if (direction === "mixed") return "혼합 영향";
  return "중립 영향";
}

function newsSentimentLabel(sentiment: string): string {
  const normalized = sentiment.trim().toLowerCase();
  if (normalized.includes("positive") || normalized.includes("bullish")) return "긍정 심리";
  if (normalized.includes("negative") || normalized.includes("bearish")) return "부정 심리";
  if (normalized.includes("mixed")) return "혼합 심리";
  return "중립 심리";
}

function earningsResultLabel(event: ChartEarningsEvent, upcoming: boolean): string {
  if (upcoming || event.status === "scheduled") return "발표 예정";
  if (event.eps.actual === null) return "실제값 확인 전";
  if (event.eps.surprisePercent === null) return "발표 완료";
  if (event.eps.surprisePercent > 0) return "예상치 상회";
  if (event.eps.surprisePercent < 0) return "예상치 하회";
  return "예상치 부합";
}

function formatEps(value: number | null): string {
  return value === null ? "—" : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatSignedEps(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${formatEps(value)}`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function metricTone(value: number | null): string {
  if (value === null || value === 0) return "is-neutral";
  return value > 0 ? "is-positive" : "is-negative";
}
