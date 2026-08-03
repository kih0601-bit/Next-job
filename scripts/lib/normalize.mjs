const EXCLUDE = [
  /사칭/, /주의사항/, /보이스피싱/, /스미싱/,
  /합격자/, /최종합격/, /서류전형/, /필기전형/,
  /면접전형/, /면접대상/, /전형결과/, /결과발표/,
  /채용결과/, /예비합격/, /추가합격/,
  /설명회/, /박람회/, /세미나/, /포럼/,
  /교육생/, /수강생/, /참가자/, /참여자/,
  /사업공고/, /지원사업/, /R\s*&\s*D/i, /연구개발/,
  /과제/, /입찰/, /용역/, /수요기업/, /참여기업/
];

const RECRUITMENT = [
  /채용\s*공고/,
  /직원\s*(?:공개)?채용/,
  /신입(?:사원|직원)?\s*(?:공개)?채용/,
  /경력(?:사원|직원)?\s*(?:공개)?채용/,
  /정규직\s*(?:공개)?채용/,
  /무기계약직\s*(?:공개)?채용/,
  /공무직\s*(?:근로자)?\s*(?:공개)?채용/,
  /기간제(?:근로자|직원)?\s*(?:공개)?채용/,
  /계약직\s*(?:직원)?\s*(?:공개)?채용/,
  /체험형\s*인턴\s*(?:공개)?채용/,
  /채용형\s*인턴\s*(?:공개)?채용/,
  /직원\s*모집/,
  /근로자\s*모집/
];

export function isRecruitmentTitle(title) {
  if (!title || title.length < 7 || title.length > 180) return false;
  if (EXCLUDE.some((pattern) => pattern.test(title))) return false;
  return RECRUITMENT.some((pattern) => pattern.test(title));
}

export function analyzeJob(title, text = '') {
  const combined = `${title} ${text}`;

  const highSchool =
    /고졸|고등학교\s*(?:졸업|졸업예정)|학력\s*무관|학력\s*제한\s*없/.test(combined);

  const degreeRequired =
    /전문학사\s*이상|대졸\s*이상|학사\s*이상|석사\s*이상|박사\s*이상|4년제\s*대학/.test(combined);

  let eligibility = '학력 확인 필요';
  let fitScore = 30;
  const fitReasons = [];

  if (highSchool && !degreeRequired) {
    eligibility = '고졸 가능';
    fitScore = 100;
    fitReasons.push('고졸 또는 학력무관 문구 확인');
  } else if (degreeRequired && !highSchool) {
    eligibility = '고졸 지원 어려움';
    fitScore = 0;
    fitReasons.push('전문학사·학사 이상 조건 확인');
  } else {
    fitReasons.push('상세 공고의 학력 조건 확인 필요');
  }

  let employmentType = '원문 확인';
  if (/정규직/.test(combined)) employmentType = '정규직';
  else if (/무기계약직|공무직/.test(combined)) employmentType = '무기계약직·공무직';
  else if (/채용형\s*인턴/.test(combined)) employmentType = '채용형 인턴';
  else if (/체험형\s*인턴/.test(combined)) employmentType = '체험형 인턴';
  else if (/기간제|계약직/.test(combined)) employmentType = '기간제·계약직';

  const ulsan = /울산|울주|새울/.test(combined);
  if (ulsan) {
    fitScore += 15;
    fitReasons.push('울산 근무 관련 문구');
  }

  if (['정규직', '무기계약직·공무직', '채용형 인턴'].includes(employmentType)) {
    fitScore += 10;
    fitReasons.push('안정적 고용형태 가능성');
  }

  return {
    eligibility,
    fitScore: Math.max(0, Math.min(100, fitScore)),
    fitReasons: [...new Set(fitReasons)],
    employmentType,
    location: ulsan ? '울산 관련' : '원문 확인'
  };
}
