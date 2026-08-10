export const STAGE8_QUALITY_AUDIT_VERSION = '1.3.0-current-year-non-vacancy-unit-guard';

const compact=(v='',max=500)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const multiRecruitSignal=/(?:모집|채용)\s*분야|채용직렬|채용직종|모집직무|직렬\s*[|:：]|분야\s*[|:：]|(?:신입|경력)직\s*\d*급|지역인재|장애[^\n]{0,30}(?:일반|경력|신입)/i;
const requirementSignal=/지원자격|응시자격|자격요건|필수자격|우대사항|우대조건|경력\s*\d|학력|전공|자격증|면허|결격사유/i;
const nonVacancyUnitSignal=/(?:\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:\s|$|\[|\()|정보통신접근성\s*품질인증|(?:알림마당|채용공고)\s*>|테이블\s*(?:입니다|이다)|구성된\s*테이블|현재\s*진행\s*중.*무관함|붙임과\s*같이\s*공고|첨부파일|응시원서|이의신청서|직무기술서(?:\s*\d+|\s*\d*번)?\s*$)/i;
function unitEvidenceText(unit={}){ return `${unit?.evidenceScope?.detail||''}\n${unit?.evidenceScope?.document||''}`; }
function samplePosting(posting, extra={}){ return {org:posting?.posting?.org||'',title:posting?.posting?.title||'',link:posting?.posting?.link||'',...extra}; }
function yearHints(text='') { return [...String(text).matchAll(/(?:19\d{2}|20[0-2]\d)/g)].map(x=>Number(x[0])); }
function historicalByExplicitYear(posting={}){ const current=new Date().getUTCFullYear(); const years=[...(posting?.sourceHints?.years||[]),...yearHints(`${posting?.posting?.title||''} ${posting?.posting?.link||''}`)]; return years.length>0 && Math.max(...years)<current; }
function nonTargetOrClosed(posting={}, evidence=''){
  const text=`${posting?.posting?.title||''} ${evidence}`;
  if(/인턴|기간제|계약직|비정규직|일용직/.test(text)) return 'outside-current-target-employment';
  if(posting?.sourceHints?.closed || /(?:접수|기간).{0,40}종료|\b종료\b/.test(text)) return 'closed-posting';
  if(/첨부파일.{0,120}모집분야별/.test(text) && !/(?:모집|채용)\s*분야\s*[:：].{3,}|응시분야\s+\S+/.test(text)) return 'attachment-name-only-signal';
  const applicationFields=[...text.matchAll(/응시분야\s+([^\s|,]{2,40})/g)].map(x=>x[1]);
  if(applicationFields.length===1) return 'single-explicit-application-field';
  return '';
}
function preliminaryNotice(posting={}, evidence=''){ return /예비공고|사전\s*(?:안내|공지)|연간\s*채용\s*계획/.test(`${posting?.posting?.title||''} ${evidence}`); }

export function auditStage8Quality(report={}, {inputDiagnostics={}}={}) {
  const postings=Array.isArray(report?.postings)?report.postings:[];
  const units=postings.flatMap(p=>(p.recruitmentUnits||[]).map(u=>({posting:p,unit:u})));
  const lowConfidenceSingles=[],singleDespiteMultiSignal=[],actionableMultiSplit=[],nonBlockingMultiSplit=[],requirementSignalWithoutEvidence=[],unreadRequiredSources=[],actionableUnreadSources=[],historicalUnreadSources=[],informationalUnreadSources=[],noEvidenceUnits=[],nonVacancyUnits=[],actionableNonVacancyUnits=[];
  for(const {posting,unit} of units){
    const confidence=Number(unit?.splitConfidence||0),evidenceText=unitEvidenceText(unit),evidenceCount=Number(unit?.requirementSummary?.evidenceCount||0);
    if(nonVacancyUnitSignal.test(String(unit?.name||''))){ const sample=samplePosting(posting,{unit:unit.name,confidence,evidence:compact(evidenceText,500)}); nonVacancyUnits.push(sample); if(!historicalByExplicitYear(posting)) actionableNonVacancyUnits.push(sample); }
    if(unit?.source==='single' && confidence<=0.5){
      const sample=samplePosting(posting,{unit:unit.name,confidence,evidence:compact(evidenceText,900)}); lowConfidenceSingles.push(sample);
      if(multiRecruitSignal.test(evidenceText)){
        singleDespiteMultiSignal.push(sample); const disposition=nonTargetOrClosed(posting,evidenceText);
        if(historicalByExplicitYear(posting)) nonBlockingMultiSplit.push({...sample,disposition:'historical-explicit-year'});
        else if(preliminaryNotice(posting,evidenceText)) nonBlockingMultiSplit.push({...sample,disposition:'informational-preannouncement'});
        else if(disposition) nonBlockingMultiSplit.push({...sample,disposition});
        else actionableMultiSplit.push(sample);
      }
    }
    if(requirementSignal.test(evidenceText) && evidenceCount===0) requirementSignalWithoutEvidence.push(samplePosting(posting,{unit:unit.name,confidence,evidence:compact(evidenceText,900)}));
    if(evidenceCount===0) noEvidenceUnits.push(samplePosting(posting,{unit:unit.name,confidence}));
  }
  for(const posting of postings){
    const coverage=posting?.sourceCoverage||{},bad=[];
    if(coverage.detail?.available && !coverage.detail?.readable) bad.push({source:'detail',status:coverage.detail.status,error:coverage.detail.error||''});
    if(coverage.document?.available && !coverage.document?.readable) bad.push({source:'document',status:coverage.document.status,error:coverage.document.error||''});
    if(!bad.length) continue;
    const row=samplePosting(posting,{sources:bad}); unreadRequiredSources.push(row); const evidence=(posting.recruitmentUnits||[]).map(unitEvidenceText).join('\n');
    if(historicalByExplicitYear(posting)) historicalUnreadSources.push({...row,disposition:'historical-explicit-year'});
    else if(preliminaryNotice(posting,evidence) && coverage.detail?.readable) informationalUnreadSources.push({...row,disposition:'preannouncement-readable-detail'});
    else actionableUnreadSources.push(row);
  }
  const unreadDiagnostics={bySource:{},byError:{},byOrg:{},actionable:actionableUnreadSources.length,historical:historicalUnreadSources.length,informational:informationalUnreadSources.length};
  for(const row of unreadRequiredSources){ unreadDiagnostics.byOrg[row.org]=Number(unreadDiagnostics.byOrg[row.org]||0)+1; for(const source of row.sources||[]){unreadDiagnostics.bySource[source.source||'unknown']=Number(unreadDiagnostics.bySource[source.source||'unknown']||0)+1; const key=String(source.error||source.status||'unknown').slice(0,180); unreadDiagnostics.byError[key]=Number(unreadDiagnostics.byError[key]||0)+1;} }
  const cacheHits=(inputDiagnostics?.byOrg||[]).reduce((n,x)=>n+Number(x.cacheHits||0),0),cacheMisses=(inputDiagnostics?.byOrg||[]).reduce((n,x)=>n+Number(x.cacheMisses||0),0),cacheTotal=cacheHits+cacheMisses;
  const cacheReuse={hits:cacheHits,misses:cacheMisses,total:cacheTotal,hitRate:cacheTotal?cacheHits/cacheTotal:0,status:cacheTotal===0?'not-observed':cacheHits>0?'reuse-observed':'zero-hit-watch'};
  const counts={postings:postings.length,units:units.length,lowConfidenceSingles:lowConfidenceSingles.length,singleDespiteMultiSignal:singleDespiteMultiSignal.length,actionableMultiSplit:actionableMultiSplit.length,nonBlockingMultiSplit:nonBlockingMultiSplit.length,requirementSignalWithoutEvidence:requirementSignalWithoutEvidence.length,unreadRequiredSources:unreadRequiredSources.length,actionableUnreadSources:actionableUnreadSources.length,historicalUnreadSources:historicalUnreadSources.length,informationalUnreadSources:informationalUnreadSources.length,noEvidenceUnits:noEvidenceUnits.length,nonVacancyUnits:nonVacancyUnits.length,actionableNonVacancyUnits:actionableNonVacancyUnits.length};
  const structuralBlockers=[]; if(counts.actionableMultiSplit>0) structuralBlockers.push('actionable-single-unit-despite-multi-recruitment-signal'); if(counts.requirementSignalWithoutEvidence>0) structuralBlockers.push('requirement-signal-without-linked-evidence'); if(counts.actionableUnreadSources>0) structuralBlockers.push('actionable-source-unreadable'); if(counts.actionableNonVacancyUnits>0) structuralBlockers.push('actionable-non-vacancy-recruitment-unit');
  return {version:STAGE8_QUALITY_AUDIT_VERSION,generatedAt:new Date().toISOString(),status:structuralBlockers.length?'needs-review':'structurally-clean',closureEligible:false,closureReason:'Stage 8 종료는 actionable blocker 해소와 원문대조 Benchmark 통과가 모두 필요함. 과거/사전안내/현재 목표 제외 공고는 누적 진단에는 유지하되 완료를 영구 차단하지 않음.',benchmark:{status:'not-established',required:true,rule:'원문과 모집단위/지원조건/required-preferred/evidence 위치를 표본 대조한 정답셋 기반 검증 필요'},structuralBlockers,counts,cacheReuse,unreadDiagnostics,dispositions:{rule:'진단 데이터는 모두 누적하되 현재 실사용 정확도에 영향을 주는 actionable 항목만 Stage 8 closure blocker로 사용',nonBlockingMultiSplit:nonBlockingMultiSplit.slice(0,100),historicalUnreadSources:historicalUnreadSources.slice(0,100),informationalUnreadSources:informationalUnreadSources.slice(0,100)},samples:{actionableMultiSplit:actionableMultiSplit.slice(0,40),singleDespiteMultiSignal:singleDespiteMultiSignal.slice(0,40),requirementSignalWithoutEvidence:requirementSignalWithoutEvidence.slice(0,40),actionableUnreadSources:actionableUnreadSources.slice(0,40),unreadRequiredSources:unreadRequiredSources.slice(0,40),lowConfidenceSingles:lowConfidenceSingles.slice(0,40),noEvidenceUnits:noEvidenceUnits.slice(0,40),nonVacancyUnits:nonVacancyUnits.slice(0,80),actionableNonVacancyUnits:actionableNonVacancyUnits.slice(0,40)},rules:{lowConfidenceSingle:'source=single && splitConfidence<=0.5',multiRecruitSignal:String(multiRecruitSignal),requirementSignal:String(requirementSignal),nonVacancyUnitSignal:String(nonVacancyUnitSignal)}};
}
