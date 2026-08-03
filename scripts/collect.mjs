import fs from 'node:fs/promises';

const SOURCES = [
  { org: '울산정보산업진흥원', url: 'https://uipa.or.kr/webuser/recruit/list.html' },
  { org: '울산테크노파크', url: 'https://www.utp.or.kr/' },
  { org: '울산시설공단', url: 'https://uic.or.kr/recruit/main/mainPage.do' },
  { org: '울산광역시 타기관소식', url: 'https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004001003000000' },
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

const POSITIVE = [
  /채용\s*공고/, /직원\s*채용/, /신입(?:사원|직원)?\s*채용/,
  /경력(?:사원|직원)?\s*채용/, /정규직\s*채용/,
  /무기계약직\s*채용/, /공무직\s*채용/,
  /기간제(?:근로자)?\s*(?:채용|모집)/,
  /체험형\s*인턴\s*(?:채용|모집)/,
  /채용형\s*인턴\s*(?:채용|모집)/,
  /계약직\s*(?:채용|모집)/, /근로자\s*(?:채용|모집)/
];

const EXCLUDE = [
  /사칭/, /주의/, /유의사항/, /보이스피싱/, /스미싱/,
  /합격자/, /최종합격/, /서류전형/, /필기전형/, /면접전형/,
  /면접대상/, /전형결과/, /결과발표/, /채용결과/,
  /예비합격/, /추가합격/, /합격취소/, /채용취소/,
  /설명회/, /박람회/, /상담회/, /채용정보 안내/,
  /채용사이트/, /채용 시스템/, /개인정보/,
  /입사지원서 작성/, /공지사항/, /보도자료/, /뉴스/,
  /인터뷰/, /홍보/, /교육생 모집/, /수강생 모집/,
  /참가자 모집/, /사업 참여기업 모집/, /지원사업/,
  /용역/, /입찰/
];

const clean = s => String(s || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const abs = (href, base) => {
  try { return new URL(href, base).href; }
  catch { return base; }
};

function validTitle(title) {
  if (!title || title.length < 6 || title.length > 180) return false;
  if (EXCLUDE.some(r => r.test(title))) return false;
  return POSITIVE.some(r => r.test(title));
}

function classify(text) {
  const high = /고졸|고등학교\s*졸업|학력\s*무관|학력제한\s*없|학력\s*제한\s*없/.test(text);
  const degree = /대졸\s*이상|학사\s*이상|전문학사\s*이상|석사\s*이상|박사\s*이상/.test(text);

  if (high && !degree) return { eligibility: '고졸 가능', score: 100, reasons: ['고졸 또는 학력무관 문구 확인'] };
  if (degree && !high) return { eligibility: '고졸 지원 어려움', score: 0, reasons: ['전문학사·학사 이상 조건 확인'] };
  return { eligibility: '학력 확인 필요', score: 40, reasons: ['상세 공고에서 학력 조건 확인 필요'] };
}

function parseHtml(html, source) {
  const jobs = [];
  const seen = new Set();

  for (const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = clean(a[2]);
    if (!validTitle(title)) continue;

    const k = `${source.org}|${title}`.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) continue;
    seen.add(k);

    const context = clean(html.slice(Math.max(0, a.index - 600), Math.min(html.length, a.index + a[0].length + 1200)));
    const c = classify(`${title} ${context}`);

    if (/울산|울주|새울/.test(context)) {
      c.score += 15;
      c.reasons.push('울산 근무 관련 문구');
    }

    jobs.push({
      org: source.org,
      title,
      link: abs(a[1], source.url),
      date: '',
      deadline: '',
      eligibility: c.eligibility,
      fitScore: Math.min(100, c.score),
      fitReasons: [...new Set(c.reasons)],
      raw: context.slice(0, 900)
    });

    if (jobs.length >= 20) break;
  }

  return jobs;
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const r = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/4.0)',
        'accept-language': 'ko-KR,ko;q=0.9'
      }
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    return { ok: true, source, jobs: parseHtml(await r.text(), source) };
  } catch (e) {
    return {
      ok: false,
      source,
      jobs: [],
      error: e.name === 'AbortError' ? 'timeout' : e.message
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(SOURCES.map(fetchSource));
const jobs = [];
const seen = new Set();
const sources = [];

for (const result of results) {
  sources.push({
    org: result.source.org,
    ok: result.ok,
    count: result.jobs.length,
    error: result.error || ''
  });

  for (const job of result.jobs) {
    const k = `${job.org}|${job.title}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(k)) continue;
    seen.add(k);
    jobs.push(job);
  }
}

jobs.sort((a, b) => b.fitScore - a.fitScore);

const payload = {
  version: '4.0-accuracy',
  updatedAt: new Date().toISOString(),
  jobs: jobs.slice(0, 200),
  sources,
  stats: {
    sourceCount: SOURCES.length,
    success: sources.filter(s => s.ok).length,
    total: jobs.length,
    highSchoolSuitable: jobs.filter(j => j.eligibility === '고졸 가능').length
  }
};

await fs.writeFile('data/jobs.json', JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(payload.stats);
