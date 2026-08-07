import { cleanHtml } from './detail-parser.mjs';
import { extractCandidatesForSource, countVisibleBoardPosts, verifyExtractedListAgainstVisibleRecords } from '../collectors/source-adapters.mjs';

export function permissiveBoardTitle(title = '') {
  const text = cleanHtml(title).replace(/\s+/g, ' ').trim();
  if (text.length < 4 || text.length > 260) return false;
  if (/^(?:홈|메인|목록|이전|다음|처음|마지막|더보기|바로가기)$/i.test(text)) return false;
  return true;
}

export function normalizeBoardTitle(title = '') {
  return cleanHtml(title)
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function inspectListingPage(html, source) {
  const sourceWithRaw = { ...source, __rawHtml: String(html) };
  const candidates = extractCandidatesForSource(html, sourceWithRaw, {
    validTitle: permissiveBoardTitle,
    normalizeTitleForDedup: normalizeBoardTitle
  });
  const diagnostics = candidates.diagnostics || {};
  const counted = countVisibleBoardPosts(html, sourceWithRaw);
  const visiblePostCount = Number.isInteger(counted) && counted > 0
    ? counted
    : Number.isInteger(diagnostics.visiblePostCount) && diagnostics.visiblePostCount > 0
      ? diagnostics.visiblePostCount
      : null;
  const candidateCount = candidates.length;
  const recordVerification = verifyExtractedListAgainstVisibleRecords(html, sourceWithRaw, candidates);
  const exactMatch = visiblePostCount !== null && candidateCount === visiblePostCount;
  const missingCount = visiblePostCount === null ? null : Math.max(0, visiblePostCount - candidateCount);
  const extraCount = visiblePostCount === null ? null : Math.max(0, candidateCount - visiblePostCount);
  let status = 'count-unavailable';
  if (visiblePostCount !== null) {
    if (exactMatch) status = 'exact';
    else if (candidateCount === 0) status = 'failed';
    else status = 'partial';
  } else if (candidateCount === 0) {
    status = 'empty-or-wrong-page';
  }
  return {
    candidates,
    visiblePostCount,
    candidateCount,
    exactMatch,
    missingCount,
    extraCount,
    status,
    diagnostics: {
      ...diagnostics,
      visiblePostCount,
      candidateCount,
      exactMatch,
      missingCount,
      extraCount,
      recordVerification,
      countSource: visiblePostCount !== null
        ? (Number.isInteger(counted) && counted > 0 ? 'visible-board-rows' : 'adapter-diagnostics')
        : 'unavailable'
    }
  };
}
