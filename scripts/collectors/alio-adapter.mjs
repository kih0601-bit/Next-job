import { cleanHtml, absoluteUrl, decodeHtmlEntities } from '../lib/detail-parser.mjs';

const FILE_LINK = /\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:$|[?#])/i;
const DOWNLOAD_LINK = /filedown|download|attach|atchfile|file_id|fileid/i;
const DETAIL_PARAM = /(?:recruitNo|recruit_no|seq|idx|no|nttId|bbsSeq|articleNo|postNo)=/i;

function normalizeTitle(title = '') {
  return cleanHtml(title).replace(/\s+/g, ' ').trim();
}

function extractExplicitUrl(value = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(value).replace(/\\(['"])/g, '$1');
  const candidates = [];
  for (const match of decoded.matchAll(/["']((?:https?:\/\/|\/|\.\/|\.\.\/)[^"']+)["']/gi)) {
    const link = absoluteUrl(match[1], baseUrl);
    if (link && !candidates.includes(link)) candidates.push(link);
  }
  const explicit = candidates.find(link => /(?:recruitview|detail|view)\.do|[?&](?:idx|recruitNo|recruit_no|seq|no)=/i.test(link));
  if (explicit) return explicit;

  // JOB-ALIO list pages commonly call a view function with the numeric idx.
  // This is an official, stable detail endpoint adapter rather than a generic
  // URL guess; the resulting page is still fully validated by fetchDetail.
  const functionCall = decoded.match(/(?:recruitView|fn_?detail|goView|viewRecruit|recruitDetail)\s*\(\s*['"]?(\d{4,})['"]?/i);
  if (functionCall) return `https://job.alio.go.kr/mobile2021/recruit/recruitView.do?idx=${functionCall[1]}`;
  const idxAssignment = decoded.match(/(?:idx|recruitNo|recruit_no)\s*[:=,]\s*['"]?(\d{4,})/i);
  if (idxAssignment) return `https://job.alio.go.kr/mobile2021/recruit/recruitView.do?idx=${idxAssignment[1]}`;
  return '';
}

function extractLink(attrs = '', sourceUrl = '') {
  const href = attrs.match(/\bhref\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
  if (href && href !== '#' && !/^javascript:/i.test(href)) return absoluteUrl(href, sourceUrl);
  const onclick = attrs.match(/\bonclick\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || href;
  return extractExplicitUrl(onclick, sourceUrl);
}

function isDetailUrl(link = '') {
  if (!link || FILE_LINK.test(link) || DOWNLOAD_LINK.test(link)) return false;
  try {
    const url = new URL(link);
    if (!(url.hostname === 'job.alio.go.kr' || url.hostname.endsWith('.alio.go.kr'))) return false;
    if (/(?:recruitview|detail|view)\.do$/i.test(url.pathname)) return true;
    return DETAIL_PARAM.test(url.search);
  } catch {
    return false;
  }
}


function extractRowFallbackCandidates(html, source, { validTitle, normalizeTitleForDedup }, jobs, seen, diagnostics) {
  const callRegex = /(?:recruitView|fn_?detail|goView|viewRecruit|recruitDetail)\s*\(\s*["']?(\d{4,})["']?/gi;
  for (const match of String(html).matchAll(callRegex)) {
    const start = Math.max(0, (match.index || 0) - 900);
    const end = Math.min(String(html).length, (match.index || 0) + match[0].length + 900);
    const fragment = String(html).slice(start, end);
    const text = cleanHtml(fragment).replace(/\s+/g, ' ').trim();
    const titleMatches = [...text.matchAll(/(?:20\d{2}[^|]{0,100}?(?:채용|모집)[^|]{0,120}|[^|]{0,80}?(?:신입|경력|정규직|공무직|무기계약직)[^|]{0,100}?(?:채용|모집)[^|]{0,80})/g)]
      .map(item => item[0].trim())
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);
    const title = titleMatches.find(validTitle);
    if (!title) continue;
    const link = `https://job.alio.go.kr/mobile2021/recruit/recruitView.do?idx=${match[1]}`;
    const key = `${source.org}|${normalizeTitleForDedup(title)}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({ org: source.org, title, link, listText: text, sourceType: 'ALIO', adapter: 'ALIO-row-fallback' });
    diagnostics.rowFallbackAccepted = (diagnostics.rowFallbackAccepted || 0) + 1;
    diagnostics.accepted += 1;
    if (jobs.length >= 40) break;
  }
}

export function extractAlioCandidates(html, source, { validTitle, normalizeTitleForDedup }) {
  const jobs = [];
  const seen = new Set();
  const diagnostics = { anchors: 0, titleMatches: 0, noUrl: 0, unsafeUrl: 0, accepted: 0, rowFallbackAccepted: 0 };
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    diagnostics.anchors += 1;
    const attrs = match[1] || '';
    const title = normalizeTitle(match[2]);
    if (!validTitle(title)) continue;
    diagnostics.titleMatches += 1;

    const link = extractLink(attrs, source.url);
    if (!link) { diagnostics.noUrl += 1; continue; }
    if (!isDetailUrl(link)) { diagnostics.unsafeUrl += 1; continue; }

    const key = `${source.org}|${normalizeTitleForDedup(title)}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = Math.max(0, match.index - 320);
    const end = Math.min(html.length, match.index + match[0].length + 1000);
    const listText = cleanHtml(html.slice(start, end)).replace(/\s+/g, ' ').trim();
    jobs.push({ org: source.org, title, link, listText, sourceType: 'ALIO' });
    diagnostics.accepted += 1;
    if (jobs.length >= 40) break;
  }
  if (jobs.length < 40) extractRowFallbackCandidates(html, source, { validTitle, normalizeTitleForDedup }, jobs, seen, diagnostics);
  Object.defineProperty(jobs, 'diagnostics', { value: diagnostics, enumerable: false });
  return jobs;
}
