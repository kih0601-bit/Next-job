import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyJobCategory, JOB_CATEGORIES } from './lib/stage9-job-taxonomy.mjs';
import { evaluateStage9Eligibility } from './lib/stage9-filter-engine.mjs';
import { DEFAULT_SEARCH_FILTERS, applySearchPreferenceFilters } from './lib/stage9-search-filter.mjs';

assert.equal(new Set(JOB_CATEGORIES.map(x=>x.id)).size,JOB_CATEGORIES.length,'job category ids must be unique');
for(const sample of [
  [{vacancyName:'일반행정'},'사무·행정'],
  [{vacancyName:'ICT/SW 사업운영·관리'},'IT·디지털'],
  [{vacancyName:'신입직 5급 산업안전 기계'},'안전·보건'],
  [{vacancyName:'건축직'},'건축·토목'],
  [{vacancyName:'전기직'},'전기·전자'],
  [{vacancyName:'사업지원-1'},'사업기획·운영']
]) assert.equal(classifyJobCategory(sample[0]).label,sample[1]);

const req={education:{values:['고졸 이상'],resolution:'observed',evidenceDetailed:[]},licenses:[{level:'required',value:'전기기사 자격증 소지자',evidenceDetailed:[{source:'document',text:'전기기사 자격증 소지자'}]},{level:'preferred',value:'컴퓨터활용능력 우대'}],experience:[],age:[],major:[],legalOrIdentity:[],other:[],qualificationAlternatives:[]};
let r=evaluateStage9Eligibility(req,{education:'고졸',educationKnown:true,licensesKnown:true,licenses:[],experienceKnown:true,ageKnown:true,age:36,majorKnown:true,majors:[],legalOrIdentityKnown:true,legalOrIdentity:[],otherKnown:true,other:[]});
assert.equal(r.status,'ineligible'); assert.equal(r.specUp.possible,true); assert.match(r.specUp.unlockConditions[0].reason,/자격/);
r=evaluateStage9Eligibility(req,{education:'고졸',educationKnown:true,licensesKnown:true,licenses:['전기기사'],experienceKnown:true,ageKnown:true,age:36,majorKnown:true,majors:[],legalOrIdentityKnown:true,legalOrIdentity:[],otherKnown:true,other:[]});
assert.equal(r.status,'eligible'); assert.equal(r.preferredMatch.total,1,'preferred must be preserved, not exclusion');

assert.deepEqual(DEFAULT_SEARCH_FILTERS.map(x=>x.id),['region','organization','jobCategory','employmentType']);
const base={eligibility:{status:'eligible'},searchFacets:{region:['울산'],organization:['A'],jobCategory:['사무·행정'],employmentType:['정규직']}};
assert.equal(applySearchPreferenceFilters([base],{region:['울산']}).length,1);
assert.equal(applySearchPreferenceFilters([base],{jobCategory:['IT·디지털']}).length,0);
// Extensibility proof: a fifth facet can be added without touching 9A.
const extensible=[...DEFAULT_SEARCH_FILTERS,{id:'futureFacet',label:'향후필터',type:'multi-checkbox',enabled:true}];
assert.equal(applySearchPreferenceFilters([{...base,searchFacets:{...base.searchFacets,futureFacet:['X']}}],{futureFacet:['X']},extensible).length,1);

const workflow=fs.readFileSync('workflow-template/update-jobs.yml','utf8');
assert.match(workflow,/test-v120-stage9-foundation\.mjs/);
assert.match(workflow,/stage9-filter-run\.mjs/);
assert.match(workflow,/data\/stage9-filter-report\.json/);
console.log('v120 stage9 foundation tests passed');
