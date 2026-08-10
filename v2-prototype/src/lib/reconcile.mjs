const RESULT = /(최종\s*합격|합격자\s*발표|서류전형\s*결과|면접\s*결과|전형\s*결과)/i;
const PRE = /(예비공고|사전\s*안내|채용\s*계획|연간\s*채용)/i;
const EXEC = /(임원|사장|이사장|본부장)\s*(공개)?\s*(모집|초빙|공모)/i;
const RECRUIT = /(채용|모집|신규직원|직원\s*공고|인턴)/i;

export function classifyPosting(p) {
  const s = `${p.title} ${p.detailText}`;
  if (RESULT.test(s)) return 'result';
  if (PRE.test(s)) return 'preannouncement';
  if (EXEC.test(s)) return 'executive';
  if (RECRUIT.test(s)) return 'recruitment';
  return 'unknown';
}

export function dedupe(postings) {
  const by = new Map();
  for (const p of postings) {
    const key = p.fingerprint || `${p.source}|${p.sourceId}`;
    const cur = by.get(key);
    if (!cur) by.set(key, {...p, duplicateSources:[p.source]});
    else {
      cur.duplicateSources = [...new Set([...(cur.duplicateSources||[]), p.source])];
      cur.attachments = mergeAttachments(cur.attachments, p.attachments);
      if ((p.detailText||'').length > (cur.detailText||'').length) cur.detailText = p.detailText;
    }
  }
  return [...by.values()];
}
function mergeAttachments(a=[],b=[]) {
  const m = new Map();
  for (const x of [...a,...b]) m.set(`${x.name||''}|${x.url||''}`, x);
  return [...m.values()];
}
