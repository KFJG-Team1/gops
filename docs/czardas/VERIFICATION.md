# Czardas Verification

이 문서는 Czardas의 영구 release·운영 gate다. 특정 commit의 테스트 개수나 일회성 merge 상태는
기록하지 않는다. 수치 한도와 불변 계약을 변경할 때는 kernel, pack schema, frontend validator와
이 문서를 같은 변경에서 갱신한다.

## 1. Kernel과 수치 계약

- 동일 exact-240을 100회 실행했을 때 canonical content bytes와 digest가 모두 같다.
- 입력 순서와 hash iteration 순서가 결과를 바꾸지 않는다.
- q8 같은 양자화점의 입력은 같은 input/inference/content identity를 갖고 양자화점을 넘는 변화는
  input digest를 바꾼다.
- production config는 exact-240과 sealed parameter 계약을 거부 없이 통과하고 239/241봉 또는
  변경된 production config는 거부한다.
- live candle과 post-`asOf` row가 feature, fact, Field, 설명과 provenance에 0개다.
- 모든 structural fact가 `observedAt <= confirmedAt <= asOf`를 만족한다.
- 240 CandleMeaning이 같은 `evaluationAsOf`를 공유하고 factor/reason codebook reference에 orphan이
  없다.
- 우측 확인 문맥이 부족한 extrema는 Basis가 아니며 pending reason만 남긴다.
- 가격 평행이동과 양수배에서 구조가 일관되고 zero ATR/volume에서도 유한한 값을 낸다.
- isolated wick 영향은 bounded이고 지속 body/close penetration은 더 큰 integrity 손실을 낸다.
- volume-only 변경 전후 Trend와 RegressionFlow semantic slice가 byte-identical하다.

## 2. 구조·선택·provenance gate

- Ready pack의 H-Line은 `1..4`이며 최소 하나는 dominant PriceMemory다.
- Trend는 `0..3`, Pattern은 `0..2`, boundary drawing은 최대 7, managed drawing은 최대 9다.
- exact 2/2 출력은 합격 기준이 아니다. hard-valid 구조가 없으면 Trend와 Pattern abstention을
  허용한다.
- 선택 mode→domain→Basis→episode→interaction→relation→trace closure의 orphan이 0개다.
- 투영된 structural domain의 모든 `parentId`가 같은 Field에 있고 interaction corridor의 부재는
  `corridorLow: null`, `corridorHigh: null`로 명시된다.
- selected Pattern과 managed polyline은 1:1이고 모든 anchor가 PatternTrace fact와 일치한다.
- Pattern이 없을 때 Pattern 이름과 managed polyline도 0개다.
- PatternEvidence는 이름과 drawing을 만들지 않고 closure 전체가 원자적으로 포함·생략된다.
- Flag와 Pennant impulse는 consolidation보다 앞서며 같은 boundary는 하나의 presented relation에만
  포함된다.
- boundary drawing은 candidate provenance, Pattern drawing은 relation provenance를 사용한다.
- user/LLM actor의 managed ownership, provenance와 `czardas:` ID 위조를 executor가 거부한다.

## 3. 크기와 성능 gate

| 항목 | hard gate |
| --- | --- |
| kernel corpus P95 | `<=50ms` |
| kernel corpus P99 | `<=80ms` |
| Field JSON | `<=80 KiB` |
| 전체 pack JSON | `<=96 KiB` |
| frontend parse+stable-ID delta P95 | `<=8ms` |
| Czardas Field paint P95 | `<=8ms` |
| Field/drawing 좌표 오차 | `<=0.5 device pixel` |

mandatory Field bundle이 크기 한도를 넘으면 build는 실패해야 한다. CandleMeaning 또는 selected
derivation closure를 잘라 partial pack을 저장해서는 안 된다.

## 4. chart runtime gate

- H-Line, Trend, Pattern toggle이 독립적이고 Shared 의미는 항상 유지된다.
- 일반 chart type에 Czardas toggle, Field와 hover가 나타나지 않는다.
- 확대/축소 시 candle 의미, 국소 PriceMemory, OLS, boundary, PatternTrace와 최종 drawing의 의미가
  범례·hover와 일치한다.
- exact-240 전체 pan/zoom과 우측 빈 공간에서 모든 data-space primitive가 candle과 함께 이동한다.
- Pattern polyline의 draft, Enter/double-click 완료, Backspace, Escape, touch 완료·취소, 모든 segment
  hit-test, vertex/path drag와 undo/redo가 동작한다.
