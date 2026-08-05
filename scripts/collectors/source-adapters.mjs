import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';

const LIST_QUERY_KEYS = new Set(['pageIndex', 'page', 'searchCondition', 'searchKeyword', 'menuNo', 'mId', 'order', 'search_yn', 'org_name']);
const DETAIL_PARAM = /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|recruit_no)$/i;
const FILE_OR_DOWNLOAD = /\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])|filedown|download|attach|atchfile|file_id|fileid/i;


const NON_RECRUITMENT_DISCLOSURE = [
  /친인척(?:\s*해당자)?\s*(?:공개|현황)/,
  /임직원\s*채용인원\s*(?:및|·)?\s*친인척/,
  /채용(?:인원|현황|실적|통계)\s*(?:공개|현황)/,
  /신규채용\s*(?:현황|실적|통계)/,
  /채용비리|채용\s*감사|채용\s*점검/,
  /퇴직자|재직자|임직원\s*현황/
];

function isRecruitmentDisclosure(title = '') {
  return NON_RECRUITMENT_DISCLOSURE.some(pattern => pattern.test(title));
}

const SOURCE_PROFILES = {
  '울산정보산업진흥원': {
    hosts: ['uipa.or.kr'],
    detailPath: /\/(?:recruit|board)\/(?:view|detail)|\/webuser\/recruit\/(?!list)/i,
    detailParams: /^(?:idx|seq|no|bbsSeq|boardSeq)$/i
  },
  '울산테크노파크': {
    hosts: ['utp.or.kr'],
    detailPath: /(?:view|detail|read|boardView|recruit)/i,
    detailParams: /^(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo)$/i
  },
  '울산시설공단': {
    hosts: ['uic.or.kr'],
    detailPath: /\/notify\/(?!noti06\.do$)|(?:view|detail|read)/i,
    detailParams: /^(?:idx|seq|no|nttId|bbsSeq|articleNo|dataSid)$/i
  },
  '울산광역시 타기관소식': {
    hosts: ['ulsan.go.kr'],
    detailPath: /(?:view|detail|read|select)/i,
    detailParams: /^(?:nttId|dataSid|bbsSeq|articleNo|postNo)$/i
  }
};

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

function profileFor(source) {
  return SOURCE_PROFILES[source.org] || null;
}

function hasDetailSignal(link = '', source = null) {
  try {
    const url = new URL(link);
    const profile = source ? profileFor(source) : null;
    if (profile?.detailPath?.test(url.pathname)) return true;
    if (/(?:view|detail|read|select|article|boardView|recruitview)/i.test(url.pathname)) return true;
    return [...url.searchParams.keys()].some(key => (profile?.detailParams || DETAIL_PARAM).test(key));
  } catch {
    return false;
  }
}

