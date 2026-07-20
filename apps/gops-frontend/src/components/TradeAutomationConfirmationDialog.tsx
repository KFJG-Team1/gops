import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TradeAutomationConfirmationDraft } from "../chart/chartTradeAutomation";
import { tradePlanPresentation } from "../chart/tradePlanPresentation";

type TradeAutomationConfirmationDialogProps = {
  draft: TradeAutomationConfirmationDraft;
  onCancel: () => void;
  onConfirm: (quantity: number) => boolean | Promise<boolean>;
};

export function TradeAutomationConfirmationDialog({
  draft,
  onCancel,
  onConfirm
}: TradeAutomationConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [quantity, setQuantity] = useState(String(draft.quantity));
  const [validationError, setValidationError] = useState<string | null>(null);
  const isStale = draft.status === "stale";
  const presentation = tradePlanPresentation(draft.action);

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

  const confirm = async () => {
    if (confirming || isStale) {
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0 || parsedQuantity > 1_000_000) {
      setValidationError("수량은 1주 이상 정수로 입력해 주세요.");
      return;
    }
    setValidationError(null);
    setConfirming(true);
    const completed = await onConfirm(parsedQuantity);
    if (!completed) {
      setConfirming(false);
    }
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
        data-execution-mode="paper"
      >
        <header>
          <span>{draft.symbol} · {draft.interval}</span>
          <strong id="trade-automation-dialog-title">{presentation.scenario} 확인</strong>
        </header>
        <p id="trade-automation-dialog-description">선택한 가격에 가상계좌 예약매매와 가격 알림을 등록합니다.</p>
        <dl>
          <div><dt>예약 기준 가격</dt><dd>{formatPrice(draft.reservationPrice)}</dd></div>
          <div>
            <dt><label htmlFor="trade-automation-quantity">예약 수량</label></dt>
            <dd>
              <input
                id="trade-automation-quantity"
                aria-label="예약 수량"
                type="number"
                min="1"
                max="1000000"
                step="1"
                value={quantity}
                disabled={confirming || isStale}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </dd>
          </div>
          <div><dt>{`분석 ${presentation.target} 가격 (참고)`}</dt><dd>{formatPrice(draft.targetPrice)}</dd></div>
          <div><dt>{`분석 ${presentation.risk} 가격 (참고)`}</dt><dd>{formatPrice(draft.stopPrice)}</dd></div>
        </dl>
        {isStale && <p className="trade-automation-dialog-stale" role="alert">분석 기준이 변경되어 확인할 수 없습니다. 현재 차트의 트레이드 플랜을 다시 확인해 주세요.</p>}
        {validationError && <p className="trade-automation-dialog-stale" role="alert">{validationError}</p>}
        <p className="trade-automation-dialog-execution-note">확인하면 가상계좌 예약매매와 가격 알림이 실제로 등록됩니다. 실계좌 주문은 발생하지 않습니다.</p>
        <footer>
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>취소</button>
          <button type="button" className="is-primary" disabled={confirming || isStale} onClick={() => void confirm()}>
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
