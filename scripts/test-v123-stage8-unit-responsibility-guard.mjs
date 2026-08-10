import assert from 'node:assert/strict';
import { splitVacancies, VACANCY_SPLITTER_VERSION } from './lib/vacancy-splitter.mjs';
import { auditStage8Quality } from './lib/stage8-quality-audit.mjs';

assert.ok(typeof VACANCY_SPLITTER_VERSION === 'string' && VACANCY_SPLITTER_VERSION.length > 0, 'vacancy splitter must expose a version');

const noisy=`
모집분야 | 채용인원 | 근무지
일반행정 | 2명 | 울산
전기 | 1명 | 울산
※ 현재 진행 중인 ‘울산시설공단 제2회 직원채용’과 무관함.
### 제2026-010호_직원_청년인턴__채용_직무기술서.pdf (81.2K)
직렬 선발예정인원 최종채용인원 주요담당 업무로 구성된 테이블 입니다.
`;
const split=splitVacancies({title:'2026년 직원 채용',detailText:noisy});
assert.deepEqual(split.map(x=>x.name),['일반행정','전기']);
assert.equal(split.some(x=>/무관함|\.pdf|테이블/.test(x.name)),false);

const validInline=splitVacancies({title:'2026 신규직원',detailText:'○ 모집분야(상반기) : 신입직 5급(일반, 산업안전(기계,전기), 건설안전(건축,토목))'});
assert.ok(validInline.length>=5);
assert.ok(validInline.some(x=>/신입직 5급 일반/.test(x.name)));
assert.ok(validInline.some(x=>/산업안전 기계/.test(x.name)));

const quality=auditStage8Quality({postings:[{
  posting:{org:'테스트기관',title:'2026년 직원 채용',link:'https://example.com'},
  sourceHints:{years:[2026]},sourceCoverage:{},
  recruitmentUnits:[{
    name:'### 직원 채용 직무기술서.pdf',source:'table-row',splitConfidence:.72,
    evidenceScope:{detail:'',document:''},requirementSummary:{evidenceCount:0}
  }]
}]});
assert.ok(quality.structuralBlockers.includes('actionable-non-vacancy-recruitment-unit'));
assert.equal(quality.counts.actionableNonVacancyUnits,1);

console.log('v123 Stage 8 responsibility/non-vacancy unit guard tests passed');
