import {
  NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS,
  REQUIRED_LICENSE_PATTERNS, DEGREE_REQUIRED_PATTERNS, HIGH_SCHOOL_OK_PATTERNS,
  ALLOWED_EMPLOYMENT, TEMPORARY_EMPLOYMENT_STRONG_PATTERNS, TEMPORARY_EMPLOYMENT_BENIGN_PATTERNS
} from './rules.mjs';
import { splitVacancies, VACANCY_SPLITTER_VERSION } from './vacancy-splitter.mjs';

const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));

function stripBenignTemporaryMentions(text = '') {
  return TEMPORARY_EMPLOYMENT_BENIGN_PATTERNS.reduce(
    (value, pattern) => value.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), ' '),
    String(text)
  );
}

export function hasExcludedEmploymentEvidence(text = '') {
  const original = String(text);
  const cleaned = stripBenignTemporaryMentions(original);
  if (matchesAny(cleaned, EXCLUDED_EMPLOYMENT_PATTERNS)) return true;
  return matchesAny(cleaned, TEMPORARY_EMPLOYMENT_STRONG_PATTERNS);
}

export function detectEmployment(text = '') {
  if (hasExcludedEmploymentEvidence(text)) return '제외 고용형태';
  if (/무기계약직|기간의\s*정함이\s*없는\s*근로계약/.test(text)) return '무기계약직';
  if (/공무직/.test(text)) return '공무직';
  if (/상용직/.test(text)) return '상용직';
  if (/일반직/.test(text)) return '일반직';
  if (/정규직/.test(text) && !/비정규직|정규직\s*전환\s*(?:없음|불가)/.test(text)) return '정규직';
  return '고용형태 확인 필요';
}

export function detectEducation(text = '') {
  if (matchesAny(text, DEGREE_REQUIRED_PATTERNS)) return '고졸 지원 어려움';
  if (matchesAny(text, HIGH_SCHOOL_OK_PATTERNS)) return '고졸 가능';
  return '학력 확인 필요';
}

