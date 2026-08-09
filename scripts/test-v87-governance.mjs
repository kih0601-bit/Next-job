import assert from 'node:assert/strict';
import { PIPELINE_STAGES, stageStatuses, summarizeStages } from './lib/pipeline-status.mjs';
assert.equal(PIPELINE_STAGES.length,10);
const unresolved={sourceProvenance:{verificationStatus:'verified'},access:{recruitVerifyOk:true},list:{ok:true,status:'verified-exact'},detail:{ok:true},attachmentDiscovery:{ok:true},attachmentDownload:{ok:true},documentAnalysis:{ok:true},diagnosis:{attachment:{status:'unknown',reason:'zero unresolved'}}};
let st=stageStatuses(unresolved); assert.equal(st.attachment.status,'unknown'); assert.equal(summarizeStages(st).pipelineComplete,false); assert.equal(st.pagination.status,'not-implemented');
const delegated={...unresolved,sourceProvenance:{verificationStatus:'unknown'}}; st=stageStatuses(delegated); assert.equal(st.source.status,'unknown');
console.log('v87 governance tests passed');
