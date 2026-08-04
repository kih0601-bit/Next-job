import {
  NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS,
  DEGREE_REQUIRED_PATTERNS, HIGH_SCHOOL_OK_PATTERNS, ALLOWED_EMPLOYMENT
} from './rules.mjs';

const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));

export function detectEmployment(text = '') {
  if (/무기계약직/.test(text)) return '무기계약직';
  if (/공무직/.test(text)) return '공무직';
  if (/정규직/.test(text) && !/비정규직/.test(text)) return '정규직';
  if (/비정규직|기간제|계약직|인턴|위촉직|촉탁직|대체근로자/.test(text)) return '제외 고용형태';
  return '고용형태 확인 필요';
}

export function detectEducation(text = '') {
  const degreeRequired = matchesAny(text, DEGREE_REQUIRED_PATTERNS);
  const highSchoolOk = matchesAny(text, HIGH_SCHOOL_OK_PATTERNS);
  if (degreeRequired) return '고졸 지원 어려움';
  if (highSchoolOk) return '고졸 가능';
  return '학력 확인 필요';
}

export function detectLocation(text = '') {
  const explicit = text.match(/(?:근무지|근무지역|근무장소|근무예정지|소재지)\s*[:：]?\s*([^\n]{0,80})/i);
  const locationText = explicit?.[1] || '';
  const target = locationText || text.slice(0, 1200);
  const isUlsan = /울산(?:광역시)?|울주군|새울/.test(target);
  const other = /(서울|부산|대구|인천|광주|대전|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(locationText.replace(/울산/g, ''));
  if (isUlsan && !other) return '울산';
  if (locationText && !isUlsan) return '울산 외';
  return '근무지 확인 필요';
}

export function analyzeJob({ title = '', listText = '', detailText = '', detailOk = false }) {
  const titleText = String(title).trim();
  const fullText = `${titleText}\n${listText}\n${detailText}`;
  const reasons = [];
  const excludeReasons = [];

  if (matchesAny(titleText, NON_JOB_PATTERNS)) excludeReasons.push('채용공고가 아닌 안내·결과 공지');
  if (matchesAny(fullText, EXCLUDED_EMPLOYMENT_PATTERNS)) excludeReasons.push('인턴·기간제·계약직 등 제외 고용형태');
  if (matchesAny(fullText, LICENSE_JOB_PATTERNS)) excludeReasons.push('전문면허·전문자격 필수 직무');

  const education = detectEducation(fullText);
  if (education === '고졸 지원 어려움') excludeReasons.push('전문학사·학사 이상 조건');
  else if (education === '고졸 가능') reasons.push('고졸 또는 학력무관 문구 확인');
  else reasons.push('학력 조건 원문 확인 필요');

  const employmentType = detectEmployment(fullText);
  if (ALLOWED_EMPLOYMENT.includes(employmentType)) reasons.push(`${employmentType} 문구 확인`);
  else if (employmentType === '고용형태 확인 필요') reasons.push('고용형태 원문 확인 필요');

  const location = detectLocation(fullText);
  if (location === '울산') reasons.push('울산 근무지 확인');
  else if (location === '울산 외') excludeReasons.push('울산 외 근무');
  else reasons.push('근무지 원문 확인 필요');

  if (!detailOk) reasons.push('상세페이지 판독 실패 또는 미지원');

  const excluded = excludeReasons.length > 0;
  const recommended = !excluded && detailOk && education === '고졸 가능' && location === '울산' && ALLOWED_EMPLOYMENT.includes(employmentType);
  const reviewNeeded = !excluded && !recommended;
  let fitScore = recommended ? 100 : excluded ? 0 : 30;
  if (reviewNeeded) {
    if (education === '고졸 가능') fitScore += 20;
    if (location === '울산') fitScore += 20;
    if (ALLOWED_EMPLOYMENT.includes(employmentType)) fitScore += 20;
    fitScore = Math.min(fitScore, 90);
  }

  return {
    status: recommended ? '지원 추천' : excluded ? '제외' : '확인 필요',
    recommended,
    excluded,
    reviewNeeded,
    eligibility: education,
    employmentType,
    location,
    fitScore,
    fitReasons: [...new Set(reasons)],
    excludeReasons: [...new Set(excludeReasons)]
  };
}
