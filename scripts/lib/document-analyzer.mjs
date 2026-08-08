import { extractSupportRequirements } from './requirement-extractor.mjs';
import { extractAttachments } from './detail-parser.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_FILE_BYTES = 18 * 1024 * 1024;
const MAX_TEXT = 90000;
const ANALYZER_VERSION = '2.4-unresolved-attachment-evidence';

function run(command, args, { timeoutMs = 35000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error(`${command} timeout after ${timeoutMs}ms`);
      error.code = 'COMMAND_TIMEOUT';
      error.command = command;
      error.args = args;
      error.stdout = stdout.slice(-1200);
      error.stderr = stderr.slice(-1200);
      reject(error);
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', cause => {
      clearTimeout(timer);
      const error = new Error(`${command} spawn failed: ${cause.message}`);
      error.code = cause.code || 'SPAWN_FAILED';
      error.command = command;
      error.args = args;
      error.stdout = stdout.slice(-1200);
      error.stderr = stderr.slice(-1200);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr, exitCode: code });
      const error = new Error(`${command} exited ${code}`);
      error.code = 'COMMAND_FAILED';
      error.exitCode = code;
      error.command = command;
      error.args = args;
      error.stdout = stdout.slice(-1200);
      error.stderr = stderr.slice(-1200);
      reject(error);
    });
  });
}

async function commandExists(command) {
  try {
    await run('bash', ['-lc', `command -v ${command}`], { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}

function normalizeText(text = '') {
  return String(text)
    .replace(/\u0000/g, ' ')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
}

function fileSignature(bytes) {
  return Buffer.from(bytes.slice(0, 16)).toString('hex');
}

function looksLikeHtml(bytes, contentType = '') {
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  const start = Buffer.from(bytes.slice(0, 500)).toString('utf8').trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body/.test(start) || /페이지를 찾을 수 없습니다|잘못된 접근|로그인이 필요/.test(start);
}

function typeFromContentType(contentType = '') {
  const type = contentType.toLowerCase();
  if (type.includes('application/pdf')) return 'pdf';
  if (type.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) return 'docx';
  if (type.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) return 'xlsx';
  if (type.includes('application/haansofthwp') || type.includes('application/x-hwp')) return 'hwp';
  if (type.includes('application/vnd.hancom.hwpx')) return 'hwpx';
  if (type.includes('msword')) return 'doc';
  if (type.includes('ms-excel')) return 'xls';
  if (type.includes('image/png')) return 'png';
  if (type.includes('image/jpeg')) return 'jpg';
  if (type.includes('image/tiff')) return 'tiff';
  return '';
}

function typeFromFilename(value = '') {
  const match = String(value).toLowerCase().match(/\.((?:pdf|hwpx|hwp|docx|doc|xlsx|xls|png|jpg|jpeg|tif|tiff))(?:$|[?#&\s"'])/i);
  return match ? match[1].toLowerCase() : '';
}

async function inspectZipType(file) {
  if (!(await commandExists('unzip'))) return '';
  try {
    const { stdout: listing } = await run('unzip', ['-Z1', file], { timeoutMs: 12000 });
    if (/^word\/document\.xml$/mi.test(listing)) return 'docx';
    if (/^xl\/workbook\.xml$/mi.test(listing)) return 'xlsx';
    if (/^Contents\/section\d+\.xml$/mi.test(listing) || /^Contents\/content\.hpf$/mi.test(listing)) return 'hwpx';
  } catch {
    return '';
  }
  return '';
}

async function detectActualType({ bytes, contentType, contentDisposition, finalUrl, hintedType, tempFile }) {
  if (looksLikeHtml(bytes, contentType)) return { type: 'html', reason: 'html-response' };
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return { type: 'pdf', reason: 'magic' };
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') return { type: 'png', reason: 'magic' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { type: 'jpg', reason: 'magic' };
  if (buffer.length >= 4 && ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) || (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))) return { type: 'tiff', reason: 'magic' };
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zipType = await inspectZipType(tempFile);
    if (zipType) return { type: zipType, reason: 'zip-contents' };
  }
  const headerType = typeFromContentType(contentType);
  if (headerType) return { type: headerType, reason: 'content-type' };
  const filenameType = typeFromFilename(contentDisposition) || typeFromFilename(finalUrl) || hintedType;
  if (filenameType) return { type: filenameType === 'jpeg' ? 'jpg' : filenameType, reason: 'filename-or-hint' };
  return { type: 'unsupported', reason: 'unknown-format' };
}

async function downloadWithFetch(item, target, timeoutMs = 30000) {
  const url = typeof item === 'string' ? item : item.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = String(item?.method || 'GET').toUpperCase();
    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
      'accept-language': 'ko-KR,ko;q=0.9',
      accept: 'application/pdf,application/octet-stream,application/zip,image/*,*/*;q=0.8',
      ...(item?.headers || {})
    };
    if (item?.referer) headers.referer = item.referer;
    if (item?.cookie) headers.cookie = item.cookie;
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (item?.body || undefined)
    });
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > MAX_FILE_BYTES) throw new Error('attachment too large');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('attachment too large');
    if (!bytes.byteLength) throw new Error('empty attachment');
    await fs.writeFile(target, bytes);
    return {
      bytes,
      finalUrl: response.url || url,
      contentType: response.headers.get('content-type') || '',
      contentDisposition: response.headers.get('content-disposition') || '',
      size: bytes.byteLength,
      signature: fileSignature(bytes)
    };
  } finally {
    clearTimeout(timer);
  }
}


