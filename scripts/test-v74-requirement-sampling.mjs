import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile(new URL('./collect.mjs', import.meta.url), 'utf8');
assert.match(source, /const requirementSamples = sources\.flatMap/);
assert.match(source, /Attachment filenames are/);
assert.match(source, /attachmentLike/);
assert.match(source, /sampledPostings/);
assert.match(source, /sampledInstitutions/);
assert.match(source, /documentBackedPostings/);
assert.match(source, /categoryStats/);
assert.match(source, /필터 연구용 표본은 최종 jobs\.json 통과 여부와 분리한다/);
assert.doesNotMatch(source, /vacancyDecisions:\s*sources\.flatMap/);
console.log('v74-requirement-sampling-pass');
