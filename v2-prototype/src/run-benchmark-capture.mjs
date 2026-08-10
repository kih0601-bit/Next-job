import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverJobAlio } from './adapters/job-alio.mjs';
import { discoverCleaneye } from './adapters/cleaneye.mjs';
import { discoverCleaneyeSidoCodes } from './adapters/cleaneye-sido.mjs';
import { discoverNarailter } from './adapters/narailter.mjs';
import { normalizePosting } from './lib/normalize.mjs';
import { classifyPosting, dedupe } from './lib/reconcile.mjs';
import { extractWithOpenAI } from './ai/openai-extractor.mjs';
import { validateExtraction } from './lib/validate-extraction.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const outDir=path.join(root,'output','benchmark-capture');
const target=30;
const currentYear=String(new Date().getFullYear());

function complexity(p){
  const s=`${p.title} ${p.detailText} ${(p.workplaces||[]).join(' ')}`;
  let score=0;
  if(/,|·|및|또는|or|and/i.test(s)) score++;
  if(/자격|면허|기사|산업기사|경력|학력|전공|지역|근무지/i.test(s)) score++;
  if((p.detailText||'').length>500) score++;
  if(/정규직.*기간제|기간제.*정규직|무기계약|다수|분야|직렬/i.test(s)) score++;
  return score>=3?'hard':score>=1?'medium':'simple';
}

function stableSort(arr){
  return [...arr].sort((a,b)=>`${a.source}|${a.sourceId}|${a.title}`.localeCompare(`${b.source}|${b.sourceId}|${b.title}`,'ko'));
}

function pick(candidates){
  const recruitment=candidates.filter(x=>x.postingType==='recruitment');
  const central=recruitment.filter(x=>x.source==='job-alio');
  const local=recruitment.filter(x=>x.source==='cleaneye');
  const secondary=recruitment.filter(x=>x.source==='narailter');
  const picked=[]; const seen=new Set();
  const take=(pool,n)=>{for(const p of stableSort(pool)){if(picked.length>=target||n<=0) break; const k=p.fingerprint; if(seen.has(k)) continue; seen.add(k); picked.push(p); n--;}};
  take(central.filter(x=>x.complexity==='hard'),5);
  take(central.filter(x=>x.complexity==='medium'),5);
  take(central.filter(x=>x.complexity==='simple'),5);
  take(local.filter(x=>x.complexity==='hard'),5);
  take(local.filter(x=>x.complexity==='medium'),5);
  take(local.filter(x=>x.complexity==='simple'),5);
  if(picked.length<target) take(secondary,target-picked.length);
  if(picked.length<target) take(recruitment,target-picked.length);
  return picked.slice(0,target);
}

const [jobAlio, sidoCodes, narailter]=await Promise.all([
  discoverJobAlio({rows:100}),
  discoverCleaneyeSidoCodes(),
  discoverNarailter({rows:100})
]);
let cleaneye=[];
for(const s of sidoCodes){
  try {
    const rows=await discoverCleaneye({sidoCd:s.code,rows:100});
    cleaneye.push(...rows.map(x=>({...x,_sidoCode:s.code,_sidoName:s.name})));
  } catch (e) {
    cleaneye.push({__error:true,_sidoCode:s.code,_sidoName:s.name,error:String(e?.message||e)});
  }
}

let normalized=[
  ...jobAlio.map(x=>normalizePosting('job-alio',x)),
  ...cleaneye.filter(x=>!x.__error).map(x=>normalizePosting('cleaneye',x)),
  ...narailter.map(x=>normalizePosting('narailter',x))
];
normalized=dedupe(normalized).map(p=>({...p,postingType:classifyPosting(p)}));
normalized=normalized.filter(p=>`${p.title} ${p.applyStart} ${p.applyEnd} ${p.raw?.empyear||''} ${p.raw?.채용연도||''}`.includes(currentYear));
normalized=normalized.map(p=>({...p,complexity:complexity(p)}));
const selected=pick(normalized);

const predictions=[];
for(const p of selected){
  try {
    const extraction=await extractWithOpenAI(p,{apiText:p.detailText,attachments:p.attachments,sourceUrl:p.sourceUrl});
    predictions.push({caseId:`${p.source}:${p.sourceId}`,posting:p,extraction,validation:validateExtraction(extraction)});
  } catch(e){
    predictions.push({caseId:`${p.source}:${p.sourceId}`,posting:p,error:String(e?.stack||e)});
  }
}

await fs.mkdir(outDir,{recursive:true});
await fs.writeFile(path.join(outDir,'selected-30.json'),JSON.stringify({generatedAt:new Date().toISOString(),year:currentYear,sidoCodes,selected},null,2));
await fs.writeFile(path.join(outDir,'predictions.json'),JSON.stringify({generatedAt:new Date().toISOString(),model:process.env.NEXTJOB_AI_MODEL,predictions},null,2));
await fs.writeFile(path.join(outDir,'source-summary.json'),JSON.stringify({
  year:currentYear,
  discovered:{jobAlio:jobAlio.length,cleaneye:cleaneye.filter(x=>!x.__error).length,narailter:narailter.length},
  normalized:normalized.length,
  selected:selected.length,
  cleaneyeErrors:cleaneye.filter(x=>x.__error)
},null,2));
console.log(JSON.stringify({ok:true,year:currentYear,selected:selected.length,predictions:predictions.length,output:outDir},null,2));