function curlHeaderArgs(headers = {}) {
  return Object.entries(headers).flatMap(([key, value]) => value ? ['-H', `${key}: ${value}`] : []);
}

async function downloadWithCurl(item, target, timeoutMs = 45000) {
  if (!(await commandExists('curl'))) throw new Error('curl unavailable');
  const url = typeof item === 'string' ? item : item.url;
  const method = String(item?.method || 'GET').toUpperCase();
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    'accept-language': 'ko-KR,ko;q=0.9',
    accept: 'application/pdf,application/octet-stream,application/zip,image/*,*/*;q=0.8',
    ...(item?.headers || {})
  };
  if (item?.referer) headers.referer = item.referer;
  if (item?.cookie) headers.cookie = item.cookie;
  const headerFile = `${target}.headers`;
  const args = ['-L', '--fail-with-body', '--silent', '--show-error', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-D', headerFile, '-o', target, ...curlHeaderArgs(headers)];
  if (method !== 'GET') args.push('-X', method);
  if (method !== 'GET' && method !== 'HEAD' && item?.body) args.push('--data-raw', item.body);
  args.push(url);
  await run('curl', args, { timeoutMs: timeoutMs + 5000 });
  const bytes = new Uint8Array(await fs.readFile(target));
  if (!bytes.byteLength) throw new Error('empty attachment');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('attachment too large');
  const rawHeaders = await fs.readFile(headerFile, 'utf8').catch(() => '');
  const blocks = rawHeaders.split(/\r?\n\r?\n/).filter(Boolean);
  const last = blocks.at(-1) || '';
  const headerValue = name => last.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1]?.trim() || '';
  const finalUrl = headerValue('location') ? new URL(headerValue('location'), url).href : url;
  return {
    bytes,
    finalUrl,
    contentType: headerValue('content-type'),
    contentDisposition: headerValue('content-disposition'),
    size: bytes.byteLength,
    signature: fileSignature(bytes),
    transport: 'curl'
  };
}



