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

## v84 — EWP download-contract evidence preservation
- Scope: 한국동서발전 only; no shared download behavior changed.
- Confirmed cause: `new_download.html` is being requested without the file-identifying request contract and returns the site's abnormal-access HTML.
- Change: preserve the EWP detail-page attachment anchor/form/parameter evidence even when a filename candidate was already discovered, so the next real run captures the missing request contract instead of discarding it.
- Safety: no guessed parameter names or synthetic download URL were introduced; the other 19 institutions keep their existing extraction/download path.
- Next verification: inspect the EWP `attachment-resolution/*-detail.html` and evidence JSON, implement the exact GET/POST contract only after it is observed, and re-check all 20 pipeline stages/regressions.

## v85 — WFPS official-source-only + silent-source guard
- v84 전체 evidence 대조에서 울산복지가족진흥사회서비스원의 기관 소유 도메인(`wfps.or.kr`/`uwfdi.re.kr`)이 GitHub Runner에서 timeout 난 뒤, 과거 fallback인 울산광역시 `타기관 소식`이 선택되어 다른 기관 게시물을 WFPS 목록으로 파싱하는 Silent Failure를 확정.
- 기존 fallback은 프로젝트에서 이미 퇴역시킨 `울산광역시 타기관소식` 원칙과도 충돌하므로 WFPS access source에서 울산시/남구 범용 게시판을 제거. 기관 소유 채용게시판 3개 경로만 유지.
- WFPS에만 strict institution verification을 활성화. 공식 host(`wfps.or.kr`, `uwfdi.re.kr`) + `/webuser/employment/list.html` + 기관/채용 HTML 신호가 함께 맞아야 채용게시판 성공으로 판정한다. 일반적인 채용 키워드+table만으로는 통과 불가.
- 정확성 우선: 공식 source가 Runner에서 접근 불가하면 access 실패를 명시하고, 타기관 게시판으로 가짜 20/20을 만들지 않는다.
- 한국동서발전 및 기존 정상 19기관 수집 경로는 변경하지 않음.

### v85 다음 Actions 검증
- WFPS가 공식 도메인으로 접속되면 기관 일치 검증 후 목록→상세→첨부→문서분석으로 진행하는지 확인.
- 공식 도메인이 다시 timeout이면 `access failed`로 명확히 남고 울산시 타기관 게시물은 jobs/list evidence에 절대 유입되지 않는지 확인.
- 나머지 19기관 Regression 0건, 실행시간 비정상 증가 없음 확인.

## v86 — strict success semantics + EWP POST download contract
- 성공 정의를 좁혀 `파이프라인 완성/성공`은 정확한 공식 Source부터 jobs.json/필터/Regression/Silent Failure까지 End-to-End 조건을 모두 만족할 때만 사용하도록 PROJECT-GUIDE에 고정.
- pipeline-probe root-cause 체인에 `attachmentDownload`와 `documentAnalysis`를 추가. 문서 다운로드/분석이 실패했는데 `PIPELINE_SAMPLE_OK`로 보고되던 진단 모순을 제거.
- v85 EWP 원본 detail evidence에서 `new_down(idx_to, order_num)` 함수와 `reform` POST contract를 확정: `idx_to`, `order_num` 및 기존 hidden form fields를 `/kor/include/new_download.html`로 POST하도록 기관 전용 첨부 resolver 추가. parameter 없는 GET 추측 경로를 사용하지 않음.
- Pagination 전에 20기관 Source provenance audit을 완료하도록 명문화. 불명확 Source는 목록 파싱 성공만으로 기관 성공 처리하지 않음.
- 공통 수집 규칙과 다른 19기관 adapter는 변경하지 않음.


## v87 — Engine/Pipeline governance + report truth model
- v86 브리핑 후속: `ATTACHMENT_ZERO_UNRESOLVED`가 Healthy로 보이는 모순을 메인 판정에서 제거. 첨부 0건 미확정은 `unknown(확인불가)`로 유지.
- Next Job = Engine(엔진) + UI(화면), Engine 내부 공식 Pipeline 10단계와 사용자 확정 한글명을 문서화.
- 개발단계 4상태 `verified/unknown/failed/not-implemented` 도입. 전체 구현 뒤 3상태 전환 원칙 기록.
- 진단·검증 9종 확정. Provenance는 즉시 활성, Reconciliation/Golden Dataset은 Pagination부터 필수 적용하도록 구조화.
- 사람이 보는 메인 판정에서 Healthy/Degraded를 제거하고 `legacyHealth`로 호환 유지. 운영단계에서 별도 Health 지표로 재정의 예정.
- `fullPipelineOk` 신규 사용 중단. 현재 앞단 표본 성공은 `collectionDocumentSampleOk`로 명명하고 구 필드는 deprecated 호환 객체로만 유지.
- Source provenance 20기관을 분류. 기관 소유 공식 도메인은 verified, Incruit/Saramin/HUBST 공식 위탁형은 기관→플랫폼 연결 evidence가 추가 확보될 때까지 unknown으로 보수 판정.
- 동서발전 POST 다운로드 및 WFPS 공식 Source-only 로직은 변경하지 않고 Regression 보호 대상으로 유지.
## v88 — 개발 순서 정렬 + 첨부 없음 판정 교정
- 공식 Pipeline 단계 번호를 실제 개발·완성·검증 순서로 재정렬: Source → Access → List → Detail → Attachment → Document Analysis → Pagination → Requirement Extraction → Filter → Output.
- Pipeline 단계 번호는 런타임 호출 순서가 아니라 개발·완성·검증 순서를 뜻한다고 명문화.
- v87 브리핑 확정 원인 반영: 상세 Evidence의 `explicitNoAttachment=true`가 모든 검증 표본에서 확인되면 `ATTACHMENT_EXPLICITLY_NONE`으로 판정하고 Attachment(첨부파일 수집)를 `verified` 처리. `ATTACHMENT_ZERO_UNRESOLVED`는 실제 첨부 없음 여부를 구분할 Evidence가 없을 때만 유지.
- Reconciliation/Golden Dataset의 적용 시작점을 공식 7단계 Pagination으로 정렬.
- WFPS Timeout은 v87 한 실행의 네트워크 연결 timeout Evidence만 있으므로 추측 수정하지 않고 재현 여부를 다음 Actions에서 확인.
- 한국동서발전 POST 다운로드 등 v86에서 확정된 기관별 정상 로직은 변경하지 않음.



