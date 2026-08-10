const MAX_VACANCIES = 24;
export const VACANCY_SPLITTER_VERSION = '11.8.0-public-facility-table-rows';

const HEADER_PATTERN = /^(?:\s*(?:\d+|[가-힣]|[①-⑳])\s*[.)-]\s*)?(?:모집|채용|응시)\s*(?:분야|직무|직종|직렬)|^(?:분야|직무|직종|직렬|구분)\s*[:：]/i;
const SECTION_PATTERN = /^(?:\s*(?:\d+|[가-힣]|[①-⑳])\s*[.)-]\s*)?(?:채용개요|모집개요|분야별\s*응시자격|직무별\s*자격요건)\s*$/i;
const GLOBAL_PATTERN = /(?:접수기간|원서접수|전형절차|제출서류|공통\s*응시자격|공통사항|결격사유|보수|복리후생|근무시간|채용일정|문의처)/i;
const ROLE_SIGNAL = /(?:행정|사무|전산|정보|시설|기계|전기|소방|건축|토목|운전|환경|회계|재무|고객|상담|기술|연구|경영|총무|인사|기획|보안|미화|조리|운영보조|안전요원|체육지도사|안내관리원|환경관리원)/;
const CONDITION_SIGNAL = /(?:정규직|무기계약|공무직|상용직|일반직|기간제|계약직|인턴|학력|고졸|학사|전문학사|근무지|근무지역|울산|서울|부산|채용인원|선발인원|인원|명\b)/;

