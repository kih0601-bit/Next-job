const ENTITY_MAP = {
  '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' '
};

export function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, m => ENTITY_MAP[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function cleanHtml(html = '') {
  return decodeHtmlEntities(String(html))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function absoluteUrl(href, baseUrl) {
  try { return new URL(decodeHtmlEntities(href), baseUrl).href; }
  catch { return ''; }
}

export function extractAttachments(html, baseUrl) {
  const attachments = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const href = absoluteUrl(match[1], baseUrl);
    if (!href) continue;
    const label = cleanHtml(match[2]);
    const probe = `${href} ${label}`.toLowerCase();
    const extMatch = probe.match(/\.(pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#\s])/i);
    const isDownload = /첨부|다운로드|download|filedown|atchfile|file_id|fileid/i.test(probe);
    if (!extMatch && !isDownload) continue;
    const type = extMatch ? extMatch[1].toLowerCase() : 'unknown';
    const key = href.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    attachments.push({ name: label || `첨부파일.${type}`, type, url: href });
  }
  return attachments.slice(0, 20);
}

function titleTokens(value = '') {
  return String(value)
    .replace(/\[[^\]]+\]|\([^)]*\)/g, ' ')
    .replace(/(?:채용|모집|공고|직원|신입|경력|정규직|공무직|무기계약직)/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .trim().split(/\s+/).filter(word => word.length >= 2).slice(0, 8);
}

function detailConfidence(text = '', expectedTitle = '') {
  const structureSignals = [
    /모집분야|채용분야/, /응시자격|지원자격/, /접수기간|원서접수/,
    /근무조건|근무지/, /채용인원|모집인원/, /전형절차|전형방법/, /공고번호/
  ].filter(pattern => pattern.test(text)).length;
  const tokens = titleTokens(expectedTitle);
  const matched = tokens.filter(word => text.includes(word)).length;
  const titleRatio = tokens.length ? matched / tokens.length : 1;
  return { structureSignals, matched, tokenCount: tokens.length, titleRatio };
}

export async function fetchDetail(url, { timeoutMs = 15000, expectedTitle = '', sourceOrg = '', allowedHosts = [] } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/6.0-link-reliability)',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|text\//i.test(contentType)) throw new Error(`unsupported content-type: ${contentType}`);
    const html = await response.text();
    const text = cleanHtml(html).slice(0, 50000);
    const looksLikeListOnly = /전체\s*\d+건의\s*게시물|현재페이지\s*\(\d+\/\d+\)|게시물\s*목록|검색결과\s*\d+건|채용공고\s*목록/.test(text) && !/(모집분야|응시자격|접수기간|근무조건|채용인원|공고번호)/.test(text);
    if (looksLikeListOnly) throw new Error('list page detected');

    const errorPage = /페이지의\s*주소가\s*올바른지|이용에\s*불편을\s*드려\s*죄송|요청하신\s*페이지를\s*찾을\s*수|존재하지\s*않는\s*페이지|404\s*(?:not\s*found)?/i.test(text);
    if (errorPage) throw new Error('site error page detected');

    const loginOrBlock = /접근이\s*차단|비정상적인\s*접근|로그인이\s*필요|세션이\s*만료|자동화된\s*접근|captcha/i.test(text);
    if (loginOrBlock) throw new Error('blocked or login page detected');

    const finalUrl = response.url || url;
    const final = new URL(finalUrl);
    const original = new URL(url);
    const normalizedAllowedHosts = [original.hostname, ...allowedHosts].map(host => String(host).replace(/^www\./, ''));
    const finalHost = final.hostname.replace(/^www\./, '');
    if (!normalizedAllowedHosts.some(host => finalHost === host || finalHost.endsWith(`.${host}`))) {
      throw new Error('unexpected redirect domain');
    }
    if (/\/(?:index|main|home)(?:\.|\/|$)/i.test(final.pathname) && !final.search) {
      throw new Error('home page redirect detected');
    }
    if (sourceOrg === '울산광역시 타기관소식' && /\/u\/rep\/contents\.ulsan$/i.test(new URL(finalUrl).pathname) && !/[?&](?:nttId|dataSid|bbsSeq|articleNo|postNo)=/i.test(finalUrl)) {
      throw new Error('ulsan list url detected');
    }
    if (sourceOrg === '울산시설공단' && /\/notify\/noti06\.do$/i.test(new URL(finalUrl).pathname) && !new URL(finalUrl).search) {
      throw new Error('uic list url detected');
    }

    const finalParams = [...final.searchParams.keys()];
    const hasDetailPath = /(?:view|detail|read|select|article|boardView|recruitview)/i.test(final.pathname);
    const hasDetailParam = finalParams.some(key => /^(?:idx|seq|no|nttId|bbsSeq|boardId|articleNo|postNo|dataSid|bbsId|boardSeq|contsId|recruitNo|recruit_no)$/i.test(key));
    const sameAsSourceListing = /(?:list|recruit\.do|contents\.ulsan|noti06\.do)$/i.test(final.pathname) && !hasDetailParam;
    if ((!hasDetailPath && !hasDetailParam) || sameAsSourceListing) {
      throw new Error('final url is not a detail page');
    }

    const confidence = detailConfidence(text, expectedTitle);
    if (confidence.structureSignals < 2) throw new Error('insufficient detail structure');
    if (confidence.tokenCount >= 3 && confidence.titleRatio < 0.34) throw new Error('detail title mismatch');
    return {
      ok: true,
      finalUrl,
      text,
      confidence,
      attachments: extractAttachments(html, response.url || url)
    };
  } catch (error) {
    return { ok: false, finalUrl: url, text: '', attachments: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}
