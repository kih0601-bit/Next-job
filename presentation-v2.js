(() => {
  const labels = { REQUIRED: '지원 필수조건', PREFERRED: '우대사항', WORK_CONDITION: '근무조건', APPLICANT_CHECK: '지원 전 확인사항' };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const state = { jobs: [], query: '' };
  const detailSheet = document.getElementById('detailSheet');
  const detail = document.getElementById('detail');
  const go = (screen) => document.querySelector(`[data-nav="${screen}"]`)?.click();
  const units = () => state.jobs.flatMap((job) => (job.nextJobProduct?.recruitmentUnits || []).filter((unit) => unit.ready === true).map((unit) => ({ job, unit })));
  const sourceUrl = (job) => job.nextJobProduct?.sourceUrl || job.link;
  const metadata = (job, unit) => [
    ...(unit.location || job.searchFacets?.region || []).slice(0, 1),
    unit.employmentType,
    unit.headcount ? `모집 ${unit.headcount}명` : null,
  ].filter(Boolean).map((value) => `<span class="tag">${escapeHtml(value)}</span>`).join('');
  const card = ({ job, unit }) => `<article class="job-card ru-card" data-parent-id="${escapeHtml(job.id)}" data-ru-id="${escapeHtml(unit.unitId)}"><div class="ru-card-kicker">모집분야</div><div class="org">${escapeHtml(job.org)}</div><div class="vacancy">${escapeHtml(unit.label || job.vacancyName || job.title)}</div><div class="posting-title">${escapeHtml(job.title)}</div><div class="meta">${metadata(job, unit)}<span class="tag blue">공고 확인</span></div></article>`;
  const renderCards = () => {
    const query = state.query.trim().toLowerCase();
    const list = units().filter(({ job, unit }) => !query || [job.org, job.title, job.vacancyName, unit.label].some((value) => String(value || '').toLowerCase().includes(query)));
    document.getElementById('searchList').innerHTML = list.map(card).join('') || '<div class="empty">조건에 맞는 모집분야가 없습니다.</div>';
  };
  const conditionSections = (unit) => Object.entries(labels).map(([key, label]) => {
    const items = unit.conditions?.[key] || [];
    if (!items.length) return '';
    return `<details class="v2-condition"><summary>${label}<span>${items.length}개</span></summary><div class="condition-text">${items.map((item) => `<p>${escapeHtml(item.text)}</p>`).join('')}</div></details>`;
  }).join('');
  const openUnit = (job, unit) => {
    detail.innerHTML = `<div class="org">${escapeHtml(job.org)}</div><h2 class="detail-heading">${escapeHtml(unit.label || job.vacancyName || job.title)}</h2><div class="posting-title">${escapeHtml(job.title)}</div><div class="detail-meta">${metadata(job, unit)}</div><h3 class="detail-section-title">지원조건</h3>${conditionSections(unit)}<div class="actions"><button data-close>닫기</button><a href="${escapeHtml(sourceUrl(job))}" target="_blank" rel="noopener">원문 보기</a></div>`;
    detailSheet.classList.add('open');
    detail.querySelector('[data-close]').onclick = () => detailSheet.classList.remove('open');
  };
  const renderInstitutions = () => {
    const names = [...new Set(state.jobs.map((job) => job.org).filter(Boolean))].sort();
    const list = document.getElementById('institutionList');
    list.innerHTML = names.map((name) => `<div class="institution"><strong>${escapeHtml(name)}</strong><button class="heart" data-institution="${escapeHtml(name)}">♥</button></div>`).join('');
    list.querySelectorAll('[data-institution]').forEach((button) => button.onclick = () => { go('search'); document.getElementById('q').value = button.dataset.institution; state.query = button.dataset.institution; renderCards(); });
  };
  const setupHome = () => {
    const metric = document.querySelector('.metric.green span');
    if (metric) metric.textContent = '공고 확인';
    const recommendation = document.getElementById('recommended');
    if (recommendation) recommendation.innerHTML = '<div class="empty recommendation-empty"><strong>맞춤 추천 공고가 아직 없어요</strong><br><span>내 조건을 설정하면 맞는 공고를 찾을 수 있어요.</span><button class="primary-action" data-settings>내 조건 설정하기</button></div>';
    document.getElementById('specUpHome')?.replaceChildren();
    document.querySelector('[data-settings]')?.addEventListener('click', () => go('settings'));
  };
  const setupSearch = () => {
    document.querySelector('.default-banner')?.remove();
    document.querySelector('#search .chips')?.remove();
    document.querySelector('#search .tabs')?.remove();
    const input = document.getElementById('q');
    input.oninput = () => { state.query = input.value; renderCards(); };
  };
  const setupSettings = () => {
    const settings = document.getElementById('settings');
    settings.querySelector('.sub')?.remove();
    settings.querySelectorAll('.settings-card').forEach((card) => {
      card.querySelectorAll('.field').forEach((field) => {
        const label = field.querySelector('label');
        if (!label) return;
        const body = [...field.children].find((child) => child !== label);
        if (!body) return;
        const row = document.createElement('button');
        row.className = 'settings-row';
        row.type = 'button';
        row.innerHTML = `<span>${escapeHtml(label.textContent)}</span><b>선택하기 ›</b>`;
        field.insertBefore(row, label);
        label.hidden = true;
        body.hidden = true;
        row.onclick = () => { body.hidden = !body.hidden; row.classList.toggle('expanded', !body.hidden); };
      });
    });
    const region = settings.querySelector('[data-setting="region"]');
    if (region) { region.innerHTML = '<button data-value="전체">전체</button><button data-value="서울">서울</button><button data-value="부산">부산</button><button data-value="울산">울산</button><button data-value="대구">대구</button><button data-value="인천">인천</button><button data-value="광주">광주</button><button data-value="대전">대전</button><button data-value="경기">경기</button><button data-value="강원">강원</button><button data-value="충북">충북</button><button data-value="충남">충남</button><button data-value="전북">전북</button><button data-value="전남">전남</button><button data-value="경북">경북</button><button data-value="경남">경남</button><button data-value="제주">제주</button>'; }
  };
  document.addEventListener('click', (event) => {
    const article = event.target.closest('.ru-card');
    if (!article) return;
    const item = units().find(({ job, unit }) => String(job.id) === article.dataset.parentId && unit.unitId === article.dataset.ruId);
    if (!item) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openUnit(item.job, item.unit);
  }, true);
  fetch('data/jobs.json').then((response) => response.json()).then((data) => {
    state.jobs = data.jobs || [];
    setupHome(); setupSearch(); setupSettings(); renderCards(); renderInstitutions();
    const closingHeading = [...document.querySelectorAll('#home .section-head h2')].find((node) => node.textContent.includes('마감임박'));
    if (closingHeading) closingHeading.parentElement.nextElementSibling.innerHTML = '<div class="empty">신뢰 가능한 마감일 데이터가 없어 표시할 공고가 없습니다.</div>';
  });
})();
