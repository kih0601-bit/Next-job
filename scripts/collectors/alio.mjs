import { clean, fetchText, extractAnchors } from '../lib/utils.mjs';
import { isRecruitmentTitle, analyzeJob } from '../lib/normalize.mjs';

const ALIO_ORGS = [
  '한국동서발전',
  '한국석유공사',
  '한국에너지공단',
  '한국산업인력공단',
  '근로복지공단',
  '한국산업안전보건공단',
  '울산항만공사',
  '한국전력공사',
  '한국수력원자력'
];

function buildSearchUrl(org) {
  const params = new URLSearchParams({
    order: 'REG_DATE',
    org_name: org,
    search_yn: 'Y'
  });

  return `https://job.alio.go.kr/mobile2021/recruit/recruit.do?${params.toString()}`;
}

async function collectOrg(org) {
  const listUrl = buildSearchUrl(org);
  const html = await fetchText(listUrl);
  const anchors = extractAnchors(html, listUrl);

  const jobs = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const title = clean(anchor.title);
    if (!isRecruitmentTitle(title)) continue;

    const key = title.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);

    let detailText = '';
    try {
      detailText = clean(await fetchText(anchor.url, 10000));
    } catch {
      // 상세 페이지가 막혀도 목록 제목은 유지한다.
    }

    const analysis = analyzeJob(title, detailText);

    jobs.push({
      org,
      title,
      link: anchor.url,
      sourceType: 'ALIO',
      date: '',
      deadline: '',
      eligibility: analysis.eligibility,
      fitScore: analysis.fitScore,
      fitReasons: analysis.fitReasons,
      employmentType: analysis.employmentType,
      location: analysis.location,
      summary: [
        'ALIO에 등록된 실제 채용공고입니다.',
        analysis.eligibility === '고졸 가능'
          ? '고졸 또는 학력무관 지원 가능 문구가 확인됩니다.'
          : analysis.eligibility === '고졸 지원 어려움'
            ? '전문학사·학사 이상 조건이 확인됩니다.'
            : '학력 조건은 원문 확인이 필요합니다.',
        `고용형태: ${analysis.employmentType}`,
        `근무지: ${analysis.location}`
      ],
      raw: detailText.slice(0, 1600)
    });

    if (jobs.length >= 20) break;
  }

  return {
    org,
    ok: true,
    count: jobs.length,
    jobs,
    error: ''
  };
}

export async function collectAlio() {
  const settled = await Promise.allSettled(ALIO_ORGS.map(collectOrg));

  const jobs = [];
  const sources = [];

  settled.forEach((result, index) => {
    const org = ALIO_ORGS[index];

    if (result.status === 'fulfilled') {
      sources.push({
        org,
        sourceType: 'ALIO',
        ok: true,
        count: result.value.count,
        error: ''
      });
      jobs.push(...result.value.jobs);
      return;
    }

    sources.push({
      org,
      sourceType: 'ALIO',
      ok: false,
      count: 0,
      error: String(result.reason || 'unknown error')
    });
  });

  return { jobs, sources };
}
