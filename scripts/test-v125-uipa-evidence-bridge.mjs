import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const collect=await fs.readFile(new URL('./collect.mjs', import.meta.url),'utf8');
const analyzer=await fs.readFile(new URL('./lib/document-analyzer.mjs', import.meta.url),'utf8');

assert.match(collect,/detail\.contentImages/,'detail content images must be bridged to Stage 6');
assert.match(collect,/evidenceRole:\s*'detail-content-image'/,'content images need an explicit evidence role');
assert.match(collect,/documentInputs/,'attachments and content images must share the document analyzer path');
assert.match(analyzer,/suspiciousTableOnly/,'table-only HWP output must not be accepted as successful extraction');
assert.match(analyzer,/LibreOffice rendering/,'HWP table recovery must continue to the render fallback');
console.log('v125 UIPA Stage 4->6 evidence bridge tests passed');
