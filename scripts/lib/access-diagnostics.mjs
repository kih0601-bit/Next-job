const RECRUIT_POSITIVE = [
  /채용\s*공고/i, /채용\s*정보/i, /인재\s*채용/i, /직원\s*채용/i, /직원\s*모집/i,
  /recruit(?:ment)?/i, /careers?/i, /employment/i, /job\s*opening/i
];
const RECRUIT_NEGATIVE = [
  /페이지를\s*찾을\s*수\s*없/i, /존재하지\s*않는\s*페이지/i, /접근이\s*제한/i,
  /서비스\s*점검/i, /오류가\s*발생/i, /not\s*found/i, /access\s*denied/i,
  /captcha/i, /cloudflare/i
];

function textOnly(html='') {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleOf(html='') {
  return (String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countMatches(text, patterns) {
  return patterns.reduce((sum, pattern) => sum + Number(pattern.test(text)), 0);
}

export function inspectRecruitPage({ html='', requestedUrl='', finalUrl='', status=0, contentType='', org='' }={}) {
  const title = titleOf(html);
  const text = textOnly(html).slice(0, 120000);
  const urlText = `${requestedUrl} ${finalUrl}`;
  const positiveHits = countMatches(`${title} ${text.slice(0, 30000)} ${urlText}`, RECRUIT_POSITIVE);
  const negativeHits = countMatches(`${title} ${text.slice(0, 12000)}`, RECRUIT_NEGATIVE);
  const orgToken = String(org).replace(/[()㈜주식회사\s]/g, '').slice(0, 8);
  const orgMatched = orgToken.length >= 2 && text.replace(/\s/g, '').includes(orgToken);
  const boardSignals = [
    /<table\b/i.test(html),
    /<tbody\b/i.test(html),
    /(?:board|bbs|notice|recruit|채용)/i.test(urlText),
    /(?:번호|제목|등록일|작성일|조회수)/.test(text.slice(0, 40000)),
    /(?:다음|이전|페이지|pageIndex|pagination)/i.test(html)
  ].filter(Boolean).length;
  const isHtml = /html|xhtml/i.test(contentType || '') || /<html\b|<!doctype\s+html/i.test(html);
  const looksError = negativeHits > 0 || Number(status) >= 400 || !isHtml || text.length < 40;
  const verified = !looksError && positiveHits > 0 && boardSignals >= 1;
  const broadRecruitFallback = !looksError && positiveHits > 0;
  let code = 'ACCESS_PAGE_UNVERIFIED';
  let reason = '응답은 받았지만 채용 게시판임을 입증할 근거가 부족함';
  if (verified) { code = 'ACCESS_RECRUIT_BOARD_VERIFIED'; reason = `채용 키워드 ${positiveHits}개 · 게시판 신호 ${boardSignals}개 확인`; }
  else if (broadRecruitFallback) { code = 'ACCESS_RECRUIT_PAGE_FALLBACK'; reason = `채용 관련 페이지는 확인했으나 게시판 구조 신호가 약함`; }
  else if (looksError) { code = 'ACCESS_ERROR_PAGE'; reason = `오류·차단·비HTML 페이지 신호 ${negativeHits}개`; }
  return {
    verified,
    broadRecruitFallback,
    code,
    reason,
    title,
    orgMatched,
    positiveHits,
    negativeHits,
    boardSignals,
    textLength: text.length,
    requestedUrl,
    finalUrl,
    status,
    contentType
  };
}

export function chooseBestAccessPage(pages=[]) {
  return [...pages].sort((a,b) => {
    const av=a.verification||{}, bv=b.verification||{};
    return Number(bv.verified)-Number(av.verified)
      || Number(bv.broadRecruitFallback)-Number(av.broadRecruitFallback)
      || (bv.boardSignals||0)-(av.boardSignals||0)
      || (bv.positiveHits||0)-(av.positiveHits||0)
      || (b.html?.length||0)-(a.html?.length||0);
  })[0] || null;
}

export function summarizeAccessAttempts(attempts=[], selected=null) {
  const okAttempts=attempts.filter(x=>x.ok);
  if (selected?.verification?.verified) return {
    ok:true, code:selected.requestedUrl===attempts[0]?.url?'ACCESS_PRIMARY_VERIFIED':'ACCESS_FALLBACK_VERIFIED',
    reason:selected.verification.reason,
    activeRecruitUrl:selected.finalUrl||selected.requestedUrl,
    selectedRequestedUrl:selected.requestedUrl,
    verification:selected.verification
  };
  if (selected?.verification?.broadRecruitFallback) return {
    ok:true, code:'ACCESS_FALLBACK_RECRUIT_PAGE', reason:selected.verification.reason,
    activeRecruitUrl:selected.finalUrl||selected.requestedUrl,
    selectedRequestedUrl:selected.requestedUrl,
    verification:selected.verification
  };
  if (okAttempts.length) return {
    ok:false, code:'ACCESS_RESPONDED_BUT_NOT_RECRUIT',
    reason:`${okAttempts.length}개 URL은 응답했지만 채용 페이지로 검증되지 않음`, activeRecruitUrl:'', verification:selected?.verification||null
  };
  const errors=attempts.map(x=>String(x.error||''));
  if (errors.length && errors.every(x=>/timeout/i.test(x))) return {ok:false,code:'ACCESS_TIMEOUT_ALL',reason:`후보 URL ${attempts.length}개 모두 시간 초과`,activeRecruitUrl:''};
  if (errors.some(x=>/404/.test(x))) return {ok:false,code:'ACCESS_404_ALL_OR_PARTIAL',reason:'후보 URL에서 404 발생',activeRecruitUrl:''};
  if (errors.some(x=>/403/.test(x))) return {ok:false,code:'ACCESS_FORBIDDEN',reason:'자동 접속이 거부됨(403)',activeRecruitUrl:''};
  return {ok:false,code:'ACCESS_ALL_FAILED',reason:'등록된 모든 후보 URL 접속 실패',activeRecruitUrl:''};
}
