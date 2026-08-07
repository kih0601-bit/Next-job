import assert from 'node:assert/strict';
import { analyzeJob } from './lib/classifier.mjs';
import { scoreJobQuality } from './lib/quality-engine.mjs';
import { validateJob, runCollectionQA } from './lib/validator.mjs';

const detailText = `2026년 일반직 직원 채용 공고\n모집분야 행정 사무\n채용인원 1명\n응시자격 학력무관\n고용형태 정규직\n근무예정지 울산광역시 남구\n접수기간 2026.08.01부터 2026.08.20까지\n전형절차 서류전형, 필기전형, 면접전형\n제출서류 입사지원서 및 자기소개서`;
const analysis = analyzeJob({ title: '2026년 일반직 직원 채용 공고', detailText, detailOk: true });
assert.equal(analysis.recommended, true);
assert.equal(analysis.jobCategory, '행정·사무');
const quality = scoreJobQuality({
  detail: { ok: true, confidence: { structureSignals: 6, titleRatio: 0.8, tokenCount: 4 } },
  documents: { successful: 0 }, analysis, deadline: '2026-08-20', link: 'https://example.com/board/view.do?nttId=1'
});
assert.equal(quality.passed, true);
const job = { org: '테스트기관', title: '2026년 일반직 직원 채용 공고', link: 'https://example.com/board/view.do?nttId=1', deadline: '2026-08-20', employmentType: analysis.employmentType, eligibility: analysis.eligibility, location: analysis.location, qualityScore: quality.score, qualityThreshold: quality.threshold, detailChecked: true, raw: detailText };
assert.equal(validateJob(job).passed, true);
assert.equal(runCollectionQA([job]).passed, true);
const conflict = analyzeJob({ title: '일반직 채용 공고', detailText, documentText: '고용형태 기간제 근로자, 학사 이상, 근무지 서울', detailOk: true });
assert.equal(conflict.excluded, true);
console.log('v11 self-test passed');

const benignTemporary = analyzeJob({
  title: '2026년 일반직 정규직 채용 공고',
  detailText: '고용형태: 정규직\n학력무관\n근무지: 울산광역시\n접수기간 2026.08.01~2026.08.20\n채용인원 1명\n응시자격 안내',
  documentText: '기존 기간제 근무경력도 경력으로 인정하며 기간제 근로자도 지원 가능합니다.',
  detailOk: true
});
assert.ok(['정규직', '일반직'].includes(benignTemporary.employmentType));
assert.equal(benignTemporary.excluded, false);

const explicitTemporary = analyzeJob({
  title: '직원 채용 공고',
  detailText: '고용형태: 정규직\n학력무관\n근무지: 울산광역시\n접수기간 2026.08.01~2026.08.20\n채용인원 1명',
  documentText: '채용형태: 기간제 근로자\n계약기간: 1년',
  detailOk: true
});
assert.equal(explicitTemporary.excluded, true);
assert.ok(explicitTemporary.excludeReasons.some(reason => reason.includes('고용형태')));

const { SOURCES } = await import('./collectors/source-registry.mjs');
assert.ok(SOURCES.length >= 21, '21개 이상 기관 출처가 등록되어야 함');
assert.ok(SOURCES.every(source => source.org && source.url && source.requireValidDetail), '모든 출처는 상세 검증을 요구해야 함');

const { extractAttachments } = await import('./lib/detail-parser.mjs');
const extractedAttachments = extractAttachments(`
  <a href="/files/recruit.pdf">채용공고문</a>
  <a href="#" data-url="/files/job.hwpx">직무기술서</a>
  <a href="javascript:void(0)" onclick="window.open('/files/table.xlsx')">채용분야표</a>
`, 'https://example.com/board/view?no=1');
assert.equal(extractedAttachments.length, 3, 'href/data-url/onclick 공개 첨부를 모두 발견해야 함');

const { analyzeVacancies } = await import('./lib/classifier.mjs');
const mixedPosting = analyzeVacancies({
  title: '2026년 통합 직원 채용 공고',
  detailText: `접수기간 2026.08.01~2026.08.20\n공통사항 블라인드 채용\n채용분야: 행정사무\n채용인원 2명\n고용형태: 정규직\n학력: 학력무관\n근무지: 울산광역시 남구\n채용분야: 시설관리\n채용인원 1명\n고용형태: 기간제\n계약기간: 10개월\n학력: 고졸 이상\n근무지: 울산광역시 북구\n채용분야: 전산개발\n채용인원 1명\n고용형태: 정규직\n학력: 학사 이상\n근무지: 울산광역시 중구`,
  detailOk: true
});
assert.equal(mixedPosting.length, 3, '혼합 공고를 3개 모집 직군으로 분리해야 함');
assert.equal(mixedPosting.filter(item => item.analysis.recommended).length, 1, '고졸 정규직 울산 직군만 추천해야 함');
assert.match(mixedPosting.find(item => item.analysis.recommended).name, /행정사무/);
assert.ok(mixedPosting.some(item => item.analysis.excludeReasons.some(reason => reason.includes('고용형태'))), '기간제 직군은 제외해야 함');
assert.ok(mixedPosting.some(item => item.analysis.excludeReasons.some(reason => reason.includes('학사'))), '학사 이상 직군은 제외해야 함');

