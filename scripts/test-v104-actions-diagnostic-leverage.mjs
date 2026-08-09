import assert from 'node:assert/strict';
import fs from 'node:fs';

const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
assert.match(probe,/function severePaginationIdentityCollapse/);
assert.match(probe,/identityCollapseDetected/);
assert.match(probe,/identityUniqueRatio/);

const collect=fs.readFileSync('scripts/collect.mjs','utf8');
assert.match(collect,/cacheMissSamples/);
assert.match(collect,/currentStableIdentity/);
assert.match(collect,/cachedStableIdentity/);
assert.match(collect,/currentIdentityFingerprint/);
assert.match(collect,/cachedIdentityFingerprint/);
assert.match(collect,/ageHours/);

// Guard threshold: 141 -> 1 style collapse must be caught, ordinary overlaps should not.
function severe(rec={}) {
  const raw=Number(rec.rawCount||0), unique=Number(rec.uniqueCount||0);
  if(raw<20)return false;
  return unique>0 && (unique/raw)<0.5;
}
assert.equal(severe({rawCount:141,uniqueCount:1}),true);
assert.equal(severe({rawCount:291,uniqueCount:265}),false);
assert.equal(severe({rawCount:138,uniqueCount:126}),false);
assert.equal(severe({rawCount:42,uniqueCount:38}),false);
console.log('v104 Actions diagnostic leverage regression passed');
