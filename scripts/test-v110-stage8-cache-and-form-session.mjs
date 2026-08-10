import assert from 'node:assert/strict';
import fs from 'node:fs';

const collect=fs.readFileSync('scripts/collect.mjs','utf8');
assert.match(collect,/STAGE8_CACHE_SCHEMA_VERSION/);
assert.match(collect,/stage8CacheSchemaVersion !== STAGE8_CACHE_SCHEMA_VERSION/);
assert.match(collect,/STAGE8_SILENT_FAILURE/);
assert.match(collect,/stage8CandidateCount/);
assert.match(collect,/fetchFreshFormPaginationSession/);
assert.match(collect,/getSetCookie/);
assert.match(collect,/req\.headers = \{ \.\.\.\(req\.headers \|\| \{\}\), cookie: verifiedFormPagination\.cookie \}/);
assert.match(collect,/retryEvidence/);

const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
assert.match(probe,/20\.0-v110-stage8-input-and-session-guard/);
console.log('v110 Stage8 cache/session guard regression passed');
