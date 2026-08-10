import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SOURCES, SOURCE_REGISTRY_VERSION } from './collectors/source-registry.mjs';
import { discoverListingUrls } from './collectors/source-adapters.mjs';
import { inspectListingPage } from './lib/list-pipeline.mjs';
import { discoverPaginationPlan, paginationUrl, paginationRequest, reconcilePages, pageFingerprint, paginationEvidenceSnapshot } from './lib/pagination-engine.mjs';
import { buildListRootCauseDiagnostics } from './lib/list-root-cause-diagnostics.mjs';
import { cleanHtml, fetchDetail, decodeHtmlEntities } from './lib/detail-parser.mjs';
import { fetchKepcoDynamicList } from './lib/kepco-dynamic.mjs';
import { inspectRecruitPage, chooseBestAccessPage, summarizeAccessAttempts } from './lib/access-diagnostics.mjs';
import { buildAccessPlan, getTransportChain, accessTemplateSummary } from './lib/access-templates.mjs';
import { classifyDetailTemplate } from './lib/detail-templates.mjs';
import { analyzeAttachments } from './lib/document-analyzer.mjs';
import { safeFileComponent } from './lib/safe-filename.mjs';

const VERSION = '20.0-v110-stage8-input-and-session-guard';
const MAX_LISTING_PAGES = 3;
const MAX_DETAIL_SAMPLES = 50; // first-page target: verify every extracted post on selected first page
const MAX_ATTACHMENT_VERIFY_FILES = 2; // representative files per institution; keeps Actions bounded
const ACCESS_TIMEOUT_MS = 18000;
const LIST_TIMEOUT_MS = 10000;
const MAX_ACCESS_URLS = 6;
const MAX_HTML_EXCERPT = 18000;
const MAX_RELEVANT_SNIPPETS = 24;
const MAX_SCRIPT_SNIPPETS = 12;
const execFileAsync = promisify(execFile);

let PREVIOUS_REPORT = { sources: [] };
try { PREVIOUS_REPORT = JSON.parse(await fs.readFile('data/pipeline-report.previous.json','utf8')); } catch {}
const PREVIOUS_BY_ORG = new Map((PREVIOUS_REPORT.sources || []).map(row => [row.org, row]));

function explicitTotalCount(html='') {
  const text = cleanHtml(String(html || '')).replace(/,/g,' ');
  const patterns = [/(?:총|전체)\s*(?:게시물|게시글|공고)?\s*(\d{1,6})\s*(?:건|개)/i, /(?:total|count)\s*[:：]?\s*(\d{1,6})/i];
  for (const re of patterns) { const m=text.match(re); if(m) return Number(m[1]); }
  return null;
}
function severePaginationIdentityCollapse(rec = {}) {
  const raw = Number(rec.rawCount || 0);
  const unique = Number(rec.uniqueCount || 0);
  if (raw < 20) return false;
  // Pinned notices and normal overlap can create a few duplicates. A board
  // collapsing more than half of 20+ extracted rows indicates that the
  // extracted identity is structurally wrong (e.g. a shared detail endpoint).
  return unique > 0 && (unique / raw) < 0.5;
}

function singlePageProof(html='', selected={}, org='') {
  const snapshot = paginationEvidenceSnapshot(html, selected.url || '');
  const total = explicitTotalCount(html);
  const candidates = Number(selected.candidateCount ?? selected.candidates?.length ?? 0);
  const exact = Boolean(selected.exactMatch);
  const controlHints = (snapshot.pageControls?.length || 0) + (snapshot.forms || []).filter(f => (f.names||[]).some(n => /^(?:page|pageNo|pageNum|pageIndex|currentPage|curPage)$/i.test(n))).length;
  const plain = cleanHtml(String(html || '')).replace(/\s+/g,' ');
  const explicitEmpty = candidates === 0 && /(?:등록된\s*(?:채용)?\s*정보가\s*없습니다|등록된\s*(?:게시물|게시글|공고)가\s*없습니다|채용\s*공고가\s*없습니다|검색된\s*결과가\s*없습니다)/i.test(plain);
  const evidence = [
    `record-exact=${exact}`,
    `candidate-count=${candidates}`,
    `explicit-total=${total ?? 'not-found'}`,
    `explicit-empty=${explicitEmpty}`,
    `pagination-control-hints=${controlHints}`
  ];
  const countProved = exact && total !== null && total === candidates && controlHints === 0;
  const emptyProved = explicitEmpty && controlHints === 0;
  const pageParamHints = (snapshot.forms || []).filter(f => (f.names||[]).some(n => /^(?:page|pageNo|pageNum|pageIndex|currentPage|curPage)$/i.test(n))).length;
  const explicitPagerMarkup = /(?:class|id)\s*=\s*["'][^"']*(?:pagination|paging|pager|page_navi|paginate)[^"']*["']/i.test(String(html || ''));
  const strongHubstRecord = org === '울주문화재단'
    && exact && candidates > 0
    && pageParamHints === 0 && !explicitPagerMarkup
    && selected?.rootCause?.accuracyVerification?.templateRecordEvidence?.verified === true
    && selected?.rootCause?.accuracyVerification?.listVerificationTemplate === 'ROWAREA_RECORD';
  if (org === '울주문화재단') evidence.push(`hubst-page-param-hints=${pageParamHints}`, `hubst-explicit-pager-markup=${explicitPagerMarkup}`);
  const proved = countProved || emptyProved || strongHubstRecord;
  const reason = countProved ? 'explicit total count equals exact extracted record count and no pagination control exists' : emptyProved ? 'board explicitly states there are no registered recruitment records and no pagination control exists' : strongHubstRecord ? 'HUBST ROWAREA_RECORD matches extracted records exactly and no actual pagination parameter/markup exists; generic page-like UI hints ignored' : 'single-page completeness not yet explicitly proved';
  return { proved, totalCount: total ?? (emptyProved ? 0 : null), candidateCount: candidates, controlHints, explicitEmpty, evidence, reason };
}
function applyHistoricalPagination(report) {
  const prev = PREVIOUS_BY_ORG.get(report.org);
  const prior = prev?.pagination;
  const priorVerified = Boolean(prior?.ok || prior?.implementationOk || ['verified-full','verified-single','verified-historical'].includes(prior?.status));
  const currentVerified = Boolean(report.pagination?.ok || ['verified-full','verified-single'].includes(report.pagination?.status));
  report.pagination.currentRunOk = currentVerified;
  report.pagination.currentRunStatus = report.pagination?.status || 'not-evaluated';
  report.pagination.implementationOk = currentVerified;
  report.pagination.verificationClass = report.pagination?.status === 'verified-single' ? 'single-page' : currentVerified ? 'full-pagination' : 'unverified';
  if (!currentVerified && priorVerified && ['not-evaluated','unknown-single-or-no-control','unknown-total-pages','unknown-transport-contract'].includes(report.pagination?.status)) {
    report.pagination.historicalEvidence = { status: prior.status, verifiedAt: PREVIOUS_REPORT.generatedAt || '', totalPages: prior.totalPages ?? null, pagesChecked: prior.pagesChecked ?? null, reconciliation: prior.reconciliation || null };
    report.pagination.status = 'verified-historical';
    report.pagination.implementationOk = true;
    report.pagination.verificationClass = 'historical';
  }
  report.pagination.currentHealth = report.access?.recruitVerifyOk ? (report.pagination.currentRunOk ? 'healthy' : 'needs-current-proof') : 'external-or-access-degraded';
  return report;
}


function compactText(value = '', max = MAX_HTML_EXCERPT) {
  return String(value).replace(/\u0000/g, '').slice(0, max);
}

function relevantSnippets(html = '') {
  const text = String(html);
  const snippets = [];
  const patterns = [
    /<tr\b[\s\S]{0,6000}?(?:채용|모집|공고|recruit)[\s\S]{0,6000}?<\/tr>/gi,
    /<(?:li|article|div)\b[\s\S]{0,5000}?(?:채용|모집|공고|recruit)[\s\S]{0,5000}?<\/(?:li|article|div)>/gi,
    /(?:onclick|href|data-url|data-href)\s*=\s*(["'])[\s\S]{0,1000}?(?:view|detail|recruit|board|bbs|post)[\s\S]{0,1000}?\1/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = compactText(match[0], 9000);
      if (!snippets.includes(value)) snippets.push(value);
      if (snippets.length >= MAX_RELEVANT_SNIPPETS) return snippets;
    }
  }
  return snippets;
}

function scriptSnippets(html = '') {
  const snippets = [];
  for (const match of String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] || '';
    if (!/(?:function\s+\w*(?:view|detail|recruit|board)|(?:view|detail|recruit|board)\s*=|location\.|window\.open|\.submit\s*\()/i.test(body)) continue;
    snippets.push(compactText(body, 12000));
    if (snippets.length >= MAX_SCRIPT_SNIPPETS) break;
  }
  return snippets;
}

function pageArtifact(source, page, stage = 'access') {
  return {
    org: source.org,
    stage,
    requestedUrl: page.requestedUrl || source.url,
    finalUrl: page.finalUrl || source.url,
    status: page.status || 0,
    contentType: page.contentType || '',
    htmlLength: page.html?.length || 0,
    htmlHead: compactText(page.html || ''),
    relevantSnippets: relevantSnippets(page.html || ''),
    scriptSnippets: scriptSnippets(page.html || '')
  };
}

function headers(referer = '') {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'ko-KR,ko;q=0.9',
    ...(referer ? { referer } : {})
  };
}

async function fetchPaginationPage(request, timeoutMs = LIST_TIMEOUT_MS, referer = '', source = {}) {
  if (!request || !request.url) throw new Error('pagination request missing');
  if ((request.method || 'GET').toUpperCase() === 'GET') return fetchHtml(request.url, timeoutMs, referer, source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method || 'POST',
      headers: { ...headers(referer), ...(request.headers || {}) },
      body: request.body || undefined,
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const probe = new TextDecoder('utf-8').decode(bytes.slice(0, Math.min(bytes.length, 8192)));
    const html = decodeResponseBytes(bytes, contentType, probe);
    if (html.trim().length < 80) throw new Error('response body too short');
    return { html, status: response.status, finalUrl: response.url || request.url, contentType };
  } finally { clearTimeout(timer); }
}


async function fetchPaginationPageWithRetry(request, timeoutMs = LIST_TIMEOUT_MS, referer = '', source = {}, attempts = 3) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const page = await fetchPaginationPage(request, timeoutMs, referer, source);
      return { ...page, retryEvidence: { attempts: attempt, failures } };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'timeout' : String(error?.message || error);
      failures.push({ attempt, error: message });
      const transient = error?.name === 'AbortError' || /timeout|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|HTTP 429|HTTP 5\d\d/i.test(message);
      if (!transient || attempt >= attempts) {
        error.paginationRetryEvidence = { attempts: attempt, failures };
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 700 * attempt));
    }
  }
}

function decodeResponseBytes(bytes, contentType = '', htmlProbe = '') {
  const headerCharset = String(contentType).match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
  const metaCharset = String(htmlProbe).match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i)?.[1]
    || String(htmlProbe).match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^;"'\s]+)/i)?.[1]
    || '';
  const raw = (headerCharset || metaCharset || 'utf-8').toLowerCase();
  const charset = /euc-?kr|ks_c_5601|cp949|windows-949/.test(raw) ? 'euc-kr' : 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

