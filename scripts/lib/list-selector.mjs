import {
  NON_JOB_PATTERNS,
  EXCLUDED_EMPLOYMENT_PATTERNS,
  LICENSE_JOB_PATTERNS
} from './rules.mjs';

export const LIST_SELECTOR_VERSION = '2026-08-06.1-phase5-list-selection';

const RECRUITMENT_SIGNAL = /채용(?:\s*(?:공고|계획|안내|모집)|\s*공개\s*모집|\s*공개채용)|직원\s*(?:공개\s*)?채용|신입(?:사원|직원)?(?:\s*공개)?\s*채용|경력(?:사원|직원)?(?:\s*공개)?\s*채용|정규직\s*(?:공개\s*)?채용|무기계약직\s*(?:공개\s*)?채용|공무직\s*(?:근로자)?\s*(?:공개\s*)?채용|근로자\s*(?:채용|모집)|인력\s*(?:채용|모집)|직원\s*모집/;
const STAGE_NOISE = /(?:최종|예비|추가)?합격자|합격자\s*명단|서류(?:전형|심사)|필기(?:전형|시험)|면접(?:전형|시험)|AI\s*역량검사|체력검정|시험\s*실시|접수현황|지원현황|경쟁률|전형결과|결과발표|시험장소/;
const CLOSED_SIGNAL = /접수(?:가|는)?\s*(?:마감|종료)|채용\s*마감|마감된\s*공고|모집\s*마감|\/\s*마감(?:\s|$)/;
const TARGET_EMPLOYMENT_SIGNAL = /정규직|무기계약직|공무직|일반직|상용직/;
const TARGET_EDUCATION_SIGNAL = /고졸|고등학교\s*졸업|학력\s*무관|학력\s*(?:제한|제한사항)\s*(?:없음|없)|학력제한\s*없/;
const TARGET_LOCATION_SIGNAL = /울산(?:광역시)?|울주군|새울/;

const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));

function normalizeText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function selectListCandidate(candidate = {}) {
  const title = normalizeText(candidate.title);
  const listText = normalizeText(candidate.listText);
  const combined = `${title} ${listText}`.trim();
  const reasons = [];
  const signals = [];

  if (!title || title.length < 6) reasons.push('제목이 없거나 너무 짧음');
  if (title.length > 220) reasons.push('제목이 비정상적으로 김');
  if (title && !RECRUITMENT_SIGNAL.test(title)) reasons.push('채용공고 제목 신호 없음');
  if (STAGE_NOISE.test(title)) reasons.push('채용 전형·결과 안내');
  if (matchesAny(title, NON_JOB_PATTERNS)) reasons.push('채용공고가 아닌 공지·안내');
  if (matchesAny(title, EXCLUDED_EMPLOYMENT_PATTERNS)) reasons.push('인턴·계약직 등 제외 고용형태가 제목에 명시됨');
  if (matchesAny(title, LICENSE_JOB_PATTERNS)) reasons.push('전문면허 직무가 제목에 명시됨');
  if (CLOSED_SIGNAL.test(combined)) reasons.push('목록에 마감 문구가 명시됨');

  if (TARGET_EMPLOYMENT_SIGNAL.test(combined)) signals.push('대상 고용형태 신호');
  if (TARGET_EDUCATION_SIGNAL.test(combined)) signals.push('고졸 가능 신호');
  if (TARGET_LOCATION_SIGNAL.test(combined)) signals.push('울산 근무 신호');
  if (/채용|모집/.test(title)) signals.push('채용 제목 신호');

  return {
    accepted: reasons.length === 0,
    reasons: [...new Set(reasons)],
    signals: [...new Set(signals)],
    selectorVersion: LIST_SELECTOR_VERSION
  };
}

export function selectListCandidates(candidates = []) {
  const accepted = [];
  const rejected = [];
  const reasonCounts = {};
  for (const candidate of candidates) {
    const decision = selectListCandidate(candidate);
    const decorated = { ...candidate, listSelection: decision };
    if (decision.accepted) accepted.push(decorated);
    else {
      rejected.push(decorated);
      for (const reason of decision.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  return {
    accepted,
    rejected,
    reasonCounts,
    stats: { input: candidates.length, accepted: accepted.length, rejected: rejected.length },
    selectorVersion: LIST_SELECTOR_VERSION
  };
}
