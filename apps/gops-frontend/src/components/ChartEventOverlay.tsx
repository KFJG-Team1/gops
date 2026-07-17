import { CalendarClock, ExternalLink, Newspaper, X } from "lucide-react";
import { createPortal } from "react-dom";
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";

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
  upcomingStyle
}: ChartEventOverlayProps) {
  const [selected, setSelected] = useState<SelectedChartEvent | null>(null);
  const [positionRevision, setPositionRevision] = useState(0);
  const popoverRef = useRef<HTMLElement | null>(null);
  const selectedStillVisible = Boolean(selected?.upcoming && earningsVisible && response?.upcomingEarnings)
    || markers.some((marker) => marker.id === selected?.event.id);

  useEffect(() => {
    setSelected(null);
  }, [response?.symbol]);

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
      const trigger = target instanceof Element ? target.closest("[data-chart-event-trigger='true']") : null;
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

  const selectedStyle = useMemo(() => {
    void positionRevision;
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (!selected || !container || !rect) return undefined;
    const scaleX = container.clientWidth > 0 ? rect.width / container.clientWidth : 1;
    const scaleY = container.clientHeight > 0 ? rect.height / container.clientHeight : 1;
    const anchorX = rect.left + selected.anchorX * scaleX;
    const anchorTop = rect.top + selected.anchorTop * scaleY;
    const width = Math.min(360, Math.max(280, window.innerWidth - 24));
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchorX - width / 2));
    const preferredTop = anchorTop - 10;
    const top = preferredTop > 260 ? preferredTop : Math.min(window.innerHeight - 24, anchorTop + 38);
    return {
      left,
      top,
      width,
      "--chart-event-popover-origin": preferredTop > 260 ? "translateY(-100%)" : "translateY(0)"
    } as CSSProperties;
  }, [containerRef, positionRevision, selected]);

  const openUpcoming = () => {
    const upcoming = response?.upcomingEarnings;
    const container = containerRef.current;
    if (!upcoming || !container) return;
    setSelected({
      event: upcomingAsEarningsEvent(response?.symbol ?? "", upcoming),
      anchorX: Math.max(40, container.clientWidth - 110),
      anchorTop: Math.max(44, container.clientHeight - 28),
      upcoming
    });
  };

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
              aria-label={marker.type === "earnings" ? `${marker.marketDate} 실적 이벤트` : `${marker.marketDate} 뉴스 ${marker.label.slice(2)}건`}
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
          aria-label={selected.event.type === "earnings" ? "실적 이벤트 상세" : "뉴스 이벤트 상세"}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <span className="chart-event-popover-icon" aria-hidden="true">
              {selected.event.type === "earnings" ? <CalendarClock size={17} /> : <Newspaper size={17} />}
            </span>
            <div>
              <small>{selected.event.type === "earnings" ? "EARNINGS" : "DAILY NEWS"}</small>
              <strong>{selected.event.type === "earnings" ? "실적 발표" : "기업 뉴스"}</strong>
            </div>
            <button type="button" aria-label="이벤트 상세 닫기" onClick={() => setSelected(null)}>
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
  return (
    <div className="chart-event-popover-body">
      <div className="chart-event-heading-copy">
        <span>{koreaDateTime.format(new Date(event.eventAt))} · 한국 시간</span>
        <strong>{session}</strong>
      </div>
      {upcoming && <p className="chart-event-upcoming-note">예정된 발표까지 D-{upcoming.daysRemaining}입니다.</p>}
      <dl className="chart-event-metrics">
        <div><dt>실제 EPS</dt><dd>{formatEps(event.eps.actual)}</dd></div>
        <div><dt>예상 EPS</dt><dd>{formatEps(event.eps.estimate)}</dd></div>
        <div className={metricTone(event.eps.surprise)}><dt>서프라이즈</dt><dd>{formatSignedEps(event.eps.surprise)}</dd></div>
        <div className={metricTone(event.eps.surprisePercent)}><dt>서프라이즈율</dt><dd>{formatSignedPercent(event.eps.surprisePercent)}</dd></div>
      </dl>
      <footer>출처 {event.source} · 기준 {koreaDateTime.format(new Date(event.sourceAsOf))}</footer>
    </div>
  );
}

function NewsEventContent({ event }: { event: ChartNewsDay }) {
  return (
    <div className="chart-event-popover-body">
      <div className="chart-event-heading-copy">
        <span>{dateLabel.format(new Date(`${event.date}T12:00:00Z`))}</span>
        <strong className={`is-${event.impactDirection}`}>{newsImpactLabel(event.impactDirection)} · 기사 {event.articleCount}건</strong>
      </div>
      <p className="chart-event-news-summary">{event.summary || "저장된 일별 요약이 없습니다."}</p>
      {event.keyPoints.length > 0 && (
        <ul className="chart-event-key-points">
          {event.keyPoints.map((point) => <li key={point}>{point}</li>)}
        </ul>
      )}
      {event.sources.length > 0 && (
        <nav className="chart-event-source-links" aria-label="뉴스 원문">
          {event.sources.slice(0, 3).map((source) => (
            <a key={source.articleId ?? source.url} href={source.url} target="_blank" rel="noreferrer">
              <span>{source.name || "원문"}</span>
              <strong>{source.title}</strong>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </nav>
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
