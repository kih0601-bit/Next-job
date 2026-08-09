import fs from 'node:fs/promises';
const LIMIT = 20;
const report = JSON.parse(await fs.readFile('data/pipeline-report.json','utf8'));
let history = { version: 1, sources: {} };
try { history = JSON.parse(await fs.readFile('data/pipeline-history.json','utf8')); } catch {}
for (const source of report.sources || []) {
  const row = { at: report.generatedAt || new Date().toISOString(), health: source.health, cause: source.primaryCause?.code || '', access: Boolean(source.access?.ok), list: Boolean(source.list?.ok), detail: Boolean(source.detail?.ok), attachmentDiscovery: Boolean(source.attachmentDiscovery?.ok ?? source.attachment?.ok), attachmentDownload: Boolean(source.attachmentDownload?.ok), documentAnalysis: Boolean(source.documentAnalysis?.ok), attachment: Boolean(source.attachmentDiscovery?.ok ?? source.attachment?.ok), paginationImplementation: Boolean(source.pagination?.implementationOk ?? source.pagination?.ok), paginationCurrentRun: Boolean(source.pagination?.currentRunOk ?? source.pagination?.ok), paginationStatus: source.pagination?.status || 'not-evaluated', paginationVerificationClass: source.pagination?.verificationClass || '', visible: source.list?.visiblePostCount ?? null, extracted: source.list?.candidateCount ?? null };
  history.sources[source.org] = [...(history.sources[source.org] || []), row].slice(-LIMIT);
}
history.updatedAt = new Date().toISOString();
await fs.writeFile('data/pipeline-history.json', `${JSON.stringify(history,null,2)}\n`);
console.log({ historySources: Object.keys(history.sources).length, limit: LIMIT });
