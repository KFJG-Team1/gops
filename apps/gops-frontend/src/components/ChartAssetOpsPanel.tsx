import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelChartAssetBuild,
  deleteChartAssets,
  fetchChartAssetBuildStatus,
  fetchChartAssetCoverage,
  submitChartAssetBuild,
  type ChartAssetBuildAccepted,
  type ChartAssetBuildStatus,
  type ChartAssetCoverageItem
} from "../chart/assetBuildApi";
import { invalidateAnalysisAssets, type AnalysisAssetInterval } from "../chart/analysisAssetsApi";

const terminalStatuses = new Set(["completed", "completed_with_warnings", "completed_with_errors", "failed", "canceled"]);
const allIntervals: AnalysisAssetInterval[] = ["1D", "1W", "1M"];

export function ChartAssetOpsPanel({ currentSymbol }: { currentSymbol: string }) {
  const [useSp500, setUseSp500] = useState(false);
  const [symbolsText, setSymbolsText] = useState(currentSymbol.toUpperCase());
  const [intervals, setIntervals] = useState<AnalysisAssetInterval[]>(allIntervals);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [skipFreshHours, setSkipFreshHours] = useState(0);
  const [accepted, setAccepted] = useState<ChartAssetBuildAccepted | null>(null);
  const [job, setJob] = useState<ChartAssetBuildStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<ChartAssetCoverageItem[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      setCoverage(await fetchChartAssetCoverage());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "자산 현황을 불러오지 못했습니다.");
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  useEffect(() => {
    const node = logRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [job?.logs?.length]);

  useEffect(() => {
    if (!accepted) {
      return undefined;
    }
    let active = true;
    let pollingTimer: number | null = null;
    let source: EventSource | null = null;
    let streamedLogs: string[] = [];

    const applyStatus = (next: ChartAssetBuildStatus) => {
      if (!active) return;
      setJob((current) => ({
        ...next,
        logs: streamedLogs.length ? streamedLogs : current?.jobId === next.jobId ? current.logs ?? [] : []
      }));
      if (terminalStatuses.has(next.status)) {
        invalidateAnalysisAssets();
        source?.close();
        if (pollingTimer !== null) window.clearTimeout(pollingTimer);
        void loadCoverage();
      }
    };
    const poll = async () => {
      try {
        applyStatus(await fetchChartAssetBuildStatus(accepted.status_url));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "빌드 상태를 확인하지 못했습니다.");
      }
      if (active) pollingTimer = window.setTimeout(poll, 1000);
    };
    const startPolling = () => {
      source?.close();
      source = null;
      if (pollingTimer === null) void poll();
    };

    try {
      source = new EventSource(accepted.stream_url);
      const handleStatus = (event: MessageEvent) => {
        try {
          applyStatus(JSON.parse(event.data) as ChartAssetBuildStatus);
        } catch {
          startPolling();
        }
      };
      source.addEventListener("status", handleStatus as EventListener);
      source.addEventListener("log", ((event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as { message?: unknown };
          if (typeof payload.message !== "string" || !payload.message) return;
          streamedLogs = [...streamedLogs, payload.message].slice(-200);
          setJob((current) => current ? { ...current, logs: streamedLogs } : current);
        } catch {
          // Ephemeral logs may be dropped; status polling remains authoritative.
        }
      }) as EventListener);
      source.onerror = startPolling;
    } catch {
      startPolling();
    }
    return () => {
      active = false;
      source?.close();
      if (pollingTimer !== null) window.clearTimeout(pollingTimer);
    };
  }, [accepted, loadCoverage]);

  const running = job?.status === "queued" || job?.status === "running";
  const failedSymbols = [...new Set((job?.failedItems ?? job?.recentItems ?? []).filter((item) => item.status === "failed").map((item) => item.symbol))];

  const runBuild = async (retrySymbols?: string[]) => {
    const symbols = retrySymbols?.length ? retrySymbols : parseSymbols(symbolsText);
    if (!useSp500 && !symbols.length) {
      setError("빌드할 심볼을 입력하세요.");
      return;
    }
    if (!intervals.length) {
      setError("interval을 하나 이상 선택하세요.");
      return;
    }
    if (llmEnabled) {
      const symbolCount = retrySymbols?.length ?? (useSp500 ? 500 : symbols.length);
      const estimatedCalls = symbolCount;
      if (!window.confirm(`LLM 호출은 최대 약 ${estimatedCalls}회입니다. 계속할까요?`)) {
        return;
      }
    }
    setError(null);
    setJob(null);
    const normalizedSkipFreshHours = Number.isFinite(skipFreshHours)
      ? Math.max(0, Math.floor(skipFreshHours))
      : 0;
    try {
      setAccepted(await submitChartAssetBuild({
        symbols: retrySymbols?.length ? retrySymbols : useSp500 ? "sp500" : symbols,
        intervals,
        llmEnabled,
        skipFreshHours: normalizedSkipFreshHours
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "빌드를 시작하지 못했습니다.");
    }
  };

  const removeAsset = async (item: ChartAssetCoverageItem) => {
    const key = `${item.symbol}-${item.interval}`;
    if (!window.confirm(`${item.symbol} ${item.interval} 작도 자산의 모든 저장 이력을 삭제할까요?`)) {
      return;
    }
    setError(null);
    setNotice(null);
    setDeletingKey(key);
    try {
      const result = await deleteChartAssets([item.symbol], [item.interval]);
      invalidateAnalysisAssets(item.symbol);
      setNotice(`${item.symbol} ${item.interval} 자산 ${result.deleted}건을 삭제했습니다.`);
      await loadCoverage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "작도 자산을 삭제하지 못했습니다.");
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="chart-asset-ops-panel">
      <section className="chart-asset-ops-form">
        <div className="chart-asset-ops-universe-row">
          <label className="chart-asset-ops-check"><input type="checkbox" checked={useSp500} onChange={(event) => setUseSp500(event.target.checked)} />전체 S&amp;P500</label>
          <span>콤마로 구분</span>
        </div>
        <div className="chart-asset-ops-symbols">
          <textarea aria-label="빌드 심볼" value={symbolsText} disabled={useSp500} onChange={(event) => setSymbolsText(event.target.value)} />
          <button type="button" onClick={() => setSymbolsText((current) => mergeSymbol(current, currentSymbol))}>현재 심볼 추가</button>
        </div>
        <div className="chart-asset-ops-options">
          {allIntervals.map((interval) => (
            <label key={interval}><input type="checkbox" checked={intervals.includes(interval)} onChange={() => setIntervals((current) => current.includes(interval) ? current.filter((item) => item !== interval) : [...current, interval])} />{interval}</label>
          ))}
          <label><input type="checkbox" checked={llmEnabled} onChange={(event) => setLlmEnabled(event.target.checked)} />LLM 포함</label>
          <label>갱신 스킵(시간)<input type="number" min="0" value={skipFreshHours} onChange={(event) => {
            const value = Number(event.target.value);
            setSkipFreshHours(Number.isFinite(value) ? value : 0);
          }} /></label>
        </div>
        <div className="chart-asset-ops-actions">
          <button type="button" disabled={running} onClick={() => void runBuild()}>빌드 시작</button>
          {running && <button type="button" onClick={() => accepted && void cancelChartAssetBuild(accepted.jobId).then(setJob).catch((reason) => setError(String(reason)))}>중단</button>}
          {failedSymbols.length > 0 && <button type="button" disabled={running} onClick={() => void runBuild(failedSymbols)}>실패분 재실행</button>}
        </div>
      </section>

      {error && <p className="chart-asset-ops-error" role="alert">{error}</p>}
      {notice && <p className="chart-asset-ops-notice" role="status">{notice}</p>}
      {job && (
        <section className="chart-asset-ops-progress">
          <div><span>{job.status}</span><span>{job.progress.done}/{job.progress.total} · 생성 {job.createdEntities ?? 0} · 경고 {job.progress.warnings ?? 0} · 실패 {job.progress.failed}</span></div>
          <progress max={Math.max(1, job.progress.total)} value={job.progress.done} />
          <p>{job.progress.current ?? "대기 중"}</p>
          <div ref={logRef} className="chart-asset-ops-log" aria-label="빌드 로그">{(job.logs ?? []).slice(-200).map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div>
          {failedSymbols.length > 0 && <p>실패: {failedSymbols.join(", ")}</p>}
        </section>
      )}

      <section className="chart-asset-ops-coverage">
        <header><strong>자산 현황</strong><button type="button" disabled={coverageLoading} onClick={() => void loadCoverage()}>새로고침</button></header>
        <div className="chart-asset-ops-table-wrap">
          <table>
            <thead><tr><th>심볼</th><th>주기</th><th>상태</th><th>작도</th><th>생성</th><th>관리</th></tr></thead>
            <tbody>{coverage.map((item) => {
              const key = `${item.symbol}-${item.interval}`;
              return <tr key={key}>
                <td>{item.symbol}</td>
                <td>{item.interval}</td>
                <td>{coverageStatus(item)}</td>
                <td>{item.drawingCount ?? "-"}</td>
                <td>{formatGeneratedAt(item.generatedAt)}</td>
                <td><button type="button" disabled={deletingKey !== null} aria-label={`${item.symbol} ${item.interval} 작도 자산 삭제`} onClick={() => void removeAsset(item)}>{deletingKey === key ? "삭제 중" : "삭제"}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function parseSymbols(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

function mergeSymbol(value: string, symbol: string): string {
  return [...new Set([...parseSymbols(value), symbol.trim().toUpperCase()].filter(Boolean))].join(", ");
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function coverageStatus(item: ChartAssetCoverageItem): string {
  const quality = item.qualityState ? ` · ${item.qualityState}` : "";
  const empty = item.drawingCount === 0 ? " · 작도 없음" : "";
  return `${item.status}${quality}${empty}`;
}
