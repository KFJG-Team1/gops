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
  if (!pack || entry?.freshness !== "current") {
    const text = entry?.freshness === "incompatible"
      ? "현재 엔진과 호환되지 않는 Czardas 자산입니다."
      : entry?.freshness === "stale"
        ? "현재 차트 입력과 Czardas 추론 identity가 달라 해설을 숨겼습니다."
      : "Czardas 자산이 준비되지 않았습니다.";
    return <Empty text={text} />;
  }

  const focusDrawings = (drawingIds: string[], candidateIds: string[]) => window.dispatchEvent(new CustomEvent("gops:czardas-focus", {
    detail: {
      symbol: normalizedSymbol,
      interval,
      drawingIds,
      candidateIds,
      inferenceId: pack.inferenceId,
      asOf: pack.asOf,
      inputDigest: pack.inputDigest,
    }
  }));
  return (
    <article className="chart-commentary-panel">
      <header className="chart-commentary-meta">
        <span className="chart-commentary-badge">{interval}</span>
        <span>분석 기준 {formatAsOf(pack.asOf)}</span>
        <span className="chart-commentary-badge is-muted">{entry?.freshness ?? "missing"}</span>
      </header>
      <h3 className="chart-commentary-headline">Czardas가 본 차트</h3>
      <p className="chart-commentary-text">
        240개 완료봉에서 H-Line {pack.selection.hline.actualCount}개, Trend {pack.selection.trend.actualCount}개,
        Pattern {pack.selection.pattern.actualCount}개를 선택했습니다.
      </p>
      {pack.patternRelations.map((pattern) => (
        <section key={pattern.relationId} className="chart-commentary-pattern">
          <button type="button" onClick={() => focusDrawings(
            [`czardas:${pattern.relationId}:pattern`],
            pattern.boundaryCandidateIds
          )}>
            {pattern.displayName} · 구조 관계 {pattern.relationQuality.toFixed(2)}
          </button>
          <span>{pattern.explanation?.claim ?? `${patternName(pattern.kind)} 관계`}</span>
          <span>근거: {pattern.explanation?.because?.join(" · ") || "공통 Field 경계와 접촉 순서"}</span>
          <span>반대 근거: {pattern.explanation?.against?.join(" · ") || "관측된 반대 근거 없음"}</span>
          <span>무효화: 관계를 지탱하는 경계의 지속 종가 이탈</span>
          <span>데이터 조건: {pattern.explanation?.dataQualifier ?? "exact-240 현재 관점이며 매매 신호가 아님"}</span>
        </section>
      ))}
      <section className="chart-commentary-levels" aria-label="Czardas 경계 해석">
        <h3>선택 근거</h3>
        {pack.boundaries.length ? (
          <ul>
            {pack.boundaries.map((boundary) => (
              <li key={boundary.candidateId}>
                <button type="button" onClick={() => focusDrawings([`czardas:${boundary.candidateId}:line`], [boundary.candidateId])}>
                  {boundaryName(boundary)} {boundary.line.priceAtAsOf.toFixed(2)} · 구조 우선순위 {boundary.rank.rankScore.toFixed(2)}
                </button>
                <span>Czardas 원본 · 구조 우선순위는 확률이나 매매 신호가 아닙니다.</span>
                <span>{boundary.explanation.claim}</span>
                <span>
                  형성 {boundary.formation.fitCount}회 · 독립 반응 {boundary.responses.completedCount}회
                  {boundary.isRelevantNow ? " · 현재 구간과 가까움" : ""}
                </span>
                <span>근거: {boundary.explanation.because.length ? boundary.explanation.because.join(" · ") : "독립 근거 없음"}</span>
                <span>반대 근거: {boundary.explanation.against.length ? boundary.explanation.against.join(" · ") : "관측된 반대 근거 없음"}</span>
                <span>무효화: {boundary.explanation.invalidationCondition}</span>
                <span>데이터 조건: {boundary.explanation.dataQualifier}</span>
              </li>
            ))}
          </ul>
        ) : <p className="chart-commentary-text">선택 조건을 통과한 경계가 없습니다. Field는 유지되어 Czardas의 관찰 근거를 보여줍니다.</p>}
      </section>
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
  return {
    triangle: "삼각형",
    channel: "채널",
    rectangle: "직사각형",
    wedge: "쐐기",
    flag: "플래그",
    pennant: "페넌트"
  }[kind] ?? kind;
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