- first edit fork, suppression, restore와 reload 시 공용 제안 복원이 candidate/relation 단위로 동작한다.
- stale 또는 input digest mismatch에서 Field, hover와 Czardas 해설을 숨긴다.
- hover는 factor raw/normalized 값, 모든 reason, availability와 usage를 접기·스크롤 없이 보여준다.
- LLM chart proposal은 polyline과 internal `chart.czardas.*` command를 실행할 수 없다.

## 5. API·repair·저장 gate

- GET은 repair, kernel, enqueue, PostgreSQL write를 수행하지 않는다.
- build POST는 `Idempotency-Key`와 한 pair만 허용한다.
- 동일 owner/key/body idempotency, 같은 owner/pair/force coalesce, pair busy, owner status/cancel,
  terminal cancel과 active-build delete 계약을 검증한다.
- chart-open, asset GET, candle event와 Cron이 생성한 build job은 0개다.
- 239/240/241, head/interior/tail gap, DST, 휴장, 조기폐장, UTC/KST 경계와 weekly aggregation을
  검증한다.
- repair 실패를 `credentials_missing`, `provider_empty`, `provider_failed`,
  `canonical_reread_incomplete`로 구분하고 외부 예외 원문과 secret을 저장하지 않는다.
- pre-commit audit에서 snapshot이 바뀌거나 exact-240을 만들지 못하면 write는 0이고 기존 successful
  asset을 유지한다.
- 동일 pair critical section 동시성은 1이며 cancel-before-commit은 새 pack을 남기지 않는다.
- 모든 사용자에게 전달되는 deterministic content bytes가 같다.

## 6. 수동 build 운영

`작도 자산(개발)` 패널은 로그인 사용자가 한 번에 정확히 한 `symbol×interval`을 build, 조회 또는
삭제하는 운영 도구다.

1. 대상 symbol과 지원 interval 하나를 선택한다.
2. build를 한 번 제출하고 반환된 `cza-` job만 polling한다.
3. terminal 성공 후 GET entry의 freshness, `asOf`, input digest와 pack version을 확인한다.
4. chart type을 Czardas로 바꿔 Field, H-Line, Trend, Pattern, hover와 편집을 확인한다.
5. 실패 시 reason code와 canonical coverage를 확인한다. 자동 재build를 만들지 않는다.
6. delete는 선택한 pair 하나에만 적용하며 active build 중에는 실행하지 않는다.

수동 build는 PostgreSQL queue와 `czardas-asset-builder`만 사용한다. Redis, S3, Kafka, LLM과
자동 schedule은 이 경로에 참여하지 않는다.

## 7. Geometry negative gate

다음 legacy 분석 runtime은 source, API registration, UI registry와 배포 manifest에 존재하면 안 된다.

```text
alfaka.analytics.geometry / levels / patterns / pivots
gops_agents.chart_assets
analysis_candles / analysis_repair
assetKind=geometry / assetVersion=geometry / cab-
/api/charts/analysis-assets
chart-asset-builder / Geometry Cron / Geometry fallback
chartPatternList
```

허용되는 예외는 dormant DB의 read/write 금지 문서, old endpoint 404 음성 테스트, 일회성 legacy
철거 script와 일반 `drawingGeometry`·`panelGeometry` 유틸리티뿐이다. dormant Geometry table을
자동 생성, 읽기, 쓰기, fallback 또는 rollback engine으로 사용해서는 안 된다.

## 8. 표준 검증 명령

Repository root에서 실행한다.

```sh
.venv/bin/python -m pytest -q systems/market-data/tests/analytics/czardas
.venv/bin/python -m pytest -q systems/agent-orchestration/tests -k czardas
.venv/bin/python -m pytest -q systems/api-server/tests -k czardas
```

Frontend 검증:

```sh
cd apps/gops-frontend
npm run test:chart
npm run test:layout
npm run build
npm run test:bundle-size
npx playwright test tests/visual/czardas-assets.spec.ts
```
시장데이터, API, order와 관련 shared chart 변경이 있으면 해당 전체 회귀도 실행한다. k8s 또는
runtime manifest가 바뀐 변경은 AWS와 AWS-incluster overlay를 모두 render하고 Geometry negative
gate를 다시 확인한다.
