import fs from 'node:fs/promises';
const current = JSON.parse(await fs.readFile('data/pipeline-report.json','utf8'));
let previous = null;
try { previous = JSON.parse(await fs.readFile('data/pipeline-report.previous.json','utf8')); } catch {}
const metrics = ['access','list','detail','attachment'];
const byOrg = new Map((previous?.sources || []).map(s => [s.org,s]));
const changes = (current.sources || []).map(now => {
  const before = byOrg.get(now.org);
  const stageChanges = {};
  for (const key of metrics) {
    const from = before ? Boolean(before[key]?.ok) : null;
    const to = Boolean(now[key]?.ok);
    stageChanges[key] = { from, to, change: from === null ? 'new' : from === to ? 'same' : to ? 'improved' : 'regressed' };
  }
  const improved = Object.values(stageChanges).some(x => x.change === 'improved');
  const regressed = Object.values(stageChanges).some(x => x.change === 'regressed');
  return { org: now.org, health: now.health, primaryCause: now.primaryCause, stages: stageChanges, improved, regressed };
});
const payload = { generatedAt: new Date().toISOString(), baselineAvailable: Boolean(previous), summary: { improved: changes.filter(c=>c.improved).length, regressed: changes.filter(c=>c.regressed).length, unchanged: changes.filter(c=>!c.improved&&!c.regressed).length }, changes };
await fs.writeFile('data/pipeline-diff.json', `${JSON.stringify(payload,null,2)}\n`);
await fs.writeFile('data/pipeline-report.previous.json', `${JSON.stringify(current,null,2)}\n`);
console.log(payload.summary);
