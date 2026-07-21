import { LoaderCircle, Plus, RotateCcw, Save, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateScoreProfile,
  createScoreProfile,
  deleteScoreProfile,
  fetchScoreProfiles,
  suggestScoreProfile,
  updateScoreProfile,
  type InvestmentProfile,
  type ScoreProfile,
  type ScoreProfileSuggestion
} from "./recommendationApi";

export const recommendationBlockLabels: Record<string, string> = {
  trendStrength: "추세",
  participationConfirmation: "거래 참여",
  priceStructure: "가격 구조",
  catalystQuality: "촉매",
  executionQuality: "체결 여건",
  qualityStability: "품질·안정성"
};

const factorLabels: Record<string, string> = {
  currentSessionRelativeStrength: "현재 세션 상대강도",
  last60MinuteRelativeStrength: "최근 60분 상대강도",
  oneDayRelativeStrength: "1일 상대강도",
  fiveDayRelativeStrength: "5일 상대강도",
  high52WeekProximity: "52주 고점 근접도",
  clockAdjustedVolumeRatio: "시간 보정 거래량 비율",
  abnormalDollarVolume: "비정상 거래대금",
  closingLocationValue: "종가 위치",
  participationPersistence: "참여 지속성",
  confirmedBreakoutSupport: "돌파·지지 확인",
  vwapHoldQuality: "VWAP 유지 품질",
  higherLowQuality: "저점 상승 품질",
  gapAcceptance: "갭 안착",
  catalystQuality: "촉매 품질",
  medianDollarVolume: "중앙 거래대금",
  quotedSpreadBps: "호가 스프레드",
  freshnessScore: "데이터 신선도",
  realizedVolatility: "실현변동성",
  downsideVolatility: "하방변동성",
  valueQuality: "가치",
  companyQuality: "기업 품질",
  growthQuality: "성장",
  earningsRevisionQuality: "실적 전망",
  sectorDiversification: "섹터 분산",
  correlationBenefit: "상관 개선",
  marginalVariance: "한계 변동성",
  liquidityCashCompatibility: "유동성/현금 적합도"
};

export const simulationDemoScoreProfileQuery = "거래대금이 강하고 추세가 이어지는 종목";
export const simulationDemoScoreProfilePromptVersion = "simulation-demo-score-profile.v1";

const recommendationQueryExamples = [
  simulationDemoScoreProfileQuery,
  "돌파 후 VWAP을 지키는 종목",
  "실적 뉴스와 성장성이 좋은 종목",
  "저변동·하방 방어 중심 종목"
];

export function shouldAutoApplySimulationDemoSuggestion(suggestion: ScoreProfileSuggestion): boolean {
  return suggestion.provenance.promptVersion === simulationDemoScoreProfilePromptVersion
    && suggestion.query.trim().replace(/\s+/g, " ") === simulationDemoScoreProfileQuery;
}

export function isSimulationDemoScoreProfile(profile: ScoreProfile | null | undefined): boolean {
  if (!profile || profile.type !== "custom" || profile.portfolioWeight !== 0) return false;
  const blocks = profile.blockWeights;
  const trend = profile.factorWeights.trendStrength ?? {};
  const price = profile.factorWeights.priceStructure ?? {};
  const execution = profile.factorWeights.executionQuality ?? {};
  return blocks.trendStrength === 15
    && blocks.participationConfirmation === 10
    && blocks.priceStructure === 15
    && blocks.catalystQuality === 0
    && blocks.executionQuality === 60
    && blocks.qualityStability === 0
    && trend.oneDayRelativeStrength === 100
    && price.vwapHoldQuality === 100
    && execution.medianDollarVolume === 70
    && execution.quotedSpreadBps === 30;
}

