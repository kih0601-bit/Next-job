import fs from 'node:fs';
import path from 'node:path';
import { safeFileComponent, shortStableHash } from './safe-filename.mjs';
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
const FILE_SIGNAL = /첨부(?:파일)?|다운로드|download|filedown|atchfile|file_id|fileid|fileSeq|atchFileId|nttFile|fileDown|fileDownload|downFile|ctitFile|fileLink/i;
const ATTACHMENT_CONTEXT = /첨부(?:파일)?|파일\s*목록|download|filedown|atchfile|attach(?:ment)?|bbs[_-]?file|board[_-]?file|file[_-]?(?:list|area|box|wrap)/i;
const STATIC_ASSET_URL = /\/(?:images?|img|assets?|static|common)\/(?:main|common|layout|icon|icons|btn|button|logo|menu|nav|quick|skin)\//i;
const STATIC_ASSET_NAME = /(?:로고|logo|메뉴|menu|home|홈|버튼|button|아이콘|icon|닫기|열기|교육센터|마케팅홍보관|입주안내|시설현황|장비지원|RENET|공공누리|KOGL|출처표시)/i;

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
  if (/\/common\/img\//i.test(rawUrl) && /\.(?:png|jpe?g|gif|svg)(?:$|[?#])/i.test(rawUrl)) return true;
  return false;
}


