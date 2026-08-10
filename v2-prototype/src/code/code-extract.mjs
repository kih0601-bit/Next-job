const NONE_WORDS = /^(?:무관|제한\s*없음|학력\s*무관|없음|해당\s*없음)$/;
const REF_ONLY = /(?:공고(?:문)?|홈페이지|채용사이트|알림마당).{0,30}(?:참조|확인)|(?:참조|확인).{0,30}(?:공고(?:문)?|홈페이지|채용사이트|알림마당)|^[-–—]$/;
const PREFERRED = /(?:우대|가점|우선|선호)/;
const REQUIRED = /(?:필수|응시자격|지원자격|자격요건|소지자|이상인\s*자|충족)/;

function ev(id, field, quote, ruleId){ return {id,sourceType:'api',sourceField:field,quote:String(quote||'').trim(),ruleId}; }
function req(status='unknown',value=null,logic='unknown',evidence=[]){return {status,value,logic,evidence};}
function lines(text=''){return String(text).split(/\r?\n|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);}
function uniq(a){return [...new Set(a.filter(Boolean))];}

function educationFromDirect(p,evidence){
  const s=p.structured.education?.trim();
  if(!s) return req('unknown');
  const e=ev('edu-direct','structured.education',s,'EDU_DIRECT_001'); evidence.push(e);
  if(NONE_WORDS.test(s)) return req('none',s,'none',[e]);
  return req('required',s,'none',[e]);
}
function regionFromDirect(p,evidence){
  if(p.source==='cleaneye'){
    const flag=(p.structured.localRestrictionFlag||'').toUpperCase();
    const name=p.structured.localRestrictionName||'';
    if(flag==='N') { const e=ev('region-local-n','LOCAL_YN','N','REGION_CLEANEYE_001'); evidence.push(e); return req('none','지역제한 없음','none',[e]); }
    if(flag==='Y' && name && !REF_ONLY.test(name)){ const e=ev('region-local-y','LOCAL_NAME',name,'REGION_CLEANEYE_002'); evidence.push(e); return req('required',name,'none',[e]); }
  }
  return req('unknown');
}
function licenseFromStructured(p,evidence, unresolved){
  const vals=(p.structured.licenses||[]).filter(Boolean);
  if(!vals.length) return null;
  const concrete=vals.filter(v=>!REF_ONLY.test(v) && !NONE_WORDS.test(v));
  if(!concrete.length){ unresolved.push('license_field_reference_only'); return req('unknown'); }
  const es=concrete.map((v,i)=>ev(`lic-direct-${i+1}`,'structured.licenses',v,'LICENSE_DIRECT_001')); evidence.push(...es);
  return req('required',uniq(concrete).join(' / '),concrete.length>1?'and':'none',es);
}
function classifyLines(text=''){
  const all=lines(text);
  const requiredLines=[]; const preferredLines=[]; let section='neutral';
  for(const l of all){
    if(/^\s*[\[【<〈(]?(?:필수사항|필수자격|응시자격|지원자격|자격요건)[\]】>〉)]?\s*[:：]?\s*$/.test(l)){section='required'; continue;}
    if(/^\s*[\[【<〈(]?(?:우대사항|우대조건|가점사항)[\]】>〉)]?\s*[:：]?\s*$/.test(l)){section='preferred'; continue;}
    if(/^\s*[\[【<〈].+[\]】>〉]\s*$/.test(l)){section='neutral'; continue;}
    if(section==='preferred' || PREFERRED.test(l)){preferredLines.push(l); continue;}
    if(section==='required' || REQUIRED.test(l)){requiredLines.push(l); continue;}
  }
  return {all,requiredLines,preferredLines};
}

