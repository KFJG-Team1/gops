import { useEffect, useState } from "react";
import {
  cancelCzardasBuild,
  czardasIntervals,
  deleteCzardasAsset,
  fetchCzardasAssetsSnapshot,
  fetchCzardasBuildStatus,
  invalidateCzardasAssets,
  isCzardasAssetsGenerationCurrent,
  isCzardasInterval,
  submitCzardasBuild,
  subscribeCzardasAssetsInvalidation,
  type CzardasAssetsResponse,
  type CzardasBuildAccepted,
  type CzardasBuildStatus,
  type CzardasInterval
} from "../chart/czardasAssetsApi";
import type { ChartInterval } from "../chart/types";

const terminalStatuses = new Set(["completed", "completed_with_errors", "failed", "canceled"]);

export function ChartAssetOpsPanel({
  currentSymbol,
  currentInterval
}: {
  currentSymbol: string;
  currentInterval: ChartInterval;
}) {
  const normalizedCurrentSymbol = currentSymbol.trim().toUpperCase();
  const [symbol, setSymbol] = useState(normalizedCurrentSymbol);
  const [interval, setInterval] = useState<CzardasInterval>(isCzardasInterval(currentInterval) ? currentInterval : "1D");
  const [force, setForce] = useState(false);
  const [assets, setAssets] = useState<CzardasAssetsResponse | null>(null);
  const [accepted, setAccepted] = useState<CzardasBuildAccepted | null>(null);
  const [submittedPair, setSubmittedPair] = useState<{ symbol: string; interval: CzardasInterval } | null>(null);
  const [job, setJob] = useState<CzardasBuildStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const normalizedSymbol = symbol.trim().toUpperCase();

  useEffect(() => {
    setSymbol(normalizedCurrentSymbol);
    if (isCzardasInterval(currentInterval)) setInterval(currentInterval);
  }, [currentInterval, normalizedCurrentSymbol]);

  useEffect(() => subscribeCzardasAssetsInvalidation((invalidatedSymbol) => {
    if (!invalidatedSymbol || invalidatedSymbol === normalizedSymbol) {
      setAssets(null);
      setRevision((current) => current + 1);
    }
  }), [normalizedSymbol]);

  useEffect(() => {
    if (!normalizedSymbol) {
      setAssets(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setAssets((current) => current?.symbol === normalizedSymbol ? current : null);
    fetchCzardasAssetsSnapshot(normalizedSymbol)
      .then(({ response, generation }) => {
        if (active && isCzardasAssetsGenerationCurrent(normalizedSymbol, generation)) setAssets(response);
      })
      .catch((reason) => { if (active) setError(errorMessage(reason, "Czardas 자산을 불러오지 못했습니다.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [normalizedSymbol, revision]);

  useEffect(() => {
    if (!accepted || !submittedPair) return undefined;
    let active = true;
    let timer: number | null = null;
    const poll = async () => {
      let terminal = false;
      try {
        const next = await fetchCzardasBuildStatus(accepted.status_url);
        if (!active) return;
        setJob(next);
        terminal = terminalStatuses.has(next.status);
        if (terminal) invalidateCzardasAssets(submittedPair.symbol);
      } catch (reason) {
        if (active) setError(errorMessage(reason, "빌드 상태를 확인하지 못했습니다."));
      }
      if (active && !terminal) timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [accepted, submittedPair]);

  const entry = assets?.symbol === normalizedSymbol ? assets.assets[interval] : null;
  const running = job?.status === "queued" || job?.status === "running";
  const failure = (job?.failedItems ?? job?.recentItems ?? []).find((item) => item.status === "failed");

  const runBuild = async () => {
    if (!normalizedSymbol || !/^[A-Z0-9.-]{1,16}$/.test(normalizedSymbol)) {
      setError("유효한 종목 심볼 하나를 입력하세요.");
      return;
    }
    setError(null);
    setNotice(null);
    setJob(null);
    try {
      const pair = { symbol: normalizedSymbol, interval };
      const next = await submitCzardasBuild({ ...pair, force });
      setSubmittedPair(pair);
      setAccepted(next);
    } catch (reason) {
      setError(errorMessage(reason, "빌드를 시작하지 못했습니다."));
    }
  };

  const removeAsset = async () => {
    if (!entry || entry.freshness === "missing" || !window.confirm(`${normalizedSymbol} ${interval} Czardas 자산을 삭제할까요?`)) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await deleteCzardasAsset(normalizedSymbol, interval);
      setNotice(`${result.symbol} ${result.interval} 자산 ${result.deleted}건을 삭제했습니다.`);
    } catch (reason) {
      setError(errorMessage(reason, "Czardas 자산을 삭제하지 못했습니다."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="chart-asset-ops-panel">
      <section className="chart-asset-ops-form">
        <header><strong>Czardas 수동 분석</strong><span>종목 × interval 한 쌍</span></header>
        <div className="chart-asset-ops-symbols">
          <textarea
            aria-label="Czardas 분석 심볼"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[\s,]+/g, ""))}
          />
          <button type="button" onClick={() => setSymbol(normalizedCurrentSymbol)}>현재 종목</button>
        </div>
        <div className="chart-asset-ops-options" role="radiogroup" aria-label="Czardas 분석 interval">
          {czardasIntervals.map((value) => (
            <label key={value}>
              <input type="radio" name="czardas-interval" checked={interval === value} onChange={() => setInterval(value)} />
              {value}
            </label>
          ))}
        </div>
        <label className="chart-asset-ops-check">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          기존 결과와 같아도 강제 재분석
        </label>
        <div className="chart-asset-ops-actions">
          <button type="button" disabled={running || loading || !normalizedSymbol} onClick={() => void runBuild()}>분석 시작</button>
          {running && accepted && (
            <button type="button" onClick={() => void cancelCzardasBuild(accepted.jobId).then(setJob).catch((reason) => setError(errorMessage(reason, "중단하지 못했습니다.")))}>중단</button>
          )}
          <button type="button" disabled={loading} onClick={() => invalidateCzardasAssets(normalizedSymbol)}>새로고침</button>
        </div>
      </section>

      {error && <p className="chart-asset-ops-error" role="alert">{error}</p>}
      {notice && <p className="chart-asset-ops-notice" role="status">{notice}</p>}

      {job && (
        <section className="chart-asset-ops-progress">
          <div><span>{job.status}</span><span>{job.progress.done}/{job.progress.total} · 생성 {job.createdEntities ?? 0} · 실패 {job.progress.failed}</span></div>
          <progress max={Math.max(1, job.progress.total)} value={job.progress.done} />
          <p>{job.progress.current ?? "대기 중"}</p>
          {job.repair && (job.repair.checkedSymbols > 0 || job.repair.attemptedSymbols > 0) && (
            <p>
              데이터 점검 {job.repair.checkedSymbols} · 복구 {job.repair.repairedSymbols} · 결측 {job.repair.missingBarsBefore}→{job.repair.missingBarsAfter} · 적재 {job.repair.materializedRows}
              {job.repair.reasonCodes && Object.keys(job.repair.reasonCodes).length
                ? ` · 사유 ${Object.entries(job.repair.reasonCodes).map(([reason, count]) => `${reason} ${count}`).join(", ")}`
                : ""}
            </p>
          )}
          {failure && <p role="alert">실패 사유: {failure.reason ?? failure.error ?? failure.stage}</p>}
        </section>
      )}

      <section className="chart-asset-ops-current">
        <header><strong>선택한 자산</strong><span>{normalizedSymbol || "-"} {interval}</span></header>
        {loading ? <p>불러오는 중…</p> : entry?.pack ? (
          <>
            <p>
              freshness {entry.freshness} · H-Line {entry.pack.selection.hline.actualCount}
              {` · Trend ${entry.pack.selection.trend.actualCount} · Pattern ${entry.pack.selection.pattern.actualCount}`}
            </p>
            <p>
              coverage exact · {entry.pack.coverage.actualCompleted}/{entry.pack.coverage.targetCompleted}봉
              {` · Field ${entry.pack.czardasField.basisFacts.basisIds.length} basis`}
            </p>
            {entry.pack.patternRelations.length > 0 && (
              <p>감지 패턴 {entry.pack.patternRelations.map((pattern) => patternName(pattern.kind)).join(" · ")}</p>
            )}
            <p>생성 {formatGeneratedAt(entry.generatedAt)}</p>
            <button type="button" disabled={deleting || running} onClick={() => void removeAsset()}>{deleting ? "삭제 중" : "자산 삭제"}</button>
          </>
        ) : entry?.freshness === "incompatible" ? (
          <>
            <p>호환되지 않는 Czardas 자산입니다.</p>
            <button type="button" disabled={deleting || running} onClick={() => void removeAsset()}>{deleting ? "삭제 중" : "자산 삭제"}</button>
          </>
        ) : <p>저장된 Czardas 자산이 없습니다.</p>}
      </section>
    </div>
  );
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

function formatGeneratedAt(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
