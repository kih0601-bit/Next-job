# Current Self Diagnostic

## v111 objective
다음 Actions 1회에서 Stage 8의 실제 오류 유형을 최대한 많이 드러내고, 이미 원인이 확정된 복원력 결함은 동시에 수정한다.

## Added diagnostics
- Stage 8 전용 `data/stage8-quality-report.json` 생성.
- low-confidence single, 복수 모집 신호가 있는데 single인 사례, 지원조건 신호가 있는데 Evidence가 0인 사례, 읽을 수 없는 상세/첨부 source를 집계하고 표본을 저장.
- Cache hit/miss/hit-rate를 Stage 8 품질 리포트에서 직접 판정.
- 기존 `qa-report.json`에 Stage 8 checked/status를 별도 기록. 기존 jobs QA와 혼동 금지.
- Pipeline regression은 `PIPELINE_SAMPLE_OK`만 보지 않고 실제 true→false가 발생한 stage를 `regressionCause`로 연결.

## Gate safety
Stage 8은 partial=0/failed=0만으로 자동 종료하지 않는다. 구조 QA와 원문 대조 Benchmark 정확도 검증이 완료되기 전에는 `keep-stage-8-open`을 유지한다.

## Evidence-based fix included
Legacy DOC/XLS에서 LibreOffice TXT export가 생성되지 않으면 즉시 실패하던 경로를 PDF render → pdftotext/OCR fallback으로 보강했다. HWP에서 이미 사용 중인 검증된 원칙을 동일 계열에 적용한 수정이다.

## Next-run decision
다음 실행에서 Stage 8 structured data, structural-warning 유형, 문서 분석 회복 여부, Cache 재사용률을 한 번에 확인한다.
