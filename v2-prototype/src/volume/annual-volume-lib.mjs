const YEAR_KEYS = [
  /(^|_)(year|yr)(_|$)/i,
  /(채용|공고|접수|등록|작성|게시).*연도/i,
  /empyear/i,
  /recruit.*year/i,
  /pblanc.*year/i,
];
const DATE_KEY_HINT = /(date|dt|ymd|기간|일자|일시|등록|게시|접수|시작|종료|마감|공고)/i;

export function normalizeServiceKey(raw = process.env.DATA_GO_KR_SERVICE_KEY || '') {
  const s = String(raw).trim();
  if (!s) throw new Error('DATA_GO_KR_SERVICE_KEY is required');
  // data.go.kr often shows both encoded and decoded keys. URLSearchParams must receive decoded text.
  try { return decodeURIComponent(s); } catch { return s; }
}

export async function fetchText(url, { retries = 3, timeoutMs = 30000 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'NextJob-v2-volume-count/0.1' }, signal: ctrl.signal });
      const text = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0, 300)}`);
      if (/SERVICE_(ACCESS_DENIED|KEY_IS_NOT_REGISTERED)|PERMISSION_DENIED|SERVICE_KEY_IS_NULL/i.test(text)) {
        throw new Error(`Public-data API authorization error: ${text.slice(0, 500)}`);
      }
      return text;
    } catch (e) {
      last = e;
      if (i + 1 < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    } finally { clearTimeout(t); }
  }
  throw last;
}

export function xmlRecords(xml) {
  const preferred = ['item', 'row', 'list'];
  for (const tag of preferred) {
    const blocks = [...String(xml).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'))];
    if (blocks.length) return blocks.map(m => parseFlatXmlBlock(m[1]));
  }
  // Last resort: identify a repeated direct child tag whose blocks contain several scalar children.
  const tagCounts = new Map();
  for (const m of String(xml).matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const scalarCount = [...m[2].matchAll(/<([A-Za-z_][\w.-]*)>(?:<!\[CDATA\[)?[\s\S]*?(?:\]\]>)?<\/\1>/g)].length;
    if (scalarCount >= 3) tagCounts.set(m[1], (tagCounts.get(m[1]) || 0) + 1);
  }
  const candidate = [...tagCounts.entries()].filter(([,n]) => n >= 2).sort((a,b) => b[1]-a[1])[0]?.[0];
  if (!candidate) return [];
  return [...String(xml).matchAll(new RegExp(`<${candidate}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${candidate}>`, 'gi'))]
    .map(m => parseFlatXmlBlock(m[1]));
}

function parseFlatXmlBlock(block) {
  const out = {};
  for (const m of block.matchAll(/<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g)) {
    const raw = m[2].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    if (!/<[A-Za-z_]/.test(raw)) out[m[1]] = decodeXml(raw.trim());
  }
  return out;
}

function decodeXml(s) {
  return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

export function jsonRecords(value) {
  const arrays = [];
  walk(value, arrays);
  if (!arrays.length) return [];
  arrays.sort((a,b) => scoreArray(b) - scoreArray(a));
  return arrays[0].filter(x => x && typeof x === 'object' && !Array.isArray(x));
}
function walk(v, arrays) {
  if (Array.isArray(v)) { if (v.length && v.some(x => x && typeof x === 'object')) arrays.push(v); for (const x of v) walk(x, arrays); }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, arrays);
}
function scoreArray(a) { return a.length * 10 + (a[0] && typeof a[0] === 'object' ? Object.keys(a[0]).length : 0); }

export function parseRecords(text) {
  try { return jsonRecords(JSON.parse(text)); } catch { return xmlRecords(text); }
}

export function detectYear(record) {
  const entries = Object.entries(record || {});
  for (const [k,v] of entries) {
    if (YEAR_KEYS.some(r => r.test(k))) {
      const y = yearFromValue(v);
      if (y) return { year:y, key:k, confidence:'high' };
    }
  }
  for (const [k,v] of entries) {
    if (DATE_KEY_HINT.test(k)) {
      const y = yearFromValue(v);
      if (y) return { year:y, key:k, confidence:'medium' };
    }
  }
  // Do NOT mine arbitrary description text for a year: titles often contain unrelated prior years.
  return { year:null, key:null, confidence:'none' };
}
function yearFromValue(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  if (m) return Number(m[1]);
  if (/^20\d{6}$/.test(s)) return Number(s.slice(0,4));
  return null;
}

export function pickField(record, patterns) {
  for (const p of patterns) {
    const hit = Object.entries(record || {}).find(([k,v]) => p.test(k) && String(v ?? '').trim());
    if (hit) return String(hit[1]).trim();
  }
  return '';
}

const INST_PATTERNS=[/^(instt|org|organ|ent|corp).*nm$/i,/기관.*명/i,/company.*name/i,/insttNm/i,/orgNm/i,/entNm/i];
const TITLE_PATTERNS=[/^(title|subject|sj)$/i,/(recruit|employ|pblanc|emp).*?(title|nm|sj)/i,/공고.*(명|제목)/i,/채용.*(명|제목)/i];
const DATE_PATTERNS=[/(reg|post|notice|pblanc|start|bgng|apply).*?(date|dt|ymd)/i,/(등록|게시|공고|접수).*일/i];
const ID_PATTERNS=[/^idx$/i,/(recruit|employ|pblanc|emp).*id$/i,/seq$/i,/serial/i,/고유번호/i];

export function canonicalize(record, source) {
  const institution = pickField(record, INST_PATTERNS);
  const title = pickField(record, TITLE_PATTERNS);
  const date = pickField(record, DATE_PATTERNS);
  const sourceId = pickField(record, ID_PATTERNS);
  const fingerprint = [norm(institution), norm(title), normalizeDate(date)].join('|');
  const looseFingerprint = [norm(institution), norm(title)].join('|');
  return { source, institution, title, date, sourceId, fingerprint, looseFingerprint, raw:record };
}
function norm(s){ return String(s||'').toLowerCase().replace(/\s+/g,'').replace(/[^0-9a-z가-힣]/g,''); }
function normalizeDate(s){ const m=String(s||'').match(/20\d{2}[.\/-]?\d{1,2}[.\/-]?\d{1,2}/); return m ? m[0].replace(/\D/g,'') : ''; }

export function classifyTitle(title='') {
  const t=String(title);
  if (/(최종\s*합격|합격자\s*(발표|공고)|서류.*(결과|합격)|필기.*(결과|합격)|면접.*(결과|합격)|전형\s*결과|채용\s*결과)/i.test(t)) return 'result_or_followup';
  if (/(사전\s*(안내|공고)|연간\s*채용\s*계획|채용\s*계획\s*(안내|공고)|예비\s*공고)/i.test(t)) return 'preannouncement';
  if (/(임원|이사장|사장|본부장).*?(공모|공개모집|후보)/i.test(t)) return 'executive_recruitment';
  if (/(채용|모집|직원|근로자|인턴|공무직|기간제|계약직|정규직|무기계약)/i.test(t)) return 'recruitment_like';
  return 'needs_review';
}

export function summarizeRecords(records, source, targetYear) {
  const yearCounts = {};
  const selected=[]; const unknown=[];
  for (const r of records) {
    const y=detectYear(r);
    const key=y.year ? String(y.year) : 'unknown'; yearCounts[key]=(yearCounts[key]||0)+1;
    if (y.year===targetYear) selected.push(canonicalize(r,source));
    else if (!y.year) unknown.push(canonicalize(r,source));
  }
  return { totalFetched:records.length, yearCounts, targetRecords:selected, unknownYearRecords:unknown };
}

export function dedupeAndClassify(allRecords) {
  const byExact=new Map();
  for (const r of allRecords) {
    const key = r.fingerprint && !r.fingerprint.startsWith('||') ? r.fingerprint : `${r.source}|${r.sourceId}|${r.title}`;
    const arr=byExact.get(key)||[]; arr.push(r); byExact.set(key,arr);
  }
  const exactUnique=[...byExact.values()].map(g=>g[0]);
  const crossSourceDuplicateGroups=[...byExact.values()].filter(g=>new Set(g.map(x=>x.source)).size>1);
  const classCounts={};
  for (const r of exactUnique){ const c=classifyTitle(r.title); classCounts[c]=(classCounts[c]||0)+1; r.classification=c; }
  const obviousNonRecruitment = (classCounts.result_or_followup||0)+(classCounts.preannouncement||0)+(classCounts.executive_recruitment||0);
  const recruitmentLike = classCounts.recruitment_like||0;
  const needsReview = classCounts.needs_review||0;
  return {
    exactUnique,
    exactUniqueCount:exactUnique.length,
    exactDuplicateRows:allRecords.length-exactUnique.length,
    crossSourceDuplicateGroupCount:crossSourceDuplicateGroups.length,
    classificationCounts:classCounts,
    obviousNonRecruitment,
    recruitmentLike,
    needsReview,
    estimatedAiTargetLower:recruitmentLike,
    estimatedAiTargetUpper:recruitmentLike+needsReview,
  };
}

export function costScenarios(lower, upper) {
  const perPostingKRW=[1,3,6,10,30,50,100,167];
  return perPostingKRW.map(cost=>({ costPerPostingKRW:cost, annualLowerKRW:lower*cost, annualUpperKRW:upper*cost }));
}
