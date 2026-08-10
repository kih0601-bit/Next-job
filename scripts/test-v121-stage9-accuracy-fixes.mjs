import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyJobCategory } from './lib/stage9-job-taxonomy.mjs';
import { evaluateStage9Eligibility, buildStage9Unit } from './lib/stage9-filter-engine.mjs';

const knownProfile={education:'고졸',educationKnown:true,licensesKnown:true,licenses:[],experienceKnown:true,experienceYears:0,ageKnown:true,age:36,majorKnown:true,majors:[],legalOrIdentityKnown:true,legalOrIdentity:[],otherKnown:true,other:[]};
const unknownWorkProfile={...knownProfile,licensesKnown:false,experienceKnown:false,majorKnown:false,legalOrIdentityKnown:false,otherKnown:false};
const emptyReq={education:{values:[],resolution:'not-specified',evidenceDetailed:[]},licenses:[],experience:[],age:[],major:[],jobRelated:[],legalOrIdentity:[],other:[],qualificationAlternatives:[],location:{values:[]},employment:{values:[]}};

// Missing Stage-8 requirements must not become a false Eligible when the vacancy itself signals a hard condition.
let r=evaluateStage9Eligibility(emptyReq,unknownWorkProfile,{posting:{title:'2026 신규직원 채용'},unit:{name:'경력직 2급(산업보건-의학)',requirementSummary:{required:0}}});
assert.equal(r.status,'needs-review');
assert.match(r.decisionReasons.join(' '),/경력 필수 가능성/);
r=evaluateStage9Eligibility(emptyReq,unknownWorkProfile,{posting:{title:'신규직원 채용'},unit:{name:'신입직 5급 지역인재',requirementSummary:{required:0}}});
assert.equal(r.status,'needs-review');
assert.match(r.decisionReasons.join(' '),/신분요건/);

// OR paths: 고졸 + 4년 route passes when the other degree routes fail.
const altReq={...emptyReq,qualificationAlternatives:[{level:'required',options:[
 {raw:'학사 학위 이상 소지자',education:['대졸 이상'],experience:[],licenses:[]},
 {raw:'전문학사 학위 취득 후 직무 관련 2년 이상 경력자',education:['전문대 이상','대졸 이상'],experience:['2년 이상 경력'],licenses:[]},
 {raw:'학위가 없는 경우 직무 관련 4년 이상 경력자',education:['고졸 가능'],experience:['4년 이상 경력'],licenses:[]}
]}]};
r=evaluateStage9Eligibility(altReq,{...knownProfile,experienceYears:4},{posting:{},unit:{requirementSummary:{required:1}}});
assert.equal(r.status,'eligible');
r=evaluateStage9Eligibility(altReq,{...knownProfile,experienceYears:0},{posting:{},unit:{requirementSummary:{required:1}}});
assert.equal(r.status,'ineligible');

// Empty/header fragments in alternative tables may not become a pass route.
const noisyAlt={...emptyReq,qualificationAlternatives:[{level:'required',options:[
 {raw:'(학력, 전공, 경력,',education:[],experience:[],licenses:[]},
 {raw:'산업안전기사 자격증 취득 후 직무 관련 4년 이상 경력자',education:[],experience:['4년 이상 경력'],licenses:['산업안전기사 자격증']}
]}]};
r=evaluateStage9Eligibility(noisyAlt,knownProfile,{posting:{},unit:{requirementSummary:{required:1}}});
assert.equal(r.status,'ineligible');

// Taxonomy: unit-specific category wins; shared title/evidence must not steal it.
assert.equal(classifyJobCategory({vacancyName:'신입직 5급 일반',title:'산업안전보건공단 채용'}).label,'사무·행정');
assert.equal(classifyJobCategory({vacancyName:'신입직 5급 산업안전 기계',title:'공단 일반직 채용'}).label,'안전·보건');
assert.equal(classifyJobCategory({vacancyName:'사업운영',title:'연구직 채용',localText:'AI 플랫폼 구축사업 운영 및 관리'}).label,'사업기획·운영');

// 9B facets: only explicit evidence is normalized; no guessed employment type.
let row=buildStage9Unit({posting:{org:'A',title:'2026 체험형 청년인턴 채용 공고'},unit:{name:'청년인턴',requirements:emptyReq,workLocations:['울산광역시'],employmentTypes:[],requirementSummary:{required:0},evidenceScope:{}},profile:unknownWorkProfile});
assert.deepEqual(row.searchFacets.region,['울산']);
assert.deepEqual(row.searchFacets.employmentType,['인턴']);
row=buildStage9Unit({posting:{org:'A',title:'2026 직원 채용 공고'},unit:{name:'사업운영',requirements:emptyReq,workLocations:[],employmentTypes:[],requirementSummary:{required:0},evidenceScope:{}},profile:unknownWorkProfile});
assert.deepEqual(row.searchFacets.employmentType,[],'employment type must stay unknown when not stated');

const workflow=fs.readFileSync('workflow-template/update-jobs.yml','utf8');
assert.match(workflow,/test-v121-stage9-accuracy-fixes\.mjs/);
console.log('v121 stage9 accuracy-fix tests passed');