const NON_VACANCY_NAME_PATTERN = /(?:\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)(?:\s|$|\[|\()|정보통신접근성\s*품질인증|(?:알림마당|채용공고)\s*>|테이블\s*(?:입니다|이다)|구성된\s*테이블|현재\s*진행\s*중.*무관함|붙임과\s*같이\s*공고|첨부파일|응시원서|이의신청서|직무기술서(?:\s*\d+|\s*\d*번)?\s*$)/i;
const MARKDOWN_FILE_PATTERN = /^#{1,6}\s+.*\.(?:pdf|hwp|hwpx|docx?|xlsx?|zip)\b/i;

function isNonVacancyCandidate(name='', lines=[]) {
  const candidate=cleanLine(name);
  const joined=(Array.isArray(lines)?lines:[]).map(cleanLine).join(' ');
  if(!candidate) return true;
  if(MARKDOWN_FILE_PATTERN.test(candidate) || NON_VACANCY_NAME_PATTERN.test(candidate)) return true;
  if(/^(?:주요담당\s*업무|선발인원|직렬\s*선발예정인원).*(?:구성된\s*테이블|테이블\s*(?:입니다|이다))/i.test(candidate)) return true;
  if(/^(?:※|\*).*무관함[.!]?$/i.test(candidate)) return true;
  // Attachment/navigation noise may leak through a row because the surrounding line contains role/condition words.
  if(MARKDOWN_FILE_PATTERN.test(joined)) return true;
  return false;
}

function cleanLine(line = '') {
  return String(line)
    .replace(/[\u0000\u00a0]/g, ' ')
    .replace(/[|│┃]+/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLines(text = '') {
  return String(text)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(cleanLine)
    .filter(line => line.length >= 2 && line.length <= 700);
}

function titleFromLine(line = '', index = 0) {
  const stripped = cleanLine(line)
    .replace(/^\s*(?:\d+|[가-힣]|[①-⑳])\s*[.)-]\s*/, '')
    .replace(/^(?:모집|채용|응시)?\s*(?:분야|직무|직종|직렬|구분)\s*[:：]?\s*/i, '')
    .replace(/\s*[|].*$/, '')
    .replace(/\s+(?:전문직|연구직|위촉직|청년인턴)?\s*직무기술서\s*\d*\s*$/i, '')
    .trim();
  if (!stripped || stripped.length > 80) return `모집분야 ${index + 1}`;
  return stripped;
}

function likelyRow(line = '') {
  if (line.length < 4 || line.length > 320) return false;
  if (GLOBAL_PATTERN.test(line)) return false;
  const pipeParts = line.split(/\s*\|\s*/).filter(Boolean);
  if (pipeParts.length >= 2 && ROLE_SIGNAL.test(line) && (CONDITION_SIGNAL.test(line) || /\d{1,3}\s*명/.test(line))) return true;
  return ROLE_SIGNAL.test(line) && CONDITION_SIGNAL.test(line) && /(?:채용|모집|직|분야|인원|명\b)/.test(line);
}

function collectGlobalContext(lines) {
  const global = [];
  for (const line of lines) {
    if (GLOBAL_PATTERN.test(line)) global.push(line);
    if (/^(?:공고명|기관명|접수기간|원서접수|채용일정|공통사항)/.test(line)) global.push(line);
  }
  return [...new Set(global)].slice(0, 35).join('\n');
}

function headerTitle(lines,start,index=0){
  let name=titleFromLine(lines[start],index);
  if(/^(?:연구직|전문직|위촉직|청년인턴|직무기술서|모집분야\s*\d+)$/i.test(name)){
    const next=cleanLine(lines[start+1]||'');
    if(/^(?:사업|행정|기술|연구|장비|경영|시설)[가-힣A-Za-z]*-?\d+\b/.test(next)) name=titleFromLine(next,index);
  }
  return name;
}

function splitByExplicitHeaders(lines) {
  const starts = [];
  lines.forEach((line, index) => {
    if (HEADER_PATTERN.test(line) && !SECTION_PATTERN.test(line)) starts.push(index);
  });
  if (!starts.length) return [];
  const blocks = [];
  starts.forEach((start, i) => {
    const end = starts[i + 1] ?? lines.length;
    const slice = lines.slice(start, Math.min(end, start + 120));
    if (slice.join(' ').length >= 25) blocks.push({ name: headerTitle(lines,start,blocks.length), lines: slice });
  });
  return blocks;
}

function splitByRows(lines) {
  const rows = [];
  for (const line of lines) {
    if (!likelyRow(line)) continue;
    const parts = line.split(/\s*\|\s*/).filter(Boolean);
    const namePart = parts.find(part => ROLE_SIGNAL.test(part) && !CONDITION_SIGNAL.test(part)) || parts[0] || line;
    rows.push({ name: titleFromLine(namePart, rows.length), lines: [line] });
  }
  return rows;
}


function splitTopLevel(text='', separators=new Set([',','·','/'])) {
  const out=[]; let buf=''; let depth=0;
  for(const ch of String(text)){
    if(ch==='(' || ch==='[' || ch==='{') depth++;
    if(ch===')' || ch===']' || ch==='}') depth=Math.max(0,depth-1);
    if(depth===0 && separators.has(ch)) { if(cleanLine(buf)) out.push(cleanLine(buf)); buf=''; continue; }
    buf+=ch;
  }
  if(cleanLine(buf)) out.push(cleanLine(buf));
  return out;
}

function expandRoleItem(item='') {
  const text=cleanLine(item);
  const open=text.indexOf('('); const close=text.lastIndexOf(')');
  if(open<1 || close<=open) return [text];
  const base=cleanLine(text.slice(0,open));
  const inner=text.slice(open+1,close);
  const children=splitTopLevel(inner);
  if(children.length<2) return [text];
  const out=[];
  for(const child of children){
    const nestedOpen=child.indexOf('('), nestedClose=child.lastIndexOf(')');
    if(nestedOpen>0 && nestedClose>nestedOpen){
      const role=cleanLine(child.slice(0,nestedOpen));
      const subs=splitTopLevel(child.slice(nestedOpen+1,nestedClose));
      if(subs.length>1){ for(const sub of subs) out.push(`${base} ${role} ${sub}`); continue; }
    }
    out.push(`${base} ${child}`);
  }
  return out;
}

function splitInlineRecruitmentList(lines) {
  const blocks=[];
  for (const line of lines) {
    const match=line.match(/(?:모집|채용)\s*분야(?:\([^)]*\))?\s*[:：]\s*(.+)$/i);
    if(!match) continue;
    const tail=match[1].replace(/※.*$/,'').trim();
    if(tail.length<8 || tail.length>700) continue;
    const top=splitTopLevel(tail);
    const roleParts=[];
    for(const item of top){
      const expanded=expandRoleItem(item);
      for(const x of expanded){
        if(x.length<=100 && /(?:급|직|행정|사무|전산|정보|시설|기계|전기|소방|건축|토목|운전|환경|회계|재무|기술|연구|경영|총무|인사|기획|보안|미화|조리|산업안전|산업보건|건설안전)/.test(x)) roleParts.push(x);
      }
    }
    if(roleParts.length>=2){
      for(const item of roleParts) blocks.push({name:titleFromLine(item,blocks.length),lines:[`${item} | ${line}`]});
    }
  }
  return blocks;
}

function dedupeBlocks(blocks) {
  const seen = new Set();
  return blocks.filter(block => {
    if (isNonVacancyCandidate(block.name, block.lines)) return false;
    const key = `${block.name}|${block.lines.join(' ')}`.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_VACANCIES);
}

export function splitVacancies({ title = '', detailText = '', documentText = '' } = {}) {
  const combined = `${detailText}\n${documentText}`;
  const lines = normalizeLines(combined);
  const sharedContext = collectGlobalContext(lines);
  let blocks = splitByExplicitHeaders(lines);
  if (blocks.length < 2) {
    const rowBlocks = splitByRows(lines);
    if (rowBlocks.length >= 2) blocks = rowBlocks;
  }
  if (blocks.length < 2) {
    const inlineBlocks = splitInlineRecruitmentList(lines);
    if (inlineBlocks.length >= 2) blocks = inlineBlocks;
  }
  blocks = dedupeBlocks(blocks);

  if (blocks.length < 2) {
    return [{
      id: 'vacancy-1',
      name: title || '통합 모집분야',
      localText: combined,
      sharedContext,
      source: 'single',
      confidence: 0.45
    }];
  }

  return blocks.map((block, index) => ({
    id: `vacancy-${index + 1}`,
    name: block.name,
    localText: block.lines.join('\n'),
    sharedContext,
    source: block.lines.length === 1 ? 'table-row' : 'section',
    confidence: block.lines.length === 1 ? 0.72 : 0.82
  }));
}
