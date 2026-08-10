import assert from 'node:assert/strict';
import { buildStage8Posting } from './lib/stage8-eligibility-structure.mjs';
import { extractSupportRequirements } from './lib/requirement-extractor.mjs';
import { auditStage8Quality } from './lib/stage8-quality-audit.mjs';

const old=buildStage8Posting({org:'울산항만공사',title:'2024년 장기휴직 대체인력 채용',listText:'2024-01-01',detailText:'계약기간 2025.8.1.~2026.7.31.',detailOk:true});
assert.equal(old.sourceHints.postingYear.value,2024);
assert.ok(old.sourceHints.referencedYears.includes(2026));
const req=extractSupportRequirements({documentText:'이·공계열 전문학사 학위 취득 후 직무 관련 2년 이상 경력\n학위가 없는 경우 직무 관련 4년 이상 경력'});
assert.equal(req.qualificationAlternatives.length,1);
assert.equal(req.qualificationAlternatives[0].options.length,2);
const age=extractSupportRequirements({documentText:'필요자격 채용공고일 기준 15세부터 39세 이하'});
assert.equal(age.age[0].level,'required');
const current=buildStage8Posting({org:'테스트기관',title:'2026년 직원 채용 공고',listText:'2026-01-01',detailText:'지원자격 학력무관',detailOk:true});
const qa=auditStage8Quality({postings:[current]});
assert.equal(qa.counts.actionableTitleFallbackUnits,1);
assert.ok(qa.structuralBlockers.includes('actionable-posting-title-used-as-recruitment-unit'));
console.log('v124 Stage 8 source-accountability tests passed');
