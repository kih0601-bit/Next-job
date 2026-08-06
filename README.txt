Next Job v4.3-strict-target-only

울산 근무 + 고졸 지원 가능 + 정규직/공무직/무기계약직 + 현재 접수 중 조건이
상세 원문에서 모두 확인된 실제 채용공고만 data/jobs.json에 저장합니다.

GitHub Actions가 3시간마다 공고를 수집합니다.
업로드 후 GitHub Actions에서 Update job postings를 한 번 수동 실행하세요.
변경 내역은 CHANGELOG_v4.3.txt를 확인하세요.

현재 UI 버전: v4.4


[15.2 목록 추출 정상화]
- <a> 제목뿐 아니라 onclick/data-url/data-href/role=link 행·카드도 목록 후보로 추출
- 상세 URL을 복구하지 못한 목록 행은 listOnly로 분리 기록
- pipeline-report.json에 detailUrlReady/listOnlyCount/extractionDiagnostics 추가


[15.3 기관별 목록 복구 패치]
- JOB-ALIO fallback 페이지는 ALIO 전용 목록 파서로 자동 전환
- 한국에너지공단 fn_Detail(id) 상세주소 복구
- 한국산업인력공단 k 게시글 키 상세주소 복구
- pipeline-probe는 첫 접속 성공 페이지에서 멈추지 않고 기관별 공식/대체 URL을 비교하여 목록 후보가 있는 페이지를 진단


[15.4 기관별 심층 진단]
- 실행: node scripts/pipeline-probe.mjs
- 결과: data/pipeline-report.json
- 원인 분석 자료: data/pipeline-artifacts.json
- pipeline-artifacts.json에는 목록 HTML 앞부분, 채용 관련 행, JavaScript 상세 이동 함수, 후보 URL 판정이 용량 제한과 함께 저장됩니다.
- 목적: 한 번의 GitHub Actions 실행으로 목록/상세/첨부 실패 원인을 최대한 확보하여 반복 패치 횟수를 줄입니다.
