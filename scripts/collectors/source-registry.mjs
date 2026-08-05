const ALIO_BASE = 'https://job.alio.go.kr/mobile2021/recruit/recruit.do';

function alioUrl(org) {
  const url = new URL(ALIO_BASE);
  url.searchParams.set('order', 'REG_DATE');
  url.searchParams.set('org_name', org);
  url.searchParams.set('search_yn', 'Y');
  return url.href;
}

// urls are ordered from the institution's official recruitment board to broad fallbacks.
// The collector tries every URL until one returns a usable HTML response.
const RAW_SOURCES = [
  { org: '한국동서발전', urls: [
    'https://www.ewp.co.kr/kor/subpage/content.html?pc=SP5RQGKR3BAUE4W1XB8Q9IE8WF9WA4U',
    'https://www.ewp.co.kr/', alioUrl('한국동서발전') ] },
  { org: '한국석유공사', urls: [
    'https://www.knoc.co.kr/sub01/sub01_7_9.jsp',
    'https://m.knoc.co.kr/sub01/sub01_7_9.jsp',
    'https://www.knoc.co.kr/', alioUrl('한국석유공사') ] },
  { org: '한국에너지공단', urls: [
    'https://www.energy.or.kr/front/board/etc/jobList.do',
    'https://min24.energy.or.kr/job',
    'https://www.energy.or.kr/', alioUrl('한국에너지공단') ] },
  { org: '한국산업인력공단', urls: [
    'https://www.hrdkorea.or.kr/3/1/2/2',
    'https://www.hrdkorea.or.kr/', alioUrl('한국산업인력공단') ] },
  { org: '근로복지공단', urls: [
    'https://comwel.incruit.com/index_main.asp',
    'https://comwel.saramin.co.kr/',
    'https://www.comwel.or.kr/comwel/noti/recruit.jsp',
    'https://www.comwel.or.kr/', alioUrl('근로복지공단') ] },
  { org: '한국산업안전보건공단', urls: [
    'https://www.kosha.or.kr/kosha/intro/recruitment.do',
    'https://www.kosha.or.kr/', alioUrl('한국산업안전보건공단') ] },
  { org: '울산항만공사', urls: [
    'https://www.upa.or.kr/portal/contents.do?mid=0405000000',
    'https://www.upa.or.kr/', alioUrl('울산항만공사') ] },
  { org: '한국전력공사', urls: [
    'https://www.kepco.co.kr/home/about/careers.do',
    'https://recruit.kepco.co.kr/', alioUrl('한국전력공사') ] },
  { org: '한국수력원자력', urls: [
    'https://www.khnp.co.kr/recruit/', alioUrl('한국수력원자력') ] },
  { org: '울산도시공사', urls: ['https://www.umca.co.kr/'] },
  { org: '울산시설공단', urls: [
    'https://www.uic.or.kr/notify/noti06.do',
    'https://uic.or.kr/notify/noti06.do',
    'https://uic.or.kr/recruit/main/mainPage.do',
    'https://uic.or.kr/' ] },
  { org: '울산남구도시관리공단', urls: ['https://www.uncmc.or.kr/'] },
  { org: '울산북구시설관리공단', urls: ['https://www.ubimc.or.kr/'] },
  { org: '울주군시설관리공단', urls: ['https://www.uljusiseol.or.kr/'] },
  { org: '울산정보산업진흥원', urls: [
    'https://www.uipa.or.kr/webuser/recruit/list.html',
    'https://uipa.or.kr/webuser/recruit/list.html',
    'https://uipa.careerlink.kr/',
    'https://uipa.recruiter.co.kr/',
    'https://uipa.or.kr/' ] },
  { org: '울산테크노파크', urls: ['https://www.utp.or.kr/'] },
  { org: '울산경제일자리진흥원', urls: ['https://www.ubpi.or.kr/'] },
  { org: '울산연구원', urls: [
    'http://www.uri.re.kr/',
    'https://uill.uri.re.kr/',
    'https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004001003000000' ] },
  { org: '울산문화관광재단', urls: ['https://www.uctf.or.kr/'] },
  { org: '울산복지가족진흥사회서비스원', urls: [
    // Primary and legacy official recruitment boards.
    'https://www.wfps.or.kr/webuser/employment/list.html',
    'https://www.wfps.or.kr/',
    'https://www.uwfdi.re.kr/webuser/employment/list.html',
    'https://www.uwfdi.re.kr/',
    // Official Ulsan Metropolitan City mirrors used when GitHub-hosted runners
    // cannot establish a TCP connection to the institution domains.
    'https://www.ulsan.go.kr/u/rep/contents.do?mId=001004001003000000',
    'https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004001003000000',
    'https://www.ulsan.go.kr/u/rep/contents.do?mId=001004001001000000',
    // Official local-government availability fallback. Phase 2 must verify
    // that institution-specific listing coverage is sufficient before parsing.
    'https://www.ulsannamgu.go.kr/cop/bbs/selectBoardList.do?bbsId=hireNotice2' ] },
  { org: '울주문화재단', urls: ['https://uljuculture.hubst.co.kr/', 'http://www.ucf.or.kr/', 'https://www.ucf.or.kr/'] },
  { org: '울산광역시 타기관소식', urls: [
    // Primary source: Ulsan Metropolitan City other-organization notices.
    'https://www.ulsan.go.kr/u/rep/contents.do?mId=001004001003000000',
    // Official local-government fallback: subsidiary-agency recruitment notices.
    // GitHub-hosted runners can be blocked at the TCP layer by ulsan.go.kr, so the
    // collector must still have an official public route for Phase 1 availability.
    'https://www.ulsannamgu.go.kr/cop/bbs/selectBoardList.do?bbsId=hireNotice2',
    // Official public-institution fallback. Phase 2 will validate listing coverage.
    'https://job.alio.go.kr/' ] }
];

export const SOURCES = RAW_SOURCES.map(({ org, urls }) => {
  const url = urls[0];
  const directBoard = !/^(?:https:\/\/)?(?:www\.)?[^/]+\/?$/i.test(url);
  return {
    org,
    homepage: urls.find(item => /^https:\/\/[^/]+\/?$/.test(item)) || url,
    url,
    accessUrls: [...new Set(urls)],
    mode: 'direct',
    alio: false,
    detail: true,
    requireValidDetail: true,
    discoverListings: !directBoard,
    maxListingPages: 4
  };
});

export const SOURCE_REGISTRY_VERSION = '14.0-phase2-list-extraction';
