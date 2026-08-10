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

## v91 — 자체확정 수정 + Pagination POST 확장 + 일시적 실패 관찰 규칙
- v90 결과에서 `run-metrics.mjs`와 cleanup 스크립트는 존재하지만 실제 기준 ZIP의 `.github/workflows/update-jobs.yml`이 이전 workflow라 호출되지 않는 것을 코드 대조로 확정. workflow와 workflow-template에 Run Metrics start/mark/finalize, source-status sync, legacy Evidence cleanup, run-metrics Artifact 포함을 실제 연결했다.
- Run Metrics finalize와 diagnostic Artifact 업로드는 `if: always()`로 두어 후반 실패가 있어도 가능한 범위의 실행 Evidence가 남도록 강화했다.
- 과거 정상 기관의 네트워크성 간헐 실패는 `pipeline-history.json`을 사용해 연속 실패 횟수를 계산하고 3회까지 `transient-watch`로 분리한다. 현재 단계 실패 자체는 유지하며 4회차 또는 오류 유형 변경 시 actionable regression으로 승격한다.
- 7단계 Pagination에서 HTML에 이미 확인된 `form POST + pageIndex/page` 계약을 일반화했다. `goPage`, `fn_egov_select_noticeList`, `fn_egov_select_linkPage`, `fncSearch`의 form/action/page field를 Evidence에서 추출하고, 확인된 hidden fields를 그대로 보존해 POST 페이지를 순회한다. GET query를 임의 추측하지 않는다.
- 총 페이지 Evidence가 명시적으로 1페이지인 JavaScript/form 게시판은 이동 요청이 불필요하므로 1페이지 전체로 검증할 수 있게 했다. 페이지 컨트롤 자체가 검출되지 않은 경우는 기존대로 unknown 유지.
- production Collector도 Probe에서 `form-post`가 검증완료된 기관에 한해 동일 contract를 다시 읽어 전체 페이지 공고를 실제 수집한다.
- KOSHA에서 ZIP 묶음이 다른 실질 채용문서와 함께 있을 때 ZIP 자체를 문서분석 실패로 세지 않도록 archive scope를 교정. UIPA 등 legacy HWP가 hwp5txt/LibreOffice text 변환에서 짧게 나오는 경우 LibreOffice PDF 렌더→PDF text/OCR fallback을 추가했다.
- 8단계 지원조건 수집은 시작하지 않는다. v91 목적은 1~6단계 Regression 보호와 7단계 Pagination 정확성 확장이다.

## v92 — 7단계 근거수집/관리체계 안정화 + 8단계 입력 경계 준비
- 목적: v91 브리핑에서 확인된 실행 workflow/template 드리프트, Run Metrics 미생성, Windows 장경로 Evidence, Pagination 미확정 기관의 근거 부족을 동시에 정리한다.
- Run Metrics: 실제 실행본 `.github/workflows/update-jobs.yml`에 start/mark/finalize와 artifact 포함을 직접 연결하고, `workflow-template/update-jobs.yml`을 실행본과 byte-identical로 유지하도록 테스트한다.
- Safe Filename: 원문 제목은 데이터에 보존하고 Evidence 파일명만 짧은 prefix + stable hash로 제한한다. 기존 장경로 Evidence는 Actions 시작/종료 시 cleanup하고 이후 테스트가 경로 상한을 강제한다.
- Pagination: 미확정 기관에서 form/action/input, JS page function, page control snippet을 `contractEvidence`로 저장해 다음 Actions가 단순 unknown 반복이 아니라 새 근거를 남기도록 강화한다.
- 8단계: Requirement Extraction은 아직 활성화하지 않고 `docs/requirement-input-contract.json`으로 입력/출처/상태 경계만 고정한다.
- 유지: 1~6단계 정상 로직 및 기관별 확정 Adapter는 변경 최소화. 8단계 성공 판정은 아직 not-implemented 유지.


## v93 evidence-based fixes
- Executable workflow synchronized to the verified template so Run Metrics actually executes.
- Pagination discovery now uses observed POST/GET forms carrying page keys before generic query fallbacks; traversal cap raised to 100 for UTP 65-page evidence.
- source-status observation version/time now derives from the current pipeline report instead of hard-coded v90.
- transient-watch now tracks ongoing current network failures using pipeline history even when the diff is no longer a new regression.
- LibreOffice legacy-office extraction locates the actual generated txt file, fixing confirmed ENOENT failures.
- No speculative fix was applied to unresolved HTML gateway or low-text legacy HWP cases; those remain evidence targets.

