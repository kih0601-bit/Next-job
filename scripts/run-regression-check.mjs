import fs from 'node:fs/promises';

const diff = JSON.parse(await fs.readFile('data/pipeline-diff.json','utf8'));
let history = { sources: {} };
try { history = JSON.parse(await fs.readFile('data/pipeline-history.json','utf8')); } catch {}

const regressions = (diff.changes || []).filter(x => x.regressed);
let currentReport={sources:[]}; try { currentReport=JSON.parse(await fs.readFile('data/pipeline-report.json','utf8')); } catch {}
let stage8Quality={}; try { stage8Quality=JSON.parse(await fs.readFile('data/stage8-quality-report.json','utf8')); } catch {}

const currentYearActionableUnreadByOrg = new Map();
for (const row of stage8Quality?.samples?.actionableUnreadSources || []) {
  const org=String(row?.org||''); if(!org) continue;
  currentYearActionableUnreadByOrg.set(org,(currentYearActionableUnreadByOrg.get(org)||0)+1);
}
function currentYearImpactFor(row={}) {
  const stage=String(row?.regressionCause?.stage||row?.primaryCause?.stage||'');
  if(!['attachmentDownload','documentAnalysis'].includes(stage)) return {known:false,blocking:true,reason:'current-year scope not established for this stage'};
  const actionable=currentYearActionableUnreadByOrg.get(String(row.org||''))||0;
  if(actionable>0) return {known:true,blocking:true,reason:`Stage 8 current-scope unread source ${actionable}건 존재`};
  return {known:true,blocking:false,reason:'Stage 8 source audit에서 현재 실사용 actionable unread 0건; 관측 실패는 historical/informational 범위'};
}

function isTransientNetworkRegression(row = {}) {
  const cause = row.regressionCause || row.primaryCause || {};
  const text = `${cause.stage || ''} ${cause.code || ''} ${cause.reason || ''} ${JSON.stringify(cause.evidence || [])}`.toLowerCase();
  return /(?:http|access|connect|network|timeout|timed out|econnreset|econnrefused|dns|socket)/i.test(text)
    && !/(?:parser|parse|selector|document|attachment|list mismatch|count mismatch)/i.test(text);
}

function trailingAccessFailures(org) {
  const rows = history?.sources?.[org] || [];
  let failures = 0;
  let hadPriorSuccess = false;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]?.access === false) failures += 1;
    else if (rows[i]?.access === true) { hadPriorSuccess = true; break; }
    else break;
  }
  if (!hadPriorSuccess) hadPriorSuccess = rows.some(x => x?.access === true);
  return { failures, hadPriorSuccess };
}

const classified = regressions.map(row => {
  const prior = trailingAccessFailures(row.org);
  const consecutiveFailureCount = prior.failures + 1;
  const transientCandidate = isTransientNetworkRegression(row) && prior.hadPriorSuccess;
  const transientWatch = transientCandidate && consecutiveFailureCount <= 3;
  return {
    ...row,
    effectiveCause: row.regressionCause || row.primaryCause || null,
    regressionClass: transientWatch ? 'transient-watch' : 'actionable',
    transientWatch,
    consecutiveFailureCount: transientCandidate ? consecutiveFailureCount : 0,
    watchPolicy: transientWatch
      ? '최근 정상 Evidence가 있는 동일 네트워크성 실패는 3회 연속까지 관찰; 4회차 또는 실패 양상 변경 시 원인분석 대상으로 승격'
      : ''
  };
});


const already=new Set(classified.map(x=>x.org));
for (const src of currentReport.sources || []) {
  if (already.has(src.org) || src?.access?.recruitVerifyOk !== false) continue;
  const cause=src?.diagnosis?.primary || src?.primaryCause || {};
  if (!isTransientNetworkRegression({primaryCause:cause})) continue;
  const prior=trailingAccessFailures(src.org);
  if (!prior.hadPriorSuccess) continue;
  const count=prior.failures+1;
  classified.push({org:src.org,regressed:false,primaryCause:cause,regressionClass:count<=3?'transient-watch':'actionable',transientWatch:count<=3,consecutiveFailureCount:count,watchPolicy:count<=3?'최근 정상 Evidence가 있는 동일 네트워크성 실패는 3회 연속까지 관찰; 4회차 또는 실패 양상 변경 시 원인분석 대상으로 승격':''});
}

for (const row of classified) {
  if(row.transientWatch) continue;
  const impact=currentYearImpactFor(row);
  row.currentYearImpact=impact;
  if(impact.known && !impact.blocking) {
    row.regressionClass='historical-nonblocking';
    row.watchPolicy='과거/안내성 원문 실패는 누적 관찰하되 현재년도 Stage 8 완료를 차단하지 않음';
  }
}
const actionable = classified.filter(x => !x.transientWatch && x.regressionClass!=='historical-nonblocking');
const transient = classified.filter(x => x.transientWatch);
const historicalNonBlocking = classified.filter(x => x.regressionClass==='historical-nonblocking');
const payload = {
  generatedAt: new Date().toISOString(),
  mode: 'warning',
  passed: actionable.length === 0,
  regressionCount: classified.length,
  actionableRegressionCount: actionable.length,
  transientWatchCount: transient.length,
  historicalNonBlockingCount: historicalNonBlocking.length,
  currentYearScope: {
    rule: 'Attachment/Document regression은 Stage 8 source audit의 현재년도 actionable unread와 교차검증해 실제 현재 공고 영향만 blocker로 승격',
    actionableUnreadSources: Number(stage8Quality?.counts?.actionableUnreadSources||0)
  },
  regressions: classified
};
await fs.writeFile('data/regression-report.json', `${JSON.stringify(payload,null,2)}\n`);
if (actionable.length) console.warn(`ACTIONABLE_REGRESSION: ${actionable.map(x=>x.org).join(', ')}`);
if (transient.length) console.warn(`TRANSIENT_WATCH: ${transient.map(x=>`${x.org}(${x.consecutiveFailureCount}/3)`).join(', ')}`);
if (historicalNonBlocking.length) console.log(`HISTORICAL_NONBLOCKING: ${historicalNonBlocking.map(x=>x.org).join(', ')}`);
if (!classified.length) console.log('No regressions detected');
