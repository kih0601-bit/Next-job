const ENTITY_MAP = {
  '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' '
};

export function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, m => ENTITY_MAP[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function cleanHtml(html = '') {
  return decodeHtmlEntities(String(html))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function absoluteUrl(href, baseUrl) {
  try { return new URL(decodeHtmlEntities(href), baseUrl).href; }
  catch { return ''; }
}

const FILE_EXT = /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|png|jpe?g|tiff?|zip)(?:$|[?#\s])/i;
const FILE_SIGNAL = /첨부|다운로드|download|filedown|atchfile|file_id|fileid|fileSeq|atchFileId|nttFile/i;

function addAttachment(attachments, seen, rawUrl, name, baseUrl, explicitType = '') {
  const url = absoluteUrl(rawUrl, baseUrl);
  if (!url || /^javascript:/i.test(url)) return;
  const probe = `${url} ${name} ${explicitType}`;
  const ext = probe.match(FILE_EXT)?.[1]?.toLowerCase() || String(explicitType || '').toLowerCase();
  if (!ext && !FILE_SIGNAL.test(probe)) return;
  const key = url.split('#')[0];
  if (seen.has(key)) return;
  seen.add(key);
  attachments.push({ name: cleanHtml(name) || `첨부파일${ext ? `.${ext}` : ''}`, type: ext || 'unknown', url });
}

function urlsFromJavascript(value = '') {
  const decoded = decodeHtmlEntities(value).replace(/\\(['"])/g, '$1');
  const urls = [];
  for (const pattern of [
    /(?:location(?:\.href)?\s*=|window\.open\s*\()\s*["']([^"']+)["']/gi,
    /["']((?:https?:\/\/|\/|\.\/|\.\.\/)[^"']+)["']/gi
  ]) {
    for (const match of decoded.matchAll(pattern)) if (!urls.includes(match[1])) urls.push(match[1]);
  }
  return urls;
}

export function extractAttachments(html, baseUrl) {
  const attachments = [];
  const seen = new Set();

  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || '';
    const label = cleanHtml(match[2]);
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (href && href !== '#' && !/^javascript:/i.test(href)) addAttachment(attachments, seen, href, label, baseUrl);
    const onclickMatch = attrs.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i);
    const js = onclickMatch?.[2] || (/^javascript:/i.test(href) ? href : '');
    for (const candidate of urlsFromJavascript(js)) addAttachment(attachments, seen, candidate, label, baseUrl);
    for (const attr of ['data-url', 'data-href', 'data-file', 'data-download', 'value']) {
      const valueMatch = attrs.match(new RegExp(`\\b${attr}\\s*=\\s*([\"'])((?:(?!\\1).)+)\\1`, 'i'));
      const value = valueMatch?.[2];
      if (value) addAttachment(attachments, seen, value, label, baseUrl);
    }
  }

  for (const match of String(html).matchAll(/<(?:iframe|embed|object|source|img)\b([^>]*)>/gi)) {
    const attrs = match[1] || '';
    const raw = attrs.match(/\b(?:src|data)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const label = attrs.match(/\b(?:title|alt)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (raw) addAttachment(attachments, seen, raw, label, baseUrl);
  }

  return attachments.slice(0, 50);
}

function titleTokens(value = '') {
  return String(value)
    .replace(/\[[^\]]+\]|\([^)]*\)/g, ' ')
    .replace(/(?:채용|모집|공고|직원|신입|경력|정규직|공무직|무기계약직)/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .trim().split(/\s+/).filter(word => word.length >= 2).slice(0, 8);
}

function detailConfidence(text = '', expectedTitle = '') {
  const structureSignals = [
    /모집분야|채용분야/, /응시자격|지원자격/, /접수기간|원서접수/,
    /근무조건|근무지/, /채용인원|모집인원/, /전형절차|전형방법/, /공고번호/
  ].filter(pattern => pattern.test(text)).length;
  const tokens = titleTokens(expectedTitle);
  const matched = tokens.filter(word => text.includes(word)).length;
  const titleRatio = tokens.length ? matched / tokens.length : 1;
  return { structureSignals, matched, tokenCount: tokens.length, titleRatio };
}

export async function fetchDetail(url, { timeoutMs = 18000, expectedTitle = '', sourceOrg = '', allowedHosts = [] } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/11.2-collection-documents)',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|text\//i.test(contentType)) throw new Error(`unsupported content-type: ${contentType}`);
    const html = await response.text();
    const text = cleanHtml(html).slice(0, 70000);
    if (text.length < 100) throw new Error('detail body too short');
    const looksLikeListOnly = /전체\s*\d+건의\s*게시물|현재페이지\s*\(\d+\/\d+\)|게시물\s*목록|검색결과\s*\d+건|채용공고\s*목록/.test(text) && !/(모집분야|응시자격|접수기간|근무조건|채용인원|공고번호)/.test(text);
    if (looksLikeListOnly) throw new Error('list page detected');
    if (/페이지의\s*주소가\s*올바른지|요청하신\s*페이지를\s*찾을\s*수|존재하지\s*않는\s*페이지|404\s*(?:not\s*found)?/i.test(text)) throw new Error('site error page detected');
    if (/접근이\s*차단|비정상적인\s*접근|로그인이\s*필요|세션이\s*만료|captcha/i.test(text)) throw new Error('blocked or login page detected');

    const finalUrl = response.url || url;
    const final = new URL(finalUrl);
    const original = new URL(url);
    const normalizedAllowedHosts = [original.hostname, ...allowedHosts].map(host => String(host).replace(/^www\./, ''));
    const finalHost = final.hostname.replace(/^www\./, '');
    if (!normalizedAllowedHosts.some(host => finalHost === host || finalHost.endsWith(`.${host}`))) throw new Error('unexpected redirect domain');
    if (/\/(?:index|main|home)(?:\.|\/|$)/i.test(final.pathname) && !final.search) throw new Error('home page redirect detected');

    const finalParams = [...final.searchParams.keys()];
    const hasDetailPath = /(?:view|detail|read|select|article|boardView|recruitview|noticeView)/i.test(final.pathname);
    const hasDetailParam = finalParams.some(key => /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|recruit_no)$/i.test(key));
    const attachments = extractAttachments(html, finalUrl);
    const hasStrongBody = /(모집분야|응시자격|접수기간|근무조건|채용인원|공고번호)/.test(text);
    if ((!hasDetailPath && !hasDetailParam && !hasStrongBody) || (/(?:list|recruit\.do|contents\.ulsan|noti06\.do)$/i.test(final.pathname) && !hasDetailParam && !hasStrongBody)) {
      throw new Error('final url is not a detail page');
    }

    const confidence = detailConfidence(text, expectedTitle);
    if (confidence.structureSignals < 1 && attachments.length === 0) throw new Error('insufficient detail structure');
    if (confidence.tokenCount >= 3 && confidence.titleRatio < 0.25 && attachments.length === 0) throw new Error('detail title mismatch');
    return { ok: true, finalUrl, text, confidence, httpStatus: response.status, contentType, attachments };
  } catch (error) {
    return { ok: false, finalUrl: url, text: '', attachments: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally { clearTimeout(timer); }
}