## v94 — Incremental Collection + Collect 병목 계측
- v93 Actions Evidence에서 Probe는 약 4분 26초에 끝났지만 Collect가 약 40분을 소비해 45분 workflow timeout에 걸린 원인을 확정했다. 전체 Pagination 성공기관의 과거 공고를 매 실행마다 상세→첨부→문서분석까지 재처리하는 구조가 병목의 핵심이었다.
- Production Collect에 Incremental Collection(증분 수집)을 도입한다. 동일 기관·공고 URL·정규화 제목·목록 fingerprint가 최근 20시간 내 처리된 경우 기존 판정/공고 결과를 재사용하고, 신규 또는 변경된 공고만 상세/첨부/문서분석을 다시 수행한다.
- 첫 v94 실행에서도 효과가 나도록 기존 `debug-report.json` + `jobs.json`의 실제 이전 처리 결과를 안전하게 cache bootstrap 한다. 단, 이전 accepted 판정인데 재사용 가능한 jobs payload가 없는 항목은 bootstrap하지 않고 새로 처리하여 누락을 방지한다.
- Cache는 `data/collection-cache.json`에 저장하며 30일/최대 4000항목으로 제한한다. 현재 실행의 문서분석 성공수처럼 보이지 않도록 cache hit의 pipeline 시도 카운트는 0으로 두고, Probe의 독립 검증 결과를 유지한다.
- `data/collect-metrics.json`을 추가해 기관별 시작/종료·소요시간·cache hit/miss·heavyProcessed 건수를 기록한다. `run-metrics.json` finalize 시 이 값을 `collectByOrg`로 병합하여 다음 브리핑에서 기관별 Collect 병목을 직접 확인할 수 있게 한다.
- workflow Artifact에 collection-cache/collect-metrics를 포함한다. 전체 페이지 정확성 검증 자체는 유지하며 Pagination을 축소해 속도를 얻지 않는다.
- 8단계 Requirement Extraction은 아직 활성화하지 않는다. v94 목적은 7단계 전체페이지 정확도를 유지하면서 45분 Collect timeout 구조를 제거하는 것이다.


## v95 — Adaptive Incremental Cache + Pagination Evidence Hardening
- v94 첫 운영 Run Metrics 근거: Collect 33분 28초 중 울산테크노파크 21분 4초, heavyProcessed 507건. 단순 동시성 확대 대신 캐시 재사용 정확도를 먼저 강화한다.
- 종료가 확정된 `expired deadline`/`closed notice text` 공고는 동일 기관+URL+제목 identity가 유지되면 최대 90일 재사용한다. 활성/변경 가능 공고는 기존 20시간 full fingerprint 정책을 유지하고, 동적 목록 텍스트(조회수 등) 흔들림에 대비한 3시간 identity grace만 허용한다.
- cache hit를 full-fingerprint/bootstrap-identity/identity-grace/terminal-identity로 분해 기록해 다음 Actions에서 캐시가 왜 재사용됐는지 근거를 남긴다.
- Pagination 미완료 기관은 각 페이지의 visible/candidate/exact/missing/extra를 pageValidation/mismatchPages로 저장하여 `partial-or-mismatch`의 실제 원인을 다음 한 번의 Actions에서 확정한다.
- CSRF hidden field가 있는 POST Pagination은 fresh GET session의 cookie + 같은 세션 CSRF를 함께 replay한다. 울산시설공단의 기존 page 2~19 HTTP 403 근거에 대한 직접 교정이며, CSRF가 없는 기관에는 적용하지 않는다.
- v94 결과 ZIP을 데스크탑에서 재검사하니 runner에서는 안전했던 한글 diagnostic filename이 GitHub ZIP에서 `#Uxxxx` 형태로 확장되어 Windows/클라이언트 경로가 다시 길어지는 현상을 확인했다. 공고 제목 기반 diagnostic stem은 ASCII `item-<stable hash>`로 저장해 ZIP 인코딩 이후에도 길이가 늘지 않게 한다. 원문 제목은 evidence JSON 내부에 그대로 보존한다.
- 8단계는 여전히 활성화하지 않는다. 현재 목적은 7단계 정확성·외부요인 내성·운영시간의 증거 기반 안정화다.