async function fetchHtmlWithCurl(url, timeoutMs = 22000, referer = '') {
  const args = [
    '--silent', '--show-error', '--location', '--compressed', '--ipv4',
    '--connect-timeout', String(Math.max(6, Math.floor(timeoutMs / 3000))),
    '--max-time', String(Math.max(12, Math.ceil(timeoutMs / 1000))),
    '--retry', '1', '--retry-all-errors',
    '--user-agent', headers(referer)['user-agent'],
    '--header', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '--header', 'Accept-Language: ko-KR,ko;q=0.9',
    '--write-out', '\n__NEXTJOB_META__%{http_code}|%{url_effective}|%{content_type}'
  ];
  if (referer) args.push('--referer', referer);
  args.push(url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 12 * 1024 * 1024, timeout: timeoutMs + 5000 });
  const marker = '\n__NEXTJOB_META__';
  const pos = stdout.lastIndexOf(marker);
  if (pos < 0) throw new Error('curl metadata missing');
  const html = stdout.slice(0, pos);
  const [statusText, finalUrl, contentType = ''] = stdout.slice(pos + marker.length).trim().split('|');
  const status = Number(statusText);
  if (!Number.isFinite(status) || status < 200 || status >= 400) throw new Error(`HTTP ${statusText || 'unknown'}`);
  if (html.trim().length < 80) throw new Error('response body too short');
  return { html, status, finalUrl: finalUrl || url, contentType };
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

async function fetchHtmlWithCurlResolved(url, timeoutMs = 22000, referer = '') {
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
      '--user-agent', headers(referer)['user-agent'],
      '--header', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '--header', 'Accept-Language: ko-KR,ko;q=0.9',
      '--write-out', '\n__NEXTJOB_META__%{http_code}|%{url_effective}|%{content_type}'
    ];
    if (referer) args.push('--referer', referer);
    args.push(url);
    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 12 * 1024 * 1024, timeout: timeoutMs + 10000 });
      const marker = '\n__NEXTJOB_META__';
      const pos = stdout.lastIndexOf(marker);
      if (pos < 0) throw new Error('curl metadata missing');
      const html = stdout.slice(0, pos);
      const [statusText, finalUrl, contentType = ''] = stdout.slice(pos + marker.length).trim().split('|');
      const status = Number(statusText);
      if (!Number.isFinite(status) || status < 200 || status >= 400) throw new Error(`HTTP ${statusText || 'unknown'}`);
      if (html.trim().length < 80) throw new Error('response body too short');
      return { html, status, finalUrl: finalUrl || url, contentType, transport: 'curl-doh-resolve', resolvedIp: ip };
    } catch (error) {
      errors.push(`${ip}: ${error?.stderr?.trim() || error.message}`);
    }
  }
  throw new Error(`resolved curl failed (${errors.join(' / ')})`);
}

