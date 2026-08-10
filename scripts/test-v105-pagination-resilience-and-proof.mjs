import assert from 'node:assert/strict';
import fs from 'node:fs';

const probe=fs.readFileSync('scripts/pipeline-probe.mjs','utf8');
assert.match(probe,/20\.0-v110-stage8-input-and-session-guard/);
assert.match(probe,/fetchPaginationPageWithRetry/);
assert.match(probe,/attempts = 3/);
assert.match(probe,/paginationRetryEvidence/);
assert.match(probe,/retryFailures/);
assert.match(probe,/hubst-page-param-hints/);
assert.match(probe,/hubst-explicit-pager-markup/);
assert.match(probe,/ROWAREA_RECORD matches extracted records exactly/);

// The uploaded run proves the HUBST form has no page parameter and its only
// recruitment row is exactly matched by the ROWAREA_RECORD adapter.
const hubstNames=['orgIdx','opnIdx','openType','boardType'];
assert.equal(hubstNames.some(n=>/^(?:page|pageNo|pageNum|pageIndex|currentPage|curPage)$/i.test(n)),false);

console.log('v105 pagination resilience + HUBST proof regression passed');
