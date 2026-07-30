// Applies an explicit shell class for result-only history records.
// This avoids relying on :has() to remove the outer game-panel frame.
(() => {
  'use strict';

  const content = document.querySelector('#gameContent');
  const panel = content?.closest('.game-panel');
  if (!content || !panel || typeof MutationObserver !== 'function') return;

  const className = 'is-result-only-history';

  function syncHistoryShell() {
    const resultOnly = Boolean(
      content.querySelector('.series-hero[data-history-archive="missing"]')
    );
    content.classList.toggle(className, resultOnly);
    panel.classList.toggle(className, resultOnly);
  }

  const observer = new MutationObserver(syncHistoryShell);
  observer.observe(content, { childList: true, subtree: true });
  queueMicrotask(syncHistoryShell);
})();
