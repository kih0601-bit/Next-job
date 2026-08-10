const DIM = ['education','experience','licenses','age','majorJob','region','legalOther'];

export function validateExtraction(x) {
  const errors = [], warnings = [];
  if (!x || !Array.isArray(x.recruitmentUnits)) errors.push('recruitmentUnits missing');
  if (x?.postingType !== 'recruitment' && x?.recruitmentUnits?.length) errors.push('non-recruitment posting must not create recruitmentUnits');
  for (const [i,u] of (x?.recruitmentUnits||[]).entries()) {
    if (!u.unitName || /^\*+$/.test(u.unitName) || /데이터\s*테이블/i.test(u.unitName)) errors.push(`unit[${i}] invalid unitName`);
    const evidenceIds = new Set((u.evidence||[]).map(e => e.id));
    for (const d of DIM) {
      const r = u.requirements?.[d];
      if (!r) { errors.push(`unit[${i}].${d} missing`); continue; }
      if (r.status === 'required' && (!r.evidenceIds?.length || r.evidenceIds.some(id => !evidenceIds.has(id)))) errors.push(`unit[${i}].${d} required without valid evidence`);
      if (r.status === 'none' && !r.evidenceIds?.length) warnings.push(`unit[${i}].${d} none without explicit evidence; unknown may be safer`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
