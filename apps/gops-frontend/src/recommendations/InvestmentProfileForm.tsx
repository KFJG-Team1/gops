import { LoaderCircle, Save, X } from "lucide-react";
import { useEffect, useState, type FocusEvent, type FormEvent } from "react";
import { canonicalSectorOptions, normalizeSector, normalizeSectorList, sectorLabelKo } from "../market/sectors";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import {
  fetchInvestmentProfile,
  saveInvestmentProfile,
  type InvestmentProfile,
  type RecommendationStyle,
  type RiskLevel
} from "./recommendationApi";

const defaultProfile: InvestmentProfile = {
  riskLevel: "balanced",
  recommendationStyle: "balanced",
  horizon: "intraday",
  maxDrawdownPct: 6,
  preferredSectors: [],
  excludedSectors: [],
  excludedSymbols: []
};

type SymbolOption = {
  symbol: string;
  companyName: string;
  sector: string;
};

const sectorOptions = [...canonicalSectorOptions];

const symbolOptions: SymbolOption[] = sp500UniverseSeed
  .map((item) => ({
    symbol: item.symbol.toUpperCase(),
    companyName: item.companyName,
    sector: normalizeSector(item.sector)
  }))
  .sort((left, right) => left.symbol.localeCompare(right.symbol));

const sectorSet = new Set<string>(sectorOptions);
const symbolSet = new Set(symbolOptions.map((item) => item.symbol));

