import fs from 'node:fs/promises';
import { cleanHtml, fetchDetail } from './lib/detail-parser.mjs';
import { extractCandidatesForSource, canonicalJobUrl } from './collectors/source-adapters.mjs';
import { extractAlioCandidates } from './collectors/alio-adapter.mjs';
import { analyzeJob } from './lib/classifier.mjs';
import { NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS, RULES_VERSION } from './lib/rules.mjs';

const SOURCES = [
  { org: '울산정보산업진흥원', url: 'https://uipa.or.kr/webuser/recruit/list.html', detail: true, requireValidDetail: true },
  { org: '울산테크노파크', url: 'https://www.utp.or.kr/', detail: true, requireValidDetail: true },
  { org: '울산시설공단', url: 'https://uic.or.kr/notify/noti06.do', detail: true, requireValidDetail: true },
  { org: '울산광역시 타기관소식', url: 'https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004001003000000', detail: true, requireValidDetail: true },
  { org: '한국동서발전', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EB%8F%99%EC%84%9C%EB%B0%9C%EC%A0%84&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '한국석유공사', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%84%9D%EC%9C%A0%EA%B3%B5%EC%82%AC&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '한국에너지공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%97%90%EB%84%88%EC%A7%80%EA%B3%B5%EB%8B%A8&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '한국산업인력공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%82%B0%EC%97%85%EC%9D%B8%EB%A0%A5%EA%B3%B5%EB%8B%A8&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '근로복지공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%EA%B7%BC%EB%A1%9C%EB%B3%B5%EC%A7%80%EA%B3%B5%EB%8B%A8&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '한국산업안전보건공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%82%B0%EC%97%85%EC%95%88%EC%A0%84%EB%B3%B4%EA%B1%B4%EA%B3%B5%EB%8B%A8&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '울산항만공사', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%EC%9A%B8%EC%82%B0%ED%95%AD%EB%A7%8C%EA%B3%B5%EC%82%AC&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '한국전력공사', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%A0%84%EB%A0%A5%EA%B3%B5%EC%82%AC&search_yn=Y', detail: true, alio: true, requireValidDetail: true },
  { org: '한국수력원자력', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%88%98%EB%A0%A5%EC%9B%90%EC%9E%90%EB%A0%A5&search_yn=Y', detail: true, alio: true }
];

const POSITIVE = /채용\s*공고|직원\s*채용|신입(?:사원|직원)?\s*채용|경력(?:사원|직원)?\s*채용|정규직\s*채용|무기계약직\s*채용|공무직\s*채용|근로자\s*(?:채용|모집)/;
const RECRUITMENT_STAGE_NOISE = /(?:최종|예비|추가)?합격자|합격자\s*명단|서류(?:전형|심사)|필기(?:전형|시험)|면접(?:전형|시험)|AI\s*역량검사|체력검정|시험\s*실시|접수현황|지원현황|경쟁률|전형결과|결과발표|채용절차|전형일정|시험장소/;
const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));
const pad = value => String(value).padStart(2, '0');
const STRICT_TARGET_ONLY = true;

function validTitle(title) {
  if (!title || title.length < 6 || title.length > 220) return false;
  if (!POSITIVE.test(title)) return false;
  if (RECRUITMENT_STAGE_NOISE.test(title)) return false;
  if (matchesAny(title, NON_JOB_PATTERNS)) return false;
  if (matchesAny(title, EXCLUDED_EMPLOYMENT_PATTERNS)) return false;
  if (matchesAny(title, LICENSE_JOB_PATTERNS)) return false;
  return true;
}

