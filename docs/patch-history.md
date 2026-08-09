# Next Job Patch History

최신 Actions ZIP이 코드 기준본이며 수정 전 이 파일과 `docs/source-status.json`을 확인한다.

## v75 — 첨부 다운로드/실파일 해석 개선
- 울산문화관광재단: 원본 파일명 query 포함 API 다운로드 → PDF 분석 성공.
- 울산북구시설관리공단: eGov FileDown 경로 변형 → HWPX 분석 성공.
- 한국전력공사: `fileUpload.do` HTML 중간페이지 → 실제 파일 링크 재해석 → PDF 분석 성공.
- 울산항만공사: 공공누리 PNG 등 UI 오탐 정제.
- KOSHA: TBoard fileDown handshake까지 전진. `fileDownInfo` 구조 evidence 전 endpoint 재추측 금지.
- 한국에너지공단: CtitFile 요청 구조 미확정. 추측성 URL 추가 금지.

## v76 — UIPA 후보 정제 + Capability/Coverage 분리
- 명확한 UI 이미지(`ico/icon/button/logo/KOGL/공공누리`)를 첨부 후보에서 제외.
- 동일 상세에 실제 문서가 있으면 JPG/PNG 제외. 이미지뿐인 공고는 OCR 후보 유지.
- `capabilityOk`, `coverageStatus`, `coverageRatio` 추가.
- strict `documentAnalysis.ok`는 전부 분석 성공일 때만 true.
- 부분 성공은 `capabilityOk=true`, `coverageStatus=partial`, `ok=false`.
- 병목을 `문서 분석 부분 성공 (2/3)`처럼 표시.
- `docs/source-status.json` 최초 추가.

### UIPA v75 실제 근거
- 다운로드 3/3, 분석 2/3.
- 실패 1건은 UI 이미지가 아니라 실제 `이의신청서.hwp`의 `extracted text too short`.
- 따라서 v76은 UIPA를 완전 성공으로 처리하지 않고 partial을 유지한다.

### 다음 Actions 검증
- UIPA discovery에서 `ico_download.png`/불필요 이미지 제거.
- UIPA capabilityOk=true + coverageStatus=partial + strict ok=false.
- 이미지형 공고 OCR 후보 보존.
- 기존 20기관 회귀 여부.


## v76-revised — 심화진단 확인 항목 일괄 반영
- 한국산업인력공단: 한 실제 첨부를 `downloadFile2.hrd`와 `downloadFile.hrd?attachSeq=` 두 후보로 중복 집계하던 문제를 정제. 검증된 attachSeq 실파일 후보를 우선.
- 한국산업안전보건공단: 성공 응답에서 `{data,key}`를 재귀 탐색. 못 찾으면 실제 fileDown JSON을 진단 산출물로 저장. 새 endpoint 추측은 하지 않음.
- 울산시설공단: attachmentSignal 다수/attachment 0 상태에서 full detail HTML + file/attach/down 관련 snippet을 자동 저장.
- 한국에너지공단: CtitFile 외부 JS 원문을 파일로 보존하고 관련 함수명/endpoint 문자열 + 상세 HTML을 함께 저장.
- 한국동서발전 / 울산복지가족진흥사회서비스원: 502/timeout은 외부 서버성으로 보고 구조 패치하지 않음.
- 앞으로 Actions에서 원인이 파악된 문제는 원칙적으로 다음 수정본 한 회차에 함께 반영한다. 원인 미확정이면 같은 회차에 evidence 수집 기능까지 포함한다.

## v77 — v76 잔여 5기관 일괄 개선
- 울산시설공단: FileDownNotice 실계약 반영.
- 한국에너지공단: CtitFile POST fileDownload 실계약 반영.
- 한국산업안전보건공단: fileDownInfo 배열 처리.
- 울산정보산업진흥원: HWP 저텍스트 시 LibreOffice fallback.
- 울산복지가족진흥사회서비스원: /u 가짜 href와 encrypted preview identity 결합, preview/TTS 중복 제거, preview 내부 원본 download 복원 시도.
- strict document completion 기준 유지.


## v79 — 재실행(78) 기준 잔여 3기관 원인 한정 패치
- 울산복지가족진흥사회서비스원: 78에서 `www.wfps.or.kr`/`www.uwfdi.re.kr` TCP 443 timeout이 반복됐지만 동일 공식 게시판의 bare-domain 경로가 존재함을 확인. `wfps.or.kr`/`uwfdi.re.kr` 공식 경로를 www 경로보다 먼저 시도하도록 추가. 울산시/남구 fallback은 유지.
- 한국동서발전: 상세 HTML footer의 웹접근성·웹개방성·ISO 인증 PDF가 채용 첨부로 오탐되어 표본 분석을 왜곡한 원인을 확정. 해당 site-wide 인증 문서를 첨부 후보에서 제거. 실제 `new_download.html` 채용 첨부는 그대로 유지하며, 다운로드 계약은 추가 evidence 없이 추측 수정하지 않음.
- 울산정보산업진흥원: 실패한 1건은 실제 `이의신청서.hwp`로 다운로드는 성공했으나 양식 특성상 추출 text가 20자 미만. 같은 공고에 `직무기술서/채용공고` 같은 substantive 문서가 있을 때에만 이의신청서·신원진술서·결격서약서 등 행정 양식을 strict document coverage 대상에서 제외. 일반 HWP 실패를 성공으로 위장하지 않음.
- 공통 Parser 확대 금지 원칙 유지: 이번 변경은 78 evidence로 확인된 bare-domain route, footer 인증문서, 비내용 행정양식 세 원인만 반영.

