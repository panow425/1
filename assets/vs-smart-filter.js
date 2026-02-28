(() => {
  const root = document.querySelector('[data-vsf]');
  if (!root) return;

  const openBtn = root.querySelector('[data-open-filter]');
  const closeBtn = root.querySelector('[data-close-filter]');
  const overlay = root.querySelector('[data-filter-overlay]');
  const sheet = root.querySelector('[data-filter-sheet]');
  const sortSelect = root.querySelector('[data-sort-select]');
  const sortProxy = root.querySelector('[data-sort-proxy]');
  const form = root.querySelector('#VSFilterForm');

  const open = () => {
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  };

  const close = () => {
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
    document.body.style.overflow = '';
  };

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  overlay?.addEventListener('click', close);

  sortSelect?.addEventListener('change', (event) => {
    sortProxy.value = event.target.value;
    form.submit();
  });
})();
