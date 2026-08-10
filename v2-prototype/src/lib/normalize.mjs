function first(obj, keys, fallback=null) {
  for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  return fallback;
}
const text = v => v == null ? '' : String(v).trim();
const arr = v => Array.isArray(v) ? v.map(text).filter(Boolean) : text(v) ? [text(v)] : [];

export function normalizePosting(source, raw) {
  const common = {
    source,
    sourceId: text(first(raw, ['idx','id','seq','empSeq','empmnsn','uniqueNo','고유번호'])),
    institution: text(first(raw, ['institution','orgNm','insttNm','entNm','기관명','companyName'])),
    title: text(first(raw, ['title','recruitTitle','empTitle','채용제목','subject'])),
    applyStart: text(first(raw, ['applyStart','startDate','receiptStart','접수게시일','regDate'])),
    applyEnd: text(first(raw, ['applyEnd','endDate','receiptEnd','접수마감일','deadline'])),
    employmentType: text(first(raw, ['employmentType','empType','고용형태'])),
    workplaces: arr(first(raw, ['workplaces','workplace','workRegion','근무지','region'])),
    headcount: Number(first(raw, ['headcount','recruitCount','채용인원'], NaN)),
    sourceUrl: text(first(raw, ['sourceUrl','linkUrl','링크URL','url'])),
    detailText: text(first(raw, ['detailText','qualification','jobDetail','직무세부내용','content'])),
    attachments: Array.isArray(raw?.attachments) ? raw.attachments : [],
    raw
  };
  if (!Number.isFinite(common.headcount)) common.headcount = null;
  common.fingerprint = fingerprint(common);
  return common;
}

function fingerprint(p) {
  return [p.institution,p.title,p.applyStart,p.applyEnd].map(v => text(v).toLowerCase().replace(/\s+/g,' ')).join('|');
}
