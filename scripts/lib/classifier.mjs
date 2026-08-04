import {
  NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS,
  DEGREE_REQUIRED_PATTERNS, HIGH_SCHOOL_OK_PATTERNS, CLOSED_STATUS_PATTERNS,
  ALLOWED_EMPLOYMENT
} from './rules.mjs';

const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));

export function detectEmployment(text = '') {
  if (matchesAny(text, EXCLUDED_EMPLOYMENT_PATTERNS)) return '제외 고용형태';
  if (/무기계약직/.test(text)) return '무기계약직';
  if (/공무직/.test(text)) return '공무직';
  if (/상용직/.test(text)) return '상용직';
  if (/정규직/.test(text) && !/비정규직/.test(text)) return '정규직';
  return '고용형태 확인 필요';
}

export function detectEducation(text = '') {
  const degreeRequired = matchesAny(text, DEGREE_REQUIRED_PATTERNS);
  const highSchoolOk = matchesAny(text, HIGH_SCHOOL_OK_PATTERNS);
  // 공고 안에 분야별 자격이 섞여 있을 수 있으므로 학위 요구 문구가 하나라도 있으면 보수적으로 제외한다.
  if (degreeRequired) return '고졸 지원 어려움';
  if (highSchoolOk) return '고졸 가능';
  return '학력 확인 필요';
}

export function detectLocation(text = '') {
  const fields = [...text.matchAll(/(?:근무지|근무지역|근무장소|근무예정지|근무처|배치부서|소재지)\s*[:：]?\s*([^\n]{0,120})/gi)]
    .map(match => match[1]);
  const locationText = fields.join(' ');
  const target = locationText || text.slice(0, 1800);
  const isUlsan = /울산(?:광역시)?|울주군|새울|온산|미포|울산항/.test(target);
  const other = /(서울|부산|대구|인천|광주|대전|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(locationText.replace(/울산|경남\s*울산/g, ''));
  if (isUlsan && !other) return '울산';
  if (locationText && (!isUlsan || other)) return '울산 외 또는 전국';
  return '근무지 확인 필요';
}

export function analyzeJob({ title = '', listText = '', detailText = '', detailOk = false }) {
  const titleText = String(title).trim();
  const fullText = `${titleText}\n${listText}\n${detailText}`;
  const reasons = [];
  const excludeReasons = [];

  if (matchesAny(titleText, NON_JOB_PATTERNS)) excludeReasons.push('실제 모집공고가 아닌 안내·결과·바로가기 페이지');
  if (matchesAny(fullText, EXCLUDED_EMPLOYMENT_PATTERNS)) excludeReasons.push('인턴·기간제·계약직 등 제외 고용형태');
  if (matchesAny(fullText, LICENSE_JOB_PATTERNS)) excludeReasons.push('전문면허·전문자격 직무');
  if (matchesAny(fullText, CLOSED_STATUS_PATTERNS)) excludeReasons.push('접수 종료 또는 마감 문구');
  if (!detailOk) excludeReasons.push('상세 공고 원문 판독 실패');

  const education = detectEducation(fullText);
  if (education === '고졸 지원 어려움') excludeReasons.push('전문학사·학사 이상 조건');
  else if (education === '고졸 가능') reasons.push('고졸 또는 학력무관 문구 확인');
  else excludeReasons.push('고졸 지원 가능 문구 미확인');

  const employmentType = detectEmployment(fullText);
  if (ALLOWED_EMPLOYMENT.includes(employmentType)) reasons.push(`${employmentType} 문구 확인`);
  else if (employmentType === '제외 고용형태') {
    if (!excludeReasons.includes('인턴·기간제·계약직 등 제외 고용형태')) excludeReasons.push('제외 고용형태');
  } else excludeReasons.push('정규직·공무직·무기계약직 문구 미확인');

  const location = detectLocation(fullText);
  if (location === '울산') reasons.push('울산 근무지 확인');
  else excludeReasons.push(location === '근무지 확인 필요' ? '울산 근무지 문구 미확인' : '울산 외 또는 전국 순환근무');

  const excluded = excludeReasons.length > 0;
  return {
    status: excluded ? '제외' : '지원 추천',
    recommended: !excluded,
    excluded,
    reviewNeeded: false,
    eligibility: education,
    employmentType,
    location,
    fitScore: excluded ? 0 : 100,
    fitReasons: [...new Set(reasons)],
    excludeReasons: [...new Set(excludeReasons)]
  };
}
