import assert from 'node:assert/strict';
import fs from 'node:fs';

const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
assert.match(probe,/function evaluateStage7Gate/);
assert.match(probe,/decision.*close-stage-7/s);
assert.match(probe,/20\/20 implementation proof/);
assert.match(probe,/stage7ImplementationComplete/);
assert.match(probe,/stage7CurrentRunComplete/);
assert.match(probe,/stage7BlockerCount/);
assert.match(probe,/historicalOnly/);
assert.match(probe,/structuralOk/);
console.log('v106 Stage-7 completion gate regression passed');
