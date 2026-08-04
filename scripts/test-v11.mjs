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
