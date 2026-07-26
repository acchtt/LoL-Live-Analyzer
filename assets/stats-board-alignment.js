// Centers the in-game clock and aligns the KILLS label with both kill totals.
(() => {
  'use strict';

  function alignStatsBoard() {
    const scoreGrid = gameContent?.querySelector('.score-grid');
    const center = scoreGrid?.querySelector('.vs');
    const clock = gameContent?.querySelector('.clock');
    if (!scoreGrid || !center || !clock) return;

    center.classList.add('score-center');
    if (clock.parentElement === center && center.querySelector('.kills-label')) return;

    const killsLabel = document.createElement('span');
    killsLabel.className = 'kills-label';
    killsLabel.textContent = 'KILLS';
    center.replaceChildren(clock, killsLabel);
    gameContent.querySelector('.game-title')?.classList.add('clock-moved');
  }

  const previousRenderGame = renderGame;
  renderGame = function alignedStatsRenderGame(snapshot) {
    previousRenderGame(snapshot);
    alignStatsBoard();
  };
})();
