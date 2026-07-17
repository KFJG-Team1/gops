import type { ChartTradeMarker } from "../chart/chartTradeMarkers";

type ChartTradeOverlayProps = {
  markers: ChartTradeMarker[];
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

export function ChartTradeOverlay({ markers }: ChartTradeOverlayProps) {
  return (
    <div className="chart-trade-marker-layer" aria-label="차트 매매 체결">
      {markers.map((marker) => {
        const sideLabel = marker.side === "buy" ? "매수" : "매도";
        const description = [
          `${marker.fill.symbol} ${sideLabel}`,
          `${formatQuantity(marker.fill.quantity)}주`,
          usdPrice.format(marker.fill.price),
          koreaDateTime.format(new Date(marker.fill.filledAt))
        ].join(" · ");
        return (
          <span
            key={marker.id}
            className={`chart-trade-marker is-${marker.side}`}
            style={{ left: marker.x, top: marker.top }}
            data-chart-trade-id={marker.id}
            role="img"
            tabIndex={0}
            aria-label={description}
            title={description}
          >
            {marker.label}
          </span>
        );
      })}
    </div>
  );
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 }).format(quantity);
}
