import assert from 'node:assert/strict';
import { discoverPaginationPlan, paginationUrl, paginationRequest, reconcilePages, pageFingerprint } from './lib/pagination-engine.mjs';
import { stageStatuses } from './lib/pipeline-status.mjs';

const html=`<p>글수 <strong>46</strong>건 (1/5 page)</p><a href="/board?page=2">2</a><a href="/board?page=3">3</a>`;
const plan=discoverPaginationPlan({html,source:{org:'테스트'},selectedUrl:'https://x.test/board?page=1'});
assert.equal(plan.kind,'query-get'); assert.equal(plan.key,'page'); assert.equal(plan.totalPages,5);
assert.equal(paginationUrl(plan,'https://x.test/board?page=1',4),'https://x.test/board?page=4');
const p1=[{title:'A',link:'https://x.test/view?id=1'},{title:'B',link:'https://x.test/view?id=2'}];
const p2=[{title:'B',link:'https://x.test/view?id=2'},{title:'C',link:'https://x.test/view?id=3'}];
const rec=reconcilePages([{page:1,candidates:p1},{page:2,candidates:p2}]); assert.equal(rec.rawCount,4); assert.equal(rec.uniqueCount,3); assert.equal(rec.duplicateCount,1);
assert.equal(pageFingerprint(p1),pageFingerprint([...p1]));
const stages=stageStatuses({sourceProvenance:{verificationStatus:'verified'},access:{httpOk:true,recruitVerifyOk:true},list:{ok:true},detail:{ok:true},attachmentDiscovery:{ok:true},documentAnalysis:{ok:true},pagination:{ok:true,status:'verified-full',evidence:['x']}}); assert.equal(stages.pagination.status,'verified');
console.log('v90 pagination tests passed');

const postHtml=`<div>총 <b>293</b>건 <span>1/30 페이지</span></div><form id="frm" name="frm" action="/bbs/list.do" method="post"><input type="hidden" name="pageIndex" value="1"><input type="hidden" name="bbsId" value="JOB"></form><script>function fn_egov_select_noticeList(pageNo){ document.frm.pageIndex.value = pageNo; document.frm.action = "/bbs/list.do"; document.frm.submit(); }</script>`;
const postPlan=discoverPaginationPlan({html:postHtml,source:{org:'POST테스트'},selectedUrl:'https://x.test/bbs/list.do'});
assert.equal(postPlan.kind,'form-post'); assert.equal(postPlan.totalPages,30); assert.equal(postPlan.key,'pageIndex');
const postReq=paginationRequest(postPlan,'https://x.test/bbs/list.do',7); assert.equal(postReq.method,'POST'); assert.match(postReq.body,/pageIndex=7/); assert.match(postReq.body,/bbsId=JOB/);
