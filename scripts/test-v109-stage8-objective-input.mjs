import assert from 'node:assert/strict';
import fs from 'node:fs';

const collect=fs.readFileSync('scripts/collect.mjs','utf8');

assert.match(collect,/function validStage8Candidate/);
assert.match(collect,/const candidates = rawCandidates\.filter\(validStage8Candidate\)/);
assert.match(collect,/personalAcceptedKeys/);
assert.match(collect,/if \(!cacheEntry\.outcome\?\.stage8Posting\) return null/);

// Objective Stage 8 must not inherit these personal-fit exclusions.
const fn=collect.slice(collect.indexOf('function validStage8Candidate'),collect.indexOf('function normalizeTitleForDedup'));
assert.doesNotMatch(fn,/EXCLUDED_EMPLOYMENT_PATTERNS/);
assert.doesNotMatch(fn,/LICENSE_JOB_PATTERNS/);

console.log('v109 Stage-8 objective-input regression passed');
