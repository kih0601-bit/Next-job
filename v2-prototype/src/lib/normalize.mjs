import { sourceMap } from './source-maps.mjs';

const emptyish = new Set(['', '-', '--', 'null', 'undefined', '없음', '해당없음', '해당 없음']);
const cleanText = v => v == null ? '' : String(v).trim();
const meaningful = v => !emptyish.has(cleanText(v).toLowerCase());

function first(raw, keys = []) {
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(raw || {}, k) && meaningful(raw[k])) return raw[k];
  return null;
}
function many(raw, keys = []) {
  return keys.map(k => raw?.[k]).filter(meaningful).map(cleanText);
}
function splitList(v) {
  if (!meaningful(v)) return [];
  return String(v).split(/\s*(?:,|;|\||\/|·)\s*/).map(x=>x.trim()).filter(meaningful);
}
function n(v){ const x=Number(v); return Number.isFinite(x) ? x : null; }
function norm(s){ return cleanText(s).toLowerCase().replace(/\s+/g,' ').trim(); }

export function normalizePosting(source, raw) {
  const m = sourceMap(source);
  const workRaw = first(raw,m.workplaces);
  const detailParts = many(raw,m.detailText);
  const p = {
    schemaVersion:'nextjob-v2-normalized-v2',
    source,
    sourceId: cleanText(first(raw,m.sourceId)),
    institution: cleanText(first(raw,m.institution)),
    title: cleanText(first(raw,m.title)),
    applyStart: cleanText(first(raw,m.applyStart)),
    applyEnd: cleanText(first(raw,m.applyEnd)),
    employmentType: cleanText(first(raw,m.employmentType)),
    workplaces: splitList(workRaw),
    headcount: n(first(raw,m.headcount)),
    sourceUrl: cleanText(first(raw,m.sourceUrl)),
    detailText: detailParts.join('\n').trim(),
    structured: {
      education: cleanText(first(raw,m.education)),
      preferenceText: many(raw,m.preferenceText).join('\n'),
      disqualificationText: many(raw,m.disqualificationText).join('\n'),
      recruitmentType: cleanText(first(raw,m.recruitmentType)),
      jobCategory: cleanText(first(raw,m.jobCategory)),
      localRestrictionFlag: cleanText(first(raw,m.localRestrictionFlag)),
      localRestrictionName: cleanText(first(raw,m.localRestrictionName)),
      licenses: many(raw,m.licenses),
      reference: many(raw,m.reference).join('\n'),
    },
    raw,
  };
  p.identity = buildIdentity(p);
  p.fingerprint = buildFingerprint(p);
  p.mappingWarnings = validateCoreMapping(p);
  return p;
}

export function buildIdentity(p){
  return p.sourceId ? `${p.source}:${p.sourceId}` : `${p.source}:${buildFingerprint(p)}`;
}
export function buildFingerprint(p){
  return [p.institution,p.title,p.applyStart,p.applyEnd].map(norm).join('|');
}
export function validateCoreMapping(p){
  const w=[];
  if(!p.sourceId) w.push('missing_source_id');
  if(!p.institution) w.push('missing_institution');
  if(!p.title) w.push('missing_title');
  if(!p.applyStart && !p.applyEnd) w.push('missing_dates');
  if(!p.fingerprint || p.fingerprint === '|||') w.push('empty_fingerprint');
  return w;
}
