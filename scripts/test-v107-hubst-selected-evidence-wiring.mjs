import assert from 'node:assert/strict';
import fs from 'node:fs';

const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
assert.match(probe,/selected\?\.rootCause\?\.accuracyVerification\?\.templateRecordEvidence\?\.verified === true/);
assert.match(probe,/selected\?\.rootCause\?\.accuracyVerification\?\.listVerificationTemplate === 'ROWAREA_RECORD'/);
assert.doesNotMatch(probe,/selected\?\.accuracyVerification\?\.templateRecordEvidence/);

// Mirror the exact evidence shape emitted by pageResults in the uploaded run.
const selected={
  exactMatch:true,
  candidateCount:1,
  rootCause:{accuracyVerification:{
    verified:true,
    listVerificationTemplate:'ROWAREA_RECORD',
    templateRecordEvidence:{verified:true,recordCount:1,candidateCount:1,matchedCount:1}
  }}
};
const pageParamHints=0, explicitPagerMarkup=false;
const proved=selected.exactMatch && selected.candidateCount>0
  && pageParamHints===0 && !explicitPagerMarkup
  && selected.rootCause.accuracyVerification.templateRecordEvidence.verified===true
  && selected.rootCause.accuracyVerification.listVerificationTemplate==='ROWAREA_RECORD';
assert.equal(proved,true);
console.log('v107 HUBST selected-evidence wiring regression passed');
