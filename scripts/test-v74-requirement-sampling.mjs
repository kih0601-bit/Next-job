import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile(new URL('./collect.mjs', import.meta.url), 'utf8');
assert.match(source, /const stage8Postings = sources\.flatMap/);
assert.match(source, /buildStage8Report/);
assert.match(source, /stage8-eligibility-report\.json/);
assert.match(source, /requirement-report\.json/);
assert.match(source, /compatibilityAlias/);
assert.match(source, /stage8Postings: source\.stage8Postings/);
assert.doesNotMatch(source, /const requirementSamples = sources\.flatMap/);
console.log('v74-requirement-sampling-pass');
