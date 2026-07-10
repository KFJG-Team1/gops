import { MessageCircleQuestion } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";

type ContextualAgentAskButtonProps = {
  onAsk: () => void;
  style?: CSSProperties;
};

export function ContextualAgentAskButton({ onAsk, style }: ContextualAgentAskButtonProps) {
  const stopPointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };
  const ask = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onAsk();
  };

  return (
    <button
      type="button"
      className="contextual-agent-ask"
      style={style}
      aria-label="선택 항목에 질문하기"
      title="선택 항목에 질문하기"
      onPointerDown={stopPointer}
      onClick={ask}
    >
      <MessageCircleQuestion size={13} aria-hidden="true" />
      <span>Ask</span>
    </button>
  );
}
