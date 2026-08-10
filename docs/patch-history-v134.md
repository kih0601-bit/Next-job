# v134 — Engine v2 executable benchmark runner
- Cleaneye 전국 수집을 특정 `sidoCd` Secret에 의존하지 않고 공식 시도코드 API를 먼저 조회한 뒤 전 시도를 순회하도록 변경.
- GitHub Actions `Next Job v2 Benchmark` 추가.
- Secrets는 `DATA_GO_KR_SERVICE_KEY`, `OPENAI_API_KEY` 두 개만 요구.
- Capture phase: 2026 공고를 Source별 수집/정규화/분류 후 30건 고정, AI Structured Output 실행, Artifact 생성.
- Score phase: 봉인된 Ground Truth가 있을 때만 채점. 정답지 없이 정확도 숫자를 생성하지 않음.
- False PASS는 사용자 Profile Ground Truth가 추가되기 전 측정된 것으로 표시하지 않음.
