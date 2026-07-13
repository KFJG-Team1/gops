import { useEffect, useState } from "react";
import {
  fetchCzardasAssetsSnapshot,
  isCzardasAssetsGenerationCurrent,
  isCzardasInterval,
  subscribeCzardasAssetsInvalidation,
  type CzardasAssetsResponse,
  type CzardasBoundary
} from "../chart/czardasAssetsApi";
import type { ChartInterval } from "../chart/types";

export function ChartCommentaryPanel({ symbol, interval }: {
  symbol: string;
  interval: ChartInterval;
}) {
  const [assets, setAssets] = useState<CzardasAssetsResponse | null>(null);
  const [revision, setRevision] = useState(0);
  const normalizedSymbol = symbol.trim().toUpperCase();

  useEffect(() => subscribeCzardasAssetsInvalidation((invalidatedSymbol) => {
    if (!invalidatedSymbol || invalidatedSymbol === normalizedSymbol) {
      setAssets(null);
      setRevision((current) => current + 1);
    }
  }), [normalizedSymbol]);

  useEffect(() => {
    let active = true;
    fetchCzardasAssetsSnapshot(normalizedSymbol)
      .then(({ response, generation }) => {
        if (active && isCzardasAssetsGenerationCurrent(normalizedSymbol, generation)) setAssets(response);
      })
      .catch(() => { if (active) setAssets(null); });
    return () => { active = false; };
  }, [normalizedSymbol, revision]);

  if (!isCzardasInterval(interval)) return <Empty text="이 interval은 Czardas 분석을 지원하지 않습니다." />;
  const entry = assets?.assets[interval] ?? null;
  const pack = entry?.pack ?? null;
  if (!pack) {
    const text = entry?.freshness === "incompatible"
      ? "현재 엔진과 호환되지 않는 Czardas 자산입니다."
      : "Czardas 자산이 준비되지 않았습니다.";
    return <Empty text={text} />;
  }

  const focusDrawings = (drawingIds: string[]) => window.dispatchEvent(new CustomEvent("gops:czardas-focus", {
    detail: { symbol: normalizedSymbol, interval, drawingIds }
  }));
  const pattern = pack.presentationPattern;

  return (
    <article className="chart-commentary-panel">
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{interval}</span>
        <span className={entry?.freshness === "stale" ? "is-stale" : ""}>분석 기준 {formatAsOf(pack.asOf)}</span>
        <span className="chart-commentary-badge is-muted">{entry?.freshness ?? "missing"}</span>
      </header>
      <h3 className="chart-commentary-headline">Czardas가 본 차트</h3>
      <p className="chart-commentary-text">
        240개 완료봉에서 H-Line {pack.selection.hline.actualCount}개와 Trend {pack.selection.trend.actualCount}개를 선택했습니다.
      </p>
      {pattern && (
        <button type="button" onClick={() => focusDrawings([
          pattern.upperDrawingId ?? `czardas:${pattern.upperCandidateId}:line`,
          pattern.lowerDrawingId ?? `czardas:${pattern.lowerCandidateId}:line`
        ])}>
          {patternName(pattern.kind)} · 두 Trend의 수렴 관계
        </button>
      )}
      <section className="chart-commentary-levels" aria-label="Czardas 경계 해석">
        <h3>선택 근거</h3>
        {pack.boundaries.length ? (
          <ul>
            {pack.boundaries.map((boundary) => (
              <li key={boundary.candidateId}>
                <button type="button" onClick={() => focusDrawings([`czardas:${boundary.candidateId}:line`])}>
                  {boundaryName(boundary)} {boundary.line.priceAtAsOf.toFixed(2)} · 강도 {boundary.rank.rankScore.toFixed(2)}
                </button>
                <span>{boundary.explanation.claim}</span>
                <span>
                  형성 {boundary.formation.fitCount}회 · 독립 반응 {boundary.responses.completedCount}회
                  {boundary.isRelevantNow ? " · 현재 구간과 가까움" : ""}
                </span>
                {boundary.explanation.because.length > 0 && <span>{boundary.explanation.because.join(" · ")}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="chart-commentary-text">선택 조건을 통과한 경계가 없습니다. Field는 유지되어 Czardas의 관찰 근거를 보여줍니다.</p>}
      </section>
      {entry?.freshness === "stale" && <p className="chart-commentary-invalidation">최신 완료봉과 저장된 추론 입력이 달라 이전 제안을 낮은 불투명도로 표시합니다.</p>}
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="chart-commentary-empty" role="status"><span>{text}</span></div>;
}

function boundaryName(boundary: CzardasBoundary): string {
  return {
    support: "지지 H-Line",
    resistance: "저항 H-Line",
    lower: "하단 Trend",
    upper: "상단 Trend"
  }[boundary.role];
}

function patternName(kind: string): string {
  return { ascending_triangle: "상승 삼각형", descending_triangle: "하락 삼각형", symmetrical_triangle: "대칭 삼각형" }[kind] ?? kind;
}

function formatAsOf(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York"
  });
}
