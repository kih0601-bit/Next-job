import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';
import { extractAlioCandidates } from './alio-adapter.mjs';

const LIST_QUERY_KEYS = new Set(['pageIndex', 'page', 'searchCondition', 'searchKeyword', 'menuNo', 'mId', 'order', 'search_yn', 'org_name']);
const DETAIL_PARAM = /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|recruit_no|boardNo|board_no|noticeNo|notice_no|sn|id)$/i;
const FILE_OR_DOWNLOAD = /\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])|filedown|download|attach|atchfile|file_id|fileid/i;
const GENERIC_NAVIGATION_TITLE = /^(?:홈|메인|목록|이전|다음|처음|마지막|더보기|바로가기|로그인|회원가입|사이트맵|검색|전체메뉴)$/i;

function looksLikeBoardRecord(block = '', link = '', source = null) {
  const text = cleanHtml(block).replace(/\s+/g, ' ').trim();
  if (hasDetailSignal(link, source)) return true;
  if (/<tr\b/i.test(block) && /<t[dh]\b/i.test(block)) return true;
  if (/\b(?:onclick|data-href|data-url|data-id|data-seq|data-idx)\s*=/i.test(block)) return true;
  if (/(?:20\d{2}|19\d{2})[.\-/년]\s*\d{1,2}(?:[.\-/월]\s*\d{1,2})?/.test(text)) return true;
  if (/(?:번호|작성일|등록일|게시일|조회수|첨부파일)/.test(text)) return true;
  if (/\b(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo|dataSid|boardSeq|recruitNo|boardNo|noticeNo)\b/i.test(block)) return true;
  return false;
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
    detailParams: /^(?:nttId|dataSid|bbsSeq|articleNo|postNo|dataId|bbsId)$/i
  },
  '울산항만공사': {
    hosts: ['upa.or.kr'],
    detailPath: /\/portal\/board\/post\/view\.do$/i,
    detailParams: /^(?:idx|bcIdx)$/i
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



function enclosingBlock(html, index = 0) {
  const before = html.slice(0, index);
  const starts = [
    ['tr', before.toLowerCase().lastIndexOf('<tr')],
    ['li', before.toLowerCase().lastIndexOf('<li')],
    ['div', before.toLowerCase().lastIndexOf('<div')]
  ].filter(([, pos]) => pos >= 0).sort((a, b) => b[1] - a[1]);
  for (const [tag, start] of starts) {
    const close = html.toLowerCase().indexOf(`</${tag}>`, index);
    if (close >= 0 && close - start <= 12000) return html.slice(start, close + tag.length + 3);
  }
  return html.slice(Math.max(0, index - 1200), Math.min(html.length, index + 4000));
}

function urlsFromBlock(block = '', source) {
  const urls = [];
  const push = value => {
    const link = absoluteUrl(value, source.url);
    if (link && !urls.includes(link)) urls.push(link);
  };

  for (const match of block.matchAll(/\b(?:href|data-href|data-url|action)\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    const value = decodeHtmlEntities(match[2]).trim();
    if (value && value !== '#' && !/^javascript:/i.test(value)) push(value);
    for (const link of urlsFromJavascript(value, source.url)) if (!urls.includes(link)) urls.push(link);
  }
  for (const match of block.matchAll(/\b(?:onclick|onmousedown)\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    for (const link of urlsFromJavascript(match[2], source.url)) if (!urls.includes(link)) urls.push(link);
  }

  // Common public-board pattern: the row carries a detail id in a hidden field or
  // data attribute while the title anchor itself has no href.
  const ids = [];
  for (const match of block.matchAll(/\b(?:data-)?(idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|boardNo|noticeNo|sn|id)\s*=\s*(["'])([^"']+)\2/gi)) {
    const key = match[1];
    const value = decodeHtmlEntities(match[3]).trim();
    if (/^[A-Za-z0-9_-]{1,80}$/.test(value)) ids.push([key, value]);
  }
  if (ids.length) {
    try {
      const base = new URL(source.url);
      for (const [key, value] of ids) {
        const detail = new URL(base.href);
        for (const listKey of LIST_QUERY_KEYS) detail.searchParams.delete(listKey);
        detail.searchParams.set(key, value);
        urls.push(detail.href);
      }
    } catch { /* ignore malformed source */ }
  }
  return [...new Set(urls)];
}


function sourceSpecificDetailUrls(block = '', source) {
  const urls = [];
  const push = value => {
    const link = absoluteUrl(value, source.url);
    if (link && !urls.includes(link)) urls.push(link);
  };

  if (source.org === '한국에너지공단') {
    const ids = new Set();
    for (const match of block.matchAll(/fn_Detail\s*\(\s*["']?(\d+)["']?\s*\)/gi)) ids.add(match[1]);
    for (const id of ids) push(`/front/board/etc/jobView.do?seq=${id}`);
  }

  if (source.org === '한국산업인력공단') {
    const keys = new Set();
    for (const match of block.matchAll(/(?:[?&]k=|\bk\s*[=:,(]\s*["']?)(\d{3,})/gi)) keys.add(match[1]);
    for (const key of keys) push(`/3/1/2/2?k=${key}`);
  }

  if (source.org === '울산항만공사') {
    const idxValues = new Set();
    for (const match of block.matchAll(/(?:\bidx\b|postView\s*\(|fnView\s*\(|view\s*\()\s*[=:,(]?\s*["']?(\d{2,})/gi)) {
      idxValues.add(match[1]);
    }
    for (const idx of idxValues) {
      push(`/portal/board/post/view.do?bcIdx=668&idx=${idx}&mid=0405000000`);
    }
  }

  if (source.org === '울산광역시 타기관소식') {
    const dataIds = new Set();
    for (const match of block.matchAll(/(?:dataId|dataSid|nttId)\s*[=:,(]?\s*["']?(\d{2,})/gi)) dataIds.add(match[1]);
    for (const dataId of dataIds) {
      push(`/u/rep/bbs/view.do?bbsId=BBS_0000000000000030&dataId=${dataId}&mId=001004001003000000`);
    }
  }

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
  try {
    const host = new URL(source.url).hostname;
    if (host === 'job.alio.go.kr' || host.endsWith('.alio.go.kr')) {
      return extractAlioCandidates(html, { ...source, alio: true }, { validTitle, normalizeTitleForDedup });
    }
  } catch { /* continue with institution adapter */ }

  const jobs = [];
  const seen = new Set();
  const diagnostics = { anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, accepted: 0, rowFallbackAccepted: 0, clickableBlocksScanned: 0, clickableBlocksAccepted: 0, listOnlyAccepted: 0, titleSamples: [], unsafeSamples: [], actionSamples: [], candidateUrlSamples: [] };
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    diagnostics.anchors += 1;
    const attrs = match[1] || '';
    const title = cleanHtml(match[2]).replace(/\s+/g, ' ').trim();
    if (!validTitle(title) || GENERIC_NAVIGATION_TITLE.test(title)) continue;
    diagnostics.titleMatches += 1;
    if (diagnostics.titleSamples.length < 8) diagnostics.titleSamples.push(title);

    let urls = candidateUrls(attrs, source);
    let usedRowFallback = false;
    let block = enclosingBlock(html, match.index);
    if (!looksLikeBoardRecord(block, urls[0] || '', source)) continue;
    if (!urls.length || !urls.some(url => sourceAllows(url, source))) {
      block = block || enclosingBlock(html, match.index);
      const rowUrls = [...sourceSpecificDetailUrls(block, source), ...urlsFromBlock(block, source)];
      for (const url of rowUrls) if (!urls.includes(url)) urls.push(url);
      usedRowFallback = rowUrls.length > 0;
    }
    for (const url of urls) {
      if (diagnostics.candidateUrlSamples.length >= 16) break;
      diagnostics.candidateUrlSamples.push({ title, url, allowed: sourceAllows(url, source) });
    }
    const link = urls.find(url => sourceAllows(url, source));
    if (!link) {
      // Phase 2 deliberately separates list extraction from detail URL recovery.
      // A real recruitment row must still be counted even when its JavaScript
      // detail action is not decoded yet; Phase 3 will resolve the final URL.
      const row = (block || enclosingBlock(html, match.index));
      const action = attrs.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
      if (action && diagnostics.actionSamples.length < 12) diagnostics.actionSamples.push({ title, action: decodeHtmlEntities(action).slice(0, 600) });
      const identity = action.match(/(?:view|fn_Detail|goView|fnView|detail)\s*\(\s*["']?([^"')\s,]+)/i)?.[1]
        || row.match(/(?:data-)?(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo|dataSid|boardSeq|recruitNo|boardNo|noticeNo)\s*=\s*(["'])([^"']+)\1/i)?.[2]
        || `row-${match.index}`;
      const canonical = `${canonicalJobUrl(source.url)}#list-${encodeURIComponent(identity)}`;
      const key = `${source.org}|${normalizeTitleForDedup(title)}|${canonical}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const listText = cleanHtml(row).replace(/\s+/g, ' ').trim();
      jobs.push({ org: source.org, title, link: canonical, listText, adapter: source.org, listOnly: true, listIdentity: identity });
      diagnostics.noUrl += urls.length ? 0 : 1;
      diagnostics.unsafeUrl += urls.length ? 1 : 0;
      diagnostics.accepted += 1;
      diagnostics.listOnlyAccepted += 1;
      if (diagnostics.unsafeSamples.length < 8) diagnostics.unsafeSamples.push({ title, reason: urls.length ? 'detail-url-pending' : 'no-url-detail-pending', identity, row: row.slice(0, 1200) });
      if (jobs.length >= 100) break;
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
    if (usedRowFallback) diagnostics.rowFallbackAccepted += 1;
    if (jobs.length >= 100) break;
  }

  // Some institutional boards do not wrap the subject in an <a> tag. Instead the
  // entire row/card is clickable through onclick, data-url, data-href, or role=link.
  // Scan only bounded row-like blocks so this fallback does not turn page chrome
  // into false job candidates.
  const blockRegex = /<(tr|li|article|div)\b([^>]*(?:onclick|data-href|data-url|role\s*=\s*["']link["'])[^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(blockRegex)) {
    if (jobs.length >= 100) break;
    diagnostics.clickableBlocksScanned += 1;
    const attrs = match[2] || '';
    const block = match[0];
    if (block.length > 20000) continue;

    const explicitTitle = attrs.match(/\b(?:data-title|aria-label|title)\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    const classTitle = block.match(/<(?:td|th|span|div|p|strong)\b[^>]*class\s*=\s*(["'])[^"']*(?:title|subject|sj|tit)[^"']*\1[^>]*>([\s\S]*?)<\/(?:td|th|span|div|p|strong)>/i)?.[2] || '';
    const anchorTitle = block.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '';
    let title = cleanHtml(explicitTitle || classTitle || anchorTitle).replace(/\s+/g, ' ').trim();
    if (!title) {
      const text = cleanHtml(block).replace(/\s+/g, ' ').trim();
      title = text.split(/(?:\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|조회\s*\d+|첨부파일)/)[0].trim();
    }
    if (!validTitle(title) || GENERIC_NAVIGATION_TITLE.test(title)) continue;
    if (!looksLikeBoardRecord(block, '', source)) continue;

    const blockAction = attrs.match(/\b(?:onclick|onmousedown)\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    if (blockAction && diagnostics.actionSamples.length < 12) diagnostics.actionSamples.push({ title, action: decodeHtmlEntities(blockAction).slice(0, 600) });
    const urls = [...candidateUrls(attrs, source), ...sourceSpecificDetailUrls(block, source), ...urlsFromBlock(block, source)];
    for (const url of urls) {
      if (diagnostics.candidateUrlSamples.length >= 16) break;
      diagnostics.candidateUrlSamples.push({ title, url, allowed: sourceAllows(url, source) });
    }
    const link = urls.find(url => sourceAllows(url, source));
    const identity = attrs.match(/\b(?:data-)?(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo|dataSid|boardSeq|recruitNo|boardNo|noticeNo|sn|id)\s*=\s*(["'])([^"']+)\1/i)?.[2]
      || attrs.match(/(?:view|fn_Detail|goView|fnView|detail)\s*\(\s*["']?([^"')\s,]+)/i)?.[1]
      || `block-${match.index}`;
    const canonical = link ? canonicalJobUrl(link) : `${canonicalJobUrl(source.url)}#list-${encodeURIComponent(identity)}`;
    const key = `${source.org}|${normalizeTitleForDedup(title)}|${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);

    jobs.push({
      org: source.org,
      title,
      link: canonical,
      listText: cleanHtml(block).replace(/\s+/g, ' ').trim(),
      adapter: `${source.org}:clickable-block`,
      ...(link ? {} : { listOnly: true, listIdentity: identity })
    });
    diagnostics.accepted += 1;
    diagnostics.clickableBlocksAccepted += 1;
    if (!link) {
      diagnostics.noUrl += 1;
      diagnostics.listOnlyAccepted += 1;
      if (diagnostics.unsafeSamples.length < 8) diagnostics.unsafeSamples.push({ title, reason: 'clickable-block-detail-url-pending', identity, row: block.slice(0, 1200) });
    }
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
