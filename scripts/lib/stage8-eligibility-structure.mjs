import { extractSupportRequirements, REQUIREMENT_SCHEMA_VERSION } from './requirement-extractor.mjs';

export const STAGE8_SCHEMA_VERSION = '2.0.0';
export const STAGE8_VERSION = '8.1.0-recruitment-unit-objective-structure';

const compact = (value='', max=500) => String(value || '').replace(/\s+/g,' ').trim().slice(0,max);
const lines = (text='') => String(text || '').replace(/\r/g,'\n').split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
const unique = (items=[]) => [...new Set(items.filter(Boolean))];

function sourceState({available=false, attempted=false, readable=false, error='', count=null}={}) {
  if (!available && !attempted) return { status:'not-available', available:false, attempted:false, readable:false, error:'', count };
  if (available && readable) return { status:'analyzed', available:true, attempted:Boolean(attempted), readable:true, error:'', count };
  if (attempted && !readable) return { status:'analysis-failed', available:Boolean(available), attempted:true, readable:false, error:compact(error,260), count };
  return { status:'available-unread', available:Boolean(available), attempted:Boolean(attempted), readable:false, error:compact(error,260), count };
}

function headcountFromText(text='') {
  const candidates=[];
  const patterns=[
    /(?:채용|모집)\s*인원\s*[:：]?\s*(\d{1,4})\s*명/g,
    /(?:인원|채용예정인원)\s*[:：]?\s*(\d{1,4})\s*명/g,
    /(?:^|[|,\s])(\d{1,3})\s*명(?:\s|$|[|,])/g
  ];
  for(const pattern of patterns){
    for(const match of String(text).matchAll(pattern)){
      const value=Number(match[1]);
      if(Number.isFinite(value) && value>=0) candidates.push({value,evidence:compact(match[0],180)});
      if(candidates.length>=5) break;
    }
    if(candidates.length) break;
  }
  return candidates.length
    ? { value:candidates[0].value, status:'derived', evidence:candidates.map(x=>x.evidence) }
    : { value:null, status:'unknown', evidence:[] };
}

function scopedSourceText(unitName='', text='', fallback='') {
  const srcLines=lines(text);
  if(!srcLines.length) return '';
  const name=compact(unitName,80);
  if(!name || /^통합 모집분야$/.test(name)) return String(fallback || text);
  const tokens=name.split(/\s+/).filter(x=>x.length>=2).slice(0,4);
  const hitIndexes=[];
  srcLines.forEach((line,index)=>{
    if(line.includes(name) || (tokens.length && tokens.some(token=>line.includes(token)))) hitIndexes.push(index);
  });
  if(!hitIndexes.length) return '';
  const selected=[];
  for(const index of hitIndexes.slice(0,4)){
    for(let i=Math.max(0,index-2); i<=Math.min(srcLines.length-1,index+5); i++) selected.push(srcLines[i]);
  }
  return unique(selected).join('\n');
}

function commonContext(detailText='', documentText='') {
  const output=[];
  const scan=(text,source)=>{
    const src=lines(text);
    for(let i=0;i<src.length;i++){
      if(/공통\s*(?:응시|지원)?\s*자격|공통사항|지원자격|응시자격|결격사유|병역|국적|연령/.test(src[i])){
        for(let j=i;j<=Math.min(src.length-1,i+9);j++) output.push({source,text:src[j]});
      }
    }
  };
  scan(detailText,'detail');
  scan(documentText,'document');
  return output;
}