## v96 — UTP cache fingerprint root-cause fix
- Evidence: v94 run #1 and #2 had all 340 울산테크노파크 cache keys overlapping and all 340 identity fingerprints identical, while all full fingerprints changed between runs.
- Root cause: `candidateFingerprint()` included `listText`; UTP board rows contain volatile metadata such as view counts, so unchanged notices produced a different full fingerprint on every run.
- Fix: exclude volatile `listText` from the full cache fingerprint while retaining org, canonical detail URL, raw title, stable list identity, and detail request contract. This still invalidates cache when the notice title/request identity changes.
- Diagnostics: add per-institution and summary `cacheMissReasons` (`missing-key`, `identity-mismatch`, `fingerprint-changed`, `stale`, `other`) so future cache misses are evidence-classified instead of inferred from timing.
- Kept from v95: adaptive terminal cache, identity grace, pagination pageValidation/session evidence, and ASCII safe diagnostic filenames.

## v97 — Pagination proof + terminal discovery
- Evidence: v96 pipeline report showed UIC/UIPA/UTP traversed all declared pages with reconciliation pass but failed only because heuristic visible-row counts undercounted real record rows; independent record-template verification can prove 1:1 candidate-to-record mapping.
- Fix: pagination exactness accepts independent record-template 1:1 proof and records exactMatchBasis; heuristic count remains diagnostic evidence.
- Evidence: EWP and other legacy forms expose real page/pageNum fields even when total page count is not printed.
- Fix: evidence-backed GET/POST page fields can enter bounded terminal discovery. Probe walks sequential pages to an empty/repeated terminal response, caps at 100, and records terminalEvidence. No guessed page parameter is introduced.
- Governance: pipeline report version updated to v97 source-of-truth string. Existing collector behavior and incremental cache remain unchanged.

## v98 — Pagination proof state model + single-page proof
- Separate stage-7 Implementation Coverage from Current Run Health. A transient access failure or temporarily absent pagination control no longer erases a previously proven pagination implementation.
- Pagination statuses now distinguish `verified-full`, `verified-single`, `verified-historical`, `unknown-*`, and `partial-or-mismatch`; `implementationOk` and `currentRunOk` are recorded independently.
- Historical verification is conservative: only a prior actually verified pagination result may be retained, and only when the current run is unknown/not-evaluated. A current structural mismatch remains a failure and is never hidden by history.
- Single-page boards are no longer verified merely because no pager is visible. `verified-single` requires exact record extraction, an explicit total-count equal to extracted candidates, and no pagination control/page field evidence. Otherwise the board stays unknown and records `singlePageProof` diagnostics.
- Pipeline summary records implementation-verified vs current-run-verified counts and verification class counts. Pipeline history now persists pagination implementation/current-run/status/class for future evidence.
- This patch does not relax pagination completeness rules and does not activate stage 8.


## v99 — Stage 7 evidence closure
- Purpose: raise Stage 7 completion without relaxing proof standards.
- KEPCO: recognize explicit `fncPageBoard(\'addList\', \'addList.do\', N)` pagination evidence and replay `pageIndex=N`.
- Unknown-total legacy boards: a non-record/count-unavailable page is held as a pending terminal-noise candidate; only an identical next response confirms it as terminal, and the noise page is excluded from collected content. This targets the evidenced UTP/EWP post-terminal fragments.
- Single-page proof: explicit empty-board text plus zero candidates and no pagination controls is accepted as `verified-single`; absence of controls alone remains insufficient.
- No broad fallback or guessed URL contract added.

## v100 — Stage 7 final-proof and stable source cache identity
- Evidence basis: v99 run reached 19/20 pagination implementation coverage but Collect returned near the workflow limit because UTP (304) and WFPS (217) were all `missing-key` cache misses.
- UTP root cause: the same durable `wr_id` existed under two generations of URL/title-based cache keys. Cache identity now uses `wr_id`, with exact-id migration from legacy entries.
- WFPS evidence: `em_id` changes between runs for the same visible recruitment row. New cache identity deliberately excludes the volatile token and hashes stable row material. No unsafe title-only migration is performed, so distinct notices with identical titles are not merged.
- Ulju Culture Foundation: existing evidence showed exact 1:1 `ROWAREA_RECORD` verification, one recruitment record, and zero pagination controls. This strong source-specific DOM proof can now establish verified-single without inventing an explicit total.
- COMWEL: legacy detail links emitted as HTTP are normalized to HTTPS before detail collection; this directly addresses the observed HTTP endpoint failure without changing the official recruitment source.
- Guardrail: no historical/current mismatch is hidden by prior success; current partial mismatch remains failure.

