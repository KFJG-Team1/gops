# Czardas v3 Implementation and Verification Plan

이 문서는 v3 변경과 검증의 순서다. 수학과 wire의 단일 규격은
[ENGINE_SPEC.md](ENGINE_SPEC.md)다. 공식 Python은 repository root `.venv`의 3.12다.

## 1. 구현 경계

이번 버전은 다음을 구현한다.

- q8 input seal, explicit canonical provenance와 분리된 identity/content digest.
- semantic-floor normalization, early ATR scale, capped-recency integrity.
- H-Line connected ridge와 Trend contribution/intercept 수정.
- `CzardasInference -> CzardasSightPack` 분리와 Field schema 3.
- 압축된 기본 Sight, 전 factor hover, identity-bound `Czardas 해설`.
- optional interval GET, canonicalSnapshot, idempotent/coalesced manual build와 owner privacy.
- PostgreSQL migration 005와 offline independent-snapshot evaluator.

다음은 제외한다.

- 자동 freshness/build, chart-open/GET/candle-event/Cron trigger.
- Czardas preset, Agent typed reference, MA120과 추가 detector.
- 사용자 edit/toggle/suppression 서버 저장.
- 특정 종목 맞춤 threshold 또는 evaluator 결과의 자동 tuning.
- Geometry fallback, pull/merge/rebase/push, AWS migration/image/deploy 실행.

`작도 자산(개발)` 패널은 유지하며 한 클릭에 정확히 한 symbol×interval만 제출한다.

## 2. 구현 순서

### Stage 1 — input와 numeric trust

대상: `numeric.py`, `config.py`, `tape.py`, `features.py`, `meaning.py`.

1. OHLCV를 q8 HALF_EVEN으로 양자화한 뒤 검증한다.
2. `isClosed/v2/split/regular` 명시를 요구한다.
3. production config의 exact-240/R2·R5·R13/ATR14/volume20/budget을 `validate()`로 잠근다.
4. exact input identity digest와 canonical wire content digest를 분리한다.
5. robust scale에 semantic floor를 적용한다.
6. ATR warm-up geometry에 첫 Wilder seed를 사용한다.

Gate: q8 경계, provenance 누락, 239/241, flat MAD, zero range/volume와 100회 결정론.

### Stage 2 — geometry와 integrity trust

대상: `interactions.py`, `hline.py`, `trend.py`, `types.py`, `compiler.py`.

1. integrity recency mass를 capped simplex로 만들고 nEff/coverage/penetration count를 노출한다.
2. wick/body/close loss를 분리한다.
3. FormationEpisode에 `contributionIndex`를 추가한다.
4. Trend의 모든 anchor 좌표와 scale이 동일 contribution Basis를 사용하게 한다.
5. intercept scan에서 all-240 integrity를 제거하고 최종 probe에서 한 번만 계산한다.
6. H-Line ridge adjacency를 실제 접촉 segment로 제한한다.
7. selection 공식은 유지하고 exact 2/2 golden oracle을 제거한다.

Gate: disconnected ridge, contribution 좌표, isolated wick/persistent penetration,
Trend volume independence와 output upper bound.

### Stage 3 — inference/Sight와 Field schema 3

대상: `kernel.py`, `field_view.py`, pack schema와 backend validator.

1. `infer_czardas()`와 `project_czardas_sight()`를 순수 단계로 분리한다.
2. inference/projection config digest와 두 identity를 pack/Field에 운반한다.
3. selected closure에 contribution indexes와 integrity metrics를 추가한다.
4. optional mode/hypothesis/response/profile cap을 적용한다.
5. 기본 canvas가 쓰지 않는 search space를 pack에 무제한 저장하지 않는다.
6. 실제 budget 절삭 때만 `projection.truncated=true`로 한다.
7. research config의 Sight projection과 저장을 거부한다.

Gate: orphan 0, required identity, schema strict validation, Field/pack `<=80/96KiB`,
v2/null identity incompatible.

### Stage 4 — Sight와 explanation UX

대상: frontend chart types/API/controller/canvas/panel/commentary.

1. Sight v2 detail canvas는 Shared+Trend candle 진하기와 최대 36px의 Shared+H-Line 국소 수평
   흔적만 사용한다. Trend upper/lower candle glyph는 제거하고 ribbon/Basis 색도 통일한다.
2. response/profile/non-selected mode/hypothesis paint를 제거한다.
3. slot width 6px에서 안정적으로 dense 문법으로 전환하고 노란색을 켜진 channel 전체 의미로
   사용한다. hover 폭은 zoom 문법을 바꾸지 않는다.
