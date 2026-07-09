import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";

type ThemeRadarPanelProps = {
  items: Sp500UniverseItem[];
  activeSymbol?: string;
  onSelectSymbol: (symbol: string) => void;
};

type ThemeVisualKind =
  | "semiconductor"
  | "healthcare"
  | "financial"
  | "communication"
  | "realestate"
  | "materials"
  | "energy"
  | "consumer";

type ThemeDefinition = {
  key: ThemeVisualKind;
  label: string;
  eyebrow: string;
  matcher: RegExp;
};

type ThemeCandidate = ThemeDefinition & {
  items: Sp500UniverseItem[];
  score: number;
  avgChange: number;
  flowScore: number;
  newsSensitivity: number;
  totalMarketCap: number;
  totalDollarVolume: number;
  topSymbols: Sp500UniverseItem[];
};

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    key: "semiconductor",
    label: "반도체",
    eyebrow: "AI 인프라",
    matcher: /semiconductor|chip|hardware|equipment|electronic|technology hardware/i
  },
  {
    key: "healthcare",
    label: "헬스케어",
    eyebrow: "바이오 · 제약",
    matcher: /health|healthcare|biotech|pharma|medical|life sciences/i
  },
  {
    key: "financial",
    label: "금융",
    eyebrow: "은행 · 자본시장",
    matcher: /financial|bank|capital|insurance|finance|mortgage|asset management/i
  },
  {
    key: "communication",
    label: "커뮤니케이션",
    eyebrow: "플랫폼 · 미디어",
    matcher: /communication|interactive media|entertainment|media|telecom|broadcasting|streaming|movies/i
  },
  {
    key: "realestate",
    label: "부동산",
    eyebrow: "리츠 · 인프라",
    matcher: /real estate|reit|property/i
  },
  {
    key: "materials",
    label: "소재",
    eyebrow: "화학 · 원자재",
    matcher: /materials|basic materials|chemical|mining|metal|paper|container|construction materials/i
  },
  {
    key: "energy",
    label: "에너지",
    eyebrow: "전력 · 원유",
    matcher: /energy|oil|gas|utilities|renewable|electric/i
  },
  {
    key: "consumer",
    label: "경기소비재",
    eyebrow: "리테일 · 소비",
    matcher: /consumer|retail|restaurant|automobile|apparel|home improvement|leisure|hotel|discretionary|defensive|staples/i
  }
];

