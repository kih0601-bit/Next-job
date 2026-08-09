import { fetchKepcoDynamicList } from './lib/kepco-dynamic.mjs';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanHtml, fetchDetail } from './lib/detail-parser.mjs';
import { canonicalJobUrl, discoverListingUrls } from './collectors/source-adapters.mjs';
import { inspectListingPage } from './lib/list-pipeline.mjs';
import { inspectRecruitPage, chooseBestAccessPage, summarizeAccessAttempts } from './lib/access-diagnostics.mjs';
import { buildAccessPlan, getCollectorTransportChain, accessTemplateSummary } from './lib/access-templates.mjs';
import { analyzeVacancies } from './lib/classifier.mjs';
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
const DATA_VERSION = '15.0-phase5-list-selection';
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

async function fetchPaginationPost(request, timeoutMs = 22000, referer = '') {
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
    return { html: await response.text(), finalUrl: response.url || request.url, status: response.status };
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
    return {
      jobs: [],
      rejection: detail.error || 'detail validation failed',
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
        const firstHtml = firstUrl === activeSource.url ? html : (await fetchHtml(firstUrl, 22000, { referer: activeSource.url }, source)).html;
        const plan = discoverPaginationPlan({html:firstHtml,source,selectedUrl:firstUrl});
        if (plan.kind === 'form-post' && plan.form?.action && plan.key) verifiedFormPagination = {plan, firstUrl};
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
    const collectionCandidates = rawCandidates.filter(candidate => validTitle(candidate.title));
    const listSelection = selectListCandidates(collectionCandidates);
    const candidates = listSelection.accepted;
    const jobs = [];
    const rejectionReasons = {};
    const vacancyStats = { detected: 0, accepted: 0, rejected: 0 };
    const pipeline = { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 };
    const documentDiagnostics = { byDetectedType: {}, byContentType: {}, byError: {} };
    const documentSamples = [];
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
      if (outcome.vacancyDecisions?.length) {
        vacancyDecisions.push(...outcome.vacancyDecisions.map(decision => ({
          candidateTitle: candidate.title,
          candidateLink: candidate.link,
          ...decision
        })));
      }
      if (outcome.jobs?.length) jobs.push(...outcome.jobs);
      else {
        const reason = outcome.rejection || 'unknown rejection';
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
      }
    }
    return {
      ok: true, source: activeSource, jobs, candidates: candidates.length, rawCandidates: rawCandidates.length, collectionCandidates: collectionCandidates.length, listSelection, listingPagesChecked: Math.max(listingUrls.length, Number(paginationDiag?.pagesChecked || 0)), accessAttempts: access.attempts, accessDiagnosis: access.accessDiagnosis || {}, activeRecruitUrl: access.accessDiagnosis?.activeRecruitUrl || activeSource.url,
      rejected: Math.max(0, rawCandidates.length - jobs.length),
      detailFailures: Object.entries(rejectionReasons)
        .filter(([reason]) => /detail|404|list page|redirect|title mismatch|structure/i.test(reason))
        .reduce((sum, [, count]) => sum + count, 0),
      rejectionReasons, vacancyStats, pipeline, extractionDiagnostics, documentDiagnostics, documentSamples, vacancyDecisions
    };
  } catch (error) {
    return { ok: false, source, jobs: [], candidates: 0, rawCandidates: 0, collectionCandidates: 0, listSelection: { stats: { input: 0, accepted: 0, rejected: 0 }, reasonCounts: {}, selectorVersion: LIST_SELECTOR_VERSION }, accessAttempts: error.accessAttempts || [], accessDiagnosis: error.accessDiagnosis || {}, activeRecruitUrl: '', rejectionReasons: {}, pipeline: { detailAttempted: 0, detailValidated: 0, attachmentsDiscovered: 0, attachmentDownloadsAttempted: 0, attachmentsDownloaded: 0, documentsAttempted: 0, documentsParsed: 0 }, documentDiagnostics: { byDetectedType: {}, byContentType: {}, byError: {} }, documentSamples: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
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
    vacancyDecisions: result.vacancyDecisions || []
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


const requirementSamples = sources.flatMap(source => {
  const seen = new Set();
  return (source.vacancyDecisions || []).flatMap(decision => {
    const analysis = decision.analysis || {};
    const requirements = analysis.supportRequirements || null;
    const hasEvidence = Boolean(
      requirements && (
        requirements.evidenceSources?.document ||
        requirements.evidenceSources?.detail ||
        requirements.evidenceSources?.list
      )
    );
    if (!hasEvidence) return [];

    // One sample represents one real posting/vacancy. Attachment filenames are
    // evidence belonging to that posting, never independent vacancies.
    const rawKey = decision.link || decision.detailUrl || decision.vacancyId || decision.vacancyName || '';
    const attachmentLike = /\.(pdf|hwp|hwpx|docx?|xlsx?|zip)$/i.test(String(decision.vacancyName || '').trim());
    if (attachmentLike && !decision.link && !decision.detailUrl) return [];

    const sampleKey = `${source.org}::${rawKey || decision.vacancyName}`;
    if (seen.has(sampleKey)) return [];
    seen.add(sampleKey);

    return [{
      sampleKey,
      org: source.org,
      vacancyId: decision.vacancyId || '',
      title: decision.vacancyName || '',
      link: decision.link || decision.detailUrl || '',
      collectorStatus: decision.status || '',
      collectorReason: decision.reason || '',
      supportRequirements: requirements,
      supportEligibility: analysis.supportEligibility || null,
      evidenceSources: requirements.evidenceSources || {},
      attachmentEvidence: analysis.documentAnalysis?.results || []
    }];
  });
});

const requirementCategoryStats = {};
for (const sample of requirementSamples) {
  const req = sample.supportRequirements || {};
  for (const category of ['education','licenses','experience','major','identity','location','employment','other']) {
    const value = req[category];
    const rows = Array.isArray(value) ? value : (value?.values || []).map(item => ({ value:item, level:value.level || 'unknown' }));
    if (!rows.length) continue;
    const stat = requirementCategoryStats[category] ||= { postings:0, required:0, preferred:0, unknown:0, institutions:[] };
    stat.postings += 1;
    stat.institutions.push(sample.org);
    for (const row of rows) {
      const level = row?.level || 'unknown';
      if (level === 'required') stat.required += 1;
      else if (level === 'preferred') stat.preferred += 1;
      else stat.unknown += 1;
    }
  }
}
for (const stat of Object.values(requirementCategoryStats)) {
  stat.institutions = [...new Set(stat.institutions)].sort();
  stat.institutionCount = stat.institutions.length;
}

const requirementReport = {
  generatedAt: nowIso,
  schemaVersion: '1.1.0',
  policy: [
    '필터 연구용 표본은 최종 jobs.json 통과 여부와 분리한다.',
    '문서/상세/목록 근거가 있는 실제 공고 단위로 1개 표본을 만든다.',
    'PDF/HWP/HWPX 등 첨부파일명은 독립 공고로 집계하지 않고 공고의 근거로 귀속한다.',
    '지원조건은 required/preferred/unknown으로 관측하며 아직 신규 hard filter로 사용하지 않는다.'
  ],
  summary: {
    acceptedJobs: jobs.length,
    sampledPostings: requirementSamples.length,
    sampledInstitutions: [...new Set(requirementSamples.map(sample => sample.org))].length,
    documentBackedPostings: requirementSamples.filter(sample => sample.evidenceSources?.document).length,
    detailBackedPostings: requirementSamples.filter(sample => sample.evidenceSources?.detail).length
  },
  categoryStats: requirementCategoryStats,
  samples: requirementSamples
};

await Promise.all([
  fs.writeFile('data/jobs.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/requirement-report.json', `${JSON.stringify(requirementReport, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/qa-report.json', `${JSON.stringify({ version: payload.version, updatedAt: nowIso, ...qa }, null, 2)}\n`, 'utf8'),
  fs.writeFile('data/debug-report.json', `${JSON.stringify(debugPayload, null, 2)}\n`, 'utf8')
]);
console.log(payload.stats);
console.log({ debugReportPath: 'data/debug-report.json', debugReportWritten: true });
