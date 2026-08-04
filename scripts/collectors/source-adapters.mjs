import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';

const LIST_QUERY_KEYS = new Set(['pageIndex', 'page', 'searchCondition', 'searchKeyword', 'menuNo', 'mId']);
const DETAIL_PARAM = /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId)$/i;

export function canonicalJobUrl(link = '') {
  try {
    const url = new URL(link);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (LIST_QUERY_KEYS.has(key)) url.searchParams.delete(key);
    }
    const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [key, value] of sorted) url.searchParams.append(key, value);
    return url.href.replace(/\/$/, '');
  } catch {
    return String(link).split('#')[0];
  }
}

function hasDetailSignal(link) {
  try {
    const url = new URL(link);
    if (/(?:view|detail|read|select|article|boardView)/i.test(url.pathname)) return true;
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
    if (/\/(?:list|index|main|contents)(?:\.|\/|$)/i.test(url.pathname) && !hasDetailSignal(url.href)) return true;
    if (/\/notify\/noti06\.do$/i.test(url.pathname) && !url.search) return true;
    if (/\/u\/rep\/contents\.ulsan$/i.test(url.pathname) && !hasDetailSignal(url.href)) return true;
    return false;
  } catch {
    return true;
  }
}

function extractUrlFromJavascript(value = '', baseUrl) {
  const decoded = decodeHtmlEntities(value).trim();
  const direct = decoded.match(/(?:location(?:\.href)?\s*=|window\.open\s*\()\s*["']([^"']+)["']/i)?.[1];
  if (direct) return absoluteUrl(direct, baseUrl);

  // javascript: 함수 안에 실제 URL 문자열이 포함된 경우만 사용한다.
  const embedded = decoded.match(/["']((?:https?:\/\/|\/|\.\/|\.\.\/)[^"']+)["']/i)?.[1];
  if (embedded) return absoluteUrl(embedded, baseUrl);
  return '';
}

function candidateUrl(attrs, source) {
  const href = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
  if (href && !/^javascript:/i.test(href) && href !== '#') return absoluteUrl(href, source.url);
  const onclick = attrs.match(/\bonclick\s*=\s*["']([\s\S]*?)["']/i)?.[1] || href;
  return extractUrlFromJavascript(onclick, source.url);
}

function sourceAllows(link, source) {
  if (!link || isListOrMain(link, source)) return false;
  try {
    const url = new URL(link);
    const sourceHost = new URL(source.url).hostname.replace(/^www\./, '');
    const host = url.hostname.replace(/^www\./, '');
    if (source.org === '울산광역시 타기관소식') {
      // 울산시 게시물은 울산시 도메인 또는 명시적으로 연결된 외부 원문만 허용한다.
      return host === sourceHost || host.endsWith(`.${sourceHost}`) || hasDetailSignal(link);
    }
    if (source.org === '울산시설공단') {
      return host.endsWith('uic.or.kr') && hasDetailSignal(link);
    }
    return true;
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

    const link = candidateUrl(attrs, source);
    if (!sourceAllows(link, source)) continue;

    const key = `${source.org}|${normalizeTitleForDedup(title)}|${canonicalJobUrl(link)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = Math.max(0, match.index - 220);
    const end = Math.min(html.length, match.index + match[0].length + 750);
    const listText = cleanHtml(html.slice(start, end)).replace(/\s+/g, ' ').trim();
    jobs.push({ org: source.org, title, link, listText });
    if (jobs.length >= 20) break;
  }
  return jobs;
}
