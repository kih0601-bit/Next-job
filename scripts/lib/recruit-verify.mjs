import { detectBoardType } from './board-type-detector.mjs';

const POSITIVE = [
  /채용\s*공고/i, /채용\s*정보/i, /인재\s*채용/i, /직원\s*채용/i, /직원\s*모집/i,
  /recruit(?:ment)?/i, /careers?/i, /employment/i, /job\s*opening/i
];
const ORG_RULES = {
  '근로복지공단': { hosts: [/comwel\.incruit\.com$/i], url: [/index_main\.asp/i], html: [/viewhire\.asp\?projectid=/i, /incruit/i] },
  '울산연구원': { hosts: [/uri\.re\.kr$/i], html: [/채용정보|채용공고|BBS_0000000000000041/i] },
  '한국산업안전보건공단': { hosts: [/kosha\.or\.kr$/i], url: [/recruitment\.do|notification\/jobncontract\/job/i], html: [/kosha-tboard-config|jobncontract|recruitment/i] },
  '한국산업인력공단': { hosts: [/hrdkorea\.or\.kr$/i], url: [/\/3\/1\/2\/2(?:[?#/]|$)/i], html: [/채용공고|인재채용|\/3\/1\/2\/2/i] },
  '한국석유공사': { hosts: [/knoc\.co\.kr$/i], url: [/sub01_7_9\.jsp/i], html: [/sub01_7_9\.jsp[^\"']*(?:num=|mode=view)|채용공고/i] },
  '한국수력원자력': { hosts: [/khnp\.co\.kr$/i], url: [/\/recruit\/?(?:[?#]|$)|\/recruit\/main\/index\.do/i], html: [/NetFunnel_Action[\s\S]{0,300}recruit_main|recruit\/main\/index\.do|채용/i] }
};

const NEGATIVE = [
  /페이지를\s*찾을\s*수\s*없/i, /존재하지\s*않는\s*페이지/i, /접근이\s*제한/i,
  /서비스\s*점검/i, /오류가\s*발생/i, /not\s*found/i, /access\s*denied/i,
  /captcha/i, /cloudflare/i
];

function textOnly(html = '') {
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}
function titleOf(html = '') {
  return (String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function matchedPatterns(text, patterns) {
  return patterns.filter(pattern => pattern.test(text)).map(pattern => pattern.source);
}

export function verifyRecruitPage({ html = '', requestedUrl = '', finalUrl = '', status = 0, contentType = '', org = '' } = {}) {
  const title = titleOf(html);
  const text = textOnly(html).slice(0, 120000);
  const urlText = `${requestedUrl} ${finalUrl}`;
  const target = `${title} ${text.slice(0, 30000)} ${urlText}`;
  const positiveMatches = matchedPatterns(target, POSITIVE);
  const negativeMatches = matchedPatterns(`${title} ${text.slice(0, 12000)}`, NEGATIVE);
  const boardSignals = [
    /<table\b/i.test(html), /<tbody\b/i.test(html),
    /(?:board|bbs|notice|recruit|채용)/i.test(urlText),
    /(?:번호|제목|등록일|작성일|조회수)/.test(text.slice(0, 40000)),
    /(?:다음|이전|페이지|pageIndex|pagination)/i.test(html)
  ].filter(Boolean).length;
  const isHtml = /html|xhtml/i.test(contentType || '') || /<html\b|<!doctype\s+html/i.test(html);
  const orgToken = String(org).replace(/[()㈜주식회사\s]/g, '').slice(0, 8);
  const orgMatched = orgToken.length >= 2 && text.replace(/\s/g, '').includes(orgToken);
  const boardType = detectBoardType({ html, url: finalUrl || requestedUrl, contentType });
  const rule = ORG_RULES[org];
  let institutionRule = false;
  let institutionRuleEvidence = [];
  if (rule) {
    let hostname = '';
    try { hostname = new URL(finalUrl || requestedUrl).hostname; } catch {}
    const hostOk = !rule.hosts?.length || rule.hosts.some(pattern => pattern.test(hostname));
    const urlOk = !rule.url?.length || rule.url.some(pattern => pattern.test(finalUrl || requestedUrl));
    const htmlHits = (rule.html || []).filter(pattern => pattern.test(String(html)));
    const structuralOk = boardSignals > 0;
    institutionRule = hostOk && urlOk && (htmlHits.length > 0 || structuralOk);
    if (hostOk) institutionRuleEvidence.push(`host:${hostname}`);
    if (urlOk) institutionRuleEvidence.push('url-pattern');
    institutionRuleEvidence.push(...htmlHits.map(pattern => `html:${pattern.source}`));
  }
  const errorLike = negativeMatches.length > 0 || Number(status) >= 400 || !isHtml || (text.length < 40 && !institutionRule);

  const checks = {
    httpDocument: !errorLike,
    recruitKeyword: positiveMatches.length > 0,
    boardStructure: boardSignals > 0,
    organizationMatch: orgMatched,
    meaningfulBody: text.length >= 200
  };
  const score = Object.values(checks).filter(Boolean).length;
  const maxScore = Object.keys(checks).length;
  const verified = checks.httpDocument && ((checks.recruitKeyword && checks.boardStructure) || institutionRule);
  const fallback = !verified && checks.httpDocument && checks.recruitKeyword;

  let code = 'RECRUIT_VERIFY_FAILED';
  let reason = `채용 게시판 검증 점수 ${score}/${maxScore} · 필수 조건 미충족`;
  if (verified) {
    code = 'RECRUIT_VERIFY_OK';
    reason = institutionRule ? `기관 전용 채용게시판 규칙 확인 (${institutionRuleEvidence.join(', ')})` : `채용 키워드 ${positiveMatches.length}개 · 게시판 신호 ${boardSignals}개 확인`;
  } else if (fallback) {
    code = 'RECRUIT_VERIFY_FALLBACK';
    reason = '채용 관련 페이지는 확인했으나 게시판 구조 신호가 부족함';
  } else if (errorLike) {
    code = 'RECRUIT_VERIFY_ERROR_PAGE';
    reason = `오류·차단·비HTML 신호 ${negativeMatches.length}개`;
  }

  return {
    ok: verified || fallback,
    verified,
    fallback,
    code,
    reason,
    score,
    maxScore,
    checks,
    title,
    orgMatched,
    positiveHits: positiveMatches.length,
    positiveMatches,
    negativeHits: negativeMatches.length,
    negativeMatches,
    boardSignals,
    boardType,
    institutionRule,
    institutionRuleEvidence,
    textLength: text.length,
    requestedUrl,
    finalUrl,
    status,
    contentType
  };
}
