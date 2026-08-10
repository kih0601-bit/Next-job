export function normalizePublicDataServiceKey(raw=''){
  let s=String(raw||'').trim();
  if(!s) return '';
  // data.go.kr may show/store either an encoded key (%2B, %2F, %3D)
  // or the decoded Base64-like key (+, /, =). URLSearchParams must receive
  // the decoded form, otherwise '%' itself becomes %25 (double encoding).
  for(let i=0;i<3 && /%[0-9A-Fa-f]{2}/.test(s);i++){
    try{
      const d=decodeURIComponent(s);
      if(d===s) break;
      s=d;
    }catch{ break; }
  }
  return s;
}

export function requireServiceKey(){
  const k=normalizePublicDataServiceKey(process.env.DATA_GO_KR_SERVICE_KEY);
  if(!k) throw new Error('DATA_GO_KR_SERVICE_KEY is required for --live');
  return k;
}

export function redactSensitiveUrl(input){
  const raw=String(input||'');
  try{
    const u=new URL(raw);
    for(const name of ['serviceKey','ServiceKey','service_key','apiKey','apikey','key']){
      if(u.searchParams.has(name)) u.searchParams.set(name,'***REDACTED***');
    }
    return u.toString();
  }catch{
    return raw.replace(/([?&](?:serviceKey|ServiceKey|service_key|apiKey|apikey|key)=)[^&#\s]+/gi,'$1***REDACTED***');
  }
}

export async function fetchText(url){
  const r=await fetch(url,{headers:{'User-Agent':'NextJob-v2-prototype/0.1'}});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText} ${redactSensitiveUrl(url)}`);
  return await r.text();
}
export function xmlItems(xml){
  const blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
  return blocks.map(b=>Object.fromEntries([...b.matchAll(/<([A-Za-z0-9_]+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g)].map(m=>[m[1],decode(m[2].replace(/<!\[CDATA\[|\]\]>/g,''))])));
}
function decode(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();}
