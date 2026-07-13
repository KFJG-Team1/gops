# czardas v1 Implementation Plan

## 목적

이 문서는 [ENGINE_SPEC.md](ENGINE_SPEC.md)를 현재 저장소에 구현하는 순서와 완료
조건을 정의한다. 알고리즘 선택을 다시 논의하는 문서가 아니다. Codex는 milestone을
순서대로 완료하고, 각 단계에서 테스트와 측정 artifact를 남긴다.

현재 상태는 Milestone 1~5 repository 구현 완료, 수동 PostgreSQL migration·실종목 pack
검증·배포 전이다. 아래 순서는 후속 변경이 계약을 보존하는지 확인하는 회귀 지도이기도 하다.

- 동결 기준 코드: 현재 branch의 `16e0fa5`
- 저장소 동기화: czardas 구현 중 원격 `dev`를 merge/rebase/pull하지 않는다. 구현과 검증을
  완료한 뒤 별도 통합 단계에서 차이를 재검토한다.
- 목표 엔진: `czardas-v1`
- 공식 Python: 저장소 root `.venv`, Python 3.12
- 검증 전략: core fixture -> 개발 패널의 종목×interval 수동 build -> shared PG asset 확인 ->
  chart/Field 시각 검증
- rollback: 기존 Geometry API, builder, `chart_assets.geometry_assets` 유지

## 1. 구현 원칙

1. 최소 fixture와 시각 확인 도구를 먼저 만들고 detector를 빠르게 반복한다.
2. authoritative 계산은 Python 하나뿐이다. 프런트에 검출 로직을 복제하지 않는다.
3. H-Line vertical slice를 완성한 뒤 Trend를 추가하고, 마지막에 선택된 Trend의 Triangle
   관계만 해석한다.
4. 매 milestone은 결정론, 명백한 미래정보 누수, 성능의 작은 필수 테스트만 추가한다.
5. 현재 API와 자산을 한 번에 제거하지 않는다.
6. no-draw, unavailable, stale와 manual-job running/failed를 서로 다른 상태로 다룬다.
7. config 변경은 `configVersion`과 평가 결과를 함께 바꾼다.
8. MA120을 포함한 indicator 조회·계산·교차·작도와 후속 placeholder는 만들지 않는다.
   기존 chart indicator 동작만 보존하고 다음 구현에 맡긴다.
9. H-Line response와 Trend hypothesis/mode로 이루어진 `Inference Field`는 kernel이 실제로
   Boundary를 만드는 authoritative intermediate다. `Czardas Field view`만 그 state의 읽기
   전용 bounded projection이며 renderer가 role mass·mode·episode를 다시 계산하지 않는다.
10. 후속 linear-regression pattern도 parameter-space hypothesis와 mode가 먼저 존재하고
    Czardas chart에 근거가 보여야 한다. v1에는 그 detector나 placeholder를 미리 만들지 않는다.
11. `ENGINE_SPEC.md` 2.1의 Field clock, mode lineage, FormationEpisode, sweep/refine tie-break,
    byte-budget 순서와 rollout release constant를 구현 선택 없이 그대로 따른다.
12. `chart.czardas.*` command는 chart-engine internal capability다. agent/LLM proposal의
    command whitelist에는 추가하지 않는다.

## 2. 현재 파일 구조

```text
systems/market-data/shared/alfaka/analytics/czardas/
  __init__.py
  config.py
  types.py
  numeric.py
  tape.py
  features.py
  evidence.py
  profile.py
  hline.py
  trend.py
  interactions.py
  rank.py
  relations.py
  select.py
  compiler.py
  field.py
  field_view.py
  kernel.py

systems/market-data/tests/analytics/czardas/
  test_tape.py
  test_features.py
  test_relations.py
  test_field_chronology.py
  test_kernel_golden.py
  test_no_lookahead.py
  test_robustness.py
  test_volume_contract.py
  test_clickhouse_contract.py
  test_data.py
  test_performance.py

systems/market-data/tests/fixtures/czardas_v1/
  manifest.json
  synthetic/
  market/
  expected/

systems/api-server/pods/api-server/gops-backend/app/routes/
  chart_assets.py

systems/api-server/tests/
  test_chart_assets_routes.py

systems/agent-orchestration/shared/gops_agents/czardas_assets/
  builder.py
  storage.py
  envelope.py
  job_store.py
  delivery.py
  progress.py
  queue.py
  repair.py

systems/agent-orchestration/pods/czardas-asset-builder/
  main.py

shared/chart-contract/
  chart-czardas-pack.schema.json

apps/gops-frontend/src/chart/
  analysisEngine.ts
  czardasAssetsApi.ts
  czardasLayerController.ts
  ChartCanvas.tsx

apps/gops-frontend/src/components/
  ChartAssetOpsPanel.tsx
  ChartAnalysisLayerToggles.tsx
  ChartPanel.tsx

apps/gops-frontend/tests/
  czardas.test.ts
  visual/chart-analysis-assets-v2.spec.ts
```

파일 수는 책임 경계다. 작은 helper 하나 때문에 새 파일을 만들지 않는다. 위 구조보다
더 나눠야 할 때는 이 계획과 `docs/README.md`를 먼저 갱신한다.

## 3. 공통 검증 명령

Python 명령은 repository root에서 실행한다.

```bash
PYTHONPATH=systems/market-data/shared:systems/order/shared:systems/order:systems/api-server/pods/api-server/gops-backend \
  .venv/bin/python -m pytest systems/market-data/tests/analytics/czardas

PYTHONPATH=systems/market-data/shared:systems/agent-orchestration/shared:systems/order/shared:systems/order:systems/api-server/pods/api-server/gops-backend \
  .venv/bin/python -m pytest systems/api-server/tests/test_chart_assets_routes.py

PYTHONPATH=systems/market-data/shared:systems/agent-orchestration/shared \
  .venv/bin/python -m pytest systems/agent-orchestration/tests

npm run test:chart --prefix apps/gops-frontend
npm run test:chart-visual --prefix apps/gops-frontend
npm run build --prefix apps/gops-frontend
```

milestone의 좁은 테스트를 먼저 실행하고 완료 gate에서 관련 전체 suite를 실행한다.

## Milestone 1 — core fixture와 시각 확인 도구

### 목표

핵심 geometry를 빠르게 반복할 작은 fixture와 단계별 Czardas Field preview를 만든다.
같은 화면에서 `Candle Morphology -> Role Basis -> Hypothesis Field -> Ridge/Mode -> Drawing`을
비교하되 예측 정확도를 증명하거나 전문가 정답 dataset을 만드는 단계는 아니다.

### 변경 파일

```text
systems/market-data/tests/fixtures/czardas_v1/**
systems/market-data/tests/analytics/czardas/test_kernel_golden.py
systems/market-data/tests/analytics/czardas/test_no_lookahead.py
systems/market-data/tests/analytics/czardas/test_performance.py
systems/market-data/shared/alfaka/analytics/czardas/__init__.py
systems/market-data/shared/alfaka/analytics/czardas/types.py
systems/market-data/shared/alfaka/analytics/czardas/kernel.py
scripts/local/benchmark-czardas.py
scripts/local/evaluate-czardas.py
scripts/local/render-czardas-field.py
```

### 구현 순서

1. 기존 `chart_assets_v2`의 실제 1D fixture를 immutable source로 복사하지 않고
   manifest에서 참조한다.
2. 부족한 interval은 canonical candle loader로 익명화된 고정 fixture를 한 번
   생성하고 source/digest/as-of를 manifest에 기록한다.
3. synthetic fixture를 추가한다.
   - 명확한 support/resistance와 세 번째 반응
   - 거래량만 높고 reaction이 없는 가격대
   - wick은 통과하지만 body는 보존되는 Trend
   - 다수 core candle과 고립된 wick/body 돌출봉
   - 경계 밖 단일 종가 뒤 빠른 reclaim
   - 같은 깊이의 경계 밖 종가가 2봉 지속되는 break
   - body/close break
   - ascending/descending/symmetrical Triangle
   - 평평한 random walk, gap, 저유동, split-adjusted 경계
   - 모든 interval의 239/240/241봉 exact coverage 경계
4. synthetic fixture에는 명백한 기대 관계만 기록한다. 실제 시장 fixture에는 전문가
   정답선을 붙이지 않고 결과를 나란히 볼 수 있게 한다.
5. `types.py`와 `kernel.py`에
   `AnalysisResult=Ready(CzardasPackContent)|Unavailable(reason)` stub을 만든다. no-draw만
   빈 drawing의 ready content이며 unavailable pack은 만들지 않는다.
