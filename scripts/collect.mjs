import fs from 'node:fs/promises';

const ORGS = [
  {org:'한국동서발전', starts:['https://www.ewp.co.kr/kor/subpage/content.html?pc=RK5YMC9NOUTZXMB92RJY3KLLZI7SL9C','https://www.ewp.co.kr/']},
  {org:'한국석유공사', starts:['https://www.knoc.co.kr/sub01/sub01_7_9.jsp']},
  {org:'한국에너지공단', starts:['https://www.energy.or.kr/front/board/etc/jobList.do']},
  {org:'한국산업인력공단', starts:['https://www.hrdkorea.or.kr/3/1/2/2']},
  {org:'근로복지공단', starts:['https://www.comwel.or.kr/comwel/empl/empl.jsp','https://www.comwel.or.kr/']},
  {org:'한국산업안전보건공단', starts:['https://www.kosha.or.kr/kosha/recruit/recruit.do','https://www.kosha.or.kr/']},
  {org:'울산항만공사', starts:['https://www.upa.or.kr/','https://www.upa.or.kr/portal/board/post/list.do?bcIdx=746']},
  {org:'한국전력공사 울산본부', starts:['https://recruit.kepco.co.kr/']},
  {org:'한국수력원자력 새울원자력본부', starts:['https://www.khnp.co.kr/recruit/']},
  {org:'울산도시공사', starts:['https://www.umca.co.kr/']},
  {org:'울산시설공단', starts:['https://uic.or.kr/recruit/main/mainPage.do']},
  {org:'울산남구도시관리공단', starts:['https://www.uncmc.or.kr/']},
  {org:'울산북구시설관리공단', starts:['https://www.ubimc.or.kr/']},
  {org:'울주군시설관리공단', starts:['https://www.uljusiseol.or.kr/']},
  {org:'울산정보산업진흥원', starts:['https://uipa.or.kr/webuser/recruit/list.html']},
  {org:'울산테크노파크', starts:['https://www.utp.or.kr/']},
  {org:'울산경제일자리진흥원', starts:['https://www.ubpi.or.kr/']},
  {org:'울산연구원', starts:['https://www.uri.re.kr/']},
  {org:'울산문화관광재단', starts:['https://www.uctf.or.kr/']},
  {org:'울산복지가족진흥사회서비스원', starts:['https://www.ulsanpass.or.kr/']},
  {org:'울주문화재단', starts:['https://www.ucf.or.kr/']}
];

const HARD_EXCLUDE = [
  /R\s*&\s*D/i,/연구개발/,/과제/,/구축사업/,/지원사업/,/사업\s*공고/,
  /수요기업/,/참여기업/,/입주기업/,/기업\s*모집/,/기업지원/,/용역/,/입찰/,
  /제안서/,/공모전/,/공모사업/,/수행기관/,/수행기업/,/교육생/,/수강생/,
  /참가자/,/참여자/,/설명회/,/박람회/,/세미나/,/포럼/,/기술개발/,
  /실증사업/,/지원대상/,/사칭/,/보이스피싱/,/스미싱/,/주의사항/,
  /합격자/,/최종합격/,/서류전형/,/필기전형/,/면접전형/,/면접대상/,
  /전형결과/,/결과발표/,/채용결과/,/예비합격/,/추가합격/,
  /개인정보/,/보도자료/,/뉴스/,/홍보/,/채용계획/,/연간\s*채용계획/,
  /알리미/,/FAQ/i,/자주\s*묻는/
];

const RECRUIT_TITLE = [
  /채용\s*공고/,/직원\s*(?:공개)?채용/,/신입(?:사원|직원)?\s*(?:공개)?채용/,
  /경력(?:사원|직원)?\s*(?:공개)?채용/,/정규직\s*(?:공개)?채용/,
  /무기계약직\s*(?:공개)?채용/,/공무직\s*(?:근로자)?\s*(?:공개)?채용/,
  /기간제(?:근로자|직원)?\s*(?:공개)?채용/,/계약직\s*(?:직원)?\s*(?:공개)?채용/,
  /체험형\s*인턴\s*(?:공개)?채용/,/채용형\s*인턴\s*(?:공개)?채용/,
  /일반직\s*(?:직원)?\s*(?:공개)?채용/,/전문직\s*(?:직원)?\s*(?:공개)?채용/,
  /별정직\s*(?:직원)?\s*(?:공개)?채용/,/직원\s*모집/,/근로자\s*모집/
];

