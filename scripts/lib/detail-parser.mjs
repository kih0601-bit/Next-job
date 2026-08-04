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
const FILE_SIGNAL = /첨부(?:파일)?|다운로드|download|filedown|atchfile|file_id|fileid|fileSeq|atchFileId|nttFile|fileDown|fileDownload/i;
const ATTACHMENT_CONTEXT = /첨부(?:파일)?|파일\s*목록|download|filedown|atchfile|attach(?:ment)?|bbs[_-]?file|board[_-]?file|file[_-]?(?:list|area|box|wrap)/i;
const STATIC_ASSET_URL = /\/(?:images?|img|assets?|static|common)\/(?:main|common|layout|icon|icons|btn|button|logo|menu|nav|quick|skin)\//i;
const STATIC_ASSET_NAME = /(?:로고|logo|메뉴|menu|home|홈|버튼|button|아이콘|icon|닫기|열기|교육센터|마케팅홍보관|입주안내|시설현황|장비지원|RENET)/i;

function attachmentContext(html = '', index = 0, length = 0) {
  const start = Math.max(0, index - 450);
  const end = Math.min(html.length, index + length + 450);
  return html.slice(start, end);
}

function looksLikeStaticAsset(rawUrl = '', name = '') {
  const probe = `${rawUrl} ${name}`;
  if (STATIC_ASSET_URL.test(rawUrl)) return true;
  if (STATIC_ASSET_NAME.test(name) && !FILE_SIGNAL.test(name)) return true;
  if (/\/(?:logo|icon|btn|button|menu|home|q_menu|allmenu|quick)[^/]*\.(?:png|jpe?g|gif|svg)(?:$|[?#])/i.test(rawUrl)) return true;
  return false;
}

function addAttachment(attachments, seen, rawUrl, name, baseUrl, explicitType = '', context = '') {
  const url = absoluteUrl(rawUrl, baseUrl);
  if (!url || /^javascript:/i.test(url)) return;
  const probe = `${url} ${name} ${explicitType} ${context}`;
  const ext = probe.match(FILE_EXT)?.[1]?.toLowerCase() || String(explicitType || '').toLowerCase();
  const isDocument = /^(?:pdf|hwp|hwpx|doc|docx|xls|xlsx|zip)$/i.test(ext);
  const isImage = /^(?:png|jpe?g|tiff?)$/i.test(ext);
  const explicitFileSignal = FILE_SIGNAL.test(probe);
  const inAttachmentArea = ATTACHMENT_CONTEXT.test(context);

  // Document extensions are accepted directly. Images are accepted only when they
  // are explicitly presented as a post attachment, not as page chrome/assets.
  if (!isDocument && !explicitFileSignal && !(isImage && inAttachmentArea)) return;
  if (isImage && looksLikeStaticAsset(url, name)) return;

  const key = url.split('#')[0];
  if (seen.has(key)) return;
  seen.add(key);
  attachments.push({
    name: cleanHtml(name) || `첨부파일${ext ? `.${ext}` : ''}`,
    type: ext || 'unknown',
    url
  });
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
  const source = String(html);
  const attachments = [];
  const seen = new Set();

  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || '';
    const label = cleanHtml(match[2]);
    const context = attachmentContext(source, match.index || 0, match[0].length);
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const anchorHasFileSignal = FILE_SIGNAL.test(`${attrs} ${label} ${href}`) || ATTACHMENT_CONTEXT.test(context);

    if (anchorHasFileSignal && href && href !== '#' && !/^javascript:/i.test(href)) {
      addAttachment(attachments, seen, href, label, baseUrl, '', context);
    }
    const onclickMatch = attrs.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i);
    const js = onclickMatch?.[2] || (/^javascript:/i.test(href) ? href : '');
    if (anchorHasFileSignal || FILE_SIGNAL.test(js)) {
      for (const candidate of urlsFromJavascript(js)) addAttachment(attachments, seen, candidate, label, baseUrl, '', context);
    }
    for (const attr of ['data-url', 'data-href', 'data-file', 'data-download', 'value']) {
      const valueMatch = attrs.match(new RegExp(`\\b${attr}\\s*=\\s*(["'])((?:(?!\\1).)+)\\1`, 'i'));
      const value = valueMatch?.[2];
      if (value && (anchorHasFileSignal || /file|download/i.test(attr))) {
        addAttachment(attachments, seen, value, label, baseUrl, '', context);
      }
    }
  }

  // Embedded documents are accepted. Images require an attachment-area signal or
  // an explicit attachment label so logos/menu icons are never OCR'd.
  for (const match of source.matchAll(/<(iframe|embed|object|source|img)\b([^>]*)>/gi)) {
    const tag = (match[1] || '').toLowerCase();
    const attrs = match[2] || '';
    const raw = attrs.match(/\b(?:src|data)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const label = attrs.match(/\b(?:title|alt)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const context = attachmentContext(source, match.index || 0, match[0].length);
    const explicit = FILE_SIGNAL.test(`${attrs} ${label} ${raw}`) || ATTACHMENT_CONTEXT.test(context);
    if (!raw) continue;
    if (tag === 'img' && !explicit) continue;
    addAttachment(attachments, seen, raw, label, baseUrl, '', context);
  }

  return attachments.slice(0, 24);
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
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/11.7-candidate-attachment-scope)',
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