export function InvestmentProfileForm({
  disabled,
  onSaved
}: {
  disabled?: boolean;
  onSaved?: (profile: InvestmentProfile) => void;
}) {
  const [profile, setProfile] = useState<InvestmentProfile>(defaultProfile);
  const [preferredSectorQuery, setPreferredSectorQuery] = useState("");
  const [excludedSectorQuery, setExcludedSectorQuery] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchInvestmentProfile(controller.signal)
      .then((payload) => {
        setProfile(normalizeProfileForUniverse(payload ?? defaultProfile));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "투자 설정을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [disabled]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    let savedProfile: InvestmentProfile | null = null;
    try {
      const saved = await saveInvestmentProfile(normalizeProfileForUniverse(profile));
      savedProfile = normalizeProfileForUniverse(saved);
      setProfile(savedProfile);
      setMessage("저장됨");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "투자 설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
    if (savedProfile) {
      onSaved?.(savedProfile);
    }
  };

  return (
    <form className="investment-profile-form" onSubmit={submit}>
      <div className="investment-profile-head">
        <strong>기본 추천 조건</strong>
        {loading && <LoaderCircle size={14} className="spin" />}
      </div>
      <label className="investment-profile-field">
        <span>추천 스타일</span>
        <select
          value={profile.recommendationStyle}
          disabled={disabled || loading || saving}
          onChange={(event) => setProfile((current) => ({ ...current, recommendationStyle: event.target.value as RecommendationStyle }))}
        >
          <option value="momentum">모멘텀 · 급등/추세</option>
          <option value="balanced">균형 · 수익/안정</option>
          <option value="stable">안정 · 유동성/저변동</option>
        </select>
        <small>종목 신호의 전문 팩터 비중을 선택합니다. 위험성향과는 별도로 적용됩니다.</small>
      </label>
      <label className="investment-profile-field">
        <span>위험성향</span>
        <select
          value={profile.riskLevel}
          disabled={disabled || loading || saving}
          onChange={(event) => setProfile((current) => ({ ...current, riskLevel: event.target.value as RiskLevel }))}
        >
          <option value="conservative">보수형</option>
          <option value="balanced">균형형</option>
          <option value="aggressive">공격형</option>
        </select>
      </label>
      <SectorMultiPicker
        label="선호 섹터"
        options={sectorOptions}
        values={profile.preferredSectors}
        query={preferredSectorQuery}
        disabled={disabled || loading || saving}
        onQueryChange={setPreferredSectorQuery}
        onAdd={(sector) =>
          setProfile((current) => ({
            ...current,
            preferredSectors: addValue(current.preferredSectors, sector),
            excludedSectors: current.excludedSectors.filter((item) => item !== sector)
          }))
        }
        onRemove={(sector) =>
          setProfile((current) => ({
            ...current,
            preferredSectors: current.preferredSectors.filter((item) => item !== sector)
          }))
        }
      />
      <SectorMultiPicker
        label="제외 섹터"
        options={sectorOptions}
        values={profile.excludedSectors}
        query={excludedSectorQuery}
        disabled={disabled || loading || saving}
        onQueryChange={setExcludedSectorQuery}
        onAdd={(sector) =>
          setProfile((current) => ({
            ...current,
            excludedSectors: addValue(current.excludedSectors, sector),
            preferredSectors: current.preferredSectors.filter((item) => item !== sector)
          }))
        }
        onRemove={(sector) =>
          setProfile((current) => ({
            ...current,
            excludedSectors: current.excludedSectors.filter((item) => item !== sector)
          }))
        }
      />
      <SymbolMultiPicker
        values={profile.excludedSymbols}
        options={symbolOptions}
        query={symbolQuery}
        disabled={disabled || loading || saving}
        onQueryChange={setSymbolQuery}
        onAdd={(symbol) =>
          setProfile((current) => ({
            ...current,
            excludedSymbols: addValue(current.excludedSymbols, symbol)
          }))
        }
        onRemove={(symbol) =>
          setProfile((current) => ({
            ...current,
            excludedSymbols: current.excludedSymbols.filter((item) => item !== symbol)
          }))
        }
      />
      <button className="investment-profile-save surface-raised" type="submit" disabled={disabled || loading || saving}>
        {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
        <span>저장</span>
      </button>
      {message && <p className="investment-profile-message">{message}</p>}
      {error && <p className="investment-profile-error">{error}</p>}
    </form>
  );
}

function SectorMultiPicker({
  label,
  options,
  values,
  query,
  disabled,
  onQueryChange,
  onAdd,
  onRemove
}: {
  label: string;
  options: string[];
  values: string[];
  query: string;
  disabled?: boolean;
  onQueryChange: (value: string) => void;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(values);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = options.filter((option) => {
    if (selected.has(option)) {
      return false;
    }
    return !normalizedQuery || `${option} ${sectorLabelKo(option)}`.toLowerCase().includes(normalizedQuery);
  });

  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  };

  return (
    <div className="investment-profile-field" onBlur={closeWhenFocusLeaves}>
      <span>{label}</span>
      {values.length > 0 && (
        <div className="investment-profile-selected-list" aria-label={`선택된 ${label}`}>
          {values.map((sector) => (
            <button
              key={sector}
              type="button"
              className="investment-profile-chip"
              disabled={disabled}
              onClick={() => onRemove(sector)}
              title={`${sectorLabelKo(sector)} 제거`}
            >
              <span>{sectorLabelKo(sector)}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      <input
        value={query}
        disabled={disabled}
        placeholder="등록 섹터 검색"
        onFocus={() => setOpen(true)}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {open && (
        <div className="investment-profile-option-list compact" aria-label={`등록 ${label} 목록`}>
          {visibleOptions.length > 0 ? (
            visibleOptions.map((sector) => (
              <button
                key={sector}
                type="button"
                className="investment-profile-sector-option"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAdd(sector)}
              >
                {sectorLabelKo(sector)}
              </button>
            ))
          ) : (
            <p className="investment-profile-empty">선택 가능한 등록 섹터가 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SymbolMultiPicker({
  values,
  options,
  query,
  disabled,
  onQueryChange,
  onAdd,
  onRemove
}: {
  values: string[];
  options: SymbolOption[];
  query: string;
  disabled?: boolean;
  onQueryChange: (value: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(values);
  const normalizedQuery = query.trim().toLowerCase();
  const selectedOptions = values
    .map((symbol) => options.find((option) => option.symbol === symbol))
    .filter((option): option is SymbolOption => Boolean(option));
  const visibleOptions = options
    .filter((option) => {
      if (selected.has(option.symbol)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return `${option.symbol} ${option.companyName} ${option.sector} ${sectorLabelKo(option.sector)}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 24);

  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  };

  return (
    <div className="investment-profile-field" onBlur={closeWhenFocusLeaves}>
      <span>제외 종목</span>
      {selectedOptions.length > 0 && (
        <div className="investment-profile-selected-list" aria-label="선택된 제외 종목">
          {selectedOptions.map((option) => (
            <button
              key={option.symbol}
              type="button"
              className="investment-profile-chip"
              disabled={disabled}
              onClick={() => onRemove(option.symbol)}
              title={`${option.symbol} · ${option.companyName} 제외 해제`}
            >
              <span>{option.symbol}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      <input
        className="investment-profile-symbol-search"
        value={query}
        disabled={disabled}
        placeholder="등록 종목 검색"
        onFocus={() => setOpen(true)}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {open && (
        <div className="investment-profile-option-list" aria-label="등록 종목 목록">
          {visibleOptions.length > 0 ? (
            visibleOptions.map((option) => (
              <button
                key={option.symbol}
                type="button"
                className="investment-profile-option-button"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAdd(option.symbol)}
              >
                <strong>{option.symbol}</strong>
                <span>{option.companyName}</span>
                <em>{sectorLabelKo(option.sector)}</em>
              </button>
            ))
          ) : (
            <p className="investment-profile-empty">선택 가능한 등록 종목이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

function normalizeProfileForUniverse(profile: InvestmentProfile): InvestmentProfile {
  const preferredSectors = normalizeSectorList(uniqueValues(profile.preferredSectors)).filter((item) => sectorSet.has(item));
  const excludedSectors = normalizeSectorList(uniqueValues(profile.excludedSectors))
    .filter((item) => sectorSet.has(item))
    .filter((item) => !preferredSectors.includes(item));

  return {
    ...profile,
    maxDrawdownPct: 6,
    preferredSectors,
    excludedSectors,
    excludedSymbols: uniqueValues(profile.excludedSymbols.map((item) => item.toUpperCase())).filter((item) => symbolSet.has(item))
  };
}

function addValue(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}
