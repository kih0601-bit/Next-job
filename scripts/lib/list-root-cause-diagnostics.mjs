import { cleanHtml } from './detail-parser.mjs';
import { normalizeBoardTitle } from './list-pipeline.mjs';

const DATE_RE = /(?:19|20)\d{2}[.\-/년]\s*\d{1,2}(?:[.\-/월]\s*\d{1,2})?/;
const NAV_RE = /^(?:홈|메인|목록|이전|다음|처음|마지막|더보기|바로가기|로그인|회원가입|사이트맵|검색|전체메뉴)$/i;

function text(value = '') {
  return cleanHtml(value).replace(/\s+/g, ' ').trim();
}

function sampleHtml(value = '', max = 5000) {
  return String(value).replace(/\u0000/g, '').slice(0, max);
}

function attrs(block = '') {
  const href = block.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  const onclick = block.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  const dataUrl = block.match(/\b(?:data-url|data-href)\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  return { href, onclick, dataUrl };
}

function titleFromRow(block = '') {
  const preferred = block.match(/<a\b[^>]*(?:class\s*=\s*(["'])[^"']*(?:title|subject|sj|tit|ellipsis)[^"']*\1|title\s*=\s*(["'])[^"']+\2)[^>]*>([\s\S]*?)<\/a>/i)?.[3];
  if (preferred) return text(preferred);
  const anchors = [...block.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => text(match[1]))
    .filter(value => value && !/^(?:download|첨부|파일|보기)$/i.test(value));
  if (anchors.length) return anchors.sort((a, b) => b.length - a.length)[0];
  const cells = [...block.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => text(match[1]))
    .filter(value => value && !/^(?:공지|notice|\d{1,6}|(?:19|20)\d{2}[.\-/].*)$/i.test(value));
  return cells.sort((a, b) => b.length - a.length)[0] || '';
}

function collectRows(html = '') {
  const rows = [];
  for (const match of String(html).matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const block = match[0];
    const cells = [...block.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)];
    if (!cells.length || (/<th\b/i.test(block) && !/<td\b/i.test(block))) continue;
    const rowText = text(block);
    const title = titleFromRow(block);
    const linkAttrs = attrs(block);
    rows.push({
      index: rows.length,
      title,
      normalizedTitle: normalizeBoardTitle(title),
      text: rowText.slice(0, 1200),
      hasDate: DATE_RE.test(rowText),
      hasSequence: /^(?:공지|notice|\d{1,6})$/i.test(text(cells[0]?.[0] || '')),
      hasAction: Boolean(linkAttrs.href || linkAttrs.onclick || linkAttrs.dataUrl),
      ...linkAttrs,
      html: sampleHtml(block)
    });
  }
  return rows;
}

function selectorCounts(html = '') {
  const selectors = {
    'table tbody tr': /<tbody\b[^>]*>[\s\S]*?<\/tbody>/gi,
    'tr': /<tr\b[^>]*>[\s\S]*?<\/tr>/gi,
    'li': /<li\b[^>]*>[\s\S]*?<\/li>/gi,
    'article': /<article\b[^>]*>[\s\S]*?<\/article>/gi,
    '[onclick]': /<[^>]+\bonclick\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    '[data-url]': /<[^>]+\bdata-url\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    '[data-href]': /<[^>]+\bdata-href\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi,
    'a[href]': /<a\b[^>]*\bhref\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi
  };
  const counts = {};
  for (const [name, regex] of Object.entries(selectors)) counts[name] = [...String(html).matchAll(regex)].length;
  return counts;
}

function inferRowReason(row) {
  if (!row.title) return 'TITLE_EMPTY';
  if (row.title.length < 4) return 'TITLE_TOO_SHORT';
  if (row.title.length > 260) return 'TITLE_TOO_LONG';
  if (NAV_RE.test(row.title)) return 'NAVIGATION_TITLE';
  if (!row.hasAction) return 'DETAIL_SIGNAL_MISSING';
  if (!row.hasDate && !row.hasSequence) return 'ROW_SHAPE_NOT_RECOGNIZED';
  return 'UNMATCHED_BY_EXTRACTOR';
}


function classifyCandidate(item = {}) {
  const title = text(item.title || '');
  const link = String(item.link || '');
  if (/FAQ|자주 묻는|질문/.test(title)) return 'FAQ';
  if (/IR|투자정보|경영공시|회사소개|조직도|오시는길/.test(title)) return 'MENU_OR_IR';
  if (/공지|합격자|면접|서류|필기|채용|모집|인턴|직원|근로자/.test(title)) return 'RECRUIT_POST';
  if (/download|file|첨부/i.test(link)) return 'ATTACHMENT';
  return 'UNCLASSIFIED';
}

function counterFailureReason({ rows, selectedCandidates, inspection, uniqueVisibleCount }) {
  const visible = inspection.visiblePostCount;
  const candidateCount = selectedCandidates.length;
  if (visible == null && rows.length === 0 && candidateCount > 0) return 'DOM_COUNT_ZERO';
  if (visible == null && rows.length > 0) return 'COUNTER_SELECTOR_MISMATCH';
  if (visible == null && candidateCount > 0) return 'COUNTER_ONLY';
  if (visible != null && uniqueVisibleCount === candidateCount && visible !== candidateCount) return 'RAW_ROW_DUPLICATE_COUNT';
  if (visible != null && candidateCount === 0 && rows.length > 0) return 'EXTRACTOR_REJECTED_ROWS';
  if (visible != null && candidateCount < uniqueVisibleCount) return 'MISSING_UNIQUE_POSTS';
  if (visible != null && candidateCount > uniqueVisibleCount) return 'EXTRA_NON_ROW_CANDIDATES';
  return 'UNKNOWN';
}

export function buildListRootCauseDiagnostics({ html = '', source, inspection, selectedCandidates = [] }) {
  const rows = collectRows(html);
  const accepted = new Map(selectedCandidates.map(item => [normalizeBoardTitle(item.title), item]));
  const rowTrace = rows.map(row => {
    const candidate = accepted.get(row.normalizedTitle);
    return {
      ...row,
      accepted: Boolean(candidate),
      acceptedLink: candidate?.link || '',
      adapter: candidate?.adapter || '',
      rejectionReason: candidate ? '' : inferRowReason(row)
    };
  });
  const rejectReasonCounts = rowTrace.reduce((acc, row) => {
    if (!row.rejectionReason) return acc;
    acc[row.rejectionReason] = (acc[row.rejectionReason] || 0) + 1;
    return acc;
  }, {});
  const extractedTitles = selectedCandidates.map(item => item.title);
  const visibleTitles = rowTrace.map(item => item.title).filter(Boolean);
  const extractedSet = new Set(extractedTitles.map(normalizeBoardTitle));
  const missingRows = rowTrace.filter(item => item.title && !extractedSet.has(item.normalizedTitle));
  const extraCandidates = selectedCandidates.filter(item => !rowTrace.some(row => row.normalizedTitle === normalizeBoardTitle(item.title)));
  const uniqueVisibleTitles = [...new Set(visibleTitles.map(normalizeBoardTitle).filter(Boolean))];
  const candidateClassCounts = selectedCandidates.reduce((acc, item) => {
    const kind = classifyCandidate(item);
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  const counterTrace = {
    source: inspection?.diagnostics?.countSource || inspection?.countSource || (inspection.visiblePostCount == null ? 'unavailable' : 'visible-board-rows'),
    rawDomRows: rows.length,
    uniqueVisibleTitleCount: uniqueVisibleTitles.length,
    reportedVisiblePostCount: inspection.visiblePostCount,
    acceptedCandidateCount: selectedCandidates.length,
    exactAgainstRaw: rows.length === selectedCandidates.length,
    exactAgainstUniqueTitles: uniqueVisibleTitles.length === selectedCandidates.length
  };
  const listCounterFailureReason = counterFailureReason({ rows, selectedCandidates, inspection, uniqueVisibleCount: uniqueVisibleTitles.length });

  // Phase 49: list completion means the actual recruitment-board post list was read,
  // not merely that two counters happened to match. Prefer independent DOM row/title
  // evidence. Source-specific adapters can also provide strong record-level evidence
  // when the board is API/JS based and does not expose normal <tr> rows.
  const independentDomEvidence = rows.length > 0;
  const exactTitleSet = independentDomEvidence
    && missingRows.length === 0
    && extraCandidates.length === 0
    && uniqueVisibleTitles.length === selectedCandidates.length
    && selectedCandidates.length === inspection.visiblePostCount;
  const adapterDiagnostics = inspection?.diagnostics || {};
  const strongAdapterRecordEvidence = !independentDomEvidence
    && inspection.exactMatch
    && adapterDiagnostics.rowMode === true
    && Number(adapterDiagnostics.titleMatches || 0) === selectedCandidates.length
    && Number(adapterDiagnostics.accepted || 0) === selectedCandidates.length
    && Array.isArray(adapterDiagnostics.titleSamples)
    && adapterDiagnostics.titleSamples.length > 0;
  const templateRecordEvidence = inspection?.diagnostics?.recordVerification || { verified: false };
  const accuracyVerified = Boolean(inspection.exactMatch && (exactTitleSet || strongAdapterRecordEvidence || templateRecordEvidence.verified));
  const accuracyVerification = {
    verified: accuracyVerified,
    level: exactTitleSet ? 'DOM_TITLE_SET_EXACT' : strongAdapterRecordEvidence ? 'SOURCE_RECORD_EXACT' : templateRecordEvidence.verified ? templateRecordEvidence.level : inspection.exactMatch ? 'COUNT_EXACT_ONLY' : 'NOT_EXACT',
    listVerificationTemplate: templateRecordEvidence.template || null,
    templateRecordEvidence,
    independentDomEvidence,
    exactCount: Boolean(inspection.exactMatch),
    exactTitleSet,
    strongAdapterRecordEvidence,
    missingTitleCount: missingRows.length,
    extraCandidateCount: extraCandidates.length,
    visibleUniqueTitleCount: uniqueVisibleTitles.length,
    extractedTitleCount: selectedCandidates.length
  };

  let probableCause = 'UNDETERMINED';
  if (rows.length === 0 && selectedCandidates.length > 0) probableCause = 'VISIBLE_ROW_COUNTER_INCOMPATIBLE_WITH_PAGE_STRUCTURE';
  else if (rows.length > 0 && selectedCandidates.length === 0 && missingRows.every(row => row.rejectionReason === 'DETAIL_SIGNAL_MISSING')) probableCause = 'DETAIL_SIGNAL_NOT_EXPOSED_IN_ROWS';
  else if (rows.length > 0 && selectedCandidates.length === 0) probableCause = 'ROW_TITLE_OR_SHAPE_SELECTOR_MISMATCH';
  else if (missingRows.length > 0) probableCause = 'PARTIAL_ROW_REJECTION';
  else if (extraCandidates.length > 0) probableCause = 'NON_ROW_CANDIDATES_OR_COUNTER_MISMATCH';
  else if (inspection.visiblePostCount == null) probableCause = 'VISIBLE_ROW_COUNTER_UNAVAILABLE';
  else probableCause = 'NO_LIST_ROOT_CAUSE_DETECTED';

  return {
    version: '1.3-list-template-verification',
    mode: 'passive',
    org: source?.org || 'unknown',
    url: source?.url || '',
    probableCause,
    listCounterFailureReason,
    accuracyVerification,
    counterTrace,
    candidateClassCounts,
    counts: {
      visiblePostCount: inspection.visiblePostCount,
      candidateCount: inspection.candidateCount,
      rawTableRows: rows.length,
      uniqueVisibleTitleCount: uniqueVisibleTitles.length,
      sourceHtmlLength: String(html).length,
      missingRows: missingRows.length,
      extraCandidates: extraCandidates.length
    },
    selectorCounts: selectorCounts(html),
    rejectReasonCounts,
    visibleTitles,
    extractedTitles,
    missingRows,
    extraCandidates,
    rowTrace
  };
}