const clean = v => String(v || '')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'")
  .replace(/\s+/g,' ')
  .trim();

const abs = (href, base) => {
  try { return new URL(href, base).href; } catch { return ''; }
};

const sameHost = (a,b) => {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
};

async function fetchText(url, timeoutMs=14000) {
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url,{
      signal:ctl.signal,
      redirect:'follow',
      headers:{
        'user-agent':'Mozilla/5.0 (compatible; NextJobCollector/6.0)',
        'accept-language':'ko-KR,ko;q=0.9'
      }
    });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function linksFrom(html, base) {
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const url=abs(m[1],base), text=clean(m[2]);
    if(!url || !sameHost(url,base)) continue;
    out.push({url,text});
  }
  return out;
}

function isRecruitTitle(title) {
  if(!title || title.length<7 || title.length>180) return false;
  if(HARD_EXCLUDE.some(r=>r.test(title))) return false;
  return RECRUIT_TITLE.some(r=>r.test(title));
}

function isRecruitBoardLink(link) {
  const s=`${link.text} ${link.url}`.toLowerCase();
  return /(채용|인재|recruit|employment|job|empl)/i.test(s)
    && !HARD_EXCLUDE.some(r=>r.test(link.text));
}

function extractDate(text) {
  const all=[...text.matchAll(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/g)];
  if(!all.length) return '';
  const x=all[all.length-1];
  return `${x[1]}-${String(x[2]).padStart(2,'0')}-${String(x[3]).padStart(2,'0')}`;
}

function extractCount(text) {
  const m=text.match(/(?:채용|모집)\s*인원[^0-9]{0,15}(\d+)\s*명|(\d+)\s*명\s*(?:내외|채용|모집)/);
  return m ? Number(m[1]||m[2]) : null;
}

function eligibility(text) {
  const high=/고졸|고등학교\s*(?:졸업|졸업예정)|학력\s*무관|학력\s*제한\s*없/.test(text);
  const degree=/전문학사\s*이상|대졸\s*이상|학사\s*이상|석사\s*이상|박사\s*이상|4년제\s*대학/.test(text);
  if(high&&!degree) return {label:'고졸 가능',score:100,reason:'고졸 또는 학력무관 문구 확인'};
  if(degree&&!high) return {label:'고졸 지원 어려움',score:0,reason:'전문학사·학사 이상 조건 확인'};
  return {label:'학력 확인 필요',score:30,reason:'상세 공고 학력 조건 확인 필요'};
}

function employment(text) {
  if(/정규직/.test(text)) return '정규직';
  if(/무기계약직|공무직/.test(text)) return '무기계약직·공무직';
  if(/채용형\s*인턴/.test(text)) return '채용형 인턴';
  if(/체험형\s*인턴/.test(text)) return '체험형 인턴';
  if(/기간제|계약직/.test(text)) return '기간제·계약직';
  return '원문 확인';
}

function location(text) {
  if(/울산|울주|새울/.test(text)) return '울산 관련';
  const m=text.match(/근무지[^가-힣]{0,8}([가-힣시군구\s]{2,18})/);
  return m ? clean(m[1]).slice(0,20) : '원문 확인';
}

function summarize(title,text,e,deadline,count,type,loc) {
  const a=[`실제 직원 채용공고로 확인되었습니다.`];
  a.push(e.label==='고졸 가능'?'고졸 또는 학력무관 지원 가능 문구가 있습니다.':
    e.label==='고졸 지원 어려움'?'전문학사·학사 이상 조건이 확인됩니다.':'학력 조건은 원문 확인이 필요합니다.');
  if(type!=='원문 확인') a.push(`고용형태: ${type}`);
  if(loc!=='원문 확인') a.push(`근무지: ${loc}`);
  if(count) a.push(`모집인원: ${count}명`);
  if(deadline) a.push(`확인된 마감일: ${deadline}`);
  return a.slice(0,5);
}