## v101 — 자체 심화진단: WFPS cache identity/fingerprint 일관성 수정
- v100 자체진단에서 WFPS cache key는 rotating `em_id`를 제거했지만, 실제 재사용 판정에 쓰는 `candidateIdentityFingerprint`와 `candidateFingerprint`는 여전히 원 URL의 `em_id`를 포함하는 구조적 불일치를 확인했다. 이 경우 같은 공고도 다음 실행에서 `identity-mismatch` 또는 `fingerprint-changed`로 재처리될 수 있다.
- 같은 코드에서 `listText`는 조회수/시간 등 volatile 값 때문에 fingerprint에서 제외한다고 명시하면서 WFPS `sourceStableIdentity`는 `listText`를 우선 사용하고 있어 안정성 원칙이 상충하는 점도 확인했다.
- 수정: WFPS URL에서는 cache 판정용으로 `em_id` 하나만 제거하고 다른 path/query material은 유지한다. parser가 안정적인 `listIdentity`를 제공하면 이를 최우선으로 사용하고, 없으면 `em_id` 제거 URL을 사용한다. `listText`는 cache identity에서 제거했다.
- 수정: cache key, identity fingerprint, full fingerprint가 모두 동일한 `sourceStableIdentity`를 사용하도록 통일했다. WFPS detailRequest URL/body의 `em_id`도 fingerprint 계산에서만 volatile marker로 정규화한다.
- 안전성: 실제 수집 URL/detail request 자체는 변경하지 않는다. 네트워크 요청이나 parser 동작은 손대지 않고 incremental cache reuse 판정만 교정한다. 다른 기관의 URL identity는 기존과 동일하며 울산테크노파크는 계속 `wr_id`를 durable primary key로 사용한다.
- Pagination: 울주문화재단 `verified-single`은 현재 코드상 record-exact + ROWAREA_RECORD verification + pagination control 0 조건으로 제한되어 있다. 다만 이는 실제 Actions HTML evidence가 있어야 최종 완료 판정할 수 있으므로 추가 추측 수정하지 않는다.
- 다음 Actions 검증: WFPS에서 동일 공고의 `em_id`가 바뀌어도 `identity-mismatch`/`fingerprint-changed`가 발생하지 않는지, cacheHits가 회복되는지, UTP `wr_id` migration이 유지되는지, Pagination implementation/current-run 20기관 결과와 Regression 0건을 확인한다.
- 추가 자체진단: 새 stable identity 규칙으로 키를 찾더라도 v99/v100 cache entry 내부의 old `identityFingerprint`/`fingerprint`가 남아 있으면 `reusableCachedOutcome`에서 즉시 탈락할 수 있음을 확인.
- 추가 수정: UTP/WFPS의 기존 cache는 `기관 + 정규화 제목 + durable identity`가 모두 정확히 일치할 때만 현재 candidate fingerprint로 rehydrate한다. direct key에 이미 있는 old-schema entry와 과거 key entry 모두 처리한다. 단순 제목 일치만으로 migration하지 않는다.


## v102 — KEPCO durable notice identity + development manual Actions
- Actions evidence from the v101-based run showed KEPCO Pagination reported 141 raw records across 16 pages but only 1 unique record and 140 duplicates. All duplicate keys collapsed to the shared `/frt/frt0001/view.do` path even though raw HTML proves each notice carries distinct `employYear/employId/employSeq` values in `fncPageBoard('view',...)`.
- Root cause: the KEPCO adapter built the correct query-bearing display URL and POST detail request, but immediately passed the display URL through `canonicalJobUrl()`, which strips query parameters. Pagination reconciliation and page fingerprints also canonicalized the URL again. This erased the durable KEPCO notice identity while still allowing per-page row counts to look exact.
- Fix: preserve the KEPCO extracted query-bearing detail link (`employYear/employId/employSeq`) and use query-bearing extracted links as pagination reconciliation/fingerprint identity. Query-less boards retain the existing canonical URL/title fallback.
- Guardrail: added `test-v102-kepco-identity-and-manual-workflow.mjs` proving two KEPCO notices remain two unique records and generate distinct page fingerprints.
- Development workflow change previously agreed with the user: disable the 3-hour `schedule` trigger and retain `workflow_dispatch` only. Automatic scheduling should be restored after collection/pipeline stabilization for real use.
- No speculative changes were made to institutions whose remaining cache misses require a second-run evidence comparison. WFPS and UTP v101 migration results are already successful in this run (217/217 and 304/304 cache hits respectively).


