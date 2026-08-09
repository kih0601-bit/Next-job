import assert from 'node:assert/strict';
import { inspectListingPage } from './lib/list-pipeline.mjs';
import { discoverPaginationPlan } from './lib/pagination-engine.mjs';

// Independent record-template proof may override a noisy heuristic visible counter.
const html=`<table><tr><th>번호</th><th>제목</th></tr><tr><td>공지</td><td><a href="/view.do?idx=1">채용 공고 A</a></td></tr><tr><td>2</td><td><a href="/view.do?idx=2">채용 공고 B</a></td></tr></table>`;
const inspected=inspectListingPage(html,{org:'테스트기관',url:'https://example.com/list.do'});
assert.equal(inspected.candidates.length,2);
assert.equal(inspected.diagnostics.recordVerification.verified,true);
assert.equal(inspected.exactMatch,true);
assert.equal(inspected.diagnostics.exactMatchBasis,'record-template-1to1');

// A verified board form with a page field is sufficient transport evidence even
// when total page count is not published; terminal discovery is performed by probe.
const form=`<form name="srchForm" method="post" action="/list.do"><input type="hidden" name="page" value="1"><input type="hidden" name="pc" value="abc"></form>`;
const plan=discoverPaginationPlan({html:form,source:{org:'테스트기관'},selectedUrl:'https://example.com/list.do'});
assert.equal(plan.kind,'form-post');
assert.equal(plan.key,'page');
assert.equal(plan.totalPages,null);
console.log({ok:true,test:'v97 pagination proof + terminal discovery contract'});
