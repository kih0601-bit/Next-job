import { requireServiceKey, fetchText, xmlItems } from './common.mjs';
const BASE='https://apis.data.go.kr/1051000/recruitment';
export async function discoverJobAlio({page=1,rows=100}={}){
  const key=requireServiceKey();
  const u=new URL(`${BASE}/list`); u.searchParams.set('serviceKey',key); u.searchParams.set('pageNo',page); u.searchParams.set('numOfRows',rows); u.searchParams.set('resultType','json');
  const txt=await fetchText(u);
  try { const j=JSON.parse(txt); return findItems(j); } catch { return xmlItems(txt); }
}
function findItems(x){
  if(Array.isArray(x)) return x;
  if(!x||typeof x!=='object') return [];
  for(const [k,v] of Object.entries(x)){ if(k==='item'&&Array.isArray(v)) return v; const r=findItems(v); if(r.length) return r; }
  return [];
}