function parseQualificationText(p,evidence,unresolved){
  const {all,requiredLines,preferredLines}=classifyLines(p.detailText);
  const out={experience:null,licenses:null,age:null,majorJob:null,legalOther:null};

  const ex=requiredLines.filter(l=>/(?:관련\s*)?경력.{0,12}\d+(?:\.\d+)?\s*(?:년|개월)\s*(?:이상|이상인|보유)/.test(l));
  if(ex.length){ const es=ex.map((q,i)=>ev(`exp-${i+1}`,'detailText',q,'EXP_REQUIRED_001')); evidence.push(...es); out.experience=req('required',uniq(ex).join(' / '),ex.some(x=>/또는|or/i.test(x))?'or':(ex.length>1?'and':'none'),es); }

  const lic=requiredLines.filter(l=>/(?:면허(?:증)?|자격증|전문의\s*자격|(?:산업)?기사).{0,25}(?:소지|보유|취득)|(?:소지|보유).{0,20}(?:면허|자격증)/.test(l));
  if(lic.length){ const es=lic.map((q,i)=>ev(`lic-${i+1}`,'detailText',q,'LICENSE_REQUIRED_002')); evidence.push(...es); out.licenses=req('required',uniq(lic).join(' / '),lic.some(x=>/또는|or/i.test(x))?'or':(lic.length>1?'and':'none'),es); }

  const age=requiredLines.filter(l=>/(?:만\s*)?\d{1,2}\s*세\s*(?:이상|이하)|\d{1,2}\s*[~～-]\s*\d{1,2}\s*세/.test(l));
  if(age.length){const es=age.map((q,i)=>ev(`age-${i+1}`,'detailText',q,'AGE_REQUIRED_001')); evidence.push(...es); out.age=req('required',uniq(age).join(' / '),age.length>1?'and':'none',es);}

  const major=requiredLines.filter(l=>/(?:전공(?:자|한\s*자|졸업)|관련\s*(?:학과|전공).{0,15}(?:졸업|학위))/.test(l));
  if(major.length){const es=major.map((q,i)=>ev(`major-${i+1}`,'detailText',q,'MAJOR_REQUIRED_001')); evidence.push(...es); out.majorJob=req('required',uniq(major).join(' / '),major.length>1?'and':'none',es);}

  const legal=requiredLines.filter(l=>/(?:병역.{0,20}(?:기피|의무)|국가공무원법\s*제?33조|결격사유)/.test(l));
  if(legal.length){const es=legal.map((q,i)=>ev(`legal-${i+1}`,'detailText',q,'LEGAL_REQUIRED_001')); evidence.push(...es); out.legalOther=req('required',uniq(legal).join(' / '),legal.length>1?'and':'none',es);}

  // Safety: requirement-looking lines that remain semantically unclassified force review.
  const consumed=new Set([...ex,...lic,...age,...major,...legal]);
  for(const l of requiredLines){
    if(consumed.has(l)) continue;
    if(/(?:학력|경력|자격|면허|전공|거주|지역|연령|나이|병역|결격)/.test(l)) unresolved.push(`unparsed_required:${l.slice(0,120)}`);
  }
  if(preferredLines.some(l=>/(?:학력|경력|자격|면허|전공|지역)/.test(l))) unresolved.push('preferred_conditions_present');
  return out;
}

export function extractCodeOnly(p){
  const evidence=[]; const unresolved=[];
  const parsed=parseQualificationText(p,evidence,unresolved);
  const structuredLic=licenseFromStructured(p,evidence,unresolved);
  const requirements={
    education: educationFromDirect(p,evidence),
    experience: parsed.experience || req('unknown'),
    licenses: structuredLic || parsed.licenses || req('unknown'),
    age: parsed.age || req('unknown'),
    majorJob: parsed.majorJob || req('unknown'),
    region: regionFromDirect(p,evidence),
    legalOther: parsed.legalOther || req('unknown'),
  };
  if(p.mappingWarnings?.length) unresolved.push(...p.mappingWarnings.map(x=>`mapping:${x}`));
  if(!p.employmentType) unresolved.push('missing_employment_type');
  if(!p.workplaces.length && p.source==='job-alio') unresolved.push('missing_workplace');
  if(p.source==='cleaneye' && !p.workplaces.length) unresolved.push('cleaneye_workplace_not_explicit');
  if(/(?:복수|다수|분야별|직렬별|직급별)/.test(`${p.title}\n${p.detailText}`)) unresolved.push('possible_multi_unit');
  if(/(?:또는|\bor\b)/i.test(p.detailText) && !Object.values(requirements).some(r=>r.logic==='or')) unresolved.push('unresolved_or_logic');
  const candidateStatus=unresolved.length ? 'unresolved' : 'candidate_complete';
  return {
    schemaVersion:'nextjob-v2-code-extraction-v1',
    postingType:'recruitment',
    candidateStatus,
    recruitmentUnits:[{unitName:p.title,headcount:p.headcount,employmentType:p.employmentType,workplaces:p.workplaces,requirements,evidence}],
    unresolved:uniq(unresolved),
  };
}
