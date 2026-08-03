import fs from 'node:fs/promises';

const SOURCES = [
  {org:'울산정보산업진흥원',url:'https://uipa.or.kr/webuser/recruit/list.html'},
  {org:'울산테크노파크',url:'https://www.utp.or.kr/'},
  {org:'울산시설공단',url:'https://uic.or.kr/recruit/main/mainPage.do'},
  {org:'울산광역시 타기관소식',url:'https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004001003000000'},
  {org:'한국동서발전',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EB%8F%99%EC%84%9C%EB%B0%9C%EC%A0%84&search_yn=Y'},
  {org:'한국석유공사',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%84%9D%EC%9C%A0%EA%B3%B5%EC%82%AC&search_yn=Y'},
  {org:'한국에너지공단',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%97%90%EB%84%88%EC%A7%80%EA%B3%B5%EB%8B%A8&search_yn=Y'},
  {org:'한국산업인력공단',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%82%B0%EC%97%85%EC%9D%B8%EB%A0%A5%EA%B3%B5%EB%8B%A8&search_yn=Y'},
  {org:'근로복지공단',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%EA%B7%BC%EB%A1%9C%EB%B3%B5%EC%A7%80%EA%B3%B5%EB%8B%A8&search_yn=Y'},
  {org:'한국산업안전보건공단',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%82%B0%EC%97%85%EC%95%88%EC%A0%84%EB%B3%B4%EA%B1%B4%EA%B3%B5%EB%8B%A8&search_yn=Y'},
  {org:'울산항만공사',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%EC%9A%B8%EC%82%B0%ED%95%AD%EB%A7%8C%EA%B3%B5%EC%82%AC&search_yn=Y'},
  {org:'한국전력공사',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%A0%84%EB%A0%A5%EA%B3%B5%EC%82%AC&search_yn=Y'},
  {org:'한국수력원자력',url:'https://job.alio.go.kr/mobile2021/recruit/recruit.do?order=REG_DATE&org_name=%ED%95%9C%EA%B5%AD%EC%88%98%EB%A0%A5%EC%9B%90%EC%9E%90%EB%A0%A5&search_yn=Y'}
];

const clean = s => String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const abs = (href,base) => { try { return new URL(href,base).href } catch { return base } };
const fit = text => {
  const t=text.toLowerCase(); let score=0; const reasons=[];
  if(/고졸|고등학교 졸업/.test(t)){score+=5;reasons.push('고졸')}
  if(/학력무관|학력 제한 없음/.test(t)){score+=4;reasons.push('학력무관')}
  if(/울산|새울|울주/.test(t)){score+=3;reasons.push('울산근무')}
  if(/정규직|무기계약직|채용형.?인턴/.test(t)){score+=2;reasons.push('안정고용')}
  if(/청년인턴/.test(t)){score-=2;reasons.push('연령확인')}
  if(/대졸|학사|석사|박사/.test(t)&&!/학력무관/.test(t)){score-=4;reasons.push('학력제한확인')}
  return {score,reasons:[...new Set(reasons)]};
};
function parse(html,src){
  const out=[],seen=new Set();
  for(const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(a[2]);
    if(title.length<5||title.length>180)continue;
    if(!/(채용|직원|신입|인턴|공무직|기간제|근로자|모집)/.test(title))continue;
    if(/합격자|면접|서류전형 결과/.test(title)&&!/채용공고|모집공고/.test(title))continue;
    const k=(src.org+'|'+title).toLowerCase().replace(/\s+/g,' ');
    if(seen.has(k))continue; seen.add(k);
    const context=clean(html.slice(Math.max(0,a.index-700),Math.min(html.length,a.index+a[0].length+1100)));
    const f=fit(title+' '+context);
    out.push({org:src.org,title,link:abs(a[1],src.url),fitScore:f.score,fitReasons:f.reasons,raw:context.slice(0,500)});
    if(out.length>=25)break;
  }
  return out;
}
async function one(src){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
  try{
    const r=await fetch(src.url,{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 NextJobCollector/3.0','accept-language':'ko-KR'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    return {ok:true,src,jobs:parse(await r.text(),src)};
  }catch(e){return {ok:false,src,jobs:[],error:e.name==='AbortError'?'timeout':e.message}}
  finally{clearTimeout(timer)}
}
const results=await Promise.all(SOURCES.map(one)),jobs=[],keys=new Set(),sources=[];
for(const r of results){
  sources.push({org:r.src.org,ok:r.ok,count:r.jobs.length,error:r.error||''});
  for(const j of r.jobs){
    const k=(j.org+'|'+j.title).toLowerCase().replace(/\s+/g,' ');
    if(keys.has(k))continue; keys.add(k); jobs.push(j);
  }
}
jobs.sort((a,b)=>b.fitScore-a.fitScore);
const payload={version:'3.0',updatedAt:new Date().toISOString(),jobs:jobs.slice(0,200),sources,stats:{sourceCount:SOURCES.length,success:sources.filter(s=>s.ok).length,total:jobs.length}};
await fs.writeFile('data/jobs.json',JSON.stringify(payload,null,2)+'\n');
console.log(payload.stats);
