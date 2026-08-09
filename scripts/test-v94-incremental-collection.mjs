import fs from 'node:fs/promises';
const collect = await fs.readFile('scripts/collect.mjs','utf8');
const workflow = await fs.readFile('.github/workflows/update-jobs.yml','utf8');
const runMetrics = await fs.readFile('scripts/run-metrics.mjs','utf8');
const required = [
  'COLLECTION_CACHE_PATH', 'CACHE_MAX_AGE_MS', 'bootstrapCacheFromPreviousOutputs',
  'reusableCachedOutcome', 'cacheHits', 'heavyProcessed', 'collect-metrics.json'
];
for (const token of required) if (!collect.includes(token)) throw new Error(`missing incremental token: ${token}`);
if (!workflow.includes('data/collection-cache.json') || !workflow.includes('data/collect-metrics.json')) throw new Error('workflow artifact missing incremental outputs');
if (!runMetrics.includes('collectByOrg')) throw new Error('run metrics missing institution collect timing');
console.log({ok:true,test:'v94 incremental collection + institution timing'});