function summarizeRequirements(requirements={}) {
  const categories=['education','licenses','experience','age','major','jobRelated','location','employment','legalOrIdentity','other'];
  const stats={required:0,preferred:0,unknown:0,explicitNoRestriction:0,evidenceCount:0};
  for(const key of categories){
    const value=requirements[key];
    const rows=Array.isArray(value) ? value : value ? [value] : [];
    for(const row of rows){
      if(Array.isArray(row?.items)){
        for(const item of row.items){
          stats[item.level] = Number(stats[item.level]||0)+1;
          stats.evidenceCount += (item.evidenceDetailed||[]).length;
        }
      } else if(Array.isArray(row?.values) && row.values.length) {
        stats[row.level] = Number(stats[row.level]||0)+row.values.length;
        stats.evidenceCount += (row.evidenceDetailed||[]).length;
        if(row.resolution==='explicit-no-restriction') stats.explicitNoRestriction += 1;
      } else if(row?.value) {
        stats[row.level] = Number(stats[row.level]||0)+1;
        stats.evidenceCount += (row.evidenceDetailed||[]).length;
      }
    }
  }
  return stats;
}

export function buildStage8Posting({
  org='',
  title='',
  link='',
  listText='',
  detailText='',
  detailOk=false,
  detailError='',
  attachments=[],
  documents={},
  vacancies=[]
}={}) {
  const documentText=String(documents?.text || '');
  const documentResults=Array.isArray(documents?.results) ? documents.results : [];
  const discovered=Number(documents?.discovered ?? attachments?.length ?? 0);
  const attempted=Number(documents?.attempted || 0);
  const successful=Number(documents?.successful || 0);

  const commonRows=commonContext(detailText,documentText);
  const commonDetail=commonRows.filter(x=>x.source==='detail').map(x=>x.text).join('\n');
  const commonDocument=commonRows.filter(x=>x.source==='document').map(x=>x.text).join('\n');
  const commonRequirements=extractSupportRequirements({
    title,
    listText,
    detailText:commonDetail,
    documentText:commonDocument
  });

  const unitInputs=(vacancies?.length ? vacancies : [{id:'vacancy-1',name:title||'통합 모집분야',localText:`${detailText}\n${documentText}`,source:'single',confidence:0.4}]);
  const recruitmentUnits=unitInputs.map((vacancy,index)=>{
    const unitName=vacancy.name || `모집분야 ${index+1}`;
    const scopedDetail=scopedSourceText(unitName,detailText,vacancy.source==='single'?detailText:'');
    const scopedDocument=scopedSourceText(unitName,documentText,vacancy.source==='single'?documentText:'');
    const fallbackLocal=String(vacancy.localText || '');
    const requirements=extractSupportRequirements({
      title: unitInputs.length===1 ? title : `${title} ${unitName}`,
      listText: unitInputs.length===1 ? listText : '',
      detailText:scopedDetail || (!scopedDocument ? fallbackLocal : ''),
      documentText:scopedDocument
    });
    const headcount=headcountFromText(fallbackLocal || `${scopedDetail}\n${scopedDocument}`);
    return {
      id:vacancy.id || `vacancy-${index+1}`,
      name:unitName,
      source:vacancy.source || 'unknown',
      splitConfidence:Number(vacancy.confidence || 0),
      headcount,
      workLocations:requirements.location?.values || [],
      employmentTypes:requirements.employment?.values || [],
      requirements,
      requirementSummary:summarizeRequirements(requirements),
      evidenceScope:{
        detail:compact(scopedDetail,1200),
        document:compact(scopedDocument,1200),
        fallbackLocalUsed:Boolean(!scopedDetail && !scopedDocument && fallbackLocal)
      }
    };
  });

  const titleAvailable=Boolean(String(title).trim());
  const listAvailable=Boolean(String(listText).trim());
  const detailAvailable=Boolean(String(detailText).trim());
  const attachmentAvailable=discovered>0;
  const documentsReadable=successful>0 || discovered===0;
  const documentStatus=discovered===0
    ? {status:'not-required',available:false,attempted:false,readable:true,error:'',count:0}
    : successful===discovered
      ? {status:'analyzed',available:true,attempted:attempted>0,readable:true,error:'',count:successful}
      : successful>0
        ? {status:'partial',available:true,attempted:attempted>0,readable:true,error:'some attachments were not parsed',count:successful}
        : sourceState({available:true,attempted:attempted>0,readable:false,error:(documentResults.find(x=>x.error)?.error || 'attachment text unavailable'),count:0});

  const sourceCoverage={
    title:sourceState({available:titleAvailable,attempted:true,readable:titleAvailable}),
    list:sourceState({available:listAvailable,attempted:true,readable:listAvailable}),
    detail:sourceState({available:detailAvailable||detailOk,attempted:true,readable:Boolean(detailOk&&detailAvailable),error:detailError}),
    document:documentStatus
  };

  const fatal=[];
  const watch=[];
  if(!titleAvailable) fatal.push('title-missing');
  if(!detailOk) watch.push('detail-not-verified');
  if(documentStatus.status==='analysis-failed') watch.push('attachment-analysis-failed');
  if(documentStatus.status==='partial') watch.push('attachment-analysis-partial');
  if(!recruitmentUnits.length) fatal.push('recruitment-unit-not-derived');

  const analysisStatus=fatal.length ? 'failed' : watch.length ? 'partial' : 'complete';
  const derived=analysisStatus!=='failed' && recruitmentUnits.length>0;
  return {
    stage:8,
    schemaVersion:STAGE8_SCHEMA_VERSION,
    extractorSchemaVersion:REQUIREMENT_SCHEMA_VERSION,
    version:STAGE8_VERSION,
    posting:{org,title,link},
    sourceCoverage,
    commonRequirements,
    commonRequirementSummary:summarizeRequirements(commonRequirements),
    recruitmentUnits,
    analysisStatus,
    completion:{
      derived,
      fatal,
      watch,
      definition:'posting split into recruitment units; common/unit requirements structured with source-linked evidence and source-analysis state'
    }
  };
}

