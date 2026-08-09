import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./lib/detail-parser.mjs', import.meta.url),'utf8');
assert.match(source,/cleaned\.slice\(0, 18\).*shortStableHash/);
assert.match(source,/Buffer\.byteLength\(cleaned, 'utf8'\) <= 56/);
console.log('v89 diagnostic filename guard pass');
