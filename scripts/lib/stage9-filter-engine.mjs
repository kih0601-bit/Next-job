import { classifyJobCategory } from './stage9-job-taxonomy.mjs';

export const STAGE9_FILTER_ENGINE_VERSION='1.0.0-v120';
export const ELIGIBILITY_STATUS=Object.freeze({ELIGIBLE:'eligible',INELIGIBLE:'ineligible',REVIEW:'needs-review'});

const uniq=(a=[])=>[...new Set(a.filter(Boolean))];
const norm=(v='')=>String(v).toLowerCase().replace(/\s+/g,'').replace(/[()\[\]{}.,:;·\-_/]/g,'');
const evidenceOf=(row={})=>row.evidenceDetailed||row.evidence||[];
const requiredRows=(rows=[])=>rows.filter(x=>x?.level==='required');
const preferredRows=(rows=[])=>rows.filter(x=>x?.level==='preferred');

function educationRank(value=''){
  const s=String(value);
  if(/박사/.test(s)) return 5;
  if(/석사/.test(s)) return 4;
  if(/대졸|학사|4년제/.test(s)) return 3;
  if(/전문대|전문학사/.test(s)) return 2;
  if(/고졸|고등학교/.test(s)) return 1;
  return null;
}
function educationDecision(req={},profile={}){
  const values=req.education?.values||[];
  if(req.education?.resolution==='explicit-no-restriction'||values.includes('학력무관')) return {status:'pass',reason:'학력 제한 없음',required:values,evidence:req.education?.evidenceDetailed||[]};
  if(!values.length) return {status:'pass',reason:'명시된 필수 학력 없음',required:[],evidence:[]};
  if(!profile.educationKnown) return {status:'review',reason:'사용자 학력 정보 확인 필요',required:values,evidence:req.education?.evidenceDetailed||[]};
  const needed=Math.max(...values.map(educationRank).filter(Boolean),0); const have=educationRank(profile.education);
  if(!needed) return {status:'review',reason:'학력 조건 해석 확인 필요',required:values,evidence:req.education?.evidenceDetailed||[]};
  return have>=needed
    ? {status:'pass',reason:'필수 학력 충족',required:values,evidence:req.education?.evidenceDetailed||[]}
    : {status:'fail',reason:`필수 학력 미충족 (${values.join(', ')})`,required:values,evidence:req.education?.evidenceDetailed||[],mutable:false};
}
function licenseDecision(req={},profile={}){
  const rows=requiredRows(req.licenses||[]); if(!rows.length) return {status:'pass',reason:'명시된 필수 자격/면허 없음',required:[],evidence:[]};
  if(!profile.licensesKnown) return {status:'review',reason:'보유 자격/면허 정보 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  const owned=(profile.licenses||[]).map(norm);
  const missing=rows.filter(row=>!owned.some(x=>x&&norm(row.value).includes(x)));
  return missing.length
    ? {status:'fail',reason:'필수 자격/면허 미충족',required:rows.map(x=>x.value),missing:missing.map(x=>x.value),evidence:missing.flatMap(evidenceOf),mutable:true,mutableType:'license'}
    : {status:'pass',reason:'필수 자격/면허 충족',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
}
function experienceDecision(req={},profile={}){
  const rows=requiredRows(req.experience||[]); if(!rows.length) return {status:'pass',reason:'명시된 필수 경력 없음',required:[],evidence:[]};
  if(!profile.experienceKnown) return {status:'review',reason:'경력 정보 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  const requiredYears=Math.max(...rows.map(x=>Number(String(x.value).match(/(\d+)\s*년\s*이상/)?.[1]||0)));
  if(!requiredYears) return {status:'review',reason:'필수 경력의 세부 조건 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  return Number(profile.experienceYears||0)>=requiredYears
    ? {status:'pass',reason:'필수 경력 충족',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)}
    : {status:'fail',reason:`필수 경력 ${requiredYears}년 미충족`,required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf),mutable:true,mutableType:'experience-time'};
}
function genericKnownDecision(rows=[], known=false, label='', values=[]){
  const required=requiredRows(rows); if(!required.length) return {status:'pass',reason:`명시된 필수 ${label} 없음`,required:[],evidence:[]};
  if(!known) return {status:'review',reason:`사용자 ${label} 정보 확인 필요`,required:required.map(x=>x.value),evidence:required.flatMap(evidenceOf)};
  const owned=values.map(norm); const missing=required.filter(r=>!owned.some(v=>v&&norm(r.value).includes(v)));
  return missing.length?{status:'fail',reason:`필수 ${label} 미충족`,required:required.map(x=>x.value),missing:missing.map(x=>x.value),evidence:missing.flatMap(evidenceOf),mutable:false}:{status:'pass',reason:`필수 ${label} 충족`,required:required.map(x=>x.value),evidence:required.flatMap(evidenceOf)};
}
function ageDecision(req={},profile={}){
  const rows=requiredRows(req.age||[]); if(!rows.length) return {status:'pass',reason:'명시된 필수 연령 제한 없음',required:[],evidence:[]};
  if(!profile.ageKnown) return {status:'review',reason:'사용자 연령 정보 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  // Age expressions are diverse; only hard-fail when a clear min/max is present.
  const text=rows.map(x=>x.value).join(' '); const age=Number(profile.age);
  const max=Number(text.match(/(?:만\s*)?(\d{1,2})\s*세\s*(?:이하|미만)/)?.[1]||0);
  const min=Number(text.match(/(?:만\s*)?(\d{1,2})\s*세\s*(?:이상|초과)/)?.[1]||0);
  if(max&&age>max) return {status:'fail',reason:`연령 상한 ${max}세 미충족`,required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf),mutable:false};
  if(min&&age<min) return {status:'fail',reason:`연령 하한 ${min}세 미충족`,required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf),mutable:false};
  if(max||min) return {status:'pass',reason:'필수 연령 조건 충족',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  return {status:'review',reason:'연령 조건 세부 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
}

function evaluateAlternativeGroup(group={},profile={}){
  const optionResults=(group.options||[]).map(option=>{
    let state='pass'; const reasons=[];
    if((option.education||[]).length){
      if(!profile.educationKnown){state='review'; reasons.push('학력정보 확인 필요');}
      else { const need=Math.max(...option.education.map(educationRank).filter(Boolean),0); const have=educationRank(profile.education); if(need&&have<need){state='fail';reasons.push('학력경로 미충족');} }
    }
    const exp=Number((option.experience||[]).join(' ').match(/(\d+)\s*년\s*이상/)?.[1]||0);
    if(exp){ if(!profile.experienceKnown){if(state!=='fail')state='review';reasons.push('경력정보 확인 필요');} else if(Number(profile.experienceYears||0)<exp){state='fail';reasons.push(`경력 ${exp}년 미충족`);} }
    if((option.licenses||[]).length){ if(!profile.licensesKnown){if(state!=='fail')state='review';reasons.push('자격정보 확인 필요');} else if(!(profile.licenses||[]).some(l=>option.licenses.some(x=>norm(x).includes(norm(l))))){state='fail';reasons.push('자격경로 미충족');} }
    return {status:state,reasons,raw:option.raw,evidence:option.evidenceDetailed||[]};
  });
  if(optionResults.some(x=>x.status==='pass')) return {status:'pass',reason:'선택형 필수요건 중 1개 경로 충족',options:optionResults,evidence:group.evidenceDetailed||[]};
  if(optionResults.some(x=>x.status==='review')) return {status:'review',reason:'선택형 필수요건 충족 여부 확인 필요',options:optionResults,evidence:group.evidenceDetailed||[]};
  return {status:'fail',reason:'선택형 필수요건 경로 모두 미충족',options:optionResults,evidence:group.evidenceDetailed||[],mutable:false};
}

function preferredMatch(req={},profile={}){
  const rows=[...(req.licenses||[]),...(req.experience||[]),...(req.major||[]),...(req.jobRelated||[]),...(req.other||[])].filter(x=>x?.level==='preferred');
  const matched=[],unresolved=[];
  for(const row of rows){
    const t=String(row.value||'');
    if(/자격|면허|기사|기능사|컴퓨터활용|한국사|토익|TOEIC/i.test(t)){
      if(!profile.licensesKnown) unresolved.push(t); else if((profile.licenses||[]).some(l=>norm(t).includes(norm(l)))) matched.push(t);
    } else unresolved.push(t);
  }
  return {total:rows.length,matched:uniq(matched).length,matchedItems:uniq(matched),unresolvedItems:uniq(unresolved),policy:'preferred conditions never exclude; matches are recommendation signals only'};
}

export function evaluateStage9Eligibility(requirements={},profile={}){
  const alternatives=(requirements.qualificationAlternatives||[]).map(g=>evaluateAlternativeGroup(g,profile));
  const dimensions={
    education: educationDecision(requirements,profile),
    licenses: licenseDecision(requirements,profile),
    experience: experienceDecision(requirements,profile),
    age: ageDecision(requirements,profile),
    major: genericKnownDecision(requirements.major||[],profile.majorKnown,'전공',profile.majors||[]),
    legalOrIdentity: genericKnownDecision(requirements.legalOrIdentity||[],profile.legalOrIdentityKnown,'법정·신분요건',profile.legalOrIdentity||[]),
    other: genericKnownDecision(requirements.other||[],profile.otherKnown,'기타 필수요건',profile.other||[])
  };
  // When explicit OR qualification paths exist, education/experience/licenses are a combined route.
  if(alternatives.length){
    const route = alternatives.some(x=>x.status==='pass')?'pass':alternatives.some(x=>x.status==='review')?'review':'fail';
    dimensions.qualificationAlternative={status:route,reason:route==='pass'?'선택형 지원경로 충족':route==='review'?'선택형 지원경로 확인 필요':'선택형 지원경로 미충족',groups:alternatives};
    dimensions.education={...dimensions.education,status:'pass',reason:'선택형 지원경로에서 통합 판정'};
    dimensions.experience={...dimensions.experience,status:'pass',reason:'선택형 지원경로에서 통합 판정'};
    dimensions.licenses={...dimensions.licenses,status:'pass',reason:'선택형 지원경로에서 통합 판정'};
  }
  const all=Object.values(dimensions); const failed=all.filter(x=>x.status==='fail'), reviews=all.filter(x=>x.status==='review');
  const status=failed.length?ELIGIBILITY_STATUS.INELIGIBLE:reviews.length?ELIGIBILITY_STATUS.REVIEW:ELIGIBILITY_STATUS.ELIGIBLE;
  const mutableFailures=failed.filter(x=>x.mutable).map(x=>({type:x.mutableType||'other',reason:x.reason,missing:x.missing||[],required:x.required||[]}));
  const immutableFailures=failed.filter(x=>!x.mutable);
  const specUpPossible=status===ELIGIBILITY_STATUS.INELIGIBLE && mutableFailures.length>0 && immutableFailures.length===0 && reviews.length===0;
  return {
    status, dimensions,
    decisionReasons:uniq([...failed.map(x=>x.reason),...reviews.map(x=>x.reason)]),
    preferredMatch:preferredMatch(requirements,profile),
    specUp:{possible:specUpPossible,unlockConditions:mutableFailures,blockedBy:immutableFailures.map(x=>x.reason),policy:'v1 treats license acquisition and experience accumulation as mutable; UI recommendation may initially expose license-based unlocks only'},
    evidencePolicy:'every fail/review retains Stage-8-linked evidence when available'
  };
}

export function buildStage9Unit({posting={},unit={},profile={}}={}){
  const req=unit.requirements||{}; const localText=[...(req.jobRelated||[]),...(req.major||[])].map(x=>x?.value||'').filter(Boolean).join('\n');
  return {
    posting:{org:posting.org||'',title:posting.title||'',link:posting.link||''},
    unit:{id:unit.id||'',name:unit.name||'',source:unit.source||''},
    eligibility:evaluateStage9Eligibility(req,profile),
    searchFacets:{
      region:uniq([...(unit.workLocations||[]),...(req.location?.values||[])]),
      organization:[posting.org||''].filter(Boolean),
      jobCategory:[classifyJobCategory({vacancyName:unit.name,title:posting.title,localText}).label],
      employmentType:uniq([...(unit.employmentTypes||[]),...(req.employment?.values||[])])
    },
    jobCategory:classifyJobCategory({vacancyName:unit.name,title:posting.title,localText}),
    rawVacancyName:unit.name||''
  };
}
