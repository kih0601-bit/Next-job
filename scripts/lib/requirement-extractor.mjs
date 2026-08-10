export const REQUIREMENT_SCHEMA_VERSION = '2.2.0-contextual-alternative-paths';
export const REQUIREMENT_LEVEL = Object.freeze({ REQUIRED:'required', PREFERRED:'preferred', UNKNOWN:'unknown' });
const {REQUIRED,PREFERRED,UNKNOWN}=REQUIREMENT_LEVEL;
const normalize=(text='')=>String(text).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const unique=(items=[])=>[...new Set(items.filter(Boolean))];

function contextLines(text=''){ return String(text).split(/\r?\n|[。]/).map(normalize).filter(Boolean); }
function levelFromLine(line=''){
  if(/우대|가점|우선|우대사항|가산점/.test(line)) return PREFERRED;
  if(/필수|지원자격|응시자격|자격요건|소지자에\s*한함|소지해야|보유해야|이상\s*보유|이상\s*소지|지원\s*가능\s*자/.test(line)) return REQUIRED;
  return UNKNOWN;
}
function detailed(source,text){return {source,text:String(text).slice(0,320)};}
function mergeDetailed(rows=[]){
  const seen=new Set(),out=[];
  for(const row of rows){const key=`${row.source}|${row.text}`;if(!row?.text||seen.has(key))continue;seen.add(key);out.push(row);}
  return out;
}
function aggregateScalar(perSource=[]){
  const values=unique(perSource.flatMap(x=>x.values||[]));
  const detailedEvidence=mergeDetailed(perSource.flatMap(x=>x.evidenceDetailed||[])).slice(0,12);
  const levels=perSource.filter(x=>(x.values||[]).length).map(x=>x.level);
  const level=levels.includes(REQUIRED)?REQUIRED:levels.includes(PREFERRED)?PREFERRED:UNKNOWN;
  const explicitNoRestriction=perSource.some(x=>x.resolution==='explicit-no-restriction');
  return {values,level,resolution:explicitNoRestriction?'explicit-no-restriction':values.length?'observed':'not-specified',evidence:detailedEvidence.map(x=>x.text),evidenceDetailed:detailedEvidence};
}
function aggregateRows(perSource=[]){
  const seen=new Set(),rows=[];
  for(const group of perSource){
    for(const row of group||[]){
      const key=`${row.source}|${row.level}|${row.value}`;
      if(!row.value||seen.has(key))continue;seen.add(key);rows.push(row);
    }
  }
  return rows.slice(0,30);
}