6. 현재 Geometry와 czardas output을 같은 fixture의 분리된 debug panel에서 비교하고
   compact JSONL 결과를 만든다. 두 managed engine을 한 ChartDocument에 동시에 적용하지
   않는다.
7. synthetic fixture의 Basis, exact H-Line response segment, Trend hypothesis thread와 mode
   ribbon을 같은 time×price 좌표에 그리는 Field preview를 만든다. selected point만 찍거나
   계산에 없는 density·curve·점수를 만들지 않는다.
8. selector/output을 끈 preview에서도 pre-selection landscape가 남는지, 개별 mark의 source와
   aggregate mode의 derivation digest가 재현되는지, final drawing이 source mode와 얼마나
   겹치는지 측정한다.
9. benchmark는 warmup, 반복 수, Python/CPU/container 정보를 출력한다.

### 측정 지표

- 같은 입력의 deterministic digest 일치 여부.
- 명백한 fixture에서 expected boundary zone과 pattern 관계.
- formation과 verification episode 중복 수. 목표 0.
- H-Line/Trend별 drawing 수와 payload bytes.
- Field orphan primitive 수, mode derivation 재현율, no-draw landscape 수와
  drawing-source-mode pixel diff.
- kernel P50/P95/P99와 peak additional memory.
- 참고용 reaction, break, no-draw count. 예측력 합격 기준으로 쓰지 않는다.

### 테스트

- 같은 fixture를 100회 실행해 canonical payload digest가 동일하다.
- public kernel이 240봉이 아닌 입력을 모두 거부한다.
- 한 240봉 실행 안의 chronological debug trace를 test-only online prefix oracle과 비교해
  event 공개 순서와 각 `confirmedAt/revisionFormedAt`이 동일하다. prefix oracle은 public
  API가 아니다.
- `revisionFormedAt` 이전 episode가 verification에 들어가지 않음을 검사한다.
- malformed candle, 중복 candle key, unresolved gap은 reason을 보존한다.
- Field preview가 임의의 universal candle importance를 만들지 않고 role별 legend를 사용한다.
- output count를 0으로 바꿔도 Basis, H-Line response와 Trend mode digest가 byte-identical하다.

### 완료 gate

- 모든 fixture에 source, interval, as-of, digest, 기대 의미가 있다.
- evaluator와 benchmark가 한 명령으로 재현된다.
- 같은 fixture의 Field preview가 한 명령으로 재현되고 source 없는 개별 mark와 재현 불가능한
  aggregate mode가 0개다.
- 현재 Geometry baseline과 빈 czardas stub을 모두 실행할 수 있다.
- 저장소 밖 수동 spreadsheet나 캡처가 합격 판단에 필요하지 않다.

POC에서 nearby null, fatigue, 전문가 annotation, 자동 threshold 최적화, 통계적 수익
예측력 입증은 구현하지 않는다.

## Milestone 2 — CandleTape, FeatureTape, Evidence

### 목표

모든 detector가 공유하는 작고 결정론적인 OHLCV 해석층을 만든다. 이 단계의 출력은
선이 아니라 candle별 fact와 evidence다.

### 변경 파일

```text
czardas/config.py
czardas/types.py
czardas/numeric.py
czardas/tape.py
czardas/features.py
czardas/evidence.py
czardas/field.py
czardas/field_view.py
czardas/kernel.py
tests/.../test_tape.py
tests/.../test_features.py
tests/.../test_evidence.py
tests/.../test_field.py
tests/.../test_field_view.py
tests/.../test_no_lookahead.py
```

### 구현 순서

1. frozen `CzardasConfig`와 canonical config digest를 만든다.
2. `CandleTape.from_rows()`에서 identity, 정렬, OHLCV, 완료봉, coverage를 검증한다.
3. list-of-dicts를 고정 길이 SoA tuple/array로 한 번만 변환한다.
4. Wilder ATR14, body/wick, return, trailing robust volume 같은 static OHLCV feature만
   계산해 저장한다.
5. 반경 2/5/13 extrema와 `confirmedAt`을 계산한다.
6. reaction 3봉 confirmation과 NMS를 적용한다.
7. `EvidenceViewAt(prefix)`에서만 recency를 계산하고 H-Line/Trend role마다 immutable
   `RoleBasisAt(prefix)`를 만든다. base tape, atom, cluster에 prefix-dependent 값을 저장하지
   않는다.
8. detector가 사용할 chronological prefix iterator와 fact 공개 순서를 만든다. 이
   milestone에서는 Boundary formation이나 interaction을 판정하지 않는다.
9. 이 milestone의 `field.py`는 Basis bank type만 제공한다. `field_view.py`가 role별 Basis
   glyph와 `observedAt/confirmedAt` tether를 투영하며 universal candle score는 만들지 않는다.
10. debug trace에 feature origin과 reason을 남긴다.

### 테스트

- hand-calculated 20봉의 ATR/body/wick/volume rank와 일치.
- current candle이 volume baseline에 들어가지 않음.
- extrema 끝단의 미확정 bar가 evidence가 아님.
- plateau tie-break와 NMS가 입력 순서와 무관함.
- 같은 candle의 swing/rejection atom이 exact kind별 별도 ID/cluster를 가짐.
- representative에서 2봉·0.25 ATR 조건을 벗어난 atom은 chain member와 가깝더라도 같은
  NMS cluster로 transitive merge되지 않음.
- 뒤늦게 confirmed된 큰 scale NMS member가 evidence/candidate ID를 바꾸지 않고
  `confirmedScales/lastUpgradeConfirmedAt`만 갱신하며 과거 prefix structural 상태를 바꾸지 않음.
- live candle을 바꿔도 inference digest와 evidence가 동일함.
- public kernel/CandleTape는 모든 interval에서 239봉과 241봉을 거부하고 정확히 240봉만
  받음. 241개 이상 source에서 최신 240개를 고르는 책임은 Milestone 6 storage snapshot
  selector에서 테스트함.
- full-window 결과에서 각 revision을 prefix 실행으로 재현할 수 있음.
- ATR/extrema readiness 전에는 해당 구조 evidence가 없고, volume20 readiness 전에는
  `participation=0.5`라서 H-Line/Trend evidence 자체를 막지 않음.
- 같은 bar에서 공개된 evidence가 그 bar interaction을 평가하지 않음.
- effectiveTick이 각 replay prefix close만 사용하고 final as-of close를 소급하지 않음.
- recency와 role mass가 현재 replay prefix로 계산되고 final as-of 나이를 소급하지 않음.
- 같은 candle이 H-Line과 Trend에서 다른 mass를 갖는 fixture가 하나의 밝기로 합쳐지지 않고
  서로 다른 glyph/source로 투영됨.
- live candle은 dashed Candle Fact만 가지며 evidence glyph가 없음.
- late-confirmed extrema는 `observedAt`에 놓이고 `confirmedAt` tether를 가지며 confirmed
  prefix 전 Field에는 나타나지 않음.

### 성능 기준

- feature/evidence 단계 P95 `<=20ms`.
- 추가 메모리 `<=8 MiB`.
- evidence cap 이전에도 입력 크기 `F`에 선형.

### 완료 gate

- detector가 raw candle dict를 직접 읽지 않는다.
- feature 계산에 미래정보가 없음을 prefix test가 보장한다.
- 같은 evidence가 role별 mass를 가질 수 있고 만능 candle score가 없다.
- 이후 `revisionFormedAt` 계산에 필요한 모든 evidence `confirmedAt`이 존재한다.
- Basis Field view의 visible source가 typed trace로 100% 역조회된다.

## Milestone 3 — H-Line end-to-end vertical slice

### 목표

Price Memory 생성, 가벼운 verification, BoundaryRank, selection, explanation, drawing까지 한 경로를
먼저 완성한다. 이 단계에서 Trend와 Triangle relation은 비활성이다.

### 변경 파일

```text
czardas/profile.py
czardas/hline.py
czardas/interactions.py
czardas/rank.py
czardas/select.py
czardas/compiler.py
czardas/field.py
czardas/field_view.py
czardas/kernel.py
tests/.../test_hline.py
tests/.../test_interactions.py
tests/.../test_rank.py
tests/.../test_selector.py
tests/.../test_field.py
tests/.../test_field_view.py
```

### 구현 순서

1. support/resistance reaction atom을 exact-kind NMS cluster와 role-specific Basis로
   정규화한다.
2. 각 confirmed Basis prefix에서 interval endpoint sweep으로 exact piecewise
   `SeedResponse_role(p)`와 모든 local ridge를 만든다.
