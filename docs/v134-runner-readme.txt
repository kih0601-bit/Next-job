Next Job v134 실행본

교체 대상:
- v2-prototype/**
- .github/workflows/nextjob-v2-benchmark.yml

GitHub Secrets:
1) DATA_GO_KR_SERVICE_KEY
2) OPENAI_API_KEY

실행:
Actions > Next Job v2 Benchmark > Run workflow > phase=capture > Run workflow

주의: 첫 capture는 진짜 블라인드 시험의 입력/예측 생성 단계다. 정답지가 아직 봉인되지 않았으므로 정확도 점수는 만들지 않는다. Artifact를 파트너가 노아에게 전달하면 원문 기준 Ground Truth를 독립 작성·봉인한 뒤 score 단계로 간다.
