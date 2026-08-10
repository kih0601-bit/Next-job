import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizePosting } from '../src/lib/normalize.mjs';
import { extractCodeOnly } from '../src/code/code-extract.mjs';
import { normalizePublicDataServiceKey, redactSensitiveUrl } from '../src/adapters/common.mjs';
assert.equal(normalizePublicDataServiceKey('abc%2Bdef%2Fghi%3D%3D'),'abc+def/ghi==');
assert.equal(normalizePublicDataServiceKey('abc+def/ghi=='),'abc+def/ghi==');
const redacted=redactSensitiveUrl('https://example.test/api?serviceKey=abc%2Bdef%2Fghi%3D%3D&pageNo=1');
assert.ok(!redacted.includes('abc'));
assert.match(redacted,/REDACTED/);

const f=JSON.parse(await fs.readFile(new URL('./fixtures/api-real-samples.json',import.meta.url),'utf8'));

const j=normalizePosting('job-alio',f.jobAlio);
assert.equal(j.sourceId,'303259');
assert.equal(j.institution,'동남권원자력의학원');
assert.match(j.title,/마취통증의학과/);
assert.deepEqual(j.workplaces,['부산']);
assert.equal(j.mappingWarnings.length,0);
const je=extractCodeOnly(j);
assert.equal(je.recruitmentUnits[0].requirements.education.status,'required');
assert.equal(je.recruitmentUnits[0].requirements.licenses.status,'required');
assert.match(je.recruitmentUnits[0].requirements.licenses.value,/의사 면허증/);
assert.equal(je.recruitmentUnits[0].requirements.legalOther.status,'required');

const c=normalizePosting('cleaneye',f.cleaneye);
assert.equal(c.sourceId,'70642');
assert.equal(c.institution,'재단법인 대전광역시 사회서비스원');
assert.equal(c.employmentType,'기간제');
const ce=extractCodeOnly(c);
assert.equal(ce.recruitmentUnits[0].requirements.region.status,'none');
assert.equal(ce.recruitmentUnits[0].requirements.licenses.status,'unknown');
assert.ok(ce.unresolved.includes('license_field_reference_only'));
assert.ok(ce.unresolved.includes('cleaneye_workplace_not_explicit'));
console.log('code-only tests: OK');
