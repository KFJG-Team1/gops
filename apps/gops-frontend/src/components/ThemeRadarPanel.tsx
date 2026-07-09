import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { sectorLabelKo } from "../market/sectors";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";

type ThemeRadarPanelProps = {
  items: Sp500UniverseItem[];
  activeSymbol?: string;
  onSelectSymbol: (symbol: string) => void;
};

type ThemeCandidate = {
  key: string;
  label: string;
  sector: string;
  sectorLabel: string;
  items: Sp500UniverseItem[];
  score: number;
  avgChange: number;
  breadth: number;
  flowScore: number;
  newsSensitivity: number;
  totalMarketCap: number;
  totalDollarVolume: number;
};

type ThemeVisualKind =
  | "semiconductor"
  | "healthcare"
  | "energy"
  | "financial"
  | "consumer"
  | "industrial"
  | "technology"
  | "space"
  | "default";

const themeLabelOverrides: Record<string, string> = {
  "Information Technology": "정보기술",
  "Health Care": "헬스케어",
  Healthcare: "헬스케어",
  Semiconductors: "반도체",
  "Semiconductor Materials & Equipment": "반도체 장비",
  "Technology Hardware, Storage & Peripherals": "하드웨어",
  "Software - Infrastructure": "인프라 소프트웨어",
  "Software - Application": "응용 소프트웨어",
  Biotechnology: "바이오테크",
  Pharmaceuticals: "제약",
  "Oil & Gas Refining & Marketing": "정유",
  "Interactive Media & Services": "인터넷 플랫폼",
  "Information Technology Services": "IT 서비스",
  "Capital Markets": "자본시장",
  "Consumer Finance": "소비자 금융",
  "Broadline Retail": "대형 유통",
  "Automobile Manufacturers": "자동차",
  "Aerospace & Defense": "항공방산"
};

