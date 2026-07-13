# Czardas v2 Implementation and Verification Plan

이 문서는 Czardas v2를 변경하거나 검증할 때의 구현 경계와 순서다. 수학과 wire의
authoritative 규격은 [ENGINE_SPEC.md](ENGINE_SPEC.md)다.

## 1. 완료 목표

- `czardas-v2` / `czardas-config-v2` / Field schema 2만 current로 인정한다.
- exact-240 전체를 본 현재 관점으로 CandleMeaning 240개를 만든다.
- 같은 pre-Field 역할값이 sparse RoleBasis 생성에 참여하고, 선택된 경계 관계가 final meaning과
  설명을 만든다.
- H-Line `0..4`, Trend `0..3`, 파생 Triangle과 editable managed drawing을 유지한다.
- Field primitive와 drawing을 timestamp/price에 연결한다.
- 선택된 derivation closure는 projection으로 잃지 않는다.
- Field soft target `76 KiB`, hard limit `80 KiB`, pack hard limit `96 KiB`를 지킨다.
- v1 asset은 incompatible이며 이전 엔진이나 v1 fallback은 없다.

공식 local Python은 repository root `.venv`의 Python 3.12다. 구현 작업은 pull, merge, rebase,
push와 AWS 변경을 포함하지 않는다.

## 2. 구현 원칙

1. Python kernel이 계산의 단일 source of truth다. frontend는 wire 역변환과 paint만 한다.
2. snapshot은 build 시작에 exact-240으로 고정하고 save 직전에 identity를 다시 확인한다.
3. pre-Field meaning은 RoleBasis보다 먼저 계산한다. Composite는 inference에 되먹임하지 않는다.
4. confirmed extrema만 sparse seed가 되지만 integrity와 selected relation은 240봉 전체를 본다.
5. Trend call graph는 volume-only 변경 전후 byte-identical해야 한다.
6. availability가 없는 factor는 null/reason으로 남기며 0 관측값으로 대체하지 않는다.
7. selected closure와 CandleMeaning은 payload 절감을 위해 생략하지 않는다.
8. 특정 symbol이나 한 결과에 맞춘 branch와 threshold를 두지 않는다.
9. no-draw, unavailable, stale, incompatible와 build failure를 구분한다.
10. 기존 Czardas API와 PostgreSQL table shape를 유지한다.

## 3. 구현 순서

### Stage 1 — PresentSnapshot core

대상:

- `systems/market-data/shared/alfaka/analytics/czardas/tape.py`
- `config.py`, `types.py`, `kernel.py`, `numeric.py`

작업:

1. exact closed 240, canonical identity와 OHLCV invariant를 입력 경계에서 검사한다.
2. version을 `czardas-v2`, `czardas-config-v2`, schema 2로 고정한다.
3. `inferenceId`를 version/time/calendar/symbol/interval/asOf/inputDigest에서 만든다.
4. mode는 current `derivationDigest`, candidate는 `evidenceState`와 fact watermark만 가진다.
5. current snapshot identity와 fact time만 두고 과거 엔진 상태 field/code를 두지 않는다.
6. drawing `createdAt/updatedAt`은 wall clock이 아니라 `asOf`를 쓴다.

Gate:

- 239/241, duplicate, live와 malformed OHLCV가 Ready를 만들지 않는다.
- 동일 canonical input 100회 content bytes/digest가 같다.
- public Python/JSON/TypeScript shape에 revision/history field가 없다.
- v1 pack은 incompatible이고 adapter나 fallback이 없다.

### Stage 2 — 전봉 CandleMeaning과 Evidence

대상:

- `features.py`, `meaning.py`, `evidence.py`

작업:

1. ATR14, body/wick, close return, trailing volume20을 SoA로 계산한다.
2. 모든 candle에 range/return/body/wick, volume과 local high/low `R2/R5/R13` factor를 만든다.
3. factor별 exact-240 median/MAD normalization과 availability mask를 계산한다.
4. 실제 weighted formula로 Shared, support/resistance, lower/upper pre-Field 의미를 만든다.
5. pre-Field 역할값 20%와 구조 feature 80%를 결합해 RoleBasis mass를 만든다.
6. radius `2/5/13`의 full right context로 확인된 extrema만 EvidenceAtom/RoleBasis로 승격한다.
7. 실제 RoleBasis bar에만 방향별 factor→geometry reason을 붙인다.
8. 끝단 미확정 extrema는 `confirmation_pending` reason만 남긴다.
9. H-Line participation multiplier는 `0.90..1.00`; Trend는 volume을 읽지 않는다.