## v89 — 위탁 Source 출처 확정 + Actions 실행정보 자동기록 + Evidence 파일명 안전화
- 위탁 Source 3기관을 매 Actions마다 unknown으로 반복 보고하지 않도록 2026-08-09 권위근거를 직접 대조해 registry에 고정했다.
  - 근로복지공단: 근로복지공단 명의 채용페이지가 `comwel.saramin.co.kr`을 입사지원 사이트로 명시.
  - 울산남구도시관리공단: 울산광역시 남구청 공식 산하기관 채용공고가 `uncmc.incruit.com`을 공단 채용홈페이지로 명시.
  - 울주문화재단: 행정안전부 Cleaneye Job+가 `uljuculture.hubst.co.kr`을 재단 채용 홈페이지 지원 접수처로 명시.
- 위 3기관 Source provenance를 `verified`로 승격하되 실제 Access/List 검증은 기존 Actions가 독립 수행한다. 출처 근거와 사이트 가용성을 같은 판정으로 섞지 않는다.
- `data/run-metrics.json` 자동 기록 추가. `runId/runUrl/run_started_at`과 probe/collect/report/verification 구간 시간을 저장하고 finalize 시 `pipeline-report.runMetrics`에도 삽입한다. 정상 실행 후 사용자는 최신 전체 ZIP만 전달해도 별도 Actions 링크를 보낼 필요가 없다.
- 공식 Pipeline JSON stage 출력 순서를 개발 순서(Source→Access→List→Detail→Attachment→Document Analysis→Pagination→Requirements→Filter→Output)와 완전 동기화.
- 긴 공고 제목을 attachment-resolution Evidence 파일명에 그대로 넣던 문제를 짧은 prefix + stable hash 방식으로 변경. v88 전체 ZIP이 일부 환경에서 `File name too long`으로 풀리지 않는 실제 위험을 제거한다.
- Reconciliation/Golden Dataset은 7단계 Pagination 진입 시 실제 활성화한다.
- 선택형 Desktop Helper를 `tools/`에 추가. GitHub CLI를 자동 설치하거나 로그인하지 않으며, 개인 PC에서 이미 `gh`가 준비된 경우에만 최신 Actions 완료 대기/Artifact 다운로드를 지원한다. 약국·공용 PC에서는 실행하지 않아도 된다.

## v90 — Run Metrics 실제 연결 + 7단계 Pagination 진입
- v89 브리핑 자체진단에서 `run-metrics.mjs`는 존재했지만 workflow가 호출하지 않아 `data/run-metrics.json`이 생성되지 않는 원인을 확정. workflow에 start/mark/finalize를 실제 연결하고 Artifact에도 포함했다.
- 기존 긴 attachment-resolution Evidence는 새 파일명 규칙만으로 사라지지 않으므로 Actions에서 legacy 장파일명을 정리하는 cleanup을 추가했다. 새 Evidence는 기존 v89 short-name 규칙을 유지한다.
- `docs/source-status.json`은 과거 장애/pending 문구를 현재 상태와 섞지 않도록 Actions 결과에서 현재 10단계 상태로 동기화한다. 과거 장애 이력은 patch-history에 보존한다.
- 공식 7단계 Pagination(전체 페이지 확장) 구현을 시작했다. 검증된 단일페이지 목록만 확장 seed로 사용하며, explicit query page / API paging metadata는 전체 페이지를 순회한다. JavaScript/POST contract가 확정되지 않은 기관은 추측 요청을 만들지 않고 `unknown-transport-contract`로 Evidence를 남긴다.
- Pagination에서 page fingerprint 반복, 전체 페이지 도달 여부, raw/unique/duplicate 건수를 Reconciliation Check로 검증한다. Golden Dataset Check는 첫 도입 실행에서 검증된 1페이지 구조 기준선을 캡처하고 이후 run에서 regression 기준으로 확장한다.
- 안전 원칙: `pagination control 미검출 = 단일페이지`로 자동 성공 처리하지 않는다. 총 페이지/이동 규칙을 증명할 Evidence가 없으면 unknown으로 남긴다.