## v103 — KEPCO identity preservation through the full Collect path
- Recheck after v102 found a downstream regression path: the KEPCO adapter and Pagination engine preserved `employYear/employId/employSeq`, but `collect.mjs` repeatedly calls `canonicalJobUrl()` for candidateMap dedup, cache storage/bootstrap matching, and final job links.
- Root cause: `canonicalJobUrl()` did not classify the three KEPCO fields as durable detail identity, so it stripped them. Therefore v102 could make Pipeline diagnostics show distinct records while actual Collect/cache/output collapsed them again.
- Fix: add `employYear`, `employId`, and `employSeq` to the global durable detail-parameter allowlist. This makes all existing downstream canonicalization calls preserve the KEPCO notice identity without adding KEPCO-specific branches throughout Collect.
- Regression guard expanded: two KEPCO notices must remain distinct after `canonicalJobUrl()` and under the exact Collect-style dedup key shape.
- Existing v102 Pagination identity fix and manual-only Actions workflow are retained.


## v104 — Actions diagnostic leverage + generic pagination identity guard
- Goal: reduce repeated Actions cycles by making each run explain structural failures, not merely count them.
- Generic Pagination guard: if 20+ raw records collapse to less than 50% unique identities, the run cannot be `verified-full`. `identityCollapseDetected` and `identityUniqueRatio` are recorded in reconciliation. This would have automatically rejected the evidenced KEPCO 141 raw → 1 unique result while leaving normal overlap examples (UIPA 291→265, UPA 138→126, Ulju 42→38) unaffected.
- Cache diagnostics: institution metrics now retain up to five samples per miss reason. Each sample records current/cached stable identity, current/cached identity fingerprint, current/cached full fingerprint, links, title, and cache age. A future `identity-mismatch` run should therefore expose the changing component in the same Actions artifact.
- This is diagnostic hardening, not a broad cache-policy change. No institution-specific identity rule was guessed for UIPA/UUC/KOSHA/etc. based on a single run.
- v103 KEPCO end-to-end identity preservation and manual-only workflow remain intact.


## v105 — Pagination transient retry + HUBST proof correction + report provenance
- Uploaded v104 Actions evidence: Collect completed in ~246 s; all previously problematic UTP/WFPS/UIPA/UUC/KOSHA cache identities reused cleanly. KEPCO identity is now correct (`132 raw = 132 unique`, no collapse) but page 3 timed out once, leaving 15/16 pages and `partial-or-mismatch`.
- General resilience fix: Pagination page requests now retry transient timeout/network/429/5xx failures up to 3 times with bounded backoff inside the same Actions run. Successful/failed retry evidence is retained so an external transient does not automatically consume another full Actions cycle.
- Ulju Culture Foundation: the uploaded HTML proves one `.rowArea[opnIdx]` recruitment record, exact `ROWAREA_RECORD` extraction, and a POST form containing only `orgIdx/opnIdx/openType/boardType` — no page parameter and no explicit pager markup. The previous generic `pageControls` heuristic counted a page-like application UI signal and blocked the already-supported HUBST single-page proof. v105 uses actual page parameter/pager markup evidence for this HUBST proof.
- Provenance fix: `pipeline-probe.mjs` still emitted the old v100 VERSION string despite v101-v104 code. Updated to v105 so future Actions artifacts identify the code generation correctly.
- No speculative institution parser changes were made. Worker's Compensation & Welfare Service remains historical implementation proof with current-run proof unavailable; this is not treated as a parser regression without new contrary evidence.
- Regression maintenance: the old v100 Stage-7 test pinned the literal v100 report version, so advancing provenance correctly made the suite fail. The test now verifies that a VERSION declaration exists rather than freezing a historical version string.


