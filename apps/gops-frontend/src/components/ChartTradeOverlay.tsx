import { useMemo } from "react";

import {
  buildChartTradeMarkerInsights,
  type ChartTradeFill,
  type ChartTradeFillInsight,
  type ChartTradeMarker
} from "../chart/chartTradeMarkers";

type ChartTradeOverlayProps = {
  markers: ChartTradeMarker[];
  fills: ChartTradeFill[];
  referencePrice: number | null;
};

const koreaDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

const usdPrice = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6
});

const signedUsd = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "USD",
  signDisplay: "always",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const signedPercent = new Intl.NumberFormat("ko-KR", {
  signDisplay: "always",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function ChartTradeOverlay({ markers, fills, referencePrice }: ChartTradeOverlayProps) {
  const insights = useMemo(
    () => buildChartTradeMarkerInsights(markers, fills, referencePrice),
    [fills, markers, referencePrice]
  );

  return (
    <div className="chart-trade-marker-layer" aria-label="차트 매매 체결">
      {markers.map((marker) => {
        const insight = insights.get(marker.id) ?? unavailableInsight;
        const sideLabel = marker.side === "buy" ? "매수" : "매도";
        const grouped = marker.fills.length > 1;
        const statusLabel = tradeStatusLabel(marker.side, insight);
        const tooltipId = `chart-trade-tooltip-${safeDomId(marker.id)}`;
        const description = [
          `${marker.fill.symbol} ${sideLabel}`,
          grouped ? `${marker.fills.length}건` : "1건",
          `${grouped ? "총 수량" : "수량"} ${formatQuantity(marker.fill.quantity)}주`,
          `${grouped ? "평균 체결가" : "체결가"} ${usdPrice.format(marker.fill.price)}`,
          statusLabel,
          formatFillTime(marker.fills)
        ].join(" · ");
        const placement = tradeTooltipPlacement(marker);
        return (
          <span
            key={marker.id}
            className={`chart-trade-marker is-${marker.side} is-tooltip-${placement.vertical} is-tooltip-${placement.horizontal}`}
            style={{ left: marker.x, top: marker.top }}
            data-chart-trade-id={marker.id}
            role="img"
            tabIndex={0}
            aria-label={description}
            aria-describedby={tooltipId}
          >
            <span className="chart-trade-marker-glyph" aria-hidden="true">{marker.label}</span>
            <span
              id={tooltipId}
              className={`chart-trade-tooltip is-${insight.tone}`}
              role="tooltip"
            >
              <span className="chart-trade-tooltip-heading">
                <strong>{marker.fill.symbol}</strong>
                <span className={`chart-trade-tooltip-side is-${marker.side}`}>
                  {sideLabel}{grouped ? ` · ${marker.fills.length}건` : ""}
                </span>
              </span>
              <span className={`chart-trade-tooltip-status is-${insight.tone}`}>
                <span aria-hidden="true" />
                {statusLabel}
              </span>
              <span className="chart-trade-tooltip-details">
                <TooltipRow
                  label={grouped ? "평균 체결가" : "체결가"}
                  value={usdPrice.format(marker.fill.price)}
                />
                <TooltipRow
                  label={grouped ? "총 수량" : "수량"}
                  value={`${formatQuantity(marker.fill.quantity)}주`}
                />
                {insight.kind === "mark_to_market" && insight.basisPrice !== null && (
                  <TooltipRow label="현재가" value={usdPrice.format(insight.basisPrice)} />
                )}
                {insight.kind === "realized" && insight.basisPrice !== null && (
                  <TooltipRow label="평균 매입가" value={usdPrice.format(insight.basisPrice)} />
                )}
                <TooltipRow
                  className={`chart-trade-tooltip-pnl is-${insight.tone}`}
                  label={insight.kind === "realized" ? "실현손익" : "현재가 대비"}
                  value={formatPnl(insight)}
                />
              </span>
              <span className="chart-trade-tooltip-time">
                {formatFillTime(marker.fills)}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

function TooltipRow({
  label,
  value,
  className = ""
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span className={`chart-trade-tooltip-row ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

const unavailableInsight: ChartTradeFillInsight = {
  kind: "unavailable",
  tone: "unavailable",
  amount: null,
  percent: null,
  basisPrice: null
};

function tradeStatusLabel(side: ChartTradeFill["side"], insight: ChartTradeFillInsight): string {
  if (insight.kind === "unavailable") {
    return side === "buy" ? "현재가 확인 중" : "매입 원가 확인 불가";
  }
  if (side === "sell") {
    return insight.tone === "gain" ? "수익 실현" : insight.tone === "loss" ? "손실 확정" : "본전 청산";
  }
  return insight.tone === "gain" ? "수익 구간" : insight.tone === "loss" ? "손실 구간" : "본전 구간";
}

function formatPnl(insight: ChartTradeFillInsight): string {
  if (insight.amount === null || insight.percent === null) return "계산 불가";
  return `${signedUsd.format(insight.amount)} (${signedPercent.format(insight.percent)}%)`;
}

function tradeTooltipPlacement(marker: ChartTradeMarker): {
  horizontal: "left" | "center" | "right";
  vertical: "above" | "below";
} {
  const tooltipHalfWidth = 124;
  const tooltipHeight = marker.fills.length > 1 ? 210 : 190;
  const horizontal = marker.x < tooltipHalfWidth
    ? "left"
    : marker.viewportWidth - marker.x < tooltipHalfWidth
      ? "right"
      : "center";
  const preferredVertical = marker.side === "buy" ? "above" : "below";
  const vertical = preferredVertical === "above" && marker.top < tooltipHeight
    ? "below"
    : preferredVertical === "below" && marker.viewportHeight - marker.top < tooltipHeight
      ? "above"
      : preferredVertical;
  return { horizontal, vertical };
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 }).format(quantity);
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function formatFillTime(fills: ChartTradeFill[]): string {
  const first = fills[0];
  const last = fills.at(-1) ?? first;
  if (!first || !last) return "";
  if (fills.length === 1) {
    return `${koreaDateTime.format(new Date(first.filledAt))} KST`;
  }
  return [
    `${fills.length}건`,
    koreaDateTime.format(new Date(first.filledAt)),
    "~",
    koreaDateTime.format(new Date(last.filledAt)),
    "KST"
  ].join(" ");
}
