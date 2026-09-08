(() => {
  const svg = (name) => {
    const paths = { home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', building: '<path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M2 21h20M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/>', settings: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 0 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A2 2 0 0 0 1.7 11H1.5a2 2 0 0 1 0-4h.2a2 2 0 0 0 1.4-3.4l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1A2 2 0 0 0 9.3 1.4v-.2a2 2 0 0 1 4 0v.2a2 2 0 0 0 3.4 1.4l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1A2 2 0 0 0 20.9 7h.2a2 2 0 0 1 0 4h-.2a2 2 0 0 0-1.5 4Z"/>', refresh: '<path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>', sparkle: '<path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4z"/>' };
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
  };
  const addIcon = (element, name) => { if (element && !element.querySelector('.ui-icon')) element.insertAdjacentHTML('afterbegin', svg(name)); };
  const navIcons = ['home', 'search', 'building', 'settings'];
  document.querySelectorAll('.bottomnav button').forEach((button, index) => { const label = button.lastChild?.textContent?.trim() || ''; button.innerHTML = `${svg(navIcons[index])}<span>${label}</span>`; });
  const refresh = document.querySelector('#refresh');
  if (refresh) refresh.innerHTML = svg('refresh');
  const headings = [...document.querySelectorAll('#home .section-head h2')];
  headings.forEach((heading) => { const name = heading.textContent.includes('마감') ? 'clock' : 'sparkle'; heading.innerHTML = `${svg(name)}<span>${heading.textContent.replace(/^[^\s]+\s*/, '')}</span>`; });
  document.querySelectorAll('.metric').forEach((metric, index) => { if (!metric.querySelector('.metric-icon')) { const names = ['search', 'sparkle', 'clock']; metric.insertAdjacentHTML('afterbegin', `<div class="metric-icon">${svg(names[index])}</div>`); } });
  const decorateEmptyStates = () => document.querySelectorAll('#closingList > .empty, #recommended > .empty').forEach((empty) => { if (!empty.querySelector('.empty-icon')) empty.insertAdjacentHTML('afterbegin', `<div class="empty-icon">${svg(empty.textContent.includes('마감') ? 'clock' : 'sparkle')}</div>`); });
  decorateEmptyStates();
  new MutationObserver(decorateEmptyStates).observe(document.body, { childList: true, subtree: true });
})();
