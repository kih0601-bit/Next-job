import { fetchKepcoDynamicList } from './lib/kepco-dynamic.mjs';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cleanHtml, fetchDetail } from './lib/detail-parser.mjs';
import { canonicalJobUrl, discoverListingUrls } from './collectors/source-adapters.mjs';
import { inspectListingPage } from './lib/list-pipeline.mjs';
import { inspectRecruitPage, chooseBestAccessPage, summarizeAccessAttempts } from './lib/access-diagnostics.mjs';
import { buildAccessPlan, getCollectorTransportChain, accessTemplateSummary } from './lib/access-templates.mjs';
import { analyzeVacancies } from './lib/classifier.mjs';
import { buildStage8Posting, buildStage8Report, STAGE8_VERSION } from './lib/stage8-eligibility-structure.mjs';
import { scoreJobQuality, QUALITY_ENGINE_VERSION } from './lib/quality-engine.mjs';
import { analyzeAttachments, getDocumentToolDiagnostics } from './lib/document-analyzer.mjs';
import { validateJob, runCollectionQA, VALIDATOR_VERSION } from './lib/validator.mjs';
import { selectListCandidates, LIST_SELECTOR_VERSION } from './lib/list-selector.mjs';
import { NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS, RULES_VERSION } from './lib/rules.mjs';
import { discoverPaginationPlan, paginationRequest } from './lib/pagination-engine.mjs';

import { SOURCES, SOURCE_REGISTRY_VERSION } from './collectors/source-registry.mjs';

const POSITIVE = /채용(?:\s*(?:공고|계획|안내|모집)|\s*공개\s*모집|\s*공개채용)|직원\s*(?:공개\s*)?채용|신입(?:사원|직원)?(?:\s*공개)?\s*채용|경력(?:사원|직원)?(?:\s*공개)?\s*채용|정규직\s*(?:공개\s*)?채용|무기계약직\s*(?:공개\s*)?채용|공무직\s*(?:공개\s*)?채용|근로자\s*(?:채용|모집)|인력\s*(?:채용|모집)/;
const RECRUITMENT_STAGE_NOISE = /(?:최종|예비|추가)?합격자|합격자\s*명단|서류(?:전형|심사)|필기(?:전형|시험)|면접(?:전형|시험)|AI\s*역량검사|체력검정|시험\s*실시|접수현황|지원현황|경쟁률|전형결과|결과발표|채용절차|전형일정|시험장소/;
const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));
const pad = value => String(value).padStart(2, '0');
const STRICT_TARGET_ONLY = true;
const DATA_VERSION = '15.3-v101-stable-cache-fingerprint';
const execFileAsync = promisify(execFile);

const COLLECTION_CACHE_PATH = 'data/collection-cache.json';
const STAGE8_CACHE_SCHEMA_VERSION = '1.0.0-stage8-objective';
const COLLECT_METRICS_PATH = 'data/collect-metrics.json';
const CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const CACHE_IDENTITY_GRACE_MS = 3 * 60 * 60 * 1000;
const CACHE_TERMINAL_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 4000;

function stableUrlForCache(org = '', rawUrl = '') {
  const canonical = canonicalJobUrl(rawUrl || '');
  if (!canonical) return '';
  if (org !== '울산복지가족진흥사회서비스원') return canonical;
  try {
    const parsed = new URL(canonical);
    // em_id is a per-run/session token observed to rotate. Removing only that parameter
    // preserves any durable path/board parameters while preventing false cache invalidation.
    parsed.searchParams.delete('em_id');
    return parsed.toString();
  } catch {
    return canonical.replace(/([?&])em_id=[^&#]*/gi, '$1').replace(/[?&]$/, '');
  }
}

function sourceStableIdentity(candidate = {}) {
  const org = String(candidate.org || '');
  const url = stableUrlForCache(org, candidate.link || '');
  try {
    const parsed = new URL(url);
    if (org === '울산테크노파크') {
      const wrId = parsed.searchParams.get('wr_id');
      if (wrId) return `wr_id:${wrId}`;
    }
  } catch {}
  if (org === '울산복지가족진흥사회서비스원') {
    // Do not use listText here: public-board rows often contain volatile view counts/timestamps.
    // Prefer a parser-provided stable row id; otherwise use the URL with only em_id removed.
    const listIdentity = String(candidate.listIdentity || '').trim();
    if (listIdentity) return `wfps-id:${listIdentity}`;
    if (url) return `wfps-url:${url}`;
  }
  return `url:${url}`;
}

function candidateCacheKey(candidate = {}) {
  const title = normalizeTitleForDedup(candidate.title || '');
  return `${candidate.org || ''}|${sourceStableIdentity(candidate)}|${title}`;
}

function cacheEntryStableMatch(candidate = {}, entry = {}) {
  const org = String(candidate.org || '');
  if (!org || String(entry.org || '') !== org) return false;
  if (normalizeTitleForDedup(entry.title || '') !== normalizeTitleForDedup(candidate.title || '')) return false;
  const entryIdentity = sourceStableIdentity({ org, link: entry.link || '', title: entry.title || '' });
  return entryIdentity === sourceStableIdentity(candidate);
}

function rehydrateCompatibleCacheEntry(candidate = {}, entry = {}) {
  if (!cacheEntryStableMatch(candidate, entry)) return null;
  return {
    ...entry,
    org: candidate.org || entry.org || '',
    link: canonicalJobUrl(candidate.link || entry.link || ''),
    title: candidate.title || entry.title || '',
    identityFingerprint: candidateIdentityFingerprint(candidate),
    fingerprint: candidateFingerprint(candidate),
    cacheIdentityMigratedAt: new Date().toISOString()
  };
}

function findCompatibleCacheEntry(candidate, entries = {}) {
  const directKey = candidateCacheKey(candidate);
  const direct = entries[directKey];
  if (direct) {
    // v100/v99 entries may already sit under the right key while carrying fingerprints
    // calculated with the old volatile URL rules. Upgrade only after a stable identity match.
    const specialOrg = candidate.org === '울산테크노파크' || candidate.org === '울산복지가족진흥사회서비스원';
    if (specialOrg && (direct.identityFingerprint !== candidateIdentityFingerprint(candidate) || (direct.fingerprint && direct.fingerprint !== candidateFingerprint(candidate)))) {
      const upgraded = rehydrateCompatibleCacheEntry(candidate, direct);
      if (upgraded) return { key: directKey, entry: upgraded, migrated: true };
    }
    return { key: directKey, entry: direct, migrated: false };
  }
  const org = String(candidate.org || '');
  // Migrate prior cache schemas only on exact durable identity + normalized-title equality.
  // This prevents two distinct notices from being merged merely because their volatile URL token changed.
  if (org === '울산테크노파크' || org === '울산복지가족진흥사회서비스원') {
    const matches = Object.entries(entries)
      .map(([key, entry]) => [key, rehydrateCompatibleCacheEntry(candidate, entry)])
      .filter(([, entry]) => Boolean(entry));
    if (matches.length) {
      matches.sort((a,b) => String(b[1]?.processedAt || '').localeCompare(String(a[1]?.processedAt || '')));
      return { key: matches[0][0], entry: matches[0][1], migrated: true };
    }
  }
  return { key: directKey, entry: null, migrated: false };
}

function stableRequestMaterial(candidate = {}) {
  const request = candidate.detailRequest || {};
  const org = String(candidate.org || '');
  let body = String(request.body || '');
  if (org === '울산복지가족진흥사회서비스원') {
    body = body.replace(/(^|[&?])em_id=[^&]*/gi, '$1em_id=<volatile>');
  }
  return [String(request.method || '').toUpperCase(), stableUrlForCache(org, request.url || ''), body].join('\n');
}

function candidateFingerprint(candidate = {}) {
  // listText is deliberately excluded: many public boards include volatile view counts / timestamps in the row text.
  // Use the same durable source identity as the cache key so a rotating transport/session token cannot defeat reuse.
  const material = [candidate.org || '', sourceStableIdentity(candidate), candidate.title || '', candidate.listIdentity || '', stableRequestMaterial(candidate)].join('\n');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 20);
}

function candidateIdentityFingerprint(candidate = {}) {
  const material = [candidate.org || '', sourceStableIdentity(candidate), normalizeTitleForDedup(candidate.title || '')].join('\n');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 20);
}

