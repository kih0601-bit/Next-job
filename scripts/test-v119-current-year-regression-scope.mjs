import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const q=JSON.parse(await fs.readFile('data/stage8-quality-report.json','utf8'));
assert.equal(Number(q?.counts?.actionableUnreadSources||0),0,'fixture expects no current actionable unread sources');
const run=spawnSync(process.execPath,['scripts/run-regression-check.mjs'],{encoding:'utf8'});
assert.equal(run.status,0,run.stderr||run.stdout);
const r=JSON.parse(await fs.readFile('data/regression-report.json','utf8'));
const target=new Set(['울산도시공사','울산정보산업진흥원','울산테크노파크','울주군시설관리공단','한국산업안전보건공단']);
for(const row of r.regressions.filter(x=>target.has(x.org))){
  assert.equal(row.currentYearImpact?.blocking,false,`${row.org} should be nonblocking for current-year Stage 8`);
  assert.equal(row.regressionClass,'historical-nonblocking');
}
assert.equal(r.actionableRegressionCount,0);
console.log('v119 current-year regression scope test passed');
