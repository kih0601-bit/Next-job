import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePosting } from '../src/lib/normalize.mjs';
import { classifyPosting, dedupe } from '../src/lib/reconcile.mjs';
import { validateExtraction } from '../src/lib/validate-extraction.mjs';
import { scoreCase, aggregate } from '../src/lib/scorer.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const fx=JSON.parse(await fs.readFile(path.resolve(here,'../benchmark/inputs/fixture-postings.json'),'utf8'));
const n=fx.map(x=>normalizePosting(x.source,x));
assert.equal(n.length,3);
assert.equal(classifyPosting(n[0]),'recruitment');
assert.equal(classifyPosting(n[1]),'preannouncement');
assert.equal(classifyPosting(n[2]),'result');
assert.equal(dedupe([...n,n[0]]).length,3);

const valid={postingType:'recruitment',warnings:[],recruitmentUnits:[{unitName:'전기',headcount:1,employmentType:'정규직',workplaces:['울산'],requirements:{education:{status:'unknown',value:null,logic:'unknown',evidenceIds:[]},experience:{status:'unknown',value:null,logic:'unknown',evidenceIds:[]},licenses:{status:'required',value:'전기산업기사 이상',logic:'none',evidenceIds:['e1']},age:{status:'unknown',value:null,logic:'unknown',evidenceIds:[]},majorJob:{status:'unknown',value:null,logic:'unknown',evidenceIds:[]},region:{status:'unknown',value:null,logic:'unknown',evidenceIds:[]},legalOther:{status:'unknown',value:null,logic:'unknown',evidenceIds:[]}},evidence:[{id:'e1',sourceType:'api',sourceRef:'fixture',quote:'전기산업기사 이상 필수'}]}]};
assert.equal(validateExtraction(valid).ok,true);
const bad=structuredClone(valid); bad.recruitmentUnits[0].requirements.licenses.evidenceIds=[];
assert.equal(validateExtraction(bad).ok,false);

const s=scoreCase({recruitmentUnits:[valid.recruitmentUnits[0]]},valid);
assert.equal(s.requiredRecall,1);
assert.equal(aggregate([s]).requiredRecall,1);


// v133 official API contract guards
const jobAlioCode=await fs.readFile(path.join(root,'src/adapters/job-alio.mjs'),'utf8');
assert.match(jobAlioCode,/resultType/,'JOB-ALIO must use official resultType parameter');
const cleaneyeCode=await fs.readFile(path.join(root,'src/adapters/cleaneye.mjs'),'utf8');
assert.match(cleaneyeCode,/sidoCd/,'Cleaneye must require official sidoCd parameter');
assert.match(cleaneyeCode,/type','xml/,'Cleaneye must request XML');

console.log('v2 prototype self-test PASS');
