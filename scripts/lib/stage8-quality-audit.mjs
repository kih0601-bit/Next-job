export const STAGE8_QUALITY_AUDIT_VERSION = '1.1.0-unread-root-cause';

const compact=(v='',max=500)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const multiRecruitSignal=/(?:모집|채용)\s*분야|채용직렬|채용직종|모집직무|직렬\s*[|:：]|분야\s*[|:：]|(?:신입|경력)직\s*\d*급|지역인재|장애[^\n]{0,30}(?:일반|경력|신입)/i;
const requirementSignal=/지원자격|응시자격|자격요건|필수자격|우대사항|우대조건|경력\s*\d|학력|전공|자격증|면허|결격사유/i;

function unitEvidenceText(unit={}){
  return `${unit?.evidenceScope?.detail||''}\n${unit?.evidenceScope?.document||''}`;
}

function samplePosting(posting, extra={}){
  return {org:posting?.posting?.org||'',title:posting?.posting?.title||'',link:posting?.posting?.link||'',...extra};
}

export function auditStage8Quality(report={}, {inputDiagnostics={}}={}) {
  const postings=Array.isArray(report?.postings)?report.postings:[];
  const units=postings.flatMap(p=>(p.recruitmentUnits||[]).map(u=>({posting:p,unit:u})));
  const lowConfidenceSingles=[];
  const singleDespiteMultiSignal=[];
  const requirementSignalWithoutEvidence=[];
  const unreadRequiredSources=[];
  const noEvidenceUnits=[];

  for(const row of units){
    const {posting,unit}=row;
    const confidence=Number(unit?.splitConfidence||0);
    const evidenceText=unitEvidenceText(unit);
    const evidenceCount=Number(unit?.requirementSummary?.evidenceCount||0);
    if(unit?.source==='single' && confidence<=0.5){
      lowConfidenceSingles.push(samplePosting(posting,{unit:unit.name,confidence,evidence:compact(evidenceText,700)}));
      if(multiRecruitSignal.test(evidenceText)){
        singleDespiteMultiSignal.push(samplePosting(posting,{unit:unit.name,confidence,evidence:compact(evidenceText.match(multiRecruitSignal)?.input||evidenceText,900)}));
      }
    }
    if(requirementSignal.test(evidenceText) && evidenceCount===0){
      requirementSignalWithoutEvidence.push(samplePosting(posting,{unit:unit.name,confidence,evidence:compact(evidenceText,900)}));
    }
    if(evidenceCount===0) noEvidenceUnits.push(samplePosting(posting,{unit:unit.name,confidence}));
  }

  for(const posting of postings){
    const coverage=posting?.sourceCoverage||{};
    const bad=[];
    if(coverage.detail?.available && !coverage.detail?.readable) bad.push({source:'detail',status:coverage.detail.status,error:coverage.detail.error||''});
    if(coverage.document?.available && !coverage.document?.readable) bad.push({source:'document',status:coverage.document.status,error:coverage.document.error||''});
    if(bad.length) unreadRequiredSources.push(samplePosting(posting,{sources:bad}));
  }

  const unreadDiagnostics={bySource:{},byError:{},byOrg:{},currentYearHint:0,historicalOrUnknownHint:0};
  const currentYear=String(new Date().getUTCFullYear());
  for(const row of unreadRequiredSources){
    unreadDiagnostics.byOrg[row.org]=Number(unreadDiagnostics.byOrg[row.org]||0)+1;
    const currentHint=String(row.title||'').includes(currentYear);
    if(currentHint) unreadDiagnostics.currentYearHint+=1; else unreadDiagnostics.historicalOrUnknownHint+=1;
    for(const source of row.sources||[]){
      unreadDiagnostics.bySource[source.source||'unknown']=Number(unreadDiagnostics.bySource[source.source||'unknown']||0)+1;
      const key=String(source.error||source.status||'unknown').slice(0,180);
      unreadDiagnostics.byError[key]=Number(unreadDiagnostics.byError[key]||0)+1;
    }
  }

  const cacheHits=(inputDiagnostics?.byOrg||[]).reduce((n,x)=>n+Number(x.cacheHits||0),0);
  const cacheMisses=(inputDiagnostics?.byOrg||[]).reduce((n,x)=>n+Number(x.cacheMisses||0),0);
  const cacheTotal=cacheHits+cacheMisses;
  const cacheReuse={hits:cacheHits,misses:cacheMisses,total:cacheTotal,hitRate:cacheTotal?cacheHits/cacheTotal:0,status:cacheTotal===0?'not-observed':cacheHits>0?'reuse-observed':'zero-hit-watch'};

  const counts={
    postings:postings.length,
    units:units.length,
    lowConfidenceSingles:lowConfidenceSingles.length,
    singleDespiteMultiSignal:singleDespiteMultiSignal.length,
    requirementSignalWithoutEvidence:requirementSignalWithoutEvidence.length,
    unreadRequiredSources:unreadRequiredSources.length,
    noEvidenceUnits:noEvidenceUnits.length
  };
  const structuralBlockers=[];
  if(counts.singleDespiteMultiSignal>0) structuralBlockers.push('single-unit-despite-multi-recruitment-signal');
  if(counts.requirementSignalWithoutEvidence>0) structuralBlockers.push('requirement-signal-without-linked-evidence');
  if(counts.unreadRequiredSources>0) structuralBlockers.push('available-source-unreadable');

  return {
    version:STAGE8_QUALITY_AUDIT_VERSION,
    generatedAt:new Date().toISOString(),
    status:structuralBlockers.length?'needs-review':'structurally-clean',
    closureEligible:false,
    closureReason:'Stage 8 종료에는 structural audit뿐 아니라 원문 대조 Benchmark 정확도 검증이 필요함. 현재 benchmark gate는 아직 확립 전.',
    benchmark:{status:'not-established',required:true,rule:'원문과 모집단위/지원조건/required-preferred/evidence 위치를 표본 대조한 정답셋 기반 검증 필요'},
    structuralBlockers,
    counts,
    cacheReuse,
    unreadDiagnostics,
    samples:{
      singleDespiteMultiSignal:singleDespiteMultiSignal.slice(0,40),
      requirementSignalWithoutEvidence:requirementSignalWithoutEvidence.slice(0,40),
      unreadRequiredSources:unreadRequiredSources.slice(0,40),
      lowConfidenceSingles:lowConfidenceSingles.slice(0,40),
      noEvidenceUnits:noEvidenceUnits.slice(0,40)
    },
    rules:{
      lowConfidenceSingle:'source=single && splitConfidence<=0.5',
      multiRecruitSignal:String(multiRecruitSignal),
      requirementSignal:String(requirementSignal)
    }
  };
}