3. ridge contributor만으로 provisional mode를 만들고 공통 separation을 한 번 적용해
   mode-local episode를 만든다.
4. episode마다 단일 contribution을 만든 뒤 `EpisodeResponse_mode(p)`를 다시 계산한다.
   independent episode 두 개가 겹치는 maximum만 coherent mode가 된다. raw cluster 수는
   support mass, touch count나 seed에 직접 넣지 않는다.
5. coherent mode 안에서 weighted median center와 weighted MAD zone을 refine하고 fit-domain
   body/close acceptance를 별도 opposition field로 적분한다.
6. H-Line hard gate와 형성 순간의 열린 2봉 close-through 검사를 적용하고 첫
   `lineageFormedAt/revisionFormedAt`을 만든다.
7. active-one/terminal-latch/reset 계약의 공통 episode FSM을 구현한다.
8. `revisionFormedAt` 이후 반응을 verification/neutral/break/pending으로 구분한다.
9. late-confirmed evidence를 과거 Interaction과 연결하는 ordered refit admission queue를
   구현한다.
10. profile bonus 없이 BoundaryRank, identity, dedupe, replay cap을 끝낸다.
11. czardas 내부 pure 함수로 final exact-240의 48-bin estimated price-volume histogram을
   한 번 계산한다. 기존 public Volume Profile API를 호출하거나 바꾸지 않는다.
12. 살아남은 H-Line bank에서 zone과 겹친 bin의 normalized mass 하나만 계산해 최대 0.05
   final rank bonus를 붙인다.
13. H-Line 독립 selector와 `hlineDisplayCount`를 적용한다.
14. stable ID, `sourceFieldModeId+sourceFieldRevision`, 고정 explanation template,
    horizontalLine drawing을
    compile한다.
15. selector 전 Basis, response bands, weak/coherent/opposed mode를 bounded Field view로
    투영한다. selected source mode는 cap에서 보존하고 formation/Interaction은 secondary
    validation glyph로만 더한다.

### 테스트

- profile peak만 있고 reaction 2개가 없으면 no-draw.
- 같은 Basis intervals의 endpoint sweep segment 값이 hand-calculated response field와 같다.
- selector/output count를 0으로 해도 H-Line response와 field mode digest가 동일하다.
- weak/opposed mode만 있는 no-draw에서도 response band가 보이고 selected ref는 비어 있다.
- refined geometry가 body-integrity/open-break에서만 실패하면 opposed, episode/geometry gate가
  실패하면 weak이며 `oppositionMass`가 common integrity formula와 일치한다.
- reaction 2개와 geometry gate를 통과하면 formed이며 production 후보가 됨.
- `initialFormationEpisodeIds`는 정확히 2개로 ID를 고정하고 current `fitEpisodeIds`는
  2개 이상이며 observed domain/persistence/horizon이 fit set span을 사용함.
- `revisionFormedAt` 뒤 세 번째 반응이 있으면 verified bonus를 받고 없어도 자동 탈락하지 않음.
- verification 0인 formed 후보의 neutral/contact-free episode만 refit 대상이며 verified와
  broken 후보는 geometry가 고정됨.
- hard gate·품질 개선·identity tolerance를 모두 통과한 refit만 같은 lineage revision이고,
  tolerance 밖 geometry는 새 initial pair의 독립 candidate로만 생김.
- 미래의 세 번째 반응을 이용해 과거 formation pair를 소급 선택하지 않음.
- final center가 ridge overlap 안이고 모든 formation interval이 final zone과 교차함.
- provisional ATR이 아직 없는 `fitEpisodeIds`를 참조하지 않고, final center/zone/rejection/
  seed는 episode contribution만 정확히 한 번 사용함.
- 같은 머무름에 cluster를 여러 개 추가해도 touch count는 늘지 않고 contribution replacement
  refit만 제안됨.
- 같은 접촉 구간의 여러 candle은 한 episode.
- 짧은 간격이어도 zone에서 0.75 ATR 이탈 뒤 재시험하면 새 episode이고, 긴 머무름은
  시간 간격만으로 여러 표가 되지 않음.
- wick/body/close raw penetration weight가 1/4/8 순서이고 최종 loss는 `[0,1)` bounded임.
- 단일 bar의 integrity penalty가 0.15를 넘지 않고 같은 방향의 여러 bar는 누적됨.
- 고립 돌출봉을 추가·제거해도 H-Line center/zone이 core 구조에서 벗어나지 않음.
- 동일 core 구조에 고립 돌출봉을 1/2/3개 추가하는 metamorphic test에서 center/zone과
  candidate identity가 tolerance 안에 유지됨.
- 돌출이 아니라 같은 방향 body/close 수용이 연속해서 늘어나면 integrity가 단조 악화되고
  2봉 close-through에서 break됨. outlier 개수 전용 branch는 없음.
- 돌출을 포함하려고 zone이 `0.35 ATR`보다 넓어지지 않음.
- 같은 돌출 깊이라도 빠른 reclaim이 있는 interaction만 response mass를 얻음.
- fit domain 마지막 두 completed close가 열린 break이면 formed H-Line이 만들어지지 않음.
- terminal 뒤 reset 전 재접촉은 새 verification이 아니고, reset 다음 bar의 재접근만 새
  episode가 됨.
- pending terminalAt은 null, hold/neutral은 contact+horizon, break는 두 번째 close-through,
  leaveAt은 그 뒤 reset bar로 서로 구분됨.
- scale 13처럼 늦게 confirmed된 evidence는 confirmation 시점에 새 contact를 만들지 않고
  source candle의 기존 pending/neutral/hold/break Interaction을 refit admission에 사용함.
- 여러 queued refit evidence는 pending이 모두 끝난 뒤 ordered cumulative revision 하나로
  평가되고 한 prefix에서 modelRevision을 여러 번 올리지 않음.
- neutral terminal 뒤 latch가 reset되지 않았으면 refit을 commit하지 않고 `leaveAt` bar에서
  reset된 뒤 한 번만 commit해 같은 머무름을 새 revision contact로 다시 세지 않음.
- pending horizon은 rank를 낮추지 않음.
- profile 사용 전후 candidate identity는 같고 rank만 변할 수 있음.
- estimated profile bonus가 0.05를 넘지 않고 candidate hard gate를 바꾸지 않음.
- 여러 bin과 겹쳐도 `profileConfluence`가 overlap-weighted max/global max로 `[0,1]`이고
  bin 합계로 1을 넘지 않음.
- final profile을 바꿔도 chronological candidate 생성/dedupe/replay-cap history는 같고
  살아남은 H-Line의 final rank/selector만 달라질 수 있음.
- 모든 volume이 0이거나 `high==low`, 전체 가격 range가 0이어도 finite result이며 profile은
  후보를 새로 만들지 않음.
- H-Line 설정은 1~4만 허용하고 기본 목표는 2이며, formed 후보에 따라 실제 0~2개가
  나올 수 있음.
- 같은 FormationEpisode의 member가 늘어나도 filled H-Line contribution은 하나이며 최초
  formation 두 glyph는 projection cap에서 생략되지 않음.
- 고립 돌출봉은 center를 끄는 control point가 아니라 exploration probe로 보이고 reclaim이
  있어야 verified response tail을 가짐.
- H-Line participation multiplier가 항상 `[0.90,1.00]`이고 volume만으로 reaction 2회나
  hard gate를 우회하지 않음. 명확한 core fixture의 geometry drift는 old revision의
  `0.35 ATR` identity tolerance 안이며 initial episode가 달라지면 새 candidate만 허용함.
- ready no-draw에서도 capped H-Line Basis와 weak/opposed mode가 보이고 selected
  mode ref/validation/drawing은 없음.

### 성능 기준

- H-Line까지 full kernel P95 `<=35ms`.
- profile bucket `<=48`, evidence `<=48/role`.
- H-Line Field `<=32 KiB`, production pack `<=64 KiB`.

### 완료 gate

- H-Line output만으로 initial candle pack을 만들 수 있다.
- 모든 selected line에 formation, verification, invalidation 설명이 있다.
- H-Line drawing centerline과 source Field mode가 같은 viewport에서 `<=0.5 device pixel`로
  일치한다.
- formation episode가 verification으로 중복되지 않는다.
- exact-240 no-draw와 239봉/gap unavailable golden fixture가 모두 통과한다.

## Milestone 4 — Trend와 공통 Interaction Evaluator 완성

### 목표

상·하단 Moving Boundary를 결정론적으로 만들고 H-Line과 같은 interaction/rank
계약으로 평가한다.

