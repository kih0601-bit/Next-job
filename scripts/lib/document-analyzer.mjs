import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_FILE_BYTES = 18 * 1024 * 1024;
const MAX_TEXT = 90000;
const ANALYZER_VERSION = '11.2-public-documents';

function run(command, args, { timeoutMs = 35000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timeout`)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 300)}`)); });
  });
}

async function commandExists(command) {
  try { await run('bash', ['-lc', `command -v ${command}`], { timeoutMs: 3000 }); return true; }
  catch { return false; }
}

async function download(url, target, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; NextJobDocumentAnalyzer/11.2)', 'accept-language': 'ko-KR,ko;q=0.9' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > MAX_FILE_BYTES) throw new Error('attachment too large');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('attachment too large');
    await fs.writeFile(target, bytes);
    return { finalUrl: response.url || url, contentType: response.headers.get('content-type') || '', size: bytes.byteLength };
  } finally { clearTimeout(timer); }
}

function normalizeText(text = '') {
  return String(text).replace(/\u0000/g, ' ').replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, MAX_TEXT);
}

async function extractPdf(file) {
  if (!(await commandExists('pdftotext'))) throw new Error('pdftotext unavailable');
  const output = `${file}.txt`;
  await run('pdftotext', ['-layout', '-enc', 'UTF-8', file, output]);
  let text = normalizeText(await fs.readFile(output, 'utf8'));
  if (text.length >= 80) return { text, method: 'pdftotext' };
  if (!(await commandExists('pdftoppm')) || !(await commandExists('tesseract'))) throw new Error('scanned PDF and OCR unavailable');
  const prefix = `${file}-page`;
  await run('pdftoppm', ['-f', '1', '-l', '8', '-jpeg', '-r', '180', file, prefix], { timeoutMs: 55000 });
  const pages = (await fs.readdir(path.dirname(file))).filter(name => name.startsWith(path.basename(prefix)) && /\.jpg$/i.test(name)).sort();
  const chunks = [];
  for (const page of pages) {
    const pageText = await run('tesseract', [path.join(path.dirname(file), page), 'stdout', '-l', 'kor+eng', '--psm', '6'], { timeoutMs: 35000 });
    chunks.push(pageText);
  }
  text = normalizeText(chunks.join('\n'));
  if (text.length < 40) throw new Error('OCR text too short');
  return { text, method: 'pdf-ocr' };
}

async function extractHwp(file) {
  if (!(await commandExists('hwp5txt'))) throw new Error('hwp5txt unavailable');
  return { text: normalizeText(await run('hwp5txt', [file])), method: 'hwp5txt' };
}

async function extractZipXml(file, entries) {
  if (!(await commandExists('unzip'))) throw new Error('unzip unavailable');
  const chunks = [];
  for (const entry of entries) {
    try { chunks.push(await run('unzip', ['-p', file, entry])); } catch { /* optional entry */ }
  }
  return normalizeText(chunks.join('\n').replace(/<[^>]+>/g, ' '));
}

async function extractHwpx(file) {
  const listing = await run('unzip', ['-Z1', file]);
  const entries = listing.split(/\r?\n/).filter(name => /^Contents\/section\d+\.xml$/i.test(name)).sort();
  const text = await extractZipXml(file, entries);
  return { text, method: 'hwpx-xml' };
}

async function extractDocx(file) {
  const text = await extractZipXml(file, ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']);
  return { text, method: 'docx-xml' };
}

async function extractXlsx(file) {
  const listing = await run('unzip', ['-Z1', file]);
  const entries = listing.split(/\r?\n/).filter(name => /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/i.test(name));
  const text = await extractZipXml(file, entries);
  return { text, method: 'xlsx-xml' };
}

async function extractImage(file) {
  if (!(await commandExists('tesseract'))) throw new Error('tesseract unavailable');
  const text = normalizeText(await run('tesseract', [file, 'stdout', '-l', 'kor+eng', '--psm', '6'], { timeoutMs: 35000 }));
  return { text, method: 'image-ocr' };
}

async function extractLegacyOffice(file, type, workDir) {
  if (type === 'doc' && await commandExists('antiword')) return { text: normalizeText(await run('antiword', [file])), method: 'antiword' };
  if (!(await commandExists('libreoffice'))) throw new Error('libreoffice unavailable');
  await run('libreoffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', workDir, file], { timeoutMs: 60000 });
  const converted = path.join(workDir, `${path.basename(file, path.extname(file))}.txt`);
  return { text: normalizeText(await fs.readFile(converted, 'utf8')), method: 'libreoffice' };
}

function attachmentType(attachment = {}) {
  const probe = `${attachment.type || ''} ${attachment.name || ''} ${attachment.url || ''}`.toLowerCase();
  for (const type of ['pdf', 'hwpx', 'hwp', 'docx', 'doc', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'tif', 'tiff']) {
    if (new RegExp(`\\.${type}(?:$|[?#\\s])|\\b${type}\\b`, 'i').test(probe)) return type;
  }
  return 'unsupported';
}

function documentPriority(item) {
  const name = String(item.name || '').toLowerCase();
  if (/채용공고|모집공고|채용계획|응시자격|직무기술|직무설명|채용분야/.test(name)) return 100;
  if (/공고|채용|직무|자격|모집/.test(name)) return 70;
  if (/응시원서|지원서|자기소개서|개인정보|반환청구|동의서|서약서|양식/.test(name)) return 10;
  return 40;
}

export async function analyzeAttachments(attachments = [], { maxFiles = 12 } = {}) {
  const results = [];
  const selected = attachments
    .map(a => ({ ...a, detectedType: attachmentType(a) }))
    .filter(a => a.detectedType !== 'unsupported')
    .sort((a, b) => documentPriority(b) - documentPriority(a))
    .slice(0, maxFiles);
  if (!selected.length) return { text: '', results, successful: 0, attempted: 0, discovered: attachments.length, analyzerVersion: ANALYZER_VERSION };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextjob-doc-'));
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      const ext = item.detectedType === 'jpeg' ? 'jpg' : item.detectedType;
      const file = path.join(dir, `attachment-${index}.${ext}`);
      try {
        const meta = await download(item.url, file);
        let extracted;
        if (item.detectedType === 'pdf') extracted = await extractPdf(file);
        else if (item.detectedType === 'hwp') extracted = await extractHwp(file);
        else if (item.detectedType === 'hwpx') extracted = await extractHwpx(file);
        else if (item.detectedType === 'docx') extracted = await extractDocx(file);
        else if (item.detectedType === 'xlsx') extracted = await extractXlsx(file);
        else if (['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(item.detectedType)) extracted = await extractImage(file);
        else extracted = await extractLegacyOffice(file, item.detectedType, dir);
        if (extracted.text.length < 40) throw new Error('extracted text too short');
        results.push({ name: item.name, url: item.url, type: item.detectedType, ok: true, size: meta.size, textLength: extracted.text.length, method: extracted.method, priority: documentPriority(item), text: extracted.text });
      } catch (error) {
        results.push({ name: item.name, url: item.url, type: item.detectedType, ok: false, error: error.message, priority: documentPriority(item) });
      }
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  const successful = results.filter(r => r.ok);
  return {
    text: successful.filter(r => r.priority >= 40).map(r => `### ${r.name}\n${r.text}`).join('\n\n').slice(0, MAX_TEXT),
    results,
    successful: successful.length,
    attempted: results.length,
    discovered: attachments.length,
    analyzerVersion: ANALYZER_VERSION
  };
}
