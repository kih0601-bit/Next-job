import fs from 'node:fs/promises';

const REPORT='data/stage8-eligibility-report.json';
const QUALITY='data/stage8-quality-report.json';
const OUT='data/stage8-benchmark-template.json';
const report=JSON.parse(await fs.readFile(REPORT,'utf8'));
const quality=JSON.parse(await fs.readFile(QUALITY,'utf8'));
const byKey=new Map((report.postings||[]).map(p=>[`${p.posting.org}|${p.posting.link}`,p]));
const risks=[
 ['multi-split',quality.samples?.singleDespiteMultiSignal||[]],
 ['unread-source',quality.samples?.unreadRequiredSources||[]],
 ['low-confidence',quality.samples?.lowConfidenceSingles||[]],
 ['no-evidence',quality.samples?.noEvidenceUnits||[]]
];
const picked=[]; const seen=new Set();
for(const [risk,rows] of risks){
  const orgSeen=new Set();
  for(const row of rows){
    const key=`${row.org}|${row.link}`; if(seen.has(`${risk}|${key}`)) continue;
    const posting=byKey.get(key); if(!posting) continue;
    const priority=(String(row.title).includes(String(new Date().getUTCFullYear()))?100:0)+(orgSeen.has(row.org)?0:10);
    picked.push({risk,priority,row,posting}); seen.add(`${risk}|${key}`); orgSeen.add(row.org);
  }
}
picked.sort((a,b)=>b.priority-a.priority||a.row.org.localeCompare(b.row.org,'ko'));
const samples=picked.slice(0,40).map((x,i)=>({
 id:`bench-${String(i+1).padStart(3,'0')}`,risk:x.risk,org:x.row.org,title:x.row.title,link:x.row.link,
 observed:{analysisStatus:x.posting.analysisStatus,recruitmentUnits:(x.posting.recruitmentUnits||[]).map(u=>({name:u.name,source:u.source,splitConfidence:u.splitConfidence,requirementSummary:u.requirementSummary,evidenceScope:u.evidenceScope}))},
 expected:{reviewed:false,recruitmentUnitNames:[],requirements:[],notes:''}
}));
const out={version:'1.0.0-v115',generatedAt:new Date().toISOString(),status:'awaiting-human-ground-truth',purpose:'Stage 8 원문 대조 Benchmark 정답셋 작성용. expected.reviewed=true인 표본만 정확도 계산에 사용.',requiredFields:['recruitmentUnitNames','requirements(required/preferred/unknown)','evidence-location'],samples};
await fs.writeFile(OUT,`${JSON.stringify(out,null,2)}\n`);
console.log({benchmarkSamples:samples.length,currentYear:samples.filter(x=>String(x.title).includes(String(new Date().getUTCFullYear()))).length});
