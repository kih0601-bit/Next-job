import fs from 'node:fs';
const src=fs.readFileSync('scripts/collect.mjs','utf8');
for (const needle of ['stableRequestMaterial(candidate = {})','listText is deliberately excluded','cacheMissReasons','fingerprint-changed']) {
  if (!src.includes(needle)) throw new Error(`missing ${needle}`);
}
const block=src.match(/function candidateFingerprint\(candidate = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || '';
if (!block) throw new Error('candidateFingerprint block missing');
if (/candidate\.listText/.test(block)) throw new Error('volatile listText must not participate in cache fingerprint');
if (!/candidate\.title/.test(block) || !/stableRequestMaterial/.test(block)) throw new Error('stable change signals missing from cache fingerprint');
console.log({ok:true,test:'v96 stable cache fingerprint + miss diagnostics'});
