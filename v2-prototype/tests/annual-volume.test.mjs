import assert from 'node:assert/strict';
import { detectYear, classifyTitle, dedupeAndClassify, parseRecords } from '../src/volume/annual-volume-lib.mjs';
assert.equal(detectYear({empyear:'2025'}).year,2025);
assert.equal(detectYear({regYmd:'2025-07-01'}).year,2025);
assert.equal(detectYear({title:'2025 과거자료',foo:'bar'}).year,null,'arbitrary title year must not drive target-year counting');
assert.equal(classifyTitle('2025년 신입직원 채용 공고'),'recruitment_like');
assert.equal(classifyTitle('2025년 신입직원 최종합격자 발표'),'result_or_followup');
assert.equal(classifyTitle('2025년 연간 채용 계획 사전 안내'),'preannouncement');
const x=parseRecords('<response><items><item><empyear>2025</empyear><title>A</title></item><item><empyear>2025</empyear><title>B</title></item></items></response>');
assert.equal(x.length,2);
const d=dedupeAndClassify([
 {source:'a',institution:'X',title:'신입직원 채용',date:'2025-01-01',fingerprint:'x|신입직원채용|20250101'},
 {source:'b',institution:'X',title:'신입직원 채용',date:'2025-01-01',fingerprint:'x|신입직원채용|20250101'},
]);
assert.equal(d.exactUniqueCount,1); assert.equal(d.crossSourceDuplicateGroupCount,1);
console.log('annual-volume.test PASS');
