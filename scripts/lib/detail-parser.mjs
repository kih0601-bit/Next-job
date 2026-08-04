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

export async function fetchDetail(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/4.2-detail-parser)',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|text\//i.test(contentType)) throw new Error(`unsupported content-type: ${contentType}`);
    const html = await response.text();
    const text = cleanHtml(html).slice(0, 30000);
    return {
      ok: true,
      finalUrl: response.url || url,
      text,
      attachments: extractAttachments(html, response.url || url)
    };
  } catch (error) {
    return { ok: false, finalUrl: url, text: '', attachments: [], error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}
