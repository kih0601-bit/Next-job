(() => {
  setTimeout(() => {
  const labels = { education: '학력', experience: '경력', region: '희망지역', employment: '고용형태', licenses: '자격증/면허' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const settings = document.getElementById('settings');
  if (!settings) return;
  const modal = document.createElement('div');
  modal.className = 'select-sheet';
  modal.innerHTML = '<div class="select-shade"></div><div class="select-panel"><div class="select-handle"></div><h2></h2><div class="select-options"></div></div>';
  document.body.appendChild(modal);
  const title = modal.querySelector('h2');
  const options = modal.querySelector('.select-options');
  const close = () => modal.classList.remove('open');
  modal.querySelector('.select-shade').onclick = close;
  const open = (name, values, selected, onSelect) => {
    title.textContent = `${labels[name] || name} 선택`;
    options.innerHTML = values.map((value) => `<button class="select-option ${value === selected ? 'selected' : ''}" data-value="${esc(value)}"><span>${value === selected ? '●' : '○'}</span>${esc(value)}</button>`).join('');
    options.querySelectorAll('.select-option').forEach((button) => button.onclick = () => { onSelect(button.dataset.value); close(); });
    modal.classList.add('open');
  };
  settings.querySelectorAll('[data-setting]').forEach((group) => {
    const name = group.dataset.setting;
    const field = group.closest('.field');
    const row = field?.querySelector('.settings-row');
    if (!row) return;
    const values = [...group.querySelectorAll('button')].map((button) => button.dataset.value).filter(Boolean);
    const selected = () => group.querySelector('button.active')?.dataset.value || values[0] || '미설정';
    const renderValue = () => { row.innerHTML = `<span>${labels[name]}</span><b>${esc(selected())} <i>›</i></b>`; };
    renderValue();
    row.onclick = () => open(name, values, selected(), (value) => { group.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.value === value)); renderValue(); });
    group.hidden = true;
    group.style.display = 'none';
    field.querySelector('label')?.remove();
  });
  const licenseField = settings.querySelector('#licenses')?.closest('.field');
  if (licenseField) {
    const input = licenseField.querySelector('#licenses');
    const row = licenseField.querySelector('.settings-row');
    row.innerHTML = `<span>${labels.licenses}</span><b>${input.value || '미설정'} <i>›</i></b>`;
    row.onclick = () => { title.textContent = labels.licenses; options.innerHTML = `<div class="license-entry"><input id="v3-license-input" placeholder="예: 컴퓨터활용능력 2급" value="${esc(input.value)}"><button>저장</button></div>`; modal.classList.add('open'); options.querySelector('button').onclick = () => { input.value = options.querySelector('input').value; row.querySelector('b').innerHTML = `${esc(input.value || '미설정')} <i>›</i>`; close(); }; };
    input.hidden = true;
    licenseField.querySelector('.small-note')?.remove();
  }
  }, 1200);
})();
