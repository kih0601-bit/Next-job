import { requireServiceKey, fetchText, xmlItems } from './common.mjs';
const BASE='https://apis.data.go.kr/1760000/PblJobService';
export async function discoverNarailter({page=1,rows=100}={}){
  const key=requireServiceKey();
  const u=new URL(`${BASE}/getList`); u.searchParams.set('serviceKey',key); u.searchParams.set('pageNo',page); u.searchParams.set('numOfRows',rows);
  return xmlItems(await fetchText(u));
}
