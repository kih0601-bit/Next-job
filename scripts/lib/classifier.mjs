import {
  NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS,
  REQUIRED_LICENSE_PATTERNS, DEGREE_REQUIRED_PATTERNS, HIGH_SCHOOL_OK_PATTERNS,
  ALLOWED_EMPLOYMENT
} from './rules.mjs';

const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));

export function detectEmployment(text = '') {
  if (matchesAny(text, EXCLUDED_EMPLOYMENT_PATTERNS)) return '제외 고용형태';
  if (/무기계약직|기간의\s*정함이\s*없는\s*근로계약/.test(text)) return '무기계약직';
  if (/공무직/.test(text)) return '공무직';
  if (/상용직/.test(text)) return '상용직';
  if (/일반직/.test(text)) return '일반직';
  if (/정규직/.test(text) && !/비정규직|정규직\s*전환\s*(?:없음|불가)/.test(text)) return '정규직';
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
  const lines = String(text).split(/\n|\r|\t| {2,}/).map(line => line.trim()).filter(Boolean);
  const labeledLines = lines.filter(line => /(?:근무지|근무지역|근무장소|근무예정지|배치예정지|소재지)\s*[:：]?/i.test(line));
  const locationText = labeledLines.join(' ').slice(0, 800);
  const target = locationText || String(text).slice(0, 1800);
  const hasUlsan = /울산(?:광역시)?|울주군|울산\s*(?:중구|남구|동구|북구)|새울/.test(target);
  const hasNationwide = /전국|전국사업장|전국\s*근무|순환근무|전국\s*순환/.test(target);
  const otherRegion = /(서울|부산|대구|인천|광주|대전|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(locationText.replace(/울산/g, ''));

  if (hasUlsan && !otherRegion && !hasNationwide) return '울산';
  if (locationText && (!hasUlsan || otherRegion || hasNationwide)) return '울산 외 또는 복수지역';
  return '근무지 확인 필요';
}

export function analyzeJob({ title = '', listText = '', detailText = '', detailOk = false }) {
  const titleText = String(title).trim();
  const fullText = `${titleText}\n${listText}\n${detailText}`.replace(/[ \t]+/g, ' ');
  const reasons = [];
  const excludeReasons = [];

  if (matchesAny(titleText, NON_JOB_PATTERNS)) excludeReasons.push('채용공고가 아닌 안내·결과 공지');
  if (matchesAny(fullText, EXCLUDED_EMPLOYMENT_PATTERNS)) excludeReasons.push('인턴·기간제·계약직 등 제외 고용형태');
  if (matchesAny(titleText, LICENSE_JOB_PATTERNS) || matchesAny(fullText, REQUIRED_LICENSE_PATTERNS)) {
    excludeReasons.push('전문면허·전문자격 필수 직무');
  }

  const education = detectEducation(fullText);
  if (education === '고졸 지원 어려움') excludeReasons.push('전문학사·학사 이상 조건');
  else if (education === '고졸 가능') reasons.push('고졸 또는 학력무관 문구 확인');
  else reasons.push('학력 조건 원문 확인 필요');

  const employmentType = detectEmployment(fullText);
  if (employmentType === '제외 고용형태') {
    if (!excludeReasons.includes('인턴·기간제·계약직 등 제외 고용형태')) excludeReasons.push('인턴·기간제·계약직 등 제외 고용형태');
  } else if (ALLOWED_EMPLOYMENT.includes(employmentType)) {
    reasons.push(`${employmentType} 문구 확인`);
  } else reasons.push('고용형태 원문 확인 필요');

  const location = detectLocation(fullText);
  if (location === '울산') reasons.push('울산 단일 근무지 확인');
  else if (location === '울산 외 또는 복수지역') excludeReasons.push('울산 단일 근무가 아님');
  else reasons.push('근무지 원문 확인 필요');

  if (!detailOk) reasons.push('상세페이지 판독 실패 또는 미지원');
  if (detailOk && detailText.length < 120) reasons.push('상세 본문이 너무 짧아 원문 재확인 필요');

  const excluded = excludeReasons.length > 0;
  const recommended = !excluded && detailOk && detailText.length >= 120 && education === '고졸 가능' && location === '울산' && ALLOWED_EMPLOYMENT.includes(employmentType);
  const reviewNeeded = !excluded && !recommended;
  let fitScore = recommended ? 100 : excluded ? 0 : 25;
  if (reviewNeeded) {
    if (education === '고졸 가능') fitScore += 20;
    if (location === '울산') fitScore += 20;
    if (ALLOWED_EMPLOYMENT.includes(employmentType)) fitScore += 20;
    if (detailOk) fitScore += 10;
    fitScore = Math.min(fitScore, 90);
  }

  return {
    status: recommended ? '지원 추천' : excluded ? '제외' : '확인 필요',
    recommended, excluded, reviewNeeded,
    eligibility: education, employmentType, location, fitScore,
    fitReasons: [...new Set(reasons)],
    excludeReasons: [...new Set(excludeReasons)]
  };
}
