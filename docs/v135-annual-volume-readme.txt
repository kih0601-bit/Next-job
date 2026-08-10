Next Job v135 - Annual Volume Count (AI cost = 0)

목적
- OpenAI를 한 번도 호출하지 않고 2025년 공식 공공채용 API의 실제 레코드 양을 측정한다.
- JOB-ALIO + Cleaneye + 나라일터를 측정한다.
- 정확 일치 중복 제거, 명백한 결과발표/사전안내/임원공모 분리, AI 분석대상 하한/상한을 계산한다.
- 공고당 1/3/6/10/30/50/100/167원 시나리오의 연간 AI 비용을 자동 계산한다.

실행
1) 이 ZIP을 기존 저장소 root에 덮어쓴다.
2) GitHub Actions > "Next Job v2 Annual Volume Count"
3) Run workflow, year=2025
4) Secret은 DATA_GO_KR_SERVICE_KEY 하나만 사용한다. OPENAI_API_KEY는 필요 없다.
5) 완료 후 Artifact "nextjob-v2-annual-volume-2025"를 내려받아 ChatGPT에 전달한다.

주의
- Cleaneye API는 2026-06 공개 서비스이므로 2025 historical coverage가 없거나 불완전할 수 있다. 0건은 "지방공공기관 채용이 0건"을 의미하지 않는다.
- 중복제거는 기관명+제목+날짜 정확 일치 기반의 보수적 추정이다. 최종 사업용 수량은 Reconciliation 단계에서 재확정한다.
- API 원문/첨부 재배포는 하지 않는다. 이번 패치는 메타데이터/건수 측정만 한다.
