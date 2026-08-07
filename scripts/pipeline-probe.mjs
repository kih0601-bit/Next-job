import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SOURCES, SOURCE_REGISTRY_VERSION } from './collectors/source-registry.mjs';
import { discoverListingUrls } from './collectors/source-adapters.mjs';
import { inspectListingPage } from './lib/list-pipeline.mjs';
import { buildListRootCauseDiagnostics } from './lib/list-root-cause-diagnostics.mjs';
import { cleanHtml, fetchDetail } from './lib/detail-parser.mjs';
import { inspectRecruitPage, chooseBestAccessPage, summarizeAccessAttempts } from './lib/access-diagnostics.mjs';
import { buildAccessPlan, getTransportChain, accessTemplateSummary } from './lib/access-templates.mjs';

const VERSION = '16.8-20-sources-list-accuracy-verification';
const MAX_LISTING_PAGES = 3;
const MAX_DETAIL_SAMPLES = 2;
const ACCESS_TIMEOUT_MS = 18000;
const LIST_TIMEOUT_MS = 10000;
const MAX_ACCESS_URLS = 6;
const MAX_HTML_EXCERPT = 18000;
const MAX_RELEVANT_SNIPPETS = 24;
const MAX_SCRIPT_SNIPPETS = 12;
const execFileAsync = promisify(execFile);


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

