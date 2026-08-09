import fs from 'node:fs/promises';
import { stageStatuses, summarizeStages } from './lib/pipeline-status.mjs';

const REPORT='data/pipeline-report.json', STATUS='docs/source-status.json';
const report=JSON.parse(await fs.readFile(REPORT,'utf8'));
let doc={schemaVersion:'1.3.0',purpose:'기관별 현재 상태의 단일 기준정보',rules:{},sources:[]};
try{doc=JSON.parse(await fs.readFile(STATUS,'utf8'));}catch{}
const byOrg=new Map((report.sources||[]).map(x=>[x.org,x]));
const observedVersion=report.version || report.generatedAt || 'current';
doc.schemaVersion='1.3.0'; doc.lastObservedVersion=observedVersion; doc.lastObservedAt=report.generatedAt || new Date().toISOString(); delete doc.pendingValidationVersion;
doc.sources=(doc.sources||[]).map(old=>{
 const cur=byOrg.get(old.org); if(!cur) return old;
 const stages=stageStatuses(cur), summary=summarizeStages(stages);
 const next={...old,
   access:cur.access?.recruitVerifyOk?'success':'failed', list:cur.list?.status||'unknown', detail:cur.detail?.ok?'success':'failed',
   attachmentDiscovery:cur.attachmentDiscovery?.status || (cur.attachmentDiscovery?.ok?'success':'failed'), attachmentDownload:cur.attachmentDownload?.status||'unknown',
   documentAnalysis:{status:cur.documentAnalysis?.status||'unknown',strictOk:Boolean(cur.documentAnalysis?.ok),attempted:cur.documentAnalysis?.attempted||0,parsed:cur.documentAnalysis?.parsed||0,observedCapability:Boolean(cur.documentAnalysis?.capabilityOk)},
   bottleneck: (cur.pagination?.implementationOk ?? cur.pagination?.ok) ? '1~7단계 구현 검증 통과' : cur.pagination?.status && cur.pagination.status!=='not-evaluated' ? `7단계 전체 페이지 확장: ${cur.pagination.status}` : '1~6단계 현재 검증 범위 통과',
   primaryCause: cur.diagnosis?.primary || {stage:(cur.pagination?.implementationOk ?? cur.pagination?.ok)?'complete':'pagination',status:(cur.pagination?.implementationOk ?? cur.pagination?.ok)?'success':'pending',code:cur.pagination?.status||'PAGINATION_PENDING',reason:cur.pagination?.reconciliation?.reason||cur.pagination?.status||'전체 페이지 확장 검증 중'},
   lastObservedVersion:observedVersion, lastObservedAt:report.generatedAt || new Date().toISOString(), pipelineStages:stages, pipelineSummary:summary, legacyHealthDeprecated:true
 };
 for(const k of ['pendingAction','pendingValidationVersion','pendingPatch']) delete next[k];
 return next;
});
await fs.writeFile(STATUS,`${JSON.stringify(doc,null,2)}\n`,'utf8');
console.log({sourceStatus:'synced',sources:doc.sources.length});
