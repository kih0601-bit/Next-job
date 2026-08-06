import { createHash } from 'node:crypto';
import { cleanHtml } from './detail-parser.mjs';
import { normalizeBoardTitle } from './list-pipeline.mjs';

const DATE_RE = /(?:19|20)\d{2}[.\-/년]\s*\d{1,2}(?:[.\-/월]\s*\d{1,2})?/;
const NAV_RE = /^(?:홈|메인|목록|이전|다음|처음|마지막|더보기|바로가기|로그인|회원가입|사이트맵|검색|전체메뉴)$/i;
const RECRUIT_RE = /채용|모집|공고|입사지원|recruit|career|employment|job/i;

function text(value = '') {
  return cleanHtml(value).replace(/\s+/g, ' ').trim();
}

function sampleHtml(value = '', max = 8000) {
  return String(value).replace(/\u0000/g, '').slice(0, max);
}

function hash(value = '') {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function attrs(block = '') {
  const href = block.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  const onclick = block.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  const dataUrl = block.match(/\b(?:data-url|data-href)\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  const id = block.match(/\bid\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  const className = block.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  return { href, onclick, dataUrl, id, className };
}

function titleFromBlock(block = '') {
  const titled = block.match(/<a\b[^>]*\btitle\s*=\s*(["'])([^"']+)\1[^>]*>/i)?.[2];
  if (titled && text(titled).length >= 4) return text(titled);
  const anchors = [...block.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => text(match[1]))
    .filter(value => value && !/^(?:download|첨부|파일|보기)$/i.test(value));
  const recruitAnchor = anchors.find(value => RECRUIT_RE.test(value));
  if (recruitAnchor) return recruitAnchor;
  if (anchors.length) return anchors.sort((a, b) => b.length - a.length)[0];
  const cells = [...block.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => text(match[1]))
    .filter(value => value && !/^(?:공지|notice|\d{1,6}|(?:19|20)\d{2}[.\-/].*)$/i.test(value));
  return cells.sort((a, b) => b.length - a.length)[0] || '';
}

function blockRecord(block, kind, index) {
  const blockText = text(block);
  const title = titleFromBlock(block);
  const linkAttrs = attrs(block);
  const firstCell = text(block.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] || '');
  return {
    id: `${kind}-${index}-${hash(block)}`,
    kind,
    index,
    title,
    normalizedTitle: normalizeBoardTitle(title),
    text: blockText.slice(0, 1600),
    hasDate: DATE_RE.test(blockText),
    hasSequence: /^(?:공지|notice|\d{1,6})$/i.test(firstCell),
    hasRecruitSignal: RECRUIT_RE.test(blockText),
    hasAction: Boolean(linkAttrs.href || linkAttrs.onclick || linkAttrs.dataUrl),
    ...linkAttrs,
    html: sampleHtml(block)
  };
}

function collectBlocks(html = '') {
  const source = String(html);
  const definitions = [
    ['tr', /<tr\b[^>]*>[\s\S]*?<\/tr>/gi],
    ['li', /<li\b[^>]*>[\s\S]*?<\/li>/gi],
    ['article', /<article\b[^>]*>[\s\S]*?<\/article>/gi]
  ];
  const blocks = [];
  for (const [kind, regex] of definitions) {
    let index = 0;
    for (const match of source.matchAll(regex)) {
      const block = match[0];
      if (kind === 'tr' && !/<td\b/i.test(block)) continue;
      const record = blockRecord(block, kind, index++);
      if (kind !== 'tr' && !record.hasAction && !record.hasRecruitSignal) continue;
      blocks.push(record);
    }
  }
  return blocks;
}

function selectorCounts(html = '') {
  const selectors = {
    'tbody': /<tbody\b[^>]*>/gi,
    'tr': /<tr\b[^>]*>[\s\S]*?<\/tr>/gi,
    'tr-with-td': /<tr\b[^>]*>[\s\S]*?<td\b[\s\S]*?<\/tr>/gi,
    'li': /<li\b[^>]*>[\s\S]*?<\/li>/gi,
    'article': /<article\b[^>]*>[\s\S]*?<\/article>/gi,
    '[onclick]': /<[^>]+\bonclick\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    '[data-url]': /<[^>]+\bdata-url\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    '[data-href]': /<[^>]+\bdata-href\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    'a[href]': /<a\b[^>]*\bhref\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    'iframe': /<iframe\b[^>]*>/gi,
    'script': /<script\b[^>]*>/gi,
    'form': /<form\b[^>]*>/gi
  };
  const counts = {};
  for (const [name, regex] of Object.entries(selectors)) counts[name] = [...String(html).matchAll(regex)].length;
  return counts;
}

function inferRejectReason(row) {
  if (!row.title) return 'TITLE_EMPTY';
  if (row.title.length < 4) return 'TITLE_TOO_SHORT';
  if (row.title.length > 260) return 'TITLE_TOO_LONG';
  if (NAV_RE.test(row.title)) return 'NAVIGATION_TITLE';
  if (!row.hasAction) return 'DETAIL_SIGNAL_MISSING';
  if (!row.hasDate && !row.hasSequence && !row.hasRecruitSignal) return 'ROW_SHAPE_NOT_RECOGNIZED';
  return 'UNMATCHED_BY_EXTRACTOR';
}

function matchCandidate(row, selectedCandidates) {
  if (!row.normalizedTitle) return null;
  return selectedCandidates.find(item => normalizeBoardTitle(item.title) === row.normalizedTitle) || null;
}

function pageSignals(html, blocks, selectedCandidates, inspection) {
  const lower = String(html).toLowerCase();
  return {
    htmlLength: String(html).length,
    iframePresent: /<iframe\b/i.test(html),
    javascriptLinks: (String(html).match(/javascript\s*:/gi) || []).length,
    formCount: (String(html).match(/<form\b/gi) || []).length,
    recruitKeywordCount: (lower.match(/채용|모집|recruit|career|employment/g) || []).length,
    structuredBlockCount: blocks.length,
    blocksWithAction: blocks.filter(item => item.hasAction).length,
    blocksWithRecruitSignal: blocks.filter(item => item.hasRecruitSignal).length,
    extractedCandidateCount: selectedCandidates.length,
    visiblePostCount: inspection.visiblePostCount ?? null
  };
}

function inferCause({ blocks, selectedCandidates, missingRows, extraCandidates, inspection, signals }) {
  if (signals.iframePresent && blocks.length === 0 && selectedCandidates.length === 0) return 'IFRAME_CONTENT_NOT_INSPECTED';
  if (blocks.length === 0 && selectedCandidates.length > 0) return 'VISIBLE_ROW_COUNTER_INCOMPATIBLE_WITH_PAGE_STRUCTURE';
  if (blocks.length === 0 && selectedCandidates.length === 0 && signals.recruitKeywordCount > 0) return 'NON_STANDARD_OR_SCRIPT_RENDERED_LIST_STRUCTURE';
  if (blocks.length === 0 && selectedCandidates.length === 0) return 'WRONG_PAGE_OR_EMPTY_RESPONSE';
  if (blocks.length > 0 && selectedCandidates.length === 0 && missingRows.every(row => row.rejectionReason === 'TITLE_EMPTY')) return 'TITLE_EXTRACTION_FAILED_FOR_ALL_ROWS';
  if (blocks.length > 0 && selectedCandidates.length === 0 && missingRows.every(row => row.rejectionReason === 'DETAIL_SIGNAL_MISSING')) return 'DETAIL_SIGNAL_NOT_EXPOSED_IN_ROWS';
  if (blocks.length > 0 && selectedCandidates.length === 0) return 'ROW_ACCEPTANCE_RULE_REJECTED_ALL';
  if (missingRows.length > 0) return 'PARTIAL_ROW_REJECTION';
  if (extraCandidates.length > 0) return 'NON_ROW_CANDIDATES_OR_COUNTER_MISMATCH';
  if (inspection.visiblePostCount == null) return 'VISIBLE_ROW_COUNTER_UNAVAILABLE';
  return 'NO_LIST_ROOT_CAUSE_DETECTED';
}

export function buildListRootCauseDiagnostics({ html = '', source = {}, inspection = {}, selectedCandidates = [], requestedUrl = '' }) {
  const blocks = collectBlocks(html);
  const rowTrace = blocks.map(row => {
    const candidate = matchCandidate(row, selectedCandidates);
    return {
      ...row,
      accepted: Boolean(candidate),
      acceptedLink: candidate?.link || '',
      adapter: candidate?.adapter || '',
      rejectionReason: candidate ? '' : inferRejectReason(row)
    };
  });
  const rejectReasonCounts = rowTrace.reduce((acc, row) => {
    if (row.rejectionReason) acc[row.rejectionReason] = (acc[row.rejectionReason] || 0) + 1;
    return acc;
  }, {});
  const extractedTitles = selectedCandidates.map(item => item.title).filter(Boolean);
  const visibleTitles = rowTrace.map(item => item.title).filter(Boolean);
  const extractedSet = new Set(extractedTitles.map(normalizeBoardTitle));
  const missingRows = rowTrace.filter(item => item.title && !extractedSet.has(item.normalizedTitle));
  const extraCandidates = selectedCandidates.filter(item => !rowTrace.some(row => row.normalizedTitle === normalizeBoardTitle(item.title)));
  const signals = pageSignals(html, blocks, selectedCandidates, inspection);
  const probableCause = inferCause({ blocks, selectedCandidates, missingRows, extraCandidates, inspection, signals });

  return {
    version: '2.0',
    org: source.org || 'unknown',
    requestedUrl: requestedUrl || source.url || '',
    finalUrl: source.url || requestedUrl || '',
    probableCause,
    evidenceLevel: probableCause === 'NO_LIST_ROOT_CAUSE_DETECTED' ? 'none' : 'direct-runtime-evidence',
    counts: {
      visiblePostCount: inspection.visiblePostCount ?? null,
      candidateCount: inspection.candidateCount ?? selectedCandidates.length,
      inspectedBlocks: blocks.length,
      missingRows: missingRows.length,
      extraCandidates: extraCandidates.length
    },
    pageSignals: signals,
    selectorCounts: selectorCounts(html),
    rejectReasonCounts,
    visibleTitles,
    extractedTitles,
    missingRows,
    extraCandidates,
    rowTrace
  };
}
