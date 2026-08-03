import fs from 'node:fs/promises';

const SOURCES = [
  { org: '울산정보산업진흥원', url: 'https://uipa.or.kr/webuser/recruit/list.html' },
  { org: '울산테크노파크', url: 'https://www.utp.or.kr/' },
  { org: '울산시설공단', url: 'https://uic.or.kr/recruit/main/mainPage.do' },
  { org: '한국동서발전', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EB%8F%99%EC%84%9C%EB%B0%9C%EC%A0%84&search_yn=Y' },
  { org: '한국석유공사', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%84%9D%EC%9C%A0%EA%B3%B5%EC%82%AC&search_yn=Y' },
  { org: '한국에너지공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%97%90%EB%84%88%EC%A7%80%EA%B3%B5%EB%8B%A8&search_yn=Y' },
  { org: '한국산업인력공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%82%B0%EC%97%85%EC%9D%B8%EB%A0%A5%EA%B3%B5%EB%8B%A8&search_yn=Y' },
  { org: '근로복지공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%EA%B7%BC%EB%A1%9C%EB%B3%B5%EC%A7%80%EA%B3%B5%EB%8B%A8&search_yn=Y' },
  { org: '한국산업안전보건공단', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%82%B0%EC%97%85%EC%95%88%EC%A0%84%EB%B3%B4%EA%B1%B4%EA%B3%B5%EB%8B%A8&search_yn=Y' },
  { org: '울산항만공사', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%EC%9A%B8%EC%82%B0%ED%95%AD%EB%A7%8C%EA%B3%B5%EC%82%AC&search_yn=Y' },
  { org: '한국전력공사', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%A0%84%EB%A0%A5%EA%B3%B5%EC%82%AC&search_yn=Y' },
  { org: '한국수력원자력', url: 'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%88%98%EB%A0%A5%EC%9B%90%EC%9E%90%EB%A0%A5&search_yn=Y' }
];

const RECRUIT_REQUIRED = [
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
  /일반직\s*(?:직원)?\s*(?:공개)?채용/,
  /전문직\s*(?:직원)?\s*(?:공개)?채용/,
  /별정직\s*(?:직원)?\s*(?:공개)?채용/,
  /채용\s*공고/
];

const HARD_EXCLUDE = [
  /R\s*&\s*D/i, /연구개발\s*과제/, /과제\s*(?:기획|공고|모집)/,
  /구축사업/, /지원사업/, /사업\s*공고/, /사업자\s*모집/,
  /수요기업/, /참여기업/, /입주기업/, /기업\s*모집/,
  /기업지원/, /컨설팅/, /용역/, /입찰/, /제안서/,
  /공모전/, /공모사업/, /수행기관/, /수행기업/,
  /교육생/, /수강생/, /참가자/, /참여자/,
  /설명회/, /박람회/, /세미나/, /포럼/,
  /기술개발/, /실증사업/, /지원대상/,
  /사칭/, /보이스피싱/, /스미싱/, /주의사항/,
  /합격자/, /최종합격/, /서류전형/, /필기전형/,
  /면접전형/, /면접대상/, /전형결과/, /결과발표/,
  /채용결과/, /예비합격/, /추가합격/,
  /개인정보/, /보도자료/, /뉴스/, /홍보/
];

const clean = (value) =>
  String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const absoluteUrl = (href, base) => {
  try { return new URL(href, base).href; }
  catch { return base; }
};

function isActualRecruitment(title, context = '') {
  const combined = `${title} ${context}`;

  if (!title || title.length < 7 || title.length > 180) return false;
  if (HARD_EXCLUDE.some((pattern) => pattern.test(combined))) return false;
  if (!RECRUIT_REQUIRED.some((pattern) => pattern.test(title))) return false;

  // '모집'만 있고 직원·근로자·인턴·채용 표현이 없으면 제외
  if (/모집/.test(title) && !/(직원|근로자|사원|인턴|채용|공무직|계약직|정규직)/.test(title)) {
    return false;
  }

  return true;
}

function extractDate(text) {
  const candidates = [...text.matchAll(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/g)];
  if (!candidates.length) return '';

  const match = candidates[candidates.length - 1];
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function extractEligibility(text) {
  const highSchool = /고졸|고등학교\s*(?:졸업|졸업예정)|학력\s*무관|학력\s*제한\s*없/.test(text);
  const degreeRequired = /전문학사\s*이상|대졸\s*이상|학사\s*이상|석사\s*이상|박사\s*이상|4년제\s*대학/.test(text);

  if (highSchool && !degreeRequired) {
    return {
      eligibility: '고졸 가능',
      score: 100,
      reasons: ['고졸 또는 학력무관 문구 확인']
    };
  }

  if (degreeRequired && !highSchool) {
    return {
      eligibility: '고졸 지원 어려움',
      score: 0,
      reasons: ['전문학사·학사 이상 조건 확인']
    };
  }

  return {
    eligibility: '학력 확인 필요',
    score: 30,
    reasons: ['상세 공고의 학력 조건 확인 필요']
  };
}

function buildSummary(title, text, eligibility, deadline) {
  const lines = [];

  lines.push(`실제 직원 채용공고로 분류된 공고입니다.`);
  lines.push(
    eligibility === '고졸 가능'
      ? '고졸 또는 학력무관 지원 가능 문구가 확인됩니다.'
      : eligibility === '고졸 지원 어려움'
        ? '전문학사·학사 이상 조건이 확인됩니다.'
        : '학력 조건은 상세 공고 확인이 필요합니다.'
  );

  if (/울산|울주|새울/.test(text)) lines.push('울산 근무 관련 문구가 확인됩니다.');
  if (/정규직|무기계약직|채용형\s*인턴/.test(text)) lines.push('정규직 계열 고용형태 표현이 확인됩니다.');
  if (deadline) lines.push(`확인된 날짜: ${deadline}`);

  return lines.slice(0, 4);
}

function parseListPage(html, source) {
  const jobs = [];
  const seen = new Set();

  for (const anchor of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = clean(anchor[2]);
    const nearby = clean(
      html.slice(
        Math.max(0, anchor.index - 500),
        Math.min(html.length, anchor.index + anchor[0].length + 900)
      )
    );

    if (!isActualRecruitment(title, nearby)) continue;

    const key = `${source.org}|${title}`.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);

    const eligibility = extractEligibility(`${title} ${nearby}`);
    const deadline = extractDate(nearby);
    let score = eligibility.score;

    if (/울산|울주|새울/.test(nearby)) score += 15;
    if (/정규직|무기계약직|채용형\s*인턴/.test(nearby)) score += 10;
    if (/신입|경력\s*무관/.test(nearby)) score += 5;

    jobs.push({
      org: source.org,
      title,
      link: absoluteUrl(anchor[1], source.url),
      date: '',
      deadline,
      eligibility: eligibility.eligibility,
      fitScore: Math.min(100, Math.max(0, score)),
      fitReasons: eligibility.reasons,
      summary: buildSummary(title, nearby, eligibility.eligibility, deadline),
      raw: nearby.slice(0, 900)
    });

    if (jobs.length >= 15) break;
  }

  return jobs;
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/5.0)',
        'accept-language': 'ko-KR,ko;q=0.9'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    return {
      ok: true,
      source,
      jobs: parseListPage(html, source)
    };
  } catch (error) {
    return {
      ok: false,
      source,
      jobs: [],
      error: error.name === 'AbortError' ? 'timeout' : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(SOURCES.map(fetchSource));
const jobs = [];
const globalSeen = new Set();
const sources = [];

for (const result of results) {
  sources.push({
    org: result.source.org,
    ok: result.ok,
    count: result.jobs.length,
    error: result.error || ''
  });

  for (const job of result.jobs) {
    const key = `${job.org}|${job.title}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (globalSeen.has(key)) continue;

    // 저장 직전 최종 방어 필터
    if (!isActualRecruitment(job.title, job.raw)) continue;

    globalSeen.add(key);
    jobs.push(job);
  }
}

jobs.sort((a, b) => {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.org.localeCompare(b.org, 'ko');
});

const payload = {
  version: '5.0-strict',
  updatedAt: new Date().toISOString(),
  jobs: jobs.slice(0, 150),
  sources,
  stats: {
    sourceCount: SOURCES.length,
    success: sources.filter((source) => source.ok).length,
    total: jobs.length,
    highSchoolSuitable: jobs.filter((job) => job.eligibility === '고졸 가능').length,
    degreeRequired: jobs.filter((job) => job.eligibility === '고졸 지원 어려움').length,
    reviewNeeded: jobs.filter((job) => job.eligibility === '학력 확인 필요').length
  },
  note: 'R&D·사업·과제·입찰·기업모집·교육·행사·합격자 공지는 저장 전에 강제 제외합니다.'
};

await fs.writeFile('data/jobs.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(payload.stats, null, 2));
