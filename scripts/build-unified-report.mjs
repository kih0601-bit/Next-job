import fs from 'node:fs/promises';
import { REPORT_SCHEMA_VERSION, sourceHealth, difficultyFor, priorityFor } from './lib/report-schema.mjs';

const path = 'data/pipeline-report.json';
const report = JSON.parse(await fs.readFile(path, 'utf8'));
const sources = (report.sources || []).map(source => ({
  ...source,
  health: sourceHealth(source),
  difficulty: difficultyFor(source),
  priority: priorityFor(source)
})).sort((a,b) => b.priority.score - a.priority.score || a.org.localeCompare(b.org, 'ko'));
const summary = {
  ...report.summary,
  healthy: sources.filter(s => s.health === 'healthy').length,
  degraded: sources.filter(s => s.health === 'degraded').length,
  failed: sources.filter(s => s.health === 'failed').length
};
const payload = {
  ...report,
  schemaVersion: REPORT_SCHEMA_VERSION,
  reportType: 'institution-centered-unified-pipeline-report',
  policy: '기관별 상태·원인·증거·수정지점·난이도·우선순위를 하나의 기준 리포트로 관리',
  summary,
  sources
};
await fs.writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log({ reportPath: path, schemaVersion: REPORT_SCHEMA_VERSION, summary });