async function fetchHtmlWithFetch(url, timeoutMs = 22000, referer = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: headers(referer) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const utf8Probe = new TextDecoder('utf-8').decode(bytes.slice(0, Math.min(bytes.length, 8192)));
    const html = decodeResponseBytes(bytes, response.headers.get('content-type') || '', utf8Probe);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (html.trim().length < 80) throw new Error('response body too short');
    return { html, status: response.status, finalUrl: response.url || url, contentType: response.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFormSession(url, timeoutMs = 22000, referer = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: headers(referer) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const probe = new TextDecoder('utf-8').decode(bytes.slice(0, Math.min(bytes.length, 8192)));
    const html = decodeResponseBytes(bytes, contentType, probe);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (html.trim().length < 80) throw new Error('response body too short');
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
    const cookie = setCookies.filter(Boolean).map(value => String(value).split(';',1)[0]).filter(Boolean).join('; ');
    return { html, status: response.status, finalUrl: response.url || url, contentType, cookie };
  } finally { clearTimeout(timer); }
}

async function fetchHtml(url, timeoutMs = 22000, referer = '', source = {}) {
  const chain = getTransportChain(source);
  let lastError = null;
  for (const transport of chain) {
    try {
      if (transport === 'fetch') return await fetchHtmlWithFetch(url, timeoutMs, referer);
      if (transport === 'curl') return await fetchHtmlWithCurl(url, timeoutMs, referer);
      if (transport === 'curl-resolved') return await fetchHtmlWithCurlResolved(url, timeoutMs, referer);
      throw new Error(`unsupported transport: ${transport}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('no access transport available');
}


function htmlFormBody(html='',formId='defaultFrm',overrides={}){
  const form=String(html).match(new RegExp(`<form\\b[^>]*(?:id|name)=["']${formId}["'][^>]*>[\\s\\S]*?<\\/form>`,'i'))?.[0]||String(html),p=new URLSearchParams();
  for(const m of form.matchAll(/<input\b([^>]*)>/gi)){const a=m[1]||'',n=a.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];if(!n)continue;const t=(a.match(/\btype\s*=\s*(["'])([^"']+)\1/i)?.[2]||'text').toLowerCase();if(['submit','button','image','file'].includes(t))continue;p.set(n,decodeHtmlEntities(a.match(/\bvalue\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]||''));}for(const[k,v]of Object.entries(overrides))p.set(k,String(v));return p.toString();
}
async function fetchPostHtml(url,body,timeoutMs=22000,referer=''){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{signal:c.signal,redirect:'follow',method:'POST',headers:{...headers(referer),'content-type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error(`HTTP ${r.status}`);const ct=r.headers.get('content-type')||'',b=new Uint8Array(await r.arrayBuffer()),q=new TextDecoder('utf-8').decode(b.slice(0,Math.min(b.length,8192)));return{html:decodeResponseBytes(b,ct,q),status:r.status,finalUrl:r.url||url,contentType:ct};}finally{clearTimeout(timer);}
}
async function kepcoDynamicListing(basePage, source) {
  const baseHtml = basePage?.html || basePage?.raw || basePage?.body || '';
  const d = await fetchKepcoDynamicList(baseHtml, source.url, { timeoutMs: 25000, retries: 2 });
  return { ...d, html: d.html };
}


function koshaTboardPayload(serviceId, data = {}, page = 1) {
  return {
    common: {
      siteCode: '50',
      channelType: 'web',
      boardId: 'B2025021400005',
      serviceId,
      ...(serviceId === 'boardList' ? { pagingInfo: { curPageCo: String(page), rowsPerPage: '10' } } : {})
    },
    data: serviceId === 'boardList'
      ? { sortType: '01', sortOrder: '1', ...data }
      : { ...data }
  };
}

async function fetchKoshaTboard(serviceId = 'boardList', data = {}, page = 1) {
  const url = 'https://kosha.or.kr/api/compn24/auth/stdtboard/api.do';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      method: 'POST',
      headers: {
        ...headers('https://www.kosha.or.kr/notification/jobncontract/job'),
        accept: 'application/json,text/plain,*/*',
        'content-type': 'application/json;charset=UTF-8',
        chnlId: 'kosha24'
      },
      body: JSON.stringify(koshaTboardPayload(serviceId, data, page))
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const payload = JSON.parse(text);
    const code = String(payload?.common?.result?.code || '');
    if (code && code !== '200') throw new Error(`KOSHA API result ${code}: ${payload?.common?.result?.subMsg || ''}`);
    return { html: text, status: response.status, finalUrl: url, requestedUrl: url, contentType: 'application/json', requestMethod: 'POST' };
  } finally { clearTimeout(timer); }
}

function isConnectTimeoutError(error = '') {
  return /Failed to connect|connect(?:ion)?\s+timed?\s*out|connect timeout|port\s+443.*Timeout/i.test(String(error));
}

async function accessiblePages(source) {
  const attempts = [];
  const pages = [];
  const maxUrls = Math.max(1, Number(source.accessConfig?.maxProbeAccessUrls || MAX_ACCESS_URLS));
  const accessPlan = buildAccessPlan(source).slice(0, maxUrls);
  const blockedHosts = new Set();
  const timeoutMs = Number(source.accessConfig?.accessTimeoutMs || ACCESS_TIMEOUT_MS);
  for (const plan of accessPlan) {
    const { accessPriority, url } = plan;
    const hostname = new URL(url).hostname.toLowerCase();
    if (blockedHosts.has(hostname)) {
      attempts.push({ url, ok: false, skipped: true, error: 'same-host connect timeout circuit open', accessTemplate: plan.template, requestProfile: plan.requestProfile });
      continue;
    }
    try {
      const result = await fetchHtml(url, timeoutMs, source.homepage || '', source);
      const verification = inspectRecruitPage({ ...result, requestedUrl: url, org: source.org, accessTemplate: source.accessTemplate, accessConfig: source.accessConfig });
      attempts.push({ url, ok: true, status: result.status, finalUrl: result.finalUrl, verification, accessTemplate: plan.template, requestProfile: plan.requestProfile });
      pages.push({ ...result, requestedUrl: url, verification, accessPriority, accessTemplate: plan.template, requestProfile: plan.requestProfile });
    } catch (error) {
      const message = error.name === 'AbortError' ? 'timeout' : error.message;
      attempts.push({ url, ok: false, error: message, accessTemplate: plan.template, requestProfile: plan.requestProfile });
      if (source.accessConfig?.skipHostAfterConnectTimeout && isConnectTimeoutError(message)) blockedHosts.add(hostname);
    }
  }
  if (!pages.length) {
    const error = new Error('all access URLs failed');
    error.attempts = attempts;
    throw error;
  }
  const selected = chooseBestAccessPage(pages);
  return { pages, attempts, selected, diagnosis: summarizeAccessAttempts(attempts, selected) };
}



function classifyHttp(report) {
  const diagnosis = report.access?.diagnosis?.http || {};
  const attempts = report.access?.attempts || [];
  if (diagnosis.ok) return { status: 'success', code: diagnosis.code || 'HTTP_OK', reason: diagnosis.reason || 'HTTP 응답 성공', evidence: attempts };
  return { status: 'failed', code: diagnosis.code || 'HTTP_FAILED', reason: diagnosis.reason || '모든 후보 URL HTTP 접속 실패', evidence: attempts };
}

function classifyRecruitVerify(report) {
  const diagnosis = report.access?.diagnosis?.recruitVerify || {};
  if (!report.access?.httpOk) return { status: 'blocked', code: 'RECRUIT_VERIFY_BLOCKED_BY_HTTP', reason: 'HTTP 실패로 채용 게시판 검증 불가', evidence: [] };
  if (diagnosis.ok) return { status: 'success', code: diagnosis.code || 'RECRUIT_VERIFY_OK', reason: diagnosis.reason || '채용 게시판 검증 성공', evidence: diagnosis.evidence || report.access?.verification || null };
  return { status: 'failed', code: diagnosis.code || 'RECRUIT_VERIFY_FAILED', reason: diagnosis.reason || 'HTTP 응답은 성공했지만 채용 게시판으로 검증되지 않음', evidence: diagnosis.evidence || report.access?.verification || null };
}

function classifyList(report) {
  const list = report.list || {};
  const diagnostics = list.extractionDiagnostics || [];
  if (!report.access?.httpOk) return { status: 'blocked', code: 'LIST_BLOCKED_BY_HTTP', reason: 'HTTP 실패로 목록 진단 불가', evidence: [] };
  if (!report.access?.recruitVerifyOk) return { status: 'blocked', code: 'LIST_BLOCKED_BY_RECRUIT_VERIFY', reason: '채용 게시판 검증 실패로 목록 진단 보류', evidence: report.access?.verification || [] };
  if (list.status === 'fetch-failed') return { status: 'failed', code: 'LIST_PAGE_FETCH_FAILED', reason: `목록 후보 페이지를 가져오지 못함: ${(list.errors || []).join(' | ')}`, evidence: list.errors || [] };
  if (!diagnostics.length) return { status: 'failed', code: 'LIST_NO_DIAGNOSTIC_PAGE', reason: '목록 후보 페이지를 확보했지만 분석 결과가 없음', evidence: [] };
  if (list.status === 'verified-exact') return { status: 'success', code: 'LIST_VERIFIED_EXACT', reason: `실제 게시글 목록 검증 완료 · 화면 ${list.visiblePostCount}건 = 추출 ${list.candidateCount}건 · ${list.accuracyVerification?.level || 'verified'}`, evidence: diagnostics };
  if (list.status === 'verified-empty') return { status: 'success', code: 'LIST_VERIFIED_EMPTY', reason: '실제 채용게시판의 명시적 0건 상태 확인', evidence: diagnostics };
  if (list.status === 'count-exact-unverified') return { status: 'partial', code: 'LIST_COUNT_EXACT_UNVERIFIED', reason: `개수는 ${list.visiblePostCount}건으로 일치하지만 실제 게시글 제목 집합의 정확성은 아직 독립 검증되지 않음`, evidence: diagnostics };
  if (list.status === 'count-unavailable-or-empty') {
    const htmlPages = diagnostics.filter(item => (item.visiblePostCount || 0) === 0 && (item.candidateCount || 0) === 0);
    const anySignals = diagnostics.some(item => (item.anchors || 0) > 0 || (item.clickableBlocksScanned || 0) > 0 || (item.actionSamples || []).length > 0);
    if (anySignals) return { status: 'failed', code: 'LIST_COUNTER_FAILED', reason: '게시글 후보 신호는 있으나 화면 게시글 행 수를 판정하지 못함', evidence: diagnostics };
    return { status: 'unknown', code: 'LIST_EMPTY_OR_WRONG_PAGE', reason: '실제 0건인지 채용 게시판이 아닌 페이지인지 구분 필요', evidence: htmlPages };
  }
  if (list.candidateCount === 0 && (list.visiblePostCount || 0) > 0) {
    const merged = diagnostics.reduce((acc, item) => ({
      anchors: acc.anchors + (item.anchors || 0),
      titleMatches: acc.titleMatches + (item.titleMatches || 0),
      noUrl: acc.noUrl + (item.noUrl || 0),
      unsafeUrl: acc.unsafeUrl + (item.unsafeUrl || 0),
      clickableBlocksScanned: acc.clickableBlocksScanned + (item.clickableBlocksScanned || 0)
    }), { anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, clickableBlocksScanned: 0 });
    if (merged.titleMatches === 0) return { status: 'failed', code: 'LIST_TITLE_NOT_FOUND', reason: `화면 게시글 ${list.visiblePostCount}건은 확인했지만 제목 선택자가 하나도 맞지 않음`, evidence: diagnostics };
    if (merged.noUrl > 0) return { status: 'failed', code: 'LIST_DETAIL_SIGNAL_MISSING', reason: '제목은 찾았지만 href/onclick/게시글 ID 등 상세 이동정보를 복구하지 못함', evidence: diagnostics };
    if (merged.unsafeUrl > 0) return { status: 'failed', code: 'LIST_URL_REJECTED', reason: '상세 URL 후보를 만들었지만 호스트·목록 URL·다운로드 URL 판정에서 모두 거절됨', evidence: diagnostics };
    return { status: 'failed', code: 'LIST_EXTRACTOR_REJECTED_ALL', reason: '게시글 행은 확인했지만 후보가 최종 수용 조건을 통과하지 못함', evidence: diagnostics };
  }
  if ((list.candidateCount || 0) < (list.visiblePostCount || 0)) return { status: 'partial', code: 'LIST_MISSING_POSTS', reason: `화면 ${list.visiblePostCount}건 중 ${list.candidateCount}건 추출 · ${list.missingCount}건 누락`, evidence: diagnostics };
  if ((list.candidateCount || 0) > (list.visiblePostCount || 0)) return { status: 'partial', code: 'LIST_EXTRA_POSTS', reason: `화면 ${list.visiblePostCount}건보다 ${list.extraCount}건 많이 추출 · 메뉴/첨부/중복 오탐 가능`, evidence: diagnostics };
  return { status: 'failed', code: 'LIST_UNKNOWN_MISMATCH', reason: '화면 글 수와 추출 수가 일치하지 않으나 기존 분류에 해당하지 않음', evidence: diagnostics };
}

function classifyDetail(report) {
  if (!report.list?.ok) return { status: 'blocked', code: 'DETAIL_BLOCKED_BY_LIST', reason: '목록 단계 미통과로 상세 진단 보류', evidence: [] };
  if (report.list.status === 'verified-empty' && (report.list.candidateCount || 0) === 0) {
    return { status: 'success', code: 'DETAIL_NOT_APPLICABLE_EMPTY_BOARD', reason: '현재 실제 공고 0건 · 상세 대상 없음', evidence: [] };
  }
  if ((report.list.detailUrlReady || 0) === 0) return { status: 'failed', code: 'DETAIL_URL_NOT_READY', reason: `목록 ${report.list.candidateCount}건 모두 상세 URL 미복구`, evidence: report.list.extractionDiagnostics || [] };
  if ((report.detail.attempted || 0) === 0) return { status: 'failed', code: 'DETAIL_NOT_ATTEMPTED', reason: '상세 URL은 있으나 상세 요청이 실행되지 않음', evidence: [] };
  if (report.detail.ok) return { status: 'success', code: 'DETAIL_FIRST_PAGE_VERIFIED_EXACT', reason: `첫 페이지 ${report.detail.targetCount}건 전체 상세 URL·본문 1:1 검증 완료`, evidence: report.detail.samples || [] };
  if ((report.detail.missingDetailUrl || 0) > 0) return { status: 'failed', code: 'DETAIL_URL_PARTIAL', reason: `첫 페이지 ${report.detail.targetCount}건 중 ${report.detail.missingDetailUrl}건 상세 URL 미복구`, evidence: report.list.extractionDiagnostics || [] };
  if ((report.detail.attempted || 0) < (report.detail.targetCount || 0)) return { status: 'failed', code: 'DETAIL_COVERAGE_INCOMPLETE', reason: `첫 페이지 ${report.detail.targetCount}건 중 ${report.detail.attempted}건만 상세 요청`, evidence: report.detail.samples || [] };
  if ((report.detail.validated || 0) < (report.detail.targetCount || 0)) return { status: 'failed', code: 'DETAIL_BODY_PARTIAL', reason: `첫 페이지 ${report.detail.targetCount}건 중 ${report.detail.validated}건만 상세 본문 검증 성공`, evidence: report.detail.samples || [] };
  const errors = (report.detail.samples || []).map(item => item.error || '');
  if (errors.some(value => /404|HTTP 404/i.test(value))) return { status: 'failed', code: 'DETAIL_404', reason: '생성된 상세 URL이 404를 반환함 · URL 규칙 오류 가능', evidence: report.detail.samples || [] };
  if (errors.some(value => /403|forbidden/i.test(value))) return { status: 'failed', code: 'DETAIL_FORBIDDEN', reason: '상세페이지 요청이 차단됨', evidence: report.detail.samples || [] };
  if ((report.detail.samples || []).some(item => item.textLength === 0)) return { status: 'failed', code: 'DETAIL_EMPTY_BODY', reason: '상세 응답은 받았지만 본문 텍스트를 찾지 못함', evidence: report.detail.samples || [] };
  return { status: 'failed', code: 'DETAIL_VALIDATION_FAILED', reason: '상세페이지 응답이 제목·본문 검증을 통과하지 못함', evidence: report.detail.samples || [] };
}


function attachmentEvidenceFromHtml(html=''){
  const out={scripts:[],onclick:[],dataAttrs:[],hiddenInputs:[]};
  for(const m of String(html).matchAll(/<script\b[^>]*src\s*=\s*["']([^"']+)["']/gi)){
    if(/file|ctit/i.test(m[1])) out.scripts.push(m[1]);
  }
  for(const m of String(html).matchAll(/\bonclick\s*=\s*["']([^"']*(?:file|down|attach)[^"']*)["']/gi)) out.onclick.push(m[1]);
  for(const m of String(html).matchAll(/\b(data-[\w-]*(?:file|down|attach)[\w-]*)\s*=\s*["']([^"']*)["']/gi)) out.dataAttrs.push([m[1],m[2]]);
  for(const m of String(html).matchAll(/<input\b[^>]*type\s*=\s*["']hidden["'][^>]*>/gi)){
    const tag=m[0]; if(!/(file|attach|atch|ctit)/i.test(tag)) continue;
    const name=tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1]||'';
    const value=tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1]||'';
    out.hiddenInputs.push([name,value]);
  }
  return out;
}

function classifyAttachment(report) {
  if (report.list?.status === 'verified-empty' && (report.list?.candidateCount || 0) === 0) return { status: 'success', code: 'ATTACHMENT_NOT_APPLICABLE_EMPTY_BOARD', reason: '현재 실제 공고 0건 · 첨부 대상 없음', evidence: [] };
  if (!report.detail?.ok) return { status: 'blocked', code: 'ATTACHMENT_BLOCKED_BY_DETAIL', reason: '상세 단계 미통과로 첨부 진단 보류', evidence: [] };
  if ((report.attachmentDiscovery.discovered || 0) > 0) return { status: 'success', code: 'ATTACHMENT_FOUND', reason: `검증 표본에서 첨부 링크 ${report.attachmentDiscovery.discovered}개 발견`, evidence: report.attachmentDiscovery.samples || [] };
  const samples = report.detail.samples || [];
  if (samples.length > 0 && samples.every(item => Boolean(item.explicitNoAttachment))) {
    return { status: 'success', code: 'ATTACHMENT_EXPLICITLY_NONE', reason: '상세 Evidence에서 실제 첨부 없음이 명시적으로 확인됨', evidence: samples };
  }
  return { status: 'unknown', code: 'ATTACHMENT_ZERO_UNRESOLVED', reason: '첨부 링크 0개 · 실제 첨부 없음과 추출 실패를 현재 표본만으로 구분하지 못함', evidence: samples };
}

function classifyAttachmentDownload(report) {
  if (!report.attachmentDiscovery?.ok) return { status: 'blocked', code: 'ATTACHMENT_DOWNLOAD_BLOCKED_BY_DISCOVERY', reason: '첨부 발견 단계 미통과로 다운로드 검증 보류', evidence: [] };
  const stage = report.attachmentDownload || {};
  if (stage.status === 'not-required') return { status: 'success', code: 'ATTACHMENT_DOWNLOAD_NOT_REQUIRED', reason: '실제 첨부 대상 없음이 확인되어 다운로드 불필요', evidence: [] };
  if (stage.ok) return { status: 'success', code: 'ATTACHMENT_DOWNLOAD_VERIFIED', reason: `검증 표본 다운로드 ${stage.downloaded || 0}/${stage.attempted || 0} 성공`, evidence: stage.samples || [] };
  return { status: 'failed', code: 'ATTACHMENT_DOWNLOAD_FAILED', reason: `검증 표본 다운로드 ${stage.downloaded || 0}/${stage.attempted || 0} 성공 · 실패 ${stage.failed || 0}`, evidence: stage.samples || [] };
}

function classifyDocumentAnalysis(report) {
  if (!report.attachmentDownload?.ok) return { status: 'blocked', code: 'DOCUMENT_ANALYSIS_BLOCKED_BY_DOWNLOAD', reason: '첨부 다운로드 실패로 문서분석 검증 불가', evidence: report.attachmentDownload?.samples || [] };
  const stage = report.documentAnalysis || {};
  if (stage.status === 'not-required') return { status: 'success', code: 'DOCUMENT_ANALYSIS_NOT_REQUIRED', reason: '분석 대상 첨부 없음이 확인되어 문서분석 불필요', evidence: [] };
  if (stage.ok) return { status: 'success', code: 'DOCUMENT_ANALYSIS_VERIFIED', reason: `검증 표본 문서분석 ${stage.parsed || 0}/${stage.attempted || 0} 성공`, evidence: stage.samples || [] };
  return { status: 'failed', code: 'DOCUMENT_ANALYSIS_FAILED', reason: `검증 표본 문서분석 ${stage.parsed || 0}/${stage.attempted || 0} 성공 · 실패 ${stage.failed || 0}`, evidence: stage.samples || [] };
}

function remediationFor(code = '', org = '') {
  const institutionAdapter = `scripts/collectors/institutions/${org}.mjs`;
  const map = {
    HTTP_TIMEOUT_ALL: { repairTarget: 'scripts/collectors/source-registry.mjs', recommendedAction: '기관별 접속 URL과 timeout/fallback 순서를 확인' },
    HTTP_404: { repairTarget: 'scripts/collectors/source-registry.mjs', recommendedAction: '기관별 공식 채용 게시판 URL을 최신 주소로 교체' },
    HTTP_FORBIDDEN: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 헤더·쿠키·요청 방식 또는 공식 대체 출처 적용' },
    HTTP_SERVER_ERROR: { repairTarget: 'scripts/collectors/source-registry.mjs', recommendedAction: '서버 오류 재시도·대체 URL 순서를 확인' },
    RECRUIT_VERIFY_FAILED: { repairTarget: 'scripts/lib/recruit-verify.mjs', recommendedAction: '기관별 채용 키워드·게시판 검증 근거를 확인' },
    RECRUIT_VERIFY_ERROR_PAGE: { repairTarget: 'scripts/collectors/source-registry.mjs', recommendedAction: '오류·차단 페이지가 아닌 실제 채용 게시판 URL로 교체' },
    LIST_COUNT_EXACT_UNVERIFIED: { repairTarget: institutionAdapter, recommendedAction: '게시글 행/제목 집합을 독립적으로 식별해 실제 목록과 추출 결과의 제목 단위 일치 검증 추가' },
    LIST_COUNTER_FAILED: { repairTarget: institutionAdapter, recommendedAction: '기관 게시판의 실제 글 행 선택자를 지정해 화면 글 수 계산 수정' },
    LIST_EMPTY_OR_WRONG_PAGE: { repairTarget: 'scripts/collectors/source-registry.mjs', recommendedAction: '현재 URL이 채용 게시판인지 확인하고 기관별 목록 URL 교체' },
    LIST_TITLE_NOT_FOUND: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 제목 선택자 또는 행 텍스트 규칙 추가' },
    LIST_DETAIL_SIGNAL_MISSING: { repairTarget: institutionAdapter, recommendedAction: '기관 onclick/data 속성/게시글 ID에서 상세 이동정보 복구' },
    LIST_URL_REJECTED: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 허용 호스트와 상세 URL 생성 규칙 수정' },
    LIST_MISSING_POSTS: { repairTarget: institutionAdapter, recommendedAction: '누락 행 원문을 기준으로 기관 전용 행 선택자 보강' },
    LIST_EXTRA_POSTS: { repairTarget: institutionAdapter, recommendedAction: '오탐 행 원문을 기준으로 메뉴·첨부·중복 제외 규칙 추가' },
    DETAIL_URL_NOT_READY: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 상세 URL 생성 규칙 구현' },
    DETAIL_404: { repairTarget: institutionAdapter, recommendedAction: '기관 상세 URL 파라미터·POST 규칙 수정' },
    DETAIL_EMPTY_BODY: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 상세 본문 선택자 추가' },
    ATTACHMENT_ZERO_UNRESOLVED: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 첨부 영역 선택자와 실제 첨부 없음 판정 규칙 추가' },
    ATTACHMENT_DOWNLOAD_FAILED: { repairTarget: institutionAdapter, recommendedAction: '원본 상세 evidence에서 다운로드 URL·method·parameter·referer를 복원하고 실제 파일 응답을 검증' },
    DOCUMENT_ANALYSIS_BLOCKED_BY_DOWNLOAD: { repairTarget: institutionAdapter, recommendedAction: '첨부 다운로드 contract를 먼저 복구한 뒤 문서분석 재검증' },
    DOCUMENT_ANALYSIS_FAILED: { repairTarget: 'scripts/lib/document-analyzer.mjs', recommendedAction: '다운로드된 실제 문서 형식과 analyzer 결과를 대조해 기관별 문서 처리 원인 확인' }
  };
  return map[code] || { repairTarget: institutionAdapter, recommendedAction: '진단 evidence를 기준으로 기관 전용 Adapter 확인' };
}

function attachRootCauses(report) {
  report.diagnosis = {
    http: classifyHttp(report),
    recruitVerify: classifyRecruitVerify(report),
    list: classifyList(report),
    detail: classifyDetail(report),
    attachment: classifyAttachment(report),
    attachmentDownload: classifyAttachmentDownload(report),
    documentAnalysis: classifyDocumentAnalysis(report)
  };
  // Backward-compatible alias for older report consumers.
  report.diagnosis.access = report.diagnosis.recruitVerify;
  const order = ['http', 'recruitVerify', 'list', 'detail', 'attachment', 'attachmentDownload', 'documentAnalysis'];
  const first = order.map(stage => ({ stage, ...report.diagnosis[stage] })).find(item => item.status === 'failed' || item.status === 'partial' || item.status === 'unknown');
  report.primaryCause = first || { stage: 'complete', status: 'success', code: 'PIPELINE_SAMPLE_OK', reason: '현재 진단 표본에서 실패 원인 없음', evidence: [] };
  Object.assign(report.primaryCause, remediationFor(report.primaryCause.code, report.org));
  report.stageLabel = `${report.primaryCause.stage}:${report.primaryCause.code}`;
  report.bottleneck = report.primaryCause.reason;
  return report;
}

function safeName(value = '') { return String(value).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 100) || 'unknown'; }



async function captureKepcoBoardScript(source,page){
  if(source?.org!=='한국전력공사') return [];
  const html=String(page?.html||'');
  if(!/fncPageBoard\(\s*["']addList["']\s*,\s*["']addList\.do["']\s*,\s*["']1["']\s*\)/i.test(html)) return [];
  const baseUrl=page.finalUrl||page.requestedUrl||source.url;
  const src=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']*\/board\.js[^"']*)["']/gi)].map(m=>m[1])[0];
  if(!src) return [];
  const assetUrl=new URL(src,baseUrl).href;
  const dir=`data/diagnostics/${safeName(source.org)}/dynamic-list`;
  await fs.mkdir(dir,{recursive:true});
  try{
    const result=await fetchHtml(assetUrl,18000,baseUrl,{...source,transportChain:['fetch','curl']});
    const text=String(result.html||'');
    const file=`${dir}/board.js`;
    await fs.writeFile(file,text,'utf8');
    const fn=text.match(/function\s+fncPageBoard\s*\([^)]*\)\s*\{[\s\S]{0,12000}?\n\}/i)?.[0]||'';
    const ajax=[...text.matchAll(/\$\.(?:ajax|get|post)\s*\([\s\S]{0,2500}?\)/gi)].map(m=>m[0]).slice(0,20);
    const evidence={assetUrl,file,status:result.status,finalUrl:result.finalUrl,fncPageBoard:fn,ajaxCalls:ajax};
    await fs.writeFile(`${dir}/board-script-evidence.json`,`${JSON.stringify(evidence,null,2)}\n`,'utf8');
    return [evidence];
  }catch(error){
    const evidence={assetUrl,error:error.name==='AbortError'?'timeout':error.message};
    await fs.writeFile(`${dir}/board-script-evidence.json`,`${JSON.stringify(evidence,null,2)}\n`,'utf8');
    return [evidence];
  }
}

async function captureKoshaSpaAssets(source,page){
  if(source?.org!=='한국산업안전보건공단') return [];
  const html=String(page?.html||''); if(!/<div\s+id=["']app["'][^>]*>\s*<\/div>/i.test(html)) return [];
  const baseUrl=page.finalUrl||page.requestedUrl||source.url;
  const initialSrcs=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>m[1])
    .filter(v=>/(?:kosha-tboard-config|kosha-tboard-common|kosha-tboard-interface|\/static\/js\/index-)/i.test(v));
  const dir=`data/diagnostics/${safeName(source.org)}/spa`; await fs.mkdir(dir,{recursive:true});
  const assets=[], queued=[...new Set(initialSrcs.map(src=>new URL(src,baseUrl).href))], seen=new Set();

  while(queued.length && assets.length<12){
    const assetUrl=queued.shift();
    if(seen.has(assetUrl)) continue;
    seen.add(assetUrl);
    try{
      const result=await fetchHtml(assetUrl,18000,baseUrl,{...source,transportChain:['fetch','curl']});
      const text=String(result.html||''),filename=safeName(new URL(assetUrl).pathname.split('/').pop()||'asset.js'),file=`${dir}/${filename}`;
      await fs.writeFile(file,text,'utf8');
      const apiLike=[...text.matchAll(/["'`](\/[^"'`]{2,260}(?:api|board|bbs|job|recruit|notice|list|search|pst|process)[^"'`]{0,260})["'`]/gi)]
        .map(m=>m[1]).filter(v=>!/\.(?:png|jpg|gif|svg|css|woff|ttf)(?:[?#]|$)/i.test(v));
      const jobChunks=[...text.matchAll(/["'](?:\.\/)?(VCPBC02001M01-[A-Za-z0-9_-]+\.js)["']/g)].map(m=>m[1]);
      if(/kosha-tboard-config\.js/i.test(assetUrl)){const u=new URL('/stdtboard/js/kosha-tboard-interface.js',baseUrl).href;if(!seen.has(u)&&!queued.includes(u))queued.push(u);}
      const boardIds=[...text.matchAll(/B\d{13,}/g)].map(m=>m[0]),serviceIds=[...text.matchAll(/(?:serviceId|reqId)\s*[:=]\s*["']([^"']+)["']/g)].map(m=>m[1]);
      for(const chunk of [...new Set(jobChunks)]){
        const chunkUrl=new URL(`/static/js/${chunk}`,baseUrl).href;
        if(!seen.has(chunkUrl) && !queued.includes(chunkUrl)) queued.push(chunkUrl);
      }
      assets.push({assetUrl,file,status:result.status,finalUrl:result.finalUrl,apiLike:[...new Set(apiLike)].slice(0,160),jobChunks:[...new Set(jobChunks)],boardIds:[...new Set(boardIds)],serviceIds:[...new Set(serviceIds)].slice(0,120)});
    }catch(error){assets.push({assetUrl,error:error.name==='AbortError'?'timeout':error.message});}
  }
  await fs.writeFile(`${dir}/asset-index.json`,`${JSON.stringify({generatedAt:new Date().toISOString(),baseUrl,assets},null,2)}\n`,'utf8');
  return assets;
}

async function writeListDiagnosticArtifacts(source, pageSource, page, rootCause, pageIndex) {
  const org = source?.org || pageSource?.org || rootCause?.org || 'unknown';
  const dir = `data/diagnostics/${safeName(org)}/list`;
  await fs.mkdir(dir, { recursive: true });
  const prefix = `page-${pageIndex + 1}`;
  await fs.writeFile(`${dir}/${prefix}-raw.html`, page.html || '', 'utf8');
  await fs.writeFile(`${dir}/${prefix}-root-cause.json`, `${JSON.stringify(rootCause, null, 2)}\n`, 'utf8');
  await fs.writeFile(`${dir}/${prefix}-rows.txt`, rootCause.rowTrace.map(row => `[${row.accepted ? 'ACCEPT' : 'REJECT'}] ${row.title || '(no title)'}${row.rejectionReason ? ` :: ${row.rejectionReason}` : ''}`).join('\n') + '\n', 'utf8');
  return { org, htmlPath: `${dir}/${prefix}-raw.html`, diagnosisPath: `${dir}/${prefix}-root-cause.json`, rowsPath: `${dir}/${prefix}-rows.txt`, url: pageSource.url };
}

async function probeSource(source, artifacts) {
  const startedAt = Date.now();
  const report = {
    org: source.org,
    accessTemplate: accessTemplateSummary(source),
    sourceProvenance: source.sourceProvenance || { category:'unclassified', verificationStatus:'unknown', reason:'출처 근거 미분류' },
    access: { ok: false, httpOk: false, recruitVerifyOk: false, attempts: [], boardType: { type: 'UNKNOWN', confidence: 'low', evidence: [] } },
    list: { ok: false, status: 'unknown', pagesChecked: 0, visiblePostCount: null, candidateCount: 0, missingCount: null, extraCount: null, exactMatch: false, selectedUrl: '', detailUrlReady: 0, listOnlyCount: 0, extractionDiagnostics: [], rootCauseDiagnostics: [], diagnosticFiles: [], samples: [], errors: [] },
    detail: { ok: false, targetCount: 0, attempted: 0, validated: 0, failed: 0, missingDetailUrl: 0, coverageRatio: 0, validationRatio: 0, samples: [] },
    attachmentDiscovery: { ok: false, discovered: 0, samples: [] },
    attachment: { ok: false, discovered: 0, samples: [] },
    attachmentDownload: { ok: false, status: 'not-evaluated', attempted: 0, downloaded: 0, failed: 0 },
    documentAnalysis: { ok: false, status: 'not-evaluated', attempted: 0, parsed: 0, failed: 0 },
    pagination: { ok: false, implementationOk: false, currentRunOk: false, status: 'not-evaluated', strategy: '', totalPages: null, pagesChecked: 0, rawCount: 0, uniqueCount: 0, duplicateCount: 0, pageFingerprints: [], pageValidation: [], mismatchPages: [], errors: [], reconciliation: { status: 'not-evaluated' }, goldenDataset: { status: 'baseline-capture' } },
    bottleneck: '',
    elapsedMs: 0
  };
  try {
    const access = await accessiblePages(source);
    const first = access.selected || access.pages[0];
    for (const page of access.pages) artifacts.push(pageArtifact(source, page, 'access'));
    if(source.org==='한국전력공사'){
      for(const page of access.pages){
        try{const boardAssets=await captureKepcoBoardScript(source,page);if(boardAssets.length) artifacts.push({org:source.org,stage:'dynamic-list-script',baseUrl:page.finalUrl||page.requestedUrl,assets:boardAssets});}
        catch(error){artifacts.push({org:source.org,stage:'dynamic-list-script',error:error.message});}
      }
    }
    if(source.org==='한국산업안전보건공단'){
      for(const page of access.pages){
        try{const spaAssets=await captureKoshaSpaAssets(source,page);if(spaAssets.length) artifacts.push({org:source.org,stage:'spa-assets',baseUrl:page.finalUrl||page.requestedUrl,assets:spaAssets});}
        catch(error){artifacts.push({org:source.org,stage:'spa-assets',error:error.message});}
      }
    }
    report.access = { ok: Boolean(access.diagnosis?.ok), httpOk: Boolean(access.diagnosis?.http?.ok), recruitVerifyOk: Boolean(access.diagnosis?.recruitVerify?.ok), requestedUrl: first.requestedUrl, finalUrl: first.finalUrl, activeRecruitUrl: access.diagnosis?.activeRecruitUrl || '', status: first.status, contentType: first.contentType, attempts: access.attempts, verification: first.verification, boardType: first.verification?.boardType || { type: 'UNKNOWN', confidence: 'low', evidence: [] }, diagnosis: access.diagnosis };
    if (!report.access.httpOk) throw Object.assign(new Error(access.diagnosis?.reason || 'HTTP 접속 실패'), { attempts: access.attempts });
    if (!report.access.recruitVerifyOk) throw Object.assign(new Error(access.diagnosis?.reason || '채용 게시판 검증 실패'), { attempts: access.attempts, recruitVerifyFailed: true });
    const listingPages = [];
    for (const page of access.pages) {
      const activeSource = { ...source, url: page.finalUrl || page.requestedUrl };
      listingPages.push({ page, source: activeSource });
      if (source.discoverListings) {
        for (const url of discoverListingUrls(page.html, activeSource)) {
          if (!listingPages.some(item => item.source.url === url)) listingPages.push({ url, source: { ...activeSource, url } });
        }
      }
    }
    if(source.org==='한국전력공사'){
      let authoritativeDynamic = null;
      for(const item of [...listingPages]){
        if(!item.page) continue;
        try{
          const d=await kepcoDynamicListing(item.page,source);
          if(d){ authoritativeDynamic = {page:d,source:{...source,url:d.finalUrl||d.requestedUrl}}; break; }
        }catch(error){report.list.errors.push(`KEPCO dynamic-list: ${error.name==='AbortError'?'timeout':error.message}`);}
      }
      if(authoritativeDynamic){
        listingPages.splice(0, listingPages.length, authoritativeDynamic);
        artifacts.push({org:source.org,stage:'authoritative-dynamic-list',url:authoritativeDynamic.source.url,reason:'frt0001/addList.do only'});
        try {
          await fs.writeFile(path.join(orgDir,'list','kepco-addList-raw.html'), authoritativeDynamic.page.html || authoritativeDynamic.page.raw || authoritativeDynamic.page || '', 'utf8');
        } catch {}
      } else {
        listingPages.splice(0, listingPages.length);
        report.list.errors.push('KEPCO authoritative dynamic-list unavailable; shell fallback blocked');
        artifacts.push({org:source.org,stage:'authoritative-dynamic-list',error:'unavailable',reason:'shell fallback blocked'});
      }
    }
    if(source.org==='한국산업안전보건공단'){
      try{
        const d=await fetchKoshaTboard('boardList',{},1);
        listingPages.unshift({page:d,source:{...source,url:d.finalUrl}});
        artifacts.push({org:source.org,stage:'tboard-api-list',url:d.finalUrl,status:d.status});
      }catch(error){
        report.list.errors.push(`KOSHA tboard-list: ${error.name==='AbortError'?'timeout':error.message}`);
      }
    }
    const pageResults = [];
    for (const [pageIndex, item] of listingPages.slice(0, MAX_LISTING_PAGES).entries()) {
      const url = item.source.url;
      try {
        const page = item.page || await fetchHtml(url, LIST_TIMEOUT_MS, item.source.url, source);
        report.list.pagesChecked += 1;
        const pageSource = { ...item.source, url: page.finalUrl || url };
        artifacts.push(pageArtifact(pageSource, { ...page, requestedUrl: url }, 'listing'));
        const inspection = inspectListingPage(page.html, pageSource);
        const found = inspection.candidates;
        const diagnostic = { url: pageSource.url, ...inspection.diagnostics };
        report.list.extractionDiagnostics.push(diagnostic);
        const rootCause = buildListRootCauseDiagnostics({ html: page.html, source: { ...pageSource, org: source.org }, inspection, selectedCandidates: found });
        report.list.rootCauseDiagnostics.push(rootCause);
        try {
          report.list.diagnosticFiles.push(await writeListDiagnosticArtifacts(source, pageSource, page, rootCause, pageIndex));
        } catch (diagnosticError) {
          // Passive diagnostics must never alter collector or pipeline success/failure.
          report.list.errors.push(`diagnostic-write-warning ${pageSource.url}: ${diagnosticError.message}`);
        }
        pageResults.push({ url: pageSource.url, found, rootCause, ...inspection });
      } catch (error) {
        report.list.errors.push(`${url}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
      }
    }
    // Select the real board page, not the homepage/navigation page. Exact matches
    // win first; otherwise prefer the page with the largest visible board-row count.
    const listPageRank = item => {
      // An explicit institution-configured empty marker on the real recruitment board
      // is stronger evidence than a landing page that merely exposes one noisy link.
      if (item?.status === 'exact' && item?.rootCause?.accuracyVerification?.verified) return 50;
      if (item?.status === 'verified-empty') return 45;
      if (item?.status === 'exact') return 40;
      if (item?.visiblePostCount != null) return 30;
      if ((item?.candidateCount || 0) > 0) return 20;
      return 10;
    };
    const selected = source.org === '한국전력공사'
      ? (pageResults.find(item => /\/frt\/frt0001\/addList\.do/i.test(item.url)) || pageResults[0])
      : pageResults.sort((a, b) => listPageRank(b) - listPageRank(a) || (b.visiblePostCount ?? -1) - (a.visiblePostCount ?? -1) || b.candidateCount - a.candidateCount)[0];
    const all = selected?.found || [];
    report.list.selectedUrl = selected?.url || '';
    report.list.visiblePostCount = selected ? selected.visiblePostCount : null;
    report.list.candidateCount = all.length;
    report.list.missingCount = selected?.missingCount ?? null;
    report.list.extraCount = selected?.extraCount ?? null;
    report.list.exactMatch = Boolean(selected?.exactMatch);
    report.list.detailUrlReady = all.filter(item => !item.listOnly).length;
    report.list.listOnlyCount = all.filter(item => item.listOnly).length;
    report.list.samples = all.slice(0, 20).map(item => ({ title: item.title, link: item.link, adapter: item.adapter || '' }));
    report.list.selectedRootCause = selected?.rootCause || null;
    report.list.accuracyVerification = selected?.rootCause?.accuracyVerification || { verified: false, level: 'NO_EVIDENCE' };
    if (!selected) report.list.status = 'fetch-failed';
    else if (selected.status === 'verified-empty') report.list.status = 'verified-empty';
    else if (selected.status === 'empty-or-wrong-page' || selected.status === 'count-unavailable') report.list.status = 'count-unavailable-or-empty';
    else if (selected.status === 'exact' && report.list.accuracyVerification.verified) report.list.status = 'verified-exact';
    else if (selected.status === 'exact') report.list.status = 'count-exact-unverified';
    else report.list.status = selected.status;
    report.list.ok = report.list.status === 'verified-exact' || report.list.status === 'verified-empty';

    // v90: Pagination(전체 페이지 확장) is stage 7 in development order.
    // Only verified page-1 extraction is allowed to seed expansion. Unsupported JS/POST
    // boards are reported as unknown with evidence rather than guessed as success.
    if (selected && report.list.ok) {
      const plan = discoverPaginationPlan({ html: selected.rootCause?.rawHtml || '', source, selectedUrl: selected.url });
      // rootCause intentionally does not retain raw HTML; recover the selected listing page.
      const selectedPageResult = pageResults.find(item => item.url === selected.url);
      const selectedListingItem = listingPages.find(item => (item.source.url === selected.url || item.page?.finalUrl === selected.url));
      let firstHtml = selectedListingItem?.page?.html || '';
      if (!firstHtml && selectedPageResult?.url) {
        try { firstHtml = (await fetchHtml(selectedPageResult.url, LIST_TIMEOUT_MS, selectedPageResult.url, source)).html || ''; } catch {}
      }
      let finalPlan = discoverPaginationPlan({ html:firstHtml, source, selectedUrl:selected.url });
      let paginationSessionCookie = '';
      const hasCsrfField = Object.keys(finalPlan.form?.fields || {}).some(key => /csrf/i.test(key));
      if (finalPlan.kind === 'form-post' && hasCsrfField) {
        try {
          const sessionSeed = await fetchFormSession(selected.url, LIST_TIMEOUT_MS, selected.url);
          const sessionPlan = discoverPaginationPlan({ html:sessionSeed.html, source, selectedUrl:sessionSeed.finalUrl || selected.url });
          if (sessionPlan.kind === 'form-post' && sessionPlan.form?.action && sessionPlan.key) {
            finalPlan = sessionPlan;
            firstHtml = sessionSeed.html;
            paginationSessionCookie = sessionSeed.cookie || '';
            report.pagination.sessionEvidence = { freshCsrf: true, cookieCaptured: Boolean(paginationSessionCookie), reason:'POST pagination form contains CSRF field; replay uses a fresh GET session and matching form token' };
          }
        } catch (error) {
          report.pagination.sessionEvidence = { freshCsrf: false, cookieCaptured: false, error:error.name==='AbortError'?'timeout':error.message };
        }
      }
      report.pagination.strategy = finalPlan.kind;
      report.pagination.totalPages = finalPlan.totalPages;
      report.pagination.totalCount = finalPlan.totalCount ?? null;
      report.pagination.evidence = finalPlan.evidence || [];
      report.pagination.contractEvidence = paginationEvidenceSnapshot(firstHtml, selected.url);
      const pageBase = Number.isInteger(finalPlan.pageBase) ? finalPlan.pageBase : 1;
      const totalPages = Number.isInteger(finalPlan.totalPages) && finalPlan.totalPages > 0 ? finalPlan.totalPages : null;
      const results = [{ page: pageBase, candidates: all, fingerprint: pageFingerprint(all), url:selected.url, exactMatch:Boolean(selected.exactMatch) }];
      report.pagination.pageFingerprints.push({page:pageBase,fingerprint:results[0].fingerprint,count:all.length,url:selected.url});
      report.pagination.pageValidation.push({page:pageBase,url:selected.url,status:selected.status||'',exactMatch:Boolean(selected.exactMatch),visiblePostCount:selected.visiblePostCount??null,candidateCount:selected.candidateCount??all.length,missingCount:selected.missingCount??null,extraCount:selected.extraCount??null});
      if (finalPlan.kind === 'single-or-undetected') {
        report.pagination.pagesChecked = 1;
        const proof = singlePageProof(firstHtml, selected, source.org);
        report.pagination.singlePageProof = proof;
        report.pagination.totalCount = proof.totalCount;
        report.pagination.rawCount = all.length;
        report.pagination.uniqueCount = new Set(all.map(x=>x.link||x.title)).size;
        report.pagination.duplicateCount = Math.max(0, all.length-report.pagination.uniqueCount);
        report.pagination.ok = proof.proved;
        report.pagination.status = proof.proved ? 'verified-single' : 'unknown-single-or-no-control';
        report.pagination.reconciliation = proof.proved
          ? {status:'pass',rawCount:all.length,uniqueCount:report.pagination.uniqueCount,duplicateCount:report.pagination.duplicateCount,repeatedPageFingerprint:false,reason:proof.reason}
          : {status:'blocked',reason:'페이지 컨트롤 미검출만으로 단일 페이지를 확정하지 않음; explicit total/record proof 필요'};
        report.pagination.goldenDataset = {status:proof.proved?'active-structural-baseline':'baseline-capture', firstPageFingerprint:results[0].fingerprint, firstPageCount:all.length};
      } else if (totalPages === 1 && ['javascript-form','form-post','query-get'].includes(finalPlan.kind)) {
        report.pagination.pagesChecked = 1;
        report.pagination.rawCount = all.length; report.pagination.uniqueCount = new Set(all.map(x=>x.link||x.title)).size; report.pagination.duplicateCount = Math.max(0, all.length-report.pagination.uniqueCount);
        report.pagination.reconciliation = {status:'pass',rawCount:all.length,uniqueCount:report.pagination.uniqueCount,duplicateCount:report.pagination.duplicateCount,repeatedPageFingerprint:false,reason:'페이지 컨트롤/총 페이지 Evidence가 1페이지임을 명시'};
        report.pagination.goldenDataset = {status:'active-structural-baseline', firstPageFingerprint:results[0].fingerprint, firstPageCount:all.length};
        report.pagination.ok = true;
        report.pagination.status = 'verified-full';
      } else if (['query-get','form-post'].includes(finalPlan.kind) && totalPages && totalPages <= 100) {
        const start = pageBase === 0 ? 0 : 1;
        for (let pg=start; pg<start+totalPages; pg++) {
          if (pg === pageBase) continue;
          const req = paginationRequest(finalPlan, selected.url, pg);
          if (!req?.url) break;
          if (paginationSessionCookie) req.headers = { ...(req.headers || {}), cookie: paginationSessionCookie };
          try {
            const pp = await fetchPaginationPageWithRetry(req, LIST_TIMEOUT_MS, selected.url, source);
            const inspect = inspectListingPage(pp.html, {...source,url:pp.finalUrl||req.url});
            const fp = pageFingerprint(inspect.candidates);
            results.push({page:pg,candidates:inspect.candidates,fingerprint:fp,url:pp.finalUrl||req.url,exactMatch:Boolean(inspect.exactMatch)});
            report.pagination.pageFingerprints.push({page:pg,fingerprint:fp,count:inspect.candidates.length,url:pp.finalUrl||req.url,method:req.method});
            report.pagination.pageValidation.push({page:pg,url:pp.finalUrl||req.url,status:inspect.status||'',exactMatch:Boolean(inspect.exactMatch),visiblePostCount:inspect.visiblePostCount??null,candidateCount:inspect.candidateCount??inspect.candidates.length,missingCount:inspect.missingCount??null,extraCount:inspect.extraCount??null,method:req.method,retryEvidence:pp.retryEvidence||null,exactMatchBasis:inspect.diagnostics?.exactMatchBasis||''});
          } catch(error) {
            report.pagination.errors.push(`page ${pg}: ${error.name==='AbortError'?'timeout':error.message}`);
            report.pagination.retryFailures = report.pagination.retryFailures || [];
            report.pagination.retryFailures.push({ page: pg, ...(error.paginationRetryEvidence || { attempts: 1, failures: [{ attempt: 1, error: error.name==='AbortError'?'timeout':error.message }] }) });
          }
        }
        report.pagination.pagesChecked = results.length;
        const rec = reconcilePages(results);
        const repeated = report.pagination.pageFingerprints.some((x,i,a)=>a.findIndex(y=>y.fingerprint===x.fingerprint)<i && x.count>0);
        const allExact = results.every(x=>x.exactMatch || x.candidates.length===0);
        const allPages = results.length === totalPages;
        const identityCollapse = severePaginationIdentityCollapse(rec);
        report.pagination.reconciliation = {...rec,status: allPages && !repeated && !identityCollapse ? 'pass' : 'failed', repeatedPageFingerprint:repeated, identityCollapseDetected:identityCollapse, identityUniqueRatio:rec.rawCount ? rec.uniqueCount / rec.rawCount : 1};
        report.pagination.rawCount=rec.rawCount; report.pagination.uniqueCount=rec.uniqueCount; report.pagination.duplicateCount=rec.duplicateCount;
        report.pagination.goldenDataset = {status:'active-structural-baseline', firstPageFingerprint:results[0].fingerprint, firstPageCount:all.length, note:'첫 도입 실행은 검증된 1페이지를 구조 기준선으로 저장; 이후 실행부터 regression 대조'};
        report.pagination.mismatchPages = report.pagination.pageValidation.filter(page => !page.exactMatch && Number(page.candidateCount || 0) > 0).slice(0,30);
        report.pagination.ok = allPages && !repeated && !identityCollapse && allExact && report.pagination.errors.length===0;
        report.pagination.status = report.pagination.ok ? 'verified-full' : 'partial-or-mismatch';
      } else if (['query-get','form-post'].includes(finalPlan.kind) && !totalPages) {
        // Evidence-backed transport exists, but the board does not publish total pages.
        // Discover the terminal page conservatively: walk sequentially until the first
        // empty page or a repeated non-empty page fingerprint. The terminal response is
        // evidence, not counted as a content page. Cap at 100 to prevent runaway loops.
        let terminal = null;
        let pendingNoise = null;
        const seenFingerprints = new Set([results[0].fingerprint]);
        for (let pg = pageBase + 1; pg <= 100; pg++) {
          const req = paginationRequest(finalPlan, selected.url, pg);
          if (!req?.url) break;
          if (paginationSessionCookie) req.headers = { ...(req.headers || {}), cookie: paginationSessionCookie };
          try {
            const pp = await fetchPaginationPageWithRetry(req, LIST_TIMEOUT_MS, selected.url, source);
            const inspect = inspectListingPage(pp.html, {...source,url:pp.finalUrl||req.url});
            const fp = pageFingerprint(inspect.candidates);
            if (inspect.candidates.length === 0) { terminal = {type:'empty-page', page:pg, url:pp.finalUrl||req.url}; break; }
            // Some legacy boards return a navigation/error fragment after the real last page.
            // Do not count that fragment as content. Confirm it only when the immediately
            // following request repeats the exact same non-record fingerprint.
            if (pendingNoise) {
              if (fp === pendingNoise.fingerprint) { terminal = {type:'repeated-terminal-noise', page:pendingNoise.page, confirmedByPage:pg, fingerprint:fp, url:pendingNoise.url}; pendingNoise = null; break; }
              // It was not terminal noise; preserve it as an observed mismatch page.
              results.push(pendingNoise.result);
              report.pagination.pageFingerprints.push(pendingNoise.fingerprintRow);
              report.pagination.pageValidation.push(pendingNoise.validationRow);
              seenFingerprints.add(pendingNoise.fingerprint);
              pendingNoise = null;
            }
            if (seenFingerprints.has(fp)) { terminal = {type:'repeated-page', page:pg, fingerprint:fp, url:pp.finalUrl||req.url}; break; }
            const resultRow={page:pg,candidates:inspect.candidates,fingerprint:fp,url:pp.finalUrl||req.url,exactMatch:Boolean(inspect.exactMatch)};
            const fingerprintRow={page:pg,fingerprint:fp,count:inspect.candidates.length,url:pp.finalUrl||req.url,method:req.method,retryEvidence:pp.retryEvidence||null};
            const validationRow={page:pg,url:pp.finalUrl||req.url,status:inspect.status||'',exactMatch:Boolean(inspect.exactMatch),visiblePostCount:inspect.visiblePostCount??null,candidateCount:inspect.candidateCount??inspect.candidates.length,missingCount:inspect.missingCount??null,extraCount:inspect.extraCount??null,method:req.method,retryEvidence:pp.retryEvidence||null,exactMatchBasis:inspect.diagnostics?.exactMatchBasis||''};
            if (!inspect.exactMatch && inspect.visiblePostCount == null) {
              pendingNoise={page:pg,fingerprint:fp,url:pp.finalUrl||req.url,result:resultRow,fingerprintRow,validationRow};
              continue;
            }
            seenFingerprints.add(fp);
            results.push(resultRow);
            report.pagination.pageFingerprints.push(fingerprintRow);
            report.pagination.pageValidation.push(validationRow);
          } catch(error) {
            report.pagination.errors.push(`page ${pg}: ${error.name==='AbortError'?'timeout':error.message}`);
            report.pagination.retryFailures = report.pagination.retryFailures || [];
            report.pagination.retryFailures.push({ page: pg, ...(error.paginationRetryEvidence || { attempts: 1, failures: [{ attempt: 1, error: error.name==='AbortError'?'timeout':error.message }] }) });
            break;
          }
        }
        report.pagination.pagesChecked = results.length;
        report.pagination.totalPages = terminal ? results.length : null;
        report.pagination.terminalEvidence = terminal;
        const rec = reconcilePages(results);
        const allExact = results.every(x=>x.exactMatch);
        const terminalProved = Boolean(terminal && ['empty-page','repeated-page','repeated-terminal-noise'].includes(terminal.type));
        const identityCollapse = severePaginationIdentityCollapse(rec);
        report.pagination.reconciliation = {...rec,status:terminalProved&&!identityCollapse?'pass':terminalProved?'failed':'blocked',repeatedPageFingerprint:false,identityCollapseDetected:identityCollapse,identityUniqueRatio:rec.rawCount ? rec.uniqueCount / rec.rawCount : 1,reason:identityCollapse?'severe extracted-identity collapse across pagination':terminalProved?`terminal discovered by ${terminal.type}`:'100-page cap reached without terminal evidence'};
        report.pagination.rawCount=rec.rawCount; report.pagination.uniqueCount=rec.uniqueCount; report.pagination.duplicateCount=rec.duplicateCount;
        report.pagination.mismatchPages = report.pagination.pageValidation.filter(page => !page.exactMatch && Number(page.candidateCount || 0) > 0).slice(0,30);
        report.pagination.ok = terminalProved && !identityCollapse && allExact && report.pagination.errors.length===0;
        report.pagination.status = report.pagination.ok ? 'verified-full' : (terminalProved ? 'partial-or-mismatch' : 'unknown-total-pages');
        report.pagination.goldenDataset={status:'active-structural-baseline',firstPageFingerprint:results[0].fingerprint,firstPageCount:all.length};
      } else if (finalPlan.kind === 'kosha-api' && totalPages && totalPages <= 100) {
        for (let pg=2; pg<=totalPages; pg++) {
          try { const pp=await fetchKoshaTboard('boardList',{},pg); const inspect=inspectListingPage(pp.html,{...source,url:pp.finalUrl}); const fp=pageFingerprint(inspect.candidates); results.push({page:pg,candidates:inspect.candidates,fingerprint:fp,url:pp.finalUrl,exactMatch:Boolean(inspect.exactMatch)}); report.pagination.pageFingerprints.push({page:pg,fingerprint:fp,count:inspect.candidates.length,url:pp.finalUrl}); }
          catch(error){report.pagination.errors.push(`page ${pg}: ${error.name==='AbortError'?'timeout':error.message}`);}
        }
        report.pagination.pagesChecked=results.length; const rec=reconcilePages(results); const repeated=report.pagination.pageFingerprints.some((x,i,a)=>a.findIndex(y=>y.fingerprint===x.fingerprint)<i && x.count>0);
        const identityCollapse=severePaginationIdentityCollapse(rec);
        report.pagination.reconciliation={...rec,status:results.length===totalPages&&!repeated&&!identityCollapse?'pass':'failed',repeatedPageFingerprint:repeated,identityCollapseDetected:identityCollapse,identityUniqueRatio:rec.rawCount ? rec.uniqueCount / rec.rawCount : 1}; report.pagination.rawCount=rec.rawCount;report.pagination.uniqueCount=rec.uniqueCount;report.pagination.duplicateCount=rec.duplicateCount;
        report.pagination.goldenDataset={status:'active-structural-baseline',firstPageFingerprint:results[0].fingerprint,firstPageCount:all.length}; report.pagination.ok=results.length===totalPages&&!repeated&&!identityCollapse&&report.pagination.errors.length===0; report.pagination.status=report.pagination.ok?'verified-full':'partial-or-mismatch';
      } else {
        report.pagination.pagesChecked = 1;
        report.pagination.status = finalPlan.kind === 'javascript-form' ? 'unknown-transport-contract' : 'unknown-total-pages';
        report.pagination.ok = false;
        report.pagination.reconciliation = {status:'blocked',reason:'전체 페이지 요청 규칙 또는 총 페이지 수가 아직 evidence로 확정되지 않음'};
        report.pagination.goldenDataset = {status:'baseline-capture', firstPageFingerprint:results[0].fingerprint, firstPageCount:all.length};
      }
    }

    report.detail.targetCount = all.length;
    report.detail.missingDetailUrl = all.filter(item => item.listOnly).length;
    const attachmentVerifyCandidates = [];
    const attachmentVerifySeen = new Set();
    const allowedHosts = [...new Set((source.accessUrls || [source.url]).map(url => { try { return new URL(url).hostname; } catch { return ''; } }).filter(Boolean))];
    for (const candidate of all.filter(item => !item.listOnly).slice(0, MAX_DETAIL_SAMPLES)) {
      report.detail.attempted += 1;
      const detail = await fetchDetail(candidate.link, { expectedTitle: candidate.title, sourceOrg: source.org, allowedHosts, request: candidate.detailRequest || null }, source.org);
      if (detail.ok) report.detail.validated += 1;
      else report.detail.failed += 1;
      report.attachmentDiscovery.discovered += detail.attachments?.length || 0;
      try {
          if (detail.rawHtml) {
            const detailDir = path.join(orgDir,'detail');
            await fs.mkdir(detailDir,{recursive:true});
            const safeId = safeFileComponent(candidate.link || candidate.title || report.detail.samples.length, { fallback:'detail', maxBytes:64, maxChars:30 });
            await fs.writeFile(path.join(detailDir,`detail-raw-${safeId}.html`), detail.rawHtml,'utf8');
          }
        } catch {}
        report.detail.samples.push({ title: candidate.title, requestedUrl: candidate.link, requestMethod: candidate.detailRequest?.method || 'GET', template: classifyDetailTemplate(candidate.link, candidate), ok: detail.ok, finalUrl: detail.finalUrl || '', textLength: detail.text?.length || 0, attachmentCount: detail.attachments?.length || 0, attachmentSignalCount: detail.attachmentSignalCount || 0, explicitNoAttachment: Boolean(detail.explicitNoAttachment), transport: detail.detailTransport || '', error: detail.error || '' });
      if (Array.isArray(detail.externalAttachmentScripts) && detail.externalAttachmentScripts.length) {
        try {
          const scriptDir = path.join(orgDir,'attachment-scripts');
          await fs.mkdir(scriptDir,{recursive:true});
          for (let index = 0; index < detail.externalAttachmentScripts.length; index += 1) {
            const script = detail.externalAttachmentScripts[index];
            const fileName = `external-${index + 1}-${String(new URL(script.url).pathname.split('/').pop() || 'file.js').replace(/[^a-zA-Z0-9._-]+/g,'_')}`;
            await fs.writeFile(path.join(scriptDir,fileName), script.body || '', 'utf8');
          }
        } catch {}
      }
      for (const file of detail.attachments || []) {
        if (report.attachmentDiscovery.samples.length < 8) report.attachmentDiscovery.samples.push({ name: file.name, type: file.type, url: file.url, method: file.method || 'GET' });
        const key = `${file.method || 'GET'}|${file.url || ''}|${file.body || ''}`;
        if (!attachmentVerifySeen.has(key)) {
          attachmentVerifySeen.add(key);
          attachmentVerifyCandidates.push(file);
        }
      }
    }
    report.detail.coverageRatio = report.detail.targetCount ? report.detail.attempted / report.detail.targetCount : 1;
    report.detail.validationRatio = report.detail.attempted ? report.detail.validated / report.detail.attempted : (report.detail.targetCount === 0 ? 1 : 0);
    report.detail.ok = report.list.ok && (
      (report.list.status === 'verified-empty' && report.detail.targetCount === 0)
      || (report.detail.targetCount === report.list.candidateCount && report.detail.missingDetailUrl === 0 && report.detail.attempted === report.detail.targetCount && report.detail.validated === report.detail.targetCount)
    );
    report.attachmentDiscovery.ok = (report.list.status === 'verified-empty' && report.list.candidateCount === 0) || report.attachmentDiscovery.discovered > 0 || (report.detail.samples.length > 0 && report.detail.samples.every(sample => sample.explicitNoAttachment));
    report.attachmentDiscovery.status = (report.list.status === 'verified-empty' && report.list.candidateCount === 0)
      ? 'not-required-no-posts'
      : (report.detail.samples.length > 0 && report.detail.samples.every(sample => sample.explicitNoAttachment))
        ? 'not-required-no-attachments'
        : report.attachmentDiscovery.ok ? 'success' : 'failed';
    report.attachment = report.attachmentDiscovery;

    const noPosts = report.list.status === 'verified-empty' && report.list.candidateCount === 0;
    const explicitlyNoAttachments = !noPosts && report.detail.samples.length > 0 && report.detail.samples.every(sample => sample.explicitNoAttachment);
    if (noPosts || explicitlyNoAttachments) {
      report.attachmentDownload = { ok:true, status:'not-required', attempted:0, downloaded:0, failed:0, verificationMode:'probe-sample' };
      report.documentAnalysis = { ok:true, capabilityOk:null, status:'not-required', coverageStatus:'not-required', coverageRatio:null, attempted:0, parsed:0, failed:0, verificationMode:'probe-sample', diagnostics:{} };
    } else if (attachmentVerifyCandidates.length > 0) {
      const verification = await analyzeAttachments(attachmentVerifyCandidates, { maxFiles: MAX_ATTACHMENT_VERIFY_FILES });
      report.attachmentDownload = {
        ok: verification.attempted > 0 && verification.downloaded === verification.attempted,
        status: verification.attempted === 0 ? 'not-attempted' : verification.downloaded === verification.attempted ? 'sample-success' : verification.downloaded > 0 ? 'sample-partial' : 'sample-failed',
        attempted: verification.attempted,
        downloaded: verification.downloaded,
        failed: Math.max(0, verification.attempted - verification.downloaded),
        verificationMode: 'probe-sample',
        samples: verification.results.slice(0, MAX_ATTACHMENT_VERIFY_FILES).map(item => ({name:item.name,url:item.url,ok:Boolean(item.downloaded),transport:item.transport || '',contentType:item.contentType || '',error:item.downloaded ? '' : item.error || ''}))
      };
      report.documentAnalysis = {
        ok: verification.attempted > 0 && verification.successful === verification.attempted,
        capabilityOk: verification.successful > 0,
        status: verification.attempted === 0 ? 'not-attempted' : verification.successful === verification.attempted ? 'sample-success' : verification.successful > 0 ? 'sample-partial' : 'sample-failed',
        coverageStatus: verification.coverage?.status || (verification.successful === verification.attempted ? 'complete' : verification.successful > 0 ? 'partial' : 'failed'),
        coverageRatio: verification.coverage?.ratio ?? (verification.attempted > 0 ? verification.successful / verification.attempted : null),
        attempted: verification.attempted,
        parsed: verification.successful,
        failed: Math.max(0, verification.attempted - verification.successful),
        verificationMode: 'probe-sample',
        analyzerVersion: verification.analyzerVersion || '',
        diagnostics: verification.diagnostics || {},
        samples: verification.results.slice(0, MAX_ATTACHMENT_VERIFY_FILES).map(item => ({name:item.name,detectedType:item.detectedType || '',ok:Boolean(item.ok),method:item.method || '',textLength:item.textLength || 0,error:item.ok ? '' : item.error || ''}))
      };
    } else {
      report.attachmentDownload = { ok:false, status:'blocked-by-discovery', attempted:0, downloaded:0, failed:0, verificationMode:'probe-sample' };
      report.documentAnalysis = { ok:false, capabilityOk:false, status:'blocked-by-download', coverageStatus:'blocked', coverageRatio:null, attempted:0, parsed:0, failed:0, verificationMode:'probe-sample', diagnostics:{} };
    }

    if (!report.access.ok) report.bottleneck = '접속';
    else if (!report.list.ok) report.bottleneck = report.list.status === 'count-exact-unverified' ? '목록 개수 일치·제목 정확성 미검증' : report.list.status === 'partial' ? `목록 부분 추출 (${report.list.candidateCount}/${report.list.visiblePostCount})` : report.list.status === 'count-unavailable-or-empty' ? '목록 글 수 판정 불가 또는 실제 0건' : '목록 추출 실패';
    else if (report.list.status === 'verified-empty') report.bottleneck = '현재 실제 공고 0건 · 상세·첨부 대상 없음';
    else if (report.list.detailUrlReady === 0) report.bottleneck = '상세 URL 복구';
    else if (!report.detail.ok) report.bottleneck = '상세페이지 추출';
    else if (!report.attachmentDiscovery.ok) report.bottleneck = '첨부 발견/추출';
    else if (!report.attachmentDownload.ok) report.bottleneck = '첨부 다운로드';
    else if (!report.documentAnalysis.ok) report.bottleneck = report.documentAnalysis.capabilityOk
      ? `문서 분석 부분 성공 (${report.documentAnalysis.parsed}/${report.documentAnalysis.attempted})`
      : '문서 분석';
    else report.bottleneck = '현재 수집·문서분석 검증 범위 통과';
  } catch (error) {
    report.access.attempts = error.attempts || report.access.attempts;
    report.access.error = error.name === 'AbortError' ? 'timeout' : error.message;
    report.bottleneck = error.recruitVerifyFailed ? '채용게시판 검증' : 'HTTP 접속';
  }
  report.elapsedMs = Date.now() - startedAt;
  applyHistoricalPagination(report);
  return attachRootCauses(report);
}

const results = [];
const artifacts = [];
const CONCURRENCY = 4;
for (let index = 0; index < SOURCES.length; index += CONCURRENCY) {
  const batch = await Promise.all(SOURCES.slice(index, index + CONCURRENCY).map(source => probeSource(source, artifacts)));
  results.push(...batch);
  for (const result of batch) console.log(`${result.org}: ${result.bottleneck}`);
}


function evaluateStage7Gate(results = []) {
  const rows = results.map(item => {
    const p = item.pagination || {};
    const rec = p.reconciliation || {};
    const structuralOk = !rec.identityCollapseDetected
      && Number(rec.unexplainedLoss || 0) === 0
      && (!Number.isFinite(rec.identityUniqueRatio) || rec.identityUniqueRatio >= 0.5);
    const implementationOk = Boolean(p.implementationOk);
    const currentRunOk = Boolean(p.currentRunOk);
    const historicalOnly = p.status === 'verified-historical' && implementationOk && !currentRunOk;
    const transientOnly = !currentRunOk
      && Array.isArray(p.retryFailures)
      && p.retryFailures.length > 0
      && p.retryFailures.every(row => (row.failures || []).every(f => /timeout|fetch failed|HTTP 429|HTTP 5\d\d|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(f.error || ''))));
    return {
      org: item.org,
      status: p.status || 'not-evaluated',
      implementationOk,
      currentRunOk,
      historicalOnly,
      transientOnly,
      structuralOk,
      errors: p.errors || []
    };
  });

  // Stage 7 may close only when every source has implementation proof and no
  // structural reconciliation defect remains. A historical-only source is
  // allowed as implementation proof only when current Access/List remain healthy;
  // it is surfaced separately so operational monitoring can keep watching it.
  const implementationComplete = rows.every(r => r.implementationOk && r.structuralOk);
  const currentRunComplete = rows.every(r => r.currentRunOk && r.structuralOk);
  const historicalOnly = rows.filter(r => r.historicalOnly).map(r => r.org);
  const transientOnly = rows.filter(r => r.transientOnly).map(r => r.org);
  const blockers = rows.filter(r => !r.implementationOk || !r.structuralOk).map(r => ({
    org: r.org, status: r.status, implementationOk: r.implementationOk,
    structuralOk: r.structuralOk, errors: r.errors
  }));
  const decision = implementationComplete ? 'close-stage-7' : 'keep-stage-7-open';

  return {
    decision,
    implementationComplete,
    currentRunComplete,
    sourceCount: rows.length,
    implementationVerified: rows.filter(r => r.implementationOk && r.structuralOk).length,
    currentRunVerified: rows.filter(r => r.currentRunOk && r.structuralOk).length,
    historicalOnly,
    transientOnly,
    blockers,
    rule: '20/20 implementation proof + no structural reconciliation defect; historical-only evidence may preserve implementation proof but remains operational-watch'
  };
}

const stage7Gate = evaluateStage7Gate(results);

const payload = {
  version: VERSION,
  stage7Gate,
  sourceRegistryVersion: SOURCE_REGISTRY_VERSION,
  generatedAt: new Date().toISOString(),
  policy: 'HTTP·채용게시판 검증·목록·상세·첨부 발견·대표 첨부 다운로드·문서 분석을 기관별로 독립 검증하고, 실제 수집 결과와 병합',
  summary: {
    sourceCount: results.length,
    httpOk: results.filter(item => item.access.httpOk).length,
    recruitVerifyOk: results.filter(item => item.access.recruitVerifyOk).length,
    accessOk: results.filter(item => item.access.recruitVerifyOk).length,
    listOk: results.filter(item => item.list.ok).length,
    detailOk: results.filter(item => item.detail.ok).length,
    attachmentDiscoveryOk: results.filter(item => item.attachmentDiscovery.ok).length,
    attachmentOk: results.filter(item => item.attachmentDiscovery.ok).length,
    attachmentDownloadOk: results.filter(item => item.attachmentDownload?.ok).length,
    documentAnalysisOk: results.filter(item => item.documentAnalysis?.ok).length,
    documentAnalysisCapabilityOk: results.filter(item => item.documentAnalysis?.capabilityOk === true || item.documentAnalysis?.status === 'not-required').length,
    collectionDocumentSampleOk: results.filter(item => item.access.recruitVerifyOk && item.list.ok && item.detail.ok && item.attachmentDiscovery.ok && item.attachmentDownload?.ok && item.documentAnalysis?.ok).length,
    deprecated: { fullPipelineOk: results.filter(item => item.access.recruitVerifyOk && item.list.ok && item.detail.ok && item.attachmentDiscovery.ok && item.attachmentDownload?.ok && item.documentAnalysis?.ok).length, note: '호환용 구 필드. Pipeline Complete 의미로 사용 금지' },
    paginationImplementationVerified: results.filter(item => item.pagination?.implementationOk).length,
    paginationCurrentRunVerified: results.filter(item => item.pagination?.currentRunOk).length,
    paginationVerifiedFull: results.filter(item => item.pagination?.status === 'verified-full').length,
    paginationVerifiedSingle: results.filter(item => item.pagination?.status === 'verified-single').length,
    paginationVerifiedHistorical: results.filter(item => item.pagination?.status === 'verified-historical').length,
    stage7ImplementationComplete: stage7Gate.implementationComplete,
    stage7CurrentRunComplete: stage7Gate.currentRunComplete,
    stage7Decision: stage7Gate.decision,
    stage7BlockerCount: stage7Gate.blockers.length,
    causeCounts: results.reduce((acc, item) => { const key = item.primaryCause?.code || 'UNKNOWN'; acc[key] = (acc[key] || 0) + 1; return acc; }, {})
  },
  sources: results
};
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/pipeline-report.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
await fs.writeFile('data/pipeline-artifacts.json', `${JSON.stringify({ version: VERSION, generatedAt: payload.generatedAt, sourceCount: SOURCES.length, artifacts }, null, 2)}\n`, 'utf8');
console.log(payload.summary);
console.log({ reportPath: 'data/pipeline-report.json', artifactsPath: 'data/pipeline-artifacts.json' });
