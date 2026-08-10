import assert from 'node:assert/strict';
import { splitVacancies } from './lib/vacancy-splitter.mjs';
import { extractSupportRequirements } from './lib/requirement-extractor.mjs';

const table=`채용개요\n분야 | 선발인원 | 주요업무\n체육센터 운영보조 | 6명 | 회원 안내 및 운영보조\n안전요원 | 4명 | 수영장 안전관리\n헬스 체육지도사 | 2명 | 헬스 지도\n기계실 | 1명 | 기계설비 관리\n캠핑장 안내관리원 | 2명 | 캠핑장 안내\n환경관리원 | 3명 | 환경정비`;
const units=splitVacancies({title:'2026년 제3회 기간제근로자 채용공고',documentText:table});
assert.ok(units.length>=6, `expected >=6 units, got ${units.length}`);
for(const expected of ['체육센터 운영보조','안전요원','헬스 체육지도사','기계실','캠핑장 안내관리원','환경관리원']) assert.ok(units.some(x=>x.name.includes(expected)), expected);

const polluted='채용개요 체육센터 운영보조 6명 안전요원 4명 기계실 기사 업무 캠핑장 안내관리원 환경관리원 근무기간 및 연령 등 일반 안내가 이어지는 매우 긴 표 설명 '.repeat(3);
const req=extractSupportRequirements({documentText:polluted});
assert.equal(req.licenses.length,0);
assert.equal(req.age.length,0);
const real=extractSupportRequirements({documentText:'응시자격: 만 18세 이상, 필수자격 기사 자격증 소지자'});
assert.ok(real.age.some(x=>x.level==='required'));
assert.ok(real.licenses.length>0);
console.log('v126 Bukgu multi-unit/scope tests passed');
