function has(html = '', pattern) {
  return pattern.test(String(html));
}

export function detectBoardType({ html = '', url = '', contentType = '' } = {}) {
  const source = String(html);
  const urlText = String(url);
  const evidence = [];

  if (/job-?alio|alio\.go\.kr/i.test(urlText) || /잡알리오|JOB-?ALIO/i.test(source)) {
    evidence.push('JOB-ALIO URL/본문 신호');
    return { type: 'JOB_ALIO', confidence: 'high', evidence };
  }
  if (has(source, /<iframe\b/i)) {
    evidence.push('iframe 태그 발견');
    return { type: 'IFRAME', confidence: 'high', evidence };
  }
  if (/application\/json/i.test(contentType) || /^\s*[\[{]/.test(source)) {
    evidence.push('JSON 응답 신호');
    return { type: 'API', confidence: 'high', evidence };
  }
  const spaSignals = [
    /<div[^>]+id=["'](?:root|app|__next)["']/i,
    /__NEXT_DATA__|webpackJsonp|vite\/client|react-dom|vue(?:\.runtime)?/i,
    /<script[^>]+src=["'][^"']+(?:chunk|bundle|app)\.[^"']+\.js/i
  ].filter(pattern => has(source, pattern)).length;
  const visibleText = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (spaSignals >= 2 && visibleText.length < 2500) {
    evidence.push(`SPA 신호 ${spaSignals}개`, `초기 HTML 텍스트 ${visibleText.length}자`);
    return { type: 'SPA', confidence: 'medium', evidence };
  }
  if (has(source, /<table\b/i) && has(source, /<tr\b/i)) {
    evidence.push('table/tr 구조 발견');
    return { type: 'HTML_TABLE', confidence: 'high', evidence };
  }
  if (has(source, /<(?:ul|ol)\b/i) && has(source, /<li\b/i)) {
    evidence.push('ul/ol + li 구조 발견');
    return { type: 'UL_LIST', confidence: 'medium', evidence };
  }
  const cardSignals = (source.match(/<(?:article|div)\b[^>]*(?:class|id)=["'][^"']*(?:card|item|list|board|notice|recruit|post)[^"']*["']/gi) || []).length;
  if (cardSignals >= 2) {
    evidence.push(`카드형 div/article 신호 ${cardSignals}개`);
    return { type: 'DIV_CARD', confidence: 'medium', evidence };
  }
  if (/fetch\s*\(|axios\.|XMLHttpRequest|\.ajax\s*\(/i.test(source)) {
    evidence.push('클라이언트 API 호출 코드 발견');
    return { type: 'API', confidence: 'low', evidence };
  }
  return { type: 'UNKNOWN', confidence: 'low', evidence: ['명확한 게시판 구조 신호 없음'] };
}
