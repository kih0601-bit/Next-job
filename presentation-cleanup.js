(() => {
  let productJobs = [];
  fetch('data/jobs.json').then((response) => response.json()).then((data) => { productJobs = data.jobs || []; });
  const labels = { REQUIRED: '지원 필수조건', PREFERRED: '우대사항', WORK_CONDITION: '근무조건', APPLICANT_CHECK: '지원 전 확인사항' };
  const escText = (value) => esc(value || '정보 없음');
  const replacePresentationLabels = () => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode); nodes.forEach((node) => { if (node.nodeValue.includes('지원 가능')) node.nodeValue = node.nodeValue.replaceAll('지원 가능', '공고 확인'); }); };
  replacePresentationLabels();
  setTimeout(replacePresentationLabels, 1200);
  new MutationObserver(replacePresentationLabels).observe(document.body, { childList: true, subtree: true });
  window.openDetail = (key) => {
    const job = productJobs.find((item) => String(item.id) === String(key));
    if (!job) return;
    const product = job.nextJobProduct || {};
    const units = product.recruitmentUnits || [];
    const unitHtml = units.map((unit, index) => `<details class="product-unit" ${index === 0 ? 'open' : ''}><summary><div class="unit-kicker">모집분야 ${index + 1}</div><div class="unit-title">${escText(unit.label)}</div>${units.length > 1 ? `<div class="unit-count">전체 모집분야 ${units.length}개</div>` : ''}</summary>${Object.keys(labels).map((category) => { const items = unit.conditions?.[category] || []; return items.length ? `<div class="condition-group"><h4>${labels[category]}</h4>${items.map((item) => `<p class="condition-text">${escText(item.text)}</p>`).join('')}</div>` : ''; }).join('')}</details>`).join('');
    detail.innerHTML = `<div class="detail-status ok">✓ 공고 확인 가능</div><div class="org">${escText(job.org)}</div><h2 class="detail-heading">${escText(job.title)}</h2><div class="detail-subtitle">${units.length ? `모집분야 ${units.length}개` : ''}</div><h2 class="detail-heading">모집분야별 지원조건</h2><p class="detail-subtitle">모집분야별 조건은 각각 따로 표시됩니다.</p>${unitHtml || '<div class="empty">모집분야 정보가 없습니다.</div>'}<div class="actions"><button data-close>닫기</button><a href="${escText(product.sourceUrl || job.link)}" target="_blank" rel="noopener">원문 보기</a></div>`;
    detailSheet.classList.add('open');
    detail.querySelector('[data-close]').onclick = () => detailSheet.classList.remove('open');
  };
  document.addEventListener('click', (event) => {
    const article = event.target.closest('article');
    if (!article || article.classList.contains('ru-card') || event.target.closest('button')) return;
    const job = productJobs.find((item) => article.textContent.includes(item.org) && article.textContent.includes(item.title));
    if (!job) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.openDetail(job.id);
  }, true);
})();
