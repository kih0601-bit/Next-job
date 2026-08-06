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
