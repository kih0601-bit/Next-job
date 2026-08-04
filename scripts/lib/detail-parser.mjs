const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/4.2-detail-parser)',
  'accept-language': 'ko-KR,ko;q=0.9'
};

const clean = value => String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

const absoluteUrl = (href, base) => {
  try { return new URL(href, base).href; }
  catch { return ''; }
};

function parseKoreanDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractRecruitmentPeriod(text) {
  const normalized = clean(text);
  const range = normalized.match(/기간\s*[:：]?\s*(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?(?:\s+\d{1,2}:\d{2})?\s*[~～-]\s*(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?(?:\s+\d{1,2}:\d{2})?/);
  if (!range) return { startDate: '', deadline: '' };
  return {
    startDate: parseKoreanDate(range[1], range[2], range[3]),
    deadline: parseKoreanDate(range[4], range[5], range[6])
  };
}

function extractAttachments(html, baseUrl) {
  const attachments = [];
  const seen = new Set();

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    const name = clean(match[2]) || decodeURIComponent(url.split('/').pop() || '');
    if (!url || seen.has(url)) continue;
    if (!/\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])/i.test(url) && !/첨부|다운로드|file/i.test(`${name} ${url}`)) continue;
    seen.add(url);
    attachments.push({ name, url, type: (url.match(/\.([a-z0-9]+)(?:$|[?#])/i)?.[1] || 'file').toLowerCase() });
  }

  for (const match of html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url || seen.has(url)) continue;
    if (!/\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(url)) continue;
    if (!/recruit|upload|board|attach|file|editor/i.test(url)) continue;
    seen.add(url);
    attachments.push({ name: decodeURIComponent(url.split('/').pop() || '공고 이미지'), url, type: 'image' });
  }

  return attachments;
}

function extractSignals(text) {
  const reasons = [];
  const normalized = clean(text);

  const highSchool = /고졸|고등학교\s*졸업|학력\s*무관|학력\s*제한\s*(?:없음|없다|없)|학력제한\s*없/.test(normalized);
  const degreeRequired = /전문학사\s*이상|학사\s*이상|대졸\s*이상|석사\s*이상|박사\s*이상|4년제\s*대학\s*졸업/.test(normalized);
  const medicalLicense = /의사|치과의사|한의사|약사|간호사|간호조무사|물리치료사|작업치료사|방사선사|임상병리사/.test(normalized);

  let eligibility = '학력 확인 필요';
  if (highSchool && !degreeRequired) {
    eligibility = '고졸 가능';
    reasons.push('상세 페이지에서 고졸 또는 학력무관 문구 확인');
  } else if (degreeRequired && !highSchool) {
    eligibility = '고졸 지원 어려움';
    reasons.push('상세 페이지에서 전문학사·학사 이상 조건 확인');
  }

  let employmentType = '고용형태 확인 필요';
  if (/무기계약직/.test(normalized)) employmentType = '무기계약직';
  else if (/공무직/.test(normalized)) employmentType = '공무직';
  else if (/정규직/.test(normalized)) employmentType = '정규직';
  else if (/기간제|계약직|인턴/.test(normalized)) employmentType = '제외 고용형태';

  if (employmentType !== '고용형태 확인 필요') reasons.push(`상세 페이지에서 ${employmentType} 문구 확인`);
  if (medicalLicense) reasons.push('의료·면허 직무 문구 확인');

  return { eligibility, employmentType, medicalLicense, reasons };
}

export async function fetchDetailPage(url, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: DEFAULT_HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const text = clean(html);
    const period = extractRecruitmentPeriod(html);
    const attachments = extractAttachments(html, url);
    const signals = extractSignals(text);
    const supportLinkMatch = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .find(m => /지원하기|입사지원/.test(clean(m[2])));

    return {
      ok: true,
      url,
      text,
      attachments,
      supportLink: supportLinkMatch ? absoluteUrl(supportLinkMatch[1], url) : '',
      ...period,
      ...signals
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
      text: '',
      attachments: [],
      supportLink: '',
      startDate: '',
      deadline: '',
      eligibility: '학력 확인 필요',
      employmentType: '고용형태 확인 필요',
      medicalLicense: false,
      reasons: ['상세 페이지 판독 실패']
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseUipaList(html, source) {
  const jobs = [];
  const seen = new Set();

  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = row[1];
    const anchor = rowHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;

    const title = clean(anchor[2]);
    const rowText = clean(rowHtml);
    if (!/채용\s*공고/.test(title) || /합격자|서류전형|필기전형|면접전형|최종합격/.test(title)) continue;
    if (/종료/.test(rowText) && !/진행/.test(rowText)) continue;

    const link = absoluteUrl(anchor[1], source.url);
    if (!link || seen.has(link)) continue;
    seen.add(link);

    const posted = rowText.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    jobs.push({
      org: source.org,
      title,
      link,
      date: posted ? parseKoreanDate(posted[1], posted[2], posted[3]) : '',
      deadline: '',
      employmentType: '고용형태 확인 필요',
      eligibility: '학력 확인 필요',
      fitScore: 0,
      fitReasons: ['상세 페이지 판독 대기'],
      raw: rowText.slice(0, 900),
      detailChecked: false,
      attachments: []
    });
  }

  return jobs;
}

export function mergeDetail(job, detail) {
  const deadline = detail.deadline || job.deadline || '';
  const reasons = [...new Set([...(detail.reasons || []), ...(job.fitReasons || []).filter(r => !/판독 대기/.test(r))])];
  let fitScore = 0;

  if (detail.eligibility === '고졸 가능') fitScore += 60;
  if (['정규직', '무기계약직', '공무직'].includes(detail.employmentType)) fitScore += 25;
  if (/울산정보산업진흥원|울산광역시/.test(`${job.org} ${detail.text}`)) fitScore += 15;
  if (detail.medicalLicense || detail.employmentType === '제외 고용형태') fitScore = 0;

  return {
    ...job,
    link: detail.supportLink || job.link,
    detailLink: job.link,
    deadline,
    employmentType: detail.employmentType,
    eligibility: detail.eligibility,
    fitScore: Math.min(100, fitScore),
    fitReasons: reasons.length ? reasons : ['상세 페이지에서 조건을 명확히 확인하지 못함'],
    raw: detail.text.slice(0, 1200),
    detailChecked: detail.ok,
    detailError: detail.error || '',
    attachments: detail.attachments,
    excludedByDetail: Boolean(detail.medicalLicense || detail.employmentType === '제외 고용형태')
  };
}
