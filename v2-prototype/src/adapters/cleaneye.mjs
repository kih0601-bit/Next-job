import { requireServiceKey, fetchText, xmlItems } from './common.mjs';
const BASE='https://apis.data.go.kr/B551982/openApiEmployInfo/openXmlEmployInfo';

export async function discoverCleaneye({sidoCd,page=1,rows=100}={}){
  if(!sidoCd) throw new Error('Cleaneye requires sidoCd (official API required parameter)');
  const key=requireServiceKey();
  const u=new URL(BASE);
  u.searchParams.set('serviceKey',key);
  u.searchParams.set('sidoCd',sidoCd);
  // API currently returns XML only; page parameters are sent only if accepted by provider.
  if(page) u.searchParams.set('pageNo',page);
  if(rows) u.searchParams.set('numOfRows',rows);
  u.searchParams.set('type','xml');
  return xmlItems(await fetchText(u));
}
