import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreCase, aggregate } from './lib/scorer.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const truthPath=path.join(root,'benchmark','ground-truth','sealed-30.json');
const predPath=path.join(root,'output','benchmark-capture','predictions.json');
const outDir=path.join(root,'output','benchmark-score');
let truth;
try{truth=JSON.parse(await fs.readFile(truthPath,'utf8'));}catch{throw new Error('sealed Ground Truth missing: benchmark/ground-truth/sealed-30.json');}
const pred=JSON.parse(await fs.readFile(predPath,'utf8'));
const pBy=new Map((pred.predictions||[]).map(x=>[x.caseId,x]));
const scores=[]; const cases=[];
for(const t of truth.cases||[]){
  const p=pBy.get(t.caseId);
  if(!p?.extraction){cases.push({caseId:t.caseId,status:'missing-prediction'});continue;}
  const s=scoreCase(t.truth,p.extraction); scores.push(s); cases.push({caseId:t.caseId,status:'scored',score:s,validation:p.validation});
}
const agg=aggregate(scores);
const gate={
  recruitmentUnitAccuracy:agg.unitNameRecall>=0.98 && agg.unitCountExactRate>=0.98,
  requiredRecall:agg.requiredRecall>=0.99,
  evidenceLessRequired:agg.evidenceRequiredMissing===0,
  // False PASS is measured only after user-profile truth is added; do not fake it here.
  falsePassMeasured:false
};
await fs.mkdir(outDir,{recursive:true});
await fs.writeFile(path.join(outDir,'score.json'),JSON.stringify({generatedAt:new Date().toISOString(),aggregate:agg,gate,cases},null,2));
console.log(JSON.stringify({ok:true,aggregate:agg,gate},null,2));
