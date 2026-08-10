export function requireServiceKey(){
  const k=process.env.DATA_GO_KR_SERVICE_KEY;
  if(!k) throw new Error('DATA_GO_KR_SERVICE_KEY is required for --live');
  return k;
}
export async function fetchText(url){
  const r=await fetch(url,{headers:{'User-Agent':'NextJob-v2-prototype/0.1'}});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return await r.text();
}
export function xmlItems(xml){
  const blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
  return blocks.map(b=>Object.fromEntries([...b.matchAll(/<([A-Za-z0-9_]+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g)].map(m=>[m[1],decode(m[2].replace(/<!\[CDATA\[|\]\]>/g,''))])));
}
function decode(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();}
