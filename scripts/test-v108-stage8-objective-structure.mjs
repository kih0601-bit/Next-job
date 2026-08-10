import assert from 'node:assert/strict';
import { buildStage8Posting, buildStage8Report } from './lib/stage8-eligibility-structure.mjs';
import { extractSupportRequirements } from './lib/requirement-extractor.mjs';

const detail=`공통 응시자격
대한민국 국적을 가진 자
병역필 또는 면제자

모집분야 | 채용인원 | 근무지
일반행정 | 3명 | 울산
전산 | 2명 | 울산
시설관리 | 1명 | 울산`;

const document=`일반행정
학력 무관
경력 무관

전산
대학교 졸업 이상
정보처리기사 소지자에 한함

시설관리
고등학교 졸업 이상
전기기사 소지자에 한함
관련 분야 경력 2년 이상`;

const vacancies=[
 {id:'vacancy-1',name:'일반행정',localText:'일반행정 | 3명 | 울산\n학력 무관\n경력 무관',source:'table-row',confidence:0.9},
 {id:'vacancy-2',name:'전산',localText:'전산 | 2명 | 울산\n대학교 졸업 이상\n정보처리기사 소지자에 한함',source:'table-row',confidence:0.9},
 {id:'vacancy-3',name:'시설관리',localText:'시설관리 | 1명 | 울산\n고등학교 졸업 이상\n전기기사 소지자에 한함\n관련 분야 경력 2년 이상',source:'table-row',confidence:0.9}
];

const posting=buildStage8Posting({
 org:'테스트기관',title:'2026년 직원 채용',link:'https://example.com/1',
 listText:'2026년 직원 채용 6명',detailText:detail,detailOk:true,
 attachments:[{name:'채용공고.pdf'}],
 documents:{discovered:1,attempted:1,successful:1,text:document,results:[{name:'채용공고.pdf'}]},
 vacancies
});

assert.equal(posting.recruitmentUnits.length,3);
assert.equal(posting.recruitmentUnits[0].headcount.value,3);
assert.equal(posting.recruitmentUnits[1].headcount.value,2);
assert.equal(posting.recruitmentUnits[2].headcount.value,1);
assert(posting.recruitmentUnits[1].requirements.education.values.includes('대졸 이상'));
assert(posting.recruitmentUnits[1].requirements.licenses.some(x=>/정보처리기사/.test(x.value)));
assert(posting.recruitmentUnits[2].requirements.licenses.some(x=>/전기기사/.test(x.value)));
assert(posting.recruitmentUnits[2].requirements.experience.some(x=>x.level==='required'));
assert(posting.commonRequirements.legalOrIdentity.some(x=>/대한민국 국적/.test(x.value)));
assert.equal(posting.analysisStatus,'complete');

const req=extractSupportRequirements({detailText:'만 60세 미만\n관련 전공 우대\n울산 근무'});
assert(req.age.length>=1);
assert(req.major.some(x=>x.level==='preferred'));
assert(req.location.evidenceDetailed.every(x=>x.source==='detail'));

const report=buildStage8Report([posting]);
assert.equal(report.summary.postingCount,1);
assert.equal(report.summary.recruitmentUnitCount,3);
assert.equal(report.stage8Gate.decision,'keep-stage-8-open');
assert.equal(report.stage8Gate.preQualityEligible,true);

const partial=buildStage8Posting({
 org:'테스트기관',title:'상세 실패 공고',link:'https://example.com/2',
 listText:'채용 공고',detailText:'',detailOk:false,detailError:'timeout',
 documents:{discovered:0,attempted:0,successful:0,text:'',results:[]},vacancies:[]
});
assert.equal(partial.analysisStatus,'partial');
assert(partial.completion.watch.includes('detail-not-verified'));

console.log('v108 Stage-8 objective recruitment-unit structure regression passed');
