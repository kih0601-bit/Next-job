import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildStage9Unit, evaluateStage9Eligibility } from './lib/stage9-filter-engine.mjs';

const profile=JSON.parse(fs.readFileSync('data/stage9-user-profile.json','utf8'));
const policy=JSON.parse(fs.readFileSync('data/stage9-organization-region-policy.json','utf8'));
assert.equal(profile.experienceKnown,true);
assert.equal(profile.experienceYears,0);
assert.equal(profile.licensesKnown,true);
assert.deepEqual(profile.licenses,[]);

const req={
  education:{values:['학력무관'],resolution:'explicit-no-restriction'},
  licenses:[{level:'required',value:'전기기사',evidence:['전기기사 필수']}],
  experience:[],age:[],major:[],legalOrIdentity:[],other:[]
};
const result=evaluateStage9Eligibility(req,profile);
assert.equal(result.status,'ineligible');
assert.equal(result.dimensions.licenses.status,'fail');
assert.equal(result.specUp.possible,true);

const local=buildStage9Unit({
  posting:{org:'울산정보산업진흥원',title:'직원 채용 공고'},
  unit:{name:'일반행정',requirements:{education:{values:['학력무관'],resolution:'explicit-no-restriction'},licenses:[],experience:[],age:[],major:[],legalOrIdentity:[],other:[]}},
  profile,organizationRegionPolicy:policy
});
assert.deepEqual(local.searchFacets.region,['울산']);
assert.equal(local.searchFacetProvenance.region.source,'organization-inferred');

const nationwide=buildStage9Unit({
  posting:{org:'한국산업안전보건공단',title:'신규직원 채용'},
  unit:{name:'일반',requirements:{education:{values:['학력무관'],resolution:'explicit-no-restriction'},licenses:[],experience:[],age:[],major:[],legalOrIdentity:[],other:[]}},
  profile,organizationRegionPolicy:policy
});
assert.deepEqual(nationwide.searchFacets.region,[]);
assert.equal(nationwide.searchFacetProvenance.region.source,'unknown');

const explicit=buildStage9Unit({
  posting:{org:'한국산업안전보건공단',title:'신규직원 채용'},
  unit:{name:'일반',workLocations:['부산광역시'],requirements:{education:{values:['학력무관'],resolution:'explicit-no-restriction'},licenses:[],experience:[],age:[],major:[],legalOrIdentity:[],other:[]}},
  profile,organizationRegionPolicy:policy
});
assert.deepEqual(explicit.searchFacets.region,['부산']);
assert.equal(explicit.searchFacetProvenance.region.source,'posting-explicit');

const residencyOnly=buildStage9Unit({
  posting:{org:'한국산업안전보건공단',title:'신규직원 채용'},
  unit:{name:'일반',evidenceScope:{document:'지원자는 울산광역시에 주민등록이 되어 있는 자'},requirements:{education:{values:['학력무관'],resolution:'explicit-no-restriction'},licenses:[],experience:[],age:[],major:[],legalOrIdentity:[],other:[]}},
  profile,organizationRegionPolicy:policy
});
assert.deepEqual(residencyOnly.searchFacets.region,[],'residency eligibility must not be mistaken for work region');

console.log('v122 Stage9 known-zero profile + provenance-safe region fallback tests passed');
