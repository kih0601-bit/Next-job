import { normalizePosting } from '../lib/normalize.mjs';
import { extractCodeOnly } from './code-extract.mjs';

export function yearOf(v){ const m=String(v||'').match(/20\d{2}/); return m?Number(m[0]):null; }
export function recordYear(source,r){
  if(source==='job-alio') return yearOf(r.pbancBgngYmd || r.pbancEndYmd);
  if(source==='cleaneye') return yearOf(r.EMPYEAR || r.PUB_DATE || r.UPD_DATE);
  return null;
}
export function buildCases(source,records,{year=new Date().getFullYear()}={}){
  return records.filter(r=>recordYear(source,r)===year).map(raw=>{
    const posting=normalizePosting(source,raw);
    return {caseId:posting.identity,source,posting,prediction:extractCodeOnly(posting)};
  });
}
export function selectBalanced(cases,target=100){
  const bySource=new Map();
  for(const c of cases){ const a=bySource.get(c.source)||[]; a.push(c); bySource.set(c.source,a); }
  for(const a of bySource.values()) a.sort((x,y)=>x.caseId.localeCompare(y.caseId,'ko'));
  const out=[]; const seen=new Set();
  const sources=[...bySource.keys()];
  let i=0;
  while(out.length<target && sources.some(s=>bySource.get(s).length)){
    const s=sources[i%sources.length]; const a=bySource.get(s); const c=a.shift(); i++;
    if(!c) continue;
    const fp=c.posting.fingerprint; if(seen.has(fp)) continue; seen.add(fp); out.push(c);
  }
  return out;
}
export function summarize(cases){
  const s={total:cases.length,candidateComplete:0,unresolved:0,bySource:{},unresolvedReasons:{}};
  for(const c of cases){
    const st=c.prediction.candidateStatus; if(st==='candidate_complete')s.candidateComplete++; else s.unresolved++;
    s.bySource[c.source] ||= {total:0,candidateComplete:0,unresolved:0}; s.bySource[c.source].total++; s.bySource[c.source][st==='candidate_complete'?'candidateComplete':'unresolved']++;
    for(const r of c.prediction.unresolved||[]) s.unresolvedReasons[r]=(s.unresolvedReasons[r]||0)+1;
  }
  return s;
}