function isListOrMain(link, source) {
  try {
    const url = new URL(link);
    const sourceUrl = new URL(source.url);
    if (canonicalJobUrl(url.href) === canonicalJobUrl(sourceUrl.href)) return true;
    if (/\/(?:list|index|main|home|contents)(?:\.|\/|$)/i.test(url.pathname) && !hasDetailSignal(url.href, source)) return true;
    if (/\/notify\/noti06\.do$/i.test(url.pathname) && !hasDetailSignal(url.href, source)) return true;
    if (/\/u\/rep\/contents\.ulsan$/i.test(url.pathname) && !hasDetailSignal(url.href, source)) return true;
    if (/\/recruit\/recruit\.do$/i.test(url.pathname) && !hasDetailSignal(url.href, source)) return true;
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
  const href = attrs.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  if (href && href !== '#' && !/^javascript:/i.test(href)) {
    const link = absoluteUrl(href, source.url);
    if (link) urls.push(link);
  }
  const onclick = attrs.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || (/^javascript:/i.test(href) ? href : '');
  for (const link of urlsFromJavascript(onclick, source.url)) if (!urls.includes(link)) urls.push(link);
  return urls;
}

function sourceAllows(link, source) {
  if (!link || FILE_OR_DOWNLOAD.test(link) || isListOrMain(link, source)) return false;
  try {
    const url = new URL(link);
    const sourceHost = new URL(source.url).hostname.replace(/^www\./, '');
    const host = url.hostname.replace(/^www\./, '');
    const profile = profileFor(source);
    const allowedHosts = profile?.hosts || [sourceHost];
    const hostAllowed = allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
    if (!hostAllowed) return false;
    if (hasDetailSignal(link, source)) return true;
    // Some public boards use opaque paths or non-standard query keys. Accept only
    // same-site links that differ from the listing URL; fetchDetail performs the
    // final body/redirect/title validation before a job can be stored.
    const listing = new URL(source.url);
    const differsFromListing = canonicalJobUrl(url.href) !== canonicalJobUrl(listing.href);
    const hasOpaqueIdentity = url.searchParams.size > 0 || url.pathname.split('/').filter(Boolean).length > listing.pathname.split('/').filter(Boolean).length;
    return differsFromListing && hasOpaqueIdentity;
  } catch {
    return false;
  }
}

export function extractCandidatesForSource(html, source, { validTitle, normalizeTitleForDedup }) {
  const jobs = [];
  const seen = new Set();
  const diagnostics = { anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, accepted: 0, titleSamples: [], unsafeSamples: [] };
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    diagnostics.anchors += 1;
    const attrs = match[1] || '';
    const title = cleanHtml(match[2]).replace(/\s+/g, ' ').trim();
    if (!validTitle(title) || isRecruitmentDisclosure(title)) continue;
    diagnostics.titleMatches += 1;
    if (diagnostics.titleSamples.length < 8) diagnostics.titleSamples.push(title);

    const urls = candidateUrls(attrs, source);
    if (!urls.length) { diagnostics.noUrl += 1; continue; }
    const link = urls.find(url => sourceAllows(url, source));
    if (!link) {
      diagnostics.unsafeUrl += 1;
      if (diagnostics.unsafeSamples.length < 8) diagnostics.unsafeSamples.push({ title, attrs: attrs.slice(0, 500), urls: urls.slice(0, 5) });
      continue;
    }
    const canonical = canonicalJobUrl(link);
    const key = `${source.org}|${normalizeTitleForDedup(title)}|${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = Math.max(0, match.index - 260);
    const end = Math.min(html.length, match.index + match[0].length + 900);
    const listText = cleanHtml(html.slice(start, end)).replace(/\s+/g, ' ').trim();
    jobs.push({ org: source.org, title, link: canonical, listText, adapter: source.org });
    diagnostics.accepted += 1;
    if (jobs.length >= 30) break;
  }
  Object.defineProperty(jobs, 'diagnostics', { value: diagnostics, enumerable: false });
  return jobs;
}

export function discoverListingUrls(html, source) {
  if (!source.discoverListings) return [source.url];
  const urls = [source.url];
  const seen = new Set(urls.map(canonicalJobUrl));
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(anchorRegex)) {
    const attrs = match[1] || '';
    const label = cleanHtml(match[2]).replace(/\s+/g, ' ').trim();
    if (!/(채용|인재|입사|직원모집|recruit|career|employment)/i.test(label)) continue;
    const candidates = candidateUrls(attrs, source);
    for (const link of candidates) {
      try {
        const url = new URL(link);
        const base = new URL(source.url);
        const host = url.hostname.replace(/^www\./, '');
        const baseHost = base.hostname.replace(/^www\./, '');
        if (!(host === baseHost || host.endsWith(`.${baseHost}`))) continue;
        if (FILE_OR_DOWNLOAD.test(link)) continue;
        const key = canonicalJobUrl(link);
        if (seen.has(key)) continue;
        seen.add(key);
        urls.push(link);
        if (urls.length >= (source.maxListingPages || 4)) return urls;
      } catch { /* ignore invalid */ }
    }
  }
  return urls;
}