function normalizeTitleForDedup(title = '') {
  return String(title)
    .replace(/\[(?:수정|변경|재공고|재재공고)\]/g, ' ')
    .replace(/\((?:수정|변경|재공고|재재공고)\)/g, ' ')
    .replace(/(?:수정|변경|재재?공고)/g, ' ')
    .replace(/제?\d+차/g, ' ')
    .replace(/\d{4}[-.년\s]*\d{0,2}[-.월\s]*\d{0,2}일?/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function revisionRank(title = '') {
  if (/재재공고/.test(title)) return 4;
  if (/재공고/.test(title)) return 3;
  if (/수정|변경/.test(title)) return 2;
  return 1;
}

function choosePreferredJob(current, candidate) {
  if (!current) return candidate;
  const currentRank = revisionRank(current.title);
  const candidateRank = revisionRank(candidate.title);
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;

  const currentDeadline = current.deadline || '';
  const candidateDeadline = candidate.deadline || '';
  if (candidateDeadline !== currentDeadline) return candidateDeadline > currentDeadline ? candidate : current;

  if (candidate.detailChecked !== current.detailChecked) return candidate.detailChecked ? candidate : current;
  return candidate.fitScore > current.fitScore ? candidate : current;
}

function parseDateValue(yearText, monthText, dayText, referenceYear = new Date().getFullYear()) {
  let year = Number(yearText);
  if (!yearText) year = referenceYear;
  else if (year < 100) year += 2000;
  const month = Number(monthText), day = Number(dayText);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function extractDeadline(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ');
  const range = normalized.match(/(?:20)?(\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\s*~\s*(?:20)?(\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (range) {
    const date = parseDateValue(range[4], range[5], range[6]);
    return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
  }
  const until = normalized.match(/(?:접수|지원|제출|원서접수)[^\n]{0,120}?(?:(20\d{2}|\d{2})[.\-/년]\s*)?(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?[^\n]{0,30}?(?:까지|마감|종료)/);
  if (until) {
    const date = parseDateValue(until[1], until[2], until[3]);
    if (date) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const labeled = [...normalized.matchAll(/(?:접수(?:기간|마감)?|마감(?:일)?|공고기간)\s*[:：]?[^\n]{0,100}?(?:(20\d{2}|\d{2})[.\-/년]\s*)?(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?/g)];
  if (!labeled.length) return '';
  const match = labeled.at(-1);
  const date = parseDateValue(match[1], match[2], match[3]);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

function isExpired(deadline) {
  if (!deadline) return false;
  const end = new Date(`${deadline}T23:59:59+09:00`);
  const now = new Date();
  return end.getTime() < now.getTime();
}

function extractListCandidates(html, source) {
  const helpers = { validTitle, normalizeTitleForDedup };
  if (source.alio) return extractAlioCandidates(html, source, helpers);
  return extractCandidatesForSource(html, source, helpers);
}

async function fetchHtml(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/7.0-target-accuracy)',
        'accept-language': 'ko-KR,ko;q=0.9'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

async function enrichCandidate(candidate, source) {
  let detail = { ok: false, finalUrl: candidate.link, text: '', attachments: [], error: 'detail disabled' };
  if (source.detail) {
    const sourceHost = new URL(source.url).hostname;
    detail = await fetchDetail(candidate.link, {
      expectedTitle: candidate.title,
      sourceOrg: source.org,
      allowedHosts: source.alio ? ['job.alio.go.kr', 'alio.go.kr'] : [sourceHost]
    });
  }
  if (source.requireValidDetail && !detail.ok) return null;
  const analysisText = `${candidate.title}\n${candidate.listText}\n${detail.text}`;
  const deadline = extractDeadline(analysisText);
  if (isExpired(deadline) || /접수(?:가|는)?\s*(?:마감|종료)|채용\s*마감|마감된\s*공고|\/\s*마감(?:\s|$)/.test(analysisText)) return null;

  const result = analyzeJob({
    title: candidate.title,
    listText: candidate.listText,
    detailText: detail.text,
    detailOk: detail.ok
  });
  if (result.excluded || (STRICT_TARGET_ONLY && !result.recommended)) return null;

  return {
    org: candidate.org,
    title: candidate.title,
    link: canonicalJobUrl(detail.finalUrl || candidate.link),
    date: '',
    deadline,
    employmentType: result.employmentType,
    eligibility: result.eligibility,
    location: result.location,
    status: result.status,
    recommended: result.recommended,
    fitScore: result.fitScore,
    fitReasons: result.fitReasons,
    excludeReasons: result.excludeReasons,
    detailChecked: detail.ok,
    detailConfidence: detail.confidence || null,
    detailError: detail.error || '',
    attachments: detail.attachments,
    raw: (detail.text || candidate.listText).slice(0, 3000)
  };
}

async function fetchSource(source) {
  try {
    let html = '';
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try { html = await fetchHtml(source.url, attempt === 1 ? 15000 : 25000); break; }
      catch (error) { lastError = error; if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 800)); }
    }
    if (!html) throw lastError || new Error('empty source html');
    const candidates = extractListCandidates(html, source);
    const jobs = [];
    for (const candidate of candidates) {
      const job = await enrichCandidate(candidate, source);
      if (job) jobs.push(job);
    }
    return {
      ok: true, source, jobs, candidates: candidates.length,
      rejected: Math.max(0, candidates.length - jobs.length),
      detailFailures: candidates.length - jobs.filter(job => job.detailChecked).length
    };
  } catch (error) {
    return { ok: false, source, jobs: [], candidates: 0, error: error.name === 'AbortError' ? 'timeout' : error.message };
  }
}

const results = await Promise.all(SOURCES.map(fetchSource));
const dedupedJobs = new Map(), sources = [];
for (const result of results) {
  sources.push({
    org: result.source.org, ok: result.ok, candidates: result.candidates,
    count: result.jobs.length, rejected: result.rejected || 0,
    detailFailures: result.detailFailures || 0, error: result.error || ''
  });
  for (const job of result.jobs) {
    const normalizedTitle = normalizeTitleForDedup(job.title) || job.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const key = `${job.org}|${normalizedTitle}`;
    dedupedJobs.set(key, choosePreferredJob(dedupedJobs.get(key), job));
  }
}
const jobs = [...dedupedJobs.values()];

const successfulSources = sources.filter(source => source.ok).length;
if (successfulSources === 0) {
  throw new Error('모든 수집 출처가 실패하여 기존 data/jobs.json을 유지합니다.');
}

jobs.sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.fitScore - a.fitScore || (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'));
const payload = {
  version: '7.0-target-accuracy', rulesVersion: RULES_VERSION, updatedAt: new Date().toISOString(),
  jobs: jobs.slice(0, 200), sources,
  stats: {
    sourceCount: SOURCES.length,
    success: successfulSources,
    total: jobs.length,
    recommended: jobs.filter(job => job.recommended).length,
    highSchoolSuitable: jobs.filter(job => job.eligibility === '고졸 가능').length,
    detailChecked: jobs.filter(job => job.detailChecked).length,
    reviewNeeded: jobs.filter(job => job.status === '확인 필요').length,
    sourceRejected: sources.reduce((sum, source) => sum + (source.rejected || 0), 0),
    sourceDetailFailures: sources.reduce((sum, source) => sum + (source.detailFailures || 0), 0)
  },
  note: '고졸 지원 가능·울산 단일 근무·정규직 계열·접수 가능 상태가 원문에서 모두 확인된 공고만 저장합니다.'
};
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/jobs.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(payload.stats);
