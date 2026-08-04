import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';

const FILE_LINK = /\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])/i;
const DOWNLOAD_LINK = /filedown|download|attach|atchfile|file_id|fileid/i;
const DETAIL_PARAM = /(?:recruitNo|recruit_no|seq|idx|no|nttId|bbsSeq|articleNo|postNo)=/i;

function normalizeTitle(title = '') {
  return cleanHtml(title).replace(/\s+/g, ' ').trim();
}

function jsUrl(value = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(value);
  const direct = decoded.match(/["']((?:https?:\/\/|\/|\.\/|\.\.\/)[^"']*(?:recruit|detail|view)[^"']*)["']/i)?.[1];
  if (direct) return absoluteUrl(direct, baseUrl);

  // ALIO 모바일 페이지의 상세 함수는 공고번호를 인자로 넘기는 경우가 있다.
  const recruitNo = decoded.match(/(?:fn\w*Recruit\w*|go\w*Recruit\w*|recruit\w*)\s*\(\s*["']?([A-Za-z0-9_-]{5,})["']?/i)?.[1];
  if (recruitNo) {
    return `https://job.alio.go.kr/recruitview.do?idx=${encodeURIComponent(recruitNo)}`;
  }
  return '';
}

function extractLink(attrs = '', sourceUrl = '') {
  const href = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
  if (href && href !== '#' && !/^javascript:/i.test(href)) return absoluteUrl(href, sourceUrl);
  const onclick = attrs.match(/\bonclick\s*=\s*["']([\s\S]*?)["']/i)?.[1] || href;
  return jsUrl(onclick, sourceUrl);
}

function isDetailUrl(link = '') {
  if (!link || FILE_LINK.test(link) || DOWNLOAD_LINK.test(link)) return false;
  try {
    const url = new URL(link);
    if (!/(?:^|\.)alio\.go\.kr$/i.test(url.hostname)) return false;
    if (/(?:recruitview|recruitView|detail|view)\.do$/i.test(url.pathname)) return true;
    return DETAIL_PARAM.test(url.search);
  } catch {
    return false;
  }
}

export function extractAlioCandidates(html, source, { validTitle, normalizeTitleForDedup }) {
  const jobs = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const attrs = match[1] || '';
    const title = normalizeTitle(match[2]);
    if (!validTitle(title)) continue;

    const link = extractLink(attrs, source.url);
    if (!isDetailUrl(link)) continue;

    const key = `${source.org}|${normalizeTitleForDedup(title)}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = Math.max(0, match.index - 280);
    const end = Math.min(html.length, match.index + match[0].length + 900);
    const listText = cleanHtml(html.slice(start, end)).replace(/\s+/g, ' ').trim();
    jobs.push({ org: source.org, title, link, listText, sourceType: 'ALIO' });
    if (jobs.length >= 30) break;
  }
  return jobs;
}
