import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanHtml, fetchDetail } from './lib/detail-parser.mjs';
import { extractCandidatesForSource, canonicalJobUrl, discoverListingUrls } from './collectors/source-adapters.mjs';
import { extractAlioCandidates } from './collectors/alio-adapter.mjs';
import { analyzeVacancies } from './lib/classifier.mjs';
import { scoreJobQuality, QUALITY_ENGINE_VERSION } from './lib/quality-engine.mjs';
import { analyzeAttachments, getDocumentToolDiagnostics } from './lib/document-analyzer.mjs';
import { validateJob, runCollectionQA, VALIDATOR_VERSION } from './lib/validator.mjs';
import { NON_JOB_PATTERNS, EXCLUDED_EMPLOYMENT_PATTERNS, LICENSE_JOB_PATTERNS, RULES_VERSION } from './lib/rules.mjs';

import { SOURCES, SOURCE_REGISTRY_VERSION } from './collectors/source-registry.mjs';

const POSITIVE = /채용(?:\s*(?:공고|계획|안내|모집)|\s*공개\s*모집|\s*공개채용)|직원\s*(?:공개\s*)?채용|신입(?:사원|직원)?(?:\s*공개)?\s*채용|경력(?:사원|직원)?(?:\s*공개)?\s*채용|정규직\s*(?:공개\s*)?채용|무기계약직\s*(?:공개\s*)?채용|공무직\s*(?:공개\s*)?채용|근로자\s*(?:채용|모집)|인력\s*(?:채용|모집)/;
const RECRUITMENT_STAGE_NOISE = /(?:최종|예비|추가)?합격자|합격자\s*명단|서류(?:전형|심사)|필기(?:전형|시험)|면접(?:전형|시험)|AI\s*역량검사|체력검정|시험\s*실시|접수현황|지원현황|경쟁률|전형결과|결과발표|채용절차|전형일정|시험장소/;
const matchesAny = (text, patterns) => patterns.some(pattern => pattern.test(text));
const pad = value => String(value).padStart(2, '0');
const STRICT_TARGET_ONLY = true;
const DATA_VERSION = '12.4-detail-document-pipeline';
const execFileAsync = promisify(execFile);