function candidateType(item = {}) {
  const explicit = String(item.type || '').toLowerCase();
  if (explicit) return explicit;
  const probe = `${item.name || ''} ${item.url || ''}`;
  return probe.match(/\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|png|jpe?g|tiff?|zip)(?:$|[?#\s)])/i)?.[1]?.toLowerCase() || '';
}
function isDocumentAttachmentCandidate(item = {}) {
  return /^(?:pdf|hwp|hwpx|doc|docx|xls|xlsx|zip)$/i.test(candidateType(item));
}
function isImageAttachmentCandidate(item = {}) {
  return /^(?:png|jpg|jpeg|tif|tiff)$/i.test(candidateType(item));
}
function isKnownUiAttachmentCandidate(item = {}) {
  if (!isImageAttachmentCandidate(item)) return false;
  const probe = `${item.name || ''} ${item.url || ''}`;
  return /(?:^|[\/_.-])(?:ico|icon|btn|button|logo|menu|nav|quick|home|kogl)(?:[\/_.-]|$)/i.test(probe)
    || /(?:파일\s*다운로드|다운로드\s*아이콘|공공누리|출처표시)/i.test(String(item.name || ''))
    || /\/(?:img|images|assets|static)\/[^?#]*(?:ico|icon|btn|button|logo|menu|nav|quick|home|kogl)[^?#]*/i.test(String(item.url || ''));
}
function isKnownGlobalCertificationDocument(item = {}) {
  const name = String(item.name || '');
  const url = String(item.url || '');
  // Site-wide footer certifications are real PDFs, but never recruitment attachments.
  // EWP's detail HTML repeats these links on every post and v78 counted them as files.
  return /(?:웹접근성|웹개방성|ISO\s*27001|ISO\s*27701|ISMS-?P)\s*(?:인증)?(?:마크)?/i.test(name)
    || /\/kor\/download\/(?:wa\/wa\.pdf|web_open\/web_open_2022\.pdf|IC\.pdf|PI\.pdf)(?:[?#]|$)/i.test(url);
}

function purifyAttachmentCandidates(items = []) {
  const cleaned = items.filter(item => !isKnownUiAttachmentCandidate(item) && !isKnownGlobalCertificationDocument(item));
  const hasDocument = cleaned.some(isDocumentAttachmentCandidate);
  return hasDocument ? cleaned.filter(item => !isImageAttachmentCandidate(item)) : cleaned;
}

function addAttachment(attachments, seen, rawUrl, name, baseUrl, explicitType = '', context = '', request = {}) {
  const decodedRaw = decodeHtmlEntities(rawUrl || '').trim();
  if (!decodedRaw || decodedRaw === '#' || /^#/.test(decodedRaw) || /^javascript:/i.test(decodedRaw)) return;
  const url = absoluteUrl(decodedRaw, baseUrl);
  if (!url || /^javascript:/i.test(url)) return;
  const probe = `${url} ${name} ${explicitType} ${context}`;
  // Page chrome can sit inside an attachment-area DOM and therefore inherit an
  // attachment signal. Reject known static assets before extension inference so
  // SVG icons (not part of FILE_EXT) cannot become unknown-type attachments.
  if (looksLikeStaticAsset(url, name)) return;
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

function egovFileDownCandidates(js = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(js);
  const call = decoded.match(/\bfn_egov_downFile\s*\(\s*["'](FILE_[0-9A-Za-z_-]+)["']\s*,\s*["']?(\d+)["']?\s*\)/i);
  if (!call) return [];
  try {
    const base = new URL(baseUrl);
    const prefix = base.pathname.match(/^(.+?)\/(?:bbs|cop)\//i)?.[1] || '';
    const out = new URL(`${prefix}/cmm/fms/FileDown.do`, base.origin);
    out.searchParams.set('atchFileId', call[1]);
    out.searchParams.set('fileSn', call[2]);
    return [out.href];
  } catch { return []; }
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
    // A board navigation form may contain hidden fields whose names include "file"
    // while still posting back to the list/detail controller. Never classify those
    // forms as attachments unless the ACTION itself is a download endpoint.
    if (/\/(?:[^/?#]*(?:list|List|view|View|detail|Detail|article|Article)[^/?#]*)\.(?:do|ulsan)(?:[?#]|$)/i.test(action) && !actionLooksDownload) continue;
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


function normalizeInstitutionAttachmentDuplicates(items = [], baseUrl = '') {
  let host = '';
  try { host = new URL(baseUrl).hostname.replace(/^www\./,''); } catch {}
  if (host !== 'hrdkorea.or.kr') return items;
  const direct = items.some(item => /\/cms\/download\/downloadFile\.hrd\?[^#]*\battachSeq=\d+/i.test(String(item.url || '')));
  if (!direct) return items;
  return items.filter(item => !/\/cms\/download\/downloadFile2\.hrd(?:[?#]|$)/i.test(String(item.url || '')));
}


function extractConfirmedInstitutionAttachments(source = '', baseUrl = '', request = {}) {
  const attachments = [];
  const seen = new Set();
  let host = '';
  try { host = new URL(baseUrl).hostname.replace(/^www\./,''); } catch {}

  if (host === 'uic.or.kr') {
    for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs=match[1]||'', label=cleanHtml(match[2]);
      const token=attrs.match(/\bfn_egov_downFile\s*\(\s*["']([^"']+)["']\s*\)/i)?.[1]||'';
      if (!token) continue;
      const url=new URL('/cmm/fms/FileDownNotice.do',new URL(baseUrl).origin).href+`?atchFileId=${token}`;
      addAttachment(attachments,seen,url,label,baseUrl,'',attachmentContext(source,match.index||0,match[0].length),request);
    }
  }

  if (host === 'energy.or.kr') {
    for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs=match[1]||'', label=cleanHtml(match[2]);
      const call=attrs.match(/\bfileDownload\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/i);
      if (!call) continue;
      const url=new URL('/commonFile/fileDownload.do',new URL(baseUrl).origin).href;
      const body=new URLSearchParams({fileNo:call[1],fileSeq:call[2],boardMngNo:call[3]}).toString();
      addAttachment(attachments,seen,url,label,baseUrl,'',attachmentContext(source,match.index||0,match[0].length),{
        ...request,method:'POST',body,headers:{...(request.headers||{}),'content-type':'application/x-www-form-urlencoded; charset=UTF-8'}
      });
    }
  }

  if (host === 'ewp.co.kr') {
    const form = source.match(/<form\b[^>]*name=["']reform["'][^>]*>([\s\S]*?)<\/form>/i);
    const baseParams = new URLSearchParams();
    if (form) {
      for (const input of form[1].matchAll(/<input\b([^>]*)>/gi)) {
        const attrs = input[1] || '';
        const name = attrs.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2] || '';
        const value = attrs.match(/\bvalue\s*=\s*(["'])([^"']*)\1/i)?.[2] || '';
        if (name) baseParams.set(decodeHtmlEntities(name), decodeHtmlEntities(value));
      }
    }
    for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = match[1] || '', label = cleanHtml(match[2]);
      const call = attrs.match(/\bnew_down\s*\(\s*["']?(\d+)["']?\s*,\s*["']?(\d+)["']?\s*\)/i);
      if (!call || !FILE_EXT.test(label)) continue;
      const params = new URLSearchParams(baseParams);
      params.set('idx_to', call[1]);
      params.set('order_num', call[2]);
      const url = new URL('/kor/include/new_download.html', new URL(baseUrl).origin).href;
      addAttachment(attachments, seen, url, label, baseUrl, '', attachmentContext(source, match.index || 0, match[0].length), {
        ...request, method: 'POST', body: params.toString(),
        headers: { ...(request.headers || {}), 'content-type': 'application/x-www-form-urlencoded' },
        referer: baseUrl
      });
    }
  }

  if (host === 'ulsan.go.kr') {
    const anchors=[...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    for (let i=0;i<anchors.length;i+=1) {
      const attrs=anchors[i][1]||'', label=cleanHtml(anchors[i][2]);
      const href=attrs.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]||'';
      if (!FILE_EXT.test(label)||!/^\/u\/?$/i.test(href.trim())) continue;
      const preview=anchors.slice(i+1,i+4).map(item=>{
        const aa=item[1]||'', ll=cleanHtml(item[2]);
        const hh=aa.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]||'';
        return {label:ll,href:hh};
      }).find(item=>/미리보기/.test(item.label)&&/\/enc\/convert\/encBoardFile\.ulsan/i.test(item.href)&&!/initTTS=true/i.test(item.href));
      if (!preview) continue;
      const url=absoluteUrl(preview.href,baseUrl);
      if (!url||seen.has(url)) continue;
      seen.add(url);
      attachments.push({name:label,type:label.match(FILE_EXT)?.[1]?.toLowerCase()||'unknown',url,
        referer:request.referer||baseUrl,cookie:request.cookie||'',method:'GET',body:'',headers:request.headers||{},resolver:'ULSAN_ENC_BOARD_FILE'});
    }
  }
  return attachments;
}

export function extractAttachments(html, baseUrl, request = {}) {
  const source = String(html);
  const attachments = [];
  const seen = new Set();
  for (const item of extractConfirmedInstitutionAttachments(source, baseUrl, request)) {
    attachments.push(item);
    seen.add(item.url.split('#')[0]);
  }

  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || '';
    const label = cleanHtml(match[2]);
    const context = attachmentContext(source, match.index || 0, match[0].length);
    const href = attrs.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
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
      const recovered = /\bfn_egov_downFile\s*\(/i.test(js) ? egovFileDownCandidates(js, baseUrl) : [...jsCandidates, ...javascriptDownloadCandidates(source, js), ...commonFileDownloadCandidates(js, baseUrl)];
      for (const candidate of recovered) {
        if (isLikelyDownloadUrl(candidate, label)) addAttachment(attachments, seen, candidate, label, baseUrl, '', context, request);
      }
    }
    for (const attr of ['data-url', 'data-href', 'data-file', 'data-download', 'data-file-url', 'data-download-url', 'data-attach-url', 'value']) {
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
  let purified=normalizeInstitutionAttachmentDuplicates(purifyAttachmentCandidates(attachments),baseUrl);
  if (purified.some(item=>item.resolver==='ULSAN_ENC_BOARD_FILE')) {
    purified=purified.filter(item=>{
      if (item.resolver==='ULSAN_ENC_BOARD_FILE') return true;
      const url=String(item.url||''), name=String(item.name||'');
      if (/미리보기|미리듣기/.test(name)) return false;
      if (/\/enc\/convert\/encBoardFile\.ulsan/i.test(url)) return false;
      try { const u=new URL(url); if (u.hostname.replace(/^www\./,'')==='ulsan.go.kr'&&/^\/u\/?$/.test(u.pathname)) return false; } catch {}
      return true;
    });
  }
  return purified.slice(0,24);
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

export function extractDetailBody(html = '', expectedTitle = '', sourceOrg = '') {
  const source = String(html);
  const candidates = [];

  if (sourceOrg === '울주군시설관리공단') {
    const marker = source.search(/<div\b[^>]*class=["'][^"']*\bb_con\b[^"']*["'][^>]*>/i);
    if (marker >= 0) {
      const tail = source.slice(marker);
      const end = tail.search(/<div\b[^>]*class=["'][^"']*(?:btn_area|board_btn|list_btn)[^"']*["']/i);
      const block = end > 0 ? tail.slice(0, end) : tail.slice(0, 50000);
      const text = cleanHtml(block);
      if (text.length >= 80) candidates.push(text);
    }
  }

  if (sourceOrg === '울산정보산업진흥원') {
    const board = source.match(/<div\b[^>]*class=["'][^"']*\bboard_view\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*(?:board_btn|btn_area|list_btn)|<\/section>|<\/main>|$)/i)?.[0] || '';
    const cont = board.match(/<dd\b[^>]*class=["'][^"']*\bcont\b[^"']*["'][^>]*>[\s\S]*?<\/dd>/i)?.[0] || board;
    const text = cleanHtml(cont);
    if (text.length >= 30) candidates.push(text);
  }
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

function safeDiagName(value = '') { return safeFileComponent(value, { fallback:'detail', maxBytes:64, maxChars:30 }); }
function safeDiagArtifactStem(value = '') {
  const raw=String(value||'');
  if (/^[A-Za-z0-9._-]{1,48}$/.test(raw)) return raw;
  return `item-${shortStableHash(raw)}`;
}

function writeDetailDiagnostic({ org = 'unknown', expectedTitle = '', requestedUrl = '', finalUrl = '', status = 0, contentType = '', html = '', error = '', stage = '', verdict = {}, request = null }) {
  if (!DETAIL_DIAG_DIR) return;
  try {
    const dir = path.join(DETAIL_DIAG_DIR, safeDiagName(org), 'detail');
    fs.mkdirSync(dir, { recursive: true });
    const id = new URL(finalUrl || requestedUrl).searchParams.get('nttId')
      || new URL(finalUrl || requestedUrl).searchParams.get('bd_id')
      || new URL(finalUrl || requestedUrl).searchParams.get('num')
      || expectedTitle;
    const base = safeDiagArtifactStem(String(id));
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



function writeAttachmentResolutionDiagnostic({ org = '', expectedTitle = '', finalUrl = '', html = '', scripts = [], attachments = [] }) {
  if (!DETAIL_DIAG_DIR || !['울산시설공단','한국에너지공단','울산복지가족진흥사회서비스원','한국동서발전'].includes(org)) return;
  // EWP can expose a filename while still losing the request contract. Keep the
  // detail evidence even when an attachment candidate exists; for the other
  // institutions this diagnostic remains failure-only.
  if (org !== '한국동서발전' && attachments.length > 0) return;
  try {
    const dir = path.join(DETAIL_DIAG_DIR, safeDiagName(org), 'attachment-resolution');
    fs.mkdirSync(dir, { recursive: true });
    let id = '';
    try {
      const parsed = new URL(finalUrl);
      id = parsed.searchParams.get('employmentId') || parsed.searchParams.get('boardNo') || '';
    } catch {}
    const base = safeDiagArtifactStem(id || expectedTitle);
    fs.writeFileSync(path.join(dir, `${base}-detail.html`), String(html || ''));
    const snippets = [];
    for (const pattern of [
      /(?:onclick|href|src|action)\s*=\s*["'][^"']*(?:file|attach|atch|down)[^"']*["']/gi,
      /\b(?:atchFileId|fileSn|fileSeq|fileId|fileNo|boardNo|employmentId|new_download)\b[^<>"'\n]{0,320}/gi,
      /<a\b[^>]*(?:new_download|download|attach|file)[^>]*>[\s\S]{0,800}?<\/a>/gi,
      /<form\b[^>]*>[\s\S]{0,2400}?(?:new_download|download|attach|file)[\s\S]{0,2400}?<\/form>/gi,
      /\b(?:CtitFile|fn_[A-Za-z0-9_]*(?:file|down)[A-Za-z0-9_]*)\s*\([^)]{0,900}\)/gi
    ]) {
      for (const match of String(html || '').matchAll(pattern)) snippets.push(match[0]);
    }
    const scriptEvidence = scripts.map((item, index) => {
      const body = String(item.body || '');
      const filename = `${base}-external-${index + 1}.js`;
      fs.writeFileSync(path.join(dir, filename), body);
      return {
        url: item.url,
        file: filename,
        functions: [...body.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)|([A-Za-z_$][\w$]*)\s*[:=]\s*function\s*\([^)]*\))/g)]
          .map(m => m[1] || m[2]).filter(name => /file|down|attach|ctit/i.test(name)).slice(0,80),
        endpoints: [...body.matchAll(/["'`]([^"'`]{1,260}(?:file|download|attach|atch)[^"'`]{0,260})["'`]/gi)]
          .map(m => m[1]).filter(v => !/\.(?:png|jpg|gif|svg|css|woff)(?:[?#]|$)/i.test(v)).slice(0,160)
      };
    });
    fs.writeFileSync(path.join(dir, `${base}-evidence.json`), JSON.stringify({
      org, expectedTitle, finalUrl, attachmentCount: attachments.length,
      htmlLength: String(html || '').length,
      snippets: [...new Set(snippets)].slice(0,240),
      scripts: scriptEvidence
    }, null, 2));
  } catch (error) {
    console.error(`[attachment-resolution-diagnostic] ${org}: ${error?.message || error}`);
  }
}

async function externalAttachmentScriptSource(html = '', baseUrl = '', sourceOrg = '', signal = undefined) {
  if (sourceOrg !== '한국에너지공단') return { source: String(html), scripts: [] };
  const scriptUrls = [...String(html).matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']*(?:CtitFile|file)[^"']*\.js(?:\?[^"']*)?)\1/gi)]
    .map(match => absoluteUrl(match[2], baseUrl))
    .filter(Boolean);
  const unique = [...new Set(scriptUrls)].slice(0, 4);
  if (!unique.length) return { source: String(html), scripts: [] };
  const scripts = [];
  for (const scriptUrl of unique) {
    try {
      const response = await fetch(scriptUrl, {
        signal,
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
          accept: 'text/javascript,application/javascript,*/*;q=0.8',
          referer: baseUrl
        }
      });
      if (!response.ok) continue;
      const body = await response.text();
      if (body.length < 20) continue;
      scripts.push({ url: response.url || scriptUrl, body: body.slice(0, 120000) });
    } catch { /* evidence-only enhancement; normal detail parsing must continue */ }
  }
  return {
    source: `${String(html)}\n${scripts.map(item => `<script data-nextjob-external="${item.url}">${item.body}</script>`).join('\n')}`,
    scripts
  };
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
    // KOSHA official recruitment board is a Vue SPA backed by the captured
    // standard TBoard API. The public jobdata URL is a shell, so resolve the
    // notice through boardDetail using the pstNo embedded in the official URL.
    if (sourceOrg === '한국산업안전보건공단') {
      const pstNo = new URL(url).searchParams.get('pstNo');
      if (pstNo) {
        const apiUrl = 'https://kosha.or.kr/api/compn24/auth/stdtboard/api.do';
        const payload = {
          common: { siteCode:'50', channelType:'web', boardId:'B2025021400005', serviceId:'boardDetail' },
          data: { pstNo }
        };
        const apiResponse = await fetch(apiUrl, {
          signal: controller.signal,
          redirect: 'follow',
          method: 'POST',
          headers: {
            ...baseHeaders,
            accept: 'application/json,text/plain,*/*',
            'content-type': 'application/json;charset=UTF-8',
            chnlId: 'kosha24',
            referer: 'https://www.kosha.or.kr/notification/jobncontract/job'
          },
          body: JSON.stringify(payload)
        });
        if (!apiResponse.ok) throw new Error(`KOSHA detail API HTTP ${apiResponse.status}`);
        const result = await apiResponse.json();
        const code = String(result?.common?.result?.code || '');
        if (code && code !== '200') throw new Error(`KOSHA detail API result ${code}`);
        const item = result?.data?.boardDetail || {};
        const files = Array.isArray(result?.data?.fileList) ? result.data.fileList : [];
        const titleKeys = ['pstTtl','pstSj','pstTitle','title','subject','sj','ttl','bbsTtl','artclSj','pstNm'];
        const title = cleanHtml(String(titleKeys.map(k=>item?.[k]).find(Boolean) || expectedTitle || ''));
        const textParts = [];
        for (const [key,value] of Object.entries(item)) {
          if (value == null || typeof value === 'object') continue;
          const clean = cleanHtml(String(value));
          if (clean && clean.length > 1 && !/^(?:Y|N|\d{1,4})$/.test(clean)) textParts.push(clean);
        }
        const text = [...new Set([title, ...textParts])].join('\n').slice(0,70000);
        const tokens = titleTokens(expectedTitle);
        const matched = tokens.filter(word => `${title} ${text}`.includes(word)).length;
        const titleEvidence = tokens.length < 2 || matched / tokens.length >= 0.35;
        if (!titleEvidence || text.length < 30) throw new Error('KOSHA detail API body validation failed');
        const attachments = files.map((file,i)=>{
          const name = String(file?.bbsOrgnlAtcflNm || file?.orgnlAtcflNm || file?.atcflNm || file?.fileNm || `첨부파일 ${i+1}`);
          return {
            name,
            type: String(file?.bbsAtcflExtnNm || name.split('.').pop() || '').toLowerCase(),
            url: 'https://www.kosha.or.kr/api/compn24/auth/stdtboard/api.do',
            resolver: 'KOSHA_TBOARD_FILE',
            pstNo: String(file?.pstNo || pstNo),
            bbsAtcflNo: String(file?.bbsAtcflNo || ''),
            bbsId: String(file?.bbsId || 'B2025021400005'),
            artclNo: 'D080100001',
            referer: url
          };
        }).filter(file => file.bbsAtcflNo);
        return {
          ok: true, finalUrl: url, text,
          confidence: detailConfidence(text, expectedTitle),
          httpStatus: apiResponse.status, contentType: 'application/json',
          attachments, detailTransport: 'KOSHA_TBOARD_API_DETAIL'
        };
      }
    }

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
              const attachments = fileUrls.map((fileUrl, i) => {
                const name = fileNames[i] || `첨부파일 ${i + 1}`;
                let url = fileUrl;
                try {
                  const parsed = new URL(fileUrl);
                  if (/\/api\/files\//i.test(parsed.pathname) && !parsed.searchParams.has('name')) {
                    parsed.searchParams.set('name', name);
                    url = parsed.href;
                  }
                } catch { /* keep raw file URL */ }
                return { name, type: fileUrl.split('.').pop()?.split(/[?#]/)[0]?.toLowerCase() || '', url };
              });
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    const html = decodeHtmlBytes(bytes, contentType);
    const fullText = cleanHtml(html).slice(0, 70000);
    const text = extractDetailBody(html, expectedTitle, sourceOrg).slice(0, 70000);
    const finalUrl = response.url || request?.url || url;
    const cookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      : (response.headers.get('set-cookie') || '').split(/,(?=[^;,]+=)/).map(value => value.split(';')[0]).join('; ');
    const externalAttachmentScripts = await externalAttachmentScriptSource(html, finalUrl, sourceOrg, controller.signal);
    const attachments = extractAttachments(externalAttachmentScripts.source, finalUrl, { referer: finalUrl, cookie });
    writeAttachmentResolutionDiagnostic({ org: sourceOrg, expectedTitle, finalUrl, html, scripts: externalAttachmentScripts.scripts, attachments });
    const imageScope = sourceOrg === '울산정보산업진흥원'
      ? (html.match(/<dd\b[^>]*class=["'][^"']*\bcont\b[^"']*["'][^>]*>[\s\S]*?<\/dd>/i)?.[0] || html)
      : html;
    const contentImages = [...imageScope.matchAll(/<img\b([^>]*)>/gi)].map(match => {
      const attrs = match[1] || '';
      const src = attrs.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
      const alt = decodeHtmlEntities(attrs.match(/\b(?:alt|title)\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '');
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
    const hasDetailParam = finalParams.some(key => /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|dataId|bbsId|bcIdx|boardSeq|contsId|employmentId|recruitNo|recruit_no)$/i.test(key))
      || (sourceOrg === '한국석유공사' && final.searchParams.get('mode') === 'view' && /^\d+$/.test(final.searchParams.get('num') || ''));
    const hasStrongBody = /(모집분야|응시자격|접수기간|근무조건|채용인원|공고번호)/.test(text);
    if ((!hasDetailPath && !hasDetailParam && !hasStrongBody && !titleEvidence) || (/(?:list|recruit\.do|contents\.ulsan|noti06\.do)$/i.test(final.pathname) && !hasDetailParam && !hasStrongBody && !titleEvidence && !request)) {
      throw new Error('final url is not a detail page');
    }

    const confidence = detailConfidence(text, expectedTitle);
    if (confidence.structureSignals < 1 && attachments.length === 0 && contentImages.length === 0 && !(titleEvidence && text.length >= 140)) {
      writeDetailDiagnostic({ org: sourceOrg, expectedTitle, requestedUrl: url, finalUrl, status: response.status, contentType, html, error: 'insufficient detail structure', stage: 'structure-verdict', request, verdict: { textLength: text.length, fullTextLength: fullText.length, attachmentCount: attachments.length, contentImageCount: contentImages.length, titleEvidence } });
      throw new Error('insufficient detail structure');
    }
    if (confidence.tokenCount >= 3 && confidence.titleRatio < 0.25 && attachments.length === 0 && !titleEvidence) throw new Error('detail title mismatch');
    const attachmentSignalCount = (html.match(/첨부(?:파일)?|다운로드|download|filedown|atchfile|fileSeq|fileDown|fileDownload|downFile|ctitFile|data-file-url|data-download-url/gi) || []).length;
    const explicitNoAttachment = /(?:첨부파일[^<\n]{0,80})?(?:등록된\s*파일이\s*없습니다|첨부(?:된)?\s*파일이\s*없습니다|첨부파일\s*없음|등록된\s*첨부파일이\s*없습니다)/i.test(fullText) || (sourceOrg === '울주문화재단' && /hubst\.co\.kr/i.test(finalUrl) && attachments.length === 0 && !FILE_EXT.test(fullText));
    return { ok: true, finalUrl, text: text || fullText, confidence, httpStatus: response.status, contentType, attachments, contentImages, attachmentSignalCount, explicitNoAttachment, rawHtml: html, externalAttachmentScripts: externalAttachmentScripts.scripts.map(item => ({ url:item.url, body:item.body })), detailTransport: request?.method ? `FORM_${String(request.method).toUpperCase()}` : (contentImages.length ? 'IMAGE_CONTENT_PAGE' : 'GET') };
  } catch (error) {
    return { ok: false, finalUrl: request?.url || url, text: '', attachments: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally { clearTimeout(timer); }
}