## v106 — Explicit Stage-7 completion gate
- Pre-Actions closure audit found that reports exposed counts but had no machine-readable answer to “can Stage 7 close now?”. This left room for repeated manual interpretation of historical-only proof, transient failures, and structural reconciliation defects.
- Added `stage7Gate` to `pipeline-report.json`.
- Closure rule: all 20 sources must have Pagination implementation proof and no structural reconciliation defect. Current-run 20/20 is reported separately from implementation completeness.
- `verified-historical` may preserve implementation proof but is surfaced in `historicalOnly` for operational watch; it cannot hide a structural defect.
- `blockers` identifies the exact institutions preventing closure, while `currentRunVerified`, `historicalOnly`, and `transientOnly` distinguish implementation completion from current external health.
- This lets the next Actions run return a direct `close-stage-7` / `keep-stage-7-open` decision instead of requiring another interpretation cycle.


## v107 — Stage 7 close-ready + self-diagnostic consolidation
- v106 Actions returned exactly one Stage-7 blocker: Ulju Culture Foundation.
- Deep trace found the v105 proof logic itself was correct, but it read the evidence from the wrong object path. `pageResults` stores list verification at `selected.rootCause.accuracyVerification`; `singlePageProof()` incorrectly checked `selected.accuracyVerification`, so `strongHubstRecord` could never become true.
- The uploaded v106 run already proves the external facts needed for closure: exact one-to-one `ROWAREA_RECORD`, one candidate, no page parameter, no explicit pager markup. v107 fixes only the evidence wiring.
- Goal-progress decision: no further Stage-7 external Actions cycle is required solely to rediscover this evidence. Treat Stage 7 as close-ready after local regression validation and proceed to Stage 8 Eligibility, while historical-only sources remain Health/Regression watch items.
- Documentation cleanup policy activated: use one `docs/self-diagnostic.md` for current diagnosis; historical reasoning stays in `patch-history.md`. Versioned self-diagnostic files should be removed rather than continued.


## v108 — Stage 8 objective recruitment-unit structuring
- Stage 8 is formally separated from personal eligibility filtering. Its purpose is to make each posting objectively readable from board title/list metadata, detail page and attachments.
- Existing vacancy splitting is reused, but Stage-8 output is generated before personal-fit rejection and stored separately.
- Added `stage8-eligibility-structure.mjs` and official `data/stage8-eligibility-report.json` generation.
- Posting model: posting-level common requirements + one or more recruitment units. Each unit can independently carry headcount, location, employment type and support requirements.
- Requirement evidence is now source-linked (`title`, `list`, `detail`, `document`). Added explicit `age`, `jobRelated`, and `legalOrIdentity` categories while retaining `identity` as a backward-compatible alias.
- Analysis state distinguishes `not-specified/unknown` from `detail/attachment analysis failed`.
- `requirement-report.json` is retained as a compatibility alias during migration; new Stage-8 consumers should use `stage8-eligibility-report.json`.
- Stage-8 gate is based on individual posting derivation completeness, not user-profile match.
- Documentation cleanup applied: only `docs/self-diagnostic.md` remains current; versioned self-diagnostic files are removed.
- Local validation: all 28 regression tests pass after updating the old v74 implementation-pinned requirement sampling test to the Stage-8 output contract. Synthetic multi-unit test confirms 3/2/1 headcounts and distinct unit requirements remain separated.\n

## v109 — Stage 8 objective-input boundary correction
- Uploaded v108 Actions evidence generated `stage8-eligibility-report.json` successfully but with 0 postings / 0 recruitment units.
- Root cause 1: Stage-8 derivation was downstream of the existing personal list-selection boundary. That boundary excludes contract/intern/license-job postings by design, which violates Stage 8's objective-structuring scope.
- Root cause 2: 2,376 uploaded cache entries predate Stage 8 and 0 contain `stage8Posting`; accepting those cache entries would silently bypass Stage-8 derivation.
- Fix: Stage 8 now analyzes a separate objective recruitment candidate set while `jobs.json` remains gated by the original personal selection.
- Fix: cache entries without `stage8Posting` are intentionally reprocessed once; subsequent runs can reuse the new Stage-8-aware cache.
- Stage 7 remains closed; this is a Stage-8 integration defect, not a reason to reopen Pagination work.


