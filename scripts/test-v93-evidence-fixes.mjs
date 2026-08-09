import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { discoverPaginationPlan, paginationRequest } from './lib/pagination-engine.mjs';
const post=`<form name="frm" method="post" action="/list.do"><input name="pageIndex" value="1"></form><script>function goPage(page){document.frm.pageIndex.value=page;document.frm.submit();}</script><a onclick="goPage(2)">2</a>`;
let p=discoverPaginationPlan({html:post,source:{org:'x'},selectedUrl:'https://x.test/list.do'}); assert.equal(p.kind,'form-post'); assert.equal(p.key,'pageIndex'); assert.equal(paginationRequest(p,'https://x.test/list.do',2).method,'POST');
const get=`<form name="frm" method="get"><input name="pageNo" value="1"></form><a onclick="goPage(2)">2</a>`; p=discoverPaginationPlan({html:get,source:{org:'x'},selectedUrl:'https://x.test/list.do'}); assert.equal(p.kind,'query-get'); assert.equal(p.key,'pageNo');
const wf=await fs.readFile('.github/workflows/update-jobs.yml','utf8'); assert.match(wf,/Start run metrics/); assert.match(wf,/data\/run-metrics\.json/);
console.log('v93 evidence fixes pass');