export function ThemeRadarPanel({ items, activeSymbol }: ThemeRadarPanelProps) {
  const [selectedThemeKey, setSelectedThemeKey] = useState<string | null>(null);
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

  const featuredThemes = themes.slice(0, 5);
  const activeRank = Math.max(0, featuredThemes.findIndex((theme) => theme.key === activeTheme.key));
  const carouselIndex = activeRank >= 0 ? activeRank : 0;
  const activeThemeName = displayThemeLabel(activeTheme);
  const activeVisualKind = themeVisualKind(activeTheme);
  const selectFeaturedTheme = (offset: number) => {
    if (featuredThemes.length === 0) {
      return;
    }
    const nextIndex = (carouselIndex + offset + featuredThemes.length) % featuredThemes.length;
    setSelectedThemeKey(featuredThemes[nextIndex]?.key ?? null);
  };
  const barSignals = [
    {
      label: "상승폭",
      value: Math.round(clamp(50 + activeTheme.avgChange * 10, 0, 100)),
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
    <section className="theme-radar-panel" aria-label="분야 추천">
      <button
        type="button"
        className="theme-radar-nav-button theme-radar-nav-prev"
        aria-label="이전 추천 분야"
        onClick={() => selectFeaturedTheme(-1)}
      >
        <ChevronLeft size={18} />
      </button>

      <div className="theme-radar-card" key={activeTheme.key}>
        <div className="theme-radar-card-header">
          <div className="theme-radar-header-mark">
            <span className="theme-radar-header-icon" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <strong>Theme Radar</strong>
          </div>
          <div className="theme-radar-actions">
            <button type="button" className="theme-radar-period">
              다음 거래일
              <ChevronDown size={14} />
            </button>
            <button type="button" className="theme-radar-menu-button" aria-label="분야 추천 옵션">
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        <div className={`theme-radar-industry-visual visual-${activeVisualKind}`} aria-hidden="true" />

        <div className="theme-radar-score-block">
          <p>{activeRank + 1}위 관심 분야</p>
          <div className="theme-radar-score-line">
            <strong>{activeTheme.score}%</strong>
            <span aria-hidden="true">↗</span>
          </div>
          <h3>{activeThemeName}</h3>
          <p className="theme-radar-summary">
            {activeThemeName}는 현재 {activeTheme.score}% 관심도로 상위권입니다.
          </p>
        </div>

        <div className="theme-radar-rank-strip" aria-label="추천 분야 순위">
          {featuredThemes.map((theme, index) => (
            <button
              key={theme.key}
              type="button"
              className={`theme-radar-rank-pill ${theme.key === activeTheme.key ? "active" : ""}`}
              onClick={() => setSelectedThemeKey(theme.key)}
            >
              <span>{index + 1}</span>
              <strong>{displayThemeLabel(theme)}</strong>
              <em>{theme.score}%</em>
            </button>
          ))}
        </div>

        <div className="theme-radar-signal-stack" aria-label="선택 분야 신호">
          {barSignals.map((signal) => (
            <div className="theme-radar-signal" key={signal.label}>
              <span>
                <em>{signal.label}</em>
                <strong>{signal.valueText}</strong>
              </span>
              <i className="theme-radar-signal-track">
                <b
                  className="theme-radar-signal-fill"
                  style={{ "--signal-width": `${signal.value}%` } as CSSProperties}
                />
              </i>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="theme-radar-nav-button theme-radar-nav-next"
        aria-label="다음 추천 분야"
        onClick={() => selectFeaturedTheme(1)}
      >
        <ChevronRight size={18} />
      </button>
    </section>
  );
}

function buildThemeCandidates(items: Sp500UniverseItem[]): ThemeCandidate[] {
  const universe = items.filter((item) => item.symbol && item.industry && Number.isFinite(item.marketCap));
  const industryGroups = groupItems(universe, (item) => item.industry || item.sector);
  const eligible = industryGroups.filter((group) => group.items.length >= 3);
  const groups = eligible.length >= 6 ? eligible : groupItems(universe, (item) => item.sector || item.industry);
  const maxDollarVolume = Math.max(...groups.map((group) => dollarVolumeForItems(group.items)), 1);
  const maxMarketCap = Math.max(...groups.map((group) => group.items.reduce((sum, item) => sum + marketCapForItem(item), 0)), 1);

  return groups
    .map((group): ThemeCandidate => {
      const totalMarketCap = group.items.reduce((sum, item) => sum + marketCapForItem(item), 0);
      const totalDollarVolume = dollarVolumeForItems(group.items);
      const avgChange = weightedAverageChange(group.items);
      const positiveCount = group.items.filter((item) => item.changePercent > 0).length;
      const breadth = group.items.length > 0 ? positiveCount / group.items.length : 0;
      const flowScore = clamp((totalDollarVolume > 0 ? totalDollarVolume / maxDollarVolume : totalMarketCap / maxMarketCap) * 100, 8, 100);
      const momentumScore = clamp(50 + avgChange * 9, 0, 100);
      const breadthScore = clamp(breadth * 100, 0, 100);
      const newsSensitivity = clamp(34 + Math.abs(avgChange) * 9 + Math.log10(group.items.length + 1) * 18, 15, 100);
      const score = Math.round(clamp(momentumScore * 0.42 + breadthScore * 0.28 + flowScore * 0.18 + newsSensitivity * 0.12, 0, 100));
      return {
        key: group.key,
        label: group.label,
        sector: group.sector,
        sectorLabel: sectorLabelKo(group.sector),
        items: group.items,
        score,
        avgChange,
        breadth,
        flowScore,
        newsSensitivity,
        totalMarketCap,
        totalDollarVolume
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function groupItems(items: Sp500UniverseItem[], keyForItem: (item: Sp500UniverseItem) => string) {
  const groups = new Map<string, Sp500UniverseItem[]>();
  for (const item of items) {
    const key = keyForItem(item).trim();
    if (!key) {
      continue;
    }
    const next = groups.get(key) ?? [];
    next.push(item);
    groups.set(key, next);
  }
  return Array.from(groups.entries()).map(([key, groupItems]) => ({
    key,
    label: readableThemeLabel(key),
    sector: dominantSector(groupItems),
    items: groupItems
  }));
}

function dominantSector(items: Sp500UniverseItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.sector, (counts.get(item.sector) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unclassified";
}

function weightedAverageChange(items: Sp500UniverseItem[]) {
  const totalWeight = items.reduce((sum, item) => sum + marketCapForItem(item), 0);
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

function readableThemeLabel(value: string) {
  return value
    .replace(/&/g, " & ")
    .replace(/\s+/g, " ")
    .replace(/\bAnd\b/g, "&")
    .trim();
}

function displayThemeLabel(theme: Pick<ThemeCandidate, "label" | "sectorLabel">) {
  return themeLabelOverrides[theme.label] ?? themeLabelOverrides[theme.sectorLabel] ?? theme.label;
}

function themeVisualKind(theme: Pick<ThemeCandidate, "label" | "sector" | "sectorLabel">): ThemeVisualKind {
  const text = `${theme.label} ${theme.sector} ${theme.sectorLabel}`.toLowerCase();
  if (/semiconductor|chip|equipment|hardware/.test(text)) {
    return "semiconductor";
  }
  if (/health|biotech|pharma|medical/.test(text)) {
    return "healthcare";
  }
  if (/energy|oil|gas|utilities/.test(text)) {
    return "energy";
  }
  if (/financial|bank|capital|insurance|finance/.test(text)) {
    return "financial";
  }
  if (/consumer|retail|restaurant|automobile/.test(text)) {
    return "consumer";
  }
  if (/aerospace|defense|space/.test(text)) {
    return "space";
  }
  if (/industrial|aerospace|defense|machinery/.test(text)) {
    return "industrial";
  }
  if (/technology|software|interactive|information/.test(text)) {
    return "technology";
  }
  return "default";
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