## v110 — Stage-8 silent-failure guard + Ulsan Facilities form-session alignment
- Uploaded run kept Stage 7 closed (20/20 implementation proof).
- Ulsan Facilities Corporation console 403s came from the production collector's duplicate form-POST pagination replay. The authoritative probe independently succeeded 19/19 pages, 189 raw/189 unique, with fresh CSRF + cookie evidence. Collector now mirrors that session principle and adds bounded transient retry.
- Stage-8 output was still 0 postings/0 units. Uploaded cache has 2,376 entries and zero Stage-8 structures despite metrics reporting cache hits.
- Added explicit Stage-8 cache schema version. Legacy/non-Stage8 cache entries cannot be reused as Stage-8-complete.
- Added per-source Stage-8 candidate/derived counters and report input diagnostics.
- Added hard `STAGE8_SILENT_FAILURE` guard when objective candidates exist but zero structured postings are emitted. Empty success reports can no longer hide the integration defect.
- Goal decision: do not reopen Stage 7; use the next Actions run to force a decisive Stage-8 data result.
- Regression maintenance: v105/v109 tests were updated from historical literal implementation strings to the strengthened v110 provenance/cache contract. Full local suite now passes.\n

## v111 — Stage 8 diagnostic gate + known document resilience fixes
- Stage 8 전용 structural QA와 sample evidence를 추가.
- Stage 8 종료 Gate를 원문 Benchmark 검증 전 자동 종료 불가로 강화.
- Regression의 실제 하락 stage를 별도 `regressionCause`로 기록해 `PIPELINE_SAMPLE_OK` 도돌이표 방지.
- Stage 8 Cache hit/miss 재사용 상태를 품질 리포트에 포함.
- Legacy DOC/XLS LibreOffice TXT 무출력 시 PDF render → PDF text/OCR fallback 추가.
- Actions artifact에 stage8-eligibility, stage8-quality, qa-report를 직접 포함.
- 구조화 알고리즘 자체는 다음 진단 Evidence를 보존하기 위해 이번 패치에서 변경하지 않음.

## v112 — Stage 8 fast-run + trust-boundary diagnostics
- Full Pipeline과 Stage 8 반복개발을 분리. Full Run이 `data/stage7-stage8-snapshot.json`에 Stage 7→8 경계 입력(제목/목록/상세/첨부 메타데이터/문서추출 텍스트)을 저장하고, 별도 `Stage 8 fast verification` workflow가 네트워크·문서도구 재실행 없이 동일 입력으로 Stage 8만 반복 검증한다.
- Fast Run 성공은 Stage 8 최종 완료 근거가 아니다. 보고서에 `live-full-pipeline-validation-required`를 강제로 남겨 실제 1→8 Full Run 및 Benchmark 검증 없이 Stage 8 Gate가 닫히지 않게 했다.
- Snapshot은 원본 PDF/HWP 바이너리를 중복 저장하지 않고 Stage 8에 필요한 텍스트/메타데이터만 저장한다. Snapshot 생성 당시 선결단계 문제는 `trust.status/issues`로 함께 기록한다.
- 울산남구도시관리공단: 실제 채용게시판의 명시적 `등록된 정보가 없습니다` 증거가 noisy Incruit landing page의 단일 링크보다 우선 선택되도록 목록페이지 ranking을 수정. 반복 `LIST_COUNTER_FAILED`의 확정된 선택 오류를 제거한다.
- 울산복지가족진흥사회서비스원: 회전하는 `em_id`를 제거한 URL만 Cache identity로 쓰던 충돌 위험을 줄이기 위해 목록의 날짜+제목을 stable `listIdentity`로 추가.
- Document Analysis: `extracted text too short` 실패에서 detected type / extraction method / extracted length / failure class를 보존해 다음 회차에서 실제 저텍스트 원인을 구분할 수 있게 함. 임의 성공 처리하지 않음.
- Cache miss `other`를 `stage8-schema-missing`, `processed-at-invalid`, `reuse-policy-expired` 등으로 세분화. 첫 v112 Full Run은 새 Stage8 input schema 때문에 재처리가 늘 수 있으나 이후 Fast Run 및 Cache 재사용 진단의 근거가 된다.
- Stage 8 Quality Audit에 unread source의 기관/원인/source/current-year hint 집계를 추가하고, 원문 Benchmark 작성 우선순위용 `data/stage8-benchmark-candidates.json`을 생성한다. 이 파일은 정답표가 아니며 자동 Benchmark 통과 근거로 사용하지 않는다.
- Full diagnostic workflow timeout은 60→90분으로 조정. 이는 느린 구조를 정상화한 것이 아니라 첫 Snapshot 생성/Full Gate 검증이 timeout으로 증거를 잃지 않도록 한 안전 여유이며, 반복개발은 Fast workflow로 분리한다.

