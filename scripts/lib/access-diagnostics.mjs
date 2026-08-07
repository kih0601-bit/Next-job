import { verifyRecruitPage } from './recruit-verify.mjs';

export function inspectRecruitPage(input = {}) {
  return verifyRecruitPage(input);
}

export function chooseBestAccessPage(pages = []) {
  return [...pages].sort((a, b) => {
    const av = a.verification || {}, bv = b.verification || {};
    return Number(bv.verified) - Number(av.verified)
      || Number(bv.institutionRule) - Number(av.institutionRule)
      || Number(bv.checks?.organizationMatch) - Number(av.checks?.organizationMatch)
      || (a.accessPriority ?? 999) - (b.accessPriority ?? 999)
      || (bv.score || 0) - (av.score || 0)
      || (b.html?.length || 0) - (a.html?.length || 0);
  })[0] || null;
}

export function summarizeAccessAttempts(attempts = [], selected = null) {
  const httpOkAttempts = attempts.filter(item => item.ok);
  const http = {
    ok: httpOkAttempts.length > 0,
    code: httpOkAttempts.length > 0 ? 'HTTP_OK' : 'HTTP_FAILED',
    reason: httpOkAttempts.length > 0 ? `${httpOkAttempts.length}개 후보 URL HTTP 응답 성공` : '모든 후보 URL HTTP 접속 실패',
    attempts
  };

  if (selected?.verification?.verified) {
    const primary = selected.requestedUrl === attempts[0]?.url;
    const recruitVerify = {
      ok: true,
      code: selected.verification.verified
        ? (primary ? 'RECRUIT_VERIFY_OK' : 'RECRUIT_VERIFY_FALLBACK_OK')
        : 'RECRUIT_VERIFY_FALLBACK',
      reason: selected.verification.reason,
      score: selected.verification.score,
      maxScore: selected.verification.maxScore,
      boardType: selected.verification.boardType,
      evidence: selected.verification
    };
    return {
      ok: true,
      code: recruitVerify.code,
      reason: recruitVerify.reason,
      http,
      recruitVerify,
      activeRecruitUrl: selected.finalUrl || selected.requestedUrl,
      selectedRequestedUrl: selected.requestedUrl,
      verification: selected.verification
    };
  }

  if (httpOkAttempts.length) {
    const recruitVerify = {
      ok: false,
      code: 'RECRUIT_VERIFY_FAILED',
      reason: `${httpOkAttempts.length}개 URL은 HTTP 응답했지만 채용 게시판으로 검증되지 않음`,
      score: selected?.verification?.score || 0,
      maxScore: selected?.verification?.maxScore || 5,
      boardType: selected?.verification?.boardType || { type: 'UNKNOWN', confidence: 'low', evidence: [] },
      evidence: selected?.verification || null
    };
    return { ok: false, code: recruitVerify.code, reason: recruitVerify.reason, http, recruitVerify, activeRecruitUrl: '', verification: selected?.verification || null };
  }

  const errors = attempts.map(item => String(item.error || ''));
  let code = 'HTTP_FAILED';
  let reason = '등록된 모든 후보 URL HTTP 접속 실패';
  if (errors.length && errors.every(value => /timeout/i.test(value))) { code = 'HTTP_TIMEOUT_ALL'; reason = `후보 URL ${attempts.length}개 모두 시간 초과`; }
  else if (errors.some(value => /404/.test(value))) { code = 'HTTP_404'; reason = '후보 URL에서 404 발생'; }
  else if (errors.some(value => /403/.test(value))) { code = 'HTTP_FORBIDDEN'; reason = '자동 접속이 거부됨(403)'; }
  else if (errors.some(value => /HTTP 5\d\d/.test(value))) { code = 'HTTP_SERVER_ERROR'; reason = '기관 서버 오류(HTTP 5xx)'; }
  http.code = code;
  http.reason = reason;
  return { ok: false, code, reason, http, recruitVerify: { ok: false, code: 'RECRUIT_VERIFY_BLOCKED_BY_HTTP', reason: 'HTTP 실패로 채용 게시판 검증 불가', evidence: null }, activeRecruitUrl: '' };
}
