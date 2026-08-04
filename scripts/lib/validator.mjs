const LIST_OR_HOME = /(?:\/list(?:\.|\/|$)|\/index(?:\.|\/|$)|\/main(?:\.|\/|$)|\/home(?:\.|\/|$)|채용공고\s*목록|게시물\s*목록)/i;
const ERROR_TEXT = /404|not\s*found|페이지를\s*찾을\s*수|주소가\s*올바른지|존재하지\s*않는\s*페이지/i;
const CLOSED_TEXT = /접수\s*(?:마감|종료)|채용\s*마감|마감된\s*공고/i;
const EXCLUDED_TYPE = /인턴|기간제|계약직|위촉직|촉탁직|휴직대체|대체인력|단시간|일용직|아르바이트/i;

export const VALIDATOR_VERSION = '11.0.0';

export function validateJob(job = {}) {
  const errors = [], warnings = [];
  if (!job.org || !job.title) errors.push('기관 또는 제목 누락');
  if (!job.link) errors.push('원문 링크 누락');
  else {
    try {
      const url = new URL(job.link);
      if (!/^https?:$/.test(url.protocol)) errors.push('HTTP 원문 링크 아님');
      if (LIST_OR_HOME.test(url.pathname) && !url.search) errors.push('목록 또는 메인 링크');
    } catch { errors.push('원문 링크 형식 오류'); }
  }
  const raw = `${job.title || ''}\n${job.raw || ''}`;
  if (ERROR_TEXT.test(raw)) errors.push('오류 페이지 문구 포함');
  if (CLOSED_TEXT.test(raw)) errors.push('마감 문구 포함');
  if (EXCLUDED_TYPE.test(raw) || EXCLUDED_TYPE.test(job.employmentType || '')) errors.push('제외 고용형태 포함');
  if (job.eligibility !== '고졸 가능') errors.push('고졸 지원 확인 안 됨');
  if (job.location !== '울산') errors.push('울산 단일 근무 확인 안 됨');
  if (!['정규직', '무기계약직', '공무직', '일반직', '상용직'].includes(job.employmentType)) errors.push('허용 고용형태 아님');
  if (!job.deadline) warnings.push('마감일 미확인');
  if ((job.qualityScore || 0) < (job.qualityThreshold || 90)) errors.push('품질점수 미달');
  if (!job.detailChecked) errors.push('상세 원문 미검증');
  return { passed: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function runCollectionQA(jobs = []) {
  const issues = [];
  const seen = new Set();
  for (const job of jobs) {
    const validation = validateJob(job);
    if (!validation.passed) issues.push({ org: job.org, title: job.title, errors: validation.errors });
    const key = `${job.org}|${String(job.title).replace(/\s+/g, ' ').trim().toLowerCase()}`;
    if (seen.has(key)) issues.push({ org: job.org, title: job.title, errors: ['중복 공고'] });
    seen.add(key);
  }
  const counts = {};
  for (const issue of issues) for (const error of issue.errors) counts[error] = (counts[error] || 0) + 1;
  return { passed: issues.length === 0, checked: jobs.length, issueCount: issues.length, counts, issues: issues.slice(0, 100) };
}
