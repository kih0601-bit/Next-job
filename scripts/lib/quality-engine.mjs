const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const QUALITY_ENGINE_VERSION = '10.0.0';

export function scoreJobQuality({ detail = {}, analysis = {}, deadline = '', title = '', link = '' } = {}) {
  const reasons = [];
  const penalties = [];
  let score = 0;

  if (detail.ok) {
    score += 25;
    reasons.push('상세 원문 확인');
  } else {
    penalties.push('상세 원문 확인 실패');
  }

  const confidence = detail.confidence || {};
  const structureSignals = Number(confidence.structureSignals || 0);
  const titleRatio = Number(confidence.titleRatio || 0);

  if (structureSignals >= 4) {
    score += 15;
    reasons.push('채용 공고 구조 4개 이상 확인');
  } else if (structureSignals >= 2) {
    score += 9;
    reasons.push('채용 공고 구조 확인');
  } else {
    penalties.push('채용 공고 구조 부족');
  }

  if (titleRatio >= 0.67) {
    score += 12;
    reasons.push('제목-원문 일치도 높음');
  } else if (titleRatio >= 0.34) {
    score += 7;
    reasons.push('제목-원문 일치');
  } else if ((confidence.tokenCount || 0) >= 3) {
    penalties.push('제목-원문 일치도 낮음');
  }

  if (analysis.eligibility === '고졸 가능') {
    score += 15;
    reasons.push('고졸 지원 가능 확인');
  } else {
    penalties.push('학력 조건 미확인');
  }

  if (analysis.location === '울산') {
    score += 15;
    reasons.push('울산 단일 근무 확인');
  } else {
    penalties.push('울산 단일 근무 미확인');
  }

  if (['정규직', '무기계약직', '공무직', '일반직', '상용직'].includes(analysis.employmentType)) {
    score += 13;
    reasons.push(`${analysis.employmentType} 확인`);
  } else {
    penalties.push('허용 고용형태 미확인');
  }

  if (deadline) {
    score += 5;
    reasons.push('마감일 확인');
  } else {
    penalties.push('마감일 미확인');
  }

  try {
    const url = new URL(link);
    const hasDetailSignal = /(?:view|detail|read|select|article|boardView|recruitview)/i.test(url.pathname) ||
      [...url.searchParams.keys()].some(key => /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|recruit_no)$/i.test(key));
    if (hasDetailSignal) {
      score += 5;
      reasons.push('상세 주소 식별자 확인');
    } else {
      penalties.push('상세 주소 식별자 부족');
    }
  } catch {
    penalties.push('원문 주소 형식 오류');
  }

  if (analysis.excluded) score = 0;
  score = clamp(score, 0, 100);

  return {
    score,
    passed: !analysis.excluded && analysis.recommended && score >= 85,
    threshold: 85,
    reasons: [...new Set(reasons)],
    penalties: [...new Set(penalties)]
  };
}
