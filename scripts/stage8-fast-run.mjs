import fs from 'node:fs/promises';
import { analyzeVacancies } from './lib/classifier.mjs';
import { buildStage8Posting, buildStage8Report } from './lib/stage8-eligibility-structure.mjs';
import { auditStage8Quality } from './lib/stage8-quality-audit.mjs';

const BASELINE='data/stage7-stage8-baseline.json';
const LEGACY_SNAPSHOT='data/stage7-stage8-snapshot.json';
const CANDIDATE='data/stage7-stage8-candidate.json';
const now=new Date().toISOString();
let snapshot;
try { snapshot=JSON.parse(await fs.readFile(BASELINE,'utf8')); }
catch {
  try { snapshot=JSON.parse(await fs.readFile(LEGACY_SNAPSHOT,'utf8')); }
  catch { throw new Error('STAGE8_BASELINE_NOT_AVAILABLE: run the full workflow once and establish a Stage 7→8 baseline.'); }
}
if(!Array.isArray(snapshot?.inputs) || snapshot.inputs.length===0) throw new Error('STAGE8_SNAPSHOT_EMPTY: full workflow must create a non-empty Stage 7→8 boundary snapshot first.');

const postings=[];
for(const input of snapshot.inputs){
  const vacancies=analyzeVacancies({
    title:input.title||'', listText:input.listText||'', detailText:input.detailText||'',
    documentText:input.documents?.text||'', detailOk:Boolean(input.detailOk)
  });
  postings.push(buildStage8Posting({...input,vacancies}));
}
const report=buildStage8Report(postings,now);
report.executionMode='stage8-fast-snapshot';
report.snapshot={role:'baseline',version:snapshot.version||'',generatedAt:snapshot.generatedAt||'',trust:snapshot.trust||{status:'unknown'},inputCount:snapshot.inputs.length};
report.inputDiagnostics={candidateCount:snapshot.inputs.length,derivedPostingCount:postings.length,byOrg:[]};
const quality=auditStage8Quality(report,{inputDiagnostics:report.inputDiagnostics});
quality.executionMode='stage8-fast-snapshot';
quality.snapshotTrust=snapshot.trust||{status:'unknown'};
report.qualityAudit=quality;
report.stage8Gate.preQualityDecision=report.stage8Gate.decision;
report.stage8Gate.accuracyValidationRequired=true;
report.stage8Gate.qualityAuditStatus=quality.status;
report.stage8Gate.benchmarkStatus=quality.benchmark.status;
report.stage8Gate.decision='keep-stage-8-open';
report.stage8Gate.closureBlockers=[
  ...(report.stage8Gate.blockers||[]).length?['failed-postings']:[],
  ...(report.stage8Gate.watch||[]).length?['partial-postings']:[],
  ...quality.structuralBlockers,
  ...(snapshot?.trust?.status==='verified'?[]:['snapshot-stage7-trust-not-verified']),
  'live-full-pipeline-validation-required',
  'benchmark-accuracy-validation-not-established'
];
report.stage8Gate.rule='Fast-run proves deterministic Stage 8 behavior on a fixed Stage 7 snapshot only. Closure requires trusted Stage 7 input + live 1→8 full run + benchmark accuracy validation.';

const benchmarkRows=[
 ...(quality.samples?.singleDespiteMultiSignal||[]).map(x=>({...x,risk:'single-despite-multi-signal'})),
 ...(quality.samples?.unreadRequiredSources||[]).map(x=>({...x,risk:'unread-required-source'})),
 ...(quality.samples?.lowConfidenceSingles||[]).map(x=>({...x,risk:'low-confidence-single'})),
 ...(quality.samples?.noEvidenceUnits||[]).map(x=>({...x,risk:'no-evidence-unit'}))
];
const seen=new Set();
const benchmark={version:'1.0.0',generatedAt:now,status:'candidate-set-only',executionMode:'stage8-fast-snapshot',note:'정답표가 아니라 원문 대조 우선 표본. Benchmark 통과 근거로 단독 사용 금지.',samples:benchmarkRows.filter(x=>{const k=`${x.org}|${x.link}|${x.unit||''}|${x.risk}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,120)};

let candidate=null; try { candidate=JSON.parse(await fs.readFile(CANDIDATE,'utf8')); } catch {}
const baselineGraduated = report.summary.failed===0 && report.summary.partial===0 && quality.structuralBlockers.length===0;
const lifecycle={version:'1.0.0',generatedAt:now,baseline:{generatedAt:snapshot.generatedAt||'',trust:snapshot.trust?.status||'unknown',inputs:snapshot.inputs.length,graduated:baselineGraduated},candidate:candidate?{generatedAt:candidate.generatedAt||'',trust:candidate.trust?.status||'unknown',inputs:candidate.inputs?.length||0}:null,promotionEligible:Boolean(baselineGraduated && candidate?.trust?.status==='verified'),rule:'Keep baseline fixed until its normal inputs are structurally handled. Full runs create candidate snapshots; baseline promotion is explicit after graduation. Stage-7-invalid baseline may be replaced by a corrected snapshot.'};
await Promise.all([
 fs.writeFile('data/stage8-eligibility-report.json',`${JSON.stringify(report,null,2)}\n`,'utf8'),
 fs.writeFile('data/stage8-quality-report.json',`${JSON.stringify(quality,null,2)}\n`,'utf8'),
 fs.writeFile('data/stage8-snapshot-lifecycle.json',`${JSON.stringify(lifecycle,null,2)}\n`,'utf8'),
 fs.writeFile('data/stage8-benchmark-candidates.json',`${JSON.stringify(benchmark,null,2)}\n`,'utf8'),
 fs.writeFile('data/qa-report.json',`${JSON.stringify({version:'stage8-fast',updatedAt:now,stage8:{checked:quality.counts.units,status:quality.status,closureEligible:false,executionMode:'stage8-fast-snapshot',snapshotTrust:snapshot.trust?.status||'unknown'}},null,2)}\n`,'utf8')
]);
console.log({mode:'stage8-fast-snapshot',snapshotTrust:snapshot.trust?.status||'unknown',inputs:snapshot.inputs.length,postings:report.summary.postingCount,units:report.summary.recruitmentUnitCount,quality:quality.status});
