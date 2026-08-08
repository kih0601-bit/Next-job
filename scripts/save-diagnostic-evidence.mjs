import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_TEXT = 120000;
const canonicalOrg = value => String(value || 'unknown').normalize('NFC').replace(/[\s_-]+/g, ' ').trim();
const slug = value => canonicalOrg(value).replace(/[^a-zA-Z0-9가-힣]+/g, '_').replace(/^_+|_+$/g, '').slice(0,80) || 'unknown';
const report = JSON.parse(await fs.readFile('data/pipeline-report.json','utf8'));
let artifacts = { artifacts: [] };
try { artifacts = JSON.parse(await fs.readFile('data/pipeline-artifacts.json','utf8')); } catch {}
// Preserve passive list diagnostics produced by pipeline-probe.mjs.
// This step only adds/updates diagnosis.json and evidence.json.
await fs.mkdir('data/diagnostics', { recursive: true });
// Remove only the legacy collision folder created by the old Hangul slug bug.
await fs.rm('data/diagnostics/unknown', { recursive: true, force: true });
for (const source of report.sources || []) {
  if (source.health === 'healthy') continue;
  const dir = path.join('data/diagnostics', slug(source.org));
  await fs.mkdir(dir, { recursive: true });
  const sourceArtifacts = (artifacts.artifacts || []).filter(a => a.org === source.org).map(a => ({...a, htmlHead: String(a.htmlHead || '').slice(0, MAX_TEXT)}));
  await fs.writeFile(path.join(dir,'diagnosis.json'), `${JSON.stringify({
    org: source.org,
    health: source.health,
    primaryCause: source.primaryCause,
    diagnosis: source.diagnosis,
    repairTarget: source.primaryCause?.repairTarget || '',
    recommendedAction: source.primaryCause?.recommendedAction || '',
    stages: { access: source.access, list: source.list, detail: source.detail, attachmentDiscovery: source.attachmentDiscovery || source.attachment, attachmentDownload: source.attachmentDownload, documentAnalysis: source.documentAnalysis, attachment: source.attachment }
  }, null, 2)}\n`);
  await fs.writeFile(path.join(dir,'evidence.json'), `${JSON.stringify(sourceArtifacts, null, 2)}\n`);
}
console.log({ evidenceRoot: 'data/diagnostics', failedOrDegraded: (report.sources || []).filter(s => s.health !== 'healthy').length });
