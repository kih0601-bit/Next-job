export const REPORT_SCHEMA_VERSION = '1.0.0';

export function sourceHealth(source = {}) {
  const access = Boolean(source.access?.ok);
  const full = access && Boolean(source.list?.ok) && Boolean(source.detail?.ok) && Boolean(source.attachment?.ok);
  return full ? 'healthy' : access ? 'degraded' : 'failed';
}

export function difficultyFor(source = {}) {
  const code = source.primaryCause?.code || '';
  if (/ACCESS_FORBIDDEN|TIMEOUT|API|DYNAMIC|JAVASCRIPT|POST/.test(code)) return { level: 3, label: '높음' };
  if (/DETAIL_|LIST_DETAIL_SIGNAL|LIST_URL|LIST_COUNTER|LIST_MISSING|LIST_EXTRA/.test(code)) return { level: 2, label: '보통' };
  return { level: 1, label: '낮음' };
}

export function priorityFor(source = {}) {
  const code = source.primaryCause?.code || '';
  const stage = source.primaryCause?.stage || '';
  const base = stage === 'access' ? 100 : stage === 'list' ? 80 : stage === 'detail' ? 60 : stage === 'attachment' ? 40 : 10;
  const urgency = /TIMEOUT|404|FORBIDDEN|MISSING|EXTRA|EMPTY/.test(code) ? 10 : 0;
  return { score: base + urgency, label: base >= 100 ? '최우선' : base >= 80 ? '높음' : base >= 60 ? '보통' : '낮음' };
}
