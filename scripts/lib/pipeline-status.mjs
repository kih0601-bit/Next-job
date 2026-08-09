export const PIPELINE_STAGES = [
  ['source','Source','공식채용처확인'], ['access','Access','채용처 접속'], ['list','List','단일페이지 공고목록 수집'],
  ['detail','Detail','공고 상세페이지 수집'], ['attachment','Attachment','첨부파일 수집'], ['documentAnalysis','Document Analysis','첨부파일 분석'],
  ['pagination','Pagination','전체 페이지 확장'], ['requirements','Requirement Extraction','지원조건 수집'],
  ['filter','Filter','필터링'], ['output','Output','최종 데이터 생성']
];
export const STATUS = { VERIFIED:'verified', UNKNOWN:'unknown', FAILED:'failed', NOT_IMPLEMENTED:'not-implemented' };
const stage=(status,reason,evidence=[])=>({status,reason,evidence});
export function stageStatuses(source={}) {
  const provenance=source.sourceProvenance || {};
  const sourceStatus=provenance.verificationStatus==='verified' ? STATUS.VERIFIED : provenance.verificationStatus==='failed' ? STATUS.FAILED : STATUS.UNKNOWN;
  const attachmentCause=source.diagnosis?.attachment;
  const detailSamples=Array.isArray(source.detail?.samples) ? source.detail.samples : [];
  const explicitNoAttachment=detailSamples.length > 0 && detailSamples.every(sample => Boolean(sample.explicitNoAttachment));
  const attachmentStatus=(source.attachmentDiscovery?.status==='not-required-no-attachments' || explicitNoAttachment)
    ? STATUS.VERIFIED
    : attachmentCause?.status==='unknown'
      ? STATUS.UNKNOWN
      : source.attachmentDiscovery?.ok
        ? STATUS.VERIFIED
        : source.detail?.ok ? STATUS.FAILED : STATUS.UNKNOWN;
  const docStatus=source.documentAnalysis?.status==='not-required' || source.documentAnalysis?.ok ? STATUS.VERIFIED : source.attachmentDownload?.ok ? STATUS.FAILED : STATUS.UNKNOWN;
  return {
    source: stage(sourceStatus, provenance.reason || '공식채용처 출처 근거 상태', provenance.evidence || []),
    access: stage(source.access?.recruitVerifyOk ? STATUS.VERIFIED : source.access?.httpOk ? STATUS.FAILED : STATUS.FAILED, source.access?.recruitVerifyOk?'공식 채용처 도달 검증 통과':'채용처 도달 검증 미통과'),
    list: stage(source.list?.ok ? STATUS.VERIFIED : source.access?.recruitVerifyOk ? STATUS.FAILED : STATUS.UNKNOWN, source.list?.status || '목록 검증 결과 없음'),
    detail: stage(source.detail?.ok ? STATUS.VERIFIED : source.list?.ok ? STATUS.FAILED : STATUS.UNKNOWN, source.detail?.ok?'현재 검증 범위 상세 수집 통과':'상세 수집 미통과'),
    attachment: stage(attachmentStatus, explicitNoAttachment ? '상세 Evidence에서 실제 첨부 없음이 명시적으로 확인됨' : (attachmentCause?.reason || '첨부 수집 검증 결과')),
    documentAnalysis: stage(docStatus, source.diagnosis?.documentAnalysis?.reason || '첨부파일 분석 검증 결과'),
    pagination: stage(source.pagination?.ok ? STATUS.VERIFIED : source.pagination?.status && source.pagination.status !== 'not-evaluated' ? (source.pagination.status.startsWith('unknown') ? STATUS.UNKNOWN : STATUS.FAILED) : STATUS.NOT_IMPLEMENTED, source.pagination?.status || '전체 페이지 확장 미구현', source.pagination?.evidence || []),
    requirements: stage(STATUS.NOT_IMPLEMENTED, '지원조건 수집의 최종 정확성 검증 미구현'),
    filter: stage(STATUS.NOT_IMPLEMENTED, '최종 필터 판정 검증 미구현'),
    output: stage(STATUS.NOT_IMPLEMENTED, '최종 데이터 생성 End-to-End 검증 미구현')
  };
}
export function summarizeStages(stages={}) {
  const values=Object.values(stages); const count=s=>values.filter(v=>v.status===s).length;
  let contiguous=0; for (const [key] of PIPELINE_STAGES) { if(stages[key]?.status===STATUS.VERIFIED) contiguous++; else break; }
  return { verified:count(STATUS.VERIFIED), unknown:count(STATUS.UNKNOWN), failed:count(STATUS.FAILED), notImplemented:count(STATUS.NOT_IMPLEMENTED), contiguousVerifiedThrough:contiguous, pipelineComplete:values.length===10 && values.every(v=>v.status===STATUS.VERIFIED) };
}
export function verificationSystems(source={}) {
  return {
    evidence:{status:'active'}, diagnostics:{status:'active'}, sourceVerification:{status:'active'}, regression:{status:'active'}, silentFailure:{status:'active'}, report:{status:'active'},
    provenance:{status:'active', result:source.sourceProvenance?.verificationStatus || 'unknown'},
    reconciliation:{status:source.pagination?.reconciliation?.status && source.pagination.reconciliation.status!=='not-evaluated' ? 'active' : 'planned', result:source.pagination?.reconciliation || {}, activatesAt:'Pagination(전체 페이지 확장)'},
    goldenDataset:{status:source.pagination?.goldenDataset?.status ? 'active' : 'planned', result:source.pagination?.goldenDataset || {}, activatesAt:'Pagination(전체 페이지 확장)'}
  };
}
