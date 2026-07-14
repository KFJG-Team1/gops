# Czardas v4 Implementation and Verification

이 문서는 현재 구현 순서와 release gate다. push와 AWS 변경은 별도 승인 범위다.

## Stage 상태

1. **dev → ABC local merge — 검증 완료**
   - dev 비분석 변경을 수용하고 Geometry 분석 경로를 복원하지 않는다.
   - `MERGE_HEAD` 기준 충돌을 의미 단위로 해결했고 로컬 merge commit만 남았다.

2. **v4 Field foundation — 구현됨**
   - q8 exact-240, PresentSnapshot, adaptive StructuralDomainTree.
   - continuous PriceMemory와 domain OLS RegressionFlow.
   - factor/reason codebook과 전봉 CandleMeaning.

3. **domain-aware H-Line/Trend — 구현됨**
   - H-Line baseline memory와 hard candidate 분리.
   - adaptive anchor coverage, robust Trend fit, formation-domain integrity.
   - Trend/OLS volume independence와 OLS consensus/conflict explanation.

4. **StructureRelation/PatternTrace — 구현됨**
   - Triangle, Channel, Rectangle, Wedge, Flag, Pennant 공통 relation grammar.
   - relation-before-selection, Pattern-supporting boundary closure.
   - Pattern `0..2`, fact trace 3~16, relation/polyline 1:1.
   - 미승격 관계 대표 1개의 PatternEvidence와 atomic budget omission.

5. **Field 4/Sight/polyline — 구현됨**
   - H-Line/Trend/Pattern 세 toggle과 OLS/Pattern Field hierarchy.
   - 공용 user polyline 3~32 points, Pattern projection 3~16 points.
   - edit/delete/restore가 candidate 또는 relation 단위로 fork/suppress.

6. **수동 API/data — 유지·통합됨**
   - 단일 pair 개발 panel, Czardas 전용 API/queue/storage.
   - neutral `alfaka.candles` canonical/repair 경계.
   - 자동 build 없음.

7. **최종 cleanup/회귀 — 완료**
   - 문서·infra의 dev Geometry residue 제거.
   - 전체 backend/frontend/kustomize/visual gate와 task 임시 stash의 반영 상태 확인.

## 완료 검증 기록

- market-data: `496 passed, 6 skipped, 35 subtests passed`.
- API: `280 passed, 31 subtests passed`.
- order: `128 passed, 6 skipped`.
- Czardas focused: kernel `63`, agent `57`, API `17` tests passed.
- Czardas kernel 100회 실측: P95 `37.411ms`, P99 `38.154ms`.
- 최대 fixture: Field `79,960 bytes`, pack `94,357 bytes`.
- chart runtime parse+delta P95 `0.788ms`, Field paint P95 `0.400ms`.
- Czardas Playwright visual: `7 passed, 3 skipped`; shared derived-layer 좌표 회귀 `1 passed`.
- frontend build, bundle-size, layout, simulator, AI Coach와 AWS 두 overlay의 kustomize render 통과.
- Geometry runtime 음성 검색과 `git diff --check` 통과.

최신 origin/dev의 빠른주문 visual assertion 한 건은 desktop/mobile에서 실패한다. Czardas와
무관한 구현·테스트는 이 통합의 수정 권한 밖이므로 dev 코드를 그대로 수용하고 실패를 별도
보고한다. 이 항목을 Czardas gate 통과로 위장하거나 threshold 변경으로 숨기지 않는다.

## 필수 gate

### Kernel/contract

- 동일 exact-240 100회 content bytes/digest 동일.
- q8 동일 quantum 동일, quantum 초과 inputDigest 변경.
- post-asOf isolation과 모든 `observedAt <= confirmedAt <= asOf`.
- 240 CandleMeaning과 versioned factor/reason codebook.
- H-Line `1..4`, Trend `0..3`, Pattern `0..2`, drawing `<=9`.
- selected mode→domain→Basis→episode→relation→trace orphan 0.
- Pattern relation/drawing 1:1, anchor가 trace와 동일.
- 미승격 PatternEvidence는 이름/drawing 0이며 provenance closure를 부분 절삭하지 않음.
- volume-only 변경 전후 Trend와 RegressionFlow semantic slice byte-identical.
- isolated wick bounded, 지속 body/close penetration 강한 손실.
- Field `<=80 KiB`, pack `<=96 KiB`.
- corpus kernel P95 `<=50ms`, P99 `<=80ms`.

### Chart runtime

- polyline add/draft/Enter/double-click/Backspace/Escape/touch 완료·취소.
- 모든 segment hit-test, vertex/path drag, undo/redo, snapshot serialization.
- 세 toggle 독립성과 Shared 상시 유지.
- pan/zoom/semantic expansion에서 Field와 drawing 오차 `<=0.5px`.
- stale/digest mismatch 시 Field·hover·해설 차단.
- candidate/relation fork·suppression·restore와 managed provenance 위조 거부.
- LLM polyline proposal 거부.
- parse+delta와 Field paint 각각 P95 `<=8ms`.

### API/operation

- GET mutation, repair, enqueue, PG write 0.
- build 한 클릭 한 pair, idempotency/coalesce/owner/cancel/delete race.
- chart-open, GET, candle event, Cron 생성 job 0.
- repair head/interior/tail gap, credential/provider/reread reason 구분.
- failed build에서 기존 successful asset 보존.

### Geometry 음성 gate

`CZARDAS_DEV_MERGE_PLAN.md`의 목록이 runtime/API/UI/manifest에서 0이어야 한다. cleanup script와
old endpoint 404 테스트만 허용한다.

## 검증 명령

```sh
.venv/bin/python -m pytest -q systems/market-data/tests/analytics/czardas
.venv/bin/python -m pytest -q systems/agent-orchestration/tests/test_czardas_contract.py systems/agent-orchestration/tests/test_czardas_builder.py
.venv/bin/python -m pytest -q systems/api-server/tests/test_czardas_assets_routes.py

cd apps/gops-frontend
npm run test:chart
npm run build
```

이후 market-data, agent-orchestration, API, order 전체 회귀와 kustomize render, Playwright visual
suite를 실행한다. 테스트를 v3 output 위치에 맞추지 말고 v4 불변 계약을 검증한다.

## 범위 밖

- AWS 배포·migration·push.
- 자동 build, Cron, chart-open/candle-event enqueue.
- tick/order-book Volume Profile, MA120 detector, cross-symbol Pattern panel.
- Agent typed reference, LLM polyline, 자동 threshold 최적화.
- 매수·매도 추천과 risk/reward drawing.
- 사용자 Czardas 편집의 서버 저장.
