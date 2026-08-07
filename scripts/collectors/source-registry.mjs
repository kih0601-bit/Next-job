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
// Each source selects one reusable access template. Institution-specific values stay here;
// transport/entry behavior lives in scripts/lib/access-templates.mjs.
const RAW_SOURCES = [
  { org: '한국동서발전', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL+JOB_ALIO_FALLBACK' }, urls: [
    'https://www.ewp.co.kr/kor/subpage/content.html?pc=SP5RQGKR3BAUE4W1XB8Q9IE8WF9WA4U',
    'https://www.ewp.co.kr/', alioUrl('한국동서발전') ] },
  { org: '한국석유공사', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL+JOB_ALIO_FALLBACK' }, urls: [
    'https://www.knoc.co.kr/sub01/sub01_7_9.jsp',
    'https://m.knoc.co.kr/sub01/sub01_7_9.jsp',
    'https://www.knoc.co.kr/', alioUrl('한국석유공사') ] },
  { org: '한국에너지공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL+JOB_ALIO_FALLBACK' }, urls: [
    'https://www.energy.or.kr/front/board/etc/jobList.do',
    'https://min24.energy.or.kr/job',
    'https://www.energy.or.kr/', alioUrl('한국에너지공단') ] },
  { org: '한국산업인력공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL+JOB_ALIO_FALLBACK' }, urls: [
    'https://www.hrdkorea.or.kr/3/1/2/2',
    'https://www.hrdkorea.or.kr/', alioUrl('한국산업인력공단') ] },
  { org: '근로복지공단', accessTemplate: 'COMMON_PLATFORM', accessConfig: { platform: 'INCRUIT' }, urls: [
    'https://comwel.incruit.com/index_main.asp',
    'https://comwel.saramin.co.kr/',
    'https://www.comwel.or.kr/comwel/noti/recruit.jsp',
    'https://www.comwel.or.kr/', alioUrl('근로복지공단') ] },
  { org: '한국산업안전보건공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL+JOB_ALIO_FALLBACK' }, urls: [
    'https://www.kosha.or.kr/kosha/intro/recruitment.do',
    'https://www.kosha.or.kr/', alioUrl('한국산업안전보건공단') ] },
  { org: '울산항만공사', accessTemplate: 'REDIRECT_OR_ENTRY', accessConfig: { platform: 'OFFICIAL_ENTRY' }, urls: [
    'https://www.upa.or.kr/portal/contents.do?mid=0405000000',
    'https://www.upa.or.kr/', alioUrl('울산항만공사') ] },
  { org: '한국전력공사', accessTemplate: 'DEDICATED_RECRUIT_SITE', accessConfig: { platform: 'KEPCO_RECRUIT' }, urls: [
    'https://www.kepco.co.kr/home/about/careers.do',
    'https://recruit.kepco.co.kr/', alioUrl('한국전력공사') ] },
  { org: '한국수력원자력', accessTemplate: 'DEDICATED_RECRUIT_SITE', accessConfig: { platform: 'KHNP_RECRUIT' }, urls: [
    'https://www.khnp.co.kr/recruit/',
    'https://www.khnp.co.kr/recruit/main/index.do', alioUrl('한국수력원자력') ] },
  { org: '울산도시공사', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.umca.co.kr/umca/bbs/list.do?bbsId=BBS_0000000000000002&mId=001001002000000000',
    'https://www.umca.co.kr/' ] },
  { org: '울산시설공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.uic.or.kr/notify/noti06.do',
    'https://uic.or.kr/notify/noti06.do',
    'https://uic.or.kr/recruit/main/mainPage.do',
    'https://uic.or.kr/' ] },
  { org: '울산남구도시관리공단', accessTemplate: 'COMMON_PLATFORM', accessConfig: { platform: 'INCRUIT' }, urls: [
    'https://recruit.incruit.com/uncmc/',
    'https://uncmc.incruit.com/',
    'https://www.ulsannamgu.go.kr/cop/bbs/selectBoardList.do?bbsId=hireNotice2',
    'https://www.uncmc.or.kr/' ] },
  { org: '울산북구시설관리공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.ubimc.or.kr/pageCont.do?menuNo=2040000',
    'https://ubimc.or.kr/pageCont.do?menuNo=2040000',
    'https://www.ubimc.or.kr/' ] },
  { org: '울주군시설관리공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.uljusiseol.or.kr/portal/bbs/selectArticleList.do?bbsId=BBSMSTR_000000000011' ] },
  { org: '울산정보산업진흥원', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.uipa.or.kr/webuser/recruit/list.html',
    'https://uipa.or.kr/webuser/recruit/list.html',
    'https://uipa.careerlink.kr/',
    'https://uipa.recruiter.co.kr/',
    'https://uipa.or.kr/' ] },
  { org: '울산테크노파크', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.utp.or.kr/board/board.php?bo_table=sub0603&menu_group=4&sno=0408',
    'https://www.utp.or.kr/' ] },
  { org: '울산경제일자리진흥원', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.ubpi.or.kr/sub/?mcode=0403080000',
    'https://www.ubpi.or.kr/' ] },
  { org: '울산문화관광재단', accessTemplate: 'API_BOARD', accessConfig: { platform: 'UCTF_API' }, urls: [
    'https://uctf.or.kr/board/employment',
    'https://www.uctf.or.kr/board/employment',
    'https://uctf.or.kr/' ] },
  { org: '울산복지가족진흥사회서비스원', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL_WITH_GOV_FALLBACK', transportChain: ['fetch', 'curl'] }, urls: [
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
  { org: '울주문화재단', accessTemplate: 'COMMON_PLATFORM', accessConfig: { platform: 'HUBST' }, urls: [
    'https://uljuculture.hubst.co.kr/applicantMain/goJobOpeningPage.do',
    'https://uljuculture.hubst.co.kr/',
    'https://uljuculture.hubst.co.kr/applicantMain/goNoticePage.do',
    'http://www.ucf.or.kr/',
    'https://www.ucf.or.kr/' ] },
];

export const SOURCES = RAW_SOURCES.map(({ org, urls, accessTemplate, accessConfig = {} }) => {
  const url = urls[0];
  const directBoard = !/^(?:https:\/\/)?(?:www\.)?[^/]+\/?$/i.test(url);
  return {
    org,
    accessTemplate,
    accessConfig: { ...accessConfig, primaryUrl: urls[0] },
    homepage: urls.find(item => /^https:\/\/[^/]+\/?$/.test(item)) || url,
    url,
    accessUrls: [...new Set(urls)],
    mode: 'direct',
    alio: false,
    detail: true,
    requireValidDetail: true,
    discoverListings: org === '울산문화관광재단' ? true : !directBoard,
    maxListingPages: 4
  };
});

export const SOURCE_REGISTRY_VERSION = '15.10-20-sources-list-templates';