### 변경 파일

```text
czardas/trend.py
czardas/interactions.py
czardas/rank.py
czardas/select.py
czardas/compiler.py
czardas/field.py
czardas/field_view.py
tests/.../test_trend.py
tests/.../test_interactions.py
tests/.../test_rank.py
tests/.../test_field.py
tests/.../test_field_view.py
tests/.../test_kernel_golden.py
```

### 구현 순서

1. structural high/low Basis를 방향별 최신 12개로 제한한다.
2. chronological prefix마다 separation 12봉 이상의 pair를 최대 66개 만들고 각 선을
   `(yAtWindowStart,yAtWindowEnd)`의 `TrendHypothesis`로 저장한다.
3. seed-centered dual-distance grouping으로 hypothesis mode를 만든다. transitive chaining,
   dense Hough/KDE와 random RANSAC은 사용하지 않는다.
4. mode medoid와 가까운 unique Basis를 모아 mode-local episode로 묶고 episode당 한
   contribution만 만든다. pair/hypothesis 수로 support mass를 늘리지 않는다.
5. unique contribution pair의 weighted Theil–Sen slope를 구한다.
6. lower 0.20/upper 0.80 intercept quantile과 bounded asymmetric scan으로 one-sided
   Boundary를 refine한다.
7. mode의 시작·끝 dispersion과 fit-domain body/close opposition을 계산한다.
8. wick/body/close one-sided integrity, 형성 시점의 열린 break와 geometry hard gate를
   적용한다.
9. H-Line과 같은 active-one/terminal-latch/reset FSM과 verification/break evaluator를 호출한다.
10. compatible 새 anchor는 기존 revision interaction을 먼저 판정하고, 3.2의
   pending/neutral/verified/broken refit 정책을 적용한다.
11. identity tolerance 안 same-lineage refit과 tolerance 밖 독립 candidate를 테스트한다.
12. lower와 upper를 별도 bank로 출력하고 기본 목표 2에서는 양쪽이 있으면 하나씩
    compile한다.
13. selector 전 Basis diamond, representative hypothesis thread와 weak/coherent/opposed mode
    ribbon을 Field view에 투영한다. selected source mode는 cap에서 보존하고 episode,
    one-sided residual과 Interaction은 validation overlay로만 둔다. Trend branch에는
    volume/participation 표현을 넣지 않는다.

### 테스트

- random seed, sklearn/scipy 없이 같은 slope/intercept를 재현.
- Trend output origin이 current fit의 가장 이른 candle key이고 snapshot ordinal을 바꿔도
  공통 candle key projected price와 slope가 같음.
- 12 anchors일 때 pair가 66을 넘지 않음.
- dual-space seed-centered grouping이 입력 순서와 무관하고 transitive chain으로 tolerance
  밖 hypothesis를 합치지 않음.
- hypothesis pair를 중복 생성해도 unique episode support mass와 refined geometry가 같음.
- selector/output count를 0으로 바꿔도 hypothesis/mode derivation digest가 동일함.
- no-draw에서도 weak/conflicting Trend ribbon은 보이고 selected mode ref는 비어 있음.
- Trend mode도 weak→opposed→coherent precedence와 common opposition formula를 H-Line과
  byte-identical helper로 사용함.
- provisional boundary의 한 머무름에 여러 structural cluster가 있어도 Trend geometry와
  touch count에는 episode contribution 하나만 들어감.
- H-Line/Trend hard gate, persistence, response horizon이 모두 fit contribution observedAt의
  동일한 `formationSpanBars`를 사용함.
- 고립된 wick/body/close penetration은 bounded loss로 허용되지만 지속 cluster는
  integrity 또는 break를 통과하지 못함.
- 한 개의 돌출 anchor를 추가·제거해도 Trend의 시작·끝 projected price drift가 각각
  `<=0.25 ATR`이고 candidate가 사라지지 않음.
- 위 robust test는 최소 3개 core anchor가 있는 fixture에서 수행한다. 두 anchor 중 하나가
  비정상인 구간은 정답을 강제하지 않고 낮은 rank/no-draw를 허용한다.
- 단일 큰 body/close 뒤 reclaim은 break가 아니며, 같은 방향 close 2봉 지속은 break임.
- failed-breakout 전용 branch 없이 exploration pressure×reclaim speed×낮은 acceptance가
  response를 설명함.
- OLS가 중간을 통과하는 fixture에서 one-sided 경계가 body 밖에 위치.
- verified event는 fit에 흡수되지 않아 verified bonus와 geometry가 유지됨.
- pending anchor는 refit을 보류하고 confirmed break는 lineage를 끝냄.
- contact horizon 중 재접촉과 terminal-reset 전 재접촉은 같은 Interaction 하나이며
  candidate revision당 active episode가 둘 이상 생기지 않음.
- neutral/contact-free anchor의 개선된 fit이 tolerance 안이면 `modelRevision`과
  `revisionFormedAt`이 증가하고 `lineageFormedAt`은 유지됨.
- identity drift tolerance 밖 fit은 old revision을 바꾸지 않으며 새 initial pair가 hard
  gate를 통과할 때만 별도 ID이고 이전 rank fact를 상속하지 않음.
- Trend refit drift는 old observed-domain from/to와 그 bar의 ATR, old `formationSpanBars`/
  candidateMedianATR만 기준으로 계산하며 new domain으로 허용치를 키우지 않음.
- rebuild에서 initial pair 귀속, refit, dedupe를 반복해도 candidate ID/revision이 동일하고
  dedupe loser의 history가 winner로 이동하지 않음.
- Trend `anchorHuber`는 compatible episode contribution, boundary penalty/integrity는 fit domain의
  relevant candle만 사용하고 240봉 밖/먼 candle을 섞지 않음.
- break는 normalized close depth `>0.25` 2봉이며 price와 dimensionless 값을 비교하지 않음.
- H-Line과 Trend가 동일 episode semantics와 break reason을 사용.
- replay lineage cap overflow가 stable reason과 순서로 pruning됨.
- lower/upper가 모두 있으면 기본 output은 정확히 하나씩임.
- 한쪽만 formed이면 같은 쪽 두 개로 채우지 않고 Trend 하나만 출력함.
- 평행·발산·수렴 upper/lower가 모두 honest Trend로 유지됨.
- OHLC에 상수를 더하면 line 가격만 같은 상수만큼 이동하고 ATR-normalized 점수는 유지됨.
- tick floor가 지배하지 않는 fixture에서 OHLC를 양의 상수배하면 geometry와 zone도 같은
  비율로 변하고 normalized 판정은 유지됨.
- 모든 volume을 같은 양의 배수로 바꿔도 Trend geometry/rank는 같고 H-Line profile
  confluence는 같음.
- zero ATR/flat/zero-volume fixture에서 NaN/Inf가 없고 안전하게 no-draw 또는 finite
  low-rank 결과를 냄.
- volume만 바꾼 fixture에서 Trend Field branch, geometry와 rank가 byte-identical함.
- 같은 episode member가 여러 개여도 Trend geometry contribution은 filled glyph 하나임.
- late confirmation tether를 보이되 confirmed prefix 전 boundary trace에 연결하지 않음.

### 성능 기준

- H-Line+Trend kernel P95 `<=45ms`.
- 방향별 fit candidate `<=66`.
- pair/anchor 수가 config cap을 넘어 메모리가 증가하지 않음.

### 완료 gate

- 세 가지 volatility/유동성 regime fixture에서 boundary가 ATR 단위로 안정적.
- prefix no-lookahead suite 통과.
- formed와 verified가 기본 drawing 후보이고 broken은 나오지 않음.
- 현재 Geometry의 Triangle 없이도 독립 Trend가 화면에 표현 가능함.
- lower/upper drawing과 각 source Field mode가 같은 viewport에서 `<=0.5 device pixel`로
  일치함.

## Milestone 5 — Relation, selector, drawing lifecycle

### 목표

formed/verified H-Line과 Trend를 독립 layer와 독립 개수 계약으로 먼저 선택한다. 그 뒤
선택된 upper/lower Trend의 현재 Triangle 관계만 읽고, managed drawing을 사용자 편집과
충돌 없이 갱신한다. 좌측 하단은 H-Line과 Trend 두 toggle만 제공하고, 선 두께 편집은
1/2/3px 세 단계로 제공한다. 같은 pack의 pre-selection Basis와 hypothesis landscape를
다섯 번째 chart type `Czardas`로 렌더한다. Inference Field는 이미 selection의 입력이지만,
bounded Field view와 renderer는 selection이나 drawing을 바꾸지 않는다.

