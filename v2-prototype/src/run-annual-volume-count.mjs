import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeServiceKey, fetchText, parseRecords, summarizeRecords,
  dedupeAndClassify, costScenarios, detectYear
} from './volume/annual-volume-lib.mjs';

const YEAR=Number(process.env.NEXTJOB_COUNT_YEAR||process.argv.find(x=>/^20\d{2}$/.test(x))||2025);
const OUT=path.resolve('v2-prototype/output/annual-volume');
await fs.mkdir(OUT,{recursive:true});
const key=normalizeServiceKey();
const startedAt=new Date().toISOString();

async function countJobAlio(){
  const base='https://apis.data.go.kr/1051000/recruitment/list';
  const rows=100, maxPages=Number(process.env.NEXTJOB_JOBALIO_MAX_PAGES||500);
  const all=[]; let pages=0; let consecutiveOlder=0; let stopped='max_pages';
  for(let page=1;page<=maxPages;page++){
    const u=new URL(base); u.searchParams.set('serviceKey',key); u.searchParams.set('pageNo',page); u.searchParams.set('numOfRows',rows); u.searchParams.set('resultType','json');
    const rec=parseRecords(await fetchText(u)); pages=page;
    if(!rec.length){ stopped='empty_page'; break; }
    all.push(...rec);
    const years=rec.map(r=>detectYear(r).year).filter(Boolean);
    if(years.length && Math.max(...years)<YEAR) consecutiveOlder++; else consecutiveOlder=0;
    // APIs are normally newest-first. Stop only after three entire pages are older than target.
    if(consecutiveOlder>=3){ stopped='three_pages_older_than_target'; break; }
    if(rec.length<rows){ stopped='short_page'; break; }
  }
  return {source:'job_alio',pages,stopped,...summarizeRecords(all,'job_alio',YEAR)};
}

async function countCleaneye(){
  // Official sido code family is 007001..007017 (17 provinces). Avoid a fourth API approval dependency.
  const codes=Array.from({length:17},(_,i)=>`007${String(i+1).padStart(3,'0')}`);
  const all=[]; const perSido=[];
  for(const sidoCd of codes){
    const u=new URL('https://apis.data.go.kr/B551982/openApiEmployInfo/openXmlEmployInfo');
    u.searchParams.set('serviceKey',key); u.searchParams.set('sidoCd',sidoCd); u.searchParams.set('type','xml');
    try{
      const rec=parseRecords(await fetchText(u)); all.push(...rec); perSido.push({sidoCd,rows:rec.length,status:'ok'});
    }catch(e){ perSido.push({sidoCd,rows:0,status:'error',error:String(e.message||e).slice(0,500)}); }
  }
  return {source:'cleaneye',perSido,...summarizeRecords(all,'cleaneye',YEAR)};
}

async function countNarailter(){
  const base='https://apis.data.go.kr/1760000/PblJobService/getList';
  const rows=100, maxPages=Number(process.env.NEXTJOB_NARAILTER_MAX_PAGES||1000);
  const all=[]; let pages=0; let consecutiveOlder=0; let stopped='max_pages';
  for(let page=1;page<=maxPages;page++){
    const u=new URL(base); u.searchParams.set('serviceKey',key); u.searchParams.set('pageNo',page); u.searchParams.set('numOfRows',rows);
    const rec=parseRecords(await fetchText(u)); pages=page;
    if(!rec.length){ stopped='empty_page'; break; }
    all.push(...rec);
    const years=rec.map(r=>detectYear(r).year).filter(Boolean);
    if(years.length && Math.max(...years)<YEAR) consecutiveOlder++; else consecutiveOlder=0;
    if(consecutiveOlder>=3){ stopped='three_pages_older_than_target'; break; }
    if(rec.length<rows){ stopped='short_page'; break; }
  }
  return {source:'narailter',pages,stopped,...summarizeRecords(all,'narailter',YEAR)};
}

const sources=[];
for(const fn of [countJobAlio,countCleaneye,countNarailter]){
  try { sources.push(await fn()); }
  catch(e){ sources.push({source:fn.name.replace(/^count/,'').toLowerCase(),error:String(e.stack||e)}); }
}

const targetRows=sources.flatMap(s=>s.targetRecords||[]);
const combined=dedupeAndClassify(targetRows);
const errors=sources.filter(s=>s.error || (s.perSido&&s.perSido.some(x=>x.status==='error'))).map(s=>({source:s.source,error:s.error||'one or more region calls failed'}));
const warnings=[];
for(const s of sources){
  if((s.unknownYearRecords||[]).length) warnings.push(`${s.source}: ${s.unknownYearRecords.length} rows had no reliably detected year and were excluded from ${YEAR}.`);
  if(s.source==='cleaneye' && (s.targetRecords||[]).length===0) warnings.push(`cleaneye: ${YEAR} returned 0 reliably year-tagged rows. The API was introduced in 2026, so historical coverage may be incomplete; do not interpret 0 as zero local recruitment without verification.`);
}
if(errors.length) warnings.push('One or more source calls failed. Totals are partial until those errors are resolved.');

