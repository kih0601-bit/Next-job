import fs from 'node:fs';
const s9=JSON.parse(fs.readFileSync('data/stage9-filter-report.json','utf8'));
const s10=JSON.parse(fs.readFileSync('data/jobs.json','utf8'));
if(s10.stage!==10) throw new Error('Stage10 marker missing');
if((s9.rows||[]).length!==(s10.jobs||[]).length) throw new Error('Stage9/10 row count mismatch');
for(let i=0;i<(s9.rows||[]).length;i++){
 const a=s9.rows[i],b=s10.jobs[i];
 if((a.eligibility?.status||'needs-review')!==b.eligibilityStatus) throw new Error(`eligibility mutated at ${i}`);
 if((a.unit?.name||a.rawVacancyName||'')!==b.vacancyName) throw new Error(`unit name mutated at ${i}`);
 if((a.posting?.link||'')!==b.link) throw new Error(`link mutated at ${i}`);
}
console.log('v127 stage10 UI contract: PASS');
