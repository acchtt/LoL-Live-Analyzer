// Keeps the live odds section directly above the champion/player board.
// Retains the actual panel node while gameContent is replaced during telemetry refreshes.
(() => {
  'use strict';

  const PANEL_ID = 'bookmakerOddsPanel';
  let panelRef = null;
  let placementQueued = false;

  function capturePanel() {
    const attached = document.getElementById(PANEL_ID);
    if (attached) panelRef = attached;
    return panelRef;
  }

  function placeOddsPanel() {
    placementQueued = false;

    const panel = capturePanel();
    const players = gameContent?.querySelector('.players');
    const host = players?.parentElement;
    if (!panel || !players || !host || !state?.selectedEventId) return;

    if (panel.parentNode !== host || panel.nextElementSibling !== players) {
      host.insertBefore(panel, players);
    }
  }

  function queuePlacement(useMicrotask = false) {
    capturePanel();
    if (placementQueued) return;
    placementQueued = true;

    if (useMicrotask) queueMicrotask(placeOddsPanel);
    else requestAnimationFrame(placeOddsPanel);
  }

  const gamePanel = gameContent?.parentElement;
  if (gamePanel) {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.id === PANEL_ID) panelRef = node;
          else {
            const nested = node.querySelector?.(`#${PANEL_ID}`);
            if (nested) panelRef = nested;
          }
        }
      }
      // MutationObserver runs immediately after innerHTML replacement, so restore
      // the retained panel before the next paint instead of waiting for polling.
      queuePlacement(true);
    });
    observer.observe(gamePanel, { childList: true, subtree: true });
  }

  const previousRenderGame = renderGame;
  renderGame = function oddsFirstRenderGame(...args) {
    capturePanel();
    const result = previousRenderGame(...args);
    queuePlacement(true);
    return result;
  };

  capturePanel();
  queuePlacement();
  // Covers non-renderGame screens such as pregame, breaks and unavailable telemetry.
  setInterval(() => queuePlacement(), 250);
})();