export function ScoreProfileManager({
  disabled,
  onActivated
}: {
  disabled?: boolean;
  onActivated?: (profile: InvestmentProfile) => void;
}) {
  const [profiles, setProfiles] = useState<ScoreProfile[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState<ScoreProfile | null>(null);
  const [draftBaseline, setDraftBaseline] = useState<ScoreProfile | null>(null);
  const [maxCustomProfiles, setMaxCustomProfiles] = useState(20);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [promptQuery, setPromptQuery] = useState("");
  const [suggestion, setSuggestion] = useState<ScoreProfileSuggestion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, preferredKey?: string) => {
    setLoading(true);
    try {
      const payload = await fetchScoreProfiles(signal);
      const nextProfiles = [...payload.presets, ...payload.customProfiles];
      const nextActiveKey = profileKey(payload.active);
      const nextSelectedKey = preferredKey && nextProfiles.some((item) => profileKey(item) === preferredKey)
        ? preferredKey
        : nextProfiles.some((item) => profileKey(item) === selectedKey)
          ? selectedKey
          : nextActiveKey;
      setProfiles(nextProfiles);
      setMaxCustomProfiles(payload.maxCustomProfiles);
      setActiveKey(nextActiveKey);
      setSelectedKey(nextSelectedKey);
      const sourceProfile = nextProfiles.find((item) => profileKey(item) === nextSelectedKey) ?? payload.active;
      const nextDraft = editableDraftFromProfile(sourceProfile, nextProfiles);
      setDraft(nextDraft);
      setDraftBaseline(cloneProfile(nextDraft));
      setError(null);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "추천 로직을 불러오지 못했습니다.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []); // 프로필 선택 변경은 원격 목록 재조회 조건이 아니다.

  const presetProfiles = profiles.filter((item) => item.type === "preset");
  const customProfiles = profiles.filter((item) => item.type === "custom");
  const customCount = customProfiles.length;
  const validationError = useMemo(() => validateDraft(draft), [draft]);
  const dirty = useMemo(() => profileSignature(draft) !== profileSignature(draftBaseline), [draft, draftBaseline]);
  const needsCustomSlot = Boolean(draft?.type === "custom" && !draft.id);
  const customSlotUnavailable = needsCustomSlot && customCount >= maxCustomProfiles;
  const editorDisabled = Boolean(disabled || working);

  const select = (profile: ScoreProfile) => {
    const nextDraft = editableDraftFromProfile(profile, profiles);
    setSelectedKey(profileKey(profile));
    setDraft(nextDraft);
    setDraftBaseline(cloneProfile(nextDraft));
    setSuggestion(null);
    setMessage(null);
    setError(null);
  };

  const startFromPreset = (profile: ScoreProfile) => {
    if (profile.type !== "preset") return;
    const nextDraft = editableDraftFromProfile(profile, profiles);
    setSelectedKey(profileKey(profile));
    setDraft(nextDraft);
    setDraftBaseline(cloneProfile(nextDraft));
    setSuggestion(null);
    setMessage(`${profile.name} 프리셋을 새 로직에 불러왔습니다.`);
    setError(null);
  };

  const updateEditableDraft = (update: (profile: ScoreProfile) => ScoreProfile) => {
    if (!draft) return;
    setDraft((current) => {
      if (!current) return current;
      return update(cloneProfile(current));
    });
    setMessage(null);
    setError(null);
  };

  const run = async (operation: () => Promise<void>) => {
    if (working || disabled) return;
    setWorking(true);
    setMessage(null);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천 로직 작업을 완료하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const save = () => run(async () => {
    if (!draft || draft.type !== "custom") return;
    if (validationError) throw new Error(validationError);
    if (!draft.id && customCount >= maxCustomProfiles) {
      throw new Error(`사용자 프로필은 최대 ${maxCustomProfiles}개까지 만들 수 있습니다.`);
    }
    const saved = await persistCustomProfile(draft);
    setSuggestion(null);
    setMessage("추천 로직을 저장했습니다. 적용하면 새 추천 순위를 계산합니다.");
    await load(undefined, profileKey(saved));
  });

  const activate = () => run(async () => {
    if (!draft) return;
    if (draft.type === "custom" && validationError) throw new Error(validationError);
    if (draft.type === "custom" && !draft.id && customCount >= maxCustomProfiles) {
      throw new Error(`사용자 프로필은 최대 ${maxCustomProfiles}개까지 만들 수 있습니다.`);
    }
    const savedProfile = draft.type === "custom" ? await persistCustomProfile(draft) : draft;
    const investmentProfile = await activateScoreProfile(savedProfile);
    setSuggestion(null);
    setMessage("추천 로직을 적용했습니다. 다음 요청부터 새 순위를 계산합니다.");
    await load(undefined, profileKey(savedProfile));
    onActivated?.(investmentProfile);
  });

  const remove = (profile: ScoreProfile) => run(async () => {
    if (!profile.id || profile.type !== "custom") return;
    await deleteScoreProfile(profile.id);
    setMessage("추천 로직을 삭제했습니다.");
    await load();
  });

  const resetDraft = () => {
    if (!draftBaseline) return;
    setDraft(cloneProfile(draftBaseline));
    setMessage(null);
    setError(null);
  };

  const requestSuggestion = async () => {
    const query = promptQuery.trim();
    if (query.length < 2 || suggesting || disabled) return;
    setSuggesting(true);
    setMessage(null);
    setError(null);
    try {
      const nextSuggestion = await suggestScoreProfile(query);
      const suggestedDraft = suggestionDraft(nextSuggestion, profiles);
      setSuggestion(nextSuggestion);
      setSelectedKey("");
      setDraft(suggestedDraft);
      setDraftBaseline(cloneProfile(suggestedDraft));
      setMessage(customCount >= maxCustomProfiles
        ? `AI 제안을 편집 대상으로 불러왔습니다. 저장하려면 기존 로직을 삭제해 최대 ${maxCustomProfiles}개 한도를 비워야 합니다.`
        : "AI 제안을 편집 가능한 초안으로 불러왔습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천 로직 AI 제안을 만들지 못했습니다.");
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <section className="score-profile-manager" aria-label="추천 가중치 편집기">
      {loading && (
        <div className="score-profile-manager-head" aria-label="추천 수식 불러오는 중">
          <LoaderCircle size={14} className="spin" />
        </div>
      )}
      <section className="score-profile-preset-shelf" aria-label="기본 추천 수식">
        <div>
          {presetProfiles.map((profile) => {
            const key = profileKey(profile);
            return (
              <button
                key={key}
                type="button"
                className={key === selectedKey ? "is-selected" : ""}
                aria-pressed={key === selectedKey}
                disabled={disabled || working}
                aria-label={`${profile.name} 기본 수식 사용`}
                onClick={() => startFromPreset(profile)}
              >
                <strong>{profile.name}</strong>
              </button>
            );
          })}
        </div>
      </section>
      <section className="score-profile-ai-workbench" aria-label="내 로직 AI 제안">
        <header><strong>내 로직</strong></header>
        <form className="score-profile-ai-query" onSubmit={(event) => {
          event.preventDefault();
          void requestSuggestion();
        }}>
          <textarea
            value={promptQuery}
            maxLength={500}
            rows={2}
            disabled={disabled || suggesting}
            aria-label="추천 로직 요청"
            placeholder="예: 거래대금이 강하고 실적 뉴스가 있는 저변동 종목을 우선해줘"
            onChange={(event) => setPromptQuery(event.target.value)}
          />
          <button type="submit" disabled={disabled || suggesting || promptQuery.trim().length < 2}>
            {suggesting ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
            AI 제안
          </button>
        </form>
        <div className="score-profile-query-examples" aria-label="추천 로직 쿼리 예시">
          {recommendationQueryExamples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={disabled || suggesting}
              onClick={() => setPromptQuery(example)}
            >
              {example}
            </button>
          ))}
        </div>
        {suggestion && (
          <article className="score-profile-ai-suggestion" tabIndex={0} aria-label={`${suggestion.name} 제안 근거 보기`}>
            <div>
              <Sparkles size={14} aria-hidden="true" />
              <strong>{suggestion.name}</strong>
              <span>{topSuggestedBlocks(suggestion.profile).join(" · ")}</span>
            </div>
            <span className="score-profile-ai-suggestion-state">편집 중</span>
            <div className="score-profile-ai-rationale" role="tooltip">
              <strong>제안 근거</strong>
              <p>{suggestionRationaleSummary(suggestion)}</p>
            </div>
          </article>
        )}
      </section>

      {draft && !loading && (
        <>
          <section className="score-profile-current-editor" aria-label="현재 선택한 로직">
            <label className="score-profile-current-name">
              <input
                value={draft.name}
                maxLength={40}
                disabled={editorDisabled}
                aria-label="현재 선택한 로직 이름"
                onChange={(event) => updateEditableDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="score-profile-current-actions">
              <button
                type="button"
                className="is-icon"
                disabled={editorDisabled || !dirty}
                aria-label="변경사항 되돌리기"
                title="변경사항 되돌리기"
                onClick={resetDraft}
              ><RotateCcw size={14} aria-hidden="true" /></button>
              <button
                type="button"
                className="is-icon"
                disabled={editorDisabled || Boolean(validationError) || customSlotUnavailable || Boolean(draft.id && !dirty)}
                aria-label="추천 로직 저장"
                title={customSlotUnavailable ? `사용자 프로필은 최대 ${maxCustomProfiles}개까지 저장할 수 있습니다.` : "추천 로직 저장"}
                onClick={save}
              ><Save size={14} aria-hidden="true" /></button>
              <button
                type="button"
                className="is-primary"
                disabled={editorDisabled || Boolean(validationError) || customSlotUnavailable}
                title={customSlotUnavailable ? `사용자 프로필은 최대 ${maxCustomProfiles}개까지 저장할 수 있습니다.` : undefined}
                onClick={activate}
              >저장하고 추천 재계산</button>
            </div>
          </section>

          <section className="score-profile-saved-library" aria-label="저장된 추천 로직">
            <header><strong>저장된 로직</strong></header>
            <div className="score-profile-list" role="listbox" aria-label="내 추천 로직 목록">
              {customProfiles.map((profile) => {
                const key = profileKey(profile);
                const selected = key === selectedKey;
                return (
                  <div key={key} className={`score-profile-list-item ${selected ? "is-selected" : ""}`} role="option" aria-selected={selected}>
                    <button type="button" className="score-profile-list-select" disabled={disabled || working} onClick={() => select(profile)}>
                      <span>{profile.name}</span>
                      <em>{key === activeKey ? "활성" : `r${profile.revision}`}</em>
                    </button>
                    <button
                      type="button"
                      className="score-profile-list-delete"
                      disabled={disabled || working}
                      aria-label={`${profile.name} 삭제`}
                      title={`${profile.name} 삭제`}
                      onClick={() => remove(profile)}
                    ><Trash2 size={13} aria-hidden="true" /></button>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="score-profile-editor">
            <ScoreWeightMixer
              profile={draft}
              disabled={editorDisabled}
              onChange={(next) => updateEditableDraft(() => next)}
            />
          </div>

          {validationError && draft.type === "custom" && <p className="investment-profile-error">{validationError}</p>}
        </>
      )}
      {message && <p className="investment-profile-message">{message}</p>}
      {error && <p className="investment-profile-error">{error}</p>}
    </section>
  );
}

function ScoreWeightMixer({ profile, disabled, onChange }: {
  profile: ScoreProfile;
  disabled?: boolean;
  onChange: (profile: ScoreProfile) => void;
}) {
  const activeBlocks = Object.entries(profile.blockWeights).filter(([, value]) => value > 0);
  const inactiveBlocks = Object.entries(profile.blockWeights).filter(([, value]) => value <= 0);
  const updateBlockWeight = (block: string, value: number) => onChange({
    ...profile,
    blockWeights: rebalanceWeights(profile.blockWeights, block, value)
  });
  const updateFactorWeight = (block: string, factor: string, value: number) => onChange({
    ...profile,
    factorWeights: {
      ...profile.factorWeights,
      [block]: rebalanceWeights(profile.factorWeights[block], factor, value)
    }
  });

  return (
    <section className="score-profile-mixer" aria-label="추천 가중치 믹서">
      <header className="score-profile-mixer-summary">
        <strong>전체 비중</strong>
      </header>
      <div className="score-profile-allocation-bar" aria-label="신호별 전체 비중">
        {activeBlocks.map(([block, value]) => (
          <span key={block} style={{ width: `${value}%` }} title={`${recommendationBlockLabels[block] ?? block} ${value}%`}><i>{recommendationBlockLabels[block] ?? block}</i></span>
        ))}
      </div>
      <div className="score-profile-allocation-legend">
        {activeBlocks.map(([block, value]) => <span key={block}><i />{recommendationBlockLabels[block] ?? block}<em>{value}%</em></span>)}
      </div>
      {inactiveBlocks.length > 0 && (
        <div className="score-profile-mixer-add">
          <span>신호 추가</span>
          {inactiveBlocks.map(([block]) => <button key={block} type="button" disabled={disabled} onClick={() => updateBlockWeight(block, roundWeight(100 / (activeBlocks.length + 1)))}><Plus size={12} />{recommendationBlockLabels[block] ?? block}</button>)}
        </div>
      )}
      <div className="score-profile-mixer-grid">
        {activeBlocks.map(([block, blockWeight]) => (
            <SignalMixerCard
              key={block}
              block={block}
              blockWeight={blockWeight}
              factorWeights={profile.factorWeights[block]}
              disabled={disabled}
              removable={activeBlocks.length > 1}
              onBlockWeight={(value) => updateBlockWeight(block, value)}
              onFactorWeight={(factor, value) => updateFactorWeight(block, factor, value)}
            />
        ))}
      </div>
      <PortfolioMixerCard
        profile={profile}
        disabled={disabled}
        onPortfolioWeight={(value) => onChange({ ...profile, portfolioWeight: value })}
        onFactorWeight={(factor, value) => onChange({ ...profile, portfolioFactorWeights: rebalanceWeights(profile.portfolioFactorWeights, factor, value) })}
      />
    </section>
  );
}

function SignalMixerCard({ block, blockWeight, factorWeights, disabled, removable, onBlockWeight, onFactorWeight }: {
  block: string;
  blockWeight: number;
  factorWeights: Record<string, number>;
  disabled?: boolean;
  removable: boolean;
  onBlockWeight: (value: number) => void;
  onFactorWeight: (factor: string, value: number) => void;
}) {
  const factors = Object.entries(factorWeights);
  const activeFactors = factors.filter(([, value]) => value > 0);
  const inactiveFactors = factors.filter(([, value]) => value <= 0);
  return (
    <article className="score-profile-mixer-card">
      <header>
        <strong>{recommendationBlockLabels[block] ?? block}</strong><em>{blockWeight}%</em>
        {removable && <button type="button" disabled={disabled} aria-label={`${recommendationBlockLabels[block] ?? block} 신호 제거`} onClick={() => onBlockWeight(0)}><X size={12} /></button>}
      </header>
      <label className="score-profile-mixer-primary"><span>신호 비중</span><WeightInput value={blockWeight} disabled={disabled} onChange={onBlockWeight} /></label>
      <div className="score-profile-mixer-parameters">
        {activeFactors.map(([factor, value]) => (
          <label key={factor} className="score-profile-mixer-parameter">
            <span>{factorLabels[factor] ?? factor}{activeFactors.length > 1 && <button type="button" disabled={disabled} aria-label={`${factorLabels[factor] ?? factor} 제거`} onClick={() => onFactorWeight(factor, 0)}><X size={11} /></button>}</span>
            <WeightInput value={value} disabled={disabled} onChange={(next) => onFactorWeight(factor, next)} />
          </label>
        ))}
      </div>
      {inactiveFactors.length > 0 && <div className="score-profile-mixer-add"><span>지표 추가</span>{inactiveFactors.map(([factor]) => <button key={factor} type="button" disabled={disabled} onClick={() => onFactorWeight(factor, roundWeight(100 / (activeFactors.length + 1)))}><Plus size={11} />{factorLabels[factor] ?? factor}</button>)}</div>}
    </article>
  );
}

function PortfolioMixerCard({ profile, disabled, onPortfolioWeight, onFactorWeight }: {
  profile: ScoreProfile;
  disabled?: boolean;
  onPortfolioWeight: (value: number) => void;
  onFactorWeight: (factor: string, value: number) => void;
}) {
  const factors = Object.entries(profile.portfolioFactorWeights);
  const activeFactors = factors.filter(([, value]) => value > 0);
  const inactiveFactors = factors.filter(([, value]) => value <= 0);
  return (
    <article className="score-profile-mixer-card is-portfolio">
      <header><strong>포트폴리오 적합도</strong><em>{profile.portfolioWeight}%</em></header>
      <label className="score-profile-mixer-primary"><span>반영률</span><WeightInput value={profile.portfolioWeight} disabled={disabled} onChange={onPortfolioWeight} /></label>
      <div className="score-profile-mixer-parameters">
        {activeFactors.map(([factor, value]) => <label key={factor} className="score-profile-mixer-parameter"><span>{factorLabels[factor] ?? factor}{activeFactors.length > 1 && <button type="button" disabled={disabled} aria-label={`${factorLabels[factor] ?? factor} 제거`} onClick={() => onFactorWeight(factor, 0)}><X size={11} /></button>}</span><WeightInput value={value} disabled={disabled} onChange={(next) => onFactorWeight(factor, next)} /></label>)}
      </div>
      {inactiveFactors.length > 0 && <div className="score-profile-mixer-add"><span>지표 추가</span>{inactiveFactors.map(([factor]) => <button key={factor} type="button" disabled={disabled} onClick={() => onFactorWeight(factor, roundWeight(100 / (activeFactors.length + 1)))}><Plus size={11} />{factorLabels[factor] ?? factor}</button>)}</div>}
    </article>
  );
}

function NumberInput({ value, disabled, onChange }: { value: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <input type="number" min="0" max="100" step="0.01" value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} />;
}

function WeightInput({ value, disabled, onChange }: { value: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <span className="score-profile-weight-input">
      <input type="range" min="0" max="100" step="0.01" value={Number.isFinite(value) ? value : 0} disabled={disabled} aria-label="가중치 슬라이더" onChange={(event) => onChange(Number(event.target.value))} />
      <NumberInput value={value} disabled={disabled} onChange={onChange} />
      <em>%</em>
    </span>
  );
}

export function rebalanceWeights(values: Record<string, number>, changedKey: string, requestedValue: number): Record<string, number> {
  const keys = Object.keys(values);
  if (!keys.includes(changedKey)) return { ...values };
  if (keys.length === 1) return { [changedKey]: 100 };
  const nextValue = roundWeight(Math.min(100, Math.max(0, Number.isFinite(requestedValue) ? requestedValue : 0)));
  const existingActiveKeys = keys.filter((key) => key !== changedKey && Number.isFinite(values[key]) && values[key] > 0);
  const otherKeys = existingActiveKeys.length > 0 ? existingActiveKeys : keys.filter((key) => key !== changedKey);
  const remaining = roundWeight(100 - nextValue);
  const otherTotal = otherKeys.reduce((sum, key) => sum + Math.max(0, Number.isFinite(values[key]) ? values[key] : 0), 0);
  const next: Record<string, number> = Object.fromEntries(keys.map((key) => [key, key === changedKey ? nextValue : 0]));
  let assigned = 0;

  otherKeys.forEach((key, index) => {
    const value = index === otherKeys.length - 1
      ? roundWeight(remaining - assigned)
      : roundWeight(otherTotal > 0 ? remaining * Math.max(0, values[key] ?? 0) / otherTotal : remaining / otherKeys.length);
    next[key] = value;
    assigned = roundWeight(assigned + value);
  });
  return next;
}

function validateDraft(profile: ScoreProfile | null): string | null {
  if (!profile) return "추천 로직을 선택하세요.";
  if (!profile.name.trim() || profile.name.trim().length > 40) return "로직 이름은 1~40자여야 합니다.";
  if (!validNumber(profile.portfolioWeight)) return "포트폴리오 반영률은 0~100이어야 합니다.";
  const groups = [profile.blockWeights, ...Object.values(profile.factorWeights), profile.portfolioFactorWeights];
  if (groups.some((group) => Object.values(group).some((value) => !validNumber(value)))) return "가중치는 0~100의 숫자여야 합니다.";
  if (groups.some((group) => Math.abs(Object.values(group).reduce((sum, value) => sum + value, 0) - 100) > 0.01)) return "각 가중치 그룹의 합계는 100이어야 합니다.";
  return null;
}

function validNumber(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100
    && Math.abs(Math.round(value * 100) - value * 100) < 1e-7;
}

function profileKey(profile: ScoreProfile) {
  return profile.type === "custom" ? `custom:${profile.id}` : `preset:${profile.presetStyle}`;
}

function cloneProfile(profile: ScoreProfile): ScoreProfile {
  return JSON.parse(JSON.stringify(profile)) as ScoreProfile;
}

function editableDraftFromProfile(profile: ScoreProfile, profiles: readonly ScoreProfile[]): ScoreProfile {
  return profile.type === "preset"
    ? toCustomDraft(profile, availableCustomName(profile.name, profiles))
    : cloneProfile(profile);
}

function toCustomDraft(profile: ScoreProfile, name: string): ScoreProfile {
  return {
    ...cloneProfile(profile),
    type: "custom",
    id: null,
    name: name.trim() || `${profile.name} 조정`,
    presetStyle: undefined,
    revision: 0,
    digest: undefined,
    createdAt: undefined,
    updatedAt: undefined
  };
}

function availableCustomName(baseName: string, profiles: readonly ScoreProfile[]): string {
  const used = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase("ko-KR")));
  const base = `${baseName} 조정`;
  if (!used.has(base.toLocaleLowerCase("ko-KR"))) return base;
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate.toLocaleLowerCase("ko-KR"))) return candidate;
  }
  return `${base} 새 버전`;
}

function availableSuggestedName(baseName: string, profiles: readonly ScoreProfile[]): string {
  const clean = baseName.trim().slice(0, 40) || "AI 추천 로직";
  const used = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase("ko-KR")));
  if (!used.has(clean.toLocaleLowerCase("ko-KR"))) return clean;
  for (let index = 2; index <= 99; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${clean.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase("ko-KR"))) return candidate;
  }
  return `${clean.slice(0, 34)} 새 버전`;
}

