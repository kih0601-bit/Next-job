const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const QUALITY_ENGINE_VERSION = '11.3.0-position-unit';
export const QUALITY_THRESHOLD = 90;

export function scoreJobQuality({ detail = {}, documents = {}, analysis = {}, deadline = '', link = '' } = {}) {
  const reasons = [], penalties = [];
  let score = 0;
  if (detail.ok) { score += 22; reasons.push('상세 원문 검증 완료'); } else penalties.push('상세 원문 확인 실패');
  const confidence = detail.confidence || {};
  const signals = Number(confidence.structureSignals || 0), ratio = Number(confidence.titleRatio || 0);
  if (signals >= 5) { score += 14; reasons.push('채용 구조 5개 이상 확인'); }
  else if (signals >= 3) { score += 10; reasons.push('채용 구조 확인'); }
  else penalties.push('채용 구조 부족');
  if (ratio >= 0.67) { score += 12; reasons.push('제목-원문 일치도 높음'); }
  else if (ratio >= 0.4) { score += 7; reasons.push('제목-원문 일치'); }
  else if ((confidence.tokenCount || 0) >= 3) penalties.push('제목-원문 일치도 낮음');
  if (documents.successful > 0) { score += 8; reasons.push(`첨부문서 ${documents.successful}개 분석`); }
  if (analysis.crossValidation?.conflict) { score -= 35; penalties.push(...analysis.crossValidation.reasons); }
  if (analysis.eligibility === '고졸 가능') { score += 14; reasons.push('고졸 지원 가능 확인'); } else penalties.push('학력 조건 미확인');
  if (analysis.location === '울산') { score += 14; reasons.push('울산 단일 근무 확인'); } else penalties.push('울산 단일 근무 미확인');
  if (['정규직','무기계약직','공무직','일반직','상용직'].includes(analysis.employmentType)) { score += 12; reasons.push(`${analysis.employmentType} 확인`); } else penalties.push('허용 고용형태 미확인');
  if (deadline) { score += 5; reasons.push('마감일 확인'); } else penalties.push('마감일 미확인');
  try {
    const url = new URL(link);
    const detailSignal = /(?:view|detail|read|select|article|recruitview)/i.test(url.pathname) || [...url.searchParams.keys()].some(k => /(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo|dataSid|recruitNo)/i.test(k));
    if (detailSignal) { score += 4; reasons.push('상세주소 식별자 확인'); } else penalties.push('상세주소 식별자 부족');
  } catch { penalties.push('원문 주소 형식 오류'); }
  if (analysis.excluded) score = 0;
  score = clamp(score, 0, 100);
  return { score, threshold: QUALITY_THRESHOLD, passed: !analysis.excluded && analysis.recommended && !analysis.crossValidation?.conflict && score >= QUALITY_THRESHOLD, reasons: [...new Set(reasons)], penalties: [...new Set(penalties)] };
}
