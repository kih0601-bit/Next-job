import fs from 'node:fs';
const collect=fs.readFileSync('scripts/collect.mjs','utf8');
const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
const adapters=fs.readFileSync('scripts/collectors/source-adapters.mjs','utf8');
for (const x of ['sourceStableIdentity','wr_id:${wrId}','findCompatibleCacheEntry','cacheKeyMigrations','em_id=<volatile>']) if(!collect.includes(x)) throw new Error(`missing ${x}`);
for (const x of ['20.0-v100-cache-identity-and-final-pagination-proof','strongHubstRecord','ROWAREA_RECORD']) if(!probe.includes(x)) throw new Error(`missing ${x}`);
if(!adapters.includes("canonical.replace(/^http:/i, 'https:')")) throw new Error('COMWEL https normalization missing');
console.log('v100 final stage7 tests passed');
