// Keeps the live odds section directly above the champion/player board.
(() => {
  'use strict';

  const PANEL_ID = 'bookmakerOddsPanel';
  let placementQueued = false;

  function placeOddsPanel() {
    placementQueued = false;

    const panel = document.getElementById(PANEL_ID);
    const players = gameContent?.querySelector('.players');
    if (!panel || !players) return;

    if (panel.parentNode !== gameContent || panel.nextElementSibling !== players) {
      gameContent.insertBefore(panel, players);
    }
  }

  function queuePlacement() {
    if (placementQueued) return;
    placementQueued = true;
    requestAnimationFrame(placeOddsPanel);
  }

  const gamePanel = gameContent?.parentElement;
  if (gamePanel) {
    const observer = new MutationObserver(queuePlacement);
    observer.observe(gamePanel, { childList: true, subtree: true });
  }

  const previousRenderGame = renderGame;
  renderGame = function oddsFirstRenderGame(...args) {
    const result = previousRenderGame(...args);
    queuePlacement();
    return result;
  };

  queuePlacement();
  setInterval(queuePlacement, 500);
})();