## v113 — Stage 7/8 병렬 개발 + Snapshot Baseline 수명주기
- 목적: Stage 7 실데이터 복구와 Stage 8 구조화 개선을 같은 패치에서 진행하되 검증 인과관계를 분리한다.
- Snapshot 정책: Full Run은 최신 candidate를 생성하되 baseline을 자동 덮어쓰지 않는다. Fast Run은 baseline만 사용한다.
- 승격 기준: baseline의 정상 입력에서 failed=0, partial=0, structural blocker=0이 된 뒤 verified candidate를 다음 baseline 후보로 삼는다. Stage 7 입력 결함이 확인된 baseline은 교정 snapshot으로 교체할 수 있다.
- Stage 8: inline `모집분야:` 다중 역할 신호를 추가 분리하는 보수적 splitter 규칙 추가. 기존 baseline Fast Run 기준 모집단위 446→451, multi-signal single 46→45. 이 수치만으로 정확도 향상/완료 판정 금지; Benchmark 원문 대조 필요.
- 유지: Fast Run 성공은 Stage 8 closure 근거가 아니며 live Full Run + Benchmark gate를 계속 요구한다.

## v114 — terminal cache reuse / repeated heavy-work elimination
- 목적: Stage 8 확장 이후 만료·마감된 과거 공고가 `stage8-schema-missing`으로 매 실행마다 상세/첨부/문서분석을 다시 수행하던 반복 비용 제거.
- 근거: 최신 run에서 collect 49분 6초, cache miss 817건 중 `stage8-schema-missing` 584건. 기존 terminal 결과는 Stage 8 활성 출력 대상이 아닌데도 현 schema의 `stage8Posting`이 없다는 이유만으로 재처리됨.
- 변경: durable identity가 일치하고 기존 terminal TTL(90일) 안인 `expired deadline` / `closed notice text` 결과는 Stage 8 legacy schema라도 재사용. 비-terminal 결과는 종전대로 현 Stage 8 schema를 반드시 요구.
- 안전장치: terminal TTL, identity match, non-terminal Stage 8 schema gate는 유지. Stage 8 활성 구조화 범위와 개인 jobs.json 판정 로직은 변경하지 않음.
- 검증: `test-v114-terminal-cache-optimization.mjs` 추가, executable/template workflow byte-identical 유지.
- 다음 Actions 관찰: `collect-metrics.json`에서 `stage8-schema-missing`, `heavyProcessed`, collect duration이 급감하는지 확인. 신규/변경 공고는 기존 cache miss 경로로 정상 재처리되어야 함.

## v115 — Stage 8 closure diagnostics + balanced multi-recruitment splitter
- 목적: Stage 8 완료 전에 남은 구조적 오탐/미분리와 원문 Benchmark 부재를 진단 가능한 형태로 고정한다.
- Multi-vacancy: `모집분야:` 한 줄 안의 괄호/쉼표가 섞인 복합 모집구조를 단순 comma split하지 않고 괄호 depth를 보존해 분리. KOSHA 2026 상반기 예비공고 같은 `신입직 5급(... 산업안전(기계,전기,화공) ...)` 구조에서 잘린 모집단위명을 방지한다.
- Benchmark: `scripts/stage8-benchmark.mjs` 추가. multi-split/unread/low-confidence/no-evidence 위험군을 기관·최신연도 우선으로 40건 표본화하고 `expected.reviewed=false` 정답 입력 Template을 생성한다. 자동 생성값을 정답으로 취급하지 않는다.
- 진단 유지: 최신 원문/첨부 unread는 성공으로 완화하지 않으며 Stage 8 blocker로 계속 남긴다. 현재 Fast baseline 기준 current-year unread 1건(KOSHA 2026 예비공고)은 다음 Full Run에서 Document Analysis 원인 재검증 대상이다.
- 검증: `test-v115-stage8-closure-diagnostics.mjs` 추가. balanced inline split과 unread-current-year gate를 회귀 테스트한다.
- 범위 컷: required/preferred 추출 규칙과 unread attachment 복구 로직은 Benchmark/Full Run 증거 없이 한 패치에서 동시에 변경하지 않는다. 다음 Actions 증거 후 v116 교정 대상으로 둔다.
