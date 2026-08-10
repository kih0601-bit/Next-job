import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverJobAlio } from './adapters/job-alio.mjs';
import { discoverCleaneye } from './adapters/cleaneye.mjs';
import { buildCases,selectBalanced,summarize } from './code/code-benchmark-lib.mjs';

const YEAR=Number(process.env.NEXTJOB_BENCHMARK_YEAR||new Date().getFullYear());
const TARGET=Number(process.env.NEXTJOB_BENCHMARK_TARGET||100);
const OUT=path.resolve('v2-prototype/output/code-benchmark');
await fs.mkdir(OUT,{recursive:true});

const raw={jobAlio:[],cleaneye:[],errors:[]};
try{
  // Two pages reduce first-page sampling bias while keeping API cost/free-call volume tiny.
  for(let page=1; page<=2; page++) raw.jobAlio.push(...await discoverJobAlio({page,rows:100}));
}catch(e){raw.errors.push({source:'job-alio',error:String(e?.stack||e)});}

const sidoCodes=Array.from({length:17},(_,i)=>`007${String(i+1).padStart(3,'0')}`);
for(const sidoCd of sidoCodes){
  try{ raw.cleaneye.push(...await discoverCleaneye({sidoCd,rows:100})); }
  catch(e){ raw.errors.push({source:'cleaneye',sidoCd,error:String(e?.message||e)}); }
}

const all=[...buildCases('job-alio',raw.jobAlio,{year:YEAR}),...buildCases('cleaneye',raw.cleaneye,{year:YEAR})];
const selected=selectBalanced(all,TARGET);
const summary=summarize(selected);
const report={schemaVersion:'nextjob-v2-code-benchmark-capture-v1',generatedAt:new Date().toISOString(),year:YEAR,target:TARGET,selected:selected.length,summary,errors:raw.errors,
  note:'candidate_complete/unresolved are automatic triage only. Wrong/Correct must be assigned by human source comparison; this workflow intentionally does not self-certify accuracy.'};
await fs.writeFile(path.join(OUT,'raw-api-sample.json'),JSON.stringify({year:YEAR,jobAlio:raw.jobAlio,cleaneye:raw.cleaneye,errors:raw.errors},null,2));
await fs.writeFile(path.join(OUT,'selected-100-code-predictions.json'),JSON.stringify(selected,null,2));
await fs.writeFile(path.join(OUT,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(selected.length<TARGET){console.error(`Only ${selected.length}/${TARGET} benchmark cases selected`); process.exitCode=2;}