### 변경 파일

```text
czardas/relations.py
czardas/select.py
czardas/compiler.py
shared/chart-contract/chart-czardas-pack.schema.json
shared/chart-contract/chart-command.schema.json
shared/chart-contract/chart-capabilities.json
apps/chart-engine/src/types.ts
apps/chart-engine/src/commands.ts
apps/chart-engine/src/chartDocuments.ts
apps/chart-engine/src/capabilities.ts
apps/chart-engine/src/registries.ts
apps/gops-frontend/src/chart/types.ts
apps/gops-frontend/src/chart/czardasTypes.ts
apps/gops-frontend/src/chart/czardasField.ts
apps/gops-frontend/src/chart/czardasLayerController.ts
apps/gops-frontend/src/chart/czardasPresentation.ts
apps/gops-frontend/src/chart/chartDocumentAdapter.ts
apps/gops-frontend/src/chart/scene.ts
apps/gops-frontend/src/chart/ChartCanvas.tsx
apps/gops-frontend/src/components/ChartAnalysisLayerToggles.tsx
apps/gops-frontend/src/components/ChartCzardasPatternBadge.tsx
apps/gops-frontend/src/components/PanelContentRenderer.tsx
apps/gops-frontend/src/components/ChartPanel.tsx
apps/gops-frontend/src/chart-features.css
apps/gops-frontend/tests/fixtures/czardas-pack.json
apps/gops-frontend/tests/czardasLayer.test.ts
apps/gops-frontend/tests/czardasField.test.ts
apps/gops-frontend/tests/czardasOwnership.test.ts
apps/gops-frontend/tests/chartRuntime.test.ts
apps/gops-frontend/tests/visual/chart-czardas.spec.ts
```

### 구현 순서

1. H-Line과 Trend capped subset을 서로 독립적으로 평가하고 Trend output 2개 이상에는
   lower와 upper가 모두 있도록 강제한다.
2. `hlineDisplayCount=2 (1..4)`, `trendDisplayCount=2 (1..3)`를 검증하고 각 layer에만
   적용한다. 부족한 후보를 강제로 채우지 않는다.
3. Trend 선택을 완전히 끝낸 뒤 선택된 upper/lower pair 최대 2개의 relation domain,
   containment, contraction, apex를 pure function으로 계산한다.
4. 세 Triangle 종류 또는 `null`만 반환한다. relation에는 별도 candidate ID, drawing,
   formation, breakout, frozen geometry, lifecycle을 만들지 않는다.
5. 통과한 relation이 여러 개면 `relationQuality`로 표시할 하나만 고른다. 이 점수는 Trend
   fit, rank, selection, ID, anchor에 절대 들어가지 않는다.
6. 선택된 relation의 두 Trend는 같은 drawing ID와 ray를 유지한 채 3px, 일반 Trend는
   2px이며 Triangle은 추가 drawing을 만들지 않는다.
7. Python DTO와 TypeScript가 공유할 JSON schema에 explicit
   `czardasLayer=hline|trend`, per-layer count, nullable `presentationPattern`을 넣고
   compiler golden fixture를 만든다.
8. chart-engine authoritative DrawingEntity와 normalizer에 ownership,
   sourceCandidateId, sourceGroupId, engineRevision을 additive 확장한다.
9. ChartDocument/Snapshot에 session-lifetime `czardasSuppressions`를 추가하고
   command schema와 undo/redo에 포함한다.
10. 세 user command를 chart-engine capabilities/registry와 shared capability mirror에
   추가하되 LLM proposal whitelist에는 노출하지 않는다.
11. current Geometry controller는 rollback용으로 보존하고 새 czardas controller는
   처음부터 stable-ID diff만 생성한다.
12. managed add/update/remove와 selection 유지를 구현한다.
13. 첫 drag/style/text edit의 `fork+suppression`과 Triangle relation group의 atomic fork를 한 history
    transaction으로 구현한다.
14. `analysisEngine=geometry|czardas|off` presentation mode를 두어 current Geometry와
    czardas fetch/apply effect를 상호배타적으로 만든다. 전환 시 이전 managed prefix만
    제거하고 user-owned는 보존한다.
15. chart-engine/frontend의 실제 `candle | line | ohlc | bidask` union, command validator,
    capability와 selector에 `czardas`를 추가하고 `ChartCanvas`에 명시적 renderer branch를
    만든다. fallback candle branch에 우연히 맡기지 않는다.
16. `1M`에서는 Czardas option을 disabled로 두고 persisted `czardas+1M`만 document load에서
    candle로 normalize한다. 사용자의 interval을 자동 변경하지 않는다.
17. `czardasField.ts`는
    `basisGlyphs/hlineResponseSegments/hlineProfileBins/hlineModes/trendModes/
    selectedModeRefs/validationGlyphs` DTO를 검증한 뒤 candle key/price 좌표 변환과 primitive
    렌더만 한다. response segment,
    role mass, hypothesis grouping, dispersion, episode와 outcome을 브라우저에서 재계산하지 않는다.
    Trend ribbon은 DTO가 운반한 네 price-space endpoint를 그대로 투영한다.
18. Czardas renderer는 standard indicator/MA/Volume Profile/comparison/below pane을 숨기되
    사용자의 layer state는 보존하고, user-owned drawing은 그대로 렌더한다.
19. current digest만 Field를 보인다. stale asset에서는 이전 Field를 제거하고 Candle Fact와
    `수동 재분석 필요`를, missing/incompatible에서는 asset state를 보인다. exact input/repair
    unavailable reason은 manual job panel에만 표시한다.
    current no-draw는 Basis와 weak/opposed mode를 보인다.
20. 현재 단일 Geometry toggle을 czardas mode에서 `H-Line`과 `Trend` 두 toggle로 교체한다.
    둘은 기본 on이며 explicit `czardasLayer`의 managed drawing과 대응 Field branch만
    필터링하고 refetch하지 않는다.
21. plot 우측 상단에 pattern badge 하나를 overlay로 표시하고 Trend off 또는 관계 구성선
    fork/delete 때 숨긴다. line label은 비운다. Field의 compression region도 Trend에 속한다.
22. 현재 color/delete drawing toolbar 옆에 1/2/3px 두께 control을 추가한다. 기존
    numeric `style.lineWidth` 계약을 재사용하고 managed 변경은 `forkManaged`로 보낸다.
23. 새 test 파일을 `chartRuntime.test.ts`에서 import해 `test:chart`가 실제 실행하게 한다.

### 테스트

- 세 Triangle fixture와 non-converging/containment fail/apex out-of-range.
- relation domain이 두 observed-domain 시작 중 늦은 bar부터 as-of까지이고, 그 domain의
  공통 median ATR·고정 두 zone으로 width/containment/apex를 재현함.
- 평행·발산 pair는 유효 Trend로 남지만 Triangle badge는 없음.
- Trend 3개에서도 valid upper/lower pair가 없으면 Triangle은 없음.
- 더 약한 수렴 pair 때문에 더 강한 honest Trend가 selector에서 밀려나지 않음.
- Triangle은 선택된 Trend 두 선을 재사용하고 별도 drawing을 추가하지 않음.
- 같은 boundary DTO에서 `presentationPattern` 존재/부재만 바꾼 compiler fixture가 Trend
  candidate ID, slope/intercept, rank, selected membership, ray anchor, drawing count를
  바꾸지 않음.
- 구성 Trend가 broken/탈락하거나 relation gate를 벗어나면 같은 Trend drawing ID를 유지한
  채 badge와 3px 강조만 사라짐.
- H-Line은 설정 1~4/default2, Trend는 설정 1~3/default2만 허용함.
- 후보가 부족하면 각 layer가 0개 또는 목표보다 적어도 성공함.
- 최신 `recentEvidenceBars=120` 안에 fit/verification/contact가 없고 현재 가격에서
  3 ATR보다 먼 과거 선은 제외됨.
- 두 layer를 모두 최대로 설정해도 H-Line `<=4`, Trend `<=3`, transport `<=7`임.
- selector가 `Candle/Line/OHLC/Bid/Ask/Czardas`를 표시하고 내부 값은 정확히
  `candle/line/ohlc/bidask/czardas`임.
- `1M`에서 Czardas가 disabled이고 interval을 바꾸지 않으며 stale persisted 조합만 candle로
  normalize됨.
- chart type 전환이 viewport, pack digest, drawing ID, API call, kernel call, drawing delta를
  바꾸지 않음.
