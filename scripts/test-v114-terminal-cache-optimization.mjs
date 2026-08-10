import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const collect = await fs.readFile('scripts/collect.mjs', 'utf8');

assert.match(collect, /const terminal = terminalCacheOutcome\(cacheEntry\.outcome\)/,
  'terminal cache reuse gate must exist');
assert.match(collect, /if \(!terminal && !hasCurrentStage8\) return null;/,
  'non-terminal legacy entries must still require current Stage-8 structure');
assert.match(collect, /if \(!terminalCacheOutcome\(cacheEntry\.outcome\)[\s\S]*stage8-schema-missing/,
  'terminal entries must not be classified as Stage-8 schema misses');
assert.match(collect, /CACHE_TERMINAL_MAX_AGE_MS = 90 \* 24 \* 60 \* 60 \* 1000/,
  'terminal reuse must remain bounded by the existing 90-day TTL');

const workflow = await fs.readFile('.github/workflows/update-jobs.yml', 'utf8');
const template = await fs.readFile('workflow-template/update-jobs.yml', 'utf8');
assert.equal(workflow, template, 'workflow template must be byte-identical to executable workflow');
assert.match(workflow, /test-v114-terminal-cache-optimization\.mjs/,
  'Actions self-tests must include v114 terminal-cache regression test');

console.log('v114 terminal-cache optimization tests passed');