function validTitle(title) {
  if (!title || title.length < 6 || title.length > 220) return false;
  if (!POSITIVE.test(title)) return false;
  if (RECRUITMENT_STAGE_NOISE.test(title)) return false;
  if (matchesAny(title, NON_JOB_PATTERNS)) return false;
  if (matchesAny(title, EXCLUDED_EMPLOYMENT_PATTERNS)) return false;
  if (matchesAny(title, LICENSE_JOB_PATTERNS)) return false;
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

function extractListCandidates(html, source) {
  const helpers = { validTitle, normalizeTitleForDedup };
  if (source.alio) return extractAlioCandidates(html, source, helpers);
  return extractCandidatesForSource(html, source, helpers);
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

async function fetchHtml(url, timeoutMs = 15000, options = {}) {
  const strategies = [
    () => fetchWithNode(url, timeoutMs, { ...options, profile: 'browser' }),
    () => fetchWithNode(url, timeoutMs, { ...options, profile: 'simple' }),
    () => fetchWithCurl(url, timeoutMs, { ...options, insecure: false })
  ];
  if (options.allowInsecureTls) strategies.push(() => fetchWithCurl(url, timeoutMs, { ...options, insecure: true }));

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

async function fetchFirstAccessible(source) {
  const attempts = [];
  const urls = source.accessUrls?.length ? source.accessUrls : [source.url];
  for (const url of urls) {
    const allowInsecureTls = /(^|\.)ucf\.or\.kr$/i.test(new URL(url).hostname);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await fetchHtml(url, attempt === 1 ? 20000 : 35000, {
          referer: source.homepage || '',
          allowInsecureTls
        });
        attempts.push({
          url, ok: true, status: result.status, finalUrl: result.finalUrl,
          transport: result.transport, profile: result.profile, attempt
        });
        return { ...result, requestedUrl: url, attempts };
      } catch (error) {
        attempts.push({ url, ok: false, error: error.message, attempt });
        if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }
  const summary = attempts.map(item => `${item.url} => ${item.error || item.status}`).join(' | ');
  const failure = new Error(summary || 'all access URLs failed');
  failure.accessAttempts = attempts;
  throw failure;
}

async function enrichCandidate(candidate, source) {
  let detail = { ok: false, finalUrl: candidate.link, text: '', attachments: [], error: 'detail disabled' };
  if (source.detail) {
    const sourceHost = new URL(source.url).hostname;
    detail = await fetchDetail(candidate.link, {
      expectedTitle: candidate.title,
      sourceOrg: source.org,
      allowedHosts: source.alio ? ['job.alio.go.kr', 'alio.go.kr'] : [sourceHost]
    });
  }
  if (source.requireValidDetail && !detail.ok) {
    return {
      jobs: [],
      rejection: detail.error || 'detail validation failed',
      pipeline: { detailAttempted: Number(Boolean(source.detail)), detailValidated: 0, attachmentsDiscovered: 0, documentsAttempted: 0, documentsParsed: 0 },
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
  const jobs = [];
  const vacancyRejections = [];

  for (const vacancy of vacancyAnalyses) {
    const result = vacancy.analysis;
    if (result.excluded) {
      vacancyRejections.push(`${vacancy.name}: ${result.excludeReasons.join(', ') || 'classification excluded'}`);
      continue;
    }
    const quality = scoreJobQuality({ detail, documents, analysis: result, deadline, title: candidate.title, link: finalLink });
    if ((STRICT_TARGET_ONLY && !result.recommended) || !quality.passed) {
      vacancyRejections.push(`${vacancy.name}: ${quality.penalties.join(', ') || 'quality score below threshold'}`);
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
      documentAnalysis: { discovered: documents.discovered, attempted: documents.attempted, successful: documents.successful, analyzerVersion: documents.analyzerVersion, results: documents.results.map(({ text, ...meta }) => meta) },
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
  }

  return {
    jobs,
    rejection: jobs.length ? '' : (vacancyRejections.join(' | ') || 'no eligible vacancy'),
    pipeline: {
      detailAttempted: Number(Boolean(source.detail)),
      detailValidated: Number(Boolean(detail.ok)),
      attachmentsDiscovered: Number(documents.discovered || 0),
      documentsAttempted: Number(documents.attempted || 0),
      documentsParsed: Number(documents.successful || 0)
    },
    documentDiagnostics: documents.diagnostics || { byDetectedType: {}, byContentType: {}, byError: {} },
    documentResults: documents.results.map(({ text, ...meta }) => meta),
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

async function fetchSource(source) {
  try {
    const access = await fetchFirstAccessible(source);
    const html = access.html;
    const activeSource = { ...source, url: access.finalUrl || access.requestedUrl };
    const listingUrls = discoverListingUrls(html, activeSource);
    const candidateMap = new Map();
    const extractionDiagnostics = { anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, accepted: 0, rowFallbackAccepted: 0, titleSamples: [], unsafeSamples: [] };
    for (const listingUrl of listingUrls) {
      let listingHtml = listingUrl === activeSource.url ? html : '';
      if (!listingHtml) {
        try { listingHtml = (await fetchHtml(listingUrl, 22000, { referer: activeSource.url })).html; }
        catch { continue; }
      }
      const listingSource = { ...activeSource, url: listingUrl };
      const extracted = extractListCandidates(listingHtml, listingSource);
      if (extracted.diagnostics) {
        for (const key of ['anchors', 'titleMatches', 'noUrl', 'unsafeUrl', 'accepted', 'rowFallbackAccepted']) extractionDiagnostics[key] += Number(extracted.diagnostics[key] || 0);
        for (const sample of extracted.diagnostics.titleSamples || []) if (extractionDiagnostics.titleSamples.length < 12) extractionDiagnostics.titleSamples.push(sample);
        for (const sample of extracted.diagnostics.unsafeSamples || []) if (extractionDiagnostics.unsafeSamples.length < 12) extractionDiagnostics.unsafeSamples.push(sample);
      }
      for (const candidate of extracted) {
        const key = `${candidate.org}|${normalizeTitleForDedup(candidate.title)}|${canonicalJobUrl(candidate.link)}`;
        if (!candidateMap.has(key)) candidateMap.set(key, candidate);
      }
    }
    const candidates = [...candidateMap.values()];
    const jobs = [];
    const rejectionReasons = {};
    const vacancyStats = { detected: 0, accepted: 0, rejected: 0 };
    const pipeline = { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, documentsAttempted: 0, documentsParsed: 0 };
    const documentDiagnostics = { byDetectedType: {}, byContentType: {}, byError: {} };
    const documentSamples = [];
    for (const candidate of candidates) {
      const outcome = await enrichCandidate(candidate, source);
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
      if (outcome.vacancyStats) {
        vacancyStats.detected += outcome.vacancyStats.detected || 0;
        vacancyStats.accepted += outcome.vacancyStats.accepted || 0;
        vacancyStats.rejected += outcome.vacancyStats.rejected || 0;
      }
      if (outcome.jobs?.length) jobs.push(...outcome.jobs);
      else {
        const reason = outcome.rejection || 'unknown rejection';
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
      }
    }
    return {
      ok: true, source: activeSource, jobs, candidates: candidates.length, listingPagesChecked: listingUrls.length, accessAttempts: access.attempts,
      rejected: Math.max(0, candidates.length - jobs.length),
      detailFailures: Object.entries(rejectionReasons)
        .filter(([reason]) => /detail|404|list page|redirect|title mismatch|structure/i.test(reason))
        .reduce((sum, [, count]) => sum + count, 0),
      rejectionReasons, vacancyStats, pipeline, extractionDiagnostics, documentDiagnostics, documentSamples
    };
  } catch (error) {
    return { ok: false, source, jobs: [], candidates: 0, accessAttempts: error.accessAttempts || [], rejectionReasons: {}, pipeline: { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, documentsAttempted: 0, documentsParsed: 0 }, documentDiagnostics: { byDetectedType: {}, byContentType: {}, byError: {} }, documentSamples: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
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
const previousJobs = Array.isArray(previousPayload.jobs) ? previousPayload.jobs : [];
const results = [];
const ACCESS_CONCURRENCY = 2;
for (let index = 0; index < SOURCES.length; index += ACCESS_CONCURRENCY) {
  const batch = SOURCES.slice(index, index + ACCESS_CONCURRENCY);
  results.push(...await Promise.all(batch.map(fetchSource)));
  if (index + ACCESS_CONCURRENCY < SOURCES.length) await new Promise(resolve => setTimeout(resolve, 1200));
}
const dedupedJobs = new Map(), sources = [];
const nowIso = new Date().toISOString();
for (const result of results) {
  let retained = [];
  if (!result.ok) {
    retained = previousJobs.filter(job => job.org === result.source.org && !isExpired(job.deadline));
  }
  const sourceJobs = result.ok ? result.jobs : retained;
  sources.push({
    org: result.source.org,
    ok: result.ok,
    status: result.ok ? 'healthy' : retained.length ? 'degraded' : 'failed',
    candidates: result.candidates,
    listingPagesChecked: result.listingPagesChecked || 0,
    count: result.jobs.length,
    retained: retained.length,
    rejected: result.rejected || 0,
    detailFailures: result.detailFailures || 0,
    error: result.error || '',
    accessAttempts: result.accessAttempts || [],
    rejectionReasons: result.rejectionReasons || {},
    extractionDiagnostics: result.extractionDiagnostics || {},
    pipeline: result.pipeline || { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, documentsAttempted: 0, documentsParsed: 0 },
    vacancyStats: result.vacancyStats || { detected: 0, accepted: 0, rejected: 0 },
    documentDiagnostics: result.documentDiagnostics || { byDetectedType: {}, byContentType: {}, byError: {} },
    documentSamples: result.documentSamples || []
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
const healthPayload = {
  version: payload.version,
  updatedAt: nowIso,
  summary: {
    totalSources: SOURCES.length,
    healthy: successfulSources,
    degraded: degradedSources,
    failed: failedSources,
    retainedJobs
  },
  sources
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
    rejected: source.rejected,
    rejectionReasons: source.rejectionReasons,
    error: source.error
  }))
};
await Promise.all([
  fs.writeFile('data/jobs.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/source-health.json', `${JSON.stringify(healthPayload, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/qa-report.json', `${JSON.stringify({ version: payload.version, updatedAt: nowIso, ...qa }, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/debug-report.json', `${JSON.stringify(debugPayload, null, 2)}\n`, 'utf8')
]);
console.log(payload.stats);
console.log({ debugReportPath: 'data/debug-report.json', debugReportWritten: true });
