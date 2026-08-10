import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverJobAlio } from './adapters/job-alio.mjs';
import { discoverCleaneye } from './adapters/cleaneye.mjs';
import { buildCases,selectBalanced,summarize } from './code/code-benchmark-lib.mjs';

const YEAR=Number(process.env.NEXTJOB_BENCHMARK_YEAR||new Date().getFullYear());
const TARGET=Number(process.env.NEXTJOB_BENCHMARK_TARGET||100);
const OUT=path.resolve('v2-prototype/output/code-benchmark');
const JOBALIO_ROWS=100;
const JOBALIO_MAX_PAGES=Number(process.env.NEXTJOB_BENCHMARK_JOBALIO_MAX_PAGES||20);
await fs.mkdir(OUT,{recursive:true});

const raw={jobAlio:[],cleaneye:[],errors:[],sourceStatus:{}};

// JOB-ALIO is the primary benchmark source. Keep paging until we have enough
// current-year candidates rather than assuming two pages are sufficient.
try{
  let currentYearCases=0;
  let pagesFetched=0;
  for(let page=1; page<=JOBALIO_MAX_PAGES; page++){
    const rows=await discoverJobAlio({page,rows:JOBALIO_ROWS});
    pagesFetched=page;
    if(!rows.length) break;
    raw.jobAlio.push(...rows);
    currentYearCases=buildCases('job-alio',raw.jobAlio,{year:YEAR}).length;
    if(currentYearCases>=TARGET) break;
    if(rows.length<JOBALIO_ROWS) break;
  }
  raw.sourceStatus.jobAlio={status:'ok',pagesFetched,rawRows:raw.jobAlio.length,currentYearCases};
}catch(e){
  raw.errors.push({source:'job-alio',kind:'fetch_error',error:String(e?.stack||e)});
  raw.sourceStatus.jobAlio={status:'error',rawRows:raw.jobAlio.length};
}

// Cleaneye is supplemental for source diversity. Authorization/outage must not
// prevent a valid JOB-ALIO-only 100-case benchmark from being produced.
const sidoCodes=Array.from({length:17},(_,i)=>`007${String(i+1).padStart(3,'0')}`);
let cleaneyeOk=0, cleaneyeForbidden=0, cleaneyeOtherErrors=0;
for(const sidoCd of sidoCodes){
  try{
    const rows=await discoverCleaneye({sidoCd,rows:100});
    raw.cleaneye.push(...rows); cleaneyeOk++;
  } catch(e){
    const msg=String(e?.message||e);
    const status=/\b403\b/.test(msg)?'authorization_forbidden':'fetch_error';
    if(status==='authorization_forbidden') cleaneyeForbidden++; else cleaneyeOtherErrors++;
    raw.errors.push({source:'cleaneye',sidoCd,kind:status,error:msg});
  }
}
raw.sourceStatus.cleaneye={
  status: cleaneyeOk ? (cleaneyeForbidden||cleaneyeOtherErrors?'partial':'ok') : (cleaneyeForbidden===sidoCodes.length?'authorization_forbidden':'error'),
  regionsOk:cleaneyeOk,regionsForbidden:cleaneyeForbidden,regionsOtherErrors:cleaneyeOtherErrors,rawRows:raw.cleaneye.length,
  note:cleaneyeForbidden?'403 is an API access/authentication-layer failure (for example approval state or invalid/mis-encoded service key). It is not treated as a parser failure.':undefined
};

const all=[
  ...buildCases('job-alio',raw.jobAlio,{year:YEAR}),
  ...buildCases('cleaneye',raw.cleaneye,{year:YEAR})
];
const selected=selectBalanced(all,TARGET);
const summary=summarize(selected);
const report={
  schemaVersion:'nextjob-v2-code-benchmark-capture-v2',generatedAt:new Date().toISOString(),year:YEAR,target:TARGET,selected:selected.length,
  summary,sourceStatus:raw.sourceStatus,errors:raw.errors,
  benchmarkValidity:selected.length>=TARGET?'sample_complete':'sample_incomplete',
  note:'candidate_complete/unresolved are automatic triage only. Wrong/Correct must be assigned by human source comparison; this workflow intentionally does not self-certify accuracy.'
};
await fs.writeFile(path.join(OUT,'raw-api-sample.json'),JSON.stringify({year:YEAR,jobAlio:raw.jobAlio,cleaneye:raw.cleaneye,sourceStatus:raw.sourceStatus,errors:raw.errors},null,2));
await fs.writeFile(path.join(OUT,'selected-100-code-predictions.json'),JSON.stringify(selected,null,2));
await fs.writeFile(path.join(OUT,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

// A source-specific failure is diagnostic evidence, not an automatic benchmark
// failure. Fail only when the requested sample itself could not be assembled.
if(selected.length<TARGET){
  console.error(`Only ${selected.length}/${TARGET} benchmark cases selected. Artifact is still uploaded for diagnosis.`);
  process.exitCode=2;
}
