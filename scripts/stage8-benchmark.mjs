import fs from 'node:fs/promises';

const REPORT='data/stage8-eligibility-report.json';
const QUALITY='data/stage8-quality-report.json';
const TRUTH='data/stage8-benchmark-ground-truth.json';
const OUT='data/stage8-benchmark-result.json';
const REQUIREMENT='data/requirement-report.json';
const QA='data/qa-report.json';
const SNAPSHOT='data/stage7-stage8-snapshot.json';

const report=JSON.parse(await fs.readFile(REPORT,'utf8'));
const quality=JSON.parse(await fs.readFile(QUALITY,'utf8'));
const truth=JSON.parse(await fs.readFile(TRUTH,'utf8'));
const byKey=new Map((report.postings||[]).map(p=>[`${p.posting.org}|${p.posting.title}`,p]));
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const sameSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
const rows=[];

for(const sample of truth.samples||[]){
  const posting=byKey.get(`${sample.org}|${sample.title}`),failures=[];
  if(!posting){ rows.push({...sample,pass:false,failures:['posting-not-found'],observed:null}); continue; }
  const units=posting.recruitmentUnits||[];
  const observedNames=units.map(x=>norm(x.name));
  const expectedNames=(sample.expectedUnitNames||[]).map(norm);
  if(!sameSet(expectedNames,observedNames)) failures.push(`unit-names-mismatch expected=${expectedNames.join(' / ')} observed=${observedNames.join(' / ')}`);
  if(Number(sample.minAlternativeOptionsPerUnit||0)>0){
    for(const unit of units){
      const maxOptions=Math.max(0,...(unit.requirements?.qualificationAlternatives||[]).map(g=>(g.options||[]).length));
      if(maxOptions<Number(sample.minAlternativeOptionsPerUnit)) failures.push(`alternative-paths-missing:${unit.name}:${maxOptions}`);
    }
  }
  if(sample.expectNoQualificationEvidence){
    const evidence=units.reduce((n,u)=>n+Number(u.requirementSummary?.required||0)+Number(u.requirementSummary?.preferred||0),0);
    if(evidence!==0) failures.push(`unexpected-qualified-requirements:${evidence}`);
  }
  rows.push({id:sample.id,org:sample.org,title:sample.title,pass:failures.length===0,failures,observed:{unitNames:observedNames,alternativeOptions:units.map(u=>({unit:u.name,maxOptions:Math.max(0,...(u.requirements?.qualificationAlternatives||[]).map(g=>(g.options||[]).length))}))}});
}

const passed=rows.filter(x=>x.pass).length;
const result={version:'1.1.0-v117-live-closure-wiring',generatedAt:new Date().toISOString(),status:passed===rows.length&&rows.length>=7?'passed':'failed',reviewedSamples:rows.length,passed,failed:rows.length-passed,rows};
quality.benchmark={status:result.status,required:true,reviewedSamples:rows.length,passed,failed:rows.length-passed,source:TRUTH};

let snapshotTrust='unknown';
try { snapshotTrust=JSON.parse(await fs.readFile(SNAPSHOT,'utf8'))?.trust?.status||'unknown'; } catch {}
const noFailedPostings=Number(report?.summary?.failed||0)===0;
const noActionableStructuralBlockers=(quality.structuralBlockers||[]).length===0;
const benchmarkPassed=result.status==='passed';
const isLiveRun=report.executionMode!=='stage8-fast-snapshot';
const liveClosureEligible=isLiveRun && benchmarkPassed && noFailedPostings && noActionableStructuralBlockers && snapshotTrust==='verified';

quality.closureEligible=liveClosureEligible;
quality.closureReason=liveClosureEligible
  ? 'Live Stage 7 input verified + failed postings 0 + actionable structural blockers 0 + source-grounded benchmark passed. Partial postings remain diagnostic watch only.'
  : (isLiveRun?'Live Stage 7 trust, failed postings, actionable structural blockers, or benchmark failure remains.':'Fast snapshot benchmark passed/failed locally; live full-run closure is still required.');
quality.liveClosure={isLiveRun,snapshotTrust,noFailedPostings,noActionableStructuralBlockers,benchmarkPassed,partialPostings:Number(report?.summary?.partial||0),partialPolicy:'watch-only when no actionable structural blocker remains'};

report.qualityAudit=quality;
report.stage8Gate.benchmarkStatus=result.status;
report.stage8Gate.accuracyValidationRequired=true;
report.stage8Gate.liveSnapshotTrust=snapshotTrust;
report.stage8Gate.partialPolicy='partial postings are watch-only after actionable structural audit; they do not permanently block closure by themselves';
const prior=(report.stage8Gate.closureBlockers||[]).filter(x=>!['benchmark-accuracy-validation-not-established','benchmark-accuracy-validation-failed','partial-postings','live-full-pipeline-validation-required'].includes(x));
report.stage8Gate.closureBlockers=[...new Set([
  ...prior,
  ...((quality.structuralBlockers||[]).length?quality.structuralBlockers:[]),
  ...(benchmarkPassed?[]:['benchmark-accuracy-validation-failed']),
  ...(snapshotTrust==='verified'?[]:['live-stage7-input-not-verified']),
  ...(noFailedPostings?[]:['failed-postings'])
])];
report.stage8Gate.decision=liveClosureEligible?'stage-8-complete':(benchmarkPassed&&noFailedPostings&&noActionableStructuralBlockers?'stage-8-benchmark-passed-await-live-closure':'keep-stage-8-open');
report.stage8Gate.rule='Stage 8 closes on verified live Stage 7 input + failed postings 0 + actionable structural blockers 0 + source-grounded benchmark pass. Non-actionable historical/closed/out-of-target and partial-document watches remain accumulated diagnostics, not permanent blockers.';

let qa={};
try { qa=JSON.parse(await fs.readFile(QA,'utf8')); } catch {}
qa.stage8={...(qa.stage8||{}),checked:quality.counts?.units||0,status:quality.status,closureEligible:quality.closureEligible,benchmarkStatus:result.status,benchmarkPassed:passed,benchmarkFailed:rows.length-passed,decision:report.stage8Gate.decision,snapshotTrust};
qa.updatedAt=new Date().toISOString();

const requirementReport={...report,compatibilityAlias:'data/stage8-eligibility-report.json'};
await Promise.all([
  fs.writeFile(OUT,`${JSON.stringify(result,null,2)}\n`),
  fs.writeFile(QUALITY,`${JSON.stringify(quality,null,2)}\n`),
  fs.writeFile(REPORT,`${JSON.stringify(report,null,2)}\n`),
  fs.writeFile(REQUIREMENT,`${JSON.stringify(requirementReport,null,2)}\n`),
  fs.writeFile(QA,`${JSON.stringify(qa,null,2)}\n`)
]);
console.log({benchmark:result.status,reviewed:rows.length,passed,failed:rows.length-passed,isLiveRun,snapshotTrust,closureEligible:quality.closureEligible,decision:report.stage8Gate.decision});
if(result.status!=='passed') process.exitCode=2;
