export const clean = (value) =>
  String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export const absoluteUrl = (href, base) => {
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
};

export async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NextJobCollector/7.0)',
        'accept-language': 'ko-KR,ko;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export function extractAnchors(html, baseUrl) {
  const output = [];

  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const url = absoluteUrl(match[1], baseUrl);
    const title = clean(match[2]);

    if (!url || !title) continue;
    output.push({ url, title });
  }

  return output;
}

export function normalizeKey(job) {
  return `${job.org}|${job.title}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
