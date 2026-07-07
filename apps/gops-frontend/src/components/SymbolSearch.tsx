import { Search } from "lucide-react";
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChartSymbolDto } from "../chart/types";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

type SymbolSearchProps = {
  symbols: ChartSymbolDto[];
  selectedSymbol?: string;
  selectedLabel?: string;
  placeholder?: string;
  compact?: boolean;
  menuPlacement?: "bottom" | "top";
  className?: string;
  style?: CSSProperties;
  onSelectSymbol: (symbol: string) => void;
  onPointerActivity?: () => void;
  formatSelectedLabel?: (symbol: ChartSymbolDto) => string;
};

export function SymbolSearch({
  symbols,
  selectedSymbol,
  selectedLabel,
  placeholder = "종목 검색",
  compact = false,
  menuPlacement = "bottom",
  className,
  style,
  onSelectSymbol,
  onPointerActivity,
  formatSelectedLabel
}: SymbolSearchProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(selectedLabel ?? "");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const fallbackLabel = selectedSymbol ?? "";
  const selectedDisplayLabel = selectedLabel ?? fallbackLabel;

  const filteredSymbols = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rankSymbolMatches(symbols, normalizedQuery).slice(0, 10);
  }, [query, symbols]);

  useEffect(() => {
    if (!open) {
      setQuery(selectedDisplayLabel);
    }
  }, [open, selectedDisplayLabel]);

  useEffect(() => {
    setHighlightedIndex((current) => clampHighlightedIndex(current, filteredSymbols.length));
  }, [filteredSymbols.length]);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const updateMenuStyle = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const targetWidth = Math.max(rect.width, compact ? 220 : rect.width);
      const viewportWidth = window.innerWidth || targetWidth;
      const left = Math.max(8, Math.min(rect.left, viewportWidth - targetWidth - 8));
      const verticalGap = 6;
      setMenuStyle(menuPlacement === "top"
        ? {
            position: "fixed",
            left,
            bottom: Math.max(8, window.innerHeight - rect.top + verticalGap),
            width: targetWidth
          }
        : {
            position: "fixed",
            left,
            top: rect.bottom + verticalGap,
            width: targetWidth
          });
    };
    updateMenuStyle();
    window.addEventListener("resize", updateMenuStyle);
    window.addEventListener("scroll", updateMenuStyle, true);
    return () => {
      window.removeEventListener("resize", updateMenuStyle);
      window.removeEventListener("scroll", updateMenuStyle, true);
    };
  }, [compact, menuPlacement, open]);

  const selectSymbol = (symbol: ChartSymbolDto) => {
    setQuery(formatSymbolLabel(symbol, formatSelectedLabel));
    setOpen(false);
    setFocused(false);
    onSelectSymbol(symbol.symbol);
  };

  const submitFirstMatch = (rawQuery = query) => {
    const normalizedQuery = rawQuery.trim().toLowerCase();
    const matches = rankSymbolMatches(symbols, normalizedQuery);
    const exact = matches.find((symbol) => symbol.symbol.toLowerCase() === normalizedQuery);
    const next = exact ?? matches[0];
    if (next) {
      selectSymbol(next);
    }
  };

  const selectHighlightedSymbol = () => {
    const next = filteredSymbols[highlightedIndex] ?? filteredSymbols[0];
    if (next) {
      selectSymbol(next);
      return;
    }
    submitFirstMatch();
  };

  const moveHighlight = (direction: 1 | -1) => {
    setOpen(true);
    setFocused(true);
    setHighlightedIndex((current) => {
      if (!filteredSymbols.length) {
        return 0;
      }
      return (clampHighlightedIndex(current, filteredSymbols.length) + direction + filteredSymbols.length) % filteredSymbols.length;
    });
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const active = open || focused;
  const activeOptionId = open && filteredSymbols[highlightedIndex]
    ? `${listboxId}-option-${filteredSymbols[highlightedIndex].symbol}`
    : undefined;

  return (
    <div
      ref={rootRef}
      className={[
        "symbol-search",
        compact ? "symbol-search-compact" : "",
        "surface-flat",
        active ? "surface-recessed is-active" : "",
        className
      ].filter(Boolean).join(" ")}
      style={style}
      onPointerEnter={onPointerActivity}
      onPointerMove={onPointerActivity}
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
          setFocused(false);
          setOpen(false);
          setQuery(selectedDisplayLabel);
        }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => {
          setFocused(true);
          setQuery("");
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveHighlight(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            moveHighlight(-1);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            selectHighlightedSymbol();
            return;
          }
          if (event.key === "Escape") {
            setOpen(false);
            setFocused(false);
            setQuery(selectedDisplayLabel);
            setHighlightedIndex(0);
          }
        }}
        placeholder={placeholder}
        aria-label="Symbol search"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-expanded={open}
        aria-haspopup="listbox"
        autoComplete="off"
      />
      <button
        type="button"
        aria-label="Open symbol dropdown"
        title="Open symbol dropdown"
        onClick={() => {
          if (open) {
            setOpen(false);
            setFocused(false);
            setQuery(selectedDisplayLabel);
            return;
          }
          setFocused(true);
          setQuery("");
          setOpen(true);
          setHighlightedIndex(0);
          focusInput();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveHighlight(1);
            focusInput();
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            moveHighlight(-1);
            focusInput();
            return;
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            selectHighlightedSymbol();
          }
        }}
      >
        <Search size={compact ? 12 : 14} aria-hidden="true" />
      </button>
      {open && menuStyle && createPortal(
        <div
          id={listboxId}
          className="symbol-search-menu surface-flat surface-recessed"
          style={menuStyle}
          role="listbox"
          aria-label="Symbols"
          onPointerEnter={onPointerActivity}
          onPointerMove={onPointerActivity}
        >
          {filteredSymbols.map((symbol, index) => (
            <button
              key={symbol.symbol}
              id={`${listboxId}-option-${symbol.symbol}`}
              type="button"
              className={[
                symbol.symbol === selectedSymbol ? "active" : "",
                index === highlightedIndex ? "highlighted" : ""
              ].filter(Boolean).join(" ")}
              role="option"
              aria-selected={index === highlightedIndex}
              onPointerMove={() => setHighlightedIndex(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                selectSymbol(symbol);
              }}
            >
              <StockLogo symbol={symbol.symbol} companyName={symbol.name} size="xs" />
              <strong>{symbol.symbol}</strong>
              <span>{symbol.name}</span>
            </button>
          ))}
          {!filteredSymbols.length && <p>검색 결과 없음</p>}
          <LogoDevAttribution className="symbol-search-attribution" />
        </div>,
        document.body
      )}
    </div>
  );
}

function clampHighlightedIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), optionCount - 1);
}

function formatSymbolLabel(
  symbol: ChartSymbolDto,
  formatSelectedLabel?: (symbol: ChartSymbolDto) => string
): string {
  return formatSelectedLabel?.(symbol) ?? `${symbol.symbol} - ${symbol.name}`;
}

function rankSymbolMatches(symbols: ChartSymbolDto[], query: string): ChartSymbolDto[] {
  const matches = query
    ? symbols.filter((symbol) => (
        symbol.symbol.toLowerCase().includes(query) ||
        symbol.name.toLowerCase().includes(query) ||
        symbol.sector?.toLowerCase().includes(query)
      ))
    : symbols;
  return [...matches].sort((left, right) => symbolSearchRank(left, query) - symbolSearchRank(right, query));
}

function symbolSearchRank(symbol: ChartSymbolDto, query: string): number {
  if (!query) {
    return 0;
  }
  const ticker = symbol.symbol.toLowerCase();
  const name = symbol.name.toLowerCase();
  if (ticker === query) {
    return 0;
  }
  if (ticker.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  if (ticker.includes(query)) {
    return 3;
  }
  if (name.includes(query)) {
    return 4;
  }
  return 5;
}