const singlePosting = analyzeVacancies({ title: '공무직 채용 공고', detailText: '고용형태 공무직\n학력무관\n근무지 울산광역시\n채용인원 1명\n접수기간 2026.08.01~2026.08.20', detailOk: true });
assert.equal(singlePosting.length, 1, '단일 공고는 불필요하게 분리하지 않아야 함');
assert.equal(singlePosting[0].analysis.recommended, true);
console.log('v11.3 position-unit tests passed');

// v11.4 debug-stage extraction smoke tests
{
  const { extractAlioCandidates } = await import('./collectors/alio-adapter.mjs');
  const html = `<a href="javascript:recruitView('303191')">2026년도 신입직원 공개채용 공고</a>`;
  const rows = extractAlioCandidates(html, { org: '한국동서발전', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do' }, {
    validTitle: title => /채용/.test(title),
    normalizeTitleForDedup: title => title
  });
  if (rows.length !== 1 || !/recruitView\.do\?idx=303191/.test(rows[0].link)) {
    throw new Error('v11.4 ALIO idx adapter test failed');
  }
}

// v11.8 ALIO row fallback: title is outside the clickable anchor.
{
  const { extractAlioCandidates } = await import('./collectors/alio-adapter.mjs');
  const html = `<li><span>2026년도 일반직 신입직원 공개채용 공고</span><button onclick="recruitView('303192')">상세보기</button></li>`;
  const rows = extractAlioCandidates(html, { org: '한국동서발전', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do' }, {
    validTitle: title => /채용/.test(title),
    normalizeTitleForDedup: title => title
  });
  assert.equal(rows.length, 1, '앵커 밖 제목도 ALIO 상세 호출과 연결해야 함');
  assert.match(rows[0].link, /idx=303192/);
  assert.equal(rows[0].adapter, 'ALIO-row-fallback');
}
console.log('v11.8 extraction fallback tests passed');


// v12 generic row-level detail URL recovery
{
  const { extractCandidatesForSource } = await import('./collectors/source-adapters.mjs');
  const source = { org: '테스트기관', url: 'https://example.org/board/list.do?page=1', detail: true };
  const helpers = {
    validTitle: title => /채용/.test(title),
    normalizeTitleForDedup: title => title.replace(/\s+/g, ' ').trim()
  };
  const html = `<table><tr data-nttId="7788"><td><a href="#">2026년 공무직 채용 공고</a></td><td><button data-url="/board/view.do?nttId=7788">상세</button></td></tr></table>`;
  const jobs = extractCandidatesForSource(html, source, helpers);
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].link, /view\.do\?nttId=7788/);
  assert.equal(jobs.diagnostics.rowFallbackAccepted, 1);
}
console.log('v12 row-detail recovery tests passed');