### v79 다음 Actions 검증
- 복지가족진흥사회서비스원: bare-domain 공식 채용게시판 HTTP/채용게시판 검증 통과 여부.
- 동서발전: attachmentDiscovery 표본에서 웹접근성/ISO 문서 제거 여부. `new_download.html` 실채용 첨부가 HTML로 남으면 해당 요청의 onclick/form/body evidence를 저장한 뒤 실계약만 수정.
- UIPA: 이의신청서 때문에 partial이 되지 않고 substantive 문서 분석 결과로 strict 완료 판정되는지 확인.
- 기존 17 healthy 기관 회귀 0건 확인.


## v80 — 복지가족진흥사회서비스원 DNS 경로 분리 진단/접속 패치
- v79 재실행에서도 `wfps.or.kr`, `uwfdi.re.kr`, `www.*`가 GitHub Actions에서 TCP 443 connect timeout으로 반복 실패. 반면 동일 공식 채용게시판은 외부 검색 크롤러에서 2026-08-09 현재 정상 열리고 최신 452번(2026-08-06)까지 확인되어 기관 서버 전체 다운으로 단정할 수 없음.
- 이미 collector에 존재하던 `curl-resolved` transport를 이 기관에만 마지막 fallback으로 활성화. Google/Cloudflare DoH로 A record를 별도 조회한 뒤 `curl --resolve host:443:IP`로 SNI/Host를 유지한 직접 접속을 시도한다.
- pipeline-probe에도 동일 `curl-resolved` 경로를 구현해 진단과 실제 collector의 접속 방식이 어긋나지 않도록 맞춤.
- 기존 `fetch -> curl` 경로와 공식 URL 순서는 그대로 유지하며, resolved-IP 방식은 정상 접속이 모두 실패한 뒤에만 실행. 다른 19기관에는 적용하지 않음.
- 외부 미러/검색 캐시를 수집 소스로 사용하지 않음. 공식 게시판 원문만 수집한다.

### v80 다음 Actions 검증
- 복지가족진흥사회서비스원 access attempt에 `curl-doh-resolve` 성공 또는 resolved IP별 실패 evidence가 남는지 확인.
- 성공 시 채용게시판 검증 → 목록 → 상세 → 첨부 단계까지 기존 기관 전용 Parser가 그대로 이어지는지 확인.
- 실패 시 DNS 문제가 아니라 해당 서버가 GitHub runner 대역 자체를 차단/드롭하는 쪽으로 원인을 확정하고, 추가 URL 추측 패치는 중단.
- 기존 19 healthy 기관 회귀 0건 확인.


## v82 — WFPS bounded access + project continuity guard
- v81 evidence: 울산복지가족진흥사회서비스원에서 동일/유사 공식 경로에 긴 Node/curl/resolved-IP retry가 누적되며 `collect` 33m42s, 전체 Actions 41m20s까지 증가했고, 결국 HTTP 실패로 회귀함.
- 확정 원인: 성공 가능성을 높이지 못하는 중복 root URL·동일 host 재시도·다중 transport retry가 실패 시 실행시간만 증폭함. 19개 정상 기관의 공통 수집 구조 문제로 보지 않음.
- 적용: 해당 기관에만 9초 access budget, URL당 1회 시도, connect timeout 발생 host circuit-breaker, probe URL 상한을 설정. probe/collector transport를 normal 1개 + `curl-resolved` 1개로 축소하고 resolved curl 자체 retry를 제거. 같은 서비스의 root URL 중복을 제거하되 공식 채용게시판/legacy 공식 board/www alias/울산시·남구 공식 fallback은 유지.
- 정확성 보호: 정상 응답을 빨리 포기하는 blanket timeout 변경이 아니라 WFPS access 단계에만 bounded 정책을 적용. 다른 19기관 source config는 변경하지 않음.
- 프로젝트 안전장치: 저장소 루트에 `PROJECT-GUIDE.md`를 추가해 최우선 목표, 파이프라인 정의, 정확성/Silent Failure 원칙, 수정 금지사항, Pagination→Refactoring→Template→Filter 로드맵을 ZIP 자체에 보존.
- 다음 검증: WFPS 성공/실패 여부와 무관하게 probe/collect 시간이 비정상적으로 수십 분 누적되지 않는지, 19개 정상기관 Regression이 없는지 확인. 성공 시 목록→상세→첨부→문서분석까지 다시 확인.

## v83 — WFPS SVG 오탐 제거 + EWP 다운로드 계약 evidence 강화
- v82 evidence에서 울산복지가족진흥사회서비스원 문서분석 1/2 실패 원인은 실제 채용 첨부가 아니라 `/webuser/img/sub/board/icon-3.svg` 게시판 UI 아이콘이 첨부영역 문맥 때문에 `unknown` 첨부로 들어온 것임을 확정.
- `addAttachment`에서 확장자 판정 전에 known static asset을 제거하도록 수정. SVG처럼 FILE_EXT 밖의 UI asset도 attachment context 때문에 우회 유입되지 않게 함. 실제 문서 첨부 규칙은 변경하지 않음.
- 한국동서발전 `new_download.html`은 v82에서도 실제 파일 대신 `text/html`을 반환. 요청 파라미터를 추측해 성공 처리하지 않고, 다음 Actions에서 반환 HTML과 당시 URL/referer/method/body/headers를 `data/diagnostics/한국동서발전/attachment-resolution`에 보존하도록 추가. 이 evidence로 실제 다운로드 계약을 확정한 뒤 기관 전용 수정한다.
- 전체 기능 검증 원칙 강화: 패치 직접 목적과 별개로 매 브리핑/심화진단에서 20기관 접속→목록→상세→첨부→문서분석→필터→최종저장, 실행시간, Regression, 건수 급변/불일치와 Silent Failure를 함께 확인한다.
