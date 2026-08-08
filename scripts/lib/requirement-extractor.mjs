
export const REQUIREMENT_SCHEMA_VERSION = '1.0.0';
export const REQUIREMENT_LEVEL = Object.freeze({ REQUIRED:'required', PREFERRED:'preferred', UNKNOWN:'unknown' });
const {REQUIRED,PREFERRED,UNKNOWN}=REQUIREMENT_LEVEL;
const normalize=(text='')=>String(text).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const unique=(items=[])=>[...new Set(items.filter(Boolean))];

function contextLines(text=''){ return String(text).split(/\r?\n|[。]/).map(normalize).filter(Boolean); }
function levelFromLine(line=''){
  if(/우대|가점|우선|우대사항|가산점/.test(line)) return PREFERRED;
  if(/필수|지원자격|응시자격|자격요건|소지자에\s*한함|소지해야|보유해야|이상\s*보유|이상\s*소지/.test(line)) return REQUIRED;
  return UNKNOWN;
}
function collectEvidence(text='',pattern,limit=4){
  const out=[];
  for(const line of contextLines(text)){ pattern.lastIndex=0; if(pattern.test(line)){ out.push(line.slice(0,260)); if(out.length>=limit) break; } }
  return unique(out);
}
function extractEducation(text=''){
  const values=[],evidence=[];
  for(const line of contextLines(text)){
    if(/학력\s*무관|학력(?:제한|제한사항)?\s*없|학력제한\s*없/.test(line)){values.push('학력무관');evidence.push(line);}
    if(/고졸|고등학교\s*졸업/.test(line)){values.push('고졸 이상');evidence.push(line);}
    if(/전문학사|전문대\s*졸업/.test(line)){values.push('전문대 이상');evidence.push(line);}
    if(/학사\s*(?:학위)?\s*(?:이상|소지|졸업)|대졸\s*이상|대학교\s*졸업\s*이상|4년제\s*(?:대학|대학교)\s*졸업/.test(line)){values.push('대졸 이상');evidence.push(line);}
  }
  return {values:unique(values),level:values.length?REQUIRED:UNKNOWN,evidence:unique(evidence).slice(0,5)};
}
function extractQualificationItems(text=''){
  const rows=[];
  for(const line of contextLines(text)){
    if(!/(자격증|면허|기사|산업기사|기능사|운전면허|컴퓨터활용능력|한국사능력검정|토익|TOEIC|어학)/i.test(line)) continue;
    rows.push({value:line.slice(0,260),level:levelFromLine(line)});
    if(rows.length>=12) break;
  }
  return rows;
}
function extractExperience(text=''){
  const rows=[];
  for(const line of contextLines(text)){
    if(!/(경력\s*\d+\s*년|관련\s*분야\s*경력|실무\s*경력|신입\s*가능|경력\s*무관)/.test(line)) continue;
    let level=levelFromLine(line);
    if(/\d+\s*년\s*이상/.test(line)) level=REQUIRED;
    if(/신입\s*가능|경력\s*무관/.test(line)) level=UNKNOWN;
    rows.push({value:line.slice(0,260),level});
    if(rows.length>=8) break;
  }
  return rows;
}
function extractMajor(text=''){
  const rows=[]; for(const line of contextLines(text)){ if(!/(전공|관련\s*학과|학과\s*졸업|직무\s*관련\s*분야)/.test(line)) continue; rows.push({value:line.slice(0,260),level:levelFromLine(line)}); if(rows.length>=8) break; } return rows;
}
function extractIdentity(text=''){
  const rows=[]; for(const line of contextLines(text)){ if(!/(연령|청년|보훈|장애인|취업지원대상|병역|대한민국\s*국적|결격사유)/.test(line)) continue; rows.push({value:line.slice(0,260),level:levelFromLine(line)}); if(rows.length>=8) break; } return rows;
}
function extractOther(text=''){
  const rows=[]; for(const line of contextLines(text)){ if(!/(교대근무|야간근무|운전\s*가능|해외여행\s*결격|신체검사|채용\s*결격)/.test(line)) continue; rows.push({value:line.slice(0,260),level:levelFromLine(line)}); if(rows.length>=8) break; } return rows;
}
function simpleValues(text='',labels=[]){ return unique(labels.filter(label=>String(text).includes(label))); }

export function extractSupportRequirements({title='',listText='',detailText='',documentText=''}={}){
  const combined=[title,listText,detailText,documentText].filter(Boolean).join('\n');
  return {
    schemaVersion:REQUIREMENT_SCHEMA_VERSION,
    sourcePriority:documentText?'document>detail>list>title':detailText?'detail>list>title':'list>title',
    evidenceSources:{title:Boolean(String(title).trim()),list:Boolean(String(listText).trim()),detail:Boolean(String(detailText).trim()),document:Boolean(String(documentText).trim())},
    education:extractEducation(combined),
    licenses:extractQualificationItems(combined),
    experience:extractExperience(combined),
    major:extractMajor(combined),
    identity:extractIdentity(combined),
    location:{values:simpleValues(combined,['울산','서울','부산','대구','경남','경북']),level:/(근무지|근무지역|근무장소|근무예정지|배치예정지)/.test(combined)?REQUIRED:UNKNOWN,evidence:collectEvidence(combined,/(근무지|근무지역|근무장소|근무예정지|배치예정지|울산|서울|부산|대구|경남|경북)/,5)},
    employment:{values:simpleValues(combined,['정규직','무기계약직','공무직','일반직','상용직','기간제','계약직','인턴']),level:/(채용|고용|근로)\s*(형태|유형|구분)|정규직|무기계약직|공무직|기간제|계약직|인턴/.test(combined)?REQUIRED:UNKNOWN,evidence:collectEvidence(combined,/(정규직|무기계약직|공무직|일반직|상용직|기간제|계약직|인턴)/,5)},
    other:extractOther(combined)
  };
}

export function evaluateSupportEligibility(requirements={},profile={}){
  const reasons=[],unresolved=[]; let hardFail=false;
  const educationValues=requirements.education?.values||[];
  if(profile.educationKnown&&profile.education){
    if((educationValues.includes('대졸 이상')||educationValues.includes('전문대 이상'))&&profile.education==='고졸'){hardFail=true;reasons.push('학력 필수조건 미충족');}
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