- Candle chart와 Czardas chart의 같은 BoundaryDto가 동일 drawing geometry를 가지며 Field
  centerline과 `<=0.5 device pixel`로 일치함.
- Czardas renderer에서 indicator/comparison은 보이지 않지만 다른 chart type으로 돌아가면
  이전 visibility state 그대로 복원됨.
- 개별 Field primitive 중 provenance가 없는 orphan이 0이고 aggregate mode의 derivation
  digest 재현율이 100%임.
- H-Line marginal/profile texture가 DTO segment/bin만 사용하고 OHLCV에서 KDE/profile을
  다시 계산하지 않음.
- selected frozen source revision과 current mode revision이 다르면 둘을 별도 contour로 그리고
  source focus는 `roleMassAtRevision`, current Basis는 `roleMassAtAsOf`를 사용함.
- selected source mode의 representative Basis는 projection cap에서도 항상 `basisGlyphs`에
  남아 endpoint/corridor를 그릴 수 있음.
- 같은 FormationEpisode에 member가 늘어도 filled contribution은 하나이고 최초 formation
  두 개는 double-outline로 구분됨.
- stale/missing/incompatible에서 이전 Field가 최신 candle 위에 남지 않으며
  no-draw에서는 Basis와 weak/opposed mode가 보임.
- live candle에는 evidence/score가 없고 dashed scaffold만 보임.
- user-owned fork에는 causal focus/connector가 붙지 않음.
- H-Line off가 Trend를 숨기지 않고 Trend off가 H-Line을 숨기지 않음.
- H-Line off는 H-Line Field branch와 managed drawing을 함께 숨기고 Trend off는 Trend Field,
  managed drawing, Triangle region/badge를 함께 숨김.
- toggle만으로 API 요청, inference, drawing add/remove command가 생기지 않음.
- reload/새 ChartDocument에서 두 toggle이 기본 on으로 돌아가고 서버/local persistence
  write가 없음.
- Trend off에서 Triangle badge가 숨고 다시 on이면 동일 pattern이 복원됨.
- strongest Triangle 하나만 이름을 우측 상단에 한 번 표시하고 두 line label은 비어 있음.
- H-Line presentation anchor는 동일 digest 240봉 snapshot의 첫/as-of candle이며 과거
  formation timestamp가 viewport 밖이라는 이유로 drawing을 버리지 않음.
- Trend/Triangle timed anchor에는 H-Line의 presentation 투영을 적용하지 않음.
- 일반 czardas line은 2px, Triangle constituent는 3px임.
- drawing toolbar가 1/2/3px만 기록하고 기존 비표준 numeric 값을 선택 전 변경하지 않음.
- 같은 ID 새 revision은 update command이며 remove/add가 아님.
- generatedAt만 다른 exact pack은 delta를 만들지 않음.
- Geometry와 czardas mode가 동시에 drawing을 적용하지 않고 mode 전환이 이전 managed
  prefix만 제거함.
- managed drawing 선택 상태가 update 뒤 유지됨.
- user edit 시 새 ID로 fork되고 이후 snapshot이 덮지 않음.
- managed delete tombstone이 같은 lineage 재등장을 막음.
- user-owned 삭제 뒤에도 suppression이 유지되고 “자동 작도 복원”에서만 제거됨.
- Triangle 관계의 한 선 편집/삭제가 group 전체에 원자적으로 적용됨.
- group fork는 두 user-owned copy 모두 각 `sourceCandidateId/sourceGroupId`를 보존하고
  사용자의 patch는 선택한 copy에만 적용됨.
- group ID와 두 candidate suppression이 같은 `suppressionSetId`를 가지며 restore/undo가
  set 전체를 한 transaction으로 복원함.
- Triangle 관계 구성선 편집 뒤 자동 badge가 사라짐.
- suppression 등으로 구성선 하나가 apply되지 않으면 남은 managed Trend도 일반 2px이며
  badge가 없음.
- undo/redo가 drawing과 suppression을 함께 복원함.
- user-owned drawing은 같은 ChartDocument의 symbol/interval refresh에서 보존됨.
- reload나 새 ChartDocument에서는 user 편집이 사라지고 shared proposal이 다시 적용됨.
- user edit/toggle/suppression을 전송하거나 PostgreSQL에 쓰는 요청이 없음.

### 성능 기준

- 선택된 upper/lower pair 최대 2개의 exhaustive relation 평가 P95 `<=2ms`.
- frontend parse+delta P95 `<=8ms`, main-thread long task 0.
- Field coordinate projection+paint P95 `<=8ms`, main-thread long task 0.
- H-Line `<=4`, Trend `<=3`, transport line `<=7`, Field `<=32 KiB`, pack `<=64 KiB`.

### 완료 gate

- H-Line과 Trend가 독립 개수와 독립 visibility로 한 chart에 공존함.
- Triangle이 Trend 두 선의 강조와 badge로 표현되고 별도 세 번째 layer가 없음.
- 모든 line drawing에 3단계 두께 편집이 가능함.
- `Czardas` chart type에서 같은 typed provenance가 Role Basis -> H-Line response/Trend
  hypothesis -> mode -> Boundary -> validation/drawing으로 추적되고 frontend 계산 복제가 없음.
- 현재 remove-all/add-all 동작이 czardas layer에 남아 있지 않음.
- keyboard/mouse 편집, undo/redo, selection visual test 통과.
- `ExplanationDto`와 debug evaluator가 계산 fact와 invalidation을 보존하고 수익 보장
  표현을 만들지 않음.

## Milestone 6 — 개발 패널 수동 build, repair와 shared asset

### 목표

기존 `작도 자산(개발)` 패널의 명시적 종목×interval action으로 exact-240을 감사·수리하고
공통 CzardasPack을 PostgreSQL latest row에 upsert/delete한다. asset GET은 read-only이고
모든 사용자는 같은 저장 제안을 받는다. 자동 갱신은 만들지 않는다.

### 변경 파일

```text
systems/api-server/pods/api-server/gops-backend/app/routes/chart_assets.py
systems/api-server/tests/test_czardas_asset_routes.py
systems/market-data/shared/alfaka/serving/clickhouse_provider.py
systems/market-data/shared/alfaka/analytics/analysis_candles.py
systems/market-data/shared/alfaka/analytics/analysis_repair.py
systems/market-data/shared/alfaka/serving/session_buckets.py
systems/market-data/tests/test_czardas_repair_snapshot.py
systems/agent-orchestration/jobs/chart-asset-migrations/004_czardas_assets.sql
systems/agent-orchestration/jobs/chart-asset-migrations/main.py
systems/agent-orchestration/shared/gops_agents/czardas_assets/storage.py
systems/agent-orchestration/shared/gops_agents/czardas_assets/builder.py
systems/agent-orchestration/shared/gops_agents/czardas_assets/envelope.py
systems/agent-orchestration/shared/gops_agents/czardas_assets/job_store.py
systems/agent-orchestration/pods/czardas-asset-builder/main.py
systems/agent-orchestration/tests/test_czardas_asset_storage.py
systems/agent-orchestration/tests/test_czardas_asset_builder.py
apps/gops-frontend/src/chart/assetBuildApi.ts
apps/gops-frontend/src/chart/analysisAssetsApi.ts
apps/gops-frontend/src/components/ChartAssetOpsPanel.tsx
apps/gops-frontend/src/components/ChartPanel.tsx
apps/gops-frontend/tests/chartRuntime.test.ts
docker-compose.yml
infra/docker/Dockerfile.gops-agent-orchestrator
infra/k8s/base/job-chart-asset-migrations.yaml
infra/k8s/base/app/deployment-czardas-asset-builder.yaml
infra/k8s/base/app/configmap.yaml
infra/k8s/base/app/kustomization.yaml
infra/k8s/overlays/aws/configmap-aws-patch.yaml
```

배포 파일은 authenticated on-demand worker를 실제로 켤 때만 추가·수정한다. CronJob,
market-event consumer, duplicate candle client나 전역 Geometry feature flag를 만들지 않는다.

### 구현 순서

1. frozen `MarketTimeContract`를 만들고 UTC instant, `America/New_York` session/calendar,
   `1D` session date, `1W` Monday market-week key와 `[start,end)` 범위를 한 곳에 고정한다.
2. env와 무관하게 `v2/split/regular/closed` policy columns를 SELECT/검증하는
   `canonical_completed_rows()`와 latest target key 240개 audit를 구현한다.
3. `1W` direct coverage가 부족하면 canonical daily 최대 1,300개만 읽어 bounded aggregation한다.
   intraday repair는 Alpaca 1Min regular-session 원본과 실제 session bucket을 사용한다.