async function fetchHtmlWithFetch(url, timeoutMs = 22000, referer = '') {
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

async function fetchHtml(url, timeoutMs = 22000, referer = '', source = {}) {
  const chain = getTransportChain(source);
  let lastError = null;
  for (const transport of chain) {
    try {
      if (transport === 'fetch') return await fetchHtmlWithFetch(url, timeoutMs, referer);
      if (transport === 'curl') return await fetchHtmlWithCurl(url, timeoutMs, referer);
      throw new Error(`unsupported transport: ${transport}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('no access transport available');
}

async function accessiblePages(source) {
  const attempts = [];
  const pages = [];
  const accessPlan = buildAccessPlan(source).slice(0, MAX_ACCESS_URLS);
  for (const plan of accessPlan) {
    const { accessPriority, url } = plan;
    try {
      const result = await fetchHtml(url, ACCESS_TIMEOUT_MS, source.homepage || '', source);
      const verification = inspectRecruitPage({ ...result, requestedUrl: url, org: source.org, accessTemplate: source.accessTemplate, accessConfig: source.accessConfig });
      attempts.push({ url, ok: true, status: result.status, finalUrl: result.finalUrl, verification, accessTemplate: plan.template, requestProfile: plan.requestProfile });
      pages.push({ ...result, requestedUrl: url, verification, accessPriority, accessTemplate: plan.template, requestProfile: plan.requestProfile });
    } catch (error) {
      attempts.push({ url, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message, accessTemplate: plan.template, requestProfile: plan.requestProfile });
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
  if ((report.list.detailUrlReady || 0) === 0) return { status: 'failed', code: 'DETAIL_URL_NOT_READY', reason: `목록 ${report.list.candidateCount}건 모두 상세 URL 미복구`, evidence: report.list.extractionDiagnostics || [] };
  if ((report.detail.attempted || 0) === 0) return { status: 'failed', code: 'DETAIL_NOT_ATTEMPTED', reason: '상세 URL은 있으나 상세 요청이 실행되지 않음', evidence: [] };
  if (report.detail.ok) return { status: 'success', code: 'DETAIL_OK', reason: `${report.detail.attempted}건 시도 · ${report.detail.validated}건 본문 검증 성공`, evidence: report.detail.samples || [] };
  const errors = (report.detail.samples || []).map(item => item.error || '');
  if (errors.some(value => /404|HTTP 404/i.test(value))) return { status: 'failed', code: 'DETAIL_404', reason: '생성된 상세 URL이 404를 반환함 · URL 규칙 오류 가능', evidence: report.detail.samples || [] };
  if (errors.some(value => /403|forbidden/i.test(value))) return { status: 'failed', code: 'DETAIL_FORBIDDEN', reason: '상세페이지 요청이 차단됨', evidence: report.detail.samples || [] };
  if ((report.detail.samples || []).some(item => item.textLength === 0)) return { status: 'failed', code: 'DETAIL_EMPTY_BODY', reason: '상세 응답은 받았지만 본문 텍스트를 찾지 못함', evidence: report.detail.samples || [] };
  return { status: 'failed', code: 'DETAIL_VALIDATION_FAILED', reason: '상세페이지 응답이 제목·본문 검증을 통과하지 못함', evidence: report.detail.samples || [] };
}

function classifyAttachment(report) {
  if (!report.detail?.ok) return { status: 'blocked', code: 'ATTACHMENT_BLOCKED_BY_DETAIL', reason: '상세 단계 미통과로 첨부 진단 보류', evidence: [] };
  if ((report.attachment.discovered || 0) > 0) return { status: 'success', code: 'ATTACHMENT_FOUND', reason: `검증 표본에서 첨부 링크 ${report.attachment.discovered}개 발견`, evidence: report.attachment.samples || [] };
  return { status: 'unknown', code: 'ATTACHMENT_ZERO_UNRESOLVED', reason: '첨부 링크 0개 · 실제 첨부 없음과 추출 실패를 현재 표본만으로 구분하지 못함', evidence: report.detail.samples || [] };
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
    ATTACHMENT_ZERO_UNRESOLVED: { repairTarget: institutionAdapter, recommendedAction: '기관 전용 첨부 영역 선택자와 실제 첨부 없음 판정 규칙 추가' }
  };
  return map[code] || { repairTarget: institutionAdapter, recommendedAction: '진단 evidence를 기준으로 기관 전용 Adapter 확인' };
}

function attachRootCauses(report) {
  report.diagnosis = {
    http: classifyHttp(report),
    recruitVerify: classifyRecruitVerify(report),
    list: classifyList(report),
    detail: classifyDetail(report),
    attachment: classifyAttachment(report)
  };
  // Backward-compatible alias for older report consumers.
  report.diagnosis.access = report.diagnosis.recruitVerify;
  const order = ['http', 'recruitVerify', 'list', 'detail', 'attachment'];
  const first = order.map(stage => ({ stage, ...report.diagnosis[stage] })).find(item => item.status === 'failed' || item.status === 'partial' || item.status === 'unknown');
  report.primaryCause = first || { stage: 'complete', status: 'success', code: 'PIPELINE_SAMPLE_OK', reason: '현재 진단 표본에서 실패 원인 없음', evidence: [] };
  Object.assign(report.primaryCause, remediationFor(report.primaryCause.code, report.org));
  report.stageLabel = `${report.primaryCause.stage}:${report.primaryCause.code}`;
  report.bottleneck = report.primaryCause.reason;
  return report;
}

function safeName(value = '') { return String(value).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 100) || 'unknown'; }

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
    access: { ok: false, httpOk: false, recruitVerifyOk: false, attempts: [], boardType: { type: 'UNKNOWN', confidence: 'low', evidence: [] } },
    list: { ok: false, status: 'unknown', pagesChecked: 0, visiblePostCount: null, candidateCount: 0, missingCount: null, extraCount: null, exactMatch: false, selectedUrl: '', detailUrlReady: 0, listOnlyCount: 0, extractionDiagnostics: [], rootCauseDiagnostics: [], diagnosticFiles: [], samples: [], errors: [] },
    detail: { ok: false, attempted: 0, validated: 0, samples: [] },
    attachment: { ok: false, discovered: 0, samples: [] },
    bottleneck: '',
    elapsedMs: 0
  };
  try {
    const access = await accessiblePages(source);
    const first = access.selected || access.pages[0];
    for (const page of access.pages) artifacts.push(pageArtifact(source, page, 'access'));
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
    const selected = pageResults.sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch) || (b.visiblePostCount ?? -1) - (a.visiblePostCount ?? -1) || b.candidateCount - a.candidateCount)[0];
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
    else if (selected.status === 'empty-or-wrong-page' || selected.status === 'count-unavailable') report.list.status = 'count-unavailable-or-empty';
    else if (selected.status === 'exact' && report.list.accuracyVerification.verified) report.list.status = 'verified-exact';
    else if (selected.status === 'exact') report.list.status = 'count-exact-unverified';
    else report.list.status = selected.status;
    report.list.ok = report.list.status === 'verified-exact';

    const allowedHosts = [...new Set((source.accessUrls || [source.url]).map(url => { try { return new URL(url).hostname; } catch { return ''; } }).filter(Boolean))];
    for (const candidate of all.filter(item => !item.listOnly).slice(0, MAX_DETAIL_SAMPLES)) {
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
    else if (!report.list.ok) report.bottleneck = report.list.status === 'count-exact-unverified' ? '목록 개수 일치·제목 정확성 미검증' : report.list.status === 'partial' ? `목록 부분 추출 (${report.list.candidateCount}/${report.list.visiblePostCount})` : report.list.status === 'count-unavailable-or-empty' ? '목록 글 수 판정 불가 또는 실제 0건' : '목록 추출 실패';
    else if (report.list.detailUrlReady === 0) report.bottleneck = '상세 URL 복구';
    else if (!report.detail.ok) report.bottleneck = '상세페이지 추출';
    else if (!report.attachment.ok) report.bottleneck = '첨부파일 추출 또는 현재 표본에 첨부 없음';
    else report.bottleneck = '기본 파이프라인 통과';
  } catch (error) {
    report.access.attempts = error.attempts || report.access.attempts;
    report.access.error = error.name === 'AbortError' ? 'timeout' : error.message;
    report.bottleneck = error.recruitVerifyFailed ? '채용게시판 검증' : 'HTTP 접속';
  }
  report.elapsedMs = Date.now() - startedAt;
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

const payload = {
  version: VERSION,
  sourceRegistryVersion: SOURCE_REGISTRY_VERSION,
  generatedAt: new Date().toISOString(),
  policy: 'HTTP·채용게시판 검증·목록·상세·첨부를 분리하고 기관 유형과 수정 우선순위를 기록',
  summary: {
    sourceCount: results.length,
    httpOk: results.filter(item => item.access.httpOk).length,
    recruitVerifyOk: results.filter(item => item.access.recruitVerifyOk).length,
    accessOk: results.filter(item => item.access.recruitVerifyOk).length,
    listOk: results.filter(item => item.list.ok).length,
    detailOk: results.filter(item => item.detail.ok).length,
    attachmentOk: results.filter(item => item.attachment.ok).length,
    fullPipelineOk: results.filter(item => item.access.recruitVerifyOk && item.list.ok && item.detail.ok && item.attachment.ok).length,
    causeCounts: results.reduce((acc, item) => { const key = item.primaryCause?.code || 'UNKNOWN'; acc[key] = (acc[key] || 0) + 1; return acc; }, {})
  },
  sources: results
};
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/pipeline-report.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
await fs.writeFile('data/pipeline-artifacts.json', `${JSON.stringify({ version: VERSION, generatedAt: payload.generatedAt, sourceCount: SOURCES.length, artifacts }, null, 2)}\n`, 'utf8');
console.log(payload.summary);
console.log({ reportPath: 'data/pipeline-report.json', artifactsPath: 'data/pipeline-artifacts.json' });
