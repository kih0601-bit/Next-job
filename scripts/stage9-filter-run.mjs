import fs from 'node:fs';
import { buildStage9Unit, STAGE9_FILTER_ENGINE_VERSION } from './lib/stage9-filter-engine.mjs';
import { JOB_CATEGORIES, STAGE9_JOB_TAXONOMY_VERSION } from './lib/stage9-job-taxonomy.mjs';
import { activeFilterDefinitions, STAGE9_SEARCH_FILTER_VERSION } from './lib/stage9-search-filter.mjs';

const STAGE8='data/stage8-eligibility-report.json', PROFILE='data/stage9-user-profile.json', CONFIG='data/stage9-search-filter-config.json', OUT='data/stage9-filter-report.json';
for(const p of [STAGE8,PROFILE,CONFIG]) if(!fs.existsSync(p)) throw new Error(`missing ${p}`);
const s8=JSON.parse(fs.readFileSync(STAGE8,'utf8')), profile=JSON.parse(fs.readFileSync(PROFILE,'utf8')), config=JSON.parse(fs.readFileSync(CONFIG,'utf8'));
const rows=[];
for(const post of s8.postings||[]) for(const unit of post.recruitmentUnits||[]) rows.push({...buildStage9Unit({posting:post.posting,unit,profile}),sourceHints:post.sourceHints||{},sourceCoverage:post.sourceCoverage||{}});
const count=status=>rows.filter(x=>x.eligibility.status===status).length;
const report={
  stage:9,version:'9.0.0-v120-foundation',generatedAt:new Date().toISOString(),
  purpose:'9A eligibility + extensible 9B search facets + preferred/spec-up preservation',
  upstream:{stage8Decision:s8.stage8Gate?.decision||'unknown',stage8Benchmark:s8.qualityAudit?.benchmark?.status||'unknown',liveSnapshotTrust:s8.stage8Gate?.liveSnapshotTrust||'unknown'},
  versions:{engine:STAGE9_FILTER_ENGINE_VERSION,taxonomy:STAGE9_JOB_TAXONOMY_VERSION,searchFilter:STAGE9_SEARCH_FILTER_VERSION},
  summary:{units:rows.length,eligible:count('eligible'),ineligible:count('ineligible'),needsReview:count('needs-review'),specUpPossible:rows.filter(x=>x.eligibility.specUp?.possible).length},
  policy:{eligibility:'required-only',searchPreference:'9B runs only on 9A eligible rows',preferred:'recommendation signal only; never exclusion',salary:'display-only; not a Stage 9 filter',specUp:'preserve mutable failure reasons; initial product may expose license unlocks first'},
  searchFilterDefinitions:activeFilterDefinitions(config.filters),
  jobTaxonomy:JOB_CATEGORIES.map(({patterns,...x})=>x),
  rows
};
fs.writeFileSync(OUT,`${JSON.stringify(report,null,2)}\n`,'utf8');
console.log(JSON.stringify(report.summary));
