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

const ATTACHMENT_TITLE_EXCLUDE = [
  /직무기술서/,
  /채용분야별\s*직무/,
  /NCS\s*직무/,
  /입사지원서/,
  /자기소개서/,
  /개인정보\s*수집/,
  /동의서/,
  /공고문\s*첨부/,
  /붙임\s*\d*/,
  /첨부파일/,
  /서식/,
  /양식/,
  /별첨/,
  /참고자료/,
  /채용공고문\s*다운로드/
];

const FILE_URL_EXCLUDE = [
  /\.hwp(?:x)?(?:\?|$)/i,
  /\.pdf(?:\?|$)/i,
  /\.docx?(?:\?|$)/i,
  /\.xlsx?(?:\?|$)/i,
  /\.zip(?:\?|$)/i,
  /fileDown/i,
  /download/i,
  /attach/i
];

function buildSearchUrl(org) {
  const params = new URLSearchParams({
    order: 'REG_DATE',
    org_name: org,
    search_yn: 'Y'
  });

  return `https://job.alio.go.kr/mobile2021/recruit/recruit.do?${params.toString()}`;
}

function isAttachmentLink(anchor) {
  return (
    ATTACHMENT_TITLE_EXCLUDE.some((pattern) => pattern.test(anchor.title)) ||
    FILE_URL_EXCLUDE.some((pattern) => pattern.test(anchor.url))
  );
}

function looksLikeRecruitDetailUrl(url) {
  return (
    /recruit/i.test(url) &&
    !FILE_URL_EXCLUDE.some((pattern) => pattern.test(url))
  );
}

function chooseRecruitAnchors(anchors) {
  const candidates = anchors.filter((anchor) => {
    if (isAttachmentLink(anchor)) return false;
    if (!looksLikeRecruitDetailUrl(anchor.url)) return false;
    if (!isRecruitmentTitle(anchor.title)) return false;
    return true;
  });

  const seen = new Set();
  return candidates.filter((anchor) => {
    const key = `${anchor.title}|${anchor.url}`
      .toLowerCase()
      .replace(/\s+/g, ' ');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectOrg(org) {
  const listUrl = buildSearchUrl(org);
  const html = await fetchText(listUrl);
  const anchors = chooseRecruitAnchors(extractAnchors(html, listUrl));

  const jobs = [];

  for (const anchor of anchors.slice(0, 20)) {
    let detailText = '';

    try {
      detailText = clean(await fetchText(anchor.url, 10000));
    } catch {
      // 상세페이지를 못 읽어도 공고 자체는 유지
    }

    // 상세페이지가 첨부파일 안내 페이지만 담고 있으면 제외
    if (
      ATTACHMENT_TITLE_EXCLUDE.some((pattern) => pattern.test(anchor.title)) ||
      (/직무기술서/.test(detailText) && !/접수기간|채용인원|지원자격|전형절차/.test(detailText))
    ) {
      continue;
    }

    const analysis = analyzeJob(anchor.title, detailText);

    jobs.push({
      org,
      title: anchor.title,
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
        'ALIO에 등록된 채용공고 본문입니다.',
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
