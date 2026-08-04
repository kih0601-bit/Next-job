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
