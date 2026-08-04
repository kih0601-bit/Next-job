import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT = 50000;

function run(command, args, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timeout`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function commandExists(command) {
  try { await run('bash', ['-lc', `command -v ${command}`], { timeoutMs: 3000 }); return true; }
  catch { return false; }
}

async function download(url, target, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; NextJobDocumentAnalyzer/11.0)', 'accept-language': 'ko-KR,ko;q=0.9' }
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
  return normalizeText(await fs.readFile(output, 'utf8'));
}

async function extractHwp(file) {
  if (!(await commandExists('hwp5txt'))) throw new Error('hwp5txt unavailable');
  return normalizeText(await run('hwp5txt', [file]));
}

async function extractDocx(file) {
  if (!(await commandExists('unzip'))) throw new Error('unzip unavailable');
  const xml = await run('unzip', ['-p', file, 'word/document.xml']);
  return normalizeText(xml.replace(/<w:tab\/?\s*>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' '));
}

function attachmentType(attachment = {}) {
  const probe = `${attachment.type || ''} ${attachment.name || ''} ${attachment.url || ''}`.toLowerCase();
  if (/\.pdf(?:$|[?#\s])|\bpdf\b/.test(probe)) return 'pdf';
  if (/\.hwp(?:$|[?#\s])|\bhwp\b/.test(probe)) return 'hwp';
  if (/\.hwpx(?:$|[?#\s])|\bhwpx\b/.test(probe)) return 'hwpx';
  if (/\.docx(?:$|[?#\s])|\bdocx\b/.test(probe)) return 'docx';
  return 'unsupported';
}

export async function analyzeAttachments(attachments = [], { maxFiles = 3 } = {}) {
  const results = [];
  const selected = attachments.map(a => ({ ...a, detectedType: attachmentType(a) }))
    .filter(a => ['pdf', 'hwp', 'docx'].includes(a.detectedType)).slice(0, maxFiles);
  if (!selected.length) return { text: '', results, successful: 0, attempted: 0 };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextjob-doc-'));
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      const file = path.join(dir, `attachment-${index}.${item.detectedType}`);
      try {
        const meta = await download(item.url, file);
        let text = '';
        if (item.detectedType === 'pdf') text = await extractPdf(file);
        else if (item.detectedType === 'hwp') text = await extractHwp(file);
        else if (item.detectedType === 'docx') text = await extractDocx(file);
        if (text.length < 40) throw new Error('extracted text too short');
        results.push({ name: item.name, url: item.url, type: item.detectedType, ok: true, size: meta.size, textLength: text.length, text });
      } catch (error) {
        results.push({ name: item.name, url: item.url, type: item.detectedType, ok: false, error: error.message });
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  const successful = results.filter(r => r.ok);
  return { text: successful.map(r => r.text).join('\n\n').slice(0, MAX_TEXT), results, successful: successful.length, attempted: results.length };
}
