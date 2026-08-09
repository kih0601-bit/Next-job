import assert from 'node:assert/strict';
import { stageStatuses } from './lib/pipeline-status.mjs';
let s=stageStatuses({pagination:{ok:false,implementationOk:true,currentRunOk:false,status:'verified-historical'}});
assert.equal(s.pagination.status,'verified');
s=stageStatuses({pagination:{ok:true,implementationOk:true,currentRunOk:true,status:'verified-single'}});
assert.equal(s.pagination.status,'verified');
s=stageStatuses({pagination:{ok:false,implementationOk:false,status:'unknown-single-or-no-control'}});
assert.equal(s.pagination.status,'unknown');
console.log({ok:true,test:'v98 pagination implementation/current-health state model'});
