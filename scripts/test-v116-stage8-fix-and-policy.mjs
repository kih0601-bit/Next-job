import assert from 'node:assert/strict';
import { extractDetailBody, extractAttachments } from './lib/detail-parser.mjs';
import { splitVacancies } from './lib/vacancy-splitter.mjs';
import { buildStage8Report } from './lib/stage8-eligibility-structure.mjs';

const upaHtml=`<html><body><div class="board_view"><h3>울산항만공사 공고 제2026 - 029호</h3>
<h4>2026년 상반기 기간제계약직(대체인력,비서) 채용 공고</h4><div>○ 모집분야 및 인원</div>
<table><tr><th>구분</th><th>모집분야</th><th>선발예정인원</th></tr>
<tr><td>육아휴직 대체인력</td><td>계약직 마급 (건설안전)</td><td>1명</td></tr>
<tr><td>계약직 바급</td><td>사무행정A</td><td>1명</td></tr>
<tr><td>계약직 바급</td><td>사무행정B</td><td>1명</td></tr>
<tr><td>비서</td><td>계약직 바급 (비서)</td><td>1명</td></tr></table>
<div>※ 모집분야별 중복 지원 불가</div><div>※ 정규직 전환 불가</div></div>
<div>이전글</div></body></html>`;
const detail=extractDetailBody(upaHtml,'2026년 상반기 기간제계약직(대체인력, 비서) 채용 공고','울산항만공사');
for (const role of ['건설안전','사무행정A','사무행정B','비서']) assert.match(detail,new RegExp(role));
assert.match(detail,/정규직 전환 불가/);

const certHtml=`<div class="attachment"><a href="/cert.pdf">정보통신접근성 품질인증서</a></div>`;
assert.equal(extractAttachments(certHtml,'https://www.upa.or.kr/portal/board/post/view.do').length,0);

const split=splitVacancies({title:'2026년도 상반기 신규직원 채용 예비공고',detailText:'○ 모집분야(상반기) : 경력직 2급(산업보건-의학), 신입직 5급(일반, 지역인재, 장애 / 산업안전(기계,전기,화공), 산업보건(환경), 건설안전(건축,토목))'});
assert.ok(split.length>=6,`expected multi split, got ${split.length}`);

const report=buildStage8Report([]);
assert.equal(report.downstreamPolicy.listExposure,'required-only');
assert.equal(report.downstreamPolicy.detailExposure,'required-and-preferred');
assert.match(report.downstreamPolicy.recommendation,/preferred conditions may raise ranking but never exclude/);
console.log('v116 Stage 8 fix + downstream policy tests passed');
