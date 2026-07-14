# dev → ABC 통합 헌장

이 문서는 알고리즘 명세가 아니라 병합 경계다. Czardas 기술 기준은
`docs/czardas/ENGINE_SPEC.md`가 소유한다.

## 방향

- source: 최신 `origin/dev`
- target: 로컬 `ABC`
- 방식: `ABC`에서 dev를 merge하고 의미 단위로 충돌을 해결한다.
- 공개: 별도 승인 전 push, PR, AWS migration·배포를 하지 않는다.

이번 통합 기준은 ABC `e1812a3`, origin/dev `9b06caf`, merge-base `16e0fa5`다.
merge commit을 만들기 전까지 `MERGE_HEAD`가 유지되는 것은 정상이나, 완료 gate를 통과하지
않은 상태를 배포 가능한 통합으로 부르지 않는다.

## 충돌 원칙

| 영역 | 선택 |
| --- | --- |
| 분석·자동 작도 | Czardas v4만 유지한다. Geometry 코드를 옮기거나 병렬 실행하지 않는다. |
| 일반 제품·Agent·주문·UI | dev 변경을 수용한다. |
| candle/calendar/repair | dev의 운영 개선을 중립 `alfaka.candles` 계약에 수용한다. Czardas는 canonical exact-240만 읽는다. |
| 공용 차트 엔진 | dev 일반 기능 위에 Czardas ownership, Pattern polyline과 세 layer를 재적용한다. |
| Geometry runtime | API, worker, UI, Cron, topic, fallback을 복원하지 않는다. |
| Geometry DB | 기존 데이터만 휴면 보존한다. reader/writer/migration을 두지 않는다. |

파일 전체를 `ours/theirs`로 선택하지 않는다. 특히 `ChartPanel`, canvas, drawing commands,
candle provider와 k8s manifest는 의미 단위로 통합한다.

## Geometry 통찰의 흡수

운영에서 유용했던 Pattern 관계 언어, H-Line reaction/break/reclaim, 가격대 거래 밀도,
무효화 설명과 repair 경험은 행동 명세로만 수용한다. 구현은 Czardas의 PriceMemory,
RegressionFlow, robust Boundary, StructureRelation과 canonical candle 모듈로 다시 만든다.
Geometry detector, pivot, pattern별 OLS, score와 threshold 코드는 재사용하지 않는다.

## 완료 음성 gate

다음은 runtime·API·UI·배포 코드에서 0이어야 한다.

```text
alfaka.analytics.geometry / levels / patterns / pivots
gops_agents.chart_assets
analysis_candles / analysis_repair
assetKind=geometry / assetVersion=geometry / cab-
/api/charts/analysis-assets
chart-asset-builder / Geometry Cron / Geometry fallback
chartPatternList
```

과거 리소스를 명시적으로 철거하는 일회성 script와 old endpoint가 404임을 확인하는 음성
테스트의 문자열은 예외다. 일반 `drawingGeometry` 유틸리티는 분석 엔진이 아니므로 유지한다.

## 현재 통합 순서

1. dev 비분석 변경을 보존한다.
2. 중립 candle import와 배포 이름을 정리한다.
3. Czardas v4 kernel, pack contract와 chart runtime 회귀를 닫는다.
4. Geometry 음성 gate와 전체 회귀를 통과한다.
5. 통합 전 task 임시 stash의 문서 의도를 현재 문서에 반영했는지 확인한 뒤 로컬 merge를 완료한다.
