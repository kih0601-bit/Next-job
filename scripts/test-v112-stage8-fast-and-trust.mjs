import assert from 'node:assert/strict';
import fs from 'node:fs';

const collect=fs.readFileSync('scripts/collect.mjs','utf8');
const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
const adapters=fs.readFileSync('scripts/collectors/source-adapters.mjs','utf8');
const analyzer=fs.readFileSync('scripts/lib/document-analyzer.mjs','utf8');
const fast=fs.readFileSync('scripts/stage8-fast-run.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/update-jobs.yml','utf8');
const template=fs.readFileSync('workflow-template/update-jobs.yml','utf8');

assert.match(probe,/item\?\.status === 'verified-empty'\) return 45/);
assert.match(adapters,/date-title:/);
assert.match(collect,/1\.1\.0-stage8-input-snapshot/);
assert.match(collect,/stage8-schema-missing/);
assert.match(collect,/stage7-stage8-snapshot\.json/);
assert.match(collect,/stage8-benchmark-candidates\.json/);
assert.match(analyzer,/2\.9-short-text-root-cause/);
assert.match(analyzer,/failureClass/);
assert.match(fast,/stage8-fast-snapshot/);
assert.match(fast,/live-full-pipeline-validation-required/);
assert.equal(workflow,template,'workflow template must be byte-identical to executable workflow');
console.log('v112 Stage 8 fast/trust tests passed');
