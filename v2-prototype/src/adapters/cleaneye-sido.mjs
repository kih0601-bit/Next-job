import { requireServiceKey, fetchText, xmlItems } from './common.mjs';
const BASE='https://apis.data.go.kr/B551982/openApiSidoCd3/openXmlSidoCd2';

export async function discoverCleaneyeSidoCodes(){
  const key=requireServiceKey();
  const u=new URL(BASE);
  u.searchParams.set('serviceKey',key);
  u.searchParams.set('type','xml');
  const items=xmlItems(await fetchText(u));
  const normalized=items.map(x=>({
    code:String(x.sidoCd ?? x.SIDOCd ?? x.code ?? x.sido_code ?? '').trim(),
    name:String(x.sidoNm ?? x.sidoName ?? x.name ?? '').trim(),
    raw:x
  })).filter(x=>x.code);
  if(!normalized.length) throw new Error('Cleaneye sido-code API returned no codes');
  return normalized;
}
