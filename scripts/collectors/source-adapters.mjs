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
    const hasDetailIdentity = [...url.searchParams.keys()].some(key => DETAIL_PARAM.test(key));
    for (const key of [...url.searchParams.keys()]) {
      // menuNo/mId can be routing keys required by eGov detail pages. Preserve them
      // once a post identity is present, while still stripping pagination/search noise.
      if (LIST_QUERY_KEYS.has(key) && !DETAIL_PARAM.test(key) && !(hasDetailIdentity && /^(?:menuNo|mId)$/i.test(key))) url.searchParams.delete(key);
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



function hiddenFormRequest(block = '', source, { formId = '', actionPattern = null, overrides = {} } = {}) {
  const forms = [...String(block).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  for (const match of forms) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const id = attrs.match(/\b(?:id|name)\s*=\s*(["'])([^"']+)\1/i)?.[2] || '';
    const action = attrs.match(/\baction\s*=\s*(["'])([^"']+)\1/i)?.[2] || '';
    if (formId && id !== formId) continue;
    if (actionPattern && !actionPattern.test(action)) continue;
    const params = new URLSearchParams();
    for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
      const a = input[1] || '';
      const name = a.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];
      const value = a.match(/\bvalue\s*=\s*(["'])([^"']*)\1/i)?.[2] || '';
      if (name) params.set(decodeHtmlEntities(name), decodeHtmlEntities(value));
    }
    for (const [key, value] of Object.entries(overrides)) params.set(key, String(value));
    const target = absoluteUrl(action || source.url, source.url);
    if (!target) continue;
    return { method: 'POST', url: target, body: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, referer: source.url };
  }
  return null;
}

function upaPostRequest(block = '', source, idx = '') {
  if (!idx) return null;
  const page = String(source.__rawHtml || '');
  const form = page.match(/<form\b[^>]*(?:id|name)=["']viewForm["'][^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!form) return null;
  const params = new URLSearchParams();
  for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = input[1] || '';
    const name = attrs.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];
    const value = attrs.match(/\bvalue\s*=\s*(["'])([^"']*)\1/i)?.[2] || '';
    if (name) params.set(decodeHtmlEntities(name), decodeHtmlEntities(value));
  }
  const listForm = page.match(/<form\b[^>]*(?:id|name)=["'](?:listForm|list)["'][^>]*>([\s\S]*?)<\/form>/i);
  if (listForm) {
    for (const input of listForm[1].matchAll(/<input\b([^>]*)>/gi)) {
      const attrs = input[1] || '';
      const name = attrs.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];
      const value = attrs.match(/\bvalue\s*=\s*(["'])([^"']*)\1/i)?.[2] || '';
      if (name && !params.has(name)) params.set(decodeHtmlEntities(name), decodeHtmlEntities(value));
    }
  }
  const rawAction = decodeHtmlEntities(form[1]).replace(/idx=a(?=(&|$))/i, `idx=${encodeURIComponent(idx)}`);
  return { method: 'POST', url: absoluteUrl(rawAction, source.url), body: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, referer: source.url };
}

function ewpPostRequest(source, idx = '') {
  if (!idx) return null;
  const page = String(source.__rawHtml || '');
  const form = page.match(/<form\b[^>]*name=["']myform["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!form) return null;
  const params = new URLSearchParams();
  for (const input of form[1].matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = input[1] || '';
    const name = attrs.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];
    const value = attrs.match(/\bvalue\s*=\s*(["'])([^"']*)\1/i)?.[2] || '';
    if (name) params.set(decodeHtmlEntities(name), decodeHtmlEntities(value));
  }
  params.set('state', 'view');
  params.set('idx', idx);
  return { method: 'POST', url: absoluteUrl('/kor/subpage/content.html', source.url), body: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, referer: source.url };
}

function ubimcPostRequest(block = '', source) {
  const action = block.match(/<form\b[^>]*method=["']post["'][^>]*action=["']([^"']*selectBoardArticle\.do[^"']*)["']/i)?.[1]
    || '/cop/bbs/selectBoardArticle.do';
  const call = block.match(/fn_egov_inqire_notice\(\s*["'](\d+)["']\s*,\s*["']([^"']+)["']\s*\)/i);
  if (!call) return null;
  const params = new URLSearchParams({ bbsId: call[2], nttId: call[1], menuNo: '2040000', pageIndex: '1', searchCnd: '', searchWrd: '', sCaId01: '', sCaId02: '' });
  return { method:'POST', url:absoluteUrl(action, source.url), body:params.toString(), headers:{'content-type':'application/x-www-form-urlencoded'}, referer:source.url };
}


function khnpDetailRequest(block='',source){
  const call=block.match(/fnMoveDtlPage\(\s*["']([^"']+)["']\s*,\s*["']?(\d+)["']?\s*\)/i);
  if(!call) return null;
  return {method:'POST',url:absoluteUrl('/recruit/rj00/RJ10110.do',source.url),
    body:new URLSearchParams({pageIndex:'1',srchRecrOpeningId:call[1],rnum:call[2]}).toString(),
    headers:{'content-type':'application/x-www-form-urlencoded'},referer:source.url};
}
function kepcoPageBoard(block='',source){
  const call=block.match(/fncPageBoard\(\s*["']view["']\s*,\s*["']([^"']*\/frt\/frt0001\/view\.do)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/i);
  if(!call) return null;
  const values=call[2].split(',').map(v=>v.trim()),names=call[3].split(',').map(v=>v.trim());
  if(!values.length||values.length!==names.length) return null;
  const params=new URLSearchParams(); for(let i=0;i<names.length;i++) if(names[i]) params.set(names[i],values[i]||'');
  const endpoint=absoluteUrl(call[1],source.url),display=new URL(endpoint);
  for(const [k,v] of params) display.searchParams.set(k,v);
  return {link:display.href,request:{method:'POST',url:endpoint,body:params.toString(),headers:{'content-type':'application/x-www-form-urlencoded'},referer:source.url}};
}
function sourceSpecificDetailUrls(block = '', source) {
  const urls = [];
  const push = value => {
    const link = absoluteUrl(value, source.url);
    if (link && !urls.includes(link)) urls.push(link);
  };

  if(source.org==='한국수력원자력'){
    const c=block.match(/fnMoveDtlPage\(\s*["']([^"']+)["']\s*,\s*["']?(\d+)["']?\s*\)/i);
    if(c) push(`/recruit/rj00/RJ10110.do?srchRecrOpeningId=${encodeURIComponent(c[1])}&rnum=${encodeURIComponent(c[2])}`);
  }
  if(source.org==='한국전력공사'){const d=kepcoPageBoard(block,source);if(d?.link) push(d.link);}

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


  // Dedicated eGov recruitment boards whose title link calls a JavaScript helper.
  // Recover the post id without issuing any extra request.
  if (source.org === '울산북구시설관리공단') {
    for (const match of block.matchAll(/fn_egov_inqire_notice\(\s*["'](\d+)["']\s*,\s*["']([^"']+)["']\s*\)/gi)) {
      push(`/pageCont.do?menuNo=2040000&nttId=${match[1]}&bbsId=${match[2]}`);
    }
  }

  if (source.org === '울산남구도시관리공단') {
    const ids = new Set();
    for (const match of block.matchAll(/(?:goBoardArticle\(\s*["']|[?&]nttId=)(\d+)/gi)) ids.add(match[1]);
    for (const id of ids) push(`/cop/bbs/selectBoardArticle.do?bbsId=hireNotice2&nttId=${id}`);
  }

  if (source.org === '울산시설공단') {
    const id = block.match(/name=["']employmentId["'][^>]*value=["']([^"']+)["']/i)?.[1];
    if (id) push(`/uimc/notify/noti06/selectEmploymentArticle.do?employmentId=${encodeURIComponent(id)}&bbsId=BBSMSTR_000000000022`);
  }

  if (source.org === '한국동서발전') {
    const id = block.match(/(?:onclick=["'][^"']*|href=["']javascript:)?view\(\s*(\d+)\s*\)/i)?.[1];
    if (id) {
      const pc = (() => { try { return new URL(source.url).searchParams.get('pc') || ''; } catch { return ''; } })();
      push(`/kor/subpage/content.html?${pc ? `pc=${encodeURIComponent(pc)}&` : ''}state=view&idx=${encodeURIComponent(id)}`);
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


function visibleBoardRows(html = '') {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of String(html).matchAll(rowRegex)) {
    const block = match[0];
    if (/<th\b/i.test(block) && !/<td\b/i.test(block)) continue;
    const cells = [...block.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) continue;
    const text = cleanHtml(block).replace(/\s+/g, ' ').trim();
    if (text.length < 4) continue;
    const hasDate = /(?:19|20)\d{2}[.\-/년]\s*\d{1,2}(?:[.\-/월]\s*\d{1,2})?/.test(text);
    const hasAction = /<a\b|\b(?:onclick|data-href|data-url|data-id|data-seq|data-idx)\s*=/i.test(block);
    const firstCell = cleanHtml(cells[0][1]).replace(/\s+/g, ' ').trim();
    const hasSequence = /^(?:공지|notice|\d{1,6})$/i.test(firstCell);
    if (!hasAction || (!hasDate && !hasSequence)) continue;
    rows.push({ start: match.index, end: match.index + block.length, block, cells });
  }
  return rows;
}

function titleFromBoardRow(row) {
  const block = row.block || '';
  const dedicatedCell = block.match(/<td\b[^>]*class\s*=\s*(["'])[^"']*(?:left|subject|title|tit|sj)[^"']*\1[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[2];
  if (dedicatedCell) return cleanHtml(dedicatedCell).replace(/\s+/g, ' ').trim();
  const preferred = block.match(/<a\b[^>]*(?:class\s*=\s*(["'])[^"']*(?:title|subject|sj|tit|ellipsis)[^"']*\1|title\s*=\s*(["'])[^"']+\2)[^>]*>([\s\S]*?)<\/a>/i)?.[3];
  if (preferred) return cleanHtml(preferred).replace(/\s+/g, ' ').trim();
  const anchors = [...block.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => cleanHtml(m[1]).replace(/\s+/g, ' ').trim())
    .filter(t => t && !/^(?:download|첨부|파일|보기)$/i.test(t));
  if (anchors.length) return anchors.sort((a,b) => b.length-a.length)[0];
  const cellTexts = (row.cells || []).map(c => cleanHtml(c[1]).replace(/\s+/g, ' ').trim())
    .filter(t => t && !/^(?:공지|notice|\d{1,6}|(?:19|20)\d{2}[.\-/].*)$/i.test(t));
  return cellTexts.sort((a,b) => b.length-a.length)[0] || '';
}

export function countVisibleBoardPosts(html = '', source = null) {
  const raw = String(html);
  const org = source?.org || '';
  const url = source?.url || '';

  if (org === '근로복지공단') {
    const ids = new Set();
    for (const m of raw.matchAll(/<a\b[^>]*\bclass\s*=\s*(["'])[^"']*\bmain-job\b[^"']*\1[^>]*\bhref\s*=\s*(["'])([^"']*[?&]projectid=(\d+)[^"']*)\2/gi)) ids.add(m[4]);
    if (ids.size) return ids.size;
  }

  // Institution-specific counters for boards that do not expose normal <tr>/<a> rows.
  if (/job\.alio\.go\.kr/i.test(url)) {
    const ids = new Set([...raw.matchAll(/recruitView\.do\?idx=(\d+)/gi)].map(m => m[1]));
    if (ids.size) return ids.size;
  }
  if (org === '한국석유공사' && /sub01_7_9\.jsp/i.test(url)) {
    const ids = new Set([...raw.matchAll(/[?&](?:amp;)?num=(\d+)[^\"']*?[&](?:amp;)?mode=view[^\"']*?[&](?:amp;)?bid=RECRUIT/gi)].map(m => m[1]));
    if (ids.size) return ids.size;
  }
  if (org === '울주군시설관리공단') {
    const board = raw.match(/<table\b[^>]*class\s*=\s*([\"'])[^\"']*board_list[^\"']*\1[^>]*>[\s\S]*?<\/table>/i)?.[0] || '';
    const ids = new Set([...board.matchAll(/<input\b[^>]*name\s*=\s*([\"'])nttId\1[^>]*value\s*=\s*([\"'])(\d+)\2/gi)].map(m => m[3]));
    if (ids.size) return ids.size;
  }
  if (org === '울주문화재단') {
    const ids = new Set([...raw.matchAll(/class\s*=\s*(["'])[^"']*rowArea[^"']*\1[^>]*opnIdx\s*=\s*(["'])([^"']+)\2/gi)].map(m => m[3]));
    if (ids.size) return ids.size;
  }
  if (org === '울산문화관광재단' && /^\s*\{/.test(raw)) {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data.content)) return data.content.length;
    } catch { /* not JSON */ }
  }

  const rows = visibleBoardRows(html);
  const seen = new Set();
  for (const row of rows) {
    const title = titleFromBoardRow(row);
    const action = row.block.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    const href = row.block.match(/<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    const id = action.match(/(?:view|fn_Detail|goView|fnView|detail|fn_egov_inqire_notice|goBoardArticle)\s*\(\s*["']?([^"')\s,]+)/i)?.[1]
      || href.match(/[?&](?:idx|seq|no|num|nttId|bbsSeq|articleNo|postNo|dataSid|boardSeq|recruitNo|boardNo|noticeNo)=([^&#]+)/i)?.[1]
      || normalizeBoardKey(title);
    if (id) seen.add(`${normalizeBoardKey(title)}|${id}`);
  }
  return seen.size || rows.length;
}

function normalizeBoardKey(value = '') {
  return cleanHtml(value).replace(/[^0-9a-zA-Z가-힣]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function extractCandidatesForSource(html, source, { validTitle, normalizeTitleForDedup }) {
  try {
    const host = new URL(source.url).hostname;
    if (host === 'job.alio.go.kr' || host.endsWith('.alio.go.kr')) {
      return extractAlioCandidates(html, { ...source, alio: true }, { validTitle, normalizeTitleForDedup });
    }
  } catch { /* continue with institution adapter */ }

  if (source.org === '울산문화관광재단' && /^\s*\{/.test(String(html))) {
    try {
      const data = JSON.parse(String(html));
      const items = Array.isArray(data.content) ? data.content : [];
      const jobs = items.slice(0, 100).map(item => ({
        org: source.org,
        title: String(item.title || '').replace(/\s+/g, ' ').trim(),
        link: absoluteUrl(`/board/employment/view/${item.id}`, 'https://uctf.or.kr/'),
        listText: [item.title, item.category, item.state, item.createdDate || item.regDate || ''].filter(Boolean).join(' '),
        adapter: `${source.org}:api-notices`
      })).filter(item => validTitle(item.title));
      Object.defineProperty(jobs, 'diagnostics', { value: { visiblePostCount: jobs.length, rowMode: true, anchors: 0, titleMatches: jobs.length, noUrl: 0, unsafeUrl: 0, accepted: jobs.length, rowFallbackAccepted: 0, clickableBlocksScanned: 0, clickableBlocksAccepted: 0, listOnlyAccepted: 0, titleSamples: jobs.slice(0,8).map(x=>x.title), unsafeSamples: [], actionSamples: [], candidateUrlSamples: jobs.slice(0,8).map(x=>({title:x.title,url:x.link,allowed:true})) }, enumerable: false });
      return jobs;
    } catch { /* fall through to HTML parser */ }
  }


  if (source.org === '근로복지공단') {
    const jobs = [];
    const seen = new Set();
    for (const match of String(html).matchAll(/<a\b([^>]*\bclass\s*=\s*(["'])[^"']*\bmain-job\b[^"']*\2[^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = match[1] || '';
      const title = cleanHtml(match[3]).replace(/\s+/g, ' ').trim();
      if (!validTitle(title)) continue;
      const href = attrs.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
      const link = absoluteUrl(href, source.url);
      if (!link || !/[?&]projectid=\d+/i.test(link)) continue;
      const key = `${source.org}|${normalizeTitleForDedup(title)}|${canonicalJobUrl(link)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ org: source.org, title, link: canonicalJobUrl(link), listText: cleanHtml(match[0]).replace(/\s+/g, ' ').trim(), adapter: `${source.org}:main-job-card` });
    }
    if (jobs.length) {
      Object.defineProperty(jobs, 'diagnostics', { value: {
        visiblePostCount: jobs.length, rowMode: true, anchors: jobs.length, titleMatches: jobs.length,
        noUrl: 0, unsafeUrl: 0, accepted: jobs.length, rowFallbackAccepted: 0,
        clickableBlocksScanned: jobs.length, clickableBlocksAccepted: jobs.length, listOnlyAccepted: 0,
        titleSamples: jobs.slice(0,8).map(x=>x.title), unsafeSamples: [], actionSamples: [],
        candidateUrlSamples: jobs.slice(0,8).map(x=>({title:x.title,url:x.link,allowed:true}))
      }, enumerable: false });
      return jobs;
    }
  }

  const jobs = [];
  const seen = new Set();

  if(source.org==='근로복지공단'&&/comwel\.saramin\.co\.kr\/service\/comwel\/\d+\/applicant\/apply\/recruit_default\.asp/i.test(source.url)){
    const body=String(html),heading=decodeHtmlEntities(body.match(/<td\b[^>]*font-size:\s*34px[^>]*>\s*<b>([\s\S]*?)<\/b>/i)?.[1]||'');
    const title=cleanHtml(heading).replace(/\s+/g,' ').trim()||'근로복지공단 현재 채용공고',listText=cleanHtml(body).replace(/\s+/g,' ').trim();
    if(validTitle(title)&&/채용공고|신규직원|모집/.test(listText)){const link=canonicalJobUrl(source.url);jobs.push({org:source.org,title,link,listText,adapter:`${source.org}:saramin-current-campaign`});Object.defineProperty(jobs,'diagnostics',{value:{visiblePostCount:1,rowMode:true,anchors:0,titleMatches:1,noUrl:0,unsafeUrl:0,accepted:1,rowFallbackAccepted:0,clickableBlocksScanned:0,clickableBlocksAccepted:0,listOnlyAccepted:0,titleSamples:[title],unsafeSamples:[],actionSamples:[],candidateUrlSamples:[{title,url:link,allowed:true}]},enumerable:false});return jobs;}
  }

  // 울주군시설관리공단: 제목이 <a>가 아니라 submit input에 있고 nttId는 hidden input에 있다.
  if (source.org === '울주군시설관리공단') {
    const board = String(html).match(/<table\b[^>]*class\s*=\s*(["'])[^"']*board_list[^"']*\1[^>]*>[\s\S]*?<\/table>/i)?.[0] || '';
    for (const match of board.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const block = match[0];
      const id = block.match(/<input\b[^>]*name\s*=\s*(["'])nttId\1[^>]*value\s*=\s*(["'])(\d+)\2/i)?.[3] || '';
      const title = decodeHtmlEntities(block.match(/<input\b[^>]*type\s*=\s*(["'])submit\1[^>]*value\s*=\s*(["'])([\s\S]*?)\2/i)?.[3] || '').replace(/\s+/g, ' ').trim();
      if (!id || !validTitle(title)) continue;
      const link = absoluteUrl(`/portal/bbs/selectArticleDetail.do?bbsId=BBSMSTR_000000000011&nttId=${encodeURIComponent(id)}`, source.url);
      const key = `${source.org}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ org: source.org, title, link: canonicalJobUrl(link), listText: cleanHtml(block).replace(/\s+/g, ' ').trim(), adapter: `${source.org}:hidden-nttid-row` });
    }
    if (jobs.length) {
      Object.defineProperty(jobs, 'diagnostics', { value: { visiblePostCount: jobs.length, rowMode: true, anchors: 0, titleMatches: jobs.length, noUrl: 0, unsafeUrl: 0, accepted: jobs.length, rowFallbackAccepted: 0, clickableBlocksScanned: 0, clickableBlocksAccepted: 0, listOnlyAccepted: 0, titleSamples: jobs.slice(0,8).map(x=>x.title), unsafeSamples: [], actionSamples: [], candidateUrlSamples: [] }, enumerable: false });
      return jobs;
    }
  }

  // 울주문화재단: 공고 행 전체가 .rowArea[opnIdx]로 클릭되는 POST 방식이다.
  if (source.org === '울주문화재단') {
    for (const match of String(html).matchAll(/<[^>]+class\s*=\s*(["'])[^"']*rowArea[^"']*\1[^>]*opnIdx\s*=\s*(["'])([^"']+)\2[^>]*>([\s\S]*?)(?=<[^>]+class\s*=\s*(["'])[^"']*rowArea|$)/gi)) {
      const id = match[3];
      const block = match[0];
      const clean = cleanHtml(block).replace(/\s+/g, ' ').trim();
      const title = clean.replace(/^(?:진행중|마감|접수중|접수마감)\s*/,'').slice(0,260).trim();
      if (!id || !validTitle(title)) continue;
      jobs.push({ org: source.org, title, link: absoluteUrl('/applicantMain/goJobOpeningDetailPage.do', source.url), listText: clean, adapter: `${source.org}:rowArea-post`, listIdentity: id, detailRequest: { method: 'POST', url: absoluteUrl('/applicantMain/goJobOpeningDetailPage.do', source.url), body: new URLSearchParams({ orgIdx: '1090', opnIdx: id, openType: '', boardType: '0' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, referer: source.url } });
    }
    if (jobs.length) {
      Object.defineProperty(jobs, 'diagnostics', { value: { visiblePostCount: jobs.length, rowMode: true, anchors: 0, titleMatches: jobs.length, noUrl: 0, unsafeUrl: 0, accepted: jobs.length, rowFallbackAccepted: 0, clickableBlocksScanned: jobs.length, clickableBlocksAccepted: jobs.length, listOnlyAccepted: 0, titleSamples: jobs.slice(0,8).map(x=>x.title), unsafeSamples: [], actionSamples: [], candidateUrlSamples: jobs.slice(0,8).map(x=>({ title:x.title, url:x.link, allowed:true })) }, enumerable: false });
      return jobs;
    }
  }

  const boardRows = visibleBoardRows(html);
  const diagnostics = { visiblePostCount: boardRows.length, rowMode: boardRows.length > 0, anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, accepted: 0, rowFallbackAccepted: 0, clickableBlocksScanned: 0, clickableBlocksAccepted: 0, listOnlyAccepted: 0, titleSamples: [], unsafeSamples: [], actionSamples: [], candidateUrlSamples: [] };

  // Table-based public boards are parsed row-first. Exactly one candidate is emitted
  // per visible post row, preventing menu links and attachment buttons from being
  // counted as separate posts.
  for (const row of boardRows) {
    if (jobs.length >= 100) break;
    const title = titleFromBoardRow(row);
    if (!validTitle(title) || GENERIC_NAVIGATION_TITLE.test(title)) continue;
    const urls = [...sourceSpecificDetailUrls(row.block, source), ...urlsFromBlock(row.block, source)];
    const link = urls.find(url => sourceAllows(url, source));
    const action = row.block.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    const identity = action.match(/(?:view|fn_Detail|goView|fnView|detail)\s*\(\s*["']?([^"')\s,]+)/i)?.[1]
      || row.block.match(/(?:data-)?(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo|dataSid|boardSeq|recruitNo|boardNo|noticeNo)\s*=\s*(["'])([^"']+)\1/i)?.[2]
      || `row-${row.start}`;
    const canonical = link ? canonicalJobUrl(link) : `${canonicalJobUrl(source.url)}#list-${encodeURIComponent(identity)}`;
    const key = source.org === '울산복지가족진흥사회서비스원'
      ? `${source.org}|${normalizeTitleForDedup(title)}`
      : `${source.org}|${normalizeTitleForDedup(title)}|${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let detailRequest = null;
    if (source.org === '울산시설공단') {
      // The canonical GET article URL is publicly readable. 52's form POST replay
      // was rejected with HTTP 403 by the live site, so keep the recovered GET URL.
      detailRequest = null;
    } else if (source.org === '울산북구시설관리공단') {
      detailRequest = ubimcPostRequest(row.block, source);
    } else if (source.org === '울산항만공사') {
      const idx = row.block.match(/data-req-get-p-idx=["'](\d+)["']/i)?.[1] || '';
      detailRequest = upaPostRequest(row.block, source, idx);
    } else if (source.org === '한국동서발전') {
      const idx = row.block.match(/(?:onclick=["'][^"']*|href=["']javascript:)?view\(\s*(\d+)\s*\)/i)?.[1] || '';
      detailRequest = ewpPostRequest(source, idx);
    } else if (source.org === '한국수력원자력') {
      detailRequest = khnpDetailRequest(row.block, source);
    } else if (source.org === '한국전력공사') {
      detailRequest = kepcoPageBoard(row.block, source)?.request || null;
    }
    jobs.push({ org: source.org, title, link: canonical, listText: cleanHtml(row.block).replace(/\s+/g, ' ').trim(), adapter: `${source.org}:board-row`, ...(detailRequest ? { detailRequest } : {}), ...(link ? {} : { listOnly: true, listIdentity: identity }) });
    diagnostics.accepted += 1;
    diagnostics.titleMatches += 1;
    if (!link) { diagnostics.listOnlyAccepted += 1; diagnostics.noUrl += 1; }
    if (diagnostics.titleSamples.length < 8) diagnostics.titleSamples.push(title);
    if (action && diagnostics.actionSamples.length < 12) diagnostics.actionSamples.push({ title, action: decodeHtmlEntities(action).slice(0, 600) });
  }
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    diagnostics.anchors += 1;
    if (boardRows.length > 0) continue;
    const attrs = match[1] || '';
    const title = cleanHtml(match[2]).replace(/\s+/g, ' ').trim();
    if (!validTitle(title) || GENERIC_NAVIGATION_TITLE.test(title)) continue;
    diagnostics.titleMatches += 1;
    if (diagnostics.titleSamples.length < 8) diagnostics.titleSamples.push(title);

    let block = enclosingBlock(html, match.index);
    let urls = [...sourceSpecificDetailUrls(block, source), ...candidateUrls(attrs, source)];
    let usedRowFallback = false;
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
    const detailRequest = source.org === '한국수력원자력' ? khnpDetailRequest(block, source)
      : source.org === '한국전력공사' ? kepcoPageBoard(block, source)?.request || null
      : null;
    jobs.push({ org: source.org, title, link: canonical, listText, adapter: source.org, ...(detailRequest ? { detailRequest } : {}) });
    diagnostics.accepted += 1;
    if (usedRowFallback) diagnostics.rowFallbackAccepted += 1;
    if (jobs.length >= 100) break;
  }

  // Some institutional boards do not wrap the subject in an <a> tag. Instead the
  // entire row/card is clickable through onclick, data-url, data-href, or role=link.
  // Scan only bounded row-like blocks so this fallback does not turn page chrome
  // into false job candidates.
  const blockRegex = /<(tr|li|article|div)\b([^>]*(?:onclick|data-href|data-url|role\s*=\s*["']link["'])[^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of (boardRows.length > 0 ? [] : html.matchAll(blockRegex))) {
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


// Phase 50 list-verification templates. These do not create candidates; they only
// identify the board's visible record containers and prove that every extracted
// title belongs to one distinct visible record. This keeps extraction and
// verification as separate responsibilities.
export const LIST_VERIFICATION_TEMPLATES = Object.freeze({
  ALIO_CARD: 'ALIO_CARD',
  API_CONTENT: 'API_CONTENT',
  ROWAREA_RECORD: 'ROWAREA_RECORD',
  HIDDEN_NTTID_ROW: 'HIDDEN_NTTID_ROW',
  TABLE_RECORD: 'TABLE_RECORD'
});

export function listVerificationTemplateFor(source = {}) {
  const url = String(source.url || '');
  if (/job\.alio\.go\.kr/i.test(url)) return LIST_VERIFICATION_TEMPLATES.ALIO_CARD;
  if (source.org === '울산문화관광재단' && /^\s*\{/.test(String(source.__rawHtml || ''))) return LIST_VERIFICATION_TEMPLATES.API_CONTENT;
  if (source.org === '울주문화재단') return LIST_VERIFICATION_TEMPLATES.ROWAREA_RECORD;
  if (source.org === '울주군시설관리공단') return LIST_VERIFICATION_TEMPLATES.HIDDEN_NTTID_ROW;
  return LIST_VERIFICATION_TEMPLATES.TABLE_RECORD;
}

function recordTextsForVerification(html = '', source = {}) {
  const raw = String(html);
  const template = listVerificationTemplateFor({ ...source, __rawHtml: raw });
  if (template === LIST_VERIFICATION_TEMPLATES.API_CONTENT) {
    try {
      const data = JSON.parse(raw);
      return { template, records: (Array.isArray(data.content) ? data.content : []).map(item => String(item.title || '').replace(/\s+/g, ' ').trim()).filter(Boolean) };
    } catch { return { template, records: [] }; }
  }
  if (template === LIST_VERIFICATION_TEMPLATES.ALIO_CARD) {
    const records = [...raw.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(m => m[0]).filter(block => /recruitView\.do\?idx=|recruitView\s*\(/i.test(block))
      .map(block => cleanHtml(block).replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { template, records };
  }
  if (template === LIST_VERIFICATION_TEMPLATES.ROWAREA_RECORD) {
    const records = [...raw.matchAll(/<[^>]+class\s*=\s*(["'])[^"']*rowArea[^"']*\1[^>]*opnIdx\s*=\s*(["'])[^"']+\2[^>]*>([\s\S]*?)(?=<[^>]+class\s*=\s*(["'])[^"']*rowArea|$)/gi)]
      .map(m => cleanHtml(m[0]).replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { template, records };
  }
  if (template === LIST_VERIFICATION_TEMPLATES.HIDDEN_NTTID_ROW) {
    const board = raw.match(/<table\b[^>]*class\s*=\s*(["'])[^"']*board_list[^"']*\1[^>]*>[\s\S]*?<\/table>/i)?.[0] || '';
    const byId = new Map();
    for (const match of board.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const block = match[0];
      const id = block.match(/name\s*=\s*(["'])nttId\1[^>]*value\s*=\s*(["'])(\d+)\2/i)?.[3] || '';
      if (!id || !/type\s*=\s*(["'])submit\1/i.test(block)) continue;
      const title = decodeHtmlEntities(block.match(/<input\b[^>]*type\s*=\s*(["'])submit\1[^>]*value\s*=\s*(["'])([\s\S]*?)\2/i)?.[3] || '').replace(/\s+/g, ' ').trim();
      if (!byId.has(id)) byId.set(id, `${title} ${cleanHtml(block).replace(/\s+/g, ' ').trim()}`.trim());
    }
    return { template, records: [...byId.values()].filter(Boolean) };
  }
  const records = visibleBoardRows(raw).map(row => cleanHtml(row.block).replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { template, records };
}

export function verifyExtractedListAgainstVisibleRecords(html = '', source = {}, candidates = []) {
  const { template, records } = recordTextsForVerification(html, source);
  const normalizedRecords = records.map(normalizeBoardKey);
  const used = new Set();
  const matched = [];
  const unmatched = [];
  for (const candidate of candidates) {
    const title = normalizeBoardKey(candidate.title || '');
    let index = -1;
    if (title) {
      index = normalizedRecords.findIndex((record, i) => !used.has(i) && (record.includes(title) || title.includes(record)));
    }
    if (index >= 0) {
      used.add(index);
      matched.push({ title: candidate.title, recordIndex: index });
    } else unmatched.push(candidate.title);
  }
  const verified = candidates.length > 0 && records.length === candidates.length && unmatched.length === 0 && used.size === records.length;
  return {
    verified,
    template,
    recordCount: records.length,
    candidateCount: candidates.length,
    matchedCount: matched.length,
    unmatchedTitles: unmatched.slice(0, 12),
    recordSamples: records.slice(0, 8),
    level: verified ? `TEMPLATE_${template}_EXACT` : 'TEMPLATE_RECORD_MISMATCH'
  };
}

export function discoverListingUrls(html, source) {
  if (source.org === '근로복지공단' && /comwel\.saramin\.co\.kr/i.test(source.url)) {
    const urls=[source.url], seen=new Set(urls.map(canonicalJobUrl));
    for (const m of String(html).matchAll(/\bhref\s*=\s*(["'])([^"']*\/service\/comwel\/\d+\/applicant\/apply\/recruit_default\.asp[^"']*)\1/gi)) {
      const link=absoluteUrl(m[2],source.url); if(!link) continue;
      const key=canonicalJobUrl(link); if(!seen.has(key)){seen.add(key);urls.push(link);}
    }
    return urls;
  }
  if (source.org === '한국전력공사' && /recruit\.kepco\.co\.kr/i.test(source.url)) {
    return [...new Set([source.url,absoluteUrl('/frt/frt0001/list.do',source.url)].filter(Boolean))];
  }
  if (source.org === '울산문화관광재단') {
    return [source.url, 'https://uctf.or.kr/api/notices?page=0&category=%EC%B1%84%EC%9A%A9'];
  }
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
