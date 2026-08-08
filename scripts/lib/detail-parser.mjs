import fs from 'node:fs';
import path from 'node:path';
const ENTITY_MAP = {
  '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' '
};

export function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, m => ENTITY_MAP[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function decodeHtmlBytes(bytes, contentType = '') {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const header = String(contentType).match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
  const meta = utf8.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i)?.[1]
    || utf8.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^;"'\s]+)/i)?.[1] || '';
  const raw = (header || meta || 'utf-8').toLowerCase();
  const charset = /euc-?kr|ks_c_5601|cp949|windows-949/.test(raw) ? 'euc-kr' : 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return utf8; }
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

function addAttachment(attachments, seen, rawUrl, name, baseUrl, explicitType = '', context = '', request = {}) {
  const decodedRaw = decodeHtmlEntities(rawUrl || '').trim();
  if (!decodedRaw || decodedRaw === '#' || /^#/.test(decodedRaw) || /^javascript:/i.test(decodedRaw)) return;
  const url = absoluteUrl(decodedRaw, baseUrl);
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
    url,
    referer: request.referer || baseUrl,
    cookie: request.cookie || '',
    method: String(request.method || 'GET').toUpperCase(),
    body: request.body || '',
    headers: request.headers || {}
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

function isLikelyDownloadUrl(value = '', label = '') {
  const probe = `${value} ${label}`;
  if (FILE_EXT.test(probe)) return true;
  if (/(?:FileDown|fileDown|download|atchFile|attach|bbsFile)[^?#/]*(?:\.do)?(?:[?#]|$)/i.test(value)) return true;
  try {
    const url = new URL(value, 'https://placeholder.invalid');
    const keys = [...url.searchParams.keys()].join(' ');
    return /atchFileId|fileSn|fileSeq|fileId|fileNo|bbsFile|download/i.test(keys);
  } catch { return false; }
}

function commonFileDownloadCandidates(js = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(js).replace(/\\(["'])/g, '$1');
  const call = decoded.match(/\b[A-Za-z_$][\w$]*\s*\(([^)]*)\)/);
  if (!call) return [];
  const args = splitJavascriptArgs(call[1]).map(jsLiteral).filter(Boolean);
  const atchFileId = args.find(value => /^FILE_[0-9A-Za-z_-]+$/i.test(value));
  const bbsId = args.find(value => /^BBS_[0-9A-Za-z_-]+$/i.test(value));
  const numeric = args.filter(value => /^\d+$/.test(value));
  if (!atchFileId) return [];
  const fileSn = numeric.at(-1) || '0';
  try {
    const base = new URL(baseUrl);
    const root = base.pathname.match(/^(.+?)\/bbs\//i)?.[1] || '';
    const endpoint = `${root}/bbs/FileDown.do`;
    const url = new URL(endpoint, base.origin);
    url.searchParams.set('atchFileId', atchFileId);
    if (bbsId) url.searchParams.set('bbsId', bbsId);
    url.searchParams.set('fileSn', fileSn);
    return [url.href];
  } catch { return []; }
}



function splitJavascriptArgs(value = '') {
  const args = [];
  let current = '', quote = '', depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function jsLiteral(value = '') {
  const trimmed = String(value).trim();
  const match = trimmed.match(/^(?:decodeURIComponent\()?(["'])([\s\S]*?)\1\)?$/);
  return match ? decodeHtmlEntities(match[2].replace(/\\(["'])/g, '$1')) : trimmed;
}

function evaluateJsConcat(expression = '', variables = {}) {
  const parts = splitJavascriptArgs(String(expression).replace(/\s*\+\s*/g, ',')).map(part => part.trim());
  if (!parts.length) return '';
  let output = '';
  for (let part of parts) {
    part = part.replace(/^(?:encodeURIComponent|decodeURIComponent)\(([^)]+)\)$/, '$1').trim();
    if (/^["']/.test(part)) output += jsLiteral(part);
    else if (Object.prototype.hasOwnProperty.call(variables, part)) output += variables[part];
    else return '';
  }
  return output;
}

function javascriptDownloadCandidates(source = '', js = '') {
  const call = decodeHtmlEntities(js).match(/\b([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
  if (!call) return [];
  const functionName = call[1];
  const callArgs = splitJavascriptArgs(call[2]).map(jsLiteral);
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const definition = source.match(new RegExp(`function\\s+${escaped}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]{0,5000}?)\\}`, 'i'));
  if (!definition) return [];
  const params = definition[1].split(',').map(item => item.trim()).filter(Boolean);
  const variables = Object.fromEntries(params.map((param, index) => [param, callArgs[index] || '']));
  const body = definition[2];
  const candidates = [];
  for (const match of body.matchAll(/(?:location(?:\.href)?\s*=|window\.open\s*\(|\.action\s*=)\s*([^;\n]+?)(?:\)|;|$)/gi)) {
    const value = evaluateJsConcat(match[1], variables) || jsLiteral(match[1]);
    if (value && (FILE_SIGNAL.test(value) || FILE_EXT.test(value))) candidates.push(value);
  }
  return [...new Set(candidates)];
}

function extractFormAttachments(source, baseUrl, attachments, seen, request = {}) {
  for (const match of source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = match[1] || '';
    const bodyHtml = match[2] || '';
    const context = `${attrs} ${bodyHtml.slice(0, 2000)}`;
    const action = attrs.match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const hiddenNames = [...bodyHtml.matchAll(/<input\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(input => input[1]).join(' ');
    const actionLooksDownload = isLikelyDownloadUrl(action, context);
    const fieldsLookDownload = /atchFileId|fileSn|fileSeq|fileId|fileNo|download/i.test(hiddenNames);
    if (!action || (!actionLooksDownload && !fieldsLookDownload)) continue;
    if (/\/(?:list|view|main|contents)\.(?:do|ulsan)(?:[?#]|$)/i.test(action) && !actionLooksDownload) continue;
    const method = (attrs.match(/\bmethod\s*=\s*["']([^"']+)["']/i)?.[1] || 'GET').toUpperCase();
    const params = new URLSearchParams();
    for (const input of bodyHtml.matchAll(/<input\b([^>]*)>/gi)) {
      const inputAttrs = input[1] || '';
      const name = inputAttrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
      const value = inputAttrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      if (name) params.append(decodeHtmlEntities(name), decodeHtmlEntities(value));
    }
    let target = absoluteUrl(action, baseUrl);
    if (!target) continue;
    if (method === 'GET' && params.size) {
      const url = new URL(target);
      for (const [key, value] of params) url.searchParams.append(key, value);
      target = url.href;
    }
    addAttachment(attachments, seen, target, cleanHtml(context).slice(0, 160) || '첨부파일', baseUrl, '', context, {
      ...request,
      method,
      body: method === 'POST' ? params.toString() : '',
      headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}
    });
  }
}

export function extractAttachments(html, baseUrl, request = {}) {
  const source = String(html);
  const attachments = [];
  const seen = new Set();

  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || '';
    const label = cleanHtml(match[2]);
    const context = attachmentContext(source, match.index || 0, match[0].length);
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const anchorProbe = `${attrs} ${label} ${href}`;
    const anchorHasDirectFile = FILE_EXT.test(anchorProbe);
    const anchorHasFileSignal = anchorHasDirectFile || FILE_SIGNAL.test(anchorProbe) || ATTACHMENT_CONTEXT.test(context);

    if (anchorHasFileSignal && href && href !== '#' && !/^javascript:/i.test(href) && isLikelyDownloadUrl(href, label)) {
      addAttachment(attachments, seen, href, label, baseUrl, '', context, request);
    }
    const onclickMatch = attrs.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i);
    const js = onclickMatch?.[2] || (/^javascript:/i.test(href) ? href : '');
    const jsCandidates = urlsFromJavascript(js);
    if (anchorHasFileSignal || FILE_SIGNAL.test(js) || jsCandidates.some(candidate => FILE_EXT.test(candidate))) {
      const recovered = [...jsCandidates, ...javascriptDownloadCandidates(source, js), ...commonFileDownloadCandidates(js, baseUrl)];
      for (const candidate of recovered) {
        if (isLikelyDownloadUrl(candidate, label)) addAttachment(attachments, seen, candidate, label, baseUrl, '', context, request);
      }
    }
    for (const attr of ['data-url', 'data-href', 'data-file', 'data-download', 'value']) {
      const valueMatch = attrs.match(new RegExp(`\\b${attr}\\s*=\\s*(["'])((?:(?!\\1).)+)\\1`, 'i'));
      const value = valueMatch?.[2];
      if (value && (anchorHasFileSignal || /file|download/i.test(attr) || FILE_EXT.test(value))) {
        addAttachment(attachments, seen, value, label, baseUrl, '', context, request);
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
    addAttachment(attachments, seen, raw, label, baseUrl, '', context, request);
  }

  extractFormAttachments(source, baseUrl, attachments, seen, request);
  return attachments.slice(0, 24);
}

function titleTokens(value = '') {
  return String(value)
    .replace(/\[[^\]]+\]|\([^)]*\)/g, ' ')
    .replace(/(?:채용|모집|공고|직원|신입|경력|정규직|공무직|무기계약직)/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .trim().split(/\s+/).filter(word => word.length >= 2).slice(0, 8);
}



const DETAIL_BODY_SELECTORS = [
  '.board_view', '.board-view', '.view_cont', '.view-content', '.view_content',
  '.bbs_view', '.bbs-view', '.bbsContent', '.bbs_content', '.boardContent',
  '.board_content', '.article-content', '.article_content', '.contArea', '.contentArea',
  /<(?:div|section|article|td)\b[^>]*(?:id|class)=["'][^"']*(?:board[_-]?(?:view|content|cont)|view[_-]?(?:content|cont|body)|bbs[_-]?(?:view|content|cont)|detail[_-]?(?:content|cont|body)|article[_-]?(?:content|body)|post[_-]?(?:content|body)|contents?|editor|fr-view|se-main-container|bo_v_con)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article|td)>/gi,
  /<article\b[^>]*>([\s\S]*?)<\/article>/gi
];

export function extractDetailBody(html = '', expectedTitle = '') {
  const source = String(html);
  const candidates = [];
  for (const pattern of DETAIL_BODY_SELECTORS) {
    for (const match of source.matchAll(pattern)) {
      const text = cleanHtml(match[1] || match[0]);
      if (text.length >= 80) candidates.push(text);
    }
  }
  const titleWords = titleTokens(expectedTitle);
  candidates.sort((a, b) => {
    const ar = titleWords.length ? titleWords.filter(w => a.includes(w)).length / titleWords.length : 0;
    const br = titleWords.length ? titleWords.filter(w => b.includes(w)).length / titleWords.length : 0;
    return br - ar || b.length - a.length;
  });
  return candidates[0] || cleanHtml(source);
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


const DETAIL_DIAG_DIR = process.env.NEXTJOB_DETAIL_DIAG_DIR || '';

function safeDiagName(value = '') {
  return String(value).normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'detail';
}

function writeDetailDiagnostic({ org = 'unknown', expectedTitle = '', requestedUrl = '', finalUrl = '', status = 0, contentType = '', html = '', error = '', stage = '', verdict = {}, request = null }) {
  if (!DETAIL_DIAG_DIR) return;
  try {
    const dir = path.join(DETAIL_DIAG_DIR, safeDiagName(org), 'detail');
    fs.mkdirSync(dir, { recursive: true });
    const id = new URL(finalUrl || requestedUrl).searchParams.get('nttId')
      || new URL(finalUrl || requestedUrl).searchParams.get('bd_id')
      || new URL(finalUrl || requestedUrl).searchParams.get('num')
      || safeDiagName(expectedTitle);
    const base = safeDiagName(String(id));
    fs.writeFileSync(path.join(dir, `${base}-raw.html`), String(html || ''));
    fs.writeFileSync(path.join(dir, `${base}-meta.json`), JSON.stringify({
      org, expectedTitle, requestedUrl, finalUrl, status, contentType, error, stage,
      requestMethod: request?.method || 'GET',
      verdict
    }, null, 2));
  } catch (diagnosticError) {
    console.error(`[detail-diagnostic] ${org || 'unknown'}: ${diagnosticError?.message || diagnosticError}`);
  }
}

export async function fetchDetail(url, { timeoutMs = 18000, expectedTitle = '', sourceOrg = '', allowedHosts = [], request = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const baseHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  async function requestOne(targetUrl, req = null) {
    const method = String(req?.method || 'GET').toUpperCase();
    const referer = req?.referer || new URL(targetUrl).origin + '/';
    const response = await fetch(req?.url || targetUrl, {
      signal: controller.signal,
      redirect: 'follow',
      method,
      headers: { ...baseHeaders, referer, ...(req?.headers || {}) },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: req?.body || '' })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }

  try {
    // UCTF list is REST-backed. Prefer the matching REST detail object when the
    // public /view/{id} shell does not server-render the notice body.
    if (sourceOrg === '울산문화관광재단') {
      const id = String(url).match(/\/board\/employment\/view\/([^/?#]+)/i)?.[1];
      if (id) {
        try {
          const apiUrl = new URL(`/api/notices/${encodeURIComponent(id)}`, new URL(url).origin).href;
          const apiResponse = await fetch(apiUrl, { signal: controller.signal, redirect: 'follow', headers: { ...baseHeaders, accept: 'application/json,text/plain,*/*', referer: new URL(url).origin + '/board/employment' } });
          if (apiResponse.ok && /json/i.test(apiResponse.headers.get('content-type') || '')) {
            const data = await apiResponse.json();
            const item = data?.data || data?.content || data?.notice || data;
            const title = cleanHtml(String(item?.title || item?.subject || ''));
            const bodyRaw = item?.content || item?.contents || item?.body || item?.description || '';
            const text = cleanHtml(String(bodyRaw));
            const titleProbe = `${title} ${text}`;
            const tokens = titleTokens(expectedTitle);
            const matched = tokens.filter(word => titleProbe.includes(word)).length;
            const titleEvidence = tokens.length < 2 || matched / tokens.length >= 0.35;
            if (titleEvidence && (text.length >= 30 || title.length >= 10)) {
              return { ok: true, finalUrl: url, text: [title, text].filter(Boolean).join('\n').slice(0, 70000), confidence: detailConfidence(text, expectedTitle), httpStatus: apiResponse.status, contentType: apiResponse.headers.get('content-type') || '', attachments: [], detailTransport: 'UCTF_API_DETAIL' };
            }
          }
        } catch { /* try first-page collection API below */ }
        try {
          const listApi = new URL('/api/notices?page=0&category=%EC%B1%84%EC%9A%A9', new URL(url).origin).href;
          const listResponse = await fetch(listApi, { signal: controller.signal, redirect: 'follow', headers: { ...baseHeaders, accept: 'application/json,text/plain,*/*', referer: new URL(url).origin + '/board/employment' } });
          if (listResponse.ok) {
            const payload = await listResponse.json();
            const item = (payload?.content || []).find(entry => String(entry?.id) === String(id));
            if (item) {
              const title = cleanHtml(String(item.title || ''));
              const bodyRaw = String(item.content || '');
              const bodyText = cleanHtml(bodyRaw);
              const imageUrls = [...bodyRaw.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m => absoluteUrl(m[1], url)).filter(Boolean);
              const fileUrls = String(item.filePath || '').split('&').map(v => v.trim()).filter(Boolean);
              const fileNames = String(item.fileName || '').split('&').map(v => v.trim());
              const attachments = fileUrls.map((fileUrl, i) => ({ name: fileNames[i] || `첨부파일 ${i + 1}`, type: fileUrl.split('.').pop()?.split(/[?#]/)[0]?.toLowerCase() || '', url: fileUrl }));
              const titleProbe = `${title} ${bodyText}`;
              const tokens = titleTokens(expectedTitle);
              const matched = tokens.filter(word => titleProbe.includes(word)).length;
              const titleEvidence = tokens.length < 2 || matched / tokens.length >= 0.35;
              if (titleEvidence && (bodyText.length >= 30 || imageUrls.length > 0 || attachments.length > 0)) {
                return { ok: true, finalUrl: url, text: [title, bodyText].filter(Boolean).join('\n').slice(0, 70000), confidence: detailConfidence(`${title} ${bodyText}`, expectedTitle), httpStatus: listResponse.status, contentType: 'application/json', attachments, contentImages: imageUrls, detailTransport: 'UCTF_API_LIST_DETAIL' };
              }
            }
          }
        } catch { /* fall through to public HTML detail */ }
      }
    }

    const response = await requestOne(url, request);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|text\//i.test(contentType)) throw new Error(`unsupported content-type: ${contentType}`);
    const html = await response.text();
    const fullText = cleanHtml(html).slice(0, 70000);
    const text = extractDetailBody(html, expectedTitle).slice(0, 70000);
    const finalUrl = response.url || request?.url || url;
    const cookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      : (response.headers.get('set-cookie') || '').split(/,(?=[^;,]+=)/).map(value => value.split(';')[0]).join('; ');
    const attachments = extractAttachments(html, finalUrl, { referer: finalUrl, cookie });
    const contentImages = [...html.matchAll(/<img\b([^>]*)>/gi)].map(match => {
      const attrs = match[1] || '';
      const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const alt = decodeHtmlEntities(attrs.match(/\b(?:alt|title)\s*=\s*["']([^"']+)["']/i)?.[1] || '');
      return { url: absoluteUrl(src, finalUrl), alt };
    }).filter(item => item.url && !/(logo|icon|btn|banner|common|header|footer|sns|loading)/i.test(`${item.url} ${item.alt}`));
    const metadataTitleText = [
      ...[...html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/gi)].map(m => decodeHtmlEntities(m[1] || '')),
      ...[...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m => cleanHtml(m[1] || '')),
      ...[...html.matchAll(/<(?:h1|h2|h3|strong)[^>]*(?:class|id)=["'][^"']*(?:title|subject|tit)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h1|h2|h3|strong)>/gi)].map(m => cleanHtml(m[1] || ''))
    ].join(' ');
    const expectedTokens = titleTokens(expectedTitle);
    const expectedMatched = expectedTokens.filter(word => fullText.includes(word)).length;
    const titleEvidence = expectedTokens.length < 2 || expectedMatched / expectedTokens.length >= 0.35;

    // Many Korean public boards intentionally keep the HTML body short and put the
    // actual notice in HWP/PDF attachments. A page with the exact list title plus a
    // real attachment is still a valid detail page; attachment contents are handled
    // by the next pipeline stage.
    const structuralEvidence = titleEvidence && (attachments.length > 0 || contentImages.length > 0);
    if (text.length < 100 && !(structuralEvidence && fullText.length >= 20)) {
      writeDetailDiagnostic({ org: sourceOrg, expectedTitle, requestedUrl: url, finalUrl, status: response.status, contentType, html, error: 'detail body too short', stage: 'body-verdict', request, verdict: { textLength: text.length, fullTextLength: fullText.length, attachmentCount: attachments.length, contentImageCount: contentImages.length, titleEvidence } });
      throw new Error('detail body too short');
    }
    const looksLikeListOnly = /전체\s*\d+건의\s*게시물|현재페이지\s*\(\d+\/\d+\)|게시물\s*목록|검색결과\s*\d+건|채용공고\s*목록/.test(fullText) && !/(모집분야|응시자격|접수기간|근무조건|채용인원|공고번호)/.test(text) && !titleEvidence;
    if (looksLikeListOnly) throw new Error('list page detected');
    // Only call it a site error when the response lacks the expected notice title.
    // Some public-site templates contain generic 404/error phrases in hidden markup.
    if (/페이지의\s*주소가\s*올바른지|요청하신\s*페이지를\s*찾을\s*수|존재하지\s*않는\s*페이지|404\s*(?:not\s*found)?/i.test(fullText) && !titleEvidence) throw new Error('site error page detected');
    if (/접근이\s*차단|비정상적인\s*접근|로그인이\s*필요|세션이\s*만료|captcha/i.test(fullText) && !titleEvidence) throw new Error('blocked or login page detected');

    const final = new URL(finalUrl);
    const original = new URL(request?.url || url);
    const normalizedAllowedHosts = [original.hostname, ...allowedHosts].map(host => String(host).replace(/^www\./, ''));
    const finalHost = final.hostname.replace(/^www\./, '');
    if (!normalizedAllowedHosts.some(host => finalHost === host || finalHost.endsWith(`.${host}`))) throw new Error('unexpected redirect domain');
    if (/\/(?:index|main|home)(?:\.|\/|$)/i.test(final.pathname) && !final.search) throw new Error('home page redirect detected');

    const finalParams = [...final.searchParams.keys()];
    const hasDetailPath = /(?:view|detail|read|select|article|boardView|recruitview|noticeView|content\.html)/i.test(final.pathname);
    const hasDetailParam = finalParams.some(key => /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|dataId|bbsId|bcIdx|boardSeq|contsId|employmentId|recruitNo|recruit_no)$/i.test(key));
    const hasStrongBody = /(모집분야|응시자격|접수기간|근무조건|채용인원|공고번호)/.test(text);
    if ((!hasDetailPath && !hasDetailParam && !hasStrongBody && !titleEvidence) || (/(?:list|recruit\.do|contents\.ulsan|noti06\.do)$/i.test(final.pathname) && !hasDetailParam && !hasStrongBody && !titleEvidence && !request)) {
      throw new Error('final url is not a detail page');
    }

    const confidence = detailConfidence(text, expectedTitle);
    if (confidence.structureSignals < 1 && attachments.length === 0 && !(titleEvidence && text.length >= 140)) {
      writeDetailDiagnostic({ org: sourceOrg, expectedTitle, requestedUrl: url, finalUrl, status: response.status, contentType, html, error: 'insufficient detail structure', stage: 'structure-verdict', request, verdict: { textLength: text.length, fullTextLength: fullText.length, attachmentCount: attachments.length, contentImageCount: contentImages.length, titleEvidence } });
      throw new Error('insufficient detail structure');
    }
    if (confidence.tokenCount >= 3 && confidence.titleRatio < 0.25 && attachments.length === 0 && !titleEvidence) throw new Error('detail title mismatch');
    return { ok: true, finalUrl, text: text || fullText, confidence, httpStatus: response.status, contentType, attachments, detailTransport: request?.method ? `FORM_${String(request.method).toUpperCase()}` : 'GET' };
  } catch (error) {
    return { ok: false, finalUrl: request?.url || url, text: '', attachments: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally { clearTimeout(timer); }
}
