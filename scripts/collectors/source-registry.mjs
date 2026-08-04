const ALIO_BASE = 'https://job.alio.go.kr/mobile2021/recruit/recruit.do';

const RAW_SOURCES = [
  ['한국동서발전', 'https://www.ewp.co.kr/', 'alio'],
  ['한국석유공사', 'https://www.knoc.co.kr/', 'alio'],
  ['한국에너지공단', 'https://www.energy.or.kr/', 'alio'],
  ['한국산업인력공단', 'https://www.hrdkorea.or.kr/', 'alio'],
  ['근로복지공단', 'https://www.comwel.or.kr/', 'alio'],
  ['한국산업안전보건공단', 'https://www.kosha.or.kr/', 'alio'],
  ['울산항만공사', 'https://www.upa.or.kr/', 'alio'],
  ['한국전력공사', 'https://recruit.kepco.co.kr/', 'alio'],
  ['한국수력원자력', 'https://www.khnp.co.kr/recruit/', 'alio'],
  ['울산도시공사', 'https://www.umca.co.kr/', 'direct'],
  ['울산시설공단', 'https://uic.or.kr/notify/noti06.do', 'direct'],
  ['울산남구도시관리공단', 'https://www.uncmc.or.kr/', 'direct'],
  ['울산북구시설관리공단', 'https://www.ubimc.or.kr/', 'direct'],
  ['울주군시설관리공단', 'https://www.uljusiseol.or.kr/', 'direct'],
  ['울산정보산업진흥원', 'https://uipa.or.kr/webuser/recruit/list.html', 'direct'],
  ['울산테크노파크', 'https://www.utp.or.kr/', 'direct'],
  ['울산경제일자리진흥원', 'https://www.ubpi.or.kr/', 'direct'],
  ['울산연구원', 'https://www.uri.re.kr/', 'direct'],
  ['울산문화관광재단', 'https://www.uctf.or.kr/', 'direct'],
  ['울산복지가족진흥사회서비스원', 'https://www.ulsanpass.or.kr/', 'direct'],
  ['울주문화재단', 'https://www.ucf.or.kr/', 'direct'],
  ['울산광역시 타기관소식', 'https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004001003000000', 'direct']
];

function alioUrl(org) {
  const url = new URL(ALIO_BASE);
  url.searchParams.set('order', 'REG_DATE');
  url.searchParams.set('org_name', org);
  url.searchParams.set('search_yn', 'Y');
  return url.href;
}

export const SOURCES = RAW_SOURCES.map(([org, homepage, mode]) => ({
  org,
  homepage,
  url: mode === 'alio' ? alioUrl(org) : homepage,
  mode,
  alio: mode === 'alio',
  detail: true,
  requireValidDetail: true,
  discoverListings: mode === 'direct' && !/\/(?:list|contents|noti06)\b/i.test(homepage),
  maxListingPages: mode === 'direct' ? 4 : 1
}));

export const SOURCE_REGISTRY_VERSION = '11.2-public-source-registry';