function extractEducation(text='',source='unknown'){
  const values=[],evidence=[];
  let noRestriction=false;
  for(const line of contextLines(text)){
    if(/학력\s*무관|학력(?:제한|제한사항)?\s*없|학력제한\s*없/.test(line)){values.push('학력무관');evidence.push(detailed(source,line));noRestriction=true;}
    if(/고졸|고등학교\s*졸업/.test(line)){values.push('고졸 이상');evidence.push(detailed(source,line));}
    if(/전문학사|전문대\s*졸업/.test(line)){values.push('전문대 이상');evidence.push(detailed(source,line));}
    if(/학사\s*(?:학위)?\s*(?:이상|소지|졸업)|대졸\s*이상|대학교\s*졸업\s*이상|4년제\s*(?:대학|대학교)\s*졸업/.test(line)){values.push('대졸 이상');evidence.push(detailed(source,line));}
  }
  const level=values.length && !noRestriction ? (evidence.some(e=>levelFromLine(e.text)===PREFERRED)?PREFERRED:REQUIRED) : UNKNOWN;
  return {values:unique(values),level,resolution:noRestriction?'explicit-no-restriction':values.length?'observed':'not-specified',evidenceDetailed:mergeDetailed(evidence)};
}
function extractRows(text='',source='unknown',pattern,limit=12,levelOverride=null){
  const rows=[];
  for(const line of contextLines(text)){
    if(!pattern.test(line)){pattern.lastIndex=0;continue;}
    pattern.lastIndex=0;
    // A flattened recruitment-overview table can contain words such as '기사' or an age
    // anywhere in a very long row. Do not promote that whole row to a personal
    // eligibility requirement unless it is in an explicit qualification context.
    if(line.length>220 && !/(지원자격|응시자격|자격요건|필요자격|우대사항|필수자격|응시요건)/.test(line)) continue;
    let level=levelOverride?levelOverride(line):levelFromLine(line);
    rows.push({value:line.slice(0,300),level,source,evidence:[line.slice(0,300)],evidenceDetailed:[detailed(source,line)]});
    if(rows.length>=limit)break;
  }
  return rows;
}
function extractExperience(text='',source='unknown'){
  return extractRows(text,source,/(경력\s*\d+\s*년|관련\s*분야\s*경력|실무\s*경력|신입\s*가능|경력\s*무관)/,10,line=>{
    if(/\d+\s*년\s*이상/.test(line)) return REQUIRED;
    if(/신입\s*가능|경력\s*무관/.test(line)) return UNKNOWN;
    return levelFromLine(line);
  });
}
function extractAge(text='',source='unknown'){
  return extractRows(text,source,/(?:만\s*)?\d{1,2}\s*세|연령\s*(?:제한|무관)|정년|청년\s*연령/,10,line=>{
    if(/지원자격|응시자격|자격요건|필요자격|채용공고일\s*기준/.test(line) && /(?:만\s*)?\d{1,2}\s*세/.test(line)) return REQUIRED;
    return levelFromLine(line);
  });
}
function extractLegalIdentity(text='',source='unknown'){
  return extractRows(text,source,/(보훈|장애인|취업지원대상|병역|대한민국\s*국적|국적|결격사유|해외여행\s*결격)/,12);
}
function simpleValues(text='',labels=[]){return unique(labels.filter(label=>String(text).includes(label)));}


function extractQualificationAlternatives(text='',source='unknown'){
  const ls=contextLines(text); const groups=[];
  for(let i=0;i<ls.length;i++){
    if(!/(?:아래|다음).{0,20}(?:자격|요건).{0,20}(?:한\s*가지|하나).{0,10}(?:해당|충족)|(?:각\s*호|다음\s*중).{0,15}(?:하나|어느\s*하나)/.test(ls[i])) continue;
    const options=[];
    for(let j=i+1;j<Math.min(ls.length,i+8);j++){
      const line=ls[j];
      if(/^(?:참고사이트|직업기초능력|전형방법|필요지식|필요기술|직무수행|태도)/.test(line)) break;
      if(!/(?:학사|전문학사|학위가\s*없는|고졸|경력|자격증|면허)/.test(line)) continue;
      const option={raw:line.slice(0,300),education:[],experience:[],licenses:[],source,evidenceDetailed:[detailed(source,line)]};
      if(/학위가\s*없는|고졸/.test(line)) option.education.push('고졸 가능');
      if(/전문학사|전문대/.test(line)) option.education.push('전문대 이상');
      if(/(?:공학계열|이.?공계열|관련\s*분야)?\s*학사|대졸/.test(line)) option.education.push('대졸 이상');
      const em=line.match(/(?:직무\s*관련\s*)?(\d+)\s*년\s*이상\s*경력/);
      if(em) option.experience.push(`${em[1]}년 이상 경력`);
      if(/자격증|면허|기사|산업기사|기능사/.test(line)) option.licenses.push(line.slice(0,300));
      options.push(option);
    }
    if(options.length>=2) groups.push({level:REQUIRED,source,intro:ls[i].slice(0,300),options,evidenceDetailed:[detailed(source,ls[i]),...options.flatMap(x=>x.evidenceDetailed)]});
  }
  // Some public-institution forms omit an explicit 'one of the following' intro and express
  // the second route as '학위가 없는 경우'. Preserve that semantic OR instead of flattening
  // the first education phrase into an unconditional requirement.
  if(groups.length===0) for(let i=0;i<ls.length-1;i++){
    const a=ls[i], b=ls[i+1];
    if(!/(전문학사|학사|대졸)/.test(a) || !/(학위가\s*없는\s*경우|학위\s*미소지)/.test(b)) continue;
    if(!/(경력|직무\s*관련)/.test(`${a} ${b}`)) continue;
    const make=(line)=>{ const option={raw:line.slice(0,300),education:[],experience:[],licenses:[],source,evidenceDetailed:[detailed(source,line)]};
      if(/학위가\s*없는|학위\s*미소지|고졸/.test(line)) option.education.push('고졸 가능');
      if(/전문학사|전문대/.test(line)) option.education.push('전문대 이상');
      if(/학사|대졸/.test(line) && !/전문학사/.test(line)) option.education.push('대졸 이상');
      const em=line.match(/(?:직무\s*관련\s*)?(\d+)\s*년\s*이상\s*경력/); if(em) option.experience.push(`${em[1]}년 이상 경력`); return option; };
    groups.push({level:REQUIRED,source,intro:'학위 보유 여부에 따른 대체 지원자격',options:[make(a),make(b)],evidenceDetailed:[detailed(source,a),detailed(source,b)]});
  }
  return groups;
}
function mergeAlternativeGroups(groups=[]){
  const out=[]; const seen=new Set();
  for(const group of groups.flat()){
    const key=(group.options||[]).map(x=>x.raw).join('|');
    if(!key||seen.has(key)) continue; seen.add(key); out.push(group);
  }
  return out.slice(0,8);
}

