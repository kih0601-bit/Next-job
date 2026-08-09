import fs from 'node:fs/promises';
import { REPORT_SCHEMA_VERSION, sourceHealth, difficultyFor, priorityFor } from './lib/report-schema.mjs';
import { stageStatuses, summarizeStages, verificationSystems } from './lib/pipeline-status.mjs';
const path='data/pipeline-report.json';
const report=JSON.parse(await fs.readFile(path,'utf8'));
const sources=(report.sources||[]).map(source=>{
  const stages=stageStatuses(source); const stageSummary=summarizeStages(stages);
  return {...source, stages, stageSummary, verificationSystems:verificationSystems(source), legacyHealth:sourceHealth(source), difficulty:difficultyFor(source), priority:priorityFor(source)};
}).sort((a,b)=>b.priority.score-a.priority.score||a.org.localeCompare(b.org,'ko'));
const summary={...report.summary,
  verifiedStageCount:sources.reduce((n,s)=>n+s.stageSummary.verified,0),
  unknownStageCount:sources.reduce((n,s)=>n+s.stageSummary.unknown,0),
  failedStageCount:sources.reduce((n,s)=>n+s.stageSummary.failed,0),
  notImplementedStageCount:sources.reduce((n,s)=>n+s.stageSummary.notImplemented,0),
  pipelineComplete:sources.filter(s=>s.stageSummary.pipelineComplete).length,
  sourceProvenanceVerified:sources.filter(s=>s.stages.source.status==='verified').length,
  sourceProvenanceUnknown:sources.filter(s=>s.stages.source.status==='unknown').length,
  legacyHealth:{healthy:sources.filter(s=>s.legacyHealth==='healthy').length,degraded:sources.filter(s=>s.legacyHealth==='degraded').length,failed:sources.filter(s=>s.legacyHealth==='failed').length,deprecated:true}
};
const payload={...report,schemaVersion:REPORT_SCHEMA_VERSION,reportType:'institution-centered-unified-pipeline-report',policy:'공식 10단계 × 4상태(검증완료/확인불가/실패/미구현)를 메인 판정으로 사용. Health는 운영단계 재정의 전까지 호환용.',summary,sources};
await fs.writeFile(path,`${JSON.stringify(payload,null,2)}\n`,'utf8');
console.log({reportPath:path,schemaVersion:REPORT_SCHEMA_VERSION,summary});