export function ThemeRadarPanel({ items, activeSymbol, onSelectSymbol }: ThemeRadarPanelProps) {
  const [selectedThemeKey, setSelectedThemeKey] = useState<ThemeVisualKind | null>(null);
  const themes = useMemo(() => buildThemeCandidates(items), [items]);
  const activeTheme = useMemo(() => {
    const selectedTheme = selectedThemeKey ? themes.find((theme) => theme.key === selectedThemeKey) : null;
    if (selectedTheme) {
      return selectedTheme;
    }
    const normalizedSymbol = activeSymbol?.trim().toUpperCase();
    if (!normalizedSymbol) {
      return themes[0];
    }
    return themes.find((theme) => theme.items.some((item) => item.symbol.toUpperCase() === normalizedSymbol)) ?? themes[0];
  }, [activeSymbol, selectedThemeKey, themes]);

  if (!activeTheme) {
    return (
      <section className="theme-radar-panel" aria-label="분야 추천">
        <div className="theme-radar-empty">분야 추천 데이터를 기다리고 있습니다</div>
      </section>
    );
  }

  const activeIndex = Math.max(0, themes.findIndex((theme) => theme.key === activeTheme.key));
  const selectTheme = (offset: number) => {
    if (themes.length === 0) {
      return;
    }
    const nextIndex = (activeIndex + offset + themes.length) % themes.length;
    setSelectedThemeKey(themes[nextIndex]?.key ?? null);
  };
  const signals = [
    {
      label: "상승폭",
      value: Math.round(clamp(50 + activeTheme.avgChange * 10, 3, 100)),
      valueText: formatSignedPercent(activeTheme.avgChange)
    },
    {
      label: "거래대금",
      value: Math.round(activeTheme.flowScore),
      valueText: formatCompactUsd(activeTheme.totalDollarVolume)
    },
    {
      label: "뉴스민감도",
      value: Math.round(activeTheme.newsSensitivity),
      valueText: `${Math.round(activeTheme.newsSensitivity)}`
    }
  ];

  return (
    <section className={`theme-radar-panel theme-radar-theme-${activeTheme.key}`} aria-label="분야 추천">
      <div className={`theme-radar-hero theme-radar-image-${activeTheme.key}`}>
        <div className="theme-radar-shade" aria-hidden="true" />
        <div className="theme-radar-content">
          <span className="theme-radar-kicker">분야추천</span>
          <div className="theme-radar-title-row">
            <h3>{activeTheme.label}</h3>
            <strong>{activeTheme.score}%</strong>
          </div>
          <p>
            {activeTheme.eyebrow} · {formatSignedPercent(activeTheme.avgChange)}
          </p>
        </div>

        <div className="theme-radar-symbol-row" aria-label={`${activeTheme.label} 대표 종목`}>
          {activeTheme.topSymbols.slice(0, 3).map((item) => (
            <button key={item.symbol} type="button" onClick={() => onSelectSymbol(item.symbol)}>
              <span>{item.symbol}</span>
              <em>{formatSignedPercent(item.changePercent)}</em>
            </button>
          ))}
        </div>

        <div className="theme-radar-metrics" aria-label={`${activeTheme.label} 시장 신호`}>
          {signals.map((signal) => (
            <div className="theme-radar-metric" key={signal.label}>
              <span>
                <em>{signal.label}</em>
                <strong>{signal.valueText}</strong>
              </span>
              <i>
                <b style={{ width: `${signal.value}%` }} />
              </i>
            </div>
          ))}
        </div>

        <div className="theme-radar-sector-dots" aria-label="분야 선택">
          {themes.map((theme) => (
            <button
              key={theme.key}
              type="button"
              className={theme.key === activeTheme.key ? "active" : ""}
              aria-label={`${theme.label} 보기`}
              onClick={() => setSelectedThemeKey(theme.key)}
            >
              <span>{theme.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="theme-radar-nav-button theme-radar-nav-prev"
          aria-label="이전 추천 분야"
          onClick={() => selectTheme(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="theme-radar-nav-button theme-radar-nav-next"
          aria-label="다음 추천 분야"
          onClick={() => selectTheme(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

function buildThemeCandidates(items: Sp500UniverseItem[]): ThemeCandidate[] {
  const universe = items.filter((item) => item.symbol && Number.isFinite(item.marketCap));
  const maxDollarVolume = Math.max(
    ...THEME_DEFINITIONS.map((definition) => dollarVolumeForItems(filterThemeItems(universe, definition))),
    1
  );
  const maxMarketCap = Math.max(
    ...THEME_DEFINITIONS.map((definition) =>
      filterThemeItems(universe, definition).reduce((sum, item) => sum + marketCapForItem(item), 0)
    ),
    1
  );

  return THEME_DEFINITIONS.map((definition): ThemeCandidate => {
    const themeItems = filterThemeItems(universe, definition);
    const totalMarketCap = themeItems.reduce((sum, item) => sum + marketCapForItem(item), 0);
    const totalDollarVolume = dollarVolumeForItems(themeItems);
    const avgChange = weightedAverageChange(themeItems);
    const breadth = themeItems.length
      ? themeItems.filter((item) => Number.isFinite(item.changePercent) && item.changePercent > 0).length / themeItems.length
      : 0;
    const flowScore = clamp((totalDollarVolume > 0 ? totalDollarVolume / maxDollarVolume : totalMarketCap / maxMarketCap) * 100, 8, 100);
    const momentumScore = clamp(50 + avgChange * 9, 0, 100);
    const breadthScore = clamp(breadth * 100, 0, 100);
    const newsSensitivity = clamp(34 + Math.abs(avgChange) * 9 + Math.log10(themeItems.length + 1) * 18, 15, 100);
    const score = Math.round(clamp(momentumScore * 0.44 + breadthScore * 0.26 + flowScore * 0.18 + newsSensitivity * 0.12, 0, 100));
    return {
      ...definition,
      items: themeItems,
      score,
      avgChange,
      flowScore,
      newsSensitivity,
      totalMarketCap,
      totalDollarVolume,
      topSymbols: [...themeItems].sort((a, b) => marketCapForItem(b) - marketCapForItem(a)).slice(0, 4)
    };
  }).sort((a, b) => b.score - a.score);
}

function filterThemeItems(items: Sp500UniverseItem[], definition: ThemeDefinition) {
  return items.filter((item) => {
    const text = `${item.sector} ${item.sectorLabelKo ?? ""} ${item.industry} ${item.companyName}`.toLowerCase();
    return definition.matcher.test(text);
  });
}

function weightedAverageChange(items: Sp500UniverseItem[]) {
  const totalWeight = items.reduce((sum, item) => sum + marketCapForItem(item), 0);
  if (items.length === 0) {
    return 0;
  }
  if (totalWeight <= 0) {
    return average(items.map((item) => item.changePercent));
  }
  return items.reduce((sum, item) => sum + item.changePercent * marketCapForItem(item), 0) / totalWeight;
}

function dollarVolumeForItems(items: Sp500UniverseItem[]) {
  return items.reduce((sum, item) => {
    if (typeof item.sessionDollarVolume === "number" && Number.isFinite(item.sessionDollarVolume)) {
      return sum + Math.max(0, item.sessionDollarVolume);
    }
    if (typeof item.volume === "number" && Number.isFinite(item.volume) && typeof item.lastPrice === "number" && Number.isFinite(item.lastPrice)) {
      return sum + Math.max(0, item.volume * item.lastPrice);
    }
    return sum;
  }, 0);
}

function marketCapForItem(item: Sp500UniverseItem) {
  return Math.max(0, item.layoutMarketCap ?? item.marketCap ?? 0);
}

function average(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCompactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "대기";
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