function perSourceExtract(source,text=''){
  return {
    education:extractEducation(text,source),
    licenses:extractRows(text,source,/(자격증|면허|기사|산업기사|기능사|운전면허|컴퓨터활용능력|한국사능력검정|토익|TOEIC|어학)/i,16),
    experience:extractExperience(text,source),
    age:extractAge(text,source),
    major:extractRows(text,source,/(전공|관련\s*학과|학과\s*졸업)/,10),
    jobRelated:extractRows(text,source,/(직무\s*관련|관련\s*분야|담당업무|직무내용|수행업무)/,12),
    legalOrIdentity:extractLegalIdentity(text,source),
    location:{
      values:simpleValues(text,['울산','서울','부산','대구','경남','경북']),
      level:/(근무지|근무지역|근무장소|근무예정지|배치예정지)/.test(text)?REQUIRED:UNKNOWN,
      resolution:/(근무지|근무지역|근무장소|근무예정지|배치예정지)/.test(text)?'observed':'not-specified',
      evidenceDetailed:contextLines(text).filter(x=>/(근무지|근무지역|근무장소|근무예정지|배치예정지|울산|서울|부산|대구|경남|경북)/.test(x)).slice(0,8).map(x=>detailed(source,x))
    },
    employment:{
      values:simpleValues(text,['정규직','무기계약직','공무직','일반직','상용직','기간제','계약직','인턴']),
      level:/(채용|고용|근로)\s*(형태|유형|구분)|정규직|무기계약직|공무직|기간제|계약직|인턴/.test(text)?REQUIRED:UNKNOWN,
      resolution:/(정규직|무기계약직|공무직|일반직|상용직|기간제|계약직|인턴)/.test(text)?'observed':'not-specified',
      evidenceDetailed:contextLines(text).filter(x=>/(정규직|무기계약직|공무직|일반직|상용직|기간제|계약직|인턴)/.test(x)).slice(0,8).map(x=>detailed(source,x))
    },
    other:extractRows(text,source,/(교대근무|야간근무|운전\s*가능|신체검사|채용\s*결격|거주지\s*제한)/,12),
    qualificationAlternatives:extractQualificationAlternatives(text,source)
  };
}

