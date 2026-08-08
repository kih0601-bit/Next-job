
import assert from 'node:assert/strict';
import { sourceHealth } from './lib/report-schema.mjs';

const base = {
  access:{recruitVerifyOk:true}, list:{ok:true}, detail:{ok:true},
  attachmentDiscovery:{ok:true}, attachmentDownload:{ok:true}, documentAnalysis:{ok:true}
};
assert.equal(sourceHealth(base),'healthy');
assert.equal(sourceHealth({...base, attachmentDownload:{ok:false}}),'degraded');
assert.equal(sourceHealth({...base, documentAnalysis:{ok:false}}),'degraded');
assert.equal(sourceHealth({
  access:{recruitVerifyOk:true}, list:{ok:true}, detail:{ok:true}, attachment:{ok:true}
}),'healthy'); // legacy compatibility
console.log('pipeline-stage-split-pass');
