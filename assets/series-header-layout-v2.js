// Structural series-header layout: integrate the score between teams and keep controls out of the game rail.
(() => {
  'use strict';

  const root = document.getElementById('gameContent');
  if (!root) return;

  function enhanceSeriesHeader(hero) {
    if (!(hero instanceof HTMLElement) || hero.dataset.headerLayoutV2 === 'true') return;

    const top = hero.querySelector('.series-hero-top');
    const matchup = hero.querySelector('.series-hero-matchup');
    const score = hero.querySelector('.series-hero-score');
    const rightTeam = matchup?.querySelector('.series-hero-team.is-right');
    const versus = matchup?.querySelector('.series-hero-versus');
    const actions = hero.querySelector('.series-hero-actions');
    const historyBadge = hero.querySelector('.history-archive-badge');

    if (!top || !matchup || !score || !rightTeam) return;

    matchup.insertBefore(score, rightTeam);
    versus?.remove();

    const controls = actions || historyBadge;
    if (controls && controls.parentElement !== top) top.appendChild(controls);

    const returnButton = hero.querySelector('[data-return-live-game]');
    const archiveBadge = hero.querySelector('.series-hero-badge.is-archive, .history-archive-badge');
    hero.classList.toggle('is-archive-mode', Boolean(returnButton || archiveBadge));

    if (returnButton) {
      returnButton.textContent = 'Back to live';
      returnButton.setAttribute('aria-label', 'Return to the active live game');
    }

    hero.dataset.headerLayoutV2 = 'true';
  }

  function enhanceAll() {
    root.querySelectorAll('.series-hero').forEach(enhanceSeriesHeader);
  }

  const observer = new MutationObserver(enhanceAll);
  observer.observe(root, { childList: true, subtree: true });
  queueMicrotask(enhanceAll);
})();
