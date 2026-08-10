import { classifyJobCategory } from './stage9-job-taxonomy.mjs';

export const STAGE9_FILTER_ENGINE_VERSION='1.2.0-v122';
export const ELIGIBILITY_STATUS=Object.freeze({ELIGIBLE:'eligible',INELIGIBLE:'ineligible',REVIEW:'needs-review'});

const uniq=(a=[])=>[...new Set(a.filter(Boolean))];
const norm=(v='')=>String(v).toLowerCase().replace(/\s+/g,'').replace(/[()\[\]{}.,:;·\-_/]/g,'');
const evidenceOf=(row={})=>row.evidenceDetailed||row.evidence||[];
const requiredRows=(rows=[])=>rows.filter(x=>x?.level==='required');

function educationRank(value=''){
  const s=String(value);
  if(/박사/.test(s)) return 5;
  if(/석사/.test(s)) return 4;
  if(/대졸|학사|4년제/.test(s)) return 3;
  if(/전문대|전문학사/.test(s)) return 2;
  if(/고졸|고등학교|학위가\s*없는/.test(s)) return 1;
  return null;
}
function educationDecision(req={},profile={}){
  const values=req.education?.values||[];
  if(req.education?.resolution==='explicit-no-restriction'||values.includes('학력무관')) return {status:'pass',reason:'학력 제한 없음',required:values,evidence:req.education?.evidenceDetailed||[]};
  if(!values.length) return {status:'pass',reason:'명시된 필수 학력 없음',required:[],evidence:[]};
  if(!profile.educationKnown) return {status:'review',reason:'사용자 학력 정보 확인 필요',required:values,evidence:req.education?.evidenceDetailed||[]};
  const needed=Math.max(...values.map(educationRank).filter(Boolean),0), have=educationRank(profile.education);
  if(!needed) return {status:'review',reason:'학력 조건 해석 확인 필요',required:values,evidence:req.education?.evidenceDetailed||[]};
  return have>=needed?{status:'pass',reason:'필수 학력 충족',required:values,evidence:req.education?.evidenceDetailed||[]}:{status:'fail',reason:`필수 학력 미충족 (${values.join(', ')})`,required:values,evidence:req.education?.evidenceDetailed||[],mutable:false};
}
function licenseDecision(req={},profile={}){
  const rows=requiredRows(req.licenses||[]); if(!rows.length) return {status:'pass',reason:'명시된 필수 자격/면허 없음',required:[],evidence:[]};
  if(!profile.licensesKnown) return {status:'review',reason:'보유 자격/면허 정보 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  const owned=(profile.licenses||[]).map(norm);
  const missing=rows.filter(row=>!owned.some(x=>x&&(norm(row.value).includes(x)||x.includes(norm(row.value)))));
  return missing.length?{status:'fail',reason:'필수 자격/면허 미충족',required:rows.map(x=>x.value),missing:missing.map(x=>x.value),evidence:missing.flatMap(evidenceOf),mutable:true,mutableType:'license'}:{status:'pass',reason:'필수 자격/면허 충족',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
}
function experienceDecision(req={},profile={}){
  const rows=requiredRows(req.experience||[]); if(!rows.length) return {status:'pass',reason:'명시된 필수 경력 없음',required:[],evidence:[]};
  if(!profile.experienceKnown) return {status:'review',reason:'경력 정보 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  const requiredYears=Math.max(...rows.map(x=>Number(String(x.value).match(/(\d+)\s*년\s*이상/)?.[1]||0)));
  if(!requiredYears) return {status:'review',reason:'필수 경력의 세부 조건 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  return Number(profile.experienceYears||0)>=requiredYears?{status:'pass',reason:'필수 경력 충족',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)}:{status:'fail',reason:`필수 경력 ${requiredYears}년 미충족`,required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf),mutable:true,mutableType:'experience-time'};
}
function genericKnownDecision(rows=[], known=false, label='', values=[]){
  const required=requiredRows(rows); if(!required.length) return {status:'pass',reason:`명시된 필수 ${label} 없음`,required:[],evidence:[]};
  if(!known) return {status:'review',reason:`사용자 ${label} 정보 확인 필요`,required:required.map(x=>x.value),evidence:required.flatMap(evidenceOf)};
  const owned=values.map(norm), missing=required.filter(r=>!owned.some(v=>v&&(norm(r.value).includes(v)||v.includes(norm(r.value)))));
  return missing.length?{status:'fail',reason:`필수 ${label} 미충족`,required:required.map(x=>x.value),missing:missing.map(x=>x.value),evidence:missing.flatMap(evidenceOf),mutable:false}:{status:'pass',reason:`필수 ${label} 충족`,required:required.map(x=>x.value),evidence:required.flatMap(evidenceOf)};
}
function ageDecision(req={},profile={}){
  const rows=requiredRows(req.age||[]); if(!rows.length) return {status:'pass',reason:'명시된 필수 연령 제한 없음',required:[],evidence:[]};
  if(!profile.ageKnown) return {status:'review',reason:'사용자 연령 정보 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  const text=rows.map(x=>x.value).join(' '), age=Number(profile.age);
  const max=Number(text.match(/(?:만\s*)?(\d{1,2})\s*세\s*(?:이하|미만)/)?.[1]||0), min=Number(text.match(/(?:만\s*)?(\d{1,2})\s*세\s*(?:이상|초과)/)?.[1]||0);
  if(max&&age>max) return {status:'fail',reason:`연령 상한 ${max}세 미충족`,required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf),mutable:false};
  if(min&&age<min) return {status:'fail',reason:`연령 하한 ${min}세 미충족`,required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf),mutable:false};
  if(max||min) return {status:'pass',reason:'필수 연령 조건 충족',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
  return {status:'review',reason:'연령 조건 세부 확인 필요',required:rows.map(x=>x.value),evidence:rows.flatMap(evidenceOf)};
}

function meaningfulOption(option={}){
  const raw=String(option.raw||'').trim();
  if(/^\(?\s*(?:학력|전공|경력|자격증?)(?:\s*[,·/]\s*(?:학력|전공|경력|자격증?))*\s*[,)]?\s*$/i.test(raw)) return false;
  if((option.education||[]).length||(option.experience||[]).length||(option.licenses||[]).length) return true;
  return /(?:\d+\s*년\s*이상|학사\s*학위|전문학사|고졸|[가-힣A-Za-z0-9·]+(?:기사|기능사|산업기사|면허|자격증))/.test(raw);
}
function rawEducationRank(option={}){
  const raw=String(option.raw||'');
  if(/학위가\s*없는|고졸/.test(raw)) return 1;
  if(/전문학사|전문대/.test(raw)) return 2;
  if(/(?:^|\s)학사|대졸|4년제/.test(raw)) return 3;
  if(/석사/.test(raw)) return 4;
  if(/박사/.test(raw)) return 5;
  const ranks=(option.education||[]).map(educationRank).filter(Boolean);
  return ranks.length?Math.min(...ranks):0;
}
function optionLicenseTerms(option={}){
  const text=[...(option.licenses||[]),option.raw||''].join(' ');
  const out=[];
  for(const m of text.matchAll(/([가-힣A-Za-z0-9·]+(?:기사|기능사|산업기사|면허|자격증))/g)) out.push(m[1]);
  return uniq(out.length?out:(option.licenses||[]));
}
function evaluateAlternativeGroup(group={},profile={}){
  const options=(group.options||[]).filter(meaningfulOption);
  if(!options.length) return {status:'review',reason:'선택형 필수요건의 유효한 지원경로를 해석하지 못함',options:[],evidence:group.evidenceDetailed||[]};
  const optionResults=options.map(option=>{
    let state='pass'; const reasons=[];
    const need=rawEducationRank(option);
    if(need){ if(!profile.educationKnown){state='review';reasons.push('학력정보 확인 필요');} else if((educationRank(profile.education)||0)<need){state='fail';reasons.push('학력경로 미충족');} }
    const exp=Number([...(option.experience||[]),option.raw||''].join(' ').match(/(\d+)\s*년\s*이상/)?.[1]||0);
    if(exp){ if(!profile.experienceKnown){if(state!=='fail')state='review';reasons.push('경력정보 확인 필요');} else if(Number(profile.experienceYears||0)<exp){state='fail';reasons.push(`경력 ${exp}년 미충족`);} }
    const licenses=optionLicenseTerms(option);
    if(licenses.length){ if(!profile.licensesKnown){if(state!=='fail')state='review';reasons.push('자격정보 확인 필요');} else if(!licenses.some(req=>(profile.licenses||[]).some(l=>norm(req).includes(norm(l))||norm(l).includes(norm(req))))){state='fail';reasons.push('자격경로 미충족');} }
    return {status:state,reasons,raw:option.raw,evidence:option.evidenceDetailed||[],parsed:{educationRank:need,experienceYears:exp,licenses}};
  });
  if(optionResults.some(x=>x.status==='pass')) return {status:'pass',reason:'선택형 필수요건 중 1개 경로 충족',options:optionResults,evidence:group.evidenceDetailed||[]};
  if(optionResults.some(x=>x.status==='review')) return {status:'review',reason:'선택형 필수요건 충족 여부 확인 필요',options:optionResults,evidence:group.evidenceDetailed||[]};
  const licenseOnly=optionResults.every(x=>x.reasons.length&&x.reasons.every(r=>/자격경로/.test(r)));
  return {status:'fail',reason:'선택형 필수요건 경로 모두 미충족',options:optionResults,evidence:group.evidenceDetailed||[],mutable:licenseOnly,mutableType:licenseOnly?'license':undefined};
}

function preferredMatch(req={},profile={}){
  const rows=[...(req.licenses||[]),...(req.experience||[]),...(req.major||[]),...(req.jobRelated||[]),...(req.other||[])].filter(x=>x?.level==='preferred');
  const matched=[],unresolved=[];
  for(const row of rows){ const t=String(row.value||''); if(/자격|면허|기사|기능사|컴퓨터활용|한국사|토익|TOEIC/i.test(t)){ if(!profile.licensesKnown) unresolved.push(t); else if((profile.licenses||[]).some(l=>norm(t).includes(norm(l)))) matched.push(t); } else unresolved.push(t); }
  return {total:rows.length,matched:uniq(matched).length,matchedItems:uniq(matched),unresolvedItems:uniq(unresolved),policy:'preferred conditions never exclude; matches are recommendation signals only'};
}

function missingRequirementRisk({requirements={},unit={},posting={}}={}){
  const nameText=`${unit.name||''}\n${posting.title||''}`;
  const text=nameText; // risk guards intentionally avoid shared document text to prevent cross-vacancy contamination
  const summary=unit.requirementSummary||{};
  if(Number(summary.required||0)>0 || (requirements.qualificationAlternatives||[]).length) return [];
  const risks=[];
  const add=(dimension,pattern,label)=>{ if(pattern.test(text)) risks.push({dimension,reason:`${label} 신호가 있으나 Stage 8에서 필수조건이 확인되지 않음`,evidence:[String(unit.name||posting.title||'')]}); };
  add('experience',/경력직|경력\s*\d+\s*년/i,'경력 필수 가능성');
  add('licenses',/\b의사\b|간호사|수의사|약사|(?:산업)?기사|기능사|면허/i,'자격·면허 필수 가능성');
  add('legalOrIdentity',/지역인재|장애(?:인)?|보훈|취업지원대상/i,'법정·신분요건 필수 가능성');
  return uniq(risks.map(x=>JSON.stringify(x))).map(x=>JSON.parse(x));
}

export function evaluateStage9Eligibility(requirements={},profile={},context={}){
  const alternatives=(requirements.qualificationAlternatives||[]).map(g=>evaluateAlternativeGroup(g,profile));
  const dimensions={
    education: educationDecision(requirements,profile), licenses: licenseDecision(requirements,profile), experience: experienceDecision(requirements,profile), age: ageDecision(requirements,profile),
    major: genericKnownDecision(requirements.major||[],profile.majorKnown,'전공',profile.majors||[]), legalOrIdentity: genericKnownDecision(requirements.legalOrIdentity||[],profile.legalOrIdentityKnown,'법정·신분요건',profile.legalOrIdentity||[]), other: genericKnownDecision(requirements.other||[],profile.otherKnown,'기타 필수요건',profile.other||[])
  };
  if(alternatives.length){
    const route=alternatives.some(x=>x.status==='pass')?'pass':alternatives.some(x=>x.status==='review')?'review':'fail';
    dimensions.qualificationAlternative={status:route,reason:route==='pass'?'선택형 지원경로 충족':route==='review'?'선택형 지원경로 확인 필요':'선택형 지원경로 미충족',groups:alternatives,mutable:route==='fail'&&alternatives.every(x=>x.mutable),mutableType:'license'};
    dimensions.education={...dimensions.education,status:'pass',reason:'선택형 지원경로에서 통합 판정'}; dimensions.experience={...dimensions.experience,status:'pass',reason:'선택형 지원경로에서 통합 판정'}; dimensions.licenses={...dimensions.licenses,status:'pass',reason:'선택형 지원경로에서 통합 판정'};
  }
  const risks=missingRequirementRisk({requirements,unit:context.unit||{},posting:context.posting||{}});
  for(const risk of risks){ const cur=dimensions[risk.dimension]; if(cur?.status==='pass' && !(cur.required||[]).length) dimensions[risk.dimension]={...cur,status:'review',reason:risk.reason,evidence:risk.evidence,riskGuard:true}; }
  const all=Object.values(dimensions), failed=all.filter(x=>x.status==='fail'), reviews=all.filter(x=>x.status==='review');
  const status=failed.length?ELIGIBILITY_STATUS.INELIGIBLE:reviews.length?ELIGIBILITY_STATUS.REVIEW:ELIGIBILITY_STATUS.ELIGIBLE;
  const mutableFailures=failed.filter(x=>x.mutable).map(x=>({type:x.mutableType||'other',reason:x.reason,missing:x.missing||[],required:x.required||[]})), immutableFailures=failed.filter(x=>!x.mutable);
  return {status,dimensions,decisionReasons:uniq([...failed.map(x=>x.reason),...reviews.map(x=>x.reason)]),preferredMatch:preferredMatch(requirements,profile),specUp:{possible:status===ELIGIBILITY_STATUS.INELIGIBLE&&mutableFailures.length>0&&immutableFailures.length===0&&reviews.length===0,unlockConditions:mutableFailures,blockedBy:immutableFailures.map(x=>x.reason),policy:'license acquisition and experience accumulation are preserved as mutable; product may expose license unlocks first'},evidencePolicy:'every fail/review retains Stage-8-linked evidence when available'};
}

function normalizeEmployment(values=[], text=''){
  const source=[...values,text].join(' '), out=[];
  const rules=[['무기계약직',/무기계약직/i],['공무직',/공무직/i],['정규직',/정규직|정규\s*직원/i],['기간제',/기간제/i],['계약직',/계약직|위촉직/i],['인턴',/체험형\s*(?:청년)?인턴|채용형\s*인턴|청년인턴|\b인턴\b/i]];
  for(const [v,p] of rules) if(p.test(source)) out.push(v);
  return uniq(out.length?out:values);
}
function normalizeRegionValues(values=[]){
  const out=[];
  for(const value of values){
    const text=String(value||'');
    if(/울산(?:광역시)?/.test(text)) out.push('울산');
    if(/서울(?:특별시)?/.test(text)) out.push('서울');
    if(/부산(?:광역시)?/.test(text)) out.push('부산');
    if(/대구(?:광역시)?/.test(text)) out.push('대구');
    if(/인천(?:광역시)?/.test(text)) out.push('인천');
    if(/광주(?:광역시)?/.test(text)) out.push('광주');
    if(/대전(?:광역시)?/.test(text)) out.push('대전');
    if(/세종(?:특별자치시)?/.test(text)) out.push('세종');
  }
  return uniq(out);
}
function explicitWorkRegionsFromText(text=''){
  const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const candidates=lines.filter(line=>/(?:근무지|근무지역|근무장소|근무예정지|배치예정지)\s*[:：]?/i.test(line));
  return normalizeRegionValues(candidates);
}
function resolveRegionFacet({locationRaw=[],evidenceText='',org='',organizationRegionPolicy={}}={}){
  const structured=normalizeRegionValues(locationRaw);
  if(structured.length) return {values:structured,source:'posting-explicit',confidence:'high',evidence:'stage8-location'};
  const labeled=explicitWorkRegionsFromText(evidenceText);
  if(labeled.length) return {values:labeled,source:'posting-explicit',confidence:'high',evidence:'work-location-labeled-text'};
  const policy=organizationRegionPolicy?.organizations?.[org]||{};
  if(policy.allowFallback && policy.fallbackRegion) return {values:[policy.fallbackRegion],source:'organization-inferred',confidence:'medium',evidence:`organization-region-policy:${policy.scope||'local'}`};
  return {values:[],source:'unknown',confidence:'unknown',evidence:policy.scope?`fallback-blocked:${policy.scope}`:'no-region-evidence'};
}

export function buildStage9Unit({posting={},unit={},profile={},organizationRegionPolicy={}}={}){
  const req=unit.requirements||{};
  const evidenceText=`${unit.evidenceScope?.detail||''}\n${unit.evidenceScope?.document||''}`;
  const localText=[...(req.jobRelated||[]),...(req.major||[])].map(x=>x?.value||'').filter(Boolean).join('\n')+'\n'+evidenceText;
  const employmentRaw=uniq([...(unit.employmentTypes||[]),...(req.employment?.values||[])]), locationRaw=uniq([...(unit.workLocations||[]),...(req.location?.values||[])]);
  const jobCategory=classifyJobCategory({vacancyName:unit.name,title:posting.title,localText});
  const region=resolveRegionFacet({locationRaw,evidenceText,org:posting.org||'',organizationRegionPolicy});
  // Employment inference is intentionally limited to structured values and the vacancy/posting labels.
  // Full document text can mention unrelated contract types and contaminate a recruitment unit.
  const employmentText=`${posting.title||''}\n${unit.name||''}`;
  return {posting:{org:posting.org||'',title:posting.title||'',link:posting.link||''},unit:{id:unit.id||'',name:unit.name||'',source:unit.source||''},eligibility:evaluateStage9Eligibility(req,profile,{posting,unit}),searchFacets:{region:region.values,organization:[posting.org||''].filter(Boolean),jobCategory:[jobCategory.label],employmentType:normalizeEmployment(employmentRaw,employmentText)},searchFacetProvenance:{region:{source:region.source,confidence:region.confidence,evidence:region.evidence},employmentType:{source:employmentRaw.length?'stage8-structured':'posting-or-unit-label',confidence:employmentRaw.length?'high':'medium'}},jobCategory,rawVacancyName:unit.name||''};
}
