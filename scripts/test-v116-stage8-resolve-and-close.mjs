import assert from 'node:assert/strict';
import { splitVacancies, VACANCY_SPLITTER_VERSION } from './lib/vacancy-splitter.mjs';
import { extractSupportRequirements, evaluateSupportEligibility, REQUIREMENT_SCHEMA_VERSION } from './lib/requirement-extractor.mjs';
import { auditStage8Quality } from './lib/stage8-quality-audit.mjs';

const utp=`응시분야 사업지원-1 전문직 직무기술서 1\n세부모집분야 사업지원·장비운영\n■ 아래의 자격 중 한 가지에 해당하는 경우\n- 공학계열 학사 학위 이상 소지자\n- 공학계열 전문학사 학위 취득 후 직무 관련 2년 이상 경력자\n- 학위가 없는 경우 직무 관련 4년 이상 경력자\n참고사이트 x\n전문직 직무기술서 2\n응시분야 사업지원-2\n세부모집분야 사업지원·장비운영\n■ 아래의 자격 중 한 가지에 해당하는 경우\n- 이공계열 학사 학위 이상 소지자\n- 이공계열 전문학사 학위 취득 후 직무 관련 2년 이상 경력자\n- 학위가 없는 경우 직무 관련 4년 이상 경력자`;
const units=splitVacancies({title:'전문직 채용',documentText:utp});
assert.ok(typeof VACANCY_SPLITTER_VERSION === 'string' && VACANCY_SPLITTER_VERSION.length > 0, 'vacancy splitter must expose a version');
assert.deepEqual(units.map(x=>x.name),['사업지원-1','사업지원-2']);
const req=extractSupportRequirements({documentText:units[0].localText});
assert.match(REQUIREMENT_SCHEMA_VERSION,/2\.[12]\.0/);
assert.equal(req.qualificationAlternatives.length,1);
assert.equal(req.qualificationAlternatives[0].options.length,3);
assert.ok(req.presentation.listRequired.some(x=>x.includes('선택형 필수요건')));
assert.equal(req.presentation.detailPreferred.length,0);
const eligibility=evaluateSupportEligibility(req,{education:'고졸',educationKnown:true,licensesKnown:false,experienceKnown:false,majorKnown:false});
assert.notEqual(eligibility.status,'ineligible','OR qualification path must not hard-fail high-school profile solely because another option requires a degree');

const quality=auditStage8Quality({postings:[{posting:{org:'X',title:'2012 채용공고',link:'x'},sourceHints:{years:[2012],closed:true},sourceCoverage:{document:{available:true,readable:false,status:'analysis-failed',error:'404'},detail:{available:true,readable:true}},recruitmentUnits:[{name:'x',source:'single',splitConfidence:.45,evidenceScope:{detail:'채용분야 및 인원',document:''},requirementSummary:{evidenceCount:0}}]}]});
assert.equal(quality.counts.actionableUnreadSources,0);
assert.equal(quality.structuralBlockers.length,0);
console.log('v116 Stage 8 resolve/benchmark readiness tests passed');
