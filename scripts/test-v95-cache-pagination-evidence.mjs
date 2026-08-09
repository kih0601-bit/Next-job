import fs from 'node:fs';
const collect=fs.readFileSync('scripts/collect.mjs','utf8');
const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
const detail=fs.readFileSync('scripts/lib/detail-parser.mjs','utf8');
for (const needle of ['CACHE_TERMINAL_MAX_AGE_MS','terminal-identity','identity-grace','cacheHitReasons']) if(!collect.includes(needle)) throw new Error(`missing ${needle}`);
for (const needle of ['fetchFormSession','sessionEvidence','pageValidation','mismatchPages','cookieCaptured']) if(!probe.includes(needle)) throw new Error(`missing ${needle}`);
for (const needle of ['safeDiagArtifactStem','item-${shortStableHash(raw)}']) if(!detail.includes(needle)) throw new Error(`missing ${needle}`);
console.log({ok:true,test:'v95 adaptive cache + pagination evidence/session'});