export function extractSupportRequirements({title='',listText='',detailText='',documentText=''}={}){
  const inputs=[
    ['title',title],
    ['list',listText],
    ['detail',detailText],
    ['document',documentText]
  ].filter(([,text])=>String(text||'').trim());
  const extracted=inputs.map(([source,text])=>({source,data:perSourceExtract(source,text)}));
  const scalar=key=>aggregateScalar(extracted.map(x=>x.data[key]));
  const rows=key=>aggregateRows(extracted.map(x=>x.data[key]));
  const result={
    schemaVersion:REQUIREMENT_SCHEMA_VERSION,
    sourcePriority:['document','detail','list','title'],
    evidenceSources:{title:Boolean(String(title).trim()),list:Boolean(String(listText).trim()),detail:Boolean(String(detailText).trim()),document:Boolean(String(documentText).trim())},
    education:scalar('education'),
    licenses:rows('licenses'),
    experience:rows('experience'),
    age:rows('age'),
    major:rows('major'),
    jobRelated:rows('jobRelated'),
    legalOrIdentity:rows('legalOrIdentity'),
    location:scalar('location'),
    employment:scalar('employment'),
    other:rows('other'),
    qualificationAlternatives:mergeAlternativeGroups(extracted.flatMap(x=>x.data.qualificationAlternatives||[]))
  };
  // Backward-compatible alias used by older reports/tests.
  result.identity=[...result.age,...result.legalOrIdentity];
  const requiredConditions=[]; const preferredConditions=[]; const unknownConditions=[];
  const pushRows=(label,value)=>{ const rows=Array.isArray(value)?value:(value?[value]:[]); for(const row of rows){ if(Array.isArray(row?.values)) for(const v of row.values){const t=`${label}: ${v}`;(row.level===REQUIRED?requiredConditions:row.level===PREFERRED?preferredConditions:unknownConditions).push(t);} else if(row?.value){const t=`${label}: ${row.value}`;(row.level===REQUIRED?requiredConditions:row.level===PREFERRED?preferredConditions:unknownConditions).push(t);} } };
  pushRows('학력',result.education); pushRows('자격/면허',result.licenses); pushRows('경력',result.experience); pushRows('연령',result.age); pushRows('전공',result.major); pushRows('직무',result.jobRelated); pushRows('지역',result.location); pushRows('고용형태',result.employment); pushRows('기타',result.other);
  if(result.qualificationAlternatives.length) requiredConditions.push(`선택형 필수요건: 아래 ${result.qualificationAlternatives[0].options.length}개 경로 중 1개 이상 충족`);
  result.presentation={listRequired:unique(requiredConditions),detailPreferred:unique(preferredConditions),detailUnknown:unique(unknownConditions),rule:'목록/추천에는 required 중심 노출; preferred는 상세에서 노출하며 추천순위 가점에만 사용'};
  return result;
}


export function evaluateSupportEligibility(requirements={},profile={}){
  const reasons=[],unresolved=[]; let hardFail=false;
  const educationValues=requirements.education?.values||[];
  const alternativeGroups=requirements.qualificationAlternatives||[];
  if(profile.educationKnown&&profile.education){
    if(!alternativeGroups.length && (educationValues.includes('대졸 이상')||educationValues.includes('전문대 이상'))&&profile.education==='고졸'){hardFail=true;reasons.push('학력 필수조건 미충족');}
    if(alternativeGroups.length && profile.education==='고졸') unresolved.push('선택형 필수요건의 경력/자격 경로 충족여부 확인 필요');
  } else if(educationValues.length) unresolved.push('학력 보유정보 확인 필요');

  const requiredLicenses=(requirements.licenses||[]).filter(item=>item.level===REQUIRED);
  if(requiredLicenses.length){
    if(profile.licensesKnown&&Array.isArray(profile.licenses)){
      for(const item of requiredLicenses){ if(!profile.licenses.some(license=>item.value.includes(license))){hardFail=true;reasons.push(`필수 자격 미충족 가능: ${item.value.slice(0,100)}`);} }
    } else unresolved.push(...requiredLicenses.map(item=>`필수 자격 보유여부 확인 필요: ${item.value.slice(0,100)}`));
  }
  if((requirements.experience||[]).some(item=>item.level===REQUIRED)&&!profile.experienceKnown) unresolved.push('필수 경력 보유여부 확인 필요');
  if((requirements.major||[]).some(item=>item.level===REQUIRED)&&!profile.majorKnown) unresolved.push('필수 전공/관련분야 요건 확인 필요');

  if(hardFail) return {status:'ineligible',reasons:unique(reasons),unresolved:unique(unresolved)};
  if(unresolved.length) return {status:'needs-review',reasons:unique(reasons),unresolved:unique(unresolved)};
  return {status:'eligible-or-no-hard-conflict',reasons:unique(reasons),unresolved:[]};
}
