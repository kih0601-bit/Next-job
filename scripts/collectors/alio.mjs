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

const PROFESSIONAL_EXCLUDE = [
  /의사/,
  /전문의/,
  /전공의/,
  /간호사/,
  /약사/,
  /한의사/,
  /치과의사/,
  /수의사/,
  /변호사/,
  /회계사/,
  /노무사/,
  /교수/,
  /박사/,
  /석사\s*(?:필수|이상)/,
  /연구직/,
  /연구원/,
  /임상/,
  /진단검사/,
  /방사선사/,
  /물리치료사/,
  /작업치료사/
];

const ULSAN_REQUIRED = /울산|울주|새울|울산본부|울산지사|울산사업소|울산항/;

const HIGH_SCHOOL_REQUIRED =
  /고졸|고등학교\s*(?:졸업|졸업예정)|학력\s*무관|학력\s*제한\s*없|학력제한\s*없/;

const DEGREE_EXCLUDE =
  /전문학사\s*이상|대졸\s*이상|학사\s*이상|석사\s*이상|박사\s*이상|4년제\s*대학/;

const STABLE_EMPLOYMENT_REQUIRED =
  /정규직|무기계약직|공무직|채용형\s*인턴/;

const UNSTABLE_EMPLOYMENT_EXCLUDE =
  /체험형\s*인턴|기간제|단기계약|일용직|촉탁직/;

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

function isTargetJob(title, detailText) {
  const combined = `${title} ${detailText}`;

  if (PROFESSIONAL_EXCLUDE.some((pattern) => pattern.test(combined))) {
    return false;
  }

  if (!ULSAN_REQUIRED.test(combined)) {
    return false;
  }

  if (!HIGH_SCHOOL_REQUIRED.test(combined)) {
    return false;
  }

  if (DEGREE_EXCLUDE.test(combined)) {
    return false;
  }

  if (!STABLE_EMPLOYMENT_REQUIRED.test(combined)) {
    return false;
  }

  if (UNSTABLE_EMPLOYMENT_EXCLUDE.test(combined)) {
    return false;
  }

  return true;
}

async function collectOrg(org) {
  const listUrl = buildSearchUrl(org);
  const html = await fetchText(listUrl);
  const anchors = chooseRecruitAnchors(extractAnchors(html, listUrl));

  const jobs = [];

  for (const anchor of anchors.slice(0, 25)) {
    let detailText = '';

    try {
      detailText = clean(await fetchText(anchor.url, 10000));
    } catch {
      // 상세본문을 확인하지 못하면 조건 검증이 불가능하므로 저장하지 않는다.
      continue;
    }

    if (
      /직무기술서/.test(detailText) &&
      !/접수기간|채용인원|지원자격|전형절차/.test(detailText)
    ) {
      continue;
    }

    if (!isTargetJob(anchor.title, detailText)) {
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
      eligibility: '고졸 가능',
      fitScore: 100,
      fitReasons: [
        '고졸 또는 학력무관 명시',
        '울산 근무 명시',
        '정규직·무기계약직·공무직·채용형 인턴'
      ],
      employmentType: analysis.employmentType,
      location: '울산',
      summary: [
        'ALIO에 등록된 실제 채용공고입니다.',
        '고졸 또는 학력무관 지원 가능 조건이 확인됩니다.',
        '울산 근무 조건이 확인됩니다.',
        `고용형태: ${analysis.employmentType}`
      ],
      raw: detailText.slice(0, 1800)
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
