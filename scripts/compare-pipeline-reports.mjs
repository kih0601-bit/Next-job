import fs from 'node:fs/promises';
const current = JSON.parse(await fs.readFile('data/pipeline-report.json','utf8'));
let previous = null;
try { previous = JSON.parse(await fs.readFile('data/pipeline-report.previous.json','utf8')); } catch {}
const metrics = ['access','list','detail','attachmentDiscovery','attachmentDownload','documentAnalysis'];
const byOrg = new Map((previous?.sources || []).map(s => [s.org,s]));

function regressionCauseFromStages(now, stageChanges={}) {
  const order=['access','list','detail','attachmentDiscovery','attachmentDownload','documentAnalysis'];
  const key=order.find(k=>stageChanges[k]?.change==='regressed');
  if(!key) return now.primaryCause || null;
  const stage=key==='attachmentDiscovery' ? (now.attachmentDiscovery||now.attachment) : now[key];
  const codes={access:'ACCESS_REGRESSED',list:'LIST_REGRESSED',detail:'DETAIL_REGRESSED',attachmentDiscovery:'ATTACHMENT_DISCOVERY_REGRESSED',attachmentDownload:'ATTACHMENT_DOWNLOAD_REGRESSED',documentAnalysis:'DOCUMENT_ANALYSIS_REGRESSED'};
  const detail={ok:Boolean(stage?.ok),status:stage?.status||'',attempted:stage?.attempted??null,downloaded:stage?.downloaded??null,parsed:stage?.parsed??null,failed:stage?.failed??null,error:stage?.error||'',samples:(stage?.samples||[]).slice(0,5)};
  return {stage:key,status:'failed',code:codes[key],reason:`이전 실행 true → 현재 false: ${key}`,evidence:[detail],source:'pipeline-diff-stage'};
}

const changes = (current.sources || []).map(now => {
  const before = byOrg.get(now.org);
  const stageChanges = {};
  for (const key of metrics) {
    const beforeStage = key === 'attachmentDiscovery' ? (before?.attachmentDiscovery || before?.attachment) : before?.[key];
    const nowStage = key === 'attachmentDiscovery' ? (now?.attachmentDiscovery || now?.attachment) : now?.[key];
    const from = before ? Boolean(beforeStage?.ok) : null;
    const to = Boolean(nowStage?.ok);
    stageChanges[key] = { from, to, change: from === null ? 'new' : from === to ? 'same' : to ? 'improved' : 'regressed' };
  }
  const improved = Object.values(stageChanges).some(x => x.change === 'improved');
  const regressed = Object.values(stageChanges).some(x => x.change === 'regressed');
  return { org: now.org, health: now.health, primaryCause: now.primaryCause, regressionCause: regressionCauseFromStages(now,stageChanges), stages: stageChanges, improved, regressed };
});
const payload = { generatedAt: new Date().toISOString(), baselineAvailable: Boolean(previous), summary: { improved: changes.filter(c=>c.improved).length, regressed: changes.filter(c=>c.regressed).length, unchanged: changes.filter(c=>!c.improved&&!c.regressed).length }, changes };
await fs.writeFile('data/pipeline-diff.json', `${JSON.stringify(payload,null,2)}\n`);
await fs.writeFile('data/pipeline-report.previous.json', `${JSON.stringify(current,null,2)}\n`);
console.log(payload.summary);
