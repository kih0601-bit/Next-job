import fs from 'node:fs/promises';
import { SOURCES, SOURCE_REGISTRY_VERSION } from './collectors/source-registry.mjs';
import { extractCandidatesForSource, discoverListingUrls } from './collectors/source-adapters.mjs';
import { cleanHtml, fetchDetail } from './lib/detail-parser.mjs';

const VERSION = '15.1-phase5-pipeline-probe';
const MAX_LISTING_PAGES = 3;
const MAX_DETAIL_SAMPLES = 2;
const ACCESS_TIMEOUT_MS = 7000;
const LIST_TIMEOUT_MS = 7000;

function headers(referer = '') {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'ko-KR,ko;q=0.9',
    ...(referer ? { referer } : {})
  };
}

async function fetchHtml(url, timeoutMs = 22000, referer = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: headers(referer) });
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (html.trim().length < 80) throw new Error('response body too short');
    return { html, status: response.status, finalUrl: response.url || url, contentType: response.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function firstAccessible(source) {
  const attempts = [];
  for (const url of source.accessUrls || [source.url]) {
    try {
      const result = await fetchHtml(url, ACCESS_TIMEOUT_MS, source.homepage || '');
      attempts.push({ url, ok: true, status: result.status, finalUrl: result.finalUrl });
      return { ...result, requestedUrl: url, attempts };
    } catch (error) {
      attempts.push({ url, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message });
    }
  }
  const error = new Error('all access URLs failed');
  error.attempts = attempts;
  throw error;
}

function permissiveTitle(title = '') {
  const text = cleanHtml(title).replace(/\s+/g, ' ').trim();
  if (text.length < 4 || text.length > 260) return false;
  if (/^(?:홈|메인|목록|이전|다음|처음|마지막|더보기|바로가기)$/i.test(text)) return false;
  return true;
}

function normalizeTitle(title = '') {
  return cleanHtml(title).replace(/[^0-9a-zA-Z가-힣]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function probeSource(source) {
  const startedAt = Date.now();
  const report = {
    org: source.org,
    access: { ok: false, attempts: [] },
    list: { ok: false, pagesChecked: 0, candidateCount: 0, samples: [], errors: [] },
    detail: { ok: false, attempted: 0, validated: 0, samples: [] },
    attachment: { ok: false, discovered: 0, samples: [] },
    bottleneck: '',
    elapsedMs: 0
  };
  try {
    const access = await firstAccessible(source);
    report.access = { ok: true, requestedUrl: access.requestedUrl, finalUrl: access.finalUrl, status: access.status, contentType: access.contentType, attempts: access.attempts };
    const activeSource = { ...source, url: access.finalUrl || access.requestedUrl };
    const listingUrls = [activeSource.url];
    if (source.discoverListings) {
      for (const url of discoverListingUrls(access.html, activeSource)) if (!listingUrls.includes(url)) listingUrls.push(url);
    }
    const all = [];
    for (const [index, url] of listingUrls.slice(0, MAX_LISTING_PAGES).entries()) {
      try {
        const page = index === 0 ? access : await fetchHtml(url, LIST_TIMEOUT_MS, activeSource.url);
        report.list.pagesChecked += 1;
        const pageSource = { ...activeSource, url: page.finalUrl || url };
        const found = extractCandidatesForSource(page.html, pageSource, { validTitle: permissiveTitle, normalizeTitleForDedup: normalizeTitle });
        for (const item of found) if (!all.some(existing => existing.link === item.link)) all.push(item);
      } catch (error) {
        report.list.errors.push(`${url}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
      }
    }
    report.list.candidateCount = all.length;
    report.list.samples = all.slice(0, 8).map(item => ({ title: item.title, link: item.link, adapter: item.adapter || '' }));
    report.list.ok = all.length > 0;

    const allowedHosts = [...new Set((source.accessUrls || [source.url]).map(url => { try { return new URL(url).hostname; } catch { return ''; } }).filter(Boolean))];
    for (const candidate of all.slice(0, MAX_DETAIL_SAMPLES)) {
      report.detail.attempted += 1;
      const detail = await fetchDetail(candidate.link, { expectedTitle: candidate.title, sourceOrg: source.org, allowedHosts });
      if (detail.ok) report.detail.validated += 1;
      report.attachment.discovered += detail.attachments?.length || 0;
      report.detail.samples.push({ title: candidate.title, requestedUrl: candidate.link, ok: detail.ok, finalUrl: detail.finalUrl || '', textLength: detail.text?.length || 0, attachmentCount: detail.attachments?.length || 0, error: detail.error || '' });
      for (const file of detail.attachments || []) {
        if (report.attachment.samples.length < 8) report.attachment.samples.push({ name: file.name, type: file.type, url: file.url });
      }
    }
    report.detail.ok = report.detail.validated > 0;
    report.attachment.ok = report.attachment.discovered > 0;
    if (!report.access.ok) report.bottleneck = '접속';
    else if (!report.list.ok) report.bottleneck = '목록 추출';
    else if (!report.detail.ok) report.bottleneck = '상세페이지 추출';
    else if (!report.attachment.ok) report.bottleneck = '첨부파일 추출 또는 현재 표본에 첨부 없음';
    else report.bottleneck = '기본 파이프라인 통과';
  } catch (error) {
    report.access.attempts = error.attempts || report.access.attempts;
    report.access.error = error.name === 'AbortError' ? 'timeout' : error.message;
    report.bottleneck = '접속';
  }
  report.elapsedMs = Date.now() - startedAt;
  return report;
}

const results = [];
const CONCURRENCY = 4;
for (let index = 0; index < SOURCES.length; index += CONCURRENCY) {
  const batch = await Promise.all(SOURCES.slice(index, index + CONCURRENCY).map(probeSource));
  results.push(...batch);
  for (const result of batch) console.log(`${result.org}: ${result.bottleneck}`);
}

const payload = {
  version: VERSION,
  sourceRegistryVersion: SOURCE_REGISTRY_VERSION,
  generatedAt: new Date().toISOString(),
  policy: '필터링과 분리하여 기관 접속 → 목록 추출 → 상세페이지 추출 → 첨부파일 발견만 진단',
  summary: {
    sourceCount: results.length,
    accessOk: results.filter(item => item.access.ok).length,
    listOk: results.filter(item => item.list.ok).length,
    detailOk: results.filter(item => item.detail.ok).length,
    attachmentOk: results.filter(item => item.attachment.ok).length,
    fullPipelineOk: results.filter(item => item.access.ok && item.list.ok && item.detail.ok && item.attachment.ok).length
  },
  sources: results
};
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/pipeline-report.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(payload.summary);
console.log({ reportPath: 'data/pipeline-report.json' });
