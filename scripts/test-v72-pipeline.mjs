
import assert from 'node:assert/strict';
import { inspectListingPage } from './lib/list-pipeline.mjs';

const kepcoHtml = `<ul>
<li class="state_ing"><div class="tit"><a href="javascript:fncPageBoard('view','view.do','2026,C,1','employYear,employId,employSeq')">2026년도 NDIS데이터관리원 채용</a></div><span class="state">서류심사중</span></li>
<li class="state_end"><div class="tit"><a href="javascript:fncPageBoard('view','view.do','2026,4,1','employYear,employId,employSeq')">2026년도 4직급 고졸 신입사원 채용 공고</a></div><span class="state">채용종료</span></li>
</ul>`;
const source={org:'한국전력공사',url:'https://recruit.kepco.co.kr:444/frt/frt0001/addList.do'};
const inspected=inspectListingPage(kepcoHtml,source);
assert.equal(inspected.visiblePostCount,2);
assert.equal(inspected.candidateCount,2);
assert.equal(inspected.exactMatch,true);
assert.equal(inspected.diagnostics.countTemplate,'KEPCO_STATE_LI');
assert.equal(inspected.diagnostics.recordVerification.verified,true);
assert.equal(inspected.diagnostics.recordVerification.template,'KEPCO_STATE_LI');
console.log('v72-pipeline-pass');
