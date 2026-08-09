import crypto from 'node:crypto';

export const SAFE_COMPONENT_MAX_BYTES = 72;
export const SAFE_COMPONENT_MAX_CHARS = 36;

export function shortStableHash(value='') {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0,8);
}

export function safeFileComponent(value='', { fallback='item', maxBytes=SAFE_COMPONENT_MAX_BYTES, maxChars=SAFE_COMPONENT_MAX_CHARS }={}) {
  const cleaned = String(value || '').normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g,'_')
    .replace(/[^\p{L}\p{N}._-]+/gu,'_')
    .replace(/_+/g,'_').replace(/^[_ .-]+|[_ .-]+$/g,'') || fallback;
  if (cleaned.length <= maxChars && Buffer.byteLength(cleaned,'utf8') <= maxBytes) return cleaned;
  const hash = shortStableHash(cleaned);
  let prefix='';
  for (const ch of cleaned) {
    const candidate = prefix + ch;
    if (candidate.length > Math.max(8,maxChars-9) || Buffer.byteLength(candidate,'utf8') > Math.max(24,maxBytes-9)) break;
    prefix=candidate;
  }
  prefix=prefix.replace(/[._-]+$/,'') || fallback;
  return `${prefix}-${hash}`;
}