const report={
  schemaVersion:'nextjob-v2-annual-volume-v1',
  targetYear:YEAR,startedAt,finishedAt:new Date().toISOString(),
  methodology:{
    purpose:'Measure annual public-job posting volume without any OpenAI call.',
    sources:['JOB-ALIO public institution recruitment API','Cleaneye local public institution recruitment API','Narailter public employment API'],
    exactCountMeaning:'Rows with a reliably detected target year returned by each official API.',
    dedupeMeaning:'Conservative exact normalized institution+title+date duplicate removal. Similar-but-not-identical duplicates remain.',
    aiTargetMeaning:'Lower = obvious recruitment-like unique titles. Upper = lower + titles requiring manual classification review.',
    legal:'Counts only API metadata/content. No attachment redistribution and no OpenAI call.'
  },
  sourceSummary:sources.map(s=>({
    source:s.source,error:s.error||null,pages:s.pages||null,stopped:s.stopped||null,
    totalFetched:s.totalFetched||0,targetYearRows:(s.targetRecords||[]).length,unknownYearRows:(s.unknownYearRecords||[]).length,
    yearCounts:s.yearCounts||{},perSido:s.perSido||undefined
  })),
  combined:{
    grossTargetYearRows:targetRows.length,
    exactUniqueRows:combined.exactUniqueCount,
    exactDuplicateRows:combined.exactDuplicateRows,
    crossSourceExactDuplicateGroups:combined.crossSourceDuplicateGroupCount,
    classificationCounts:combined.classificationCounts,
    estimatedAiTargetLower:combined.estimatedAiTargetLower,
    estimatedAiTargetUpper:combined.estimatedAiTargetUpper,
    costScenariosKRW:costScenarios(combined.estimatedAiTargetLower,combined.estimatedAiTargetUpper)
  },
  warnings,errors
};

await fs.writeFile(path.join(OUT,`annual-volume-${YEAR}.json`),JSON.stringify(report,null,2));
await fs.writeFile(path.join(OUT,`annual-volume-${YEAR}.md`),renderMd(report));
await fs.writeFile(path.join(OUT,`target-records-${YEAR}.json`),JSON.stringify(combined.exactUnique,null,2));
console.log(renderMd(report));
if(errors.length) process.exitCode=2;

function n(v){return Number(v||0).toLocaleString('ko-KR');}
function won(v){return `${Number(v||0).toLocaleString('ko-KR')}원`;}
function renderMd(r){
  const lines=[`# Next Job v2 ${r.targetYear} 전국 공고량 측정`,``,`생성: ${r.finishedAt}`,``,`## Source별`,``,`| Source | ${r.targetYear} 건수 | 연도 미확정 | 호출상태 |`,`|---|---:|---:|---|`];
  for(const s of r.sourceSummary) lines.push(`| ${s.source} | ${n(s.targetYearRows)} | ${n(s.unknownYearRows)} | ${s.error?'ERROR':(s.stopped||'OK')} |`);
  lines.push('',`## 통합`, '',
    `- 원천 합계: **${n(r.combined.grossTargetYearRows)}건**`,
    `- 보수적 Exact Dedup(정확 일치 중복제거): **${n(r.combined.exactUniqueRows)}건**`,
    `- 명백한 채용공고형: **${n(r.combined.estimatedAiTargetLower)}건**`,
    `- 분류확인 필요 포함 AI 분석대상 상한: **${n(r.combined.estimatedAiTargetUpper)}건**`,
    '',`## AI 연간 비용 시나리오`,``,`| 공고 1건 원가 | 연간 하한 | 연간 상한 |`,`|---:|---:|---:|`);
  for(const c of r.combined.costScenariosKRW) lines.push(`| ${won(c.costPerPostingKRW)} | ${won(c.annualLowerKRW)} | ${won(c.annualUpperKRW)} |`);
  if(r.warnings.length){lines.push('','## 경고'); for(const w of r.warnings) lines.push(`- ${w}`);}
  lines.push('','> 이 보고서의 중복제거와 공고유형 분류는 **비용 산정을 위한 보수적 1차 추정**이다. API 원천 건수는 직접 측정하지만, 최종 사업용 공고량은 실제 공고 ID/원문 Reconciliation 검증 후 확정한다.');
  return lines.join('\n');
}
