import assert from 'node:assert/strict';
import fs from 'node:fs';

const collect = fs.readFileSync('scripts/collect.mjs','utf8');

for (const token of ['STAGE8_SCHEMA_VERSION','STAGE8_VERSION','VACANCY_SPLITTER_VERSION','REQUIREMENT_SCHEMA_VERSION']) {
  assert.match(collect, new RegExp(`STAGE8_CACHE_ENGINE_SIGNATURE[\\s\\S]*${token}`), `Stage-8 cache engine signature must include ${token}`);
}
assert.match(collect, /cacheEntry\.outcome\?\.stage8CacheEngineSignature === STAGE8_CACHE_ENGINE_SIGNATURE/,
  'non-terminal cache reuse must require the current Stage-8 engine signature');
assert.match(collect, /stage8CacheEngineSignature: outcome\.stage8Posting && outcome\.stage8Input \? STAGE8_CACHE_ENGINE_SIGNATURE : ''/,
  'new cache entries must persist the Stage-8 engine signature');
assert.match(collect, /cacheEntry\.outcome\?\.stage8CacheEngineSignature !== STAGE8_CACHE_ENGINE_SIGNATURE/,
  'cache miss classification must invalidate old Stage-8 engine results');
assert.match(collect, /const terminal = terminalCacheOutcome\(cacheEntry\.outcome\)[\s\S]*if \(!terminal && !hasCurrentStage8\) return null;/,
  'v114 terminal cache optimization must remain intact');

// Prove the current failed-live baseline really contains stale Stage-8 cache records
// that this patch will invalidate instead of silently reusing.
const cache = JSON.parse(fs.readFileSync('data/collection-cache.json','utf8'))?.entries || {};
const benchmarkTitles = new Set([
  '2026년도 상반기 신규직원 채용 예비공고',
  '울산테크노파크 직원(전문직) 채용 공고(제2026-002호)',
  '울산테크노파크 직원(연구직) 채용 공고(제2026-001호)',
  '울산테크노파크 직원(위촉직) 채용 공고(제2026-008호)',
  '울산테크노파크 직원(위촉직) 채용 공고(제2026-006호)',
  '울산테크노파크 직원(위촉직) 채용 공고(제2026-003호)',
  '울산정보산업진흥원 2026년 5차 직원 채용 공고'
]);
const matched = Object.values(cache).filter(entry => benchmarkTitles.has(entry?.title) && entry?.outcome?.stage8Posting);
assert.ok(matched.length >= 7, 'failed-live baseline must contain cached Stage-8 benchmark postings');
assert.ok(matched.some(entry => !entry?.outcome?.stage8CacheEngineSignature),
  'failed-live baseline must demonstrate legacy cache entries without the engine signature');

const workflow = fs.readFileSync('.github/workflows/update-jobs.yml','utf8');
const template = fs.readFileSync('workflow-template/update-jobs.yml','utf8');
assert.equal(workflow, template, 'workflow template must remain byte-identical to executable workflow');
assert.match(workflow, /test-v118-stage8-cache-engine-invalidation\.mjs/,
  'Actions self-tests must include the v118 Stage-8 cache invalidation regression');

console.log('v118 Stage 8 cache engine invalidation tests passed');
