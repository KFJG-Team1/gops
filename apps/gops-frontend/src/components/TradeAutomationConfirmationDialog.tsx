import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TradeAutomationConfirmationDraft } from "../chart/chartTradeAutomation";

type TradeAutomationConfirmationDialogProps = {
  draft: TradeAutomationConfirmationDraft;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TradeAutomationConfirmationDialog({
  draft,
  onCancel,
  onConfirm
}: TradeAutomationConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const isStale = draft.status === "stale";
  const isBuy = draft.action === "buy_candidate";

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const confirm = () => {
    if (confirming || isStale) {
      return;
    }
    setConfirming(true);
    onConfirm();
  };

  const dialog = (
    <div className="trade-automation-dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div
        ref={dialogRef}
        className="trade-automation-dialog surface-floating"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="trade-automation-dialog-title"
        aria-describedby="trade-automation-dialog-description"
        tabIndex={-1}
        data-preview-mode="frontend_preview_only"
      >
        <header>
          <span>{draft.symbol} · {draft.interval}</span>
          <strong id="trade-automation-dialog-title">{isBuy ? "매수 후보" : "매도 후보"} 확인</strong>
        </header>
        <p id="trade-automation-dialog-description">예약매매 및 목표·손절 근처 알림을 준비합니다.</p>
        <dl>
          <div><dt>예약 기준 가격</dt><dd>{formatPrice(draft.reservationPrice)}</dd></div>
          <div><dt>{isBuy ? "목표가" : "하락 목표가"}</dt><dd>{formatPrice(draft.targetPrice)}</dd></div>
          <div><dt>{isBuy ? "손절가" : "매도 무효화가"}</dt><dd>{formatPrice(draft.stopPrice)}</dd></div>
        </dl>
        {isStale && <p className="trade-automation-dialog-stale" role="alert">분석 기준이 변경되어 확인할 수 없습니다. 현재 차트의 트레이드 플랜을 다시 확인해 주세요.</p>}
        <p className="trade-automation-dialog-preview-note">개발 단계 미리보기입니다. 실제 주문·예약매매·알림은 생성되지 않습니다. · frontend_preview_only</p>
        <footer>
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>취소</button>
          <button type="button" className="is-primary" disabled={confirming || isStale} onClick={confirm}>
            {confirming ? "확인 중" : "확인"}
          </button>
        </footer>
      </div>
    </div>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

function formatPrice(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
}
