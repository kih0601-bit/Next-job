
import assert from 'node:assert/strict';
import { extractSupportRequirements, evaluateSupportEligibility } from './lib/requirement-extractor.mjs';
import { analyzeJob } from './lib/classifier.mjs';

const documentText=`
지원자격
고등학교 졸업 이상
전기기사 자격증 소지자 필수
관련 분야 실무 경력 2년 이상
우대사항
컴퓨터활용능력 1급 보유자 우대
근무지: 울산광역시
고용형태: 정규직
`;
const req=extractSupportRequirements({documentText});
assert.ok(req.education.values.includes('고졸 이상'));
assert.ok(req.licenses.some(x=>/전기기사/.test(x.value)&&x.level==='required'));
assert.ok(req.licenses.some(x=>/컴퓨터활용능력/.test(x.value)&&x.level==='preferred'));
assert.ok(req.experience.some(x=>/2년/.test(x.value)&&x.level==='required'));
assert.ok(req.location.values.includes('울산'));
assert.ok(req.employment.values.includes('정규직'));

const unknown=evaluateSupportEligibility(req,{education:'고졸',educationKnown:true,licensesKnown:false,experienceKnown:false,majorKnown:false});
assert.equal(unknown.status,'needs-review');

const missing=evaluateSupportEligibility(req,{education:'고졸',educationKnown:true,licensesKnown:true,licenses:[],experienceKnown:true,majorKnown:true});
assert.equal(missing.status,'ineligible');

const classified=analyzeJob({
  title:'2026년 일반직 채용',
  detailText:'근무지 울산 정규직 고등학교 졸업 이상',
  documentText,
  detailOk:true
});
assert.ok(classified.supportRequirements);
assert.equal(classified.supportEligibility.status,'needs-review');
console.log('v73-requirements-pass');