async function collectOrg(cfg) {
  const pageQueue=[...cfg.starts];
  const visited=new Set();
  const candidates=[];

  while(pageQueue.length && visited.size<5){
    const url=pageQueue.shift();
    if(visited.has(url)) continue;
    visited.add(url);
    try{
      const html=await fetchText(url);
      const links=linksFrom(html,url);

      for(const l of links){
        if(isRecruitTitle(l.text)) candidates.push({title:l.text,url:l.url,listContext:clean(html.slice(Math.max(0,html.indexOf(l.text)-500),html.indexOf(l.text)+1000))});
      }

      if(visited.size<3){
        for(const l of links.filter(isRecruitBoardLink).slice(0,5)){
          if(!visited.has(l.url)) pageQueue.push(l.url);
        }
      }
    }catch(e){}
  }

  const unique=[];
  const seen=new Set();
  for(const c of candidates){
    const k=c.title.toLowerCase().replace(/\s+/g,' ');
    if(seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
  }

  const jobs=[];
  for(const c of unique.slice(0,15)){
    let detail='';
    try{ detail=clean(await fetchText(c.url,10000)); }catch{}
    const full=`${c.title} ${c.listContext} ${detail}`;

    if(HARD_EXCLUDE.some(r=>r.test(full))) continue;
    if(!isRecruitTitle(c.title)) continue;

    const e=eligibility(full);
    const deadline=extractDate(full);
    const count=extractCount(full);
    const type=employment(full);
    const loc=location(full);
    let score=e.score;
    if(loc.includes('울산')) score+=15;
    if(['정규직','무기계약직·공무직','채용형 인턴'].includes(type)) score+=10;
    if(/신입|경력\s*무관/.test(full)) score+=5;

    jobs.push({
      org:cfg.org,
      title:c.title,
      link:c.url,
      date:'',
      deadline,
      recruitmentCount:count,
      employmentType:type,
      location:loc,
      eligibility:e.label,
      fitScore:Math.max(0,Math.min(100,score)),
      fitReasons:[e.reason],
      summary:summarize(c.title,full,e,deadline,count,type,loc),
      raw:detail.slice(0,1400)
    });
  }

  return {org:cfg.org,ok:true,count:jobs.length,jobs};
}

const settled=await Promise.allSettled(ORGS.map(collectOrg));
const sources=[], jobs=[], seen=new Set();

for(let i=0;i<settled.length;i++){
  const r=settled[i];
  if(r.status==='fulfilled'){
    sources.push({org:r.value.org,ok:true,count:r.value.count,error:''});
    for(const j of r.value.jobs){
      const k=`${j.org}|${j.title}`.toLowerCase().replace(/\s+/g,' ');
      if(seen.has(k)) continue;
      seen.add(k); jobs.push(j);
    }
  }else{
    sources.push({org:ORGS[i].org,ok:false,count:0,error:String(r.reason||'unknown')});
  }
}

jobs.sort((a,b)=>(b.fitScore-a.fitScore)||a.org.localeCompare(b.org,'ko'));

const payload={
  version:'6.0-21org',
  updatedAt:new Date().toISOString(),
  jobs:jobs.slice(0,250),
  sources,
  stats:{
    sourceCount:ORGS.length,
    success:sources.filter(s=>s.ok).length,
    total:jobs.length,
    highSchoolSuitable:jobs.filter(j=>j.eligibility==='고졸 가능').length,
    reviewNeeded:jobs.filter(j=>j.eligibility==='학력 확인 필요').length
  },
  note:'21개 기관 공식 사이트를 기관별 시작주소에서 탐색하며 실제 직원 채용공고만 저장합니다.'
};

await fs.writeFile('data/jobs.json',JSON.stringify(payload,null,2)+'\n','utf8');
console.log(JSON.stringify(payload.stats,null,2));
