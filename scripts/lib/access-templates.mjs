export const ACCESS_TEMPLATE_TYPES = Object.freeze({
  DIRECT_BOARD: 'DIRECT_BOARD',
  COMMON_PLATFORM: 'COMMON_PLATFORM',
  DEDICATED_RECRUIT_SITE: 'DEDICATED_RECRUIT_SITE',
  API_BOARD: 'API_BOARD',
  REDIRECT_OR_ENTRY: 'REDIRECT_OR_ENTRY',
  RESTRICTED_CUSTOM: 'RESTRICTED_CUSTOM'
});

export const ACCESS_TEMPLATES = Object.freeze({
  DIRECT_BOARD: Object.freeze({
    label: '공식 채용게시판 직접 접속',
    transportChain: ['fetch'],
    collectorTransportChain: ['node-browser', 'node-simple', 'curl'],
    description: '기관 공식 홈페이지 안의 채용 목록 URL을 직접 호출하고 채용게시판 구조를 검증한다.'
  }),
  COMMON_PLATFORM: Object.freeze({
    label: '공통 채용 플랫폼',
    transportChain: ['fetch'],
    collectorTransportChain: ['node-browser', 'node-simple', 'curl'],
    description: 'Incruit·JOB-ALIO·Hubst 등 공통 채용 플랫폼에서 기관 식별값과 채용 목록 구조를 함께 검증한다.'
  }),
  DEDICATED_RECRUIT_SITE: Object.freeze({
    label: '별도 채용 전용 사이트',
    transportChain: ['fetch'],
    collectorTransportChain: ['node-browser', 'node-simple', 'curl'],
    description: '기관 본 홈페이지와 분리된 채용 전용 사이트 또는 채용 전용 영역으로 진입한다.'
  }),
  API_BOARD: Object.freeze({
    label: 'API/AJAX 기반 채용게시판',
    transportChain: ['fetch'],
    collectorTransportChain: ['node-browser', 'node-simple', 'curl'],
    description: '접속 단계는 공식 채용 화면을 검증하고 목록 단계에서는 기관 API/JSON Adapter를 재사용한다.'
  }),
  REDIRECT_OR_ENTRY: Object.freeze({
    label: '진입/리다이렉트형 채용게시판',
    transportChain: ['fetch'],
    collectorTransportChain: ['node-browser', 'node-simple', 'curl'],
    description: '채용 안내 진입 페이지 또는 리다이렉트를 거쳐 실제 목록 URL에 도달하는 유형이다.'
  }),
  RESTRICTED_CUSTOM: Object.freeze({
    label: '접근 제한/기관 전용',
    transportChain: ['fetch', 'curl'],
    collectorTransportChain: ['node-browser', 'node-simple', 'curl', 'curl-resolved'],
    description: '일반 Node fetch가 차단되거나 특수 접근이 필요한 기관에 한해 제한적으로 전용 transport fallback을 사용한다.'
  })
});

export function getAccessTemplate(source = {}) {
  const type = source.accessTemplate || ACCESS_TEMPLATE_TYPES.DIRECT_BOARD;
  const definition = ACCESS_TEMPLATES[type];
  if (!definition) throw new Error(`Unknown access template: ${type} (${source.org || 'unknown'})`);
  return { type, ...definition };
}

export function buildAccessPlan(source = {}) {
  const template = getAccessTemplate(source);
  const urls = [...new Set(source.accessUrls || [source.url].filter(Boolean))];
  return urls.map((url, accessPriority) => ({
    url,
    accessPriority,
    template: template.type,
    templateLabel: template.label,
    requestProfile: source.accessConfig?.requestProfile || 'browser-default'
  }));
}

export function getTransportChain(source = {}) {
  const template = getAccessTemplate(source);
  return source.accessConfig?.transportChain || template.transportChain;
}


export function getCollectorTransportChain(source = {}) {
  const template = getAccessTemplate(source);
  return source.accessConfig?.collectorTransportChain || template.collectorTransportChain || ['node-browser', 'node-simple', 'curl'];
}

export function accessTemplateSummary(source = {}) {
  const template = getAccessTemplate(source);
  return {
    type: template.type,
    label: template.label,
    description: template.description,
    primaryUrl: source.accessUrls?.[0] || source.url || '',
    platform: source.accessConfig?.platform || '',
    requestProfile: source.accessConfig?.requestProfile || 'browser-default',
    transportChain: getTransportChain(source),
    collectorTransportChain: getCollectorTransportChain(source)
  };
}

export function validateAccessTemplateSource(source = {}) {
  const template = getAccessTemplate(source);
  if (!source.org) throw new Error('access template source requires org');
  if (!(source.accessUrls || []).length && !source.url) throw new Error(`${source.org}: access URL required`);
  if (!Array.isArray(template.transportChain) || !template.transportChain.length) throw new Error(`${source.org}: transport chain required`);
  return true;
}
