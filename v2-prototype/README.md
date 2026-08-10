# Next Job Engine v2 — v134 Benchmark Runner

기존 Production Engine과 분리된 전국형 검증 Prototype.

## 실행 방식
GitHub Actions의 `Next Job v2 Benchmark`를 수동 실행한다.

### Phase A — capture
필요 Secrets는 두 개뿐이다.
- `DATA_GO_KR_SERVICE_KEY`
- `OPENAI_API_KEY`

Workflow가 `gpt-5`를 기본 모델로 고정한다. Cleaneye 시도코드는 별도 Secret 없이 공식 시도코드 API에서 자동 조회하여 전국을 순회한다.

Capture 산출물:
- `selected-30.json` — 고정된 30개 시험공고
- `predictions.json` — AI 구조화 결과
- `source-summary.json` — Source별 수집 현황/오류

## Blind Test 주의
정확한 Blind Benchmark는 Ground Truth를 AI 예측보다 먼저/독립적으로 봉인해야 한다. 따라서 v134는 `capture` 실행으로 시험공고와 예측을 생성하지만, 정답지가 없는 상태에서 가짜 정확도 점수를 만들지 않는다.

Capture Artifact를 받아 별도로 `benchmark/ground-truth/sealed-30.json`을 작성·봉인한 뒤 `score` Phase를 실행한다.

### Phase B — score
봉인 정답지가 저장소에 있을 때만 실행된다. Recruitment Unit, 필수조건 Recall, Evidence 누락 등을 채점한다.
False PASS는 사용자 Profile별 Ground Truth가 추가되기 전에는 측정됐다고 주장하지 않는다.

## 법적 원칙
공식 API 데이터 이용과 개별 첨부문서 재배포 권리를 분리한다. 원문은 분석/근거 링크 중심이며, 재배포 권리는 자동 가정하지 않는다.