Gate:

- CandleMeaning의 candle key/timestamp/summary/role/mask column이 모두 240개다.
- factor key는 ENGINE_SPEC의 21개와 정확히 같다.
- ATR/volume 준비 전 raw/normalized가 null이고 availability/reason이 존재한다.
- in-snapshot 오른쪽 문맥 변경이 앞 candle의 현재 의미를 바꿀 수 있다.
- observed/confirmed fact는 `observedAt <= confirmedAt <= asOf`다.
- zero ATR/volume에서 non-finite 값이 없고 no-draw Ready가 가능하다.
- volume-only 변경 전후 Trend pre-Field와 RoleBasis bytes가 같다.

### Stage 3 — current H-Line, Trend와 interaction

대상:

- `hline.py`, `trend.py`, `interactions.py`, `rank.py`, `select.py`, `relations.py`

H-Line:

1. support/resistance RoleBasis corridor를 exact interval sweep한다.
2. point-only overlap을 제외하고 같은 response plateau를 ridge 하나로 합친다.
3. Basis를 FormationEpisode로 압축하고 episode contribution response를 다시 계산한다.
4. weighted median/MAD와 residual floor로 현재 center/zone을 refine한다.
5. all-240 integrity, current open break와 estimated 48-bin profile boost를 적용한다.

Trend:

1. lower/upper anchor를 세 80봉 구간에서 각 최대 4개, role별 전체 최대 12개 고른다.
2. 최소 12봉 떨어진 pair, weighted L-infinity medoid와 current mode를 만든다.
3. weighted pair-slope median과 one-sided intercept scan으로 geometry를 맞춘다.
4. all-240 integrity와 current open break를 적용한다.

공통:

1. `initialFormationEpisodeIds`는 canonical 두 episode다.
2. `fitEvidenceConfirmedAt` 다음 index부터 interaction을 시작한다.
3. 3/5/8봉 horizon에서 `response_pending | neutral_response | supported_response |
   confirmed_break`만 만든다.
4. current reject는 마지막 두 close의 `0.25 ATR` open break다. 과거 break를 영구 상태로
   저장하지 않는다.
5. selected boundary에 대해 240개 proximity/residual/penetration/reclaim factor와
   phase/reason attribution을 계산한다.
6. H-Line/Trend 선택이 끝난 뒤에만 Triangle 관계를 계산한다.

Gate:

- H-Line ridge, plateau, episode separation과 weighted refine hand fixture가 통과한다.
- Trend anchor가 세 구간을 대표하고 medoid/intercept tie-break가 결정론적이다.
- selected fit episode와 response scan의 time domain이 겹치지 않는다.
- isolated wick은 core geometry를 과도하게 움직이지 않는다.
- persistent body/close penetration과 최신 두 close break는 후보를 약화/거부한다.
- 과거 break 뒤 현재 회복은 영구 open break가 아니다.
- Trend meaning/Field/geometry/rank의 volume-only bytes가 같다.
- H-Line `<=4`, Trend `<=3`; 근거 없는 quota filling이 없다.

### Stage 4 — compact Field와 pack projection

대상:

- `meaning.py`, `field_view.py`, `compiler.py`
- `shared/chart-contract/chart-czardas-pack.schema.json`

factor transport:

1. summary/role는 scale 1000 integer arrays로 저장한다.
2. raw/normalized factor는 factor별 signed int16 big-endian base64 SoA로 저장한다.
3. raw factor별 v2 scale 1000, `linear | log1p` transform, inverse range와 overflow policy를 함께 보낸다.
4. `-32768`을 null sentinel로 쓰고 overflow는 build failure로 처리한다.
5. reason은 uint32 big-endian `reasonMasks` 240개와 codebook으로 저장한다.

selected closure:

1. `basisFacts`에 selected mode contributor와 fit episode의 모든 Basis를 넣는다.
2. selected mode `contributorBasisIndexes`가 `basisFacts`의 전 contributor를 가리키게 한다.
3. flattened episode의 `candidateEpisodeOrdinals`가 boundary `fitEpisodeIds` ordinal을 가리키게
   한다.
4. contribution/member Basis index, selected mode refs, validation과 drawing provenance를 잇는다.
5. `basisGlyphs`는 대표 paint subset으로만 사용하고 mandatory source로 취급하지 않는다.

projection:

1. 76 KiB를 넘으면 profile 전체, extra hypothesis, basisGlyphs, H-Line response, 비선택 mode
   순으로 줄인다.
2. actual omitted count와 `truncated`를 기록한다.
3. CandleMeaning, basisFacts, selected mode/episode closure와 selected validation은 제거하지 않는다.
4. projection 후 Field 80 KiB 또는 pack 96 KiB를 넘으면 partial Ready 대신
   `payload_limit_exceeded`를 반환한다.

Gate:

- 각 factor blob decode 크기 480 bytes, reason blob 960 bytes.
- per-factor transform/scale로 raw inverse가 quantization tolerance 안에서 복원된다.
- selected mode의 contributor count와 contributor index 수가 같고 orphan이 없다.
- 모든 episode SoA column 길이가 같고 ordinal/index가 유효하다.
- basisGlyphs를 전부 생략해도 selected closure가 유지된다.
- optional projection 순서와 omitted count가 deterministic하다.
- mandatory overflow는 저장 가능한 partial pack을 만들지 않는다.

### Stage 5 — timestamp renderer와 hover

대상:

- `apps/gops-frontend/src/chart/czardasAssetsApi.ts`
- `apps/gops-frontend/src/chart/czardasMeaning.ts`
- `apps/gops-frontend/src/chart/czardasLayerController.ts`
- chart types, `ChartCanvas`와 `ChartPanel`

작업:

1. validator가 schema 2, 240개 길이, factor/reason blob, identity와 provenance를 검사한다.
2. factor metadata를 사용해 int16을 decode하고 `linear` 또는 `expm1` inverse를 적용한다.
3. candle/Basis/Trend/validation은 timestamp+price, H-Line은 analysis window에 연결한다.
4. normal zoom에서 Shared luminance, H-Line capsule, Trend diamond/chevron을 그린다.
5. dense zoom은 두 branch가 보일 때 Composite percentile로 축약하고, toggle이 꺼지면 Shared와
   현재 보이는 branch만 합성한다.
6. hover/keyboard/mobile tap-lock은 실제 plot 우측 하단에 배경 없는 text overlay를 표시한다.
   `상대 의미도`, 세 channel, role, 21개 raw/normalized factor, availability, phase와 모든 reason을
   접기·스크롤·생략 없이 배치한다.
7. H-Line/Trend toggle은 해당 branch와 managed drawing만 숨기고 Shared를 유지한다.
8. stale/inputDigest mismatch에서는 Field와 hover를 숨긴다.
9. managed first-edit, suppression, restore, Triangle group transaction과 1/2/3px 편집을 회귀시킨다.

Gate:

- pan/zoom/resize/right empty space에서 Field와 source candle/drawing 오차 `<=0.5 device pixel`.
- H-Line primitive가 analysis window 밖으로 연장되지 않는다.
- 240개 모든 candle이 hover/focus 가능하다.
- hover overlay가 가변 가격축·시간축을 침범하지 않고, 328×110부터 desktop panel까지 모든
  factor와 reason을 접기·스크롤 없이 표시한다.
- null factor가 0으로 보이지 않고 reason과 usage가 표시된다.
- 선택 역할 경계가 없어 null인 relation은 `*_boundary_unavailable` reason으로 구분된다.
- frontend가 raw factor나 rank를 자체 재계산하지 않는다.
- cache invalidation 전 늦은 response가 stale Field를 되살리지 않는다.
- parse+managed delta P95 `<=8ms`, Field paint P95 `<=8ms`.

### Stage 6 — delivery, storage와 통합

대상:

- Czardas builder/storage/API와 PostgreSQL migration guard.
- 개발 패널의 한 symbol×interval 수동 build/delete.

작업:

1. storage의 Field/pack byte guard를 `81,920/98,304`로 맞춘다.
2. 기존 table의 named check constraint도 같은 값으로 idempotent하게 갱신한다. table shape는
   바꾸지 않는다.
3. builder가 exact-240 identity를 kernel 전에 고정하고 commit 직전에 다시 읽는다.
4. snapshot 변경, cancel과 determinism arbitration에서 atomic save를 보장한다.
5. GET은 mutation 없이 current/stale/missing/incompatible를 계산한다.
6. v1은 incompatible이고 개발 패널에서 필요한 pair만 수동 재분석한다.

Gate:

- build 중 snapshot 변경은 `snapshot_changed_during_build`, DB write 0.
- cancel-before-commit write 0, same-pair critical section 동시성 1.
- exact-240 불완전이나 repair 실패가 기존 latest 성공 asset을 덮어쓰지 않는다.
- GET에서 repair/kernel/enqueue/write가 0이다.
- 모든 사용자가 같은 deterministic content bytes를 받는다.

## 4. 검증 명령

```bash
PYTHONPATH=systems/market-data/shared:systems/order/shared:systems/order:systems/api-server/pods/api-server/gops-backend \
  .venv/bin/python -m pytest systems/market-data/tests/analytics/czardas

PYTHONPATH=systems/market-data/shared:systems/agent-orchestration/shared:systems/order/shared:systems/order:systems/api-server/pods/api-server/gops-backend \
  .venv/bin/python -m pytest systems/api-server/tests/test_czardas_assets_routes.py

PYTHONPATH=systems/market-data/shared:systems/agent-orchestration/shared \
  .venv/bin/python -m pytest \
  systems/agent-orchestration/tests/test_czardas_asset_storage.py \
  systems/agent-orchestration/tests/test_czardas_builder.py \
  systems/agent-orchestration/tests/test_czardas_delivery.py \
  systems/agent-orchestration/tests/test_czardas_migration.py

npm run test:chart --prefix apps/gops-frontend
npm run test:chart-visual --prefix apps/gops-frontend
npm run build --prefix apps/gops-frontend
```

production-container benchmark는 kernel P95 `<=50ms`, P99 `<=80ms`를 검사한다. shared CI의
machine-noise guard는 이 수치보다 넓을 수 있으므로 production gate를 CI guard와 혼동하지
않는다.

frozen corpus는 AAPL/MSFT/NVDA/TSLA/SPY/TLT와 여러 interval을 쓸 수 있지만 특정 MSFT 선
좌표를 합격 조건으로 삼지 않는다. corpus는 determinism, count, factor 분포, closure, payload와
좌표 일치를 평가한다.

## 5. 실패 계약

| 실패 | 결과 |
| --- | --- |
| exact-240 부족/invalid | `AnalysisUnavailable`; 기존 latest 유지 |
| repair credentials/provider/canonical reread 실패 | sanitized job reason; 기존 latest 유지 |
| build 중 source identity 변경 | `snapshot_changed_during_build`; write 0 |
| factor int16 또는 mandatory payload overflow | build failure; partial 저장 금지 |
| v1 pack | GET `incompatible`; Field/drawing 미적용 |
| stale pack | Field/hover 숨김; 수동 재분석 안내 |
| no candidate | Ready no-draw pack과 240 CandleMeaning 저장 |
| frontend parse/provenance 오류 | pack 전체 미적용; 기본 chart 유지 |

로그에는 symbol, interval, inference ID, input digest prefix, reason code와 byte 수만 남긴다.
secret, provider response body와 전체 OHLCV를 기록하지 않는다.

## 6. 구현 제외

- MA120과 다른 indicator detector/relation.
- 새로운 pattern, linear-regression detector와 drawing tool.
- 자동 갱신, Cron과 candle-event build.
- 사용자 edit/toggle/suppression의 서버 저장.
- Redis/S3/Kafka Czardas asset.
- push, AWS migration, image build와 배포.

AWS 전환은 local final gate와 별도 사용자 승인을 받은 뒤 독립 runbook으로 진행한다.
