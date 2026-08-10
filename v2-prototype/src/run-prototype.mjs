import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverJobAlio } from './adapters/job-alio.mjs';
import { discoverCleaneye } from './adapters/cleaneye.mjs';
import { discoverNarailter } from './adapters/narailter.mjs';
import { normalizePosting } from './lib/normalize.mjs';
import { classifyPosting, dedupe } from './lib/reconcile.mjs';
import { extractWithOpenAI } from './ai/openai-extractor.mjs';
import { validateExtraction } from './lib/validate-extraction.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const args=new Set(process.argv.slice(2));
const limitArg=process.argv.find(x=>x.startsWith('--limit='));
const limit=limitArg?Number(limitArg.split('=')[1]):30;
const cleaneyeSidoArg=process.argv.find(x=>x.startsWith('--cleaneye-sido='));
const cleaneyeSido=cleaneyeSidoArg?cleaneyeSidoArg.split('=')[1]:(process.env.NEXTJOB_CLEANEYE_SIDO_CD||'');
let postings=[];
if(args.has('--fixture')) {
  postings=JSON.parse(await fs.readFile(path.join(root,'benchmark/inputs/fixture-postings.json'),'utf8'));
} else if(args.has('--live')) {
  if(!cleaneyeSido) throw new Error('Live mode requires --cleaneye-sido=<official sido code> or NEXTJOB_CLEANEYE_SIDO_CD');
  const [a,c,n]=await Promise.all([discoverJobAlio({rows:limit}),discoverCleaneye({sidoCd:cleaneyeSido,rows:limit}),discoverNarailter({rows:limit})]);
  postings=[...a.map(x=>({source:'job-alio',...x})),...c.map(x=>({source:'cleaneye',...x})),...n.map(x=>({source:'narailter',...x}))];
} else throw new Error('use --fixture or --live');

let normalized=postings.map(x=>normalizePosting(x.source,x));
normalized=dedupe(normalized).map(p=>({...p,postingType:classifyPosting(p)}));
const year=String(new Date().getFullYear());
normalized=normalized.filter(p=>`${p.title} ${p.applyStart} ${p.applyEnd}`.includes(year));
const out={generatedAt:new Date().toISOString(),count:normalized.length,postings:normalized};
if(args.has('--ai')) {
  out.extractions=[];
  for(const p of normalized.filter(x=>x.postingType==='recruitment').slice(0,limit)){
    const e=await extractWithOpenAI(p,{apiText:p.detailText,attachments:p.attachments,sourceUrl:p.sourceUrl});
    out.extractions.push({source:p.source,sourceId:p.sourceId,extraction:e,validation:validateExtraction(e)});
  }
}
await fs.mkdir(path.join(root,'output'),{recursive:true});
await fs.writeFile(path.join(root,'output/prototype-result.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify({ok:true,count:out.count,types:Object.groupBy?Object.groupBy(normalized,x=>x.postingType):normalized.reduce((a,x)=>(a[x.postingType]=(a[x.postingType]||0)+1,a),{})},null,2));
