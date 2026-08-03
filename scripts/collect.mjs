import fs from 'node:fs/promises';
import { collectAlio } from './collectors/alio.mjs';
import { normalizeKey } from './lib/utils.mjs';

const modules = [
  collectAlio
];

const settled = await Promise.allSettled(
  modules.map((collector) => collector())
);

const jobs = [];
const sources = [];
const seen = new Set();

for (const result of settled) {
  if (result.status !== 'fulfilled') continue;

  sources.push(...result.value.sources);

  for (const job of result.value.jobs) {
    const key = normalizeKey(job);
    if (seen.has(key)) continue;

    seen.add(key);
    jobs.push(job);
  }
}

jobs.sort((a, b) => {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.org.localeCompare(b.org, 'ko');
});

const payload = {
  version: '7.0-modular-step1',
  updatedAt: new Date().toISOString(),
  jobs: jobs.slice(0, 250),
  sources,
  stats: {
    sourceCount: sources.length,
    success: sources.filter((source) => source.ok).length,
    total: jobs.length,
    highSchoolSuitable: jobs.filter((job) => job.eligibility === '고졸 가능').length,
    reviewNeeded: jobs.filter((job) => job.eligibility === '학력 확인 필요').length
  },
  note: '1단계: 중앙 공공기관은 ALIO 데이터 소스로만 수집합니다.'
};

await fs.writeFile(
  'data/jobs.json',
  `${JSON.stringify(payload, null, 2)}\n`,
  'utf8'
);

console.log(JSON.stringify(payload.stats, null, 2));
