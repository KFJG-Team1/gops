import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDetectedPattern } from "../chart/analysisAssetPresentation";
import { subscribeAnalysisAssetsInvalidation, type AnalysisAssetInterval } from "../chart/analysisAssetsApi";
import { fetchChartAssetCoverage, type ChartAssetCoverageItem } from "../chart/assetBuildApi";
import {
  buildPatternSymbolGroups,
  filterPatternSymbolGroups,
  type ActivePatternState,
  type PatternAssetEntry
} from "../chart/patternAssetList";
import type { ChartInterval } from "../chart/types";

const intervals: AnalysisAssetInterval[] = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"];
const generatedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

export function ChartPatternListPanel({
  activeSymbol,
  activeInterval,
  onSelectPatternAsset
}: {
  activeSymbol: string;
  activeInterval: ChartInterval;
  onSelectPatternAsset: (symbol: string, interval: AnalysisAssetInterval) => void;
}) {
  const [coverage, setCoverage] = useState<ChartAssetCoverageItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [interval, setInterval] = useState<AnalysisAssetInterval | "all">("all");
  const [state, setState] = useState<ActivePatternState | "all">("all");
  const [kind, setKind] = useState<string | "all">("all");
  const requestSequenceRef = useRef(0);

  const loadCoverage = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const items = await fetchChartAssetCoverage();
      if (requestSequence === requestSequenceRef.current) {
        setCoverage(items);
      }
    } catch (reason) {
      if (requestSequence === requestSequenceRef.current) {
        setError(reason instanceof Error ? reason.message : "패턴 종목을 불러오지 못했습니다.");
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCoverage();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadCoverage]);

  useEffect(() => subscribeAnalysisAssetsInvalidation(() => {
    void loadCoverage();
  }), [loadCoverage]);

  const groups = useMemo(() => buildPatternSymbolGroups(coverage ?? []), [coverage]);
  const patternKinds = useMemo(() => Array.from(new Set(
    groups.flatMap((group) => group.patterns.map((pattern) => pattern.primaryPattern.kind))
  )).sort((left, right) => patternName(left).localeCompare(patternName(right))), [groups]);
  const filteredGroups = useMemo(() => filterPatternSymbolGroups(groups, {
    search,
    interval,
    state,
    kind
  }), [groups, interval, kind, search, state]);

  if (loading && coverage === null) {
    return <PanelState message="패턴 종목을 불러오는 중입니다." busy />;
  }
  if (error && coverage === null) {
    return <PanelState message={error} actionLabel="다시 시도" onAction={() => void loadCoverage()} alert />;
  }

  return (
    <div className="chart-pattern-list-panel">
      <header className="chart-pattern-list-toolbar">
        <strong>{filteredGroups.length}개 종목</strong>
        <button type="button" onClick={() => void loadCoverage()} disabled={loading} aria-label="패턴 종목 새로고침">
          {loading ? "갱신 중" : "새로고침"}
        </button>
      </header>

      <div className="chart-pattern-list-filters">
        <label className="chart-pattern-search">
          <span>검색</span>
          <input
            type="search"
            aria-label="패턴 종목 검색"
            placeholder="종목 코드"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <FilterSelect label="주기" value={interval} onChange={(value) => setInterval(value as AnalysisAssetInterval | "all")}>
          <option value="all">전체</option>
          {intervals.map((value) => <option key={value} value={value}>{value}</option>)}
        </FilterSelect>
        <FilterSelect label="상태" value={state} onChange={(value) => setState(value as ActivePatternState | "all")}>
          <option value="all">전체</option>
          <option value="confirmed">돌파 확인</option>
          <option value="forming">형성 중</option>
        </FilterSelect>
        <FilterSelect label="패턴" value={kind} onChange={setKind}>
          <option value="all">전체</option>
          {patternKinds.map((value) => <option key={value} value={value}>{patternName(value)}</option>)}
        </FilterSelect>
      </div>

      {error && <p className="chart-pattern-list-error" role="alert">{error}</p>}
      {!groups.length ? (
        <PanelState message="활성 패턴이 있는 종목이 없습니다." />
      ) : !filteredGroups.length ? (
        <PanelState message="필터와 일치하는 종목이 없습니다." />
      ) : (
        <div className="chart-pattern-groups" aria-label="패턴 보유 종목 목록">
          {filteredGroups.map((group) => (
            <section className="chart-pattern-group" key={group.symbol}>
              <header>
                <strong>{group.symbol}</strong>
                <span>{group.patterns.length}개 주기</span>
              </header>
              <div className="chart-pattern-group-entries">
                {group.patterns.map((pattern) => {
                  const active = activeSymbol.toUpperCase() === pattern.symbol && activeInterval === pattern.interval;
                  return (
                    <button
                      type="button"
                      key={`${pattern.symbol}:${pattern.interval}`}
                      className={`chart-pattern-entry is-${pattern.primaryPattern.state}${active ? " is-active" : ""}`}
                      data-pattern-symbol={pattern.symbol}
                      data-pattern-interval={pattern.interval}
                      aria-pressed={active}
                      onClick={() => onSelectPatternAsset(pattern.symbol, pattern.interval)}
                    >
                      <span className="chart-pattern-entry-interval">{pattern.interval}</span>
                      <span className="chart-pattern-entry-name">{formatDetectedPattern(pattern.primaryPattern)}</span>
                      <span className="chart-pattern-entry-score">점수 {pattern.primaryPattern.score.toFixed(2)}</span>
                      <time dateTime={pattern.generatedAt}>{formatGeneratedAt(pattern)}</time>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="chart-pattern-filter">
      <span>{label}</span>
      <select aria-label={`패턴 ${label} 필터`} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function PanelState({
  message,
  busy = false,
  alert = false,
  actionLabel,
  onAction
}: {
  message: string;
  busy?: boolean;
  alert?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="chart-pattern-list-state" role={alert ? "alert" : "status"} aria-busy={busy || undefined}>
      <span>{message}</span>
      {actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function patternName(kind: string): string {
  return formatDetectedPattern({ kind, state: "forming" }).split(" · ")[0] ?? kind;
}

function formatGeneratedAt(pattern: PatternAssetEntry): string {
  const generatedAt = new Date(pattern.generatedAt);
  return Number.isFinite(generatedAt.getTime()) ? generatedAtFormatter.format(generatedAt) : "-";
}
