import fs from 'node:fs/promises';
import path from 'node:path';

const productRoot = path.resolve(process.env.NEXT_JOB_PRODUCT_ROOT ?? 'C:/Users/Administrator/Desktop/NEXT-JOB/worktrees/v6-semantic-resolver-recovery-v1/artifacts/fresh-semantic/next-job-posting-production-pass-v1');
const targetRoot = path.resolve('data');
const sourceFiles = (await fs.readdir(path.join(productRoot, 'parent-postings'))).filter((name) => name.endsWith('.json'));
const jobs = [];
for (const name of sourceFiles) {
  const product = JSON.parse(await fs.readFile(path.join(productRoot, 'parent-postings', name), 'utf8'));
  if (product.terminalState !== 'NEXT_JOB_POSTING_READY') continue;
  const units = product.recruitmentUnits ?? [];
  const conditions = Object.fromEntries(Object.entries(product.conditions ?? {}).map(([category, items]) => [category, (items ?? []).map((item) => ({ conditionId: item.conditionId, text: item.text ?? null, operator: item.operator ?? null, recruitmentUnitId: item.recruitmentUnitId ?? null }))]));
  const source = product.posting ?? {};
  const posting = source.posting ?? {};
  const regions = Array.isArray(source.location?.regionRaw) ? source.location.regionRaw : [];
  const required = conditions.REQUIRED ?? [];
  jobs.push({
    id: product.parentPostingId,
    org: source.institution?.nameRaw ?? '정보 없음',
    title: posting.title ?? '제목 정보 없음',
    vacancyName: units.length === 1 ? units[0].label : `${units[0]?.label ?? '모집단위'} 외 ${Math.max(units.length - 1, 0)}개`,
    link: source.source?.sourceUrl ?? null,
    eligibilityStatus: 'eligible',
    eligibilityReasons: ['Current Product Output에서 READY로 확정된 Recruitment Unit 포함'],
    dimensions: { education: { status: 'product', reason: required.length ? 'Product Output REQUIRED 조건을 확인하세요.' : '구조화된 REQUIRED 조건 없음', required: required.map((item) => item.text).filter(Boolean), evidence: [] }, licenses: { status: 'product', reason: 'Product Output 조건 참조', required: [], evidence: [] }, experience: { status: 'product', reason: 'Product Output 조건 참조', required: [], evidence: [] }, age: { status: 'product', reason: 'Product Output 조건 참조', required: [], evidence: [] }, major: { status: 'product', reason: 'Product Output 조건 참조', required: [], evidence: [] }, legalOrIdentity: { status: 'product', reason: 'Product Output 조건 참조', required: [], evidence: [] }, other: { status: 'product', reason: 'Product Output 조건 참조', required: [], evidence: [] } },
    searchFacets: { region: regions, organization: source.institution?.nameRaw ? [source.institution.nameRaw] : [], jobCategory: [], employmentType: posting.employmentTypeRaw ? [posting.employmentTypeRaw] : [] },
    sourceHints: { years: [], closed: false },
    nextJobProduct: { contract: 'nextjob-posting-2', postingId: product.postingId, parentPostingId: product.parentPostingId, sourceUrl: source.source?.sourceUrl ?? null, ready: true, recruitmentUnits: units.map((unit) => ({ unitId: unit.unitId, ready: true, label: unit.label ?? null, headcount: unit.headcount ?? null, location: source.location?.regionRaw ?? [], employmentType: posting.employmentTypeRaw ?? null, conditions: Object.fromEntries(Object.entries(conditions).map(([category, items]) => [category, items.filter((item) => item.recruitmentUnitId === unit.unitId)])) })), conditions }
  });
}
jobs.sort((a, b) => String(a.org).localeCompare(String(b.org), 'ko') || String(a.title).localeCompare(String(b.title), 'ko'));
const output = { stage: 'next-job-posting-product-adapter-v1', schemaVersion: 'nextjob-posting-2', version: `product-${new Date().toISOString()}`, updatedAt: new Date().toISOString(), trust: { source: 'NEXT-JOB Product Output', readyOnly: true, blockedExcluded: true }, stats: { success: jobs.length, sourceCount: jobs.length, parentPostingCount: jobs.length, recruitmentUnitCount: jobs.reduce((total, job) => total + job.nextJobProduct.recruitmentUnits.length, 0) }, jobs };
await fs.writeFile(path.join(targetRoot, 'jobs.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output.stats, null, 2));
