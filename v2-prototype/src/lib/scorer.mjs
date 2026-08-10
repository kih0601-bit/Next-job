const DIMS = ['education','experience','licenses','age','majorJob','region','legalOther'];
const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');

export function scoreCase(truth, pred) {
  const t = truth.recruitmentUnits || [], p = pred.recruitmentUnits || [];
  const unitCountExact = t.length === p.length;
  const pBy = new Map(p.map(x => [norm(x.unitName), x]));
  let unitMatched=0, requiredTotal=0, requiredHit=0, falseRequired=0, evidenceRequiredMissing=0, dimTotal=0, dimExact=0;
  for (const tu of t) {
    const pu = pBy.get(norm(tu.unitName));
    if (!pu) continue;
    unitMatched++;
    for (const d of DIMS) {
      dimTotal++;
      const tr = tu.requirements?.[d], pr = pu.requirements?.[d];
      if (sameReq(tr,pr)) dimExact++;
      if (tr?.status === 'required') {
        requiredTotal++;
        if (pr?.status === 'required' && norm(pr.value) === norm(tr.value) && pr.logic === tr.logic) requiredHit++;
      }
      if (pr?.status === 'required' && tr?.status !== 'required') falseRequired++;
      if (pr?.status === 'required' && !(pr.evidenceIds||[]).length) evidenceRequiredMissing++;
    }
  }
  return {
    unitCountExact,
    unitNameRecall: t.length ? unitMatched/t.length : 1,
    dimensionExact: dimTotal ? dimExact/dimTotal : 1,
    requiredRecall: requiredTotal ? requiredHit/requiredTotal : 1,
    falseRequired,
    evidenceRequiredMissing
  };
}
function sameReq(a,b) { return !!a && !!b && a.status===b.status && norm(a.value)===norm(b.value) && a.logic===b.logic; }

export function aggregate(scores) {
  const n=scores.length||1;
  return {
    cases:scores.length,
    unitCountExactRate:scores.filter(s=>s.unitCountExact).length/n,
    unitNameRecall:avg(scores,'unitNameRecall'),
    dimensionExact:avg(scores,'dimensionExact'),
    requiredRecall:avg(scores,'requiredRecall'),
    falseRequired:scores.reduce((a,s)=>a+s.falseRequired,0),
    evidenceRequiredMissing:scores.reduce((a,s)=>a+s.evidenceRequiredMissing,0)
  };
}
function avg(xs,k){return xs.length?xs.reduce((a,x)=>a+x[k],0)/xs.length:0;}
