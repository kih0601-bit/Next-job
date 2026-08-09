import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectListingPage } from './lib/list-pipeline.mjs';
import { canonicalJobUrl } from './collectors/source-adapters.mjs';
import { reconcilePages, pageFingerprint } from './lib/pagination-engine.mjs';

const html = `<ul class="notice_list">
<li class="state_ing"><a onclick="fncPageBoard('view','view.do','2026,C,1','employYear,employId,employSeq');"><span class="tit">NDIS 데이터관리원 채용</span></a></li>
<li class="state_end"><a onclick="fncPageBoard('view','view.do','2026,4,1','employYear,employId,employSeq');"><span class="tit">4직급 고졸 신입사원 채용 공고</span></a></li>
</ul>`;
const source={org:'한국전력공사',url:'https://recruit.kepco.co.kr:444/frt/frt0001/addList.do'};
const inspected=inspectListingPage(html,source);
assert.equal(inspected.candidates.length,2);
assert.notEqual(inspected.candidates[0].link, inspected.candidates[1].link);
assert.match(inspected.candidates[0].link, /\?employYear=/);

assert.match(canonicalJobUrl(inspected.candidates[0].link), /employYear=2026/);
assert.match(canonicalJobUrl(inspected.candidates[0].link), /employId=C/);
assert.match(canonicalJobUrl(inspected.candidates[0].link), /employSeq=1/);
assert.notEqual(
  canonicalJobUrl(inspected.candidates[0].link),
  canonicalJobUrl(inspected.candidates[1].link),
  'Collect-style canonical dedup must not collapse KEPCO notices'
);
const collectStyleKeys = new Set(inspected.candidates.map(c =>
  `${c.org}|${c.title.toLowerCase()}|${canonicalJobUrl(c.link)}`
));
assert.equal(collectStyleKeys.size, 2);
const rec=reconcilePages([{page:1,candidates:inspected.candidates}]);
assert.equal(rec.rawCount,2);
assert.equal(rec.uniqueCount,2);
assert.equal(rec.duplicateCount,0);
assert.notEqual(pageFingerprint([inspected.candidates[0]]),pageFingerprint([inspected.candidates[1]]));

const workflow=fs.readFileSync('.github/workflows/update-jobs.yml','utf8');
assert.match(workflow,/workflow_dispatch\s*:/);
assert.doesNotMatch(workflow,/\n\s*schedule\s*:/);
console.log('v102 KEPCO durable identity + manual workflow regression passed');