function suggestionDraft(suggestion: ScoreProfileSuggestion, profiles: readonly ScoreProfile[]): ScoreProfile {
  const draft = cloneProfile(suggestion.profile);
  draft.type = "custom";
  draft.id = null;
  draft.name = availableSuggestedName(suggestion.name, profiles);
  draft.revision = 0;
  draft.digest = undefined;
  draft.createdAt = undefined;
  draft.updatedAt = undefined;
  return draft;
}

function topSuggestedBlocks(profile: ScoreProfile): string[] {
  return Object.entries(profile.blockWeights)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([block, weight]) => `${recommendationBlockLabels[block] ?? block} ${weight}%`);
}

export function suggestionRationaleSummary(suggestion: ScoreProfileSuggestion): string {
  const focus = suggestion.intent.documents
    .slice(0, 2)
    .map((document) => document.title.replace(/ 확인$/, ""));
  const focusLabel = focus.length > 0
    ? focus.join("·")
    : topSuggestedBlocks(suggestion.profile).slice(0, 2).join("·");
  return `${focusLabel}에 비중을 둔 로직입니다. 체결 여건과 기업 품질까지 함께 반영해 신호의 안정성을 높였습니다.`;
}

async function persistCustomProfile(profile: ScoreProfile): Promise<ScoreProfile> {
  if (profile.type !== "custom") return profile;
  if (profile.id) return updateScoreProfile(profile);
  return createScoreProfile({
    name: profile.name.trim(),
    blockWeights: profile.blockWeights,
    factorWeights: profile.factorWeights,
    portfolioWeight: profile.portfolioWeight,
    portfolioFactorWeights: profile.portfolioFactorWeights
  });
}

function profileSignature(profile: ScoreProfile | null): string {
  if (!profile) return "";
  return JSON.stringify({
    type: profile.type,
    id: profile.id ?? null,
    name: profile.name,
    blockWeights: profile.blockWeights,
    factorWeights: profile.factorWeights,
    portfolioWeight: profile.portfolioWeight,
    portfolioFactorWeights: profile.portfolioFactorWeights
  });
}

function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}