4. chart fill과 Czardas가 공유할 expected-key, missing-range planner, Alpaca fetch,
   canonical materializer, aggregation leaf primitive를 정리한다. 두 상위 service가 서로를
   import하지 않게 한다.
5. audit에 missing head/interior/tail key가 있으면 exact range만 Alpaca에서 받아 ClickHouse에
   materialize하고 같은 canonical reader로 반드시 다시 읽는다. synthetic filler는 없다.
6. newest exact 240과 `asOf/lastCandleKey/inputDigest`가 확정된
   `CzardasCompletedSnapshot`만 CandleTape로
   변환한다. audit/repair round는 최대 2회다.
7. `004_czardas_assets.sql`에 `(symbol,interval)` latest asset과 Czardas 전용 jobs/items를
   만든다. active-release pointer는 만들지 않는다.
   migration runner는 retired `analysis_assets`를 만드는 001/002를 다시 실행하지 않고
   `003_geometry_assets.sql`, `004_czardas_assets.sql`만 명시 순서로 적용한다.
8. 기존 job lease/cancel/poll과 `FOR UPDATE SKIP LOCKED`를 parameterized 공통 코드로
   재사용하되 Geometry와 Czardas table/store를 분리하고 job ID는 `cza-`로 dispatch한다.
9. `assetKind=czardas` build는 symbols/intervals 각각 하나만 허용한다. panel의 현재 chart
   pair를 기본값으로 쓰며 universe/cross-product build를 거부한다.
10. worker는 exact snapshot으로 kernel과 bounded Field view를 실행하고 upsert 직전
    ClickHouse identity를 다시 읽는다. 바뀌었으면 한 번 재시도하고 다시 바뀌면
    `snapshot_changed_during_build`로 실패한다.
11. storage는 canonical payload bytes/digest, version, exact coverage와 line/Field cap을
    검증한 뒤 monotonic latest upsert를 수행한다. 실패·취소는 기존 성공 row를 보존한다.
12. asset GET/coverage는 PostgreSQL과 ClickHouse를 read-only로 결합해
    current/stale/missing/incompatible를 반환하고 miss/stale에서 job을 만들지 않는다.
    current identity를 증명하지 못하면 stale이며 chart candle API 계약은 바꾸지 않는다.
13. stale drawing은 낮은 opacity와 as-of badge를 허용하지만 stale Field는 숨기고
    `수동 재분석 필요`를 보인다.
14. 현재 API `limit`이 live도 count하므로 지원 interval의 initial request budget은 최대
    241로 두고 response를 **latest completed 240 + optional live 1**로 정규화한다. 이는 분석
    reserve가 아니라 live 운반용 1-row overscan이다. 최초 viewport는 기존 1m~1D 120,
    1W 104를 유지하고 context count가 minimum visible count나 viewport width가 되지 않게
    분리한다. `1M`은 기존 동작을 유지한다.
15. 패널에 Czardas kind의 분석·저장, progress/log, cancel, delete를 연결한다. 성공/delete 뒤
    요청한 client의 해당 kind+symbol+interval cache만 invalidate/refetch한다.
16. current Geometry worker/table/API 기본 동작을 그대로 유지하고 자동 build, schedule,
    event refresh, cross-client push를 추가하지 않는다.

### API 테스트

- `assetKind`를 생략한 GET/build/status/cancel/delete가 current Geometry와 byte/behavior
  compatible하다.
- unauthenticated Czardas build/cancel/delete는 거부하고 GET/coverage의 기존 auth 의미는
  바꾸지 않는다.
- Czardas build는 symbol 하나×interval 하나만 받고 empty, cross product, universe request를
  거부한다.
- POST는 `cza-` job을 등록할 뿐 client payload JSON을 asset으로 쓰지 않는다.
- asset GET/coverage의 current/stale/missing/incompatible 판정이 저장 row와 현재 snapshot
  identity에서 결정되며 kernel, repair, PG write와 job enqueue가 모두 0회다.
- 같은 stored identity를 읽는 모든 사용자 payload가 byte-identical하다.
- stale response는 명시적 freshness/as-of와 byte-identical stored pack을 유지한다. pack 안의
  Field bytes를 삭제하지 않되 client renderer가 Field primitive를 0개 그린다.
- build success/delete terminal poll 뒤 requesting client만 해당 kind+symbol+interval을
  refetch하고 다른 client push가 없다.
- cancel은 running item을 안전하게 끝내고 기존 successful asset을 보존한다.
- delete는 지정한 Czardas pair만 지우고 Geometry row와 user-owned drawing을 건드리지 않는다.
- Candle/Line/OHLC/Bid/Ask/Czardas 전환은 같은 current asset을 재사용하고 추가 request,
  kernel 또는 job을 만들지 않는다.
- 지원 interval initial request가 latest 240 completed context와 live 최대 1개만 보관하면서 viewport는
  120/104이고 pan/zoom clamp도 context count를 presentation minimum으로 오해하지 않는다.
- live 유무와 무관하게 completed count가 정확히 240이며 241번째 completed row는 가장 오래된
  context로 제거된다.
- `1M` initial request와 viewport 계약은 변하지 않는다.
- chart open, asset miss, `CANDLE_CLOSED/CORRECTED`, reconnect와 focus가 Czardas build route를
  호출하지 않는다.
- 위 경우에도 기본 candle query의 기존 on-demand Alpaca fill 계약은 그대로 동작하며
  Czardas asset path가 그 상위 service를 직접 호출하지 않는다.

### storage/build 테스트

- schema interval, Field 32 KiB, payload 64 KiB, H-Line 4/Trend 3/transport 7 constraint.
- Field view cap이 selected source mode와 initial formation을 보존하고 omitted count를 정확히
  기록하며 raw hypothesis/full debug trace를 payload에 싣지 않음.
- `(symbol,interval)` latest row에 algorithm/config/time/calendar version과 exact
  `asOf/lastCandleKey/inputDigest`가 함께 저장됨.
- older as-of upsert가 최신 shared proposal을 덮지 않고 same identity/same digest는 no-op임.
- same algorithm/config/time/calendar/as-of/input digest의 다른 payload digest는 invariant error.
- payload digest/bytes가 application canonical JSON 기준이며 JSONB key order에 무관함.
- builder wall-clock이 달라도 `CzardasPackContent` digest/bytes는 같고 `generated_at` DB
  column/API envelope만 달라질 수 있음.
- `-0`, float 8자리, UTC timestamp, array/reason order가 canonical serializer 하나에서
  byte-stable함.
- job claim이 `FOR UPDATE SKIP LOCKED`를 사용.
- canonical reader가 env와 무관하게 v2/split/regular/closed를 SQL에서 강제함.
- 241개 이상 source에서는 newest 240개만 선택하고, repair 뒤 239개나 하나의 unresolved
  head/interior/tail gap이라도 있으면 kernel/upsert가 0회임.
- exact missing ranges만 Alpaca에 요청하고 provider rows를 직접 kernel에 넘기지 않으며
  ClickHouse postwrite re-read digest와 저장 digest가 일치함.
- chart fill이 먼저 채운 row를 Czardas가 재사용하고 Czardas가 채운 row를 다음 chart query가
  재사용함. 두 상위 service import는 없음.
- `5m/10m/1h/4h` repair가 Alpaca 1Min과 실제 session bucket end를 사용하고 조기폐장을
  고정 `+240m`로 만들지 않음. `1W`는 daily `<=1300`만 사용하고 1m fallback이 없음.
- DST 전후, 미국 휴장·조기폐장, UTC midnight, KST 날짜 경계에서 같은 market session key와
  `[start,end)` range를 재현함. naive/fixed-offset datetime은 validation에서 거부됨.
- New York 정규장 첫 intraday bucket이 summer `13:30Z`, winter `14:30Z`이고 `1D` market
  midnight timestamp가 각각 `04:00Z/05:00Z`임. 조기폐장 마지막 4h bucket은 실제 session
  close에서 끝남.
- repair audit round가 2회를 넘지 않고 계속 변하는 latest identity는
  `snapshot_changed_during_build`로 실패함.
- credentials/network/rate-limit/provider-confirmed-empty/신규상장 이력 부족 실패가 stable
  reason을 남기고 기존 asset을 보존함.
- 동시 수동 build 1/4/16개에서도 한 pair lease가 직렬화되고 최종 row가 가장 최신 성공
  snapshot과 일치함.
- current `geometry_assets`, `geometry_build_jobs/items`가 migration/build에서 수정되지 않음.

