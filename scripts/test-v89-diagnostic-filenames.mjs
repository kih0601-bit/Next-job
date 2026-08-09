import assert from 'node:assert/strict';
import { safeFileComponent } from './lib/safe-filename.mjs';
const source='울산도시공사_2026년도_직원채용_매우긴제목_'.repeat(8);
const safe=safeFileComponent(source,{maxBytes:64,maxChars:30});
assert.ok(Buffer.byteLength(safe,'utf8')<=64);
assert.match(safe,/-[0-9a-f]{8}$/);
console.log('v89 diagnostic filename guard pass');
