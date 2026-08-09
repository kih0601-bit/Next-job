import crypto from 'node:crypto';
import { canonicalJobUrl } from '../collectors/source-adapters.mjs';

const PAGE_KEYS = ['page','pageIndex','pageNo','currentPage','curPage','pageNum'];
const uniq = xs => [...new Set(xs.filter(Boolean))];
const clean = s => String(s || '').replace(/&amp;/g,'&');

function pageKeyFromUrl(url='') {
  try {
    const u = new URL(url);
    for (const key of PAGE_KEYS) if (u.searchParams.has(key)) return key;
  } catch {}
  return '';
}
function withPage(url, key, n) {
  const u = new URL(url); u.searchParams.set(key, String(n)); return u.href;
}
function parseTotalPages(html='') {
  const s = String(html);
  const pats = [
    /\(\s*\d+\s*\/\s*(\d+)\s*page\s*\)/i,
    /Page\s*\d+\s*\/\s*(\d+)/i,
    /(?:총|전체)\s*(?:페이지)?\s*[:：]?\s*(\d+)\s*(?:page|페이지)/i,
    /totalPage(?:Count|Cnt|s)?\s*[:=]\s*["']?(\d+)/i
  ];
  for (const p of pats) { const m=s.match(p); if(m) return Number(m[1]); }
  return null;
}
function explicitPageLinks(html='', baseUrl='') {
  const out=[];
  for (const m of String(html).matchAll(/href\s*=\s*(["'])([^"']+)\1/gi)) {
    try {
      const href = new URL(clean(m[2]), baseUrl).href;
      const u = new URL(href);
      for (const key of PAGE_KEYS) {
        const v = u.searchParams.get(key);
        if (v && /^\d+$/.test(v)) out.push({url:href,key,page:Number(v)});
      }
    } catch {}
  }
  return out;
}
function jsPages(html='') {
  const vals=[];
  for (const m of String(html).matchAll(/(?:goPage|fn_gotoPage|fn_egov_select_noticeList|requestGoingPage|G_MovePage)\s*\(\s*["']?(\d+)["']?\s*\)/gi)) vals.push(Number(m[1]));
  return uniq(vals).sort((a,b)=>a-b);
}
function apiMeta(html='', source={}) {
  try {
    const j = JSON.parse(String(html));
    const p = j?.common?.pagingInfo;
    if (p?.totalCnt && p?.rowsPerPage) return { totalPages: Math.max(1, Math.ceil(Number(p.totalCnt)/Number(p.rowsPerPage))), totalCount:Number(p.totalCnt), rowsPerPage:Number(p.rowsPerPage), current:Number(p.curPageCo||1), api:'kosha' };
    const totalPages = Number(j?.totalPages ?? j?.page?.totalPages ?? j?.meta?.totalPages);
    const totalCount = Number(j?.totalElements ?? j?.totalCount ?? j?.page?.totalElements ?? j?.meta?.totalCount);
    if (Number.isFinite(totalPages) && totalPages>0) return { totalPages, totalCount:Number.isFinite(totalCount)?totalCount:null, current:0, api:'json' };
  } catch {}
  return null;
}
export function discoverPaginationPlan({html='', source={}, selectedUrl=''}) {
  const url = selectedUrl || source.url || '';
  const api = apiMeta(html,source);
  if (source.org==='한국산업안전보건공단' && api?.api==='kosha') return {kind:'kosha-api', pageBase:1, totalPages:api.totalPages, totalCount:api.totalCount, evidence:['pagingInfo.totalCnt/rowsPerPage']};
  if (source.org==='울산문화관광재단' && /\/api\/notices/i.test(url)) {
    const u=new URL(url); return {kind:'query-get', key:'page', pageBase:0, totalPages:api?.totalPages || null, totalCount:api?.totalCount ?? null, evidence:['UCTF notices API page parameter']};
  }
  const links=explicitPageLinks(html,url);
  if (links.length) {
    const counts={}; for(const x of links) counts[x.key]=(counts[x.key]||0)+1;
    const key=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    const pages=links.filter(x=>x.key===key).map(x=>x.page);
    const total=parseTotalPages(html) || Math.max(...pages);
    return {kind:'query-get',key,pageBase:Math.min(...pages,1),totalPages:total,totalCount:null,evidence:[`explicit href ${key}=N`, `max-linked-page=${Math.max(...pages)}`]};
  }
  const existingKey=pageKeyFromUrl(url);
  if(existingKey) return {kind:'query-get',key:existingKey,pageBase:Number(new URL(url).searchParams.get(existingKey)||1),totalPages:parseTotalPages(html),totalCount:null,evidence:[`selected URL contains ${existingKey}`]};
  const total=parseTotalPages(html), js=jsPages(html);
  if(js.length || total) return {kind:'javascript-form',key:'',pageBase:1,totalPages:total || (js.length?Math.max(...js):null),totalCount:null,evidence:[...(total?[`page text total=${total}`]:[]),...(js.length?[`javascript page calls ${js.slice(0,12).join(',')}`]:[])]};
  return {kind:'single-or-undetected',key:'',pageBase:1,totalPages:1,totalCount:null,evidence:['no pagination control detected on verified list page']};
}
export function paginationUrl(plan, selectedUrl, page) {
  if(plan.kind!=='query-get' || !plan.key) return '';
  return withPage(selectedUrl,plan.key,page);
}
export function reconcilePages(pageResults=[]) {
  const seen=new Map(), duplicates=[];
  let raw=0;
  for(const page of pageResults){
    for(const item of page.candidates||[]){ raw++; const key=canonicalJobUrl(item.link||'') || String(item.title||'').trim().toLowerCase(); if(!key) continue; if(seen.has(key)) duplicates.push({key,firstPage:seen.get(key),duplicatePage:page.page}); else seen.set(key,page.page); }
  }
  const unique=seen.size;
  return { rawCount:raw, uniqueCount:unique, duplicateCount:Math.max(0,raw-unique), duplicateSamples:duplicates.slice(0,20), unexplainedLoss:raw-unique-duplicates.length };
}
export function pageFingerprint(candidates=[]) {
  return crypto.createHash('sha1').update((candidates||[]).map(x=>`${x.title}|${canonicalJobUrl(x.link||'')}`).join('\n')).digest('hex').slice(0,16);
}
