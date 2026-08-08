
import { decodeHtmlEntities } from './detail-parser.mjs';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function parseForm(html=''){
  const form = String(html).match(/<form\b[^>]*(?:id|name)\s*=\s*["']defaultFrm["'][^>]*>([\s\S]*?)<\/form>/i)?.[1] || '';
  const params = new URLSearchParams();
  for(const input of form.matchAll(/<input\b([^>]*)>/gi)){
    const attrs=input[1]||'';
    const name=attrs.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2]||'';
    if(!name) continue;
    const type=(attrs.match(/\btype\s*=\s*(["'])([^"']+)\1/i)?.[2]||'text').toLowerCase();
    if(['submit','button','image','file'].includes(type)) continue;
    const value=attrs.match(/\bvalue\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]||'';
    params.set(decodeHtmlEntities(name), decodeHtmlEntities(value));
  }
  if(!params.has('pageIndex')) params.set('pageIndex','1');
  return params;
}

async function fetchWithTimeout(url, options={}, timeoutMs=25000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{ return await fetch(url,{...options,signal:controller.signal}); }
  finally{ clearTimeout(timer); }
}

export async function fetchKepcoDynamicList(baseHtml='', sourceUrl='', {timeoutMs=25000,retries=2}={}){
  const endpoint=new URL('/frt/frt0001/addList.do',sourceUrl).href;
  const params=parseForm(baseHtml);
  const headers={
    'content-type':'application/x-www-form-urlencoded',
    'referer':sourceUrl,
    'user-agent':'Mozilla/5.0'
  };
  let lastError=null;
  for(let attempt=0; attempt<=retries; attempt++){
    try{
      const res=await fetchWithTimeout(endpoint,{method:'POST',headers,body:params.toString(),redirect:'follow'},timeoutMs);
      const html=await res.text();
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      if(!/fncPageBoard\s*\(\s*['"]view['"]/i.test(html)) throw new Error('KEPCO dynamic response missing view records');
      return {html,status:res.status,finalUrl:res.url||endpoint,requestedUrl:endpoint,attempt:attempt+1,transport:'fetch'};
    }catch(error){
      lastError=error;
      if(attempt<retries) await sleep(700*(attempt+1));
    }
  }
  throw lastError || new Error('KEPCO dynamic list unavailable');
}

export function extractKepcoRecords(html='', sourceUrl=''){
  const out=[];
  for(const m of String(html).matchAll(/<li\b[^>]*class\s*=\s*["'][^"']*\bstate_[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)){
    const block=m[0];
    const titleHtml=block.match(/<[^>]*class\s*=\s*["'][^"']*\btit\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]||'';
    const title=titleHtml.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
    const call=block.match(/fncPageBoard\s*\(\s*['"]view['"]\s*,\s*['"]([^'"]*view\.do)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
    if(!call) continue;
    const [, path, values, names] = call;
    const vals=values.split(',').map(s=>s.trim());
    const keys=names.split(',').map(s=>s.trim());
    const body=new URLSearchParams();
    keys.forEach((k,i)=>body.set(k,vals[i]||''));
    const endpoint=new URL(path, new URL('/frt/frt0001/', sourceUrl)).href;
    out.push({
      title,
      detailUrl:endpoint,
      detailRequest:{
        method:'POST',
        url:endpoint,
        body:body.toString(),
        headers:{'content-type':'application/x-www-form-urlencoded'},
        referer:sourceUrl
      },
      listText:block.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
    });
  }
  return out;
}
