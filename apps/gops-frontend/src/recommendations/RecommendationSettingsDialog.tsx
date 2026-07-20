import { X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { InvestmentProfileForm } from "./InvestmentProfileForm";
import type { InvestmentProfile } from "./recommendationApi";

type RecommendationSettingsDialogProps = {
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSaved: (profile: InvestmentProfile) => void;
};

export function RecommendationSettingsDialog({
  returnFocusRef,
  onClose,
  onSaved
}: RecommendationSettingsDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [returnFocusRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []);
      if (focusable.length === 0) {
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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const dialog = (
    <div
      className="recommendation-settings-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="recommendation-settings-dialog surface-floating"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-settings-title"
        aria-describedby="recommendation-settings-description"
        tabIndex={-1}
      >
        <header>
          <div>
            <strong id="recommendation-settings-title">추천 설정</strong>
            <span id="recommendation-settings-description">장중 추천에 적용할 투자 성향과 제외 조건을 관리합니다.</span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="recommendation-settings-close"
            aria-label="추천 설정 닫기"
            title="닫기"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <InvestmentProfileForm onSaved={onSaved} />
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
