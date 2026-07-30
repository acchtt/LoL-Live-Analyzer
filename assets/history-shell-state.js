// Keeps the result-only history shell synchronized even when other renderers replace content.
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

    // .panel and .app-panel each add the outer rounded frame. Remove both
    // while the result-only history card is present, then restore them when
    // switching back to a live game or a normal archived game.
    panel.classList.toggle('panel', !resultOnly);
    panel.classList.toggle('app-panel', !resultOnly);

    if (resultOnly) panel.dataset.historyShell = 'result-only';
    else delete panel.dataset.historyShell;
  }

  const observer = new MutationObserver(syncHistoryShell);
  observer.observe(content, { childList: true, subtree: true });
  queueMicrotask(syncHistoryShell);
})();