import fs from 'node:fs';
const IN='data/stage9-filter-report.json', OUT='data/jobs.json';
if(!fs.existsSync(IN)) throw new Error(`missing ${IN}`);
const s9=JSON.parse(fs.readFileSync(IN,'utf8'));
const rows=Array.isArray(s9.rows)?s9.rows:[];
const jobs=rows.map((r,i)=>({
  id:`${r.posting?.org||'org'}::${r.posting?.link||r.posting?.title||i}::${r.unit?.id||i}`,
  org:r.posting?.org||'', title:r.posting?.title||'', vacancyName:r.unit?.name||r.rawVacancyName||'', link:r.posting?.link||'',
  eligibilityStatus:r.eligibility?.status||'needs-review', eligibilityReasons:r.eligibility?.decisionReasons||[], dimensions:r.eligibility?.dimensions||{},
  preferredMatch:r.eligibility?.preferredMatch||{}, specUp:r.eligibility?.specUp||{}, searchFacets:r.searchFacets||{}, searchFacetProvenance:r.searchFacetProvenance||{},
  jobCategory:r.jobCategory||{}, sourceHints:r.sourceHints||{}, sourceCoverage:r.sourceCoverage||{}, unitSource:r.unit?.source||''
}));
const count=s=>jobs.filter(j=>j.eligibilityStatus===s).length;
const out={
  stage:10,schemaVersion:'1.0.0',version:'10.0.0-v127-ui-contract',updatedAt:new Date().toISOString(),
  sourceStage9Version:s9.version||'',trust:{stage8Decision:s9.upstream?.stage8Decision||'unknown',stage8Benchmark:s9.upstream?.stage8Benchmark||'unknown',liveSnapshotTrust:s9.upstream?.liveSnapshotTrust||'unknown'},
  stats:{units:jobs.length,eligible:count('eligible'),ineligible:count('ineligible'),needsReview:count('needs-review'),specUpPossible:jobs.filter(j=>j.specUp?.possible).length},
  jobs
};
fs.writeFileSync(OUT,`${JSON.stringify(out,null,2)}\n`,'utf8');
console.log(JSON.stringify(out.stats));
