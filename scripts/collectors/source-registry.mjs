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
  { org: '근로복지공단', accessTemplate: 'COMMON_PLATFORM', accessConfig: { platform: 'SARAMIN_CURRENT_CAMPAIGN', discoverListings: true }, urls: [
    'https://comwel.saramin.co.kr/service/comwel/index.asp',
    'https://comwel.saramin.co.kr/',
    'https://comwel.incruit.com/index_main.asp',
    'https://www.comwel.or.kr/comwel/noti/recruit.jsp',
    'https://www.comwel.or.kr/', alioUrl('근로복지공단') ] },
  { org: '한국산업안전보건공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL_SPA+JOB_ALIO_FALLBACK', officialBoardPath: '/notification/jobncontract/job', officialDetailPattern: '/notification/jobncontract/job/jobdata?bbsId=B2025021400005&pstNo=' }, urls: [
    'https://www.kosha.or.kr/notification/jobncontract/job',
    'https://www.kosha.or.kr/kosha/intro/recruitment.do',
    'https://www.kosha.or.kr/', alioUrl('한국산업안전보건공단') ] },
  { org: '울산항만공사', accessTemplate: 'REDIRECT_OR_ENTRY', accessConfig: { platform: 'OFFICIAL_ENTRY' }, urls: [
    'https://www.upa.or.kr/portal/contents.do?mid=0405000000',
    'https://www.upa.or.kr/', alioUrl('울산항만공사') ] },
  { org: '한국전력공사', accessTemplate: 'DEDICATED_RECRUIT_SITE', accessConfig: { platform: 'KEPCO_RECRUIT' }, urls: [
    'https://recruit.kepco.co.kr:444/frt/frt0001/list.do',
    'https://recruit.kepco.co.kr:444/frt/main.do',
    'https://recruit.kepco.co.kr/',
    'https://www.kepco.co.kr/home/about/careers.do', alioUrl('한국전력공사') ] },
  { org: '한국수력원자력', accessTemplate: 'DEDICATED_RECRUIT_SITE', accessConfig: { platform: 'KHNP_RECRUIT' }, urls: [
    'https://www.khnp.co.kr/recruit/rj00/RJ10100.do?mid=MI000000000000000484',
    'https://www.khnp.co.kr/recruit/main/index.do',
    'https://www.khnp.co.kr/recruit/', alioUrl('한국수력원자력') ] },
  { org: '울산도시공사', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.umca.co.kr/umca/bbs/list.do?bbsId=BBS_0000000000000002&mId=001001002000000000',
    'https://www.umca.co.kr/' ] },
  { org: '울산시설공단', accessTemplate: 'DIRECT_BOARD', accessConfig: { platform: 'OFFICIAL' }, urls: [
    'https://www.uic.or.kr/notify/noti06.do',
    'https://uic.or.kr/notify/noti06.do',
    'https://uic.or.kr/recruit/main/mainPage.do',
    'https://uic.or.kr/' ] },
  { org: '울산남구도시관리공단', accessTemplate: 'COMMON_PLATFORM', accessConfig: { platform: 'INCRUIT', verifiedEmptyText: '등록된 정보가 없습니다' }, urls: [
    'https://recruit.incruit.com/uncmc/job/',
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
  { org: '울산복지가족진흥사회서비스원', accessTemplate: 'DIRECT_BOARD', accessConfig: {
    platform: 'OFFICIAL',
    transportChain: ['fetch', 'curl-resolved'],
    collectorTransportChain: ['node-browser', 'curl-resolved'],
    accessTimeoutMs: 9000,
    accessAttemptsPerUrl: 1,
    skipHostAfterConnectTimeout: true,
    maxProbeAccessUrls: 3
  }, urls: [
    // Institution-owned recruitment boards only. v84 proved that the former Ulsan-city
    // "타기관 소식" fallback could be parsed as this institution and create a silent success.
    // Accuracy takes precedence over availability: if these official boards are unreachable,
    // the source must report access failure instead of substituting another institution feed.
    'https://wfps.or.kr/webuser/employment/list.html',
    'https://uwfdi.re.kr/webuser/employment/list.html',
    'https://www.wfps.or.kr/webuser/employment/list.html' ] },
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
  const delegated = /(?:INCRUIT|SARAMIN|HUBST)/i.test(String(accessConfig.platform || ''));
  const sourceProvenance = delegated
    ? { category: 'official-delegated-platform', verificationStatus: 'unknown', reason: '공식 위탁 채용플랫폼으로 구성됨 · 기관→위탁플랫폼 연결 근거를 별도 evidence로 확정 필요' }
    : { category: 'institution-owned-official-source', verificationStatus: 'verified', reason: '기관 소유 공식 도메인의 채용 Source로 구성·채용게시판 도달 검증' };
  return {
    org,
    sourceProvenance,
    accessTemplate,
    accessConfig: { ...accessConfig, primaryUrl: urls[0] },
    homepage: urls.find(item => /^https:\/\/[^/]+\/?$/.test(item)) || url,
    url,
    accessUrls: [...new Set(urls)],
    mode: 'direct',
    alio: false,
    detail: true,
    requireValidDetail: true,
    discoverListings: typeof accessConfig.discoverListings === 'boolean'
      ? accessConfig.discoverListings
      : (org === '울산문화관광재단' ? true : !directBoard),
    maxListingPages: 4
  };
});

export const SOURCE_REGISTRY_VERSION = '15.15-pipeline-governance';
