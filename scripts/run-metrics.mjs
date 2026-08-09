import fs from 'node:fs/promises';

const METRICS_PATH = 'data/run-metrics.json';
const REPORT_PATH = 'data/pipeline-report.json';
const COLLECT_METRICS_PATH = 'data/collect-metrics.json';
const command = process.argv[2] || 'finalize';
const label = process.argv[3] || '';
const nowIso = () => new Date().toISOString();

function baseRecord() {
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const runId = process.env.GITHUB_RUN_ID || '';
  return {
    schemaVersion: '1.0.0',
    purpose: 'Actions 실행정보를 ZIP 자체에 보존해 별도 실행 링크/스크린샷 없이 브리핑 가능하게 함',
    repository: repo,
    workflow: process.env.GITHUB_WORKFLOW || '',
    job: process.env.GITHUB_JOB || '',
    runId,
    runNumber: process.env.GITHUB_RUN_NUMBER || '',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || '',
    runUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : '',
    commitSha: process.env.GITHUB_SHA || '',
    eventName: process.env.GITHUB_EVENT_NAME || '',
    metricsInitializedAt: nowIso(),
    githubRunStartedAt: '',
    marks: {},
    durations: {},
    finalizedAt: '',
    observedDurationMs: null,
    note: 'observedDurationMs는 GitHub run_started_at부터 metrics finalize까지이며 artifact upload/commit/runner cleanup은 제외될 수 있음. runUrl/runId로 GitHub 총 실행시간 교차검증 가능.'
  };
}
async function readMetrics() {
  try { return JSON.parse(await fs.readFile(METRICS_PATH, 'utf8')); } catch { return baseRecord(); }
}
async function fetchRunMeta() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const runId = process.env.GITHUB_RUN_ID || '';
  const token = process.env.GITHUB_TOKEN || '';
  if (!repo || !runId || !token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    if (!res.ok) return null;
    const data = await res.json();
    return { runStartedAt: data.run_started_at || data.created_at || '', htmlUrl: data.html_url || '', status: data.status || '', conclusion: data.conclusion || '' };
  } catch { return null; }
}
function computeDurations(marks = {}) {
  const pairs = ['probe','collect','unifiedReport','verification'];
  const out = {};
  for (const key of pairs) {
    const a = marks[`${key}-start`], b = marks[`${key}-end`];
    if (a && b) out[key] = Math.max(0, new Date(b) - new Date(a));
  }
  return out;
}
async function writeMetrics(metrics) { await fs.mkdir('data', { recursive: true }); await fs.writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8'); }

let metrics = await readMetrics();
if (command === 'start') {
  metrics = baseRecord();
  const meta = await fetchRunMeta();
  if (meta?.runStartedAt) metrics.githubRunStartedAt = meta.runStartedAt;
  if (meta?.htmlUrl) metrics.runUrl = meta.htmlUrl;
  await writeMetrics(metrics);
  console.log({ runMetrics: 'started', runId: metrics.runId, runUrl: metrics.runUrl, githubRunStartedAt: metrics.githubRunStartedAt });
} else if (command === 'mark') {
  if (!label) throw new Error('mark label required');
  metrics.marks = metrics.marks || {};
  metrics.marks[label] = nowIso();
  metrics.durations = computeDurations(metrics.marks);
  await writeMetrics(metrics);
  console.log({ runMetrics: 'marked', label, at: metrics.marks[label] });
} else if (command === 'finalize') {
  const meta = await fetchRunMeta();
  if (meta?.runStartedAt) metrics.githubRunStartedAt = meta.runStartedAt;
  if (meta?.htmlUrl) metrics.runUrl = meta.htmlUrl;
  metrics.githubStatusAtFinalize = meta?.status || '';
  metrics.githubConclusionAtFinalize = meta?.conclusion || '';
  metrics.finalizedAt = nowIso();
  metrics.durations = computeDurations(metrics.marks || {});
  try {
    const collectMetrics = JSON.parse(await fs.readFile(COLLECT_METRICS_PATH, 'utf8'));
    metrics.collect = collectMetrics;
    metrics.collectByOrg = Array.isArray(collectMetrics.institutions) ? collectMetrics.institutions : [];
  } catch {}
  const start = metrics.githubRunStartedAt || metrics.metricsInitializedAt;
  metrics.observedDurationMs = start ? Math.max(0, new Date(metrics.finalizedAt) - new Date(start)) : null;
  await writeMetrics(metrics);
  try {
    const report = JSON.parse(await fs.readFile(REPORT_PATH, 'utf8'));
    report.runMetrics = metrics;
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch {}
  console.log({ runMetrics: 'finalized', runId: metrics.runId, runUrl: metrics.runUrl, observedDurationMs: metrics.observedDurationMs, durations: metrics.durations });
} else {
  throw new Error(`unknown run-metrics command: ${command}`);
}