function findKoshaFileDownInfo(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (typeof value === 'object') {
    if (!Array.isArray(value) && value.data != null && value.key != null
        && ['string','number'].includes(typeof value.data)
        && ['string','number'].includes(typeof value.key)) {
      return { data: String(value.data), key: String(value.key) };
    }
    for (const child of Object.values(value)) {
      const found = findKoshaFileDownInfo(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function writeKoshaDownloadEvidence(item, result) {
  try {
    const dir = path.resolve('data/diagnostics/한국산업안전보건공단/download');
    await fs.mkdir(dir, { recursive: true });
    const id = String(item?.bbsAtcflNo || item?.pstNo || Date.now()).replace(/[^\w.-]+/g,'_');
    const safe = JSON.parse(JSON.stringify(result, (k,v) => /token|password|passwd|secret|authorization|cookie/i.test(k) ? '[redacted]' : v));
    await fs.writeFile(path.join(dir, `${id}-fileDown-response.json`), `${JSON.stringify({
      pstNo:item?.pstNo || '', bbsAtcflNo:item?.bbsAtcflNo || '', bbsId:item?.bbsId || '', response:safe
    }, null, 2)}\n`, 'utf8');
  } catch {}
}

async function resolveKoshaTboardFile(item, timeoutMs = 30000) {
  const endpoint = 'https://www.kosha.or.kr/api/compn24/auth/stdtboard/api.do';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = {
      common: {
        siteCode: '50',
        channelType: 'web',
        boardId: item.bbsId || 'B2025021400005',
        serviceId: 'fileDown'
      },
      data: {
        pstNo: item.pstNo || '',
        bbsAtcflNo: item.bbsAtcflNo || '',
        artclNo: item.artclNo || 'D080100001'
      }
    };
    const response = await fetch(endpoint, {
      signal: controller.signal,
      redirect: 'follow',
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
        accept: 'application/json,text/plain,*/*',
        'content-type': 'application/json;charset=UTF-8',
        chnlId: 'kosha24',
        referer: item.referer || 'https://www.kosha.or.kr/notification/jobncontract/job'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`KOSHA fileDown API HTTP ${response.status}`);
    const result = await response.json();
    const info = result?.data?.fileDownInfo || result?.response?.fileDownInfo || result?.fileDownInfo || findKoshaFileDownInfo(result);
    if (!info?.data || !info?.key) {
      await writeKoshaDownloadEvidence(item, result);
      const code = result?.common?.result?.code ?? result?.code ?? '';
      throw new Error(`KOSHA fileDown metadata missing${code !== '' ? ` (code ${code})` : ''}`);
    }
    const url = new URL('https://www.kosha.or.kr/api/compn24/auth/stdtboard/fileDownload.do');
    url.searchParams.set('data', String(info.data));
    url.searchParams.set('key', String(info.key));
    return {
      ...item,
      resolver: '',
      url: url.href,
      method: 'GET',
      body: '',
      headers: {},
      referer: item.referer || 'https://www.kosha.or.kr/notification/jobncontract/job'
    };
  } finally {
    clearTimeout(timer);
  }
}

function egovAlternateDownloadItem(item = {}) {
  try {
    const url = new URL(item.url || '');
    if (!/ubimc\.or\.kr$/i.test(url.hostname)) return null;
    if (!/\/cop\/cmm\/fms\/FileDown\.do$/i.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/cop\/cmm\/fms\/FileDown\.do$/i, '/cmm/fms/FileDown.do');
    return { ...item, url: url.href };
  } catch { return null; }
}

async function resolveHtmlAttachmentGateway(item, meta, timeoutMs = 30000) {
  if (!looksLikeHtml(meta?.bytes || [], meta?.contentType || '')) return null;
  const sourceUrl = meta?.finalUrl || item?.url || '';
  // Known attachment-management/intermediate pages. Do not recursively parse
  // arbitrary HTML responses such as a board list form.
  if (!/(?:fileUpload|fileList|attach|atchFile)/i.test(sourceUrl)) return null;
  const html = Buffer.from(meta.bytes).toString('utf8');
  const nested = extractAttachments(html, sourceUrl, {
    referer: sourceUrl,
    cookie: item?.cookie || ''
  }).filter(candidate => candidate.url && candidate.url !== sourceUrl);
  if (!nested.length) return null;
  nested.sort((a,b) => documentPriority(b) - documentPriority(a));
  return nested[0];
}

async function download(item, target, timeoutMs = 30000) {
  let resolvedItem = item;
  if (item?.resolver === 'KOSHA_TBOARD_FILE') {
    resolvedItem = await resolveKoshaTboardFile(item, timeoutMs);
  }

  const attempt = async candidate => {
    try {
      const result = await downloadWithFetch(candidate, target, timeoutMs);
      return { ...result, transport: 'node-fetch', resolvedItem: candidate };
    } catch (fetchError) {
      try {
        const result = await downloadWithCurl(candidate, target, Math.max(timeoutMs, 45000));
        return { ...result, resolvedItem: candidate };
      } catch (curlError) {
        const error = new Error(`${fetchError.message} / curl: ${curlError.message}`);
        error.code = curlError.code || fetchError.code || '';
        error.command = curlError.command || '';
        error.args = curlError.args || [];
        error.stdout = curlError.stdout || '';
        error.stderr = curlError.stderr || '';
        error.fetchError = fetchError;
        error.curlError = curlError;
        throw error;
      }
    }
  };

  try {
    return await attempt(resolvedItem);
  } catch (primaryError) {
    const alternate = egovAlternateDownloadItem(resolvedItem);
    if (!alternate) throw primaryError;
    try {
      const result = await attempt(alternate);
      return { ...result, resolutionTrace: [`egov-alt:${resolvedItem.url}`, `egov-alt:${alternate.url}`] };
    } catch {
      throw primaryError;
    }
  }
}

async function extractPdf(file) {
  if (!(await commandExists('pdftotext'))) throw new Error('pdftotext unavailable');
  const output = `${file}.txt`;
  await run('pdftotext', ['-layout', '-enc', 'UTF-8', file, output]);
  let text = normalizeText(await fs.readFile(output, 'utf8'));
  if (text.length >= 40) return { text, method: 'pdftotext' };
  if (!(await commandExists('pdftoppm')) || !(await commandExists('tesseract'))) throw new Error('scanned PDF and OCR unavailable');
  const prefix = `${file}-page`;
  await run('pdftoppm', ['-f', '1', '-l', '8', '-jpeg', '-r', '180', file, prefix], { timeoutMs: 65000 });
  const pages = (await fs.readdir(path.dirname(file)))
    .filter(name => name.startsWith(path.basename(prefix)) && /\.jpg$/i.test(name))
    .sort();
  const chunks = [];
  for (const page of pages) {
    chunks.push((await run('tesseract', [path.join(path.dirname(file), page), 'stdout', '-l', 'kor+eng', '--psm', '6'], { timeoutMs: 45000 })).stdout);
  }
  text = normalizeText(chunks.join('\n'));
  if (text.length < 20) throw new Error('OCR text too short');
  return { text, method: 'pdf-ocr' };
}

async function extractHwp(file) {
  if (!(await commandExists('hwp5txt'))) throw new Error('hwp5txt unavailable');
  const text = normalizeText((await run('hwp5txt', [file], { timeoutMs: 45000 })).stdout);
  return { text, method: 'hwp5txt' };
}

async function extractZipXml(file, entries) {
  if (!(await commandExists('unzip'))) throw new Error('unzip unavailable');
  const chunks = [];
  for (const entry of entries) {
    try { chunks.push((await run('unzip', ['-p', file, entry], { timeoutMs: 15000 })).stdout); } catch { /* optional */ }
  }
  return normalizeText(chunks.join('\n').replace(/<[^>]+>/g, ' '));
}

async function extractHwpx(file) {
  const { stdout: listing } = await run('unzip', ['-Z1', file]);
  const entries = listing.split(/\r?\n/).filter(name => /^Contents\/section\d+\.xml$/i.test(name)).sort();
  return { text: await extractZipXml(file, entries), method: 'hwpx-xml' };
}

async function extractDocx(file) {
  return { text: await extractZipXml(file, ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']), method: 'docx-xml' };
}

async function extractXlsx(file) {
  const { stdout: listing } = await run('unzip', ['-Z1', file]);
  const entries = listing.split(/\r?\n/).filter(name => /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/i.test(name));
  return { text: await extractZipXml(file, entries), method: 'xlsx-xml' };
}

async function extractImage(file) {
  if (!(await commandExists('tesseract'))) throw new Error('tesseract unavailable');
  return {
    text: normalizeText((await run('tesseract', [file, 'stdout', '-l', 'kor+eng', '--psm', '6'], { timeoutMs: 45000 })).stdout),
    method: 'image-ocr'
  };
}

async function extractLegacyOffice(file, type, workDir) {
  if (type === 'doc' && await commandExists('antiword')) {
    return { text: normalizeText((await run('antiword', [file])).stdout), method: 'antiword' };
  }
  if (!(await commandExists('libreoffice'))) throw new Error('libreoffice unavailable');
  await run('libreoffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', workDir, file], { timeoutMs: 75000 });
  const converted = path.join(workDir, `${path.basename(file, path.extname(file))}.txt`);
  return { text: normalizeText(await fs.readFile(converted, 'utf8')), method: 'libreoffice' };
}

function attachmentType(attachment = {}) {
  const probe = `${attachment.type || ''} ${attachment.name || ''} ${attachment.url || ''}`.toLowerCase();
  for (const type of ['pdf', 'hwpx', 'hwp', 'docx', 'doc', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'tif', 'tiff']) {
    if (new RegExp(`\\.${type}(?:$|[?#&\\s])|\\b${type}\\b`, 'i').test(probe)) return type;
  }
  return 'unknown';
}

function documentPriority(item) {
  const name = String(item.name || '').toLowerCase();
  if (/채용공고|모집공고|채용계획|응시자격|직무기술|직무설명|채용분야/.test(name)) return 100;
  if (/공고|채용|직무|자격|모집/.test(name)) return 70;
  if (/응시원서|지원서|자기소개서|개인정보|반환청구|동의서|서약서|양식/.test(name)) return 10;
  return 40;
}

function summarizeResults(results) {
  const byDetectedType = {};
  const byError = {};
  const byContentType = {};
  for (const result of results) {
    const detected = result.detectedType || result.type || 'unknown';
    byDetectedType[detected] = (byDetectedType[detected] || 0) + 1;
    const contentType = result.contentType || 'none';
    byContentType[contentType] = (byContentType[contentType] || 0) + 1;
    if (!result.ok) {
      const error = result.error || 'unknown';
      byError[error] = (byError[error] || 0) + 1;
    }
  }
  return { byDetectedType, byContentType, byError };
}


const TOOL_COMMANDS = ['pdftotext', 'pdftoppm', 'tesseract', 'hwp5txt', 'unzip', 'antiword', 'libreoffice', 'file'];

export async function getDocumentToolDiagnostics() {
  const tools = {};
  for (const command of TOOL_COMMANDS) {
    try {
      const location = (await run('bash', ['-lc', `command -v ${command}`], { timeoutMs: 5000 })).stdout.trim();
      let version = '';
      try {
        const versionArgs = command === 'libreoffice' ? ['--version'] : command === 'tesseract' ? ['--version'] : ['-v'];
        const result = await run(command, versionArgs, { timeoutMs: 7000 });
        version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0].slice(0, 240);
      } catch (error) {
        version = `version-check-failed: ${error.message}`;
      }
      tools[command] = { available: true, location, version };
    } catch (error) {
      tools[command] = { available: false, error: error.message };
    }
  }
  return { analyzerVersion: ANALYZER_VERSION, platform: process.platform, node: process.version, tools };
}

function serializeCommandError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code || '',
    exitCode: error?.exitCode ?? null,
    command: error?.command || '',
    args: error?.args || [],
    stdout: error?.stdout || '',
    stderr: error?.stderr || ''
  };
}

function coverageSummary({ attempted = 0, successful = 0 } = {}) {
  if (attempted <= 0) return { capabilityOk: false, complete: false, status: 'not-attempted', ratio: null };
  const capabilityOk = successful > 0;
  const complete = successful === attempted;
  return { capabilityOk, complete, status: complete ? 'complete' : capabilityOk ? 'partial' : 'failed', ratio: successful / attempted };
}

export async function analyzeAttachments(attachments = [], { maxFiles = 12 } = {}) {
  const results = [];
  const prepared = attachments.map(a => ({ ...a, hintedType: attachmentType(a) }));
  const hasDocumentCandidate = prepared.some(item => /^(?:pdf|hwp|hwpx|doc|docx|xls|xlsx)$/i.test(item.hintedType));
  const selected = prepared
    .filter(item => !hasDocumentCandidate || !/^(?:png|jpg|jpeg|tif|tiff)$/i.test(item.hintedType))
    .sort((a, b) => documentPriority(b) - documentPriority(a))
    .slice(0, maxFiles);

  if (!selected.length) {
    return {
      text: '', results, successful: 0, attempted: 0, downloaded: 0, discovered: attachments.length,
      analyzerVersion: ANALYZER_VERSION, diagnostics: summarizeResults(results),
      capabilityOk: false, coverage: coverageSummary({ attempted: 0, successful: 0 })
    };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextjob-doc-'));
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      const tempFile = path.join(dir, `attachment-${index}.bin`);
      let meta = null;
      try {
        meta = await download(item, tempFile);
        let effectiveItem = item;
        let gatewayTrace = [];
        let detected = await detectActualType({
          bytes: meta.bytes,
          contentType: meta.contentType,
          contentDisposition: meta.contentDisposition,
          finalUrl: meta.finalUrl,
          hintedType: item.hintedType,
          tempFile
        });
        if (detected.type === 'html') {
          const nested = await resolveHtmlAttachmentGateway(item, meta);
          if (nested) {
            gatewayTrace = [meta.finalUrl || item.url, nested.url];
            effectiveItem = { ...nested, hintedType: attachmentType(nested) };
            meta = await download(effectiveItem, tempFile);
            detected = await detectActualType({
              bytes: meta.bytes,
              contentType: meta.contentType,
              contentDisposition: meta.contentDisposition,
              finalUrl: meta.finalUrl,
              hintedType: effectiveItem.hintedType,
              tempFile
            });
          }
        }
        if (detected.type === 'html') throw new Error('download returned HTML page');
        if (detected.type === 'unsupported' || detected.type === 'unknown') throw new Error('unsupported or unknown attachment format');

        const ext = detected.type === 'jpeg' ? 'jpg' : detected.type;
        const file = path.join(dir, `attachment-${index}.${ext}`);
        await fs.rename(tempFile, file);

        let extracted;
        if (ext === 'pdf') extracted = await extractPdf(file);
        else if (ext === 'hwp') extracted = await extractHwp(file);
        else if (ext === 'hwpx') extracted = await extractHwpx(file);
        else if (ext === 'docx') extracted = await extractDocx(file);
        else if (ext === 'xlsx') extracted = await extractXlsx(file);
        else if (['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) extracted = await extractImage(file);
        else extracted = await extractLegacyOffice(file, ext, dir);

        if (extracted.text.length < 20) throw new Error('extracted text too short');
        results.push({
          name: item.name,
          url: item.url,
          finalUrl: meta.finalUrl,
          hintedType: item.hintedType,
          detectedType: ext,
          detectionReason: detected.reason,
          contentType: meta.contentType,
          contentDisposition: meta.contentDisposition,
          signature: meta.signature,
          transport: meta.transport || '',
          downloaded: true,
          ok: true,
          size: meta.size,
          textLength: extracted.text.length,
          method: extracted.method,
          priority: documentPriority(item),
          requestMethod: effectiveItem.method || item.method || 'GET',
          resolver: item.resolver || '',
          resolutionTrace: [...(meta.resolutionTrace || []), ...gatewayTrace],
          resolvedUrl: effectiveItem.url || item.url,
          text: extracted.text
        });
      } catch (error) {
        results.push({
          name: item.name,
          url: item.url,
          finalUrl: meta?.finalUrl || '',
          hintedType: item.hintedType,
          detectedType: '',
          contentType: meta?.contentType || '',
          contentDisposition: meta?.contentDisposition || '',
          signature: meta?.signature || '',
          transport: meta?.transport || '',
          size: meta?.size || 0,
          downloaded: Boolean(meta?.size),
          ok: false,
          error: error.message,
          commandError: serializeCommandError(error),
          priority: documentPriority(item),
          requestMethod: item.method || 'GET',
          resolver: item.resolver || '',
          resolutionTrace: meta?.resolutionTrace || []
        });
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  const successful = results.filter(result => result.ok);
  const downloaded = results.filter(result => result.downloaded);
  const combinedText = successful.map(result => result.text || '').filter(Boolean).join('\n');
  const requirements = extractSupportRequirements({ documentText: combinedText });
  return {
    text: successful
      .filter(result => result.priority >= 40)
      .map(result => `### ${result.name}\n${result.text}`)
      .join('\n\n')
      .slice(0, MAX_TEXT),
    results,
    successful: successful.length,
    attempted: results.length,
    downloaded: downloaded.length,
    discovered: attachments.length,
    analyzerVersion: ANALYZER_VERSION,
    diagnostics: summarizeResults(results),
    requirements,
    capabilityOk: successful.length > 0,
    coverage: coverageSummary({ attempted: results.length, successful: successful.length })
  };
}