export function detectLocation(text = '') {
  const lines = String(text).split(/\n|\r|\t| {2,}/).map(line => line.trim()).filter(Boolean);
  const labeledLines = lines.filter(line => /(?:근무지|근무지역|근무장소|근무예정지|배치예정지|소재지)\s*[:：]?/i.test(line));
  const locationText = labeledLines.join(' ').slice(0, 1200);
  const target = locationText || String(text).slice(0, 2400);
  const hasUlsan = /울산(?:광역시)?|울주군|울산\s*(?:중구|남구|동구|북구)|새울/.test(target);
  const hasNationwide = /전국|전국사업장|전국\s*근무|순환근무|전국\s*순환|권역별\s*배치/.test(target);
  const otherRegion = /(서울|부산|대구|인천|광주|대전|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(locationText.replace(/울산/g, ''));
  if (hasUlsan && !otherRegion && !hasNationwide) return '울산';
  if (locationText && (!hasUlsan || otherRegion || hasNationwide)) return '울산 외 또는 복수지역';
  return '근무지 확인 필요';
}

export function detectJobCategory(text = '') {
  const rules = [
    ['전산', /전산|정보보안|개발|소프트웨어|데이터|네트워크|시스템/],
    ['시설', /시설|기계|전기|소방|건축|토목|설비|유지보수/],
    ['운전', /운전|운전원|차량|버스/],
    ['환경', /환경|폐기물|수질|대기|녹지|청소/],
    ['회계', /회계|재무|세무|결산|예산/],
    ['고객지원', /고객|민원|안내|상담|콜센터|매표/],
    ['행정·사무', /행정|사무|경영|총무|인사|기획|지원/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || '기타';
}

function crossValidate(detailText = '', documentText = '') {
  if (!documentText || documentText.length < 40) return { checked: false, conflict: false, reasons: [] };
  const reasons = [];
  const detailEmployment = detectEmployment(detailText), documentEmployment = detectEmployment(documentText);
  const detailEducation = detectEducation(detailText), documentEducation = detectEducation(documentText);
  const detailLocation = detectLocation(detailText), documentLocation = detectLocation(documentText);
  if (ALLOWED_EMPLOYMENT.includes(detailEmployment) && documentEmployment === '제외 고용형태') reasons.push('본문과 첨부문서의 고용형태 충돌');
  if (detailEducation === '고졸 가능' && documentEducation === '고졸 지원 어려움') reasons.push('본문과 첨부문서의 학력 조건 충돌');
  if (detailLocation === '울산' && documentLocation === '울산 외 또는 복수지역') reasons.push('본문과 첨부문서의 근무지 충돌');
  return { checked: true, conflict: reasons.length > 0, reasons, detailEmployment, documentEmployment, detailEducation, documentEducation, detailLocation, documentLocation };
}

function collectEvidence(text = '', patterns = [], limit = 4) {
  const lines = String(text)
    .split(/\n|\r|\t| {2,}/)
    .map(line => line.trim())
    .filter(Boolean);
  const matches = [];
  for (const line of lines) {
    if (patterns.some(pattern => pattern.test(line))) matches.push(line.slice(0, 240));
    if (matches.length >= limit) break;
  }
  return [...new Set(matches)];
}

function buildDecisionEvidence({ fullText = '', detailText = '', documentText = '', education, employmentType, location }) {
  return {
    education: {
      result: education,
      lines: collectEvidence(fullText, [...HIGH_SCHOOL_OK_PATTERNS, ...DEGREE_REQUIRED_PATTERNS])
    },
    employment: {
      result: employmentType,
      lines: collectEvidence(fullText, [
        /정규직|무기계약직|공무직|일반직|상용직/,
        ...EXCLUDED_EMPLOYMENT_PATTERNS,
        ...TEMPORARY_EMPLOYMENT_STRONG_PATTERNS
      ])
    },
    location: {
      result: location,
      lines: collectEvidence(fullText, [/(?:근무지|근무지역|근무장소|근무예정지|배치예정지|소재지)/i, /울산|울주군|새울/])
    },
    sources: {
      detailChars: String(detailText).length,
      documentChars: String(documentText).length,
      documentUsed: String(documentText).trim().length > 0
    }
  };
}

export function analyzeJob({ title = '', listText = '', detailText = '', documentText = '', detailOk = false, structuredVacancy = false }) {
  const titleText = String(title).trim();
  const fullText = `${titleText}\n${listText}\n${detailText}\n${documentText}`.replace(/[ \t]+/g, ' ');
  const reasons = [], excludeReasons = [];
  if (matchesAny(titleText, NON_JOB_PATTERNS)) excludeReasons.push('채용공고가 아닌 안내·결과 공지');
  if (hasExcludedEmploymentEvidence(fullText)) excludeReasons.push('인턴·기간제·계약직 등 제외 고용형태');
  if (matchesAny(titleText, LICENSE_JOB_PATTERNS) || matchesAny(fullText, REQUIRED_LICENSE_PATTERNS)) excludeReasons.push('전문면허·전문자격 필수 직무');

  const education = detectEducation(fullText);
  if (education === '고졸 지원 어려움') excludeReasons.push('전문학사·학사 이상 조건');
  else if (education === '고졸 가능') reasons.push('고졸 또는 학력무관 문구 확인');
  else reasons.push('학력 조건 원문 확인 필요');

  const employmentType = detectEmployment(fullText);
  if (employmentType === '제외 고용형태') {
    if (!excludeReasons.includes('인턴·기간제·계약직 등 제외 고용형태')) excludeReasons.push('인턴·기간제·계약직 등 제외 고용형태');
  } else if (ALLOWED_EMPLOYMENT.includes(employmentType)) reasons.push(`${employmentType} 문구 확인`);
  else reasons.push('고용형태 원문 확인 필요');

  const location = detectLocation(fullText);
  if (location === '울산') reasons.push('울산 단일 근무지 확인');
  else if (location === '울산 외 또는 복수지역') excludeReasons.push('울산 단일 근무가 아님');
  else reasons.push('근무지 원문 확인 필요');

  const crossValidation = crossValidate(detailText, documentText);
  if (crossValidation.conflict) excludeReasons.push(...crossValidation.reasons);
  if (crossValidation.checked && !crossValidation.conflict) reasons.push('본문-첨부문서 교차검증 통과');
  if (!detailOk) reasons.push('상세페이지 판독 실패 또는 미지원');
  const structuredSignals = [education === '고졸 가능', location === '울산', ALLOWED_EMPLOYMENT.includes(employmentType), /채용인원|모집인원|\d+명/.test(detailText)].filter(Boolean).length;
  const detailSufficient = detailText.length >= 120 || (structuredSignals >= 4 && detailText.length >= 55) || (structuredVacancy && structuredSignals >= 3 && detailText.length >= 55);
  if (detailOk && !detailSufficient) reasons.push('상세 본문이 너무 짧음');

  const excluded = excludeReasons.length > 0;
  const recommended = !excluded && detailOk && detailSufficient && education === '고졸 가능' && location === '울산' && ALLOWED_EMPLOYMENT.includes(employmentType);
  const reviewNeeded = !excluded && !recommended;
  let fitScore = recommended ? 100 : excluded ? 0 : 25;
  if (reviewNeeded) {
    if (education === '고졸 가능') fitScore += 20;
    if (location === '울산') fitScore += 20;
    if (ALLOWED_EMPLOYMENT.includes(employmentType)) fitScore += 20;
    if (detailOk) fitScore += 10;
    fitScore = Math.min(fitScore, 90);
  }
  const decisionEvidence = buildDecisionEvidence({ fullText, detailText, documentText, education, employmentType, location });
  return {
    status: recommended ? '지원 추천' : excluded ? '제외' : '확인 필요', recommended, excluded, reviewNeeded,
    eligibility: education, employmentType, location, fitScore, jobCategory: detectJobCategory(fullText), crossValidation,
    fitReasons: [...new Set(reasons)], excludeReasons: [...new Set(excludeReasons)], decisionEvidence
  };
}


export function analyzeVacancies({ title = '', listText = '', detailText = '', documentText = '', detailOk = false } = {}) {
  const vacancies = splitVacancies({ title, detailText, documentText });
  return vacancies.map((vacancy, index) => {
    const localDetail = `${vacancy.sharedContext}\n${vacancy.localText}`.trim();
    const result = analyzeJob({
      title: vacancies.length > 1 ? `${title} ${vacancy.name}` : title,
      listText,
      detailText: localDetail,
      documentText,
      detailOk,
      structuredVacancy: vacancies.length > 1
    });
    return {
      ...vacancy,
      index,
      analysis: result,
      splitterVersion: VACANCY_SPLITTER_VERSION,
      evidenceText: localDetail
    };
  });
}
