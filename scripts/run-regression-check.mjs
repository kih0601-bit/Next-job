import fs from 'node:fs/promises';
const diff = JSON.parse(await fs.readFile('data/pipeline-diff.json','utf8'));
const regressions = (diff.changes || []).filter(x => x.regressed);
const payload = { generatedAt: new Date().toISOString(), mode: 'warning', passed: regressions.length === 0, regressionCount: regressions.length, regressions };
await fs.writeFile('data/regression-report.json', `${JSON.stringify(payload,null,2)}\n`);
if (regressions.length) console.warn(`REGRESSION_DETECTED: ${regressions.map(x=>x.org).join(', ')}`);
else console.log('No regressions detected');