// v12.4 attachment extraction: fragment placeholders must not be treated as files,
// while JavaScript-built download URLs and form requests must be preserved.
{
  const { extractAttachments } = await import('./lib/detail-parser.mjs');
  const html = `
    <script>
      function fileDown(fileId, fileSn) {
        location.href = '/cmm/fms/FileDown.do?atchFileId=' + fileId + '&fileSn=' + fileSn;
      }
    </script>
    <a href="#fileDownload" onclick="fileDown('FILE_123','2')">채용공고문.hwp</a>
    <form action="/board/download.do" method="post" class="attachment-file-area">
      <input type="hidden" name="fileId" value="FILE_456">
      <input type="hidden" name="fileSn" value="1">
      <button type="submit">첨부파일 다운로드</button>
    </form>`;
  const files = extractAttachments(html, 'https://example.org/board/view.do?no=10');
  assert.equal(files.some(file => /#fileDownload$/.test(file.url)), false, '페이지 내부 앵커를 첨부파일로 오인하면 안 됨');
  assert.ok(files.some(file => /FileDown\.do\?atchFileId=FILE_123&fileSn=2/.test(file.url)), 'JS 조합형 다운로드 URL을 복원해야 함');
  const postFile = files.find(file => /board\/download\.do/.test(file.url));
  assert.equal(postFile?.method, 'POST');
  assert.match(postFile?.body || '', /fileId=FILE_456/);
}
console.log('v12.4 detail/document pipeline tests passed');

// v12.5: common Korean public-board FileDown endpoint recovery and false-positive blocking.
{
  const html = `
    <script>function fileDown(a,b,c){ /* external implementation on real sites */ }</script>
    <form id="viewForm" action="/umca/bbs/list.do?bbsId=BBS_0000000000000002" method="post">
      <input type="hidden" name="dataId" value="4434">
    </form>
    <div class="file-area">
      <a href="#" onclick="fileDown('FILE_000000000006789','BBS_0000000000000002','0')">채용공고문.hwp</a>
    </div>
    <a href="/umca/contents.do?mId=001008004000000000">뷰어다운로드</a>
  `;
  const files = extractAttachments(html, 'https://www.umca.co.kr/umca/bbs/view.do?dataId=4434');
  assert.ok(files.some(file => /\/umca\/bbs\/FileDown\.do\?/.test(file.url) && /atchFileId=FILE_000000000006789/.test(file.url)), 'FILE/BBS 식별값으로 실제 FileDown 주소를 복원해야 함');
  assert.equal(files.some(file => /\/bbs\/list\.do/.test(file.url)), false, '일반 상세 폼을 첨부 다운로드로 오인하면 안 됨');
  assert.equal(files.some(file => /contents\.do/.test(file.url)), false, '뷰어 안내페이지를 첨부파일로 오인하면 안 됨');
  console.log('v12.5 attachment endpoint recovery tests passed');
}


// v12.6: parsed attachment text must participate in vacancy classification.
{
  const rows = analyzeVacancies({
    title: '2026년 공무직 채용 공고',
    detailText: '채용인원 1명\n접수기간 2026.08.01~2026.08.20',
    documentText: '고용형태: 공무직\n학력: 학력무관\n근무예정지: 울산광역시 남구\n채용인원 1명',
    detailOk: true
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].analysis.recommended, true, '첨부문서의 학력·고용형태·근무지 근거가 최종 판정에 반영되어야 함');
  assert.equal(rows[0].analysis.decisionEvidence.sources.documentUsed, true);
  assert.ok(rows[0].analysis.decisionEvidence.education.lines.some(line => /학력무관/.test(line)));
}
console.log('v12.6 document-backed classification tests passed');

// v12.8: institution-specific endpoints and UPA detail URL reconstruction.
{
  const { extractCandidatesForSource } = await import('./collectors/source-adapters.mjs');
  const helpers = {
    validTitle: title => /채용/.test(title),
    normalizeTitleForDedup: title => title.replace(/\s+/g, ' ').trim()
  };
  const source = {
    org: '울산항만공사',
    url: 'https://www.upa.or.kr/portal/contents.do?mid=0405000000',
    detail: true
  };
  const html = `<table><tr><td><a href="#" onclick="postView(14905)">2026년 신입직원 채용 공고</a></td></tr></table>`;
  const rows = extractCandidatesForSource(html, source, helpers);
  assert.equal(rows.length, 1);
  assert.match(rows[0].link, /\/portal\/board\/post\/view\.do\?bcIdx=668&idx=14905&mid=0405000000/);

  const { SOURCES } = await import('./collectors/source-registry.mjs');
  assert.equal(SOURCES.length, 21, '운영 수집기관은 21개여야 함');
  assert.equal(SOURCES.some(item => item.org === '\uC6B8\uC0B0\uAD11\uC5ED\uC2DC \uD0C0\uAE30\uAD00\uC18C\uC2DD'), false, '퇴역한 타기관소식 source가 다시 등록되면 안 됨');
  assert.ok(SOURCES.find(item => item.org === '근로복지공단').accessUrls.some(url => /comwel\.incruit\.com/.test(url)));
  assert.ok(SOURCES.find(item => item.org === '한국전력공사').accessUrls.some(url => /kepco\.co\.kr\/home\/about\/careers\.do/.test(url)));


  const welfareFamilyService = SOURCES.find(item => item.org === '울산복지가족진흥사회서비스원');
  assert.ok(welfareFamilyService.accessUrls.some(url => /wfps\.or\.kr\/webuser\/employment\/list\.html/.test(url)), '기관 공식 채용게시판을 주 경로로 유지해야 함');
  assert.ok(welfareFamilyService.accessUrls.some(url => /ulsan\.go\.kr\/u\/rep\/contents\.(?:do|ulsan)\?mId=001004001003000000/.test(url)), '울산시 공식 타기관소식 경로를 대체 경로로 등록해야 함');
  assert.ok(welfareFamilyService.accessUrls.some(url => /ulsannamgu\.go\.kr\/cop\/bbs\/selectBoardList\.do\?bbsId=hireNotice2/.test(url)), '공식 지방자치단체 채용게시판을 최종 가용성 경로로 등록해야 함');
}
console.log('v12.8 KPI endpoint/detail recovery tests passed');
console.log('v13.1 Phase 1 welfare-service access fallback tests passed');
