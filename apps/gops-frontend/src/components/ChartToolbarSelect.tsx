import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";

export type ChartToolbarSelectOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type ChartToolbarSelectVariant = "chart-type" | "interval" | "drawing-tool" | "drawing-count";

type ChartToolbarSelectProps<T extends string> = {
  value: T;
  options: readonly ChartToolbarSelectOption<T>[];
  ariaLabel: string;
  variant: ChartToolbarSelectVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: T) => void;
  onReselect?: () => void;
  showSelectedLabel?: boolean;
  menuMinWidth?: number;
  optionsAriaLabel?: string;
  active?: boolean;
};

const menuGap = 6;
const viewportInset = 8;

export function ChartToolbarSelect<T extends string>({
  value,
  options,
  ariaLabel,
  variant,
  open,
  onOpenChange,
  onChange,
  onReselect,
  showSelectedLabel = true,
  menuMinWidth,
  optionsAriaLabel,
  active = false
}: ChartToolbarSelectProps<T>) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(() => selectedOptionIndex(options, value));
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const selectedIndex = selectedOptionIndex(options, value);
  const selectedOption = options[selectedIndex];
  const highlightedOption = options[highlightedIndex];
  const hasOptionIcons = options.some((option) => Boolean(option.icon));

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(selectedIndex);
    }
  }, [open, selectedIndex]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const defaultMinimumWidth = variant === "chart-type"
        ? 104
        : variant === "drawing-tool"
          ? 142
          : 72;
      const minimumWidth = menuMinWidth ?? defaultMinimumWidth;
      const width = Math.max(rect.width, minimumWidth);
      const viewportWidth = window.innerWidth || width + viewportInset * 2;
      const viewportHeight = window.innerHeight || rect.bottom + 320;
      const left = Math.max(
        viewportInset,
        Math.min(rect.left, viewportWidth - width - viewportInset)
      );
      const top = rect.bottom + menuGap;
      const maxHeight = Math.max(0, viewportHeight - top - viewportInset);
      setMenuStyle({
        left,
        top,
        width,
        maxHeight
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuMinWidth, open, variant]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      onOpenChange(false);
    };
    window.document.addEventListener("pointerdown", closeOnOutsideInteraction);
    window.document.addEventListener("focusin", closeOnOutsideInteraction);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      window.document.removeEventListener("focusin", closeOnOutsideInteraction);
    };
  }, [onOpenChange, open]);

  const openMenu = (initialIndex = selectedIndex) => {
    setHighlightedIndex(normalizeOptionIndex(initialIndex, options.length));
    onOpenChange(true);
  };

  const closeMenu = (restoreFocus = false) => {
    onOpenChange(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const selectOption = (nextValue: T) => {
    if (options.find((option) => option.value === nextValue)?.disabled) {
      return;
    }
    if (nextValue === value) {
      onReselect?.();
    } else {
      onChange(nextValue);
    }
    closeMenu(true);
  };

  const moveHighlight = (delta: 1 | -1) => {
    setHighlightedIndex((current) => {
      if (!options.length) {
        return 0;
      }
      const base = normalizeOptionIndex(current, options.length);
      return nextEnabledOptionIndex(options, base, delta);
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      if (open) {
        onOpenChange(false);
      }
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        closeMenu(true);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu(event.key === "ArrowUp" ? options.length - 1 : selectedIndex);
        return;
      }
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) {
        return;
      }
      event.preventDefault();
      setHighlightedIndex(event.key === "Home"
        ? nextEnabledOptionIndex(options, options.length - 1, 1)
        : nextEnabledOptionIndex(options, 0, -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const nextOption = options[normalizeOptionIndex(highlightedIndex, options.length)];
      if (nextOption) {
        selectOption(nextOption.value);
      }
    }
  };

  const menu = open && menuStyle && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className={`chart-toolbar-select-menu is-${variant} ${hasOptionIcons ? "has-icons" : ""}`.trim()}
          role="listbox"
          aria-label={optionsAriaLabel ?? `${ariaLabel} options`}
          style={menuStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={option.value}
                id={`${listboxId}-option-${option.value}`}
                type="button"
              role="option"
              tabIndex={-1}
              aria-selected={selected}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
                data-value={option.value}
                className={`${selected ? "is-selected" : ""} ${highlighted ? "is-highlighted" : ""}`.trim()}
                onPointerMove={() => setHighlightedIndex(index)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => selectOption(option.value)}
              >
                {option.icon && (
                  <span className="chart-toolbar-select-option-icon" aria-hidden="true">{option.icon}</span>
                )}
                <span className="chart-toolbar-select-option-label">{option.label}</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body
      )
    : null;

  const selectedLabel = selectedOption?.label ?? value;
  const activeDescendant = open && highlightedOption
    ? `${listboxId}-option-${highlightedOption.value}`
    : undefined;

  return (
    <div className={`chart-toolbar-select chart-instance-${variant}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`chart-toolbar-select-trigger ${open ? "is-open" : ""} ${active ? "is-active" : ""}`.trim()}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
      >
        {selectedOption?.icon && (
          <span className="chart-toolbar-select-trigger-icon" aria-hidden="true">{selectedOption.icon}</span>
        )}
        {showSelectedLabel && <span className="chart-toolbar-select-trigger-label">{selectedLabel}</span>}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}

function selectedOptionIndex<T extends string>(options: readonly ChartToolbarSelectOption<T>[], value: T): number {
  return normalizeOptionIndex(options.findIndex((option) => option.value === value), options.length);
}

function nextEnabledOptionIndex<T extends string>(
  options: readonly ChartToolbarSelectOption<T>[],
  current: number,
  delta: 1 | -1
): number {
  if (!options.length) return 0;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (current + delta * step + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return normalizeOptionIndex(current, options.length);
}

function normalizeOptionIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), optionCount - 1);
}