async function bootstrapCacheFromPreviousOutputs() {
  try {
    const [debug, jobsPayload] = await Promise.all([
      fs.readFile('data/debug-report.json', 'utf8').then(JSON.parse),
      fs.readFile('data/jobs.json', 'utf8').then(JSON.parse)
    ]);
    const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
    const processedAt = debug?.updatedAt || jobsPayload?.updatedAt || new Date(0).toISOString();
    const entries = {};
    for (const source of debug?.sources || []) {
      const grouped = new Map();
      for (const decision of source?.vacancyDecisions || []) {
        const title = decision.candidateTitle || decision.vacancyName || '';
        const link = canonicalJobUrl(decision.candidateLink || decision.link || decision.detailUrl || '');
        if (!title || !link) continue;
        const groupKey = `${source.org}|${link}|${normalizeTitleForDedup(title)}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { title, link, decisions: [] });
        grouped.get(groupKey).decisions.push(decision);
      }
      for (const group of grouped.values()) {
        const matchingJobs = jobs.filter(job => job.org === source.org && canonicalJobUrl(job.link || '') === group.link && normalizeTitleForDedup(job.originalTitle || job.title || '') === normalizeTitleForDedup(group.title));
        const hasAcceptedDecision = group.decisions.some(d => d.status === 'accepted');
        if (hasAcceptedDecision && matchingJobs.length === 0) continue; // jobs.json is capped; do not bootstrap an accepted vacancy without its reusable job payload.
        const rejection = group.decisions.filter(d => d.status !== 'accepted').map(d => d.reason).filter(Boolean).join(' | ');
        const detected = group.decisions.length;
        const accepted = matchingJobs.length;
        const candidate = { org: source.org, title: group.title, link: group.link };
        entries[candidateCacheKey(candidate)] = {
          org: source.org, link: group.link, title: group.title,
          identityFingerprint: candidateIdentityFingerprint(candidate),
          fingerprint: '', bootstrap: true, processedAt,
          outcome: { jobs: matchingJobs, rejection, vacancyDecisions: group.decisions, vacancyStats: { detected, accepted, rejected: Math.max(0, detected - accepted) } }
        };
      }
    }
    return entries;
  } catch {
    return {};
  }
}

async function readCollectionCache() {
  try {
    const payload = JSON.parse(await fs.readFile(COLLECTION_CACHE_PATH, 'utf8'));
    const entries = payload && typeof payload.entries === 'object' ? payload.entries : {};
    return { schemaVersion: '1.0.0', generatedAt: payload.generatedAt || '', entries, bootstrap: false };
  } catch {
    const entries = await bootstrapCacheFromPreviousOutputs();
    return { schemaVersion: '1.0.0', generatedAt: '', entries, bootstrap: true };
  }
}

function terminalCacheOutcome(outcome = {}) {
  const rejection = String(outcome.rejection || '');
  if (/expired deadline|closed notice text/i.test(rejection)) return true;
  const decisions = Array.isArray(outcome.vacancyDecisions) ? outcome.vacancyDecisions : [];
  return decisions.length > 0 && decisions.every(item => /expired deadline|closed notice text/i.test(String(item?.reason || '')));
}

function reusableCachedOutcome(candidate, cacheEntry, nowMs = Date.now()) {
  if (!cacheEntry?.processedAt || !cacheEntry?.outcome) return null;
  const identityMatch = cacheEntry.identityFingerprint === candidateIdentityFingerprint(candidate);
  const fullMatch = Boolean(cacheEntry.fingerprint) && cacheEntry.fingerprint === candidateFingerprint(candidate);
  const bootstrapMatch = Boolean(cacheEntry.bootstrap) && identityMatch;
  const age = nowMs - new Date(cacheEntry.processedAt).getTime();
  if (!Number.isFinite(age) || age < 0 || !identityMatch) return null;

  let reuseReason = '';
  if (terminalCacheOutcome(cacheEntry.outcome) && age <= CACHE_TERMINAL_MAX_AGE_MS) reuseReason = 'terminal-identity';
  else if ((fullMatch || bootstrapMatch) && age <= CACHE_MAX_AGE_MS) reuseReason = fullMatch ? 'full-fingerprint' : 'bootstrap-identity';
  else if (age <= CACHE_IDENTITY_GRACE_MS) reuseReason = 'identity-grace';
  if (!reuseReason) return null;

  // v108 and earlier cache entries do not contain objective Stage-8 structure.
  // Reprocess once instead of treating a legacy terminal rejection as a valid Stage-8 hit.
  if (cacheEntry.outcome?.stage8CacheSchemaVersion !== STAGE8_CACHE_SCHEMA_VERSION || !cacheEntry.outcome?.stage8Posting) return null;
  const outcome = structuredClone(cacheEntry.outcome);
  if (Array.isArray(outcome.jobs)) outcome.jobs = outcome.jobs.filter(job => !isExpired(job.deadline));
  outcome.pipeline = { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 };
  outcome.documentDiagnostics = { byDetectedType: {}, byContentType: {}, byError: {} };
  outcome.documentResults = [];
  outcome.incrementalReuse = true;
  outcome.incrementalReuseReason = reuseReason;
  return { outcome, reuseReason };
}

function cacheableOutcome(outcome = {}) {
  return {
    jobs: Array.isArray(outcome.jobs) ? outcome.jobs : [],
    rejection: outcome.rejection || '',
    vacancyDecisions: Array.isArray(outcome.vacancyDecisions) ? outcome.vacancyDecisions : [],
    vacancyStats: outcome.vacancyStats || { detected: 0, accepted: 0, rejected: 0 },
    stage8Posting: outcome.stage8Posting || null,
    stage8CacheSchemaVersion: outcome.stage8Posting ? STAGE8_CACHE_SCHEMA_VERSION : ''
  };
}

function validTitle(title) {
  if (!title || title.length < 6 || title.length > 220) return false;
  if (!POSITIVE.test(title)) return false;
  if (RECRUITMENT_STAGE_NOISE.test(title)) return false;
  if (matchesAny(title, NON_JOB_PATTERNS)) return false;
  if (matchesAny(title, EXCLUDED_EMPLOYMENT_PATTERNS)) return false;
  if (matchesAny(title, LICENSE_JOB_PATTERNS)) return false;
  return true;
}

// Stage 8 is an objective posting-structure stage, not the user's personal-fit filter.
// Contract/intern/license-job postings may still need to be structured even when they
// are later excluded from the user's jobs.json.
function validStage8Candidate(candidate = {}) {
  const title = String(candidate.title || '').trim();
  const listText = String(candidate.listText || '').replace(/\s+/g, ' ').trim();
  if (!title || title.length < 6 || title.length > 220) return false;
  if (!POSITIVE.test(title)) return false;
  if (RECRUITMENT_STAGE_NOISE.test(title)) return false;
  if (matchesAny(title, NON_JOB_PATTERNS)) return false;
  if (/접수(?:가|는)?\s*(?:마감|종료)|채용\s*마감|마감된\s*공고|모집\s*마감|\/\s*마감(?:\s|$)/.test(`${title} ${listText}`)) return false;
  return true;
}

function normalizeTitleForDedup(title = '') {
  return String(title)
    .replace(/\[(?:수정|변경|재공고|재재공고)\]/g, ' ')
    .replace(/\((?:수정|변경|재공고|재재공고)\)/g, ' ')
    .replace(/(?:수정|변경|재재?공고)/g, ' ')
    .replace(/제?\d+차/g, ' ')
    .replace(/\d{4}[-.년\s]*\d{0,2}[-.월\s]*\d{0,2}일?/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function revisionRank(title = '') {
  if (/재재공고/.test(title)) return 4;
  if (/재공고/.test(title)) return 3;
  if (/수정|변경/.test(title)) return 2;
  return 1;
}

function choosePreferredJob(current, candidate) {
  if (!current) return candidate;
  const currentRank = revisionRank(current.title);
  const candidateRank = revisionRank(candidate.title);
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;

  const currentDeadline = current.deadline || '';
  const candidateDeadline = candidate.deadline || '';
  if (candidateDeadline !== currentDeadline) return candidateDeadline > currentDeadline ? candidate : current;

  if (candidate.detailChecked !== current.detailChecked) return candidate.detailChecked ? candidate : current;
  return candidate.fitScore > current.fitScore ? candidate : current;
}

function parseDateValue(yearText, monthText, dayText, referenceYear = new Date().getFullYear()) {
  let year = Number(yearText);
  if (!yearText) year = referenceYear;
  else if (year < 100) year += 2000;
  const month = Number(monthText), day = Number(dayText);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function extractDeadline(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ');
  const range = normalized.match(/(?:20)?(\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\s*~\s*(?:20)?(\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (range) {
    const date = parseDateValue(range[4], range[5], range[6]);
    return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
  }
  const until = normalized.match(/(?:접수|지원|제출|원서접수)[^\n]{0,120}?(?:(20\d{2}|\d{2})[.\-/년]\s*)?(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?[^\n]{0,30}?(?:까지|마감|종료)/);
  if (until) {
    const date = parseDateValue(until[1], until[2], until[3]);
    if (date) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const labeled = [...normalized.matchAll(/(?:접수(?:기간|마감)?|마감(?:일)?|공고기간)\s*[:：]?[^\n]{0,100}?(?:(20\d{2}|\d{2})[.\-/년]\s*)?(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?/g)];
  if (!labeled.length) return '';
  const match = labeled.at(-1);
  const date = parseDateValue(match[1], match[2], match[3]);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

function isExpired(deadline) {
  if (!deadline) return false;
  const end = new Date(`${deadline}T23:59:59+09:00`);
  const now = new Date();
  return end.getTime() < now.getTime();
}

function inspectListPage(html, source) {
  return inspectListingPage(html, source);
}

function buildRequestHeaders(profile = 'browser', referer = '') {
  const headers = profile === 'simple'
    ? {
        'user-agent': 'Mozilla/5.0',
        accept: 'text/html,*/*;q=0.8'
      }
    : {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      };
  if (referer) headers.referer = referer;
  return headers;
}

function validateHtmlResponse({ html, contentType = '' }) {
  if (contentType && !/html|text\//i.test(contentType)) throw new Error(`unsupported content-type: ${contentType}`);
  if (!html || html.trim().length < 80) throw new Error('response body too short');
}

async function fetchWithNode(url, timeoutMs, { referer = '', profile = 'browser' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: buildRequestHeaders(profile, referer)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const html = await response.text();
    validateHtmlResponse({ html, contentType });
    return { html, finalUrl: response.url || url, status: response.status, contentType, transport: 'node-fetch', profile };
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || '';
    const message = error.name === 'AbortError' ? 'timeout' : error.message;
    throw new Error(cause ? `${message} (${cause})` : message);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveHostWithDoh(hostname, timeoutMs = 8000) {
  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`
  ];
  const errors = [];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { accept: 'application/dns-json, application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const ips = (payload.Answer || [])
        .filter(item => item.type === 1 && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(item.data || ''))
        .map(item => item.data);
      if (ips.length) return [...new Set(ips)];
      throw new Error('no A records');
    } catch (error) {
      errors.push(`${new URL(endpoint).hostname}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`DoH resolution failed (${errors.join(' / ')})`);
}

async function fetchWithCurlResolved(url, timeoutMs, { referer = '' } = {}) {
  const parsed = new URL(url);
  const port = parsed.protocol === 'http:' ? 80 : 443;
  const ips = await resolveHostWithDoh(parsed.hostname);
  const errors = [];
  for (const ip of ips.slice(0, 3)) {
    const args = [
      '--silent', '--show-error', '--location', '--compressed', '--ipv4',
      '--connect-timeout', String(Math.max(5, Math.floor(timeoutMs / 2000))),
      '--max-time', String(Math.max(8, Math.ceil(timeoutMs / 1000))),
      '--retry', '0',
      '--resolve', `${parsed.hostname}:${port}:${ip}`,
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
      '--header', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '--write-out', '\n__NEXTJOB_META__%{http_code}|%{url_effective}|%{content_type}',
    ];
    if (referer) args.push('--referer', referer);
    args.push(url);
    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 12 * 1024 * 1024, timeout: timeoutMs + 10000 });
      const marker = '\n__NEXTJOB_META__';
      const markerIndex = stdout.lastIndexOf(marker);
      if (markerIndex < 0) throw new Error('curl metadata missing');
      const html = stdout.slice(0, markerIndex);
      const [statusText, finalUrl, contentType = ''] = stdout.slice(markerIndex + marker.length).trim().split('|');
      const status = Number(statusText);
      if (!Number.isFinite(status) || status < 200 || status >= 400) throw new Error(`HTTP ${statusText || 'unknown'}`);
      validateHtmlResponse({ html, contentType });
      return { html, finalUrl: finalUrl || url, status, contentType, transport: 'curl-doh-resolve', profile: 'browser', resolvedIp: ip };
    } catch (error) {
      errors.push(`${ip}: ${error?.stderr?.trim() || error.message}`);
    }
  }
  throw new Error(`resolved curl failed (${errors.join(' / ')})`);
}

async function fetchWithCurl(url, timeoutMs, { referer = '', insecure = false } = {}) {
  const args = [
    '--silent', '--show-error', '--location', '--compressed',
    '--connect-timeout', String(Math.max(5, Math.floor(timeoutMs / 3000))),
    '--max-time', String(Math.max(10, Math.ceil(timeoutMs / 1000))),
    '--retry', '2', '--retry-delay', '1', '--retry-all-errors',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    '--header', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '--write-out', '\n__NEXTJOB_META__%{http_code}|%{url_effective}|%{content_type}',
  ];
  if (referer) args.push('--referer', referer);
  if (insecure) args.push('--insecure');
  args.push(url);
  try {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 12 * 1024 * 1024, timeout: timeoutMs + 5000 });
    const marker = '\n__NEXTJOB_META__';
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex < 0) throw new Error('curl metadata missing');
    const html = stdout.slice(0, markerIndex);
    const [statusText, finalUrl, contentType = ''] = stdout.slice(markerIndex + marker.length).trim().split('|');
    const status = Number(statusText);
    if (!Number.isFinite(status) || status < 200 || status >= 400) throw new Error(`HTTP ${statusText || 'unknown'}`);
    validateHtmlResponse({ html, contentType });
    return { html, finalUrl: finalUrl || url, status, contentType, transport: insecure ? 'curl-insecure' : 'curl', profile: 'browser' };
  } catch (error) {
    const message = error?.stderr?.trim() || error.message;
    throw new Error(`curl failed: ${message}`);
  }
}

async function fetchHtml(url, timeoutMs = 15000, options = {}, source = {}) {
  const chain = getCollectorTransportChain(source);
  const strategies = chain.map(transport => {
    if (transport === 'node-browser') return () => fetchWithNode(url, timeoutMs, { ...options, profile: 'browser' });
    if (transport === 'node-simple') return () => fetchWithNode(url, timeoutMs, { ...options, profile: 'simple' });
    if (transport === 'curl') return () => fetchWithCurl(url, timeoutMs, { ...options, insecure: false });
    if (transport === 'curl-resolved') return () => fetchWithCurlResolved(url, timeoutMs, options);
    if (transport === 'curl-insecure') return () => fetchWithCurl(url, timeoutMs, { ...options, insecure: true });
    return async () => { throw new Error(`unsupported access transport: ${transport}`); };
  });
  if (options.allowInsecureTls && !chain.includes('curl-insecure')) strategies.push(() => fetchWithCurl(url, timeoutMs, { ...options, insecure: true }));

  const errors = [];
  for (const run of strategies) {
    try {
      return await run();
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error([...new Set(errors)].join(' / '));
}

function isConnectTimeoutError(error = '') {
  return /Failed to connect|connect(?:ion)?\s+timed?\s*out|connect timeout|port\s+443.*Timeout/i.test(String(error));
}

async function fetchPaginationPost(request, timeoutMs = 22000, referer = '', attempts = 3) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method || 'POST',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ko-KR,ko;q=0.9',
          referer,
          ...(request.headers || {})
        },
        body: request.body || undefined,
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { html: await response.text(), finalUrl: response.url || request.url, status: response.status, retryEvidence:{attempts:attempt,failures} };
    } catch(error) {
      const message=error?.name==='AbortError'?'timeout':String(error?.message||error);
      failures.push({attempt,error:message});
      const transient=error?.name==='AbortError'||/timeout|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|HTTP 429|HTTP 5\d\d/i.test(message);
      if(!transient || attempt>=attempts) {
        error.paginationRetryEvidence={attempts:attempt,failures};
        throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,700*attempt));
    } finally { clearTimeout(timer); }
  }
}

async function fetchFreshFormPaginationSession(url, timeoutMs = 22000, referer = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect:'follow',
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
        accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language':'ko-KR,ko;q=0.9',
        referer
      }
    });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const html=await response.text();
    const setCookies=typeof response.headers.getSetCookie==='function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')||''];
    const cookie=setCookies.filter(Boolean).map(value=>String(value).split(';',1)[0]).filter(Boolean).join('; ');
    return {html,finalUrl:response.url||url,cookie};
  } finally { clearTimeout(timer); }
}

async function fetchFirstAccessible(source) {
  const attempts = [];
  const successfulPages = [];
  const accessPlan = buildAccessPlan(source);
  const blockedHosts = new Set();
  const attemptsPerUrl = Math.max(1, Number(source.accessConfig?.accessAttemptsPerUrl || 2));
  const configuredTimeout = Number(source.accessConfig?.accessTimeoutMs || 0);
  for (const plan of accessPlan) {
    const { url } = plan;
    const hostname = new URL(url).hostname.toLowerCase();
    if (blockedHosts.has(hostname)) {
      attempts.push({ url, ok: false, skipped: true, error: 'same-host connect timeout circuit open', accessTemplate: plan.template });
      continue;
    }
    const allowInsecureTls = /(^|\.)ucf\.or\.kr$/i.test(hostname);
    for (let attempt = 1; attempt <= attemptsPerUrl; attempt += 1) {
      try {
        const timeoutMs = configuredTimeout > 0 ? configuredTimeout : (attempt === 1 ? 20000 : 35000);
        const result = await fetchHtml(url, timeoutMs, { referer: source.homepage || '', allowInsecureTls }, source);
        const verification = inspectRecruitPage({ ...result, requestedUrl: url, org: source.org, accessTemplate: source.accessTemplate, accessConfig: source.accessConfig });
        const item = { ...result, requestedUrl: url, verification, accessPriority: plan.accessPriority, accessTemplate: plan.template };
        successfulPages.push(item);
        attempts.push({ url, ok: true, status: result.status, finalUrl: result.finalUrl, transport: result.transport, profile: result.profile, attempt, verification, accessTemplate: plan.template });
        if (verification.verified) {
          const diagnosis = summarizeAccessAttempts(attempts, item);
          return { ...item, attempts, accessDiagnosis: diagnosis, accessTemplateSummary: accessTemplateSummary(source) };
        }
        break;
      } catch (error) {
        attempts.push({ url, ok: false, error: error.message, attempt, accessTemplate: plan.template });
        if (source.accessConfig?.skipHostAfterConnectTimeout && isConnectTimeoutError(error.message)) {
          blockedHosts.add(hostname);
          break;
        }
        if (attempt < attemptsPerUrl) await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }
  const selected = chooseBestAccessPage(successfulPages);
  const diagnosis = summarizeAccessAttempts(attempts, selected);
  if (diagnosis.ok && selected) return { ...selected, attempts, accessDiagnosis: diagnosis, accessTemplateSummary: accessTemplateSummary(source) };
  const summary = attempts.map(item => `${item.url} => ${item.error || item.status}`).join(' | ');
  const failure = new Error(`${diagnosis.code}: ${diagnosis.reason}${summary ? ` | ${summary}` : ''}`);
  failure.accessAttempts = attempts;
  failure.accessDiagnosis = diagnosis;
  throw failure;
}

async function enrichCandidate(candidate, source) {
  let detail = { ok: false, finalUrl: candidate.link, text: '', attachments: [], error: 'detail disabled' };
  if (source.detail) {
    const sourceHost = new URL(source.url).hostname;
    detail = await fetchDetail(candidate.link, {
      expectedTitle: candidate.title,
      sourceOrg: source.org,
      allowedHosts: source.alio ? ['job.alio.go.kr', 'alio.go.kr'] : [sourceHost],
      request: candidate.detailRequest || null
    });
  }
  if (source.requireValidDetail && !detail.ok) {
    const stage8Posting = buildStage8Posting({
      org:candidate.org, title:candidate.title, link:canonicalJobUrl(candidate.link || ''),
      listText:candidate.listText, detailText:detail.text || '', detailOk:false, detailError:detail.error || 'detail validation failed',
      attachments:detail.attachments || [], documents:{discovered:0,attempted:0,successful:0,text:'',results:[]}, vacancies:[]
    });
    return {
      jobs: [],
      rejection: detail.error || 'detail validation failed',
      stage8Posting,
      pipeline: { detailAttempted: Number(Boolean(source.detail)), detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 },
      documentDiagnostics: { byDetectedType: {}, byContentType: {}, byError: {} }
    };
  }

  const documents = await analyzeAttachments(detail.attachments, { maxFiles: 12 });
  const analysisText = `${candidate.title}\n${candidate.listText}\n${detail.text}\n${documents.text}`;
  const deadline = extractDeadline(analysisText);
  if (isExpired(deadline)) return { jobs: [], rejection: 'expired deadline' };
  if (/접수(?:가|는)?\s*(?:마감|종료)|채용\s*마감|마감된\s*공고|\/\s*마감(?:\s|$)/.test(analysisText)) {
    return { jobs: [], rejection: 'closed notice text' };
  }

  const vacancyAnalyses = analyzeVacancies({
    title: candidate.title,
    listText: candidate.listText,
    detailText: detail.text,
    documentText: documents.text,
    detailOk: detail.ok
  });
  const finalLink = canonicalJobUrl(detail.finalUrl || candidate.link);
  const stage8Posting = buildStage8Posting({
    org:candidate.org,
    title:candidate.title,
    link:finalLink,
    listText:candidate.listText,
    detailText:detail.text,
    detailOk:detail.ok,
    detailError:detail.error || '',
    attachments:detail.attachments,
    documents,
    vacancies:vacancyAnalyses
  });
  const jobs = [];
  const vacancyRejections = [];
  const vacancyDecisions = [];

  for (const vacancy of vacancyAnalyses) {
    const result = vacancy.analysis;
    if (result.excluded) {
      const reason = result.excludeReasons.join(', ') || 'classification excluded';
      vacancyRejections.push(`${vacancy.name}: ${reason}`);
      vacancyDecisions.push({ vacancyId: vacancy.id, vacancyName: vacancy.name, status: 'excluded', reason, analysis: result });
      continue;
    }
    const quality = scoreJobQuality({ detail, documents, analysis: result, deadline, title: candidate.title, link: finalLink });
    if ((STRICT_TARGET_ONLY && !result.recommended) || !quality.passed) {
      const missingTarget = [];
      if (result.eligibility !== '고졸 가능') missingTarget.push(`학력=${result.eligibility}`);
      if (!['정규직', '무기계약직', '공무직', '일반직', '상용직'].includes(result.employmentType)) missingTarget.push(`고용형태=${result.employmentType}`);
      if (result.location !== '울산') missingTarget.push(`근무지=${result.location}`);
      if (!detail.ok) missingTarget.push('상세페이지 검증 실패');
      const reasonParts = [
        ...(STRICT_TARGET_ONLY && !result.recommended ? missingTarget : []),
        ...quality.penalties
      ].filter(Boolean);
      const reason = [...new Set(reasonParts)].join(', ') || 'quality score below threshold';
      vacancyRejections.push(`${vacancy.name}: ${reason}`);
      vacancyDecisions.push({
        vacancyId: vacancy.id,
        vacancyName: vacancy.name,
        status: result.reviewNeeded ? 'review-needed' : 'quality-rejected',
        reason,
        missingTarget,
        quality: { score: quality.score, threshold: quality.threshold, reasons: quality.reasons, penalties: quality.penalties },
        analysis: result
      });
      continue;
    }

    const multiple = vacancyAnalyses.length > 1;
    const displayTitle = multiple ? `${candidate.title} · ${vacancy.name}` : candidate.title;
    const job = {
      org: candidate.org,
      title: displayTitle,
      originalTitle: candidate.title,
      vacancyId: vacancy.id,
      vacancyName: vacancy.name,
      vacancySource: vacancy.source,
      vacancyConfidence: vacancy.confidence,
      vacancyCount: vacancyAnalyses.length,
      vacancySplitterVersion: vacancy.splitterVersion,
      link: finalLink,
      date: '',
      deadline,
      employmentType: result.employmentType,
      jobCategory: result.jobCategory,
      eligibility: result.eligibility,
      location: result.location,
      status: result.status,
      recommended: result.recommended,
      fitScore: result.fitScore,
      qualityScore: quality.score,
      qualityThreshold: quality.threshold,
      qualityReasons: quality.reasons,
      qualityPenalties: quality.penalties,
      fitReasons: [...result.fitReasons, multiple ? '모집 직군 단위 판정 완료' : '단일 모집분야 판정'],
      excludeReasons: result.excludeReasons,
      detailChecked: detail.ok,
      detailConfidence: detail.confidence || null,
      detailError: detail.error || '',
      attachments: detail.attachments,
      supportRequirements: result.supportRequirements,
      supportEligibility: result.supportEligibility,
      documentAnalysis: { discovered: documents.discovered, downloadAttempted: documents.attempted, downloaded: documents.downloaded, attempted: documents.attempted, successful: documents.successful, capabilityOk: documents.capabilityOk, coverage: documents.coverage, analyzerVersion: documents.analyzerVersion, requirements: documents.requirements, results: documents.results.map(({ text, ...meta }) => meta) },
      crossValidation: result.crossValidation,
      adapter: candidate.adapter || (source.alio ? 'ALIO' : source.org),
      raw: vacancy.evidenceText.slice(0, 5000)
    };
    const validation = validateJob(job);
    if (!validation.passed) {
      vacancyRejections.push(`${vacancy.name}: ${validation.errors.join(', ') || 'automatic QA failed'}`);
      continue;
    }
    job.validation = validation;
    jobs.push(job);
    vacancyDecisions.push({ vacancyId: vacancy.id, vacancyName: vacancy.name, status: 'accepted', reason: '', quality: { score: quality.score, threshold: quality.threshold }, analysis: result });
  }

  return {
    jobs,
    stage8Posting,
    rejection: jobs.length ? '' : (vacancyRejections.join(' | ') || 'no eligible vacancy'),
    pipeline: {
      detailAttempted: Number(Boolean(source.detail)),
      detailValidated: Number(Boolean(detail.ok)),
      attachmentsDiscovered: Number(documents.discovered || 0),
      attachmentDownloadsAttempted: Number(documents.attempted || 0),
      attachmentsDownloaded: Number(documents.downloaded || 0),
      documentsAttempted: Number(documents.attempted || 0),
      documentsParsed: Number(documents.successful || 0)
    },
    documentDiagnostics: documents.diagnostics || { byDetectedType: {}, byContentType: {}, byError: {} },
    documentResults: documents.results.map(({ text, ...meta }) => meta),
    vacancyDecisions,
    vacancyStats: {
      detected: vacancyAnalyses.length,
      accepted: jobs.length,
      rejected: vacancyAnalyses.length - jobs.length
    }
  };
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + Number(value || 0);
  return target;
}


function serializeHtmlForm(html='',formId='defaultFrm',overrides={}){
 const form=String(html).match(new RegExp(`<form\\b[^>]*(?:id|name)=["']${formId}["'][^>]*>[\\s\\S]*?<\\/form>`,'i'))?.[0]||String(html),p=new URLSearchParams();
 for(const m of form.matchAll(/<input\b([^>]*)>/gi)){const a=m[1]||'',n=a.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];if(!n)continue;p.set(n,a.match(/\bvalue\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]||'');}for(const[k,v]of Object.entries(overrides))p.set(k,String(v));return p.toString();
}


function koshaTboardPayload(serviceId, data = {}, page = 1) {
  return {
    common: {
      siteCode: '50', channelType: 'web', boardId: 'B2025021400005', serviceId,
      ...(serviceId === 'boardList' ? { pagingInfo: { curPageCo: String(page), rowsPerPage: '10' } } : {})
    },
    data: serviceId === 'boardList' ? { sortType: '01', sortOrder: '1', ...data } : { ...data }
  };
}
async function fetchKoshaTboardList(page=1){
  const url='https://kosha.or.kr/api/compn24/auth/stdtboard/api.do',c=new AbortController(),timer=setTimeout(()=>c.abort(),22000);
  try{
    const r=await fetch(url,{signal:c.signal,redirect:'follow',method:'POST',headers:{
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
      'accept-language':'ko-KR,ko;q=0.9',accept:'application/json,text/plain,*/*',
      'content-type':'application/json;charset=UTF-8',chnlId:'kosha24',
      referer:'https://www.kosha.or.kr/notification/jobncontract/job'
    },body:JSON.stringify(koshaTboardPayload('boardList',{},page))});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const text=await r.text(),payload=JSON.parse(text),code=String(payload?.common?.result?.code||'');
    if(code&&code!=='200')throw new Error(`KOSHA API result ${code}`);
    return {html:text,finalUrl:url,status:r.status};
  }finally{clearTimeout(timer);}
}

async function fetchSource(source) {
  const sourceStartedAt = new Date();
  let cacheHits = 0;
  let cacheMisses = 0;
  let heavyProcessed = 0;
  const cacheHitReasons = { 'full-fingerprint': 0, 'bootstrap-identity': 0, 'identity-grace': 0, 'terminal-identity': 0 };
  const cacheMissReasons = { 'missing-key': 0, 'identity-mismatch': 0, 'fingerprint-changed': 0, 'stale': 0, 'other': 0 };
  // Keep small, evidence-rich samples so one Actions run explains *why*
  // identity/fingerprint reuse failed instead of only counting failures.
  const cacheMissSamples = { 'missing-key': [], 'identity-mismatch': [], 'fingerprint-changed': [], 'stale': [], 'other': [] };
  const pushCacheMissSample = (reason, candidate, existingEntry = null) => {
    const bucket = cacheMissSamples[reason] || cacheMissSamples.other;
    if (bucket.length >= 5) return;
    const currentIdentity = sourceStableIdentity(candidate);
    const cachedIdentity = existingEntry ? sourceStableIdentity({
      org: existingEntry.org || candidate.org || '',
      link: existingEntry.link || '',
      title: existingEntry.title || ''
    }) : '';
    const ageMs = existingEntry?.processedAt ? Date.now() - new Date(existingEntry.processedAt).getTime() : null;
    bucket.push({
      title: candidate.title || '',
      currentLink: canonicalJobUrl(candidate.link || ''),
      cachedLink: existingEntry?.link || '',
      currentStableIdentity: currentIdentity,
      cachedStableIdentity: cachedIdentity,
      currentIdentityFingerprint: candidateIdentityFingerprint(candidate),
      cachedIdentityFingerprint: existingEntry?.identityFingerprint || '',
      currentFingerprint: candidateFingerprint(candidate),
      cachedFingerprint: existingEntry?.fingerprint || '',
      ageHours: Number.isFinite(ageMs) ? Math.round((ageMs / 3600000) * 100) / 100 : null
    });
  };
  let cacheKeyMigrations = 0;
  try {
    const access = await fetchFirstAccessible(source);
    const html = access.html;
    const activeSource = { ...source, url: access.finalUrl || access.requestedUrl };
    let listingUrls = discoverListingUrls(html, activeSource);
    let kepcoDynamic = null;
    let koshaDynamic = null;
    if(source.org==='한국전력공사'){
      try{
        kepcoDynamic=await fetchKepcoDynamicList(html,activeSource.url,{timeoutMs:25000,retries:2});
        if(kepcoDynamic?.html) listingUrls=[activeSource.url];
        else throw new Error('authoritative addList response unavailable');
      }catch(error){
        console.error(`[dynamic-list] ${source.org}: ${error.message}`);
        listingUrls=[];
      }
    }
    if(source.org==='한국산업안전보건공단'){
      try{
        koshaDynamic=await fetchKoshaTboardList(1);
        if(koshaDynamic?.html) listingUrls=[koshaDynamic.finalUrl];
      }catch(error){console.error(`[tboard-list] ${source.org}: ${error.message}`);}
    }
    // v90 stage-7 handoff: probe has already verified/investigated pagination.
    // Reuse only the exact URLs observed by the probe; never synthesize a new
    // pagination contract in the production collector.
    const paginationDiag = pipelineReport?.byOrg?.get(source.org)?.pagination || null;
    if (paginationDiag?.strategy === 'query-get' && Array.isArray(paginationDiag.pageFingerprints)) {
      for (const item of paginationDiag.pageFingerprints) {
        if (item?.url && !listingUrls.includes(item.url)) listingUrls.push(item.url);
      }
    }
    let verifiedFormPagination = null;
    if (paginationDiag?.strategy === 'form-post' && paginationDiag?.ok && Number(paginationDiag.totalPages) > 1) {
      try {
        const firstUrl = paginationDiag.pageFingerprints?.[0]?.url || listingUrls[0] || activeSource.url;
        let firstHtml = firstUrl === activeSource.url ? html : (await fetchHtml(firstUrl, 22000, { referer: activeSource.url }, source)).html;
        let plan = discoverPaginationPlan({html:firstHtml,source,selectedUrl:firstUrl});
        let cookie = '';
        const hasCsrf = Object.keys(plan.form?.fields || {}).some(key=>/csrf/i.test(key));
        if (plan.kind === 'form-post' && hasCsrf) {
          const session = await fetchFreshFormPaginationSession(firstUrl, 22000, activeSource.url);
          const sessionPlan = discoverPaginationPlan({html:session.html,source,selectedUrl:session.finalUrl||firstUrl});
          if(sessionPlan.kind==='form-post' && sessionPlan.form?.action && sessionPlan.key){
            firstHtml=session.html;
            plan=sessionPlan;
            cookie=session.cookie||'';
          }
        }
        if (plan.kind === 'form-post' && plan.form?.action && plan.key) verifiedFormPagination = {plan, firstUrl, cookie, hasCsrf};
      } catch(error) { console.error(`[pagination-contract] ${source.org}: ${error.message}`); }
    }
    const candidateMap = new Map();
    const extractionDiagnostics = { anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, accepted: 0, rowFallbackAccepted: 0, titleSamples: [], unsafeSamples: [] };
    for (const listingUrl of listingUrls) {
      let listingHtml = listingUrl === activeSource.url ? html : '';
      if(kepcoDynamic&&source.org==='한국전력공사') listingHtml=kepcoDynamic.html;
      if(koshaDynamic&&source.org==='한국산업안전보건공단') listingHtml=koshaDynamic.html;
      if (!listingHtml) {
        try { listingHtml = (await fetchHtml(listingUrl, 22000, { referer: activeSource.url }, source)).html; }
        catch { continue; }
      }
      const listingSource = { ...activeSource, url: listingUrl };
      const inspection = inspectListPage(listingHtml, listingSource);
      const extracted = inspection.candidates;
      const pageDiagnostics = inspection.diagnostics || {};
      if (pageDiagnostics) {
        for (const key of ['anchors', 'titleMatches', 'noUrl', 'unsafeUrl', 'accepted', 'rowFallbackAccepted']) extractionDiagnostics[key] += Number(pageDiagnostics[key] || 0);
        for (const sample of pageDiagnostics.titleSamples || []) if (extractionDiagnostics.titleSamples.length < 12) extractionDiagnostics.titleSamples.push(sample);
        for (const sample of pageDiagnostics.unsafeSamples || []) if (extractionDiagnostics.unsafeSamples.length < 12) extractionDiagnostics.unsafeSamples.push(sample);
        extractionDiagnostics.pages ||= [];
        extractionDiagnostics.pages.push({ url: listingUrl, visiblePostCount: inspection.visiblePostCount, candidateCount: inspection.candidateCount, exactMatch: inspection.exactMatch, missingCount: inspection.missingCount, extraCount: inspection.extraCount, status: inspection.status, countSource: pageDiagnostics.countSource || 'unavailable' });
      }
      for (const candidate of extracted) {
        const key = `${candidate.org}|${normalizeTitleForDedup(candidate.title)}|${canonicalJobUrl(candidate.link)}`;
        if (!candidateMap.has(key)) candidateMap.set(key, candidate);
      }
    }
    if (verifiedFormPagination) {
      const total = Math.min(60, Number(paginationDiag.totalPages));
      for (let pg=2; pg<=total; pg++) {
        try {
          const req = paginationRequest(verifiedFormPagination.plan, verifiedFormPagination.firstUrl, pg);
          if (verifiedFormPagination.cookie) req.headers = { ...(req.headers || {}), cookie: verifiedFormPagination.cookie };
          const pp = await fetchPaginationPost(req, 22000, verifiedFormPagination.firstUrl);
          const inspection = inspectListPage(pp.html,{...activeSource,url:pp.finalUrl||req.url});
          extractionDiagnostics.pages ||= [];
          extractionDiagnostics.pages.push({url:`${pp.finalUrl||req.url}#post-page=${pg}`,visiblePostCount:inspection.visiblePostCount,candidateCount:inspection.candidateCount,exactMatch:inspection.exactMatch,missingCount:inspection.missingCount,extraCount:inspection.extraCount,status:inspection.status,countSource:inspection.diagnostics?.countSource||'form-post'});
          for(const candidate of inspection.candidates){const key=`${candidate.org}|${normalizeTitleForDedup(candidate.title)}|${canonicalJobUrl(candidate.link)}`;if(!candidateMap.has(key))candidateMap.set(key,candidate);}
        } catch(error){ console.error(`[pagination-post] ${source.org} page ${pg}: ${error.message}`); }
      }
    }
    if (source.org === '한국산업안전보건공단' && paginationDiag?.strategy === 'kosha-api' && Number(paginationDiag.totalPages) > 1) {
      for (let pg=2; pg<=Math.min(60, Number(paginationDiag.totalPages)); pg++) {
        try {
          const pp=await fetchKoshaTboardList(pg);
          const inspection=inspectListPage(pp.html,{...activeSource,url:pp.finalUrl});
          const extracted=inspection.candidates;
          extractionDiagnostics.pages ||= [];
          extractionDiagnostics.pages.push({url:`${pp.finalUrl}#page=${pg}`,visiblePostCount:inspection.visiblePostCount,candidateCount:inspection.candidateCount,exactMatch:inspection.exactMatch,missingCount:inspection.missingCount,extraCount:inspection.extraCount,status:inspection.status,countSource:inspection.diagnostics?.countSource||'api'});
          for(const candidate of extracted){const key=`${candidate.org}|${normalizeTitleForDedup(candidate.title)}|${canonicalJobUrl(candidate.link)}`;if(!candidateMap.has(key))candidateMap.set(key,candidate);}
        } catch(error){ console.error(`[pagination] ${source.org} page ${pg}: ${error.message}`); }
      }
    }
    const rawCandidates = [...candidateMap.values()];
    // Personal list selection is retained for jobs.json compatibility.
    const collectionCandidates = rawCandidates.filter(candidate => validTitle(candidate.title));
    const listSelection = selectListCandidates(collectionCandidates);
    const personalAcceptedKeys = new Set(listSelection.accepted.map(candidate => candidateCacheKey(candidate)));
    // Stage 8 intentionally uses a broader objective set. Personal employment/license
    // exclusions must not erase a posting before its support conditions are structured.
    const candidates = rawCandidates.filter(validStage8Candidate);
    const jobs = [];
    const rejectionReasons = {};
    const vacancyStats = { detected: 0, accepted: 0, rejected: 0 };
    const pipeline = { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 };
    const documentDiagnostics = { byDetectedType: {}, byContentType: {}, byError: {} };
    const documentSamples = [];
    const stage8Postings = [];
    const vacancyDecisions = listSelection.rejected.map(candidate => ({
      candidateTitle: candidate.title,
      candidateLink: candidate.link || '',
      vacancyId: 'list-selection',
      vacancyName: candidate.title,
      status: 'list-rejected',
      reason: candidate.listSelection.reasons.join(', '),
      listSelection: candidate.listSelection
    }));
    for (const candidate of candidates) {
      if (candidate.listOnly) {
        const reason = 'phase2 list extracted; detail URL pending Phase 3';
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        vacancyDecisions.push({
          candidateTitle: candidate.title,
          candidateLink: '',
          vacancyId: 'list-only',
          vacancyName: candidate.title,
          status: 'list-extracted',
          reason,
          listIdentity: candidate.listIdentity || ''
        });
        continue;
      }
      const cacheKey = candidateCacheKey(candidate);
      const cacheLookup = findCompatibleCacheEntry(candidate, collectionCache.entries);
      if (cacheLookup.migrated && cacheLookup.entry) { nextCacheEntries[cacheKey] = cacheLookup.entry; cacheKeyMigrations += 1; }
      const cacheReuse = reusableCachedOutcome(candidate, cacheLookup.entry);
      let outcome;
      if (cacheReuse) {
        cacheHits += 1;
        cacheHitReasons[cacheReuse.reuseReason] = Number(cacheHitReasons[cacheReuse.reuseReason] || 0) + 1;
        outcome = cacheReuse.outcome;
      } else {
        cacheMisses += 1;
        const existingEntry = cacheLookup.entry;
        if (!existingEntry) {
          cacheMissReasons['missing-key'] += 1;
          pushCacheMissSample('missing-key', candidate, null);
        } else {
          const identityMatch = existingEntry.identityFingerprint === candidateIdentityFingerprint(candidate);
          const age = Date.now() - new Date(existingEntry.processedAt || 0).getTime();
          if (!identityMatch) {
            cacheMissReasons['identity-mismatch'] += 1;
            pushCacheMissSample('identity-mismatch', candidate, existingEntry);
          } else if (Number.isFinite(age) && age > CACHE_MAX_AGE_MS && !terminalCacheOutcome(existingEntry.outcome)) {
            cacheMissReasons.stale += 1;
            pushCacheMissSample('stale', candidate, existingEntry);
          } else if (existingEntry.fingerprint && existingEntry.fingerprint !== candidateFingerprint(candidate)) {
            cacheMissReasons['fingerprint-changed'] += 1;
            pushCacheMissSample('fingerprint-changed', candidate, existingEntry);
          } else {
            cacheMissReasons.other += 1;
            pushCacheMissSample('other', candidate, existingEntry);
          }
        }
        heavyProcessed += 1;
        outcome = await enrichCandidate(candidate, source);
        nextCacheEntries[cacheKey] = {
          org: source.org,
          link: canonicalJobUrl(candidate.link || ''),
          title: candidate.title || '',
          fingerprint: candidateFingerprint(candidate),
          identityFingerprint: candidateIdentityFingerprint(candidate),
          bootstrap: false,
          processedAt: new Date().toISOString(),
          outcome: cacheableOutcome(outcome)
        };
      }
      if (outcome.pipeline) {
        for (const key of Object.keys(pipeline)) pipeline[key] += Number(outcome.pipeline[key] || 0);
      }
      if (outcome.documentDiagnostics) {
        mergeCounts(documentDiagnostics.byDetectedType, outcome.documentDiagnostics.byDetectedType);
        mergeCounts(documentDiagnostics.byContentType, outcome.documentDiagnostics.byContentType);
        mergeCounts(documentDiagnostics.byError, outcome.documentDiagnostics.byError);
      }
      if (outcome.documentResults?.length && documentSamples.length < 40) {
        documentSamples.push(...outcome.documentResults.slice(0, Math.max(0, 40 - documentSamples.length)));
      }
      if (outcome.stage8Posting) stage8Postings.push(outcome.stage8Posting);
      if (outcome.vacancyStats) {
        vacancyStats.detected += outcome.vacancyStats.detected || 0;
        vacancyStats.accepted += outcome.vacancyStats.accepted || 0;
        vacancyStats.rejected += outcome.vacancyStats.rejected || 0;
      }
      if (outcome.vacancyDecisions?.length) {
        vacancyDecisions.push(...outcome.vacancyDecisions.map(decision => ({
          candidateTitle: candidate.title,
          candidateLink: candidate.link,
          ...decision
        })));
      }
      const personalAccepted = personalAcceptedKeys.has(candidateCacheKey(candidate));
      if (personalAccepted && outcome.jobs?.length) jobs.push(...outcome.jobs);
      else {
        const reason = personalAccepted
          ? (outcome.rejection || 'unknown rejection')
          : 'stage8 objective-only posting; excluded from personal jobs output';
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
      }
    }
    return {
      ok: true, source: activeSource, jobs, candidates: candidates.length, rawCandidates: rawCandidates.length, collectionCandidates: collectionCandidates.length, listSelection, listingPagesChecked: Math.max(listingUrls.length, Number(paginationDiag?.pagesChecked || 0)), accessAttempts: access.attempts, accessDiagnosis: access.accessDiagnosis || {}, activeRecruitUrl: access.accessDiagnosis?.activeRecruitUrl || activeSource.url,
      rejected: Math.max(0, rawCandidates.length - jobs.length),
      incremental: { cacheHits, cacheMisses, heavyProcessed, cacheHitReasons, cacheMissReasons, cacheMissSamples, cacheKeyMigrations, durationMs: Date.now() - sourceStartedAt.getTime(), startedAt: sourceStartedAt.toISOString(), finishedAt: new Date().toISOString() },
      detailFailures: Object.entries(rejectionReasons)
        .filter(([reason]) => /detail|404|list page|redirect|title mismatch|structure/i.test(reason))
        .reduce((sum, [, count]) => sum + count, 0),
      rejectionReasons, vacancyStats, pipeline, extractionDiagnostics, documentDiagnostics, documentSamples, vacancyDecisions, stage8Postings,
      stage8CandidateCount: candidates.length,
      stage8DerivedCount: stage8Postings.length
    };
  } catch (error) {
    return { ok: false, source, jobs: [], candidates: 0, rawCandidates: 0, collectionCandidates: 0, listSelection: { stats: { input: 0, accepted: 0, rejected: 0 }, reasonCounts: {}, selectorVersion: LIST_SELECTOR_VERSION }, accessAttempts: error.accessAttempts || [], accessDiagnosis: error.accessDiagnosis || {}, activeRecruitUrl: '', rejectionReasons: {}, pipeline: { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 }, documentDiagnostics: { byDetectedType: {}, byContentType: {}, byError: {} }, documentSamples: [], stage8Postings: [], incremental: { cacheHits, cacheMisses, heavyProcessed, cacheHitReasons, cacheMissReasons, cacheMissSamples, cacheKeyMigrations, durationMs: Date.now() - sourceStartedAt.getTime(), startedAt: sourceStartedAt.toISOString(), finishedAt: new Date().toISOString() }, error: error.name === 'AbortError' ? 'timeout' : error.message };
  }
}
async function readPipelineReport() {
  try {
    const payload = JSON.parse(await fs.readFile('data/pipeline-report.json', 'utf8'));
    return { payload, byOrg: new Map((payload.sources || []).map(item => [item.org, item])) };
  } catch {
    return { payload: null, byOrg: new Map() };
  }
}

async function readPreviousPayload() {
  try {
    return JSON.parse(await fs.readFile('data/jobs.json', 'utf8'));
  } catch {
    return { jobs: [], sources: [], stats: {} };
  }
}

const previousPayload = await readPreviousPayload();
const pipelineReport = await readPipelineReport();
const previousJobs = Array.isArray(previousPayload.jobs) ? previousPayload.jobs : [];
const collectionCache = await readCollectionCache();
const nextCacheEntries = { ...collectionCache.entries };
const collectMetrics = { schemaVersion: '1.1.0', startedAt: new Date().toISOString(), finishedAt: '', durationMs: null, cacheMaxAgeHours: CACHE_MAX_AGE_MS / 3600000, identityGraceHours: CACHE_IDENTITY_GRACE_MS / 3600000, terminalCacheMaxAgeDays: CACHE_TERMINAL_MAX_AGE_MS / 86400000, cacheBootstrappedFromPreviousOutputs: Boolean(collectionCache.bootstrap), bootstrapEntryCount: Object.keys(collectionCache.entries || {}).length, institutions: [] };
const results = [];
const ACCESS_CONCURRENCY = 2;
for (let index = 0; index < SOURCES.length; index += ACCESS_CONCURRENCY) {
  const batch = SOURCES.slice(index, index + ACCESS_CONCURRENCY);
  results.push(...await Promise.all(batch.map(fetchSource)));
  if (index + ACCESS_CONCURRENCY < SOURCES.length) await new Promise(resolve => setTimeout(resolve, 1200));
}
collectMetrics.finishedAt = new Date().toISOString();
collectMetrics.durationMs = new Date(collectMetrics.finishedAt) - new Date(collectMetrics.startedAt);
collectMetrics.institutions = results.map(result => ({ org: result.source?.org || '', ok: Boolean(result.ok), ...(result.incremental || {}) }));
collectMetrics.summary = {
  cacheHits: collectMetrics.institutions.reduce((n, x) => n + Number(x.cacheHits || 0), 0),
  cacheMisses: collectMetrics.institutions.reduce((n, x) => n + Number(x.cacheMisses || 0), 0),
  heavyProcessed: collectMetrics.institutions.reduce((n, x) => n + Number(x.heavyProcessed || 0), 0),
  cacheHitReasons: collectMetrics.institutions.reduce((acc, x) => { for (const [k,v] of Object.entries(x.cacheHitReasons || {})) acc[k] = Number(acc[k] || 0) + Number(v || 0); return acc; }, {}),
  cacheMissReasons: collectMetrics.institutions.reduce((acc, x) => { for (const [k,v] of Object.entries(x.cacheMissReasons || {})) acc[k] = Number(acc[k] || 0) + Number(v || 0); return acc; }, {})
};
const dedupedJobs = new Map(), sources = [];
const nowIso = new Date().toISOString();
for (const result of results) {
  let retained = [];
  if (!result.ok) {
    retained = previousJobs.filter(job => job.org === result.source.org && !isExpired(job.deadline));
  }
  const sourceJobs = result.ok ? result.jobs : retained;
  const diagnostic = pipelineReport.byOrg.get(result.source.org) || null;
  sources.push({
    org: result.source.org,
    ok: diagnostic ? Boolean(diagnostic.access?.ok) : result.ok,
    status: diagnostic ? (diagnostic.access?.ok ? 'healthy' : retained.length ? 'degraded' : 'failed') : (result.ok ? 'healthy' : retained.length ? 'degraded' : 'failed'),
    candidates: diagnostic ? Number(diagnostic.list?.candidateCount || 0) : result.candidates,
    collectionCandidates: result.candidates,
    activeRecruitUrl: diagnostic?.access?.activeRecruitUrl || result.activeRecruitUrl || '',
    diagnosis: diagnostic?.diagnosis || null,
    primaryCause: diagnostic?.primaryCause || null,
    diagnosticStages: diagnostic ? { http: diagnostic.diagnosis?.http || null, recruitVerify: diagnostic.diagnosis?.recruitVerify || null, access: diagnostic.access, list: diagnostic.list, detail: diagnostic.detail, attachmentDiscovery: diagnostic.attachmentDiscovery || diagnostic.attachment, attachmentDownload: diagnostic.attachmentDownload || null, documentAnalysis: diagnostic.documentAnalysis || null, attachment: diagnostic.attachment } : null,
    listingPagesChecked: result.listingPagesChecked || 0,
    count: result.jobs.length,
    retained: retained.length,
    rejected: result.rejected || 0,
    detailFailures: result.detailFailures || 0,
    error: result.error || '',
    accessAttempts: result.accessAttempts || [],
    rejectionReasons: result.rejectionReasons || {},
    extractionDiagnostics: result.extractionDiagnostics || {},
    pipeline: result.pipeline || { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 },
    vacancyStats: result.vacancyStats || { detected: 0, accepted: 0, rejected: 0 },
    documentDiagnostics: result.documentDiagnostics || { byDetectedType: {}, byContentType: {}, byError: {} },
    documentSamples: result.documentSamples || [],
    stage8Postings: result.stage8Postings || [],
    stage8CandidateCount: Number(result.stage8CandidateCount || 0),
    stage8DerivedCount: Number(result.stage8DerivedCount || 0),
    vacancyDecisions: result.vacancyDecisions || [],
    incremental: result.incremental || { cacheHits: 0, cacheMisses: 0, heavyProcessed: 0, durationMs: 0 }
  });
  for (const job of sourceJobs) {
    const normalizedTitle = normalizeTitleForDedup(job.title) || job.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const key = `${job.org}|${normalizedTitle}|${job.vacancyName || ''}`;
    const stampedJob = { ...job, collectedAt: job.collectedAt || nowIso, retainedFromPreviousRun: !result.ok };
    dedupedJobs.set(key, choosePreferredJob(dedupedJobs.get(key), stampedJob));
  }
}
const jobs = [...dedupedJobs.values()];

const successfulSources = sources.filter(source => source.ok).length;
const degradedSources = sources.filter(source => source.status === 'degraded').length;
const failedSources = sources.filter(source => source.status === 'failed').length;
const retainedJobs = jobs.filter(job => job.retainedFromPreviousRun).length;
if (successfulSources === 0) {
  throw new Error('모든 수집 출처가 실패하여 기존 data/jobs.json을 유지합니다.');
}

const previousCount = previousJobs.filter(job => !isExpired(job.deadline)).length;
const successRatio = successfulSources / SOURCES.length;
if (previousCount >= 5 && jobs.length < Math.max(2, Math.floor(previousCount * 0.2)) && successRatio < 0.7) {
  throw new Error(`수집 결과가 비정상적으로 급감했습니다(${previousCount}건 → ${jobs.length}건). 기존 data/jobs.json을 유지합니다.`);
}

const qa = runCollectionQA(jobs);
if (!qa.passed) {
  throw new Error(`자동 QA 실패: ${JSON.stringify(qa.counts)}`);
}

jobs.sort((a, b) => Number(b.recommended) - Number(a.recommended) || (b.qualityScore || 0) - (a.qualityScore || 0) || b.fitScore - a.fitScore || (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'));
const payload = {
  version: DATA_VERSION, rulesVersion: RULES_VERSION, sourceRegistryVersion: SOURCE_REGISTRY_VERSION, qualityEngineVersion: QUALITY_ENGINE_VERSION, validatorVersion: VALIDATOR_VERSION, updatedAt: nowIso,
  jobs: jobs.slice(0, 200), sources,
  stats: {
    sourceCount: SOURCES.length,
    success: successfulSources,
    total: jobs.length,
    recommended: jobs.filter(job => job.recommended).length,
    highSchoolSuitable: jobs.filter(job => job.eligibility === '고졸 가능').length,
    detailChecked: jobs.filter(job => job.detailChecked).length,
    reviewNeeded: jobs.filter(job => job.status === '확인 필요').length,
    qualityPassed: jobs.filter(job => (job.qualityScore || 0) >= (job.qualityThreshold || 85)).length,
    averageQualityScore: jobs.length ? Math.round(jobs.reduce((sum, job) => sum + (job.qualityScore || 0), 0) / jobs.length) : 0,
    sourceRejected: sources.reduce((sum, source) => sum + (source.rejected || 0), 0),
    sourceDetailFailures: sources.reduce((sum, source) => sum + (source.detailFailures || 0), 0),
    degradedSources,
    failedSources,
    retainedJobs,
    detailAttempts: sources.reduce((sum, source) => sum + Number(source.pipeline?.detailAttempted || 0), 0),
    detailValidatedCandidates: sources.reduce((sum, source) => sum + Number(source.pipeline?.detailValidated || 0), 0),
    publicAttachmentsDiscovered: sources.reduce((sum, source) => sum + Number(source.pipeline?.attachmentsDiscovered || 0), 0),
    attachmentDownloadsAttempted: sources.reduce((sum, source) => sum + Number(source.pipeline?.attachmentDownloadsAttempted || 0), 0),
    attachmentsDownloaded: sources.reduce((sum, source) => sum + Number(source.pipeline?.attachmentsDownloaded || 0), 0),
    documentsAttempted: sources.reduce((sum, source) => sum + Number(source.pipeline?.documentsAttempted || 0), 0),
    documentsParsed: sources.reduce((sum, source) => sum + Number(source.pipeline?.documentsParsed || 0), 0),
    vacanciesDetected: sources.reduce((sum, source) => sum + Number(source.vacancyStats?.detected || 0), 0),
    vacanciesAccepted: sources.reduce((sum, source) => sum + Number(source.vacancyStats?.accepted || 0), 0),
    vacanciesRejected: sources.reduce((sum, source) => sum + Number(source.vacancyStats?.rejected || 0), 0),
    qaPassed: qa.passed,
    qaIssueCount: qa.issueCount
  },
  qa,
  note: '공개 본문·첨부문서를 확인한 뒤 한 공고 안의 모집 직군을 분리하여, 직군별 학력·고용형태·근무지를 연결 검증하고 지원 가능한 직군만 노출합니다.'
};
await fs.mkdir('data', { recursive: true });
const documentToolDiagnostics = await getDocumentToolDiagnostics();
const debugPayload = {
  version: payload.version,
  updatedAt: nowIso,
  reportPath: 'data/debug-report.json',
  documentAnalyzerVersion: documentToolDiagnostics.analyzerVersion,
  documentToolDiagnostics,
  sources: sources.map(source => ({
    org: source.org,
    status: source.status,
    listingPagesChecked: source.listingPagesChecked,
    candidates: source.candidates,
    extractionDiagnostics: source.extractionDiagnostics,
    pipeline: source.pipeline,
    documentDiagnostics: source.documentDiagnostics,
    documentSamples: source.documentSamples,
    vacancyStats: source.vacancyStats,
    vacancyDecisions: source.vacancyDecisions,
    stage8Postings: source.stage8Postings,
    incremental: source.incremental,
    rejected: source.rejected,
    rejectionReasons: source.rejectionReasons,
    error: source.error
  }))
};

// Finalize the institution pipeline report with the real attachment download and
// document-analysis results from this collector run. The probe owns
// access/list/detail/attachment-discovery; the collector owns file download and
// document parsing.
if (pipelineReport.payload) {
  const resultByOrg = new Map(sources.map(source => [source.org, source]));
  for (const stage of pipelineReport.payload.sources || []) {
    const source = resultByOrg.get(stage.org);
    const p = source?.pipeline || {};
    const noPosts = stage.list?.status === 'verified-empty' && Number(stage.list?.candidateCount || 0) === 0;
    const explicitlyNoAttachments = !noPosts
      && Array.isArray(stage.detail?.samples)
      && stage.detail.samples.length > 0
      && stage.detail.samples.every(sample => Boolean(sample.explicitNoAttachment));
    const discoveryOk = Boolean(stage.attachmentDiscovery?.ok ?? stage.attachment?.ok);
    stage.attachmentDiscovery = {
      ...(stage.attachment || {}),
      ...(stage.attachmentDiscovery || {}),
      ok: discoveryOk,
      status: noPosts ? 'not-required-no-posts' : explicitlyNoAttachments ? 'not-required-no-attachments' : discoveryOk ? 'success' : 'failed',
      discovered: Number(stage.attachmentDiscovery?.discovered ?? stage.attachment?.discovered ?? p.attachmentsDiscovered ?? 0)
    };
    const downloadAttempted = Number(p.attachmentDownloadsAttempted || 0);
    const downloaded = Number(p.attachmentsDownloaded || 0);
    const parsed = Number(p.documentsParsed || 0);
    const documentAttempted = Number(p.documentsAttempted || 0);
    const noAttachmentWorkRequired = noPosts || explicitlyNoAttachments;
    const probeDownload = stage.attachmentDownload || null;
    const probeAnalysis = stage.documentAnalysis || null;
    stage.attachmentDownload = noAttachmentWorkRequired
      ? { ok:true, status:'not-required', attempted:0, downloaded:0, failed:0, verificationMode:'not-required' }
      : downloadAttempted > 0
        ? {
            ok: downloaded === downloadAttempted,
            status: downloaded === downloadAttempted ? 'success' : downloaded > 0 ? 'partial' : 'failed',
            attempted: downloadAttempted,
            downloaded,
            failed: Math.max(0, downloadAttempted - downloaded),
            verificationMode:'collector'
          }
        : probeDownload || { ok:false, status:'not-attempted', attempted:0, downloaded:0, failed:0, verificationMode:'none' };
    stage.documentAnalysis = noAttachmentWorkRequired
      ? { ok:true, capabilityOk:null, status:'not-required', coverageStatus:'not-required', coverageRatio:null, attempted:0, parsed:0, failed:0, verificationMode:'not-required', diagnostics:{} }
      : documentAttempted > 0
        ? {
            ok: parsed === documentAttempted,
            capabilityOk: parsed > 0,
            status: parsed === documentAttempted ? 'success' : parsed > 0 ? 'partial' : 'failed',
            coverageStatus: parsed === documentAttempted ? 'complete' : parsed > 0 ? 'partial' : 'failed',
            coverageRatio: documentAttempted > 0 ? parsed / documentAttempted : null,
            attempted: documentAttempted,
            parsed,
            failed: Math.max(0, documentAttempted - parsed),
            verificationMode:'collector',
            diagnostics: source?.documentDiagnostics || {}
          }
        : probeAnalysis || { ok:false, capabilityOk:false, status:'not-attempted', coverageStatus:'not-attempted', coverageRatio:null, attempted:0, parsed:0, failed:0, verificationMode:'none', diagnostics:{} };
    // Legacy alias remains discovery-only so older consumers do not silently
    // reinterpret it as download or parsing success.
    stage.attachment = stage.attachmentDiscovery;
    if (stage.access?.recruitVerifyOk && stage.list?.ok && stage.detail?.ok && stage.attachmentDiscovery.ok && stage.attachmentDownload.ok && stage.documentAnalysis.ok) {
      stage.bottleneck = noAttachmentWorkRequired ? '현재 수집·문서분석 검증 범위 통과 · 첨부/문서분석 대상 없음' : '현재 수집·문서분석 검증 범위 통과';
    } else if (stage.detail?.ok && !stage.attachmentDiscovery.ok) {
      stage.bottleneck = '첨부 발견/추출';
    } else if (stage.attachmentDiscovery.ok && !stage.attachmentDownload.ok) {
      stage.bottleneck = '첨부 다운로드';
    } else if (stage.attachmentDownload.ok && !stage.documentAnalysis.ok) {
      stage.bottleneck = stage.documentAnalysis.capabilityOk
        ? `문서 분석 부분 성공 (${stage.documentAnalysis.parsed}/${stage.documentAnalysis.attempted})`
        : '문서 분석';
    }
  }
  pipelineReport.payload.summary ||= {};
  const stages = pipelineReport.payload.sources || [];
  pipelineReport.payload.summary.attachmentDiscoveryOk = stages.filter(s => s.attachmentDiscovery?.ok).length;
  pipelineReport.payload.summary.attachmentDownloadOk = stages.filter(s => s.attachmentDownload?.ok).length;
  pipelineReport.payload.summary.documentAnalysisOk = stages.filter(s => s.documentAnalysis?.ok).length;
  pipelineReport.payload.summary.documentAnalysisCapabilityOk = stages.filter(s =>
    s.documentAnalysis?.capabilityOk === true || s.documentAnalysis?.status === 'not-required'
  ).length;
  pipelineReport.payload.summary.collectionDocumentSampleOk = stages.filter(s =>
    s.access?.recruitVerifyOk && s.list?.ok && s.detail?.ok && s.attachmentDiscovery?.ok && s.attachmentDownload?.ok && s.documentAnalysis?.ok
  ).length;
  pipelineReport.payload.summary.deprecated ||= {};
  pipelineReport.payload.summary.deprecated.fullPipelineOk = pipelineReport.payload.summary.collectionDocumentSampleOk;
  pipelineReport.payload.summary.deprecated.note = '호환용 구 필드. Pipeline Complete 의미로 사용 금지';
  pipelineReport.payload.policy = 'HTTP·채용게시판 검증·목록·상세·첨부 발견·첨부 다운로드·문서 분석을 각각 독립 단계로 검증';
  pipelineReport.payload.generatedAt = nowIso;
  await fs.writeFile('data/pipeline-report.json', `${JSON.stringify(pipelineReport.payload, null, 2)}\n`, 'utf8');
}


const stage8Postings = sources.flatMap(source => source.stage8Postings || []);
const stage8CandidateCount = sources.reduce((n,source)=>n+Number(source.stage8CandidateCount||0),0);
const stage8Report = buildStage8Report(stage8Postings, nowIso);
stage8Report.inputDiagnostics = {
  candidateCount: stage8CandidateCount,
  derivedPostingCount: stage8Postings.length,
  byOrg: sources.map(source=>({
    org:source.org,
    candidates:Number(source.stage8CandidateCount||0),
    derived:Number(source.stage8DerivedCount||0),
    cacheHits:Number(source.incremental?.cacheHits||0),
    cacheMisses:Number(source.incremental?.cacheMisses||0)
  }))
};
if (stage8CandidateCount > 0 && stage8Postings.length === 0) {
  throw new Error(`STAGE8_SILENT_FAILURE: ${stage8CandidateCount} objective candidates produced 0 structured postings`);
}

// Compatibility alias: requirement-report now points to the same objective Stage-8 data.
// New consumers should use data/stage8-eligibility-report.json.
const requirementReport = {
  ...stage8Report,
  compatibilityAlias:'data/stage8-eligibility-report.json'
};

const cacheCutoff = Date.now() - CACHE_RETENTION_MS;
const prunedCacheEntries = Object.fromEntries(
  Object.entries(nextCacheEntries)
    .filter(([, entry]) => new Date(entry?.processedAt || 0).getTime() >= cacheCutoff)
    .sort((a, b) => new Date(b[1]?.processedAt || 0) - new Date(a[1]?.processedAt || 0))
    .slice(0, CACHE_MAX_ENTRIES)
);
const cachePayload = { schemaVersion: '1.1.0', generatedAt: nowIso, maxAgeHours: CACHE_MAX_AGE_MS / 3600000, identityGraceHours: CACHE_IDENTITY_GRACE_MS / 3600000, terminalCacheMaxAgeDays: CACHE_TERMINAL_MAX_AGE_MS / 86400000, retentionDays: CACHE_RETENTION_MS / 86400000, entries: prunedCacheEntries };

await Promise.all([
  fs.writeFile('data/jobs.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
  fs.writeFile(COLLECTION_CACHE_PATH, `${JSON.stringify(cachePayload, null, 2)}\n`, 'utf8'),
  fs.writeFile(COLLECT_METRICS_PATH, `${JSON.stringify(collectMetrics, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/requirement-report.json', `${JSON.stringify(requirementReport, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/stage8-eligibility-report.json', `${JSON.stringify(stage8Report, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/qa-report.json', `${JSON.stringify({ version: payload.version, updatedAt: nowIso, ...qa }, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/debug-report.json', `${JSON.stringify(debugPayload, null, 2)}\n`, 'utf8')
]);
console.log(payload.stats);
console.log({ debugReportPath: 'data/debug-report.json', debugReportWritten: true });
