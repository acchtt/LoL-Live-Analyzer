// Collapsible machine-readable feed for the Minimal Pro Dark workspace.
(() => {
  'use strict';

  const panel = document.querySelector('[data-data-drawer]');
  const toggle = document.querySelector('#toggleDataDrawer');
  const body = document.querySelector('#dataDrawerBody');
  if (!panel || !toggle || !body) return;

  function setOpen(open) {
    panel.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    body.setAttribute('aria-hidden', String(!open));
    body.style.setProperty('display', open ? 'grid' : 'none', 'important');
  }

  toggle.addEventListener('click', () => {
    setOpen(!panel.classList.contains('is-open'));
  });

  setOpen(false);
})();