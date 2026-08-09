import assert from 'node:assert/strict';
import { discoverPaginationPlan } from './lib/pagination-engine.mjs';

const kepco = `<div class="paging"><strong>1</strong><a onclick="fncPageBoard('addList','addList.do',2); return false;">2</a><a onclick="fncPageBoard('addList','addList.do',16); return false;">last</a></div>`;
const plan = discoverPaginationPlan({html:kepco, source:{org:'한국전력공사'}, selectedUrl:'https://recruit.kepco.co.kr:444/frt/frt0001/addList.do'});
assert.equal(plan.kind,'form-post');
assert.equal(plan.key,'pageIndex');
assert.equal(plan.totalPages,16);
console.log('v99 stage7 evidence closure tests passed');
