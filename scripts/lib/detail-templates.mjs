export const DETAIL_TEMPLATE_TYPES = Object.freeze({
  PATH_VIEW: 'PATH_VIEW',
  QUERY_ID: 'QUERY_ID',
  JAVASCRIPT_RECOVERED: 'JAVASCRIPT_RECOVERED',
  COMMON_PLATFORM: 'COMMON_PLATFORM',
  API_DETAIL: 'API_DETAIL',
  FORM_POST: 'FORM_POST',
  CUSTOM: 'CUSTOM'
});

export function classifyDetailTemplate(url = '', candidate = {}) {
  if (String(candidate?.detailRequest?.method || '').toUpperCase() === 'POST') return DETAIL_TEMPLATE_TYPES.FORM_POST;
  const value = String(url || '');
  if (/job\.alio\.go\.kr|incruit\.com|recruit/i.test(value)) return DETAIL_TEMPLATE_TYPES.COMMON_PLATFORM;
  if (/\/api\//i.test(value) || candidate.adapter === 'UCTF_API') return DETAIL_TEMPLATE_TYPES.API_DETAIL;
  if (/\b(?:idx|seq|no|nttId|bbsSeq|articleNo|postNo|dataSid|dataId|bcIdx|boardSeq|recruitNo)=/i.test(value)) return DETAIL_TEMPLATE_TYPES.QUERY_ID;
  if (/(?:\/view\/|\/detail\/|\/read\/|\/article\/|boardView|recruitView|noticeView)/i.test(value)) return DETAIL_TEMPLATE_TYPES.PATH_VIEW;
  if (candidate.recoveredFromJs || /javascript:/i.test(candidate.rawHref || '')) return DETAIL_TEMPLATE_TYPES.JAVASCRIPT_RECOVERED;
  return DETAIL_TEMPLATE_TYPES.CUSTOM;
}