export function buildStage8Report(postings=[], generatedAt=new Date().toISOString()) {
  const uniqueMap=new Map();
  for(const posting of postings || []){
    if(!posting?.posting) continue;
    const key=`${posting.posting.org}|${posting.posting.link}|${posting.posting.title}`;
    const previous=uniqueMap.get(key);
    if(!previous || (previous.analysisStatus!=='complete' && posting.analysisStatus==='complete')) uniqueMap.set(key,posting);
  }
  const items=[...uniqueMap.values()];
  const unitCount=items.reduce((n,p)=>n+(p.recruitmentUnits?.length||0),0);
  const complete=items.filter(p=>p.analysisStatus==='complete').length;
  const partial=items.filter(p=>p.analysisStatus==='partial').length;
  const failed=items.filter(p=>p.analysisStatus==='failed').length;
  const stage8Gate={
    decision:'keep-stage-8-open',
    preQualityEligible:items.length>0 && failed===0 && partial===0,
    postingCount:items.length,
    recruitmentUnitCount:unitCount,
    completePostings:complete,
    partialPostings:partial,
    failedPostings:failed,
    completionRate:items.length ? complete/items.length : 0,
    blockers:items.filter(p=>p.analysisStatus==='failed').map(p=>({org:p.posting.org,title:p.posting.title,reasons:p.completion.fatal})),
    watch:items.filter(p=>p.analysisStatus==='partial').map(p=>({org:p.posting.org,title:p.posting.title,reasons:p.completion.watch})),
    rule:'source-completeness gate only; final Stage 8 closure additionally requires structural QA and original-source benchmark accuracy validation'
  };
  return {
    stage:8,
    schemaVersion:STAGE8_SCHEMA_VERSION,
    version:STAGE8_VERSION,
    generatedAt,
    purpose:'객관적 공고 구조화. 사용자 개인 지원가능 여부 판정과 분리.',
    downstreamPolicy:{listExposure:'required-only',detailExposure:'required-and-preferred',recommendation:'required conditions determine eligibility; matched preferred conditions may raise ranking but never exclude by themselves',note:'Stage 9/10 consumer contract. 우대조건 미충족만으로 지원 가능한 공고를 제외하지 않음.'},
    sourcePriority:['title/list metadata','detail page','attachments (PDF/HWP/HWPX etc.)'],
    requirementLevels:['required','preferred','unknown'],
    summary:{postingCount:items.length,recruitmentUnitCount:unitCount,complete,partial,failed},
    stage8Gate,
    postings:items
  };
}
