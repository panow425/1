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
  const submitLabel = root.querySelector('[data-submit-label]');
  const viewLabel = form?.dataset.viewLabel || 'View results';
  const selectedLabel = form?.dataset.selectedLabel || 'Selected';

  const selectedCount = () => {
    if (!form) return 0;
    const checked = form.querySelectorAll('input[type="checkbox"]:checked').length;
    const minInput = form.querySelector('input[name*="min_price"]');
    const maxInput = form.querySelector('input[name*="max_price"]');
    const hasPrice = (minInput && minInput.value) || (maxInput && maxInput.value);
    return checked + (hasPrice ? 1 : 0);
  };

  const updateSubmitLabel = () => {
    if (!submitLabel) return;
    const count = selectedCount();
    submitLabel.textContent = count > 0 ? `${viewLabel} (${selectedLabel}: ${count})` : viewLabel;
    submitLabel.classList.add('is-active');
    window.setTimeout(() => submitLabel.classList.remove('is-active'), 220);
  };

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
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sheet.classList.contains('is-open')) close();
  });

  form?.addEventListener('change', updateSubmitLabel);
  form?.addEventListener('input', updateSubmitLabel);
  updateSubmitLabel();

  sortSelect?.addEventListener('change', (event) => {
    sortProxy.value = event.target.value;
    form.submit();
  });
})();
