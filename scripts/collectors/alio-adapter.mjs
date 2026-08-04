import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';

const FILE_LINK = /\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])/i;
const DOWNLOAD_LINK = /filedown|download|attach|atchfile|file_id|fileid/i;
const DETAIL_PARAM = /(?:recruitNo|recruit_no|seq|idx|no|nttId|bbsSeq|articleNo|postNo)=/i;

function normalizeTitle(title = '') {
  return cleanHtml(title).replace(/\s+/g, ' ').trim();
}

function extractExplicitUrl(value = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(value).replace(/\\(['"])/g, '$1');
  const candidates = [];
  for (const match of decoded.matchAll(/["']((?:https?:\/\/|\/|\.\/|\.\.\/)[^"']+)["']/gi)) {
    const link = absoluteUrl(match[1], baseUrl);
    if (link && !candidates.includes(link)) candidates.push(link);
  }
  return candidates.find(link => /(?:recruitview|detail|view)\.do|[?&](?:idx|recruitNo|recruit_no|seq|no)=/i.test(link)) || '';
}

function extractLink(attrs = '', sourceUrl = '') {
  const href = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
  if (href && href !== '#' && !/^javascript:/i.test(href)) return absoluteUrl(href, sourceUrl);
  const onclick = attrs.match(/\bonclick\s*=\s*["']([\s\S]*?)["']/i)?.[1] || href;
  return extractExplicitUrl(onclick, sourceUrl);
}

function isDetailUrl(link = '') {
  if (!link || FILE_LINK.test(link) || DOWNLOAD_LINK.test(link)) return false;
  try {
    const url = new URL(link);
    if (!(url.hostname === 'job.alio.go.kr' || url.hostname.endsWith('.alio.go.kr'))) return false;
    if (/(?:recruitview|detail|view)\.do$/i.test(url.pathname)) return true;
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

    const start = Math.max(0, match.index - 320);
    const end = Math.min(html.length, match.index + match[0].length + 1000);
    const listText = cleanHtml(html.slice(start, end)).replace(/\s+/g, ' ').trim();
    jobs.push({ org: source.org, title, link, listText, sourceType: 'ALIO' });
    if (jobs.length >= 40) break;
  }
  return jobs;
}