### 성능 기준

- kernel P95 `<=50ms`, P99 `<=80ms`; stretch P95 `<=25ms`.
- current Czardas asset GET P95 `<=100ms`.
- exact ClickHouse hit·repair 없음·queue 제외 manual build P95 `<=750ms`.
- Field를 포함한 pack이 `<=64 KiB`이며 chart type 전환 foreground I/O는 0회.
- 완료 job을 패널이 관측한 뒤 kind-scoped refetch+delta P95 `<=500ms`.
- asset GET의 동기 PG write/job enqueue 0회.
- Alpaca latency는 합격선에서 제외하고 exact range 수, provider/materialized row, repair round,
  postwrite re-read를 측정한다.

### 수동 검증 gate

v1은 production 자동 rollout을 정의하지 않는다. 구현 검증은 다음 순서다.

1. **offline**: synthetic/market fixture의 chronological Field와 drawing 평가.
2. **local manual**: 개발 패널에서 명시한 symbol×interval 하나를 분석·저장하고 row/pack 확인.
3. **repair/time**: intentional gap, DST, 휴장, 조기폐장 fixture에서 exact repair 검증.
4. **chart**: current/stale/no-draw와 H-Line/Trend toggle, Czardas landscape를 시각 검증.
5. **internal manual**: 제한된 실제 종목·interval을 사람이 반복 upsert/delete하며 품질과
   성능을 기록한다.

각 단계에서 다음을 만족한다.

- unavailable/error rate가 기존 chart render 가용성을 낮추지 않음.
- P95/P99와 payload gate 통과.
- future leakage violation 0.
- primitive overflow 0.
- user-owned overwrite/delete 0.
- 운영자가 symbol/interval별 no-draw와 reject reason을 확인 가능.
- 자동 job enqueue와 cross-client push 0.
- repair 후 exact-240이 아니면 asset upsert 0.

### rollback

- frontend의 Czardas assetKind/renderer를 끄고 current Geometry layer를 계속 사용한다.
- `/api/charts/candles`는 변경하지 않았으므로 되돌릴 candle 계약이 없다.
- current `geometry_assets`, worker와 read route를 그대로 유지한다.
- `czardas_latest`를 drop하지 않고 Czardas reader/on-demand worker만 끈다.
- schema rollback보다 application rollback을 우선한다.

## 4. Inference Field, production view와 debug 경계

`field.py`의 Inference Field는 H-Line ridge와 Trend mode를 만드는 kernel 계산 자체다.
`field_view.py`는 그 결과를 32 KiB 안으로 줄이는 read-only serializer이고, 다섯 번째
`Czardas` renderer는 DTO를 pixel로 옮길 뿐이다. Milestone 1부터 같은 시각 문법을 개발
관측 도구로 쓰고 Milestone 5에서 제품화한다.

production pack에는 다음만 넣는다.

- role별 capped Basis glyph.
- exact H-Line SeedResponse segment와 all-or-none estimated profile bins.
- selector 전 H-Line response mode와 Trend mode ribbon.
- Trend mode별 bounded representative hypothesis thread.
- selected Boundary의 source mode reference.
- selected Boundary의 최초 formation, 최신 fit/Interaction validation glyph.
- 선택된 Triangle relation glyph와 생략한 fact count.

mode 정렬은 selector membership을 입력으로 삼지 않는다. 다만 selected source mode는 cap의
마지막 mode를 교체해 referential integrity를 보존한다. no-draw에서도 weak/opposed Field가
보이며 selector를 끈 run과 pre-selection mode digest가 같아야 한다.

모든 raw hypothesis와 contributor edge, 거절 mode 전체, 과거 revision, full penetration
ledger와 모든 interaction은 evaluator용 full debug trace에 남긴다. 별도 public Field API,
Redis/S3 asset, frontend OHLCV 재추론은 만들지 않는다. stale asset의 Field는 숨긴다.
개별 mark를 typed source로, aggregate mode를 derivation digest로 재현할 수 없거나 final
drawing이 `sourceFieldModeId+sourceFieldRevision` geometry와 겹치지 않으면 스타일을 보충하지 말고 kernel
Field/provenance 계약을 먼저 수정한다.

## 5. calibration 규칙

초기 threshold는 `ENGINE_SPEC.md`의 값을 그대로 쓴다. 구현 도중 특정 fixture를
통과시키려고 즉석 상수를 넣지 않는다.

threshold 변경 절차는 다음과 같다.

1. 실패를 새 fixture와 reason으로 재현한다.
2. 바꿀 config key와 기대 trade-off를 기록한다.
3. 전체 golden/no-lookahead/performance suite를 실행한다.
4. false-positive와 no-draw 변화까지 비교한다.
5. 의미가 달라지면 `configVersion`을 올린다.
6. 계약 자체가 달라지면 `ENGINE_SPEC.md`를 같은 change에서 수정한다.

학습 모델이나 자동 threshold 최적화는 v1에 넣지 않는다. 먼저 deterministic baseline의
실패를 설명할 수 있어야 한다.

## 6. 완료 정의

czardas v1은 다음이 모두 참일 때 완료다.

- 한 Python kernel이 builder와 fixture evaluator에서 재사용된다.
- H-Line과 Trend는 formation 2회로 formed가 되고 이후 독립 반응은 verification
  bonus로 기록된다.
- OHLCV 이외 지표 없이 규격의 품질 fixture를 통과한다.
- manual job이 newest completed exact-240 전체를 analysis input으로 쓰고 stored proposal이
  그 `asOf/inputDigest`를 보존한다.
- 인증된 개발 패널의 명시적 action에서만 재계산하며 chart open, 새 완료봉, correction,
  viewport/tick/focus는 job을 만들지 않는다.
- H-Line 최대 4개와 Trend 최대 3개의 설명 가능하고 편집 가능한 drawing을 독립
  layer의 stable-ID delta로 적용한다.
- 좌측 하단의 H-Line/Trend 두 버튼과 3단계 선 두께 편집, Triangle 강조/badge가
  visual test를 통과한다.
- `Czardas`가 Candle/Line/OHLC/Bid/Ask 옆의 다섯 번째 chart type으로 동작하며 `1M`에서는
  disabled이고 interval을 자동 변경하지 않는다.
- Czardas Field가 selector 전 Basis, H-Line response, Trend hypotheses/modes를 같은
  snapshot/좌표에서 보여주고 최종 drawing이 source mode와 `<=0.5 device pixel`로 겹친다.
- 개별 Field primitive orphan은 0, aggregate mode derivation 재현율은 100%이며 chart type
  전환은 API·kernel·drawing delta를 만들지 않는다. no-draw에도 Field가 남는다.
- production Field `<=32 KiB`, 전체 pack `<=64 KiB`, Field paint P95 `<=8ms`를 지킨다.
- 첫 사용자 편집 이후 engine이 해당 drawing을 덮지 않는다.
- 사용자 편집·toggle·suppression은 서버에 저장되지 않고 reload 시 공통 제안으로 돌아간다.
- ClickHouse missing range는 Alpaca로 exact repair하고 UTC/NYSE/DST 계약으로 재조회한
  exact-240이 아니면 kernel/upsert를 실행하지 않는다.
- PostgreSQL은 모든 사용자에게 동일한 latest proposal을 제공한다. asset GET은
  current/stale/missing/incompatible 모두 read-only이며 build job은 패널 POST만 만든다.
- 성능, 결정론, 명백한 no-lookahead, payload gate가 CI와 benchmark에서 재현된다.
- current Geometry는 이 구현에서 유지하며 은퇴는 별도 change로 결정한다.
- 세 문서와 구현이 같은 계약을 말한다.

## 7. 문서 동기화 체크리스트

구현 PR마다 확인한다.

- engine 의미/수식/config 변경: `ENGINE_SPEC.md`.
- milestone/file/test/rollout 변경: 이 문서.
- 제품 설명, 강점, 한계, 범위 변경: `README.md`.
- candle API 계약 변경: `CHART_DATA_ARCHITECTURE.md`와 관련 backend/frontend 문서.
- chart type, Field renderer, layer 표시 계약 변경: `AGENT_FRONTEND_INTEGRATION.md`와
  `CHART_DATA_ARCHITECTURE.md`.
- PostgreSQL schema/runtime 변경: `platform/postgres/README.md`와 AWS 문서.
- 현재 Geometry가 은퇴하면 current-vs-target 경계 문구와 문서 index를 정리.

별도 decision log를 만들지 않는다. 현재 결론은 세 문서에 녹이고 변경 이력은 Git이
보존한다.