4. hover 용어를 `240봉 내 전체 의미 백분위`로 통일하고 toggle 옆 범례와 같은 문법을 적는다.
5. 21 factor와 모든 reason/availability/phase를 계속 상시 노출한다.
6. same-candle pointer movement의 state update를 없애고 전체 overlay `aria-live`를 제거한다.
7. keyboard/tap-lock용 짧은 live 안내만 둔다.
8. `Czardas 해설`에 claim/because/against/invalidation/qualifier를 표시한다.
9. chart/commentary/focus를 inference identity와 candidate provenance로 묶는다.
10. server `canonicalSnapshot`으로 panel identity를 확인하고 browser-side Python digest를 제거한다.

Gate: default forbidden paint 0, hover 정보 손실 0, stale mismatch 숨김, pan/zoom `<=0.5px`,
parse/delta와 Field paint 각각 P95 `<=8ms`.

### Stage 5 — manual operation과 storage

대상: API route, job/progress/queue/storage/delivery, migration 005, 개발 패널.

1. GET optional interval과 `freshnessReason`을 추가한다.
2. candle exact-240 응답에 `canonicalSnapshot`을 추가한다.
3. POST에 `Idempotency-Key`를 요구하고 `coalesced`를 반환한다.
4. `submit_once()` 한 transaction에서 idempotency, pair conflict와 job/item insert를 처리한다.
5. 같은 owner/pair/force만 coalesce하고 나머지 active conflict는 409로 한다.
6. status/cancel을 owner-only 404로 제한하고 terminal cancel은 no-op으로 한다.
7. active pair DELETE를 409로 막는다.
8. exception 원문 대신 고정 reason/safe message만 저장한다.
9. migration `004 -> 005`로 identity column과 active/owner index를 추가한다.

Gate: 단일 enqueue, replay/coalesce/busy, owner privacy, terminal bytes 불변, delete race,
GET mutation 0와 자동 trigger 0.

### Stage 6 — offline evaluation

대상: `evaluation.py`와 frozen/synthetic corpus tests.

1. historical `asOf`마다 입력 slice를 새 exact-240으로 구성한다.
2. future rows를 kernel이 아니라 outcome evaluator에만 전달한다.
3. adjacent drift/Field churn, future relation, marginal information과 baseline을 계산한다.
4. response/profile/volume/recency/multi-radius ablation을 보고한다.
5. output/search/bytes/stage latency를 집계한다.
6. research config는 pack으로 project/save할 수 없게 한다.
7. 평가 결과로 threshold를 자동 수정하지 않는다.

Gate: snapshot `asOf` isolation, research non-storable, volume ablation Trend invariant,
thresholdsAutoAdjusted=false.

## 3. 검증 명령

```bash
.venv/bin/python -m pytest systems/market-data/tests/analytics/czardas

.venv/bin/python -m pytest \
  systems/api-server/tests/test_czardas_assets_routes.py \
  systems/agent-orchestration/tests/test_czardas_asset_storage.py \
  systems/agent-orchestration/tests/test_czardas_builder.py \
  systems/agent-orchestration/tests/test_czardas_delivery.py \
  systems/agent-orchestration/tests/test_czardas_migration.py

npm run test:chart --prefix apps/gops-frontend
npm run test:chart-visual --prefix apps/gops-frontend
npm run build --prefix apps/gops-frontend
```

production corpus benchmark gate는 kernel P95 `<=50ms`, P99 `<=80ms`다. corpus는
AAPL/MSFT/NVDA/TSLA/SPY/TLT와 여러 interval을 사용할 수 있지만 특정 종목의 선 좌표를
합격 조건으로 삼지 않는다.

## 4. 저장과 실패 계약

| 상황 | 결과 |
| --- | --- |
| exact-240/canonical contract 불충족 | `AnalysisUnavailable`, 기존 latest 유지 |
| repair/provider/canonical reread 실패 | sanitized reason, 기존 latest 유지 |
| build 중 snapshot 변경 | `snapshot_changed_during_build`, write 0 |
| mandatory Field/pack overflow | partial save 금지 |
| v2 또는 null v3 identity | `incompatible`, 자동 fallback 없음 |
| stale/digest mismatch | Field/hover/해설 미표시 |
| no candidate | 240 CandleMeaning을 가진 Ready no-draw pack |
| frontend parse/provenance 오류 | pack 전체 미적용, 기본 chart 유지 |

## 5. 변경 완료 정의

- kernel, schema, API, storage, frontend가 모두 v3 identity를 사용한다.
- 수동 단일 pair build/delete 패널이 유지된다.
- 자동 build 경로가 존재하지 않는다.
- migration 005는 추가되지만 이번 변경에서 AWS에 적용하지 않는다.
- 기존 dirty worktree와 dormant Geometry DB data를 훼손하지 않는다.
- 위 회귀, byte, 성능과 좌표 gate가 통과한다.
