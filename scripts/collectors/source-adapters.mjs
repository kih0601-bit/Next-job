import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';

const LIST_QUERY_KEYS = new Set(['pageIndex', 'page', 'searchCondition', 'searchKeyword', 'menuNo', 'mId', 'order', 'search_yn', 'org_name']);
const DETAIL_PARAM = /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|recruit_no)$/i;
const FILE_OR_DOWNLOAD = /\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])|filedown|download|attach|atchfile|file_id|fileid/i;

export function canonicalJobUrl(link = '') {
  try {
    const url = new URL(link);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (LIST_QUERY_KEYS.has(key) && !DETAIL_PARAM.test(key)) url.searchParams.delete(key);
    }
    const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [key, value] of sorted) url.searchParams.append(key, value);
    return url.href.replace(/\/$/, '');
  } catch {
    return String(link).split('#')[0];
  }
}

function hasDetailSignal(link = '') {
  try {
    const url = new URL(link);
    if (/(?:view|detail|read|select|article|boardView|recruitview)/i.test(url.pathname)) return true;
    return [...url.searchParams.keys()].some(key => DETAIL_PARAM.test(key));
  } catch {
    return false;
  }
}

function isListOrMain(link, source) {
  try {
    const url = new URL(link);
    const sourceUrl = new URL(source.url);
    if (canonicalJobUrl(url.href) === canonicalJobUrl(sourceUrl.href)) return true;
    if (/\/(?:list|index|main|home|contents)(?:\.|\/|$)/i.test(url.pathname) && !hasDetailSignal(url.href)) return true;
    if (/\/notify\/noti06\.do$/i.test(url.pathname) && !hasDetailSignal(url.href)) return true;
    if (/\/u\/rep\/contents\.ulsan$/i.test(url.pathname) && !hasDetailSignal(url.href)) return true;
    if (/\/recruit\/recruit\.do$/i.test(url.pathname) && !hasDetailSignal(url.href)) return true;
    return false;
  } catch {
    return true;
  }
}

function urlsFromJavascript(value = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(value).replace(/\\(['"])/g, '$1').trim();
  const found = [];
  const patterns = [
    /(?:location(?:\.href)?\s*=|window\.open\s*\()\s*["']([^"']+)["']/gi,
    /["']((?:https?:\/\/|\/|\.\/|\.\.\/)[^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      const link = absoluteUrl(match[1], baseUrl);
      if (link && !found.includes(link)) found.push(link);
    }
  }
  return found;
}

function candidateUrls(attrs = '', source) {
  const urls = [];
  const href = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
  if (href && href !== '#' && !/^javascript:/i.test(href)) {
    const link = absoluteUrl(href, source.url);
    if (link) urls.push(link);
  }
  const onclick = attrs.match(/\bonclick\s*=\s*["']([\s\S]*?)["']/i)?.[1] || (/^javascript:/i.test(href) ? href : '');
  for (const link of urlsFromJavascript(onclick, source.url)) if (!urls.includes(link)) urls.push(link);
  return urls;
}

function sourceAllows(link, source) {
  if (!link || FILE_OR_DOWNLOAD.test(link) || !hasDetailSignal(link) || isListOrMain(link, source)) return false;
  try {
    const url = new URL(link);
    const sourceHost = new URL(source.url).hostname.replace(/^www\./, '');
    const host = url.hostname.replace(/^www\./, '');
    if (source.org === '울산광역시 타기관소식') {
      return host === sourceHost || host.endsWith(`.${sourceHost}`);
    }
    if (source.org === '울산시설공단') return host === 'uic.or.kr' || host.endsWith('.uic.or.kr');
    return host === sourceHost || host.endsWith(`.${sourceHost}`);
  } catch {
    return false;
  }
}

export function extractCandidatesForSource(html, source, { validTitle, normalizeTitleForDedup }) {
  const jobs = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    const attrs = match[1] || '';
    const title = cleanHtml(match[2]).replace(/\s+/g, ' ').trim();
    if (!validTitle(title)) continue;

    const link = candidateUrls(attrs, source).find(url => sourceAllows(url, source));
    if (!link) continue;
    const canonical = canonicalJobUrl(link);
    const key = `${source.org}|${normalizeTitleForDedup(title)}|${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = Math.max(0, match.index - 260);
    const end = Math.min(html.length, match.index + match[0].length + 900);
    const listText = cleanHtml(html.slice(start, end)).replace(/\s+/g, ' ').trim();
    jobs.push({ org: source.org, title, link: canonical, listText });
    if (jobs.length >= 30) break;
  }
  return jobs;
}
