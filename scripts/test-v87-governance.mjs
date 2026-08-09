import { SOURCES } from './collectors/source-registry.mjs';
import assert from 'node:assert/strict';
import { PIPELINE_STAGES, stageStatuses, summarizeStages } from './lib/pipeline-status.mjs';
assert.equal(PIPELINE_STAGES.length,10);
assert.deepEqual(PIPELINE_STAGES.map(([key])=>key), ['source','access','list','detail','attachment','documentAnalysis','pagination','requirements','filter','output']);
const unresolved={sourceProvenance:{verificationStatus:'verified'},access:{recruitVerifyOk:true},list:{ok:true,status:'verified-exact'},detail:{ok:true},attachmentDiscovery:{ok:true},attachmentDownload:{ok:true},documentAnalysis:{ok:true},diagnosis:{attachment:{status:'unknown',reason:'zero unresolved'}}};
let st=stageStatuses(unresolved); assert.equal(st.attachment.status,'unknown'); assert.equal(summarizeStages(st).pipelineComplete,false); assert.equal(st.pagination.status,'not-implemented');
const explicitNone={...unresolved,detail:{ok:true,samples:[{explicitNoAttachment:true}]},attachmentDiscovery:{ok:true,status:'not-required-no-attachments'},diagnosis:{attachment:{status:'unknown',reason:'legacy unresolved'}}}; st=stageStatuses(explicitNone); assert.equal(st.attachment.status,'verified');
const delegated={...unresolved,sourceProvenance:{verificationStatus:'unknown'}}; st=stageStatuses(delegated); assert.equal(st.source.status,'unknown');
for (const org of ['근로복지공단','울산남구도시관리공단','울주문화재단']) { const src=SOURCES.find(s=>s.org===org); assert.equal(src.sourceProvenance.verificationStatus,'verified'); assert.ok(src.sourceProvenance.evidence?.length>=1); }
assert.deepEqual(Object.keys(stageStatuses(unresolved)), ['source','access','list','detail','attachment','documentAnalysis','pagination','requirements','filter','output']);
console.log('v89 governance tests passed');
